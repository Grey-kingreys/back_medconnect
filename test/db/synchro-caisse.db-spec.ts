import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import {
  verrouillerJourneesExclusif,
  verrouillerJourneesPartage,
} from 'src/pharmacie/caisse/journee';
import { ClotureService } from 'src/pharmacie/caisse/clotures.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { CatalogueSynchroService } from 'src/pharmacie/synchro/catalogue-synchro.service';
import {
  SynchroService,
  type ReponseSynchro,
  type ResultatEvenement,
} from 'src/pharmacie/synchro/synchro.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import { chargerFormatActuel } from './fixtures/format-actuel';

async function refus<T>(
  promesse: Promise<T>,
): Promise<{ statut: number; corps: Record<string, unknown> }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      const reponse = erreur.getResponse();
      return {
        statut: erreur.getStatus(),
        corps:
          typeof reponse === 'string'
            ? { message: reponse }
            : (reponse as Record<string, unknown>),
      };
    }
    throw erreur;
  }
  throw new Error('Un refus était attendu, la promesse a abouti.');
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const AUTRE_PHARMACIE = 'usr-pharm-p2';
const ip = '127.0.0.1';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const coupures = (montants: Record<number, number>) =>
  Object.entries(montants).map(([valeur, nombre]) => ({
    valeurFaciale: Number(valeur),
    nombre,
  }));

interface OptionsEvenement {
  utilisateurId?: unknown;
  horodatageLocal?: unknown;
  evenementId?: string;
}

interface EvenementEnvoye {
  evenementId: string;
  sequence: number;
  type: unknown;
  horodatageLocal: unknown;
  utilisateurId: unknown;
  corps: unknown;
}

describe('Synchro desktop : moteur de rejeu et événements de caisse, sur base de test (PB18b)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let sessions: SessionsCaisseService;
  let postes: PointsDeVenteService;
  let clotures: ClotureService;
  let synchro: SynchroService;
  let catalogue: CatalogueSynchroService;
  let D: string;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          id === RESPONSABLE
            ? ['caisse:utiliser', 'caisse:superviser', 'cloture:gerer']
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const mouvements = new MouvementsStockService();
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    postes = new PointsDeVenteService(prisma, acces);
    clotures = new ClotureService(prisma, acces);
    synchro = new SynchroService(prisma, acces, mouvements, sessions);
    catalogue = new CatalogueSynchroService(prisma, acces, stockage);
    await sql(
      `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = $1`,
      [PHARMACIE],
    );
    D = (
      await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
        type: 'DESKTOP',
        appareilId: 'desktop-pb18b',
      })
    ).data.id;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await fermerPrismaDeTest(prisma);
      }
    } finally {
      if (base) {
        await supprimerBaseDeTest(base);
      }
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  const attentesConsultatives = () =>
    compter(
      `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );

  async function attendreAttentes(n: number): Promise<void> {
    const debut = Date.now();
    while ((await attentesConsultatives()) < n) {
      if (Date.now() - debut > 4_000) {
        throw new Error('Attente non observée.');
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  function tenirJournees(mode: 'partage' | 'exclusif') {
    let signaler: () => void = () => undefined;
    const tenu = new Promise<void>((r) => (signaler = r));
    let liberer: () => void = () => undefined;
    const libere = new Promise<void>((r) => (liberer = r));
    const fin = prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (mode === 'partage') {
          await verrouillerJourneesPartage(tx, PHARMACIE);
        } else {
          await verrouillerJourneesExclusif(tx, PHARMACIE);
        }
        signaler();
        await libere;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    return { tenu, liberer, fin };
  }

  function ev(
    sequence: number,
    type: unknown,
    corps: unknown,
    options: OptionsEvenement = {},
  ): EvenementEnvoye {
    return {
      evenementId: options.evenementId ?? randomUUID(),
      sequence,
      type,
      horodatageLocal:
        'horodatageLocal' in options
          ? options.horodatageLocal
          : new Date().toISOString(),
      utilisateurId:
        'utilisateurId' in options ? options.utilisateurId : VENDEUR,
      corps,
    };
  }

  async function envoyer(
    evenements: EvenementEnvoye[],
    options: {
      etat?: { fileVide: boolean; sessionOuverte: boolean; versionApp: string };
      expediteur?: string;
      posteId?: string;
    } = {},
  ): Promise<{ data: ReponseSynchro; message: string }> {
    return synchro.recevoir(
      PHARMACIE,
      options.expediteur ?? VENDEUR,
      {
        posteId: options.posteId ?? D,
        etat: options.etat ?? {
          fileVide: true,
          sessionOuverte: false,
          versionApp: '0.1.0',
        },
        evenements,
      },
      ip,
    );
  }

  async function derniere(): Promise<number> {
    const res = await sql(
      `SELECT "derniereSequenceAppliquee" AS n FROM "Poste" WHERE "id" = $1`,
      [D],
    );
    return Number(res.rows[0].n);
  }

  const statuts = (r: { data: ReponseSynchro }) =>
    r.data.resultats.map((x) => x.statut);

  function uniqueResultat(r: { data: ReponseSynchro }): ResultatEvenement {
    expect(r.data.resultats).toHaveLength(1);
    return r.data.resultats[0];
  }

  async function ouvrirParEvenement(
    sessionId: string,
    sequence: number,
    options: OptionsEvenement = {},
  ) {
    const r = await envoyer([
      ev(sequence, 'SESSION_OUVERTE', { sessionId }, options),
    ]);
    expect(statuts(r)).toEqual(['APPLIQUE']);
    return r;
  }

  async function lireSession(id: string) {
    const res = await sql(
      `SELECT "statut"::text AS "statut", "utilisateurId", "ouverteLeLocal", "evenementOuvertureId", "evenementFermetureId", "clotureJournaliereId", to_char("jourMetier", 'YYYY-MM-DD') AS "jour", to_char("jourMetierOrigine", 'YYYY-MM-DD') AS "origine" FROM "SessionCaisse" WHERE "id" = $1`,
      [id],
    );
    return res.rows[0];
  }

  async function anomalies(type: string, pieceId?: string) {
    const res = await sql(
      `SELECT "id", "pieceType", "pieceId", "attribueeAId", "details" FROM "Anomalie" WHERE "type"::text = $1 ${pieceId ? 'AND "pieceId" = $2' : ''} ORDER BY "creeLe", "id"`,
      pieceId ? [type, pieceId] : [type],
    );
    return res.rows as {
      id: string;
      pieceType: string;
      pieceId: string;
      attribueeAId: string | null;
      details: Record<string, unknown>;
    }[];
  }

  async function compteurs() {
    return {
      sessions: await compter('SELECT count(*) AS n FROM "SessionCaisse"'),
      comptages: await compter('SELECT count(*) AS n FROM "ComptageCaisse"'),
      mouvements: await compter('SELECT count(*) AS n FROM "MouvementCaisse"'),
      resultats: await compter(
        'SELECT count(*) AS n FROM "ResultatSessionMode"',
      ),
      lignes: await compter('SELECT count(*) AS n FROM "EvenementSynchro"'),
      anomalies: await compter('SELECT count(*) AS n FROM "Anomalie"'),
    };
  }

  const S1 = randomUUID();
  const S2 = randomUUID();
  const evOuverture1 = randomUUID();
  const evMouvement1 = randomUUID();
  const evFermeture1 = randomUUID();
  const mouvement1 = randomUUID();
  const heure = new Date().toISOString();
  let lotInitial: ResultatEvenement[] = [];

  it('1. battement de coeur', async () => {
    const r = await envoyer([]);
    expect(r.data.resultats).toEqual([]);
    expect(r.data.sequenceAppliquee).toBe(0);
    expect(r.message).toBe('Poste à jour : aucune opération à envoyer.');
    const res = await sql(
      `SELECT "dernierContactLe", "dernierEtat" FROM "Poste" WHERE "id" = $1`,
      [D],
    );
    expect(
      (res.rows[0].dernierContactLe as Date).toISOString().slice(0, 10),
    ).toBe(jour(0));
    expect(res.rows[0].dernierEtat).toEqual({
      fileVide: true,
      fileVideDeclaree: true,
      sessionOuverte: false,
      versionApp: '0.1.0',
      enAttente: 0,
    });
  });

  it('2. une caisse complète rejouée', async () => {
    const comptageO = randomUUID();
    const comptageF = randomUUID();
    const r = await envoyer([
      ev(
        1,
        'SESSION_OUVERTE',
        { sessionId: S1 },
        {
          evenementId: evOuverture1,
          horodatageLocal: heure,
        },
      ),
      ev(2, 'COMPTAGE_SAISI', {
        comptageId: comptageO,
        sessionId: S1,
        moment: 'OUVERTURE',
        coupures: coupures({ 20000: 5 }),
      }),
      ev(
        3,
        'MOUVEMENT_CAISSE',
        {
          mouvementId: mouvement1,
          sessionId: S1,
          type: 'APPORT',
          montant: 10000,
          motif: 'Monnaie',
        },
        { evenementId: evMouvement1 },
      ),
      ev(4, 'COMPTAGE_SAISI', {
        comptageId: comptageF,
        sessionId: S1,
        moment: 'FERMETURE',
        coupures: coupures({ 20000: 5, 10000: 1 }),
      }),
      ev(5, 'SESSION_FERMEE', { sessionId: S1 }, { evenementId: evFermeture1 }),
    ]);
    lotInitial = r.data.resultats;
    expect(statuts(r)).toEqual([
      'APPLIQUE',
      'APPLIQUE',
      'APPLIQUE',
      'APPLIQUE',
      'APPLIQUE',
    ]);
    const s = await lireSession(S1);
    expect(s.statut).toBe('FERMEE');
    expect(s.utilisateurId).toBe(VENDEUR);
    expect((s.ouverteLeLocal as Date).toISOString()).toBe(heure);
    expect(s.jour).toBe(jour(0));
    expect(s.evenementOuvertureId).toBe(evOuverture1);
    expect(s.evenementFermetureId).toBe(evFermeture1);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "ComptageCaisse" WHERE "sessionCaisseId" = $1 AND "horodatageLocal" IS NOT NULL`,
        [S1],
      ),
    ).toBe(2);
    const mouvement = await sql(
      `SELECT "auteurId", "horodatageLocal" FROM "MouvementCaisse" WHERE "id" = $1`,
      [mouvement1],
    );
    expect(mouvement.rows[0].auteurId).toBe(VENDEUR);
    expect(mouvement.rows[0].horodatageLocal).not.toBeNull();
    const especes = await sql(
      `SELECT r."theorique", r."compte", r."ecart" FROM "ResultatSessionMode" r JOIN "ModePaiement" m ON m."id" = r."modePaiementId" WHERE r."sessionCaisseId" = $1 AND m."code" = 'ESPECES'`,
      [S1],
    );
    expect(Number(especes.rows[0].ecart)).toBe(0);
    const lignes = await sql(
      `SELECT "statut"::text AS "statut", "empreinte" FROM "EvenementSynchro" WHERE "posteId" = $1`,
      [D],
    );
    expect(lignes.rows).toHaveLength(5);
    for (const l of lignes.rows) {
      expect(l.statut).toBe('APPLIQUE');
      expect(String(l.empreinte)).toHaveLength(64);
    }
    expect(await derniere()).toBe(5);
    expect(await compter('SELECT count(*) AS n FROM "Anomalie"')).toBe(0);
  });

  it("3. doublon : rien n'est réappliqué", async () => {
    const avant = await compteurs();
    // Le même lot, renvoyé tel quel : mêmes identifiants, mêmes contenus.
    const ancien = await sql(
      `SELECT "evenementId", "sequence", "type", "utilisateurId", "horodatageLocal", "corps" FROM "EvenementSynchro" WHERE "posteId" = $1 ORDER BY "sequence"`,
      [D],
    );
    const renvoi = ancien.rows.map((l) =>
      ev(Number(l.sequence), l.type, l.corps, {
        evenementId: String(l.evenementId),
        utilisateurId: l.utilisateurId,
        horodatageLocal: (l.horodatageLocal as Date).toISOString(),
      }),
    );
    const r = await envoyer(renvoi);
    expect(statuts(r)).toEqual(Array(5).fill('DEJA_APPLIQUE'));
    expect(r.data.resultats.map((x) => x.piece)).toEqual(
      lotInitial.map((x) => x.piece),
    );
    expect(await compteurs()).toEqual(avant);
  });

  it('4. opération modifiée', async () => {
    const avant = await compter('SELECT count(*) AS n FROM "MouvementCaisse"');
    const modifie = ev(
      3,
      'MOUVEMENT_CAISSE',
      {
        mouvementId: mouvement1,
        sessionId: S1,
        type: 'APPORT',
        montant: 20000,
        motif: 'Monnaie',
      },
      { evenementId: evMouvement1 },
    );
    const r = await envoyer([modifie]);
    const x = uniqueResultat(r);
    expect(x.statut).toBe('REJETE');
    expect(x.code).toBe('EVENEMENT_MODIFIE');
    expect(await compter('SELECT count(*) AS n FROM "MouvementCaisse"')).toBe(
      avant,
    );
    const trouvees = await anomalies('EVENEMENT_REJETE');
    expect(trouvees).toHaveLength(1);
    expect(trouvees[0].pieceType).toBe('Poste');
    await envoyer([modifie]);
    expect(await anomalies('EVENEMENT_REJETE')).toHaveLength(1);
  });

  it("5. numéro d'ordre déjà pris", async () => {
    const r = await envoyer([
      ev(2, 'SESSION_OUVERTE', { sessionId: randomUUID() }),
    ]);
    const x = uniqueResultat(r);
    expect(x.statut).toBe('REJETE');
    expect(x.code).toBe('SEQUENCE_DEJA_UTILISEE');
    const trouvees = await anomalies('EVENEMENT_REJETE');
    const derniereAnomalie = trouvees[trouvees.length - 1];
    const details = derniereAnomalie.details;
    expect(details.code).toBe('SEQUENCE_DEJA_UTILISEE');
    expect(Object.keys(details)).not.toContain('corps');
    expect((details.resume as Record<string, unknown>).sessionId).toBeDefined();
  });

  it('6. ordre inversé', async () => {
    const comptage = ev(7, 'COMPTAGE_SAISI', {
      comptageId: randomUUID(),
      sessionId: S2,
      moment: 'OUVERTURE',
      coupures: coupures({ 10000: 2 }),
    });
    const mouvement = ev(8, 'MOUVEMENT_CAISSE', {
      mouvementId: randomUUID(),
      sessionId: S2,
      type: 'APPORT',
      montant: 5000,
      motif: 'Monnaie',
    });
    const attente = await envoyer([mouvement, comptage]);
    expect(statuts(attente)).toEqual(['EN_ATTENTE', 'EN_ATTENTE']);
    expect(attente.data.enAttente).toBe(2);
    expect(attente.data.sequenceAppliquee).toBe(5);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "EvenementSynchro" WHERE "posteId" = $1 AND "statut" = 'EN_ATTENTE'`,
        [D],
      ),
    ).toBe(2);
    const etat = await sql(
      `SELECT "dernierEtat" FROM "Poste" WHERE "id" = $1`,
      [D],
    );
    const dernierEtat = etat.rows[0].dernierEtat as Record<string, unknown>;
    expect(dernierEtat.fileVide).toBe(false);
    expect(dernierEtat.fileVideDeclaree).toBe(true);
    expect(dernierEtat.enAttente).toBe(2);

    const preparation = await clotures.preparer(
      PHARMACIE,
      RESPONSABLE,
      jour(0),
    );
    const attendu = preparation.data.postesAttendus.find(
      (p) => p.posteId === D,
    );
    expect(attendu?.raison).toBe('FILE_NON_VIDE');

    const comble = await envoyer([ev(6, 'SESSION_OUVERTE', { sessionId: S2 })]);
    const parSequence = new Map(
      comble.data.resultats.map((x) => [x.sequence, x]),
    );
    expect(parSequence.get(6)?.statut).toBe('APPLIQUE');
    expect(parSequence.get(7)?.statut).toBe('APPLIQUE');
    expect(parSequence.get(7)?.differe).toBe(true);
    expect(parSequence.get(8)?.statut).toBe('APPLIQUE');
    expect(parSequence.get(8)?.differe).toBe(true);
    expect(comble.data.enAttente).toBe(0);
    expect(await derniere()).toBe(8);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "EvenementSynchro" WHERE "posteId" = $1 AND "statut" = 'EN_ATTENTE'`,
        [D],
      ),
    ).toBe(0);
    const apres = await sql(
      `SELECT "dernierEtat" FROM "Poste" WHERE "id" = $1`,
      [D],
    );
    expect(
      (apres.rows[0].dernierEtat as Record<string, unknown>).fileVide,
    ).toBe(true);
    const preparationApres = await clotures.preparer(
      PHARMACIE,
      RESPONSABLE,
      jour(0),
    );
    // La caisse S2 reste ouverte sur D : il est encore attendu, mais plus pour une file non vide.
    expect(
      preparationApres.data.postesAttendus.find((p) => p.posteId === D)?.raison,
    ).toBe('SESSION_OUVERTE');
  });

  it('7. opération illisible, poste jamais bloqué', async () => {
    const n = (await derniere()) + 1;
    const illisible = ev(n, 'COMPTAGE_SAISI', {
      comptageId: randomUUID(),
      sessionId: S2,
      moment: 'FERMETURE',
      coupures: coupures({ 300: 1 }),
    });
    const r = await envoyer([
      illisible,
      ev(n + 1, 'ANNULATION', {}),
      ev(n + 2, 'MOUVEMENT_CAISSE', {}, { horodatageLocal: 'hier' }),
      ev(n + 3, 'MOUVEMENT_CAISSE', {
        mouvementId: randomUUID(),
        sessionId: S2,
        type: 'PRELEVEMENT',
        montant: 1000,
        motif: 'Café',
      }),
    ]);
    expect(statuts(r)).toEqual(['REJETE', 'REJETE', 'REJETE', 'APPLIQUE']);
    expect(r.data.resultats.map((x) => x.code)).toEqual([
      'EVENEMENT_INVALIDE',
      'EVENEMENT_INVALIDE',
      'EVENEMENT_INVALIDE',
      undefined,
    ]);
    expect(r.data.resultats[1].champs).toEqual(['type']);
    expect(r.data.resultats[2].champs).toEqual(['horodatageLocal']);
    const ligne = await sql(
      `SELECT "statut"::text AS "statut", "corps" FROM "EvenementSynchro" WHERE "evenementId" = $1`,
      [illisible.evenementId],
    );
    expect(ligne.rows[0].statut).toBe('REJETE');
    expect(ligne.rows[0].corps).toEqual(illisible.corps);
    const ligneRejetee = await sql(
      `SELECT "id" FROM "EvenementSynchro" WHERE "evenementId" = $1`,
      [illisible.evenementId],
    );
    const trouvee = await anomalies(
      'EVENEMENT_REJETE',
      String(ligneRejetee.rows[0].id),
    );
    expect(trouvee).toHaveLength(1);
    expect(trouvee[0].pieceType).toBe('EvenementSynchro');
    expect(trouvee[0].attribueeAId).toBe(RESPONSABLE);
    expect(Object.keys(trouvee[0].details)).not.toContain('corps');
    expect(await derniere()).toBe(n + 3);
  });

  it('8. attribution', async () => {
    const n = (await derniere()) + 1;
    const mouvement = randomUUID();
    const r = await envoyer(
      [
        ev(n, 'MOUVEMENT_CAISSE', {}, { utilisateurId: AUTRE_PHARMACIE }),
        ev(n + 1, 'MOUVEMENT_CAISSE', {
          mouvementId: mouvement,
          sessionId: S2,
          type: 'APPORT',
          montant: 2000,
          motif: 'Monnaie',
        }),
      ],
      { expediteur: RESPONSABLE },
    );
    expect(r.data.resultats[0].statut).toBe('REJETE');
    expect(r.data.resultats[0].code).toBe('UTILISATEUR_NON_AUTORISE');
    expect(r.data.resultats[1].statut).toBe('APPLIQUE');
    const res = await sql(
      `SELECT "auteurId" FROM "MouvementCaisse" WHERE "id" = $1`,
      [mouvement],
    );
    expect(res.rows[0].auteurId).toBe(VENDEUR);
  });

  it('9. caisse inconnue', async () => {
    const posteWeb = await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
      type: 'WEB',
      appareilId: 'navigateur-pb18b',
    });
    const web = await sessions.ouvrir(PHARMACIE, RESPONSABLE, {
      posteId: posteWeb.data.id,
    });
    const n = (await derniere()) + 1;
    const corps = (sessionId: string) => ({
      comptageId: randomUUID(),
      sessionId,
      moment: 'OUVERTURE',
      coupures: coupures({ 10000: 1 }),
    });
    const r = await envoyer([
      ev(n, 'COMPTAGE_SAISI', corps(randomUUID())),
      ev(n + 1, 'COMPTAGE_SAISI', corps(web.data.id)),
    ]);
    expect(r.data.resultats.map((x) => x.code)).toEqual([
      'SESSION_INCONNUE',
      'SESSION_INCONNUE',
    ]);
    expect(statuts(r)).toEqual(['REJETE', 'REJETE']);
  });

  it('10. caisse déjà fermée', async () => {
    const n = (await derniere()) + 1;
    const avant = await compteurs();
    const r = await envoyer([
      ev(n, 'MOUVEMENT_CAISSE', {
        mouvementId: randomUUID(),
        sessionId: S1,
        type: 'APPORT',
        montant: 1000,
        motif: 'Monnaie',
      }),
    ]);
    expect(uniqueResultat(r).code).toBe('SESSION_FERMEE');
    expect(uniqueResultat(r).statut).toBe('REJETE');
    const apresRejet = await compteurs();
    const d = await envoyer([ev(n + 1, 'SESSION_FERMEE', { sessionId: S1 })]);
    const x = uniqueResultat(d);
    expect(x.statut).toBe('APPLIQUE');
    expect(x.code).toBe('SESSION_DEJA_FERMEE');
    const apres = await compteurs();
    expect({ ...apres, lignes: 0, anomalies: 0 }).toEqual({
      ...avant,
      lignes: 0,
      anomalies: 0,
    });
    expect(apres.sessions).toBe(apresRejet.sessions);
    expect(apres.comptages).toBe(apresRejet.comptages);
    expect(apres.mouvements).toBe(apresRejet.mouvements);
    expect(apres.resultats).toBe(apresRejet.resultats);
    expect(apres.anomalies).toBe(apresRejet.anomalies);
  });

  it('11. fermeture sans comptage, écart sans commentaire', async () => {
    const n = (await derniere()) + 1;
    const r = await envoyer([ev(n, 'SESSION_FERMEE', { sessionId: S2 })]);
    expect(uniqueResultat(r).statut).toBe('APPLIQUE');
    expect((await lireSession(S2)).statut).toBe('FERMEE');
    const especes = await sql(
      `SELECT r."compte", r."ecart" FROM "ResultatSessionMode" r JOIN "ModePaiement" m ON m."id" = r."modePaiementId" WHERE r."sessionCaisseId" = $1 AND m."code" = 'ESPECES'`,
      [S2],
    );
    expect(especes.rows[0].compte).toBeNull();
    expect(especes.rows[0].ecart).toBeNull();
    const sansComptage = await anomalies('ECART_CAISSE', S2);
    expect(sansComptage).toHaveLength(1);
    expect(sansComptage[0].details.raison).toBe('COMPTAGE_FERMETURE_ABSENT');

    const S3 = randomUUID();
    const m = (await derniere()) + 1;
    const rr = await envoyer([
      ev(m, 'SESSION_OUVERTE', { sessionId: S3 }),
      ev(m + 1, 'COMPTAGE_SAISI', {
        comptageId: randomUUID(),
        sessionId: S3,
        moment: 'OUVERTURE',
        coupures: coupures({ 20000: 5 }),
      }),
      ev(m + 2, 'SESSION_FERMEE', {
        sessionId: S3,
        comptageFermeture: {
          comptageId: randomUUID(),
          coupures: coupures({ 20000: 2, 10000: 1 }),
        },
      }),
    ]);
    expect(statuts(rr)).toEqual(['APPLIQUE', 'APPLIQUE', 'APPLIQUE']);
    expect((await lireSession(S3)).statut).toBe('FERMEE');
    const ecart = await anomalies('ECART_CAISSE', S3);
    expect(ecart).toHaveLength(1);
    expect(Number(ecart[0].details.ecart)).toBe(-50000);
  });

  it('12. fermeture manquante', async () => {
    const S4 = randomUUID();
    const S5 = randomUUID();
    const n = (await derniere()) + 1;
    await ouvrirParEvenement(S4, n);
    const r = await ouvrirParEvenement(S5, n + 1);
    expect((await lireSession(S4)).statut).toBe('FERMEE');
    expect((await lireSession(S5)).statut).toBe('OUVERTE');
    const manquante = await anomalies('SEQUENCE_MANQUANTE', S4);
    expect(manquante).toHaveLength(1);
    expect(manquante[0].details.raison).toBe('FERMETURE_MANQUANTE');
    expect(manquante[0].attribueeAId).toBe(RESPONSABLE);
    expect(r.data.resultats[0].anomalies?.map((a) => a.type)).toContain(
      'SEQUENCE_MANQUANTE',
    );
    const ferme = await envoyer([
      ev(n + 2, 'SESSION_FERMEE', { sessionId: S5 }),
    ]);
    expect(statuts(ferme)).toEqual(['APPLIQUE']);
    expect((await lireSession(S5)).statut).toBe('FERMEE');
  });

  it('13. trou de plus de 24 heures', async () => {
    const S6 = randomUUID();
    const n = (await derniere()) + 1;
    await ouvrirParEvenement(S6, n);
    const manquant = n + 1;
    const apresTrou = n + 2;
    const mouvementApres = randomUUID();
    const mouvementManquant = randomUUID();
    await sql(
      `INSERT INTO "EvenementSynchro" ("id","evenementId","posteId","sequence","type","utilisateurId","horodatageLocal","recuLe","statut","empreinte","corps") VALUES ($1,$2,$3,$4,'MOUVEMENT_CAISSE',$5,now(),now() - interval '25 hours','EN_ATTENTE','empreinte-essai-pb18b',$6::jsonb)`,
      [
        randomUUID(),
        randomUUID(),
        D,
        apresTrou,
        VENDEUR,
        JSON.stringify({
          mouvementId: mouvementApres,
          sessionId: S6,
          type: 'APPORT',
          montant: 3000,
          motif: 'Monnaie',
        }),
      ],
    );
    const r = await envoyer([]);
    const saut = await anomalies('SEQUENCE_MANQUANTE');
    const duPoste = saut.filter((a) => a.pieceType === 'Poste');
    expect(duPoste).toHaveLength(1);
    expect(duPoste[0].details.premiere).toBe(manquant);
    expect(duPoste[0].details.derniere).toBe(manquant);
    expect(duPoste[0].details.nombre).toBe(1);
    const diffre = r.data.resultats.find((x) => x.sequence === apresTrou);
    expect(diffre?.statut).toBe('APPLIQUE');
    expect(diffre?.differe).toBe(true);
    expect(await derniere()).toBe(apresTrou);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "EvenementSynchro" WHERE "posteId" = $1 AND "sequence" = $2 AND "statut" = 'APPLIQUE'`,
        [D, apresTrou],
      ),
    ).toBe(1);

    const tardif = await envoyer([
      ev(manquant, 'MOUVEMENT_CAISSE', {
        mouvementId: mouvementManquant,
        sessionId: S6,
        type: 'APPORT',
        montant: 1500,
        motif: 'Monnaie',
      }),
    ]);
    const x = uniqueResultat(tardif);
    expect(x.statut).toBe('APPLIQUE');
    expect(x.horsOrdre).toBe(true);
    expect(await derniere()).toBe(apresTrou);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementCaisse" WHERE "id" = $1`,
        [mouvementManquant],
      ),
    ).toBe(1);

    const ferme = await envoyer([
      ev(apresTrou + 1, 'SESSION_FERMEE', { sessionId: S6 }),
    ]);
    expect(statuts(ferme)).toEqual(['APPLIQUE']);
  });

  it('14. vente pas encore prise en charge', async () => {
    const n = (await derniere()) + 1;
    const lignesAvant = await compter(
      'SELECT count(*) AS n FROM "EvenementSynchro"',
    );
    const r = await envoyer([
      ev(n, 'VENTE', { venteId: randomUUID(), sessionId: randomUUID() }),
      ev(n + 1, 'MOUVEMENT_CAISSE', {}),
    ]);
    expect(statuts(r)).toEqual(['A_RENVOYER', 'A_RENVOYER']);
    expect(r.data.resultats.map((x) => x.code)).toEqual([
      'SERVICE_INDISPONIBLE',
      'SERVICE_INDISPONIBLE',
    ]);
    expect(await compter('SELECT count(*) AS n FROM "EvenementSynchro"')).toBe(
      lignesAvant,
    );
    expect(await derniere()).toBe(n - 1);
    const etat = await sql(
      `SELECT "dernierEtat" FROM "Poste" WHERE "id" = $1`,
      [D],
    );
    expect((etat.rows[0].dernierEtat as Record<string, unknown>).fileVide).toBe(
      false,
    );
  });

  it('15. caisse restée ouverte après une clôture forcée', async () => {
    await envoyer([]);
    const hier = jour(-1);
    const S7 = randomUUID();
    const S8 = randomUUID();
    const n = (await derniere()) + 1;
    await ouvrirParEvenement(S7, n, {
      horodatageLocal: `${hier}T18:00:00.000Z`,
    });
    expect((await lireSession(S7)).jour).toBe(hier);

    const incomplet = await refus(
      clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: hier }, ip),
    );
    expect(incomplet.statut).toBe(409);
    expect(incomplet.corps.code).toBe('CLOTURE_INCOMPLETE');
    const { data } = await clotures.cloturer(
      PHARMACIE,
      RESPONSABLE,
      { jour: hier, forcer: true, motifForcage: 'Poste D hors ligne' },
      ip,
    );
    expect(data.forcee).toBe(true);
    expect(data.postesManquants[0].sessionId).toBe(S7);

    const instantane = async () => {
      const cloture = await sql(
        `SELECT "id", "forcee", "postesManquants" FROM "ClotureJournaliere" WHERE "id" = $1`,
        [data.id],
      );
      const totaux = await sql(
        `SELECT "modePaiementId", "theorique", "compte", "ecart" FROM "TotalClotureMode" WHERE "clotureId" = $1 ORDER BY "modePaiementId"`,
        [data.id],
      );
      const incluses = await sql(
        `SELECT "id" FROM "SessionCaisse" WHERE "clotureJournaliereId" = $1 ORDER BY "id"`,
        [data.id],
      );
      const pieces = await compter(
        `SELECT count(*) AS n FROM "Vente" WHERE "jourMetier" = $1::date`,
        [hier],
      );
      return JSON.stringify([cloture.rows, totaux.rows, incluses.rows, pieces]);
    };
    const avant = await instantane();

    const k = (await derniere()) + 1;
    const r = await envoyer([
      ev(k, 'COMPTAGE_SAISI', {
        comptageId: randomUUID(),
        sessionId: S7,
        moment: 'OUVERTURE',
        coupures: coupures({ 20000: 5 }),
      }),
      ev(k + 1, 'MOUVEMENT_CAISSE', {
        mouvementId: randomUUID(),
        sessionId: S7,
        type: 'APPORT',
        montant: 5000,
        motif: 'Monnaie',
      }),
      ev(k + 2, 'SESSION_FERMEE', {
        sessionId: S7,
        comptageFermeture: {
          comptageId: randomUUID(),
          coupures: coupures({ 20000: 5, 10000: 1 }),
        },
      }),
    ]);
    expect(statuts(r)).toEqual(['APPLIQUE', 'APPLIQUE', 'APPLIQUE']);
    const s = await lireSession(S7);
    expect(s.statut).toBe('FERMEE');
    expect(s.clotureJournaliereId).toBeNull();
    const remontee = await anomalies('REMONTEE_APRES_CLOTURE', S7);
    expect(remontee).toHaveLength(1);
    expect(remontee[0].attribueeAId).toBe(RESPONSABLE);
    expect(remontee[0].details.raison).toBe('CAISSE_FERMEE_APRES_CLOTURE');
    expect(remontee[0].details.clotureId).toBe(data.id);
    expect(remontee[0].details.posteManquantDeLaCloture).toBe(true);
    expect(await instantane()).toBe(avant);

    await ouvrirParEvenement(S8, k + 3, {
      horodatageLocal: `${hier}T22:00:00.000Z`,
    });
    const rattachee = await lireSession(S8);
    expect(rattachee.jour).toBe(jour(0));
    expect(rattachee.origine).toBe(hier);
    const f = await envoyer([ev(k + 4, 'SESSION_FERMEE', { sessionId: S8 })]);
    expect(statuts(f)).toEqual(['APPLIQUE']);
  });

  it('16. envois simultanés et clôture en cours', async () => {
    const S9 = randomUUID();
    const n = (await derniere()) + 1;
    const lot = [
      ev(n, 'SESSION_OUVERTE', { sessionId: S9 }),
      ev(n + 1, 'MOUVEMENT_CAISSE', {
        mouvementId: randomUUID(),
        sessionId: S9,
        type: 'APPORT',
        montant: 1000,
        motif: 'Monnaie',
      }),
    ];
    const [a, b] = await Promise.all([envoyer(lot), envoyer(lot)]);
    for (let i = 0; i < 2; i += 1) {
      expect(
        [a.data.resultats[i].statut, b.data.resultats[i].statut].sort(),
      ).toEqual(['APPLIQUE', 'DEJA_APPLIQUE']);
      expect(
        await compter(
          `SELECT count(*) AS n FROM "EvenementSynchro" WHERE "evenementId" = $1`,
          [lot[i].evenementId],
        ),
      ).toBe(1);
    }

    const h = tenirJournees('exclusif');
    let attente: Promise<{ data: ReponseSynchro }> | undefined;
    let resolue = false;
    try {
      await h.tenu;
      attente = envoyer([ev(n + 2, 'SESSION_FERMEE', { sessionId: S9 })]).then(
        (r) => {
          resolue = true;
          return r;
        },
      );
      await attendreAttentes(1);
      await new Promise((r) => setTimeout(r, 200));
      expect(resolue).toBe(false);
    } finally {
      h.liberer();
      await h.fin;
    }
    const r = await attente;
    expect(r && statuts(r)).toEqual(['APPLIQUE']);
  });

  it('17. séquences dans la photographie', async () => {
    const d = await derniere();
    const avant = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
    expect(avant.poste.sequenceAppliquee).toBe(d);
    const r = await envoyer([
      ev(d + 3, 'MOUVEMENT_CAISSE', {
        mouvementId: randomUUID(),
        sessionId: randomUUID(),
        type: 'APPORT',
        montant: 1000,
        motif: 'Monnaie',
      }),
    ]);
    expect(statuts(r)).toEqual(['EN_ATTENTE']);
    const apres = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
    expect(apres.poste.sequenceMaxRecue).toBe(d + 3);
    expect(apres.poste.sequenceAppliquee).toBe(d);
  });

  // Tests 18 et 19 (D664) : poste dédié, le poste D garde une attente du test 17.
  let D2 = '';
  const S10 = randomUUID();

  async function derniereDe(posteId: string): Promise<number> {
    const res = await sql(
      `SELECT "derniereSequenceAppliquee" AS n FROM "Poste" WHERE "id" = $1`,
      [posteId],
    );
    return Number(res.rows[0].n);
  }

  async function etatDe(posteId: string) {
    const res = await sql(`SELECT "dernierEtat" FROM "Poste" WHERE "id" = $1`, [
      posteId,
    ]);
    return res.rows[0].dernierEtat as Record<string, unknown>;
  }

  const mouvement = (sessionId: string, motif = 'Monnaie') => ({
    mouvementId: randomUUID(),
    sessionId,
    type: 'APPORT',
    montant: 1000,
    motif,
  });

  it('18. caractère NUL : mis de côté, jamais renvoyé à l infini', async () => {
    D2 = (
      await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
        type: 'DESKTOP',
        appareilId: 'desktop-pb18b-nul',
      })
    ).data.id;
    const surD2 = { posteId: D2 };
    const ouverte = await envoyer(
      [ev(1, 'SESSION_OUVERTE', { sessionId: S10 })],
      surD2,
    );
    expect(statuts(ouverte)).toEqual(['APPLIQUE']);

    // En attente (trou à 2) : stocké sans erreur malgré le NUL.
    const nulEnAttente = ev(
      3,
      'MOUVEMENT_CAISSE',
      mouvement(S10, 'Mon\u0000naie'),
    );
    const attente = await envoyer([nulEnAttente], surD2);
    expect(statuts(attente)).toEqual(['EN_ATTENTE']);

    // Le trou comblé, il est rejeté en différé ; puis NUL dans l'ordre, dans le
    // vendeur, et un événement valide après eux.
    const nulDirect = ev(4, 'MOUVEMENT_CAISSE', mouvement(S10, 'Café\u0000'));
    const r = await envoyer(
      [
        ev(2, 'MOUVEMENT_CAISSE', mouvement(S10)),
        nulDirect,
        ev(5, 'MOUVEMENT_CAISSE', mouvement(S10), {
          utilisateurId: `${VENDEUR}\u0000`,
        }),
        ev(6, 'MOUVEMENT_CAISSE', mouvement(S10)),
      ],
      surD2,
    );
    expect(
      r.data.resultats.map((x) => [x.sequence, x.statut, x.code, x.champs]),
    ).toEqual([
      [2, 'APPLIQUE', undefined, undefined],
      [3, 'REJETE', 'EVENEMENT_INVALIDE', ['corps']],
      [4, 'REJETE', 'EVENEMENT_INVALIDE', ['corps']],
      [5, 'REJETE', 'EVENEMENT_INVALIDE', ['utilisateurId']],
      [6, 'APPLIQUE', undefined, undefined],
    ]);
    expect(r.data.resultats[1].differe).toBe(true);
    expect(await derniereDe(D2)).toBe(6);
    expect((await etatDe(D2)).fileVide).toBe(true);

    // Corps gardé sans perte en texte, consultable ; anomalie sans NUL ni corps.
    const ligne = await sql(
      `SELECT "id", "statut"::text AS "statut", "corps" FROM "EvenementSynchro" WHERE "evenementId" = $1`,
      [nulEnAttente.evenementId],
    );
    expect(ligne.rows[0].statut).toBe('REJETE');
    const stocke = ligne.rows[0].corps as { corpsIllisible: string };
    expect(JSON.parse(stocke.corpsIllisible)).toEqual(nulEnAttente.corps);
    const anomalie = await anomalies(
      'EVENEMENT_REJETE',
      String(ligne.rows[0].id),
    );
    expect(anomalie).toHaveLength(1);
    expect(Object.keys(anomalie[0].details)).not.toContain('corps');
    // Seuls les mouvements 2 et 6 sont écrits.
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementCaisse" WHERE "sessionCaisseId" = $1`,
        [S10],
      ),
    ).toBe(2);

    // Renvoyé tel quel : le rejet stocké, aucune nouvelle anomalie.
    const avant = await compteurs();
    const rejeu = await envoyer([nulDirect], surD2);
    expect(uniqueResultat(rejeu).statut).toBe('REJETE');
    expect(await compteurs()).toEqual(avant);
  });

  it('19. erreur imprévue répétée : mise de côté au troisième essai', async () => {
    const surD2 = { posteId: D2 };
    const n = (await derniereDe(D2)) + 1;
    const empoisonne = ev(n, 'COMPTAGE_SAISI', {
      comptageId: randomUUID(),
      sessionId: S10,
      moment: 'OUVERTURE',
      coupures: coupures({ 20000: 1 }),
    });
    const suivant = ev(n + 1, 'MOUVEMENT_CAISSE', mouvement(S10));
    const espion = jest
      .spyOn(sessions, 'enregistrerComptage')
      .mockRejectedValue(new TypeError('panne simulée'));
    try {
      for (const essai of [1, 2]) {
        const r = await envoyer([empoisonne, suivant], surD2);
        expect(statuts(r)).toEqual(['A_RENVOYER', 'A_RENVOYER']);
        expect(r.data.resultats[0].code).toBe('SERVICE_INDISPONIBLE');
        expect(await derniereDe(D2)).toBe(n - 1);
        const etat = await etatDe(D2);
        expect(etat.fileVide).toBe(false);
        expect(etat.echecImprevu).toEqual({
          evenementId: empoisonne.evenementId,
          nombre: essai,
        });
      }

      // Panne passagère de la base : jamais comptée.
      espion.mockRejectedValueOnce(
        Object.assign(new Error('Timed out fetching a new connection'), {
          code: 'P2024',
        }),
      );
      const passager = await envoyer([empoisonne, suivant], surD2);
      expect(statuts(passager)).toEqual(['A_RENVOYER', 'A_RENVOYER']);
      expect((await etatDe(D2)).echecImprevu).toEqual({
        evenementId: empoisonne.evenementId,
        nombre: 2,
      });
      expect(
        await compter(
          `SELECT count(*) AS n FROM "EvenementSynchro" WHERE "evenementId" = $1`,
          [empoisonne.evenementId],
        ),
      ).toBe(0);

      // Troisième échec : mis de côté, la séquence avance, le suivant passe.
      const r = await envoyer([empoisonne, suivant], surD2);
      expect(statuts(r)).toEqual(['REJETE', 'APPLIQUE']);
      expect(r.data.resultats[0].code).toBe('EVENEMENT_INAPPLICABLE');
      expect(await derniereDe(D2)).toBe(n + 1);
      const etat = await etatDe(D2);
      expect(etat.fileVide).toBe(true);
      expect(etat).not.toHaveProperty('echecImprevu');
      const ligne = await sql(
        `SELECT "id", "statut"::text AS "statut", "corps" FROM "EvenementSynchro" WHERE "evenementId" = $1`,
        [empoisonne.evenementId],
      );
      expect(ligne.rows[0].statut).toBe('REJETE');
      expect(ligne.rows[0].corps).toEqual(empoisonne.corps);
      const anomalie = await anomalies(
        'EVENEMENT_REJETE',
        String(ligne.rows[0].id),
      );
      expect(anomalie).toHaveLength(1);
      expect(anomalie[0].attribueeAId).toBe(RESPONSABLE);
      expect(anomalie[0].details.code).toBe('EVENEMENT_INAPPLICABLE');
    } finally {
      espion.mockRestore();
    }
  });
});
