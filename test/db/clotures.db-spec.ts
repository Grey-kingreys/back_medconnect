import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import {
  exigerJourOuvert,
  jourDeRattachement,
  messageJourneeCloturee,
  verrouillerJourneesPartage,
} from 'src/pharmacie/caisse/journee';
import {
  ClotureService,
  messageCaissesAFermer,
  messageClotureIncomplete,
} from 'src/pharmacie/caisse/clotures.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { jourLisible, lendemain } from 'src/pharmacie/jour-metier';
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
const AUTRE = 'usr-admin-p2';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Clôture journalière sur base de test (PB17a)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let sessions: SessionsCaisseService;
  let postes: PointsDeVenteService;
  let clotures: ClotureService;
  let compteurPoste = 0;
  let compteurVente = 0;
  let pv1: string;

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

  function client(): PrismaService {
    if (!prisma) throw new Error('Prisma de test non créé.');
    return prisma;
  }

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
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

  async function venteSql(v: {
    id: string;
    sessionId: string;
    total: number;
  }): Promise<void> {
    compteurVente += 1;
    await sql(
      'INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece","venteOrigineId","motifAnnulation") SELECT $1,$2,s."pointDeVenteId",s."posteId",s."id",$4,$5,$6,\'Caissier (harnais)\',$7,s."jourMetier",$8::"TypePieceVente",$9,$10 FROM "SessionCaisse" s WHERE s."id" = $3',
      [
        v.id,
        PHARMACIE,
        v.sessionId,
        `V-ESSAI-${String(compteurVente).padStart(6, '0')}`,
        9000 + compteurVente,
        VENDEUR,
        v.total,
        'VENTE',
        null,
        null,
      ],
    );
  }

  async function paiementSql(
    id: string,
    venteId: string,
    sessionId: string,
    codeMode: string,
    montant: number,
  ): Promise<void> {
    await sql(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant") SELECT $1,$2,$3,m."id",$5 FROM "ModePaiement" m WHERE m."code" = $4',
      [id, venteId, sessionId, codeMode, montant],
    );
  }

  /** Vente SQL payée en un seul mode. */
  async function venteEncaissee(
    sessionId: string,
    montant: number,
    mode = 'ESPECES',
  ): Promise<string> {
    const id = `vte-essai-${randomUUID()}`;
    await venteSql({ id, sessionId, total: montant });
    await paiementSql(`pai-${id}`, id, sessionId, mode, montant);
    return id;
  }

  /** Session insérée à la main, au jour métier donné (OUVERTE ou FERMEE). */
  async function sessionSql(s: {
    posteId: string;
    jourMetier: string;
    statut: 'OUVERTE' | 'FERMEE';
    utilisateurId?: string;
    utilisateurNom?: string;
  }): Promise<string> {
    const id = `ses-essai-${randomUUID()}`;
    await sql(
      'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","jourMetier","ouverteLe","evenementOuvertureId") VALUES ($1,$2,$3,$4,$5,$6::date,$6::date + time \'08:00\',$1)',
      [
        id,
        pv1,
        s.posteId,
        s.utilisateurId ?? VENDEUR,
        s.utilisateurNom ?? 'Mamadou Diallo',
        s.jourMetier,
      ],
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

  const preparer = (j: string) => clotures.preparer(PHARMACIE, RESPONSABLE, j);
  const cloturer = (dto: {
    jour: string;
    forcer?: boolean;
    motifForcage?: string;
  }) => clotures.cloturer(PHARMACIE, RESPONSABLE, dto, '127.0.0.1');

  const lignesCloture = (j: string) =>
    compter(
      'SELECT count(*) AS n FROM "ClotureJournaliere" WHERE "jourMetier" = $1::date',
      [j],
    );

  const champs = (corps: Record<string, unknown>) =>
    (corps.champs ?? []) as { champ: string; contraintes: string[] }[];

  let clotureTrois = '';
  let sessionTrois = '';
  let posteDesktop = '';
  let sessionDesktop = '';
  let sessionWeb = '';

  it('1. journée vide : rien à attendre, clôturable, non forçable', async () => {
    const { data } = await preparer(jour(-20));
    expect(data.cloture).toBeNull();
    expect(data.sessions).toEqual([]);
    expect(data.postesAttendus).toEqual([]);
    expect(data.totaux).toEqual([]);
    expect(data.peutCloturer).toBe(true);
    expect(data.peutForcer).toBe(false);
  });

  it('2. jours refusés : avant la caisse, futur, inexistant', async () => {
    const avant = await refus(preparer(jour(-31)));
    expect(avant.statut).toBe(400);
    expect(avant.corps.code).toBe('JOUR_AVANT_DEBUT_CAISSE');
    expect(String(avant.corps.message)).toContain(jourLisible(jour(-30)));

    const futur = await refus(preparer(jour(1)));
    expect(futur.statut).toBe(400);
    expect(futur.corps.code).toBe('VALIDATION');
    expect(champs(futur.corps)[0].contraintes).toEqual(['jourFutur']);

    const inexistant = await refus(preparer('2026-02-30'));
    expect(inexistant.statut).toBe(400);
    expect(champs(inexistant.corps)[0].contraintes).toEqual(['dateValide']);

    const viaCloture = [
      await refus(cloturer({ jour: jour(-31) })),
      await refus(cloturer({ jour: jour(1) })),
      await refus(cloturer({ jour: '2026-02-30' })),
    ];
    expect(viaCloture.map((e) => e.statut)).toEqual([400, 400, 400]);
    expect(viaCloture[0].corps.code).toBe('JOUR_AVANT_DEBUT_CAISSE');
    expect(champs(viaCloture[1].corps)[0].contraintes).toEqual(['jourFutur']);
    expect(champs(viaCloture[2].corps)[0].contraintes).toEqual(['dateValide']);
    expect(
      await compter('SELECT count(*) AS n FROM "ClotureJournaliere"'),
    ).toBe(0);
  });

  it('3. clôture complète d’aujourd’hui : caisses incluses, totaux figés, audit', async () => {
    const poste = await nouveauPoste();
    const session = await ouvrirSession(poste, VENDEUR, { 20000: 5 });
    sessionTrois = session.id;
    await venteEncaissee(session.id, 200000);
    await venteEncaissee(session.id, 50000, 'ORANGE_MONEY');
    await sessions.fermer(PHARMACIE, VENDEUR, session.id, {
      comptageFermeture: {
        montantEspeces: 290000,
        releves: [{ mode: 'ORANGE_MONEY', montant: 50000 }],
      },
      commentaire: 'Billet de 10 000 manquant',
    });

    const prep = (await preparer(jour(0))).data;
    expect(prep.sessions.map((s) => [s.id, s.statut])).toEqual([
      [session.id, 'FERMEE'],
    ]);
    expect(prep.postesAttendus).toEqual([]);
    expect(prep.peutCloturer).toBe(true);
    expect(prep.totaux.find((t) => t.mode === 'ESPECES')).toMatchObject({
      theorique: 300000,
      compte: 290000,
      ecart: -10000,
      sessionsNonRapprochees: 0,
    });
    expect(prep.totaux.find((t) => t.mode === 'ORANGE_MONEY')).toMatchObject({
      theorique: 50000,
      compte: 50000,
      ecart: 0,
      sessionsNonRapprochees: 0,
    });

    const { data, message } = await cloturer({ jour: jour(0) });
    clotureTrois = data.id;
    const jl = jourLisible(jour(0));
    expect(message).toBe(`Journée du ${jl} clôturée.`);
    expect(data.forcee).toBe(false);
    expect(data.motifForcage).toBeNull();
    expect(data.postesManquants).toEqual([]);
    expect(data.nombreSessions).toBe(1);
    expect(data.clotureParNom).toBe('Fatoumata Camara');
    expect(data.totaux).toEqual(
      prep.totaux.map((t) => ({
        mode: t.mode,
        libelle: t.libelle,
        theorique: t.theorique,
        compte: t.compte,
        ecart: t.ecart,
      })),
    );

    const s = (
      await sql(
        'SELECT "statut", "clotureJournaliereId" FROM "SessionCaisse" WHERE "id" = $1',
        [session.id],
      )
    ).rows[0];
    expect(s.statut).toBe('INCLUSE_DANS_CLOTURE');
    expect(s.clotureJournaliereId).toBe(data.id);
    const lignes = await sql(
      'SELECT m."code", t."theorique", t."compte", t."ecart" FROM "TotalClotureMode" t JOIN "ModePaiement" m ON m."id" = t."modePaiementId" WHERE t."clotureId" = $1 ORDER BY m."ordre"',
      [data.id],
    );
    expect(
      lignes.rows.map((l) => ({
        mode: l.code,
        theorique: l.theorique,
        compte: l.compte,
        ecart: l.ecart,
      })),
    ).toEqual(
      data.totaux.map((t) => ({
        mode: t.mode,
        theorique: t.theorique,
        compte: t.compte,
        ecart: t.ecart,
      })),
    );
    const audit = await sql(
      'SELECT "metadata" FROM "AuditLog" WHERE "action" = \'create\' AND "entityType" = \'ClotureJournaliere\' AND "entityId" = $1',
      [data.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({
      jour: jour(0),
      forcee: false,
      nombreSessions: 1,
      postesManquants: [],
    });
  });

  it('4. préparation d’une journée clôturée', async () => {
    const { data } = await preparer(jour(0));
    expect(data.cloture?.id).toBe(clotureTrois);
    expect(data.peutCloturer).toBe(false);
    expect(data.peutForcer).toBe(false);
    expect(data.postesAttendus).toEqual([]);
    expect(data.totaux.find((t) => t.mode === 'ESPECES')).toMatchObject({
      theorique: 300000,
      compte: 290000,
      ecart: -10000,
    });
    expect(data.totaux.find((t) => t.mode === 'ORANGE_MONEY')).toMatchObject({
      theorique: 50000,
      compte: 50000,
      ecart: 0,
    });
    expect(data.sessions.map((s) => s.id)).toEqual([sessionTrois]);
  });

  it('5. journée déjà clôturée : 409, une seule clôture', async () => {
    const e = await refus(cloturer({ jour: jour(0) }));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('JOURNEE_DEJA_CLOTUREE');
    expect(e.corps.message).toBe(
      `La journée du ${jourLisible(jour(0))} est déjà clôturée.`,
    );
    expect(await lignesCloture(jour(0))).toBe(1);
  });

  it('6. aide de journée : rattachement et refus', async () => {
    expect(await jourDeRattachement(client(), pv1, new Date())).toEqual({
      jour: lendemain(jour(0)),
      jourReel: jour(0),
    });
    const e = await refus(exigerJourOuvert(client(), pv1, jour(0)));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('JOURNEE_CLOTUREE');
    expect(e.corps.message).toBe(messageJourneeCloturee(jour(0)));
    await expect(
      exigerJourOuvert(client(), pv1, jour(-5)),
    ).resolves.toBeUndefined();
    expect(
      await jourDeRattachement(
        client(),
        pv1,
        new Date(Date.now() - 86_400_000),
      ),
    ).toEqual({ jour: jour(-1), jourReel: jour(-1) });
  });

  it('7. clôture incomplète : poste desktop avec caisse ouverte', async () => {
    posteDesktop = await nouveauPoste(RESPONSABLE, PHARMACIE, 'DESKTOP');
    sessionDesktop = await sessionSql({
      posteId: posteDesktop,
      jourMetier: jour(-5),
      statut: 'OUVERTE',
    });
    const posteWeb = await nouveauPoste();
    sessionWeb = await sessionSql({
      posteId: posteWeb,
      jourMetier: jour(-5),
      statut: 'FERMEE',
    });
    await resultatSql(sessionWeb, 'ESPECES', 80000, 80000);

    const { data } = await preparer(jour(-5));
    expect(data.postesAttendus).toHaveLength(1);
    expect(data.postesAttendus[0]).toMatchObject({
      posteId: posteDesktop,
      type: 'DESKTOP',
      raison: 'SESSION_OUVERTE',
      sessionId: sessionDesktop,
      utilisateurNom: 'Mamadou Diallo',
    });
    expect(data.peutCloturer).toBe(false);
    expect(data.peutForcer).toBe(true);
    expect(data.sessionsOuvertes).toHaveLength(1);

    const e = await refus(cloturer({ jour: jour(-5) }));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('CLOTURE_INCOMPLETE');
    // Message lisible par le titulaire : libellé du poste et vendeur, sans code technique seul (D627).
    const libelleDesktop = data.postesAttendus[0].libelle;
    expect(e.corps.message).toBe(
      messageClotureIncomplete(jour(-5), data.postesAttendus),
    );
    expect(e.corps.message).toBe(
      `La journée du ${jourLisible(jour(-5))} ne peut pas encore être clôturée. Poste à attendre : ${libelleDesktop} (caisse de Mamadou Diallo).`,
    );
    const details = e.corps.details as { raison: string }[];
    expect(details).toHaveLength(1);
    expect(details[0].raison).toBe('SESSION_OUVERTE');
    expect(await lignesCloture(jour(-5))).toBe(0);
    expect(
      (
        await sql('SELECT "statut" FROM "SessionCaisse" WHERE "id" = $1', [
          sessionWeb,
        ])
      ).rows[0].statut,
    ).toBe('FERMEE');
  });

  it('8. forcer sans motif : 400 MOTIF_REQUIS, rien écrit', async () => {
    for (const motifForcage of [undefined, '  a ']) {
      const e = await refus(
        cloturer({ jour: jour(-5), forcer: true, motifForcage }),
      );
      expect(e.statut).toBe(400);
      expect(e.corps.code).toBe('MOTIF_REQUIS');
    }
    expect(await lignesCloture(jour(-5))).toBe(0);
  });

  it('9. CA21 : clôture forcée qui enregistre le poste manquant', async () => {
    const { data, message } = await cloturer({
      jour: jour(-5),
      forcer: true,
      motifForcage: 'Poste D en panne',
    });
    const poste = (
      await sql('SELECT "code", "libelle" FROM "Poste" WHERE "id" = $1', [
        posteDesktop,
      ])
    ).rows[0];
    expect(data.forcee).toBe(true);
    expect(data.motifForcage).toBe('Poste D en panne');
    expect(data.postesManquants).toEqual([
      {
        posteId: posteDesktop,
        posteCode: poste.code,
        libelle: poste.libelle,
        type: 'DESKTOP',
        raison: 'SESSION_OUVERTE',
        sessionId: sessionDesktop,
        utilisateurNom: 'Mamadou Diallo',
        dernierContactLe: null,
      },
    ]);
    expect(message).toContain(
      `clôturée sans 1 poste(s) : ${String(poste.libelle)} (caisse de Mamadou Diallo).`,
    );
    expect(data.nombreSessions).toBe(1);

    const desktop = (
      await sql(
        'SELECT "statut", "clotureJournaliereId" FROM "SessionCaisse" WHERE "id" = $1',
        [sessionDesktop],
      )
    ).rows[0];
    expect(desktop.statut).toBe('OUVERTE');
    expect(desktop.clotureJournaliereId).toBeNull();
    expect(
      (
        await sql('SELECT "statut" FROM "SessionCaisse" WHERE "id" = $1', [
          sessionWeb,
        ])
      ).rows[0].statut,
    ).toBe('INCLUSE_DANS_CLOTURE');
    const totaux = await sql(
      'SELECT m."code", t."theorique", t."compte", t."ecart" FROM "TotalClotureMode" t JOIN "ModePaiement" m ON m."id" = t."modePaiementId" WHERE t."clotureId" = $1',
      [data.id],
    );
    expect(totaux.rows).toEqual([
      { code: 'ESPECES', theorique: 80000, compte: 80000, ecart: 0 },
    ]);
    const audit = await sql(
      'SELECT "metadata" FROM "AuditLog" WHERE "entityType" = \'ClotureJournaliere\' AND "entityId" = $1',
      [data.id],
    );
    const metadata = audit.rows[0].metadata as Record<string, unknown>;
    expect(metadata.postesManquants).toEqual([poste.code]);
    expect(Object.keys(metadata).some((k) => /motif/i.test(k))).toBe(false);
  });

  it('10. une caisse web ouverte bloque même en forçant', async () => {
    const posteWeb = await nouveauPoste();
    await sessionSql({
      posteId: posteWeb,
      jourMetier: jour(-6),
      statut: 'OUVERTE',
    });
    const { data } = await preparer(jour(-6));
    expect(data.peutForcer).toBe(false);
    expect(data.postesAttendus[0].type).toBe('WEB');

    const sans = await refus(cloturer({ jour: jour(-6) }));
    expect(sans.statut).toBe(409);
    expect(sans.corps.code).toBe('CLOTURE_INCOMPLETE');

    const forcee = await refus(
      cloturer({ jour: jour(-6), forcer: true, motifForcage: 'Vendeur parti' }),
    );
    expect(forcee.statut).toBe(409);
    expect(forcee.corps.code).toBe('CAISSES_A_FERMER');
    expect(forcee.corps.message).toBe(
      messageCaissesAFermer(
        data.postesAttendus.map((a) => ({
          posteId: a.posteId,
          posteCode: a.posteCode,
          libelle: a.libelle,
          type: a.type,
          raison: a.raison,
          sessionId: a.sessionId,
          utilisateurNom: a.utilisateurNom,
          dernierContactLe: a.dernierContactLe,
        })),
      ),
    );
    expect(String(forcee.corps.message)).toContain('Mamadou Diallo (');
    expect(await lignesCloture(jour(-6))).toBe(0);
  });

  it('11. forcer sans poste attendu : clôture normale, motif non gardé', async () => {
    const { data, message } = await cloturer({
      jour: jour(-7),
      forcer: true,
      motifForcage: 'Par précaution',
    });
    expect(data.forcee).toBe(false);
    expect(data.motifForcage).toBeNull();
    expect(message).toBe(
      `Journée du ${jourLisible(jour(-7))} clôturée. Aucun poste n'était attendu : la clôture n'a pas eu besoin d'être forcée.`,
    );
  });

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

  it('12. deux clôtures simultanées, attente d’une écriture en cours, liste', async () => {
    const res = await Promise.allSettled([
      cloturer({ jour: jour(-8) }),
      cloturer({ jour: jour(-8) }),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejet = res.find((r) => r.status === 'rejected');
    expect(rejet).toBeDefined();
    const e = await refus(
      Promise.reject((rejet as PromiseRejectedResult).reason as Error),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('JOURNEE_DEJA_CLOTUREE');
    expect(await lignesCloture(jour(-8))).toBe(1);

    let signaler: () => void = () => undefined;
    const tenu = new Promise<void>((r) => (signaler = r));
    let liberer: () => void = () => undefined;
    const libere = new Promise<void>((r) => (liberer = r));
    const fin = client().$transaction(
      async (tx) => {
        await verrouillerJourneesPartage(tx, PHARMACIE);
        signaler();
        await libere;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    await tenu;
    let resolue = false;
    const attente = cloturer({ jour: jour(-9) }).then((r) => {
      resolue = true;
      return r;
    });
    try {
      await attendreAttentes(1);
      await new Promise((r) => setTimeout(r, 200));
      expect(resolue).toBe(false);
    } finally {
      liberer();
      await fin;
    }
    const { data } = await attente;
    expect(data.jour).toBe(jour(-9));
    expect(await lignesCloture(jour(-9))).toBe(1);

    const mois = await clotures.lister(PHARMACIE, RESPONSABLE, {
      mois: jour(0).slice(0, 7),
    });
    expect(mois.data.clotures.map((c) => c.id)).toContain(clotureTrois);
    const jours = mois.data.clotures.map((c) => c.jour);
    expect(jours).toEqual([...jours].sort());
    const autreMois = await clotures.lister(PHARMACIE, RESPONSABLE, {
      mois: jour(-8).slice(0, 7),
    });
    expect(autreMois.data.clotures.map((c) => c.jour)).toContain(jour(-8));
    const interdit = await refus(clotures.lister(PHARMACIE, AUTRE, {}));
    expect(interdit.statut).toBe(403);
  });

  it('13. règles des postes attendus en base', async () => {
    const d2 = await nouveauPoste(RESPONSABLE, PHARMACIE, 'DESKTOP');
    await sql(
      'UPDATE "Poste" SET "dernierEtat" = \'{"fileVide": false}\', "dernierContactLe" = now() - interval \'1 day\' WHERE "id" = $1',
      [d2],
    );
    const attendus = async () =>
      (await preparer(jour(-12))).data.postesAttendus;
    expect((await attendus()).find((a) => a.posteId === d2)?.raison).toBe(
      'FILE_NON_VIDE',
    );

    const d3 = await nouveauPoste(RESPONSABLE, PHARMACIE, 'DESKTOP');
    const sessionD3 = await sessionSql({
      posteId: d3,
      jourMetier: jour(-14),
      statut: 'FERMEE',
    });
    await venteSql({
      id: `vte-essai-${randomUUID()}`,
      sessionId: sessionD3,
      total: 1000,
    });
    expect((await attendus()).find((a) => a.posteId === d3)?.raison).toBe(
      'SYNCHRO_INCOMPLETE',
    );

    await sql(
      'UPDATE "Poste" SET "dernierContactLe" = now(), "dernierEtat" = \'{"fileVide": true}\' WHERE "id" = $1',
      [d3],
    );
    expect((await attendus()).some((a) => a.posteId === d3)).toBe(false);

    await sql('UPDATE "Poste" SET "actif" = false WHERE "id" = $1', [d2]);
    expect((await attendus()).some((a) => a.posteId === d2)).toBe(false);

    // La session technique de reprise n'apparaît dans aucune préparation (D517).
    // Son jour est celui de la reprise : l'assertion n'a lieu que s'il est clôturable.
    const technique = (
      await sql(
        'SELECT "id", to_char("jourMetier", \'YYYY-MM-DD\') AS "j" FROM "SessionCaisse" WHERE "technique" AND "pointDeVenteId" = $1',
        [pv1],
      )
    ).rows[0];
    if (technique) {
      const j = technique.j as string;
      if (j >= jour(-30) && j <= jour(0)) {
        const { data } = await preparer(j);
        expect(data.sessions.some((s) => s.id === technique.id)).toBe(false);
      }
    }
  });
});
