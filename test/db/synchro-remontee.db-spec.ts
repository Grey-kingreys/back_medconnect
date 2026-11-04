import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import type { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { ClotureService } from 'src/pharmacie/caisse/clotures.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { jourLisible } from 'src/pharmacie/jour-metier';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import {
  SynchroService,
  type ReponseSynchro,
} from 'src/pharmacie/synchro/synchro.service';
import { VenteService } from 'src/pharmacie/vente.service';
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

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const ip = '127.0.0.1';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const coupures = (montants: Record<number, number>) =>
  Object.entries(montants).map(([valeur, nombre]) => ({
    valeurFaciale: Number(valeur),
    nombre,
  }));

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

interface EvenementEnvoye {
  evenementId: string;
  sequence: number;
  type: string;
  horodatageLocal: string;
  utilisateurId: string;
  corps: unknown;
}

interface ElementListe {
  id: string;
  numero: string;
  total: number;
  typePiece: string;
}

interface ReponseListe {
  data: { nombre: number; totalJour: number; ventes: ElementListe[] };
}

describe('Synchro desktop : vente remontée après une clôture ou une fermeture, sur base de test (PB18d)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let service: VenteService;
  let sessions: SessionsCaisseService;
  let clotures: ClotureService;
  let receptions: ReceptionsService;
  let postes: PointsDeVenteService;
  let pv1: string;
  let D: { id: string; debut: number; fin: number; utilises: number };

  const hier = jour(-1);
  const aujourdhui = jour(0);
  const horodatage = (heure: string) => `${hier}T${heure}:00.000Z`;

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
            ? [
                'vente:write',
                'vente:annuler',
                'caisse:utiliser',
                'caisse:superviser',
                'cloture:gerer',
                'stock:write',
                'reception:write',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const notifications = {
      createManyNotifications: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const mouvements = new MouvementsStockService();
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    postes = new PointsDeVenteService(prisma, acces);
    clotures = new ClotureService(prisma, acces);
    synchro = new SynchroService(prisma, acces, mouvements, sessions);
    service = new VenteService(
      prisma,
      notifications,
      stockage,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
    await sql(
      `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = $1`,
      [PHARMACIE],
    );
    pv1 = String(
      (
        await sql(
          'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
          [PHARMACIE],
        )
      ).rows[0].id,
    );
    const poste = await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
      type: 'DESKTOP',
      appareilId: 'desktop-pb18d',
    });
    const plage = await postes.attribuerPlage(
      PHARMACIE,
      RESPONSABLE,
      poste.data.id,
      { id: randomUUID() },
    );
    D = {
      id: poste.data.id,
      debut: plage.data.debut,
      fin: plage.data.fin,
      utilises: 0,
    };
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

  // ------------------------------------------------------------ aides base

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function soldeProduit(stockId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1 AND "pointDeVenteId" = $2',
      [stockId, pv1],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  async function pieceDe(venteId: string) {
    const res = await sql(
      `SELECT "id", "numero", "numeroTicket", "typePiece"::text AS "typePiece", to_char("jourMetier", 'YYYY-MM-DD') AS "jour", to_char("jourMetierOrigine", 'YYYY-MM-DD') AS "origine", "venteOrigineId", "sessionCaisseId", "total" FROM "Vente" WHERE "id" = $1`,
      [venteId],
    );
    return res.rows[0];
  }

  async function lireSession(id: string) {
    const res = await sql(
      `SELECT "statut"::text AS "statut", "clotureJournaliereId", to_char("jourMetier", 'YYYY-MM-DD') AS "jour", to_char("jourMetierOrigine", 'YYYY-MM-DD') AS "origine" FROM "SessionCaisse" WHERE "id" = $1`,
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

  async function etatJour(j: string) {
    // Contenu utile de chaque pièce du jour, paiements compris : un changement de
    // montant, de type, de jour ou de caisse est vu ici, pas seulement par l'export.
    const pieces = (
      await sql(
        `SELECT v."id", v."typePiece"::text AS "typePiece", v."total", v."jourMetier"::text AS "jourMetier", v."sessionCaisseId",
           COALESCE((SELECT json_agg(json_build_object('sessionCaisseId', p."sessionCaisseId", 'modePaiementId', p."modePaiementId", 'montant', p."montant", 'referenceExterne', p."referenceExterne") ORDER BY p."id") FROM "Paiement" p WHERE p."venteId" = v."id"), '[]'::json) AS "paiements"
         FROM "Vente" v WHERE v."pointDeVenteId" = $1 AND v."jourMetier" = $2::date ORDER BY v."id"`,
        [pv1, j],
      )
    ).rows;
    const sessionsDuJour = (
      await sql(
        `SELECT "id", "statut"::text AS "statut", "clotureJournaliereId" FROM "SessionCaisse" WHERE "pointDeVenteId" = $1 AND "jourMetier" = $2::date ORDER BY "id"`,
        [pv1, j],
      )
    ).rows;
    const cloture = (
      await sql(
        `SELECT "id", "forcee", "postesManquants" FROM "ClotureJournaliere" WHERE "pointDeVenteId" = $1 AND "jourMetier" = $2::date`,
        [pv1, j],
      )
    ).rows[0];
    const totaux = (
      await sql(
        `SELECT m."code" AS "mode", t."theorique", t."compte", t."ecart" FROM "TotalClotureMode" t JOIN "ClotureJournaliere" c ON c."id" = t."clotureId" JOIN "ModePaiement" m ON m."id" = t."modePaiementId" WHERE c."pointDeVenteId" = $1 AND c."jourMetier" = $2::date ORDER BY m."code"`,
        [pv1, j],
      )
    ).rows;
    const exporte = cloture
      ? (await clotures.exporter(PHARMACIE, RESPONSABLE, j)).contenu.toString(
          'utf8',
        )
      : null;
    return {
      pieces,
      sessions: sessionsDuJour,
      cloture,
      totaux,
      export: exporte,
    };
  }

  // ---------------------------------------------------------- aides envoi

  const ev = (
    sequence: number,
    type: string,
    corps: unknown,
    heure?: string,
  ): EvenementEnvoye => ({
    evenementId: randomUUID(),
    sequence,
    type,
    horodatageLocal: heure ? horodatage(heure) : new Date().toISOString(),
    utilisateurId: VENDEUR,
    corps,
  });

  function evVente(
    sequence: number,
    sessionId: string,
    stockId: string,
    boites: number,
    heure?: string,
  ): EvenementEnvoye & { venteId: string } {
    const venteId = randomUUID();
    const total = boites * 1000;
    return {
      ...ev(
        sequence,
        'VENTE',
        {
          venteId,
          sessionId,
          numeroTicket: D.debut + D.utilises++,
          lignes: [
            { stockId, unite: 'BOITE', nombre: boites, prixUnitaire: 1000 },
          ],
          paiements: [{ mode: 'ESPECES', montant: total }],
          total,
          ordonnanceVerifiee: true,
        },
        heure,
      ),
      venteId,
    };
  }

  async function envoyer(
    evenements: EvenementEnvoye[],
  ): Promise<ReponseSynchro> {
    const r = await synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: D.id,
        etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' },
        evenements: evenements.map((e) => ({
          evenementId: e.evenementId,
          sequence: e.sequence,
          type: e.type,
          horodatageLocal: e.horodatageLocal,
          utilisateurId: e.utilisateurId,
          corps: e.corps,
        })),
      },
      ip,
    );
    return r.data;
  }

  const statuts = (r: ReponseSynchro) => r.resultats.map((x) => x.statut);

  // ---------------------------------------------------------------- état

  const S = randomUUID();
  const S2 = randomUUID();
  const S3 = randomUUID();
  let F: string;
  let avant: Awaited<ReturnType<typeof etatJour>>;
  let venteAvant: { venteId: string };
  const regul: { venteId: string; numero: string }[] = [];

  it('1. avant la clôture, la caisse du poste compte pour sa journée', async () => {
    F = 'stk-rem-1';
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ('med-rem-1', 'Produit remontée', 'Test PB18d', false, now())`,
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "deconditionnable", "qualifie", "updatedAt") VALUES ($1, 'med-rem-1', $2, 0, false, 1000, 1, false, true, now())`,
      [F, PHARMACIE],
    );
    await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      {
        lignes: [{ stockId: F, nombreBoites: 50, dateExpiration: jour(300) }],
      },
      ip,
    );

    const vente = evVente(2, S, F, 2, '18:05');
    venteAvant = vente;
    const r = await envoyer([
      ev(1, 'SESSION_OUVERTE', { sessionId: S }, '18:00'),
      vente,
    ]);
    expect(statuts(r)).toEqual(['APPLIQUE', 'APPLIQUE']);
    expect((await lireSession(S)).jour).toBe(hier);
    const piece = await pieceDe(vente.venteId);
    expect(piece.typePiece).toBe('VENTE');
    expect(piece.jour).toBe(hier);
    const etat = await sql(
      `SELECT "dernierEtat" FROM "Poste" WHERE "id" = $1`,
      [D.id],
    );
    expect((etat.rows[0].dernierEtat as Record<string, unknown>).fileVide).toBe(
      true,
    );
  });

  it('2. clôture forcée de la veille sans le poste', async () => {
    const prep = await clotures.preparer(PHARMACIE, RESPONSABLE, hier);
    const attendu = prep.data.postesAttendus.find((p) => p.posteId === D.id);
    expect(attendu?.raison).toBe('SESSION_OUVERTE');
    const { data } = await clotures.cloturer(
      PHARMACIE,
      RESPONSABLE,
      {
        jour: hier,
        forcer: true,
        motifForcage: 'Coupure de réseau au comptoir',
      },
      ip,
    );
    expect(data.forcee).toBe(true);
    expect(data.postesManquants[0].sessionId).toBe(S);
    avant = await etatJour(hier);
    expect(avant.export).toContain(
      String((await pieceDe(venteAvant.venteId)).numero),
    );
  });

  it('3. CA21 : la remontée régularise sur la journée en cours sans toucher la veille', async () => {
    const stockAvant = await soldeProduit(F);
    const v1 = evVente(3, S, F, 1, '20:00');
    const v2 = evVente(4, S, F, 3, '21:30');
    const r = await envoyer([
      v1,
      v2,
      ev(
        5,
        'COMPTAGE_SAISI',
        {
          comptageId: randomUUID(),
          sessionId: S,
          moment: 'FERMETURE',
          coupures: coupures({ 1000: 6 }),
        },
        '22:00',
      ),
      ev(6, 'SESSION_FERMEE', { sessionId: S }, '22:00'),
    ]);
    expect(statuts(r)).toEqual([
      'APPLIQUE',
      'APPLIQUE',
      'APPLIQUE',
      'APPLIQUE',
    ]);

    for (const v of [v1, v2]) {
      const piece = await pieceDe(v.venteId);
      expect(piece.typePiece).toBe('REGULARISATION');
      expect(piece.jour).toBe(aujourdhui);
      expect(piece.origine).toBe(hier);
      expect(piece.sessionCaisseId).toBe(S);
      expect(piece.venteOrigineId).toBeNull();
      expect(piece.numero).toMatch(/^T\d+-\d{7}$/);
      expect(Number(piece.numeroTicket)).toBeGreaterThanOrEqual(D.debut);
      expect(Number(piece.numeroTicket)).toBeLessThanOrEqual(D.fin);
      regul.push({ venteId: v.venteId, numero: String(piece.numero) });

      const remontees = await anomalies('REMONTEE_APRES_CLOTURE', v.venteId);
      expect(remontees).toHaveLength(1);
      expect(remontees[0].attribueeAId).toBe(VENDEUR);
      expect(remontees[0].pieceType).toBe('VENTE');
      expect(remontees[0].details).toMatchObject({
        raison: 'JOURNEE_CLOTUREE',
        clotureId: avant.cloture?.id,
        jourOrigine: hier,
        jourRattachement: aujourdhui,
        posteManquantDeLaCloture: true,
        sessionId: S,
        message: `La vente ${String(piece.numero)} du ${jourLisible(hier)} est arrivée après la clôture de cette journée : elle est enregistrée sur la journée du ${jourLisible(aujourdhui)} (régularisation). La journée clôturée n'a pas changé.`,
      });
      expect(
        await compter(
          `SELECT count(*) AS n FROM "Paiement" WHERE "venteId" = $1 AND "sessionCaisseId" = $2`,
          [v.venteId, S],
        ),
      ).toBe(1);
      expect(
        await compter(
          `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineType" = 'VENTE' AND "pieceOrigineId" = $1 AND "evenementId" LIKE 'synchro:%'`,
          [v.venteId],
        ),
      ).toBeGreaterThan(0);
    }
    expect(await soldeProduit(F)).toBe(stockAvant - 4);

    const session = await lireSession(S);
    expect(session.statut).toBe('FERMEE');
    expect(session.clotureJournaliereId).toBeNull();
    const fermeture = await anomalies('REMONTEE_APRES_CLOTURE', S);
    expect(fermeture).toHaveLength(1);
    expect(fermeture[0].details.raison).toBe('CAISSE_FERMEE_APRES_CLOTURE');
    expect(fermeture[0].details.montantEncaisse).toBe(6000);
    expect(fermeture[0].attribueeAId).toBe(RESPONSABLE);

    // Seule la fermeture de la caisse du poste manquant change (OUVERTE vers FERMEE,
    // jamais incluse dans la clôture, D649) : pièces, clôture, totaux et export sont identiques.
    const apres = await etatJour(hier);
    // Seul le statut de S est neutralisé : toute autre caisse de la veille doit rester identique.
    const sansStatut = (e: typeof avant) =>
      e.sessions.map((x) =>
        x.id === S
          ? { id: x.id, clotureJournaliereId: x.clotureJournaliereId }
          : x,
      );
    expect(apres.sessions.find((x) => x.id === S)?.statut).toBe('FERMEE');
    expect({ ...apres, sessions: sansStatut(apres) }).toEqual({
      ...avant,
      sessions: sansStatut(avant),
    });
  });

  it('4. la journée en cours montre les régularisations', async () => {
    const liste = (await service.listerVentes(PHARMACIE, RESPONSABLE, {
      date: aujourdhui,
    })) as unknown as ReponseListe;
    const regularisations = liste.data.ventes.filter(
      (v) => v.typePiece === 'REGULARISATION',
    );
    expect(regularisations.map((v) => v.id).sort()).toEqual(
      regul.map((v) => v.venteId).sort(),
    );
    expect(regularisations.every((v) => v.total > 0)).toBe(true);
    expect(regularisations.reduce((somme, v) => somme + v.total, 0)).toBe(4000);
    // Le total du jour compte les régularisations (les pièces d'autres origines restent comptées aussi).
    expect(liste.data.totalJour).toBe(
      await compter(
        `SELECT coalesce(sum("total"), 0) AS n FROM "Vente" WHERE "structureId" = $1 AND "jourMetier" = $2::date AND "statut" = 'VALIDEE'`,
        [PHARMACIE, aujourdhui],
      ),
    );

    const e = await refus(
      service.annulerVente(PHARMACIE, regul[0].venteId, RESPONSABLE, {
        motif: 'Essai',
      }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('PIECE_NON_ANNULABLE');

    const veille = (await service.listerVentes(PHARMACIE, RESPONSABLE, {
      date: hier,
    })) as unknown as ReponseListe;
    expect(veille.data.ventes.map((v) => v.id)).toEqual([venteAvant.venteId]);
    expect(veille.data.totalJour).toBe(2000);
  });

  it('5. vente arrivée après la fermeture de sa caisse', async () => {
    const ouverture = await envoyer([
      ev(7, 'SESSION_OUVERTE', { sessionId: S2 }),
    ]);
    expect(statuts(ouverture)).toEqual(['APPLIQUE']);
    expect((await lireSession(S2)).jour).toBe(aujourdhui);
    await sessions.fermer(PHARMACIE, RESPONSABLE, S2, {
      comptageFermeture: { coupures: [] },
    });
    expect((await lireSession(S2)).statut).toBe('FERMEE');

    const vente = evVente(8, S2, F, 1);
    const r = await envoyer([
      vente,
      ev(9, 'SESSION_FERMEE', { sessionId: S2 }),
    ]);
    expect(statuts(r)).toEqual(['APPLIQUE', 'APPLIQUE']);
    expect(r.resultats[1].code).toBe('SESSION_DEJA_FERMEE');
    const piece = await pieceDe(vente.venteId);
    expect(piece.typePiece).toBe('REGULARISATION');
    expect(piece.jour).toBe(aujourdhui);
    expect(piece.origine).toBe(aujourdhui);
    expect(piece.sessionCaisseId).toBe(S2);
    const remontees = await anomalies('REMONTEE_APRES_CLOTURE', vente.venteId);
    expect(remontees).toHaveLength(1);
    expect(remontees[0].attribueeAId).toBe(VENDEUR);
    expect(remontees[0].details).toMatchObject({
      raison: 'CAISSE_FERMEE',
      clotureId: null,
      posteManquantDeLaCloture: false,
    });
  });

  it('6. caisse ouverte hors ligne sur une journée déjà clôturée', async () => {
    const vente = evVente(11, S3, F, 1, '22:05');
    const r = await envoyer([
      ev(10, 'SESSION_OUVERTE', { sessionId: S3 }, '22:00'),
      vente,
    ]);
    expect(statuts(r)).toEqual(['APPLIQUE', 'APPLIQUE']);
    const session = await lireSession(S3);
    expect(session.jour).toBe(aujourdhui);
    expect(session.origine).toBe(hier);
    const piece = await pieceDe(vente.venteId);
    expect(piece.typePiece).toBe('VENTE');
    expect(piece.jour).toBe(aujourdhui);
    expect(await anomalies('REMONTEE_APRES_CLOTURE', vente.venteId)).toEqual(
      [],
    );
    const fermeture = await envoyer([
      ev(12, 'SESSION_FERMEE', {
        sessionId: S3,
        comptageFermeture: {
          comptageId: randomUUID(),
          coupures: coupures({ 1000: 1 }),
        },
      }),
    ]);
    expect(statuts(fermeture)).toEqual(['APPLIQUE']);
    expect((await lireSession(S3)).statut).toBe('FERMEE');
  });

  it('7. clôture de la journée en cours et export', async () => {
    const prep = await clotures.preparer(PHARMACIE, RESPONSABLE, aujourdhui);
    expect(prep.data.postesAttendus.map((p) => p.posteId)).not.toContain(D.id);
    const { data } = await clotures.cloturer(
      PHARMACIE,
      RESPONSABLE,
      { jour: aujourdhui },
      ip,
    );
    expect(data.forcee).toBe(false);

    const contenu = (
      await clotures.exporter(PHARMACIE, RESPONSABLE, aujourdhui)
    ).contenu.toString('utf8');
    const lignes = contenu.split(/\r?\n/);
    for (const v of regul) {
      const concernees = lignes.filter((l) => l.includes(v.numero));
      expect(concernees.length).toBeGreaterThanOrEqual(2);
      expect(concernees[0]).toContain('Régularisation');
      expect(concernees.every((l) => l.endsWith(';Non'))).toBe(true);
    }
    const s3 = await sql(
      `SELECT v."numero" FROM "Vente" v WHERE v."sessionCaisseId" = $1`,
      [S3],
    );
    for (const ligne of s3.rows) {
      const numero = String(ligne.numero);
      const concernees = lignes.filter((l) => l.includes(numero));
      expect(concernees.length).toBeGreaterThanOrEqual(2);
      expect(concernees.every((l) => l.endsWith(';Oui'))).toBe(true);
    }

    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
