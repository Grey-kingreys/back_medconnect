import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import {
  ClotureService,
  messageJourneeNonCloturee,
} from 'src/pharmacie/caisse/clotures.service';
import { ENTETES_EXPORT_CLOTURE } from 'src/pharmacie/caisse/export-cloture';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { MOTIF_CLE_COUT } from 'src/pharmacie/masquer-couts';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
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

const BOM = '\u{FEFF}';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("Export CSV d'une journée clôturée sur base de test (PB17b)", () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let sessions: SessionsCaisseService;
  let postes: PointsDeVenteService;
  let clotures: ClotureService;
  let compteurPoste = 0;
  let compteurVente = 0;
  let pv1: string;
  let texteExporte = '';

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await base.client.query(
      'UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval \'30 days\' WHERE "structureId" = \'str-pharma-1\'',
    );
    prisma = creerPrismaDeTest(base);
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          ['usr-admin-p1', 'usr-admin-p2'].includes(id)
            ? ['caisse:utiliser', 'caisse:superviser', 'cloture:gerer']
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    postes = new PointsDeVenteService(prisma, acces);
    clotures = new ClotureService(prisma, acces);
    const res = await base.client.query<{ id: string }>(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [PHARMACIE],
    );
    pv1 = res.rows[0].id;
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

  async function nouveauPoste(
    utilisateur = VENDEUR,
    structure = PHARMACIE,
    type: 'WEB' | 'DESKTOP' = 'WEB',
  ): Promise<string> {
    compteurPoste += 1;
    const { data } = await postes.enregistrerPoste(structure, utilisateur, {
      type,
      appareilId: `appareil-essai-${compteurPoste}-${randomUUID().slice(0, 8)}`,
    });
    return data.id;
  }

  const coupures = (montants: Record<number, number>) =>
    Object.entries(montants).map(([valeur, nombre]) => ({
      valeurFaciale: Number(valeur),
      nombre,
    }));

  async function ouvrirSession(
    posteId: string,
    utilisateur = VENDEUR,
    montants?: Record<number, number>,
  ) {
    const { data } = await sessions.ouvrir(PHARMACIE, utilisateur, {
      posteId,
      comptage: montants ? { coupures: coupures(montants) } : undefined,
    });
    return data;
  }

  /** Pièce insérée à la main ; renvoie son numéro. */
  async function venteSql(v: {
    id: string;
    sessionId: string;
    total: number;
    typePiece?: string;
    origine?: string;
    motif?: string;
    clientNom?: string;
    clientTelephone?: string;
  }): Promise<string> {
    compteurVente += 1;
    const numero = `V-ESSAI-${String(compteurVente).padStart(6, '0')}`;
    await sql(
      'INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece","venteOrigineId","motifAnnulation","clientNom","clientTelephone") SELECT $1,$2,s."pointDeVenteId",s."posteId",s."id",$4,$5,$6,\'Caissier (harnais)\',$7,s."jourMetier",$8::"TypePieceVente",$9,$10,$11,$12 FROM "SessionCaisse" s WHERE s."id" = $3',
      [
        v.id,
        PHARMACIE,
        v.sessionId,
        numero,
        9000 + compteurVente,
        VENDEUR,
        v.total,
        v.typePiece ?? 'VENTE',
        v.origine ?? null,
        v.motif ?? null,
        v.clientNom ?? null,
        v.clientTelephone ?? null,
      ],
    );
    return numero;
  }

  async function paiementSql(
    id: string,
    venteId: string,
    sessionId: string,
    codeMode: string,
    montant: number,
    reference?: string,
  ): Promise<void> {
    await sql(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant","referenceExterne") SELECT $1,$2,$3,m."id",$5,$6 FROM "ModePaiement" m WHERE m."code" = $4',
      [id, venteId, sessionId, codeMode, montant, reference ?? null],
    );
  }

  /** Vente SQL payée en un seul mode ; renvoie son identifiant et son numéro. */
  async function venteEncaissee(
    sessionId: string,
    montant: number,
    mode = 'ESPECES',
  ): Promise<{ id: string; numero: string }> {
    const id = `vte-essai-${randomUUID()}`;
    const numero = await venteSql({ id, sessionId, total: montant });
    await paiementSql(`pai-${id}`, id, sessionId, mode, montant);
    return { id, numero };
  }

  /** Session insérée à la main, au jour métier donné (OUVERTE ou FERMEE). */
  async function sessionSql(s: {
    posteId: string;
    jourMetier: string;
    statut: 'OUVERTE' | 'FERMEE';
  }): Promise<string> {
    const id = `ses-essai-${randomUUID()}`;
    await sql(
      'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","jourMetier","ouverteLe","evenementOuvertureId") VALUES ($1,$2,$3,$4,$5,$6::date,$6::date + time \'08:00\',$1)',
      [id, pv1, s.posteId, VENDEUR, 'Mamadou Diallo', s.jourMetier],
    );
    if (s.statut === 'FERMEE') {
      await sql(
        'UPDATE "SessionCaisse" SET "statut" = \'FERMEE\', "fermeeLe" = "ouverteLe" + interval \'10 hours\', "evenementFermetureId" = \'fermeture:\' || "id" WHERE "id" = $1',
        [id],
      );
    }
    return id;
  }

  async function resultatSql(
    sessionId: string,
    codeMode: string,
    theorique: number,
    compte: number | null,
  ): Promise<void> {
    await sql(
      'INSERT INTO "ResultatSessionMode" ("id","sessionCaisseId","modePaiementId","theorique","compte","ecart") SELECT $1,$2,m."id",$4,$5,CASE WHEN $5::int IS NULL THEN NULL ELSE $5::int - $4::int END FROM "ModePaiement" m WHERE m."code" = $3',
      [`res-essai-${randomUUID()}`, sessionId, codeMode, theorique, compte],
    );
  }

  const exporter = (j: string) => clotures.exporter(PHARMACIE, RESPONSABLE, j);

  /** Lignes du fichier (sans la dernière, vide), chacune découpée par point-virgule. */
  const lire = (contenu: Buffer): string[][] => {
    const lignes = contenu.toString('utf8').split('\r\n');
    lignes.pop();
    return lignes.map((l) => l.split(';'));
  };

  it('1. une journée non clôturée ne s’exporte pas', async () => {
    const e = await refus(exporter(jour(-3)));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('JOURNEE_NON_CLOTUREE');
    expect(e.corps.message).toBe(messageJourneeNonCloturee(jour(-3)));

    const futur = await refus(exporter(jour(1)));
    expect(futur.statut).toBe(400);
    expect(futur.corps.code).toBe('VALIDATION');
    const champs = (futur.corps.champs ?? []) as {
      champ: string;
      contraintes: string[];
    }[];
    expect(champs[0].contraintes).toEqual(['jourFutur']);
  });

  it('2. export d’une journée clôturée : pièces, paiements et mouvement de caisse', async () => {
    const poste = await nouveauPoste();
    const session = await ouvrirSession(poste, VENDEUR, { 20000: 5 });
    const v1 = await venteEncaissee(session.id, 200000);

    const v2Id = `vte-essai-${randomUUID()}`;
    await venteSql({
      id: v2Id,
      sessionId: session.id,
      total: 50000,
      clientNom: 'Aissatou Sow',
      clientTelephone: '+224620000000',
    });
    await paiementSql(`pai-a-${v2Id}`, v2Id, session.id, 'ESPECES', 30000);
    await paiementSql(
      `pai-b-${v2Id}`,
      v2Id,
      session.id,
      'ORANGE_MONEY',
      20000,
      'OM-123',
    );

    await sessions.enregistrerMouvement(PHARMACIE, VENDEUR, session.id, {
      type: 'PRELEVEMENT',
      montant: 100000,
      motif: 'Dépôt au coffre',
    });

    const annulationId = `vte-essai-${randomUUID()}`;
    await venteSql({
      id: annulationId,
      sessionId: session.id,
      total: -200000,
      typePiece: 'ANNULATION',
      origine: v1.id,
      motif: 'Erreur de saisie',
    });
    await paiementSql(
      `pai-${annulationId}`,
      annulationId,
      session.id,
      'ESPECES',
      -200000,
    );

    // Théorique espèces : 100 000 + 200 000 + 30 000 - 200 000 - 100 000 = 30 000.
    await sessions.fermer(PHARMACIE, VENDEUR, session.id, {
      comptageFermeture: {
        montantEspeces: 30000,
        releves: [{ mode: 'ORANGE_MONEY', montant: 20000 }],
      },
    });
    await clotures.cloturer(
      PHARMACIE,
      RESPONSABLE,
      { jour: jour(0) },
      '127.0.0.1',
    );

    const { nomFichier, contenu } = await exporter(jour(0));
    texteExporte = contenu.toString('utf8');
    expect(nomFichier).toBe(`cloture-${jour(0)}.csv`);
    expect(texteExporte.startsWith(BOM)).toBe(true);

    const lignes = lire(contenu);
    expect(lignes[0].join(';')).toBe(BOM + ENTETES_EXPORT_CLOTURE.join(';'));
    const corps = lignes.slice(1);
    const pieces = corps.filter((l) => l[1] === 'Pièce');
    const paiements = corps.filter((l) => l[1] === 'Paiement');
    const mouvements = corps.filter((l) => l[1] === 'Mouvement de caisse');
    expect([pieces.length, paiements.length, mouvements.length]).toEqual([
      3, 4, 1,
    ]);
    expect(mouvements[0][10]).toBe('-100000');
    expect(mouvements[0][11]).toBe('Dépôt au coffre');

    const annulation = pieces.find((l) => l[3] === 'Annulation');
    expect(annulation?.[4]).toBe(v1.numero);
    expect(annulation?.[11]).toBe('Erreur de saisie');

    const orange = paiements.find((l) => l[8] === 'Orange Money');
    expect(orange?.[9]).toBe('OM-123');

    expect(corps.every((l) => l[12] === 'Oui')).toBe(true);

    const somme = (l: string[][]) =>
      l.reduce((total, ligne) => total + Number(ligne[10]), 0);
    expect(somme(paiements)).toBe(50000);
    expect(somme(pieces)).toBe(50000);
  });

  it('3. le fichier ne contient ni donnée de client ni coût', () => {
    expect(texteExporte).not.toBe('');
    expect(texteExporte).not.toContain('Aissatou');
    expect(texteExporte).not.toContain('620000000');
    expect(MOTIF_CLE_COUT.test(texteExporte)).toBe(false);
  });

  it('4. caisse desktop restée ouverte et session technique', async () => {
    const posteDesktop = await nouveauPoste(RESPONSABLE, PHARMACIE, 'DESKTOP');
    const sessionDesktop = await sessionSql({
      posteId: posteDesktop,
      jourMetier: jour(-5),
      statut: 'OUVERTE',
    });
    const pieceDesktop = await venteEncaissee(sessionDesktop, 7000);

    const posteWeb = await nouveauPoste();
    const sessionWeb = await sessionSql({
      posteId: posteWeb,
      jourMetier: jour(-5),
      statut: 'FERMEE',
    });
    await resultatSql(sessionWeb, 'ESPECES', 9000, 9000);
    const pieceWeb = await venteEncaissee(sessionWeb, 9000);

    // Session technique au jour exporté (D517), sur le poste REPRISE comme celle de la reprise :
    // le trigger session_caisse_proteger accepte l'insertion d'une session technique sur le poste
    // technique, sans contournement. Une pièce de 3 333 et un mouvement de 4 444 y sont rattachés.
    const reprise = (
      await sql(
        'SELECT "id" FROM "Poste" WHERE "pointDeVenteId" = $1 AND "code" = \'REPRISE\' AND "type" = \'TECHNIQUE\'',
        [pv1],
      )
    ).rows[0].id as string;
    const sessionTechnique = `ses-essai-${randomUUID()}`;
    await sql(
      'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","statut","technique","jourMetier","ouverteLe","fermeeLe","evenementOuvertureId") VALUES ($1,$2,$3,NULL,\'Reprise historique\',\'FERMEE\',true,$4::date,$4::date + time \'08:00\',$4::date + time \'18:00\',$1)',
      [sessionTechnique, pv1, reprise, jour(-5)],
    );
    const pieceTechnique = await venteEncaissee(sessionTechnique, 3333);
    await sql(
      'INSERT INTO "MouvementCaisse" ("id","sessionCaisseId","pointDeVenteId","type","modePaiementId","montant","motif","auteurId","horodatageServeur","evenementId") SELECT $1,$2,$3,\'APPORT\',m."id",4444,\'Mouvement technique\',$4,$5::date + time \'09:00\',$1 FROM "ModePaiement" m WHERE m."code" = \'ESPECES\'',
      [`mvt-essai-${randomUUID()}`, sessionTechnique, pv1, VENDEUR, jour(-5)],
    );
    const techniquesDuJour = (
      await sql(
        'SELECT (SELECT count(*)::int FROM "Vente" v WHERE v."sessionCaisseId" = $1 AND v."jourMetier" = $2::date) AS "pieces", (SELECT count(*)::int FROM "MouvementCaisse" m WHERE m."sessionCaisseId" = $1) AS "mouvements"',
        [sessionTechnique, jour(-5)],
      )
    ).rows[0];
    expect(techniquesDuJour).toEqual({ pieces: 1, mouvements: 1 });

    await clotures.cloturer(
      PHARMACIE,
      RESPONSABLE,
      {
        jour: jour(-5),
        forcer: true,
        motifForcage: 'Poste desktop en panne',
      },
      '127.0.0.1',
    );

    const { contenu } = await exporter(jour(-5));
    const corps = lire(contenu).slice(1);
    const dePiece = (numero: string) => corps.filter((l) => l[2] === numero);
    expect(dePiece(pieceDesktop.numero).map((l) => l[12])).toEqual([
      'Non',
      'Non',
    ]);
    expect(dePiece(pieceWeb.numero).map((l) => l[12])).toEqual(['Oui', 'Oui']);

    // Ni la pièce ni le mouvement de la session technique n'apparaissent (D517) ;
    // seules les deux pièces non techniques et leurs paiements figurent.
    expect(dePiece(pieceTechnique.numero)).toEqual([]);
    expect(corps.some((l) => l[10] === '3333' || l[10] === '4444')).toBe(false);
    expect(corps.some((l) => l[11] === 'Mouvement technique')).toBe(false);
    expect(corps.filter((l) => l[1] === 'Mouvement de caisse')).toEqual([]);
    expect(corps).toHaveLength(4);
  });
});
