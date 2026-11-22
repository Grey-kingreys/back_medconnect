import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { AnomaliesService } from 'src/pharmacie/anomalies/anomalies.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { CreditService } from 'src/pharmacie/credit/credit.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { CatalogueSynchroService } from 'src/pharmacie/synchro/catalogue-synchro.service';
import {
  SynchroService,
  type ResultatEvenement,
} from 'src/pharmacie/synchro/synchro.service';
import type { StorageService } from 'src/storage/storage.service';
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
/** Sans credit:write ni reception:write dans ce test. */
const VENDEUR = 'usr-pharm-p1';
/** A credit:write, reception:write et caisse:utiliser dans ce test. */
const RESPONSABLE = 'usr-admin-p1';

const NOM_CLIENT = 'Fatoumata Barry Secrète';
const TELEPHONE_CLIENT = '+224 622 33 44 55';

describe('Synchro desktop : cahier de crédit hors ligne, sur base de test', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let catalogue: CatalogueSynchroService;
  let credit: CreditService;
  let D: string;
  let sequence = 0;
  let secours = 0;
  let stockId: string;
  let S1: string;

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
                'caisse:utiliser',
                'caisse:superviser',
                'reception:write',
                'credit:read',
                'credit:write',
              ]
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    const receptions = new ReceptionsService(
      prisma,
      acces,
      mouvements,
      permissions,
    );
    synchro = new SynchroService(
      prisma,
      acces,
      mouvements,
      sessions,
      permissions,
      receptions,
    );
    credit = new CreditService(prisma, acces, sessions);
    catalogue = new CatalogueSynchroService(
      prisma,
      acces,
      {
        getPublicUrl: (cle: string) => `logo/${cle}`,
      } as unknown as StorageService,
      new AnomaliesService(prisma, acces),
      permissions,
    );
    D = (
      await new PointsDeVenteService(prisma, acces).enregistrerPoste(
        PHARMACIE,
        RESPONSABLE,
        { type: 'DESKTOP', appareilId: 'desktop-credit-hors-ligne' },
      )
    ).data.id;

    // Une fiche avec un lot (coût d'achat saisi) : les ventes ne sont pas provisoires.
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ('med-ch-1', 'Paracétamol crédit', 'Test crédit hors ligne', false, now())`,
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ('stk-ch-1', 'med-ch-1', $1, 0, false, 1000, 10, true, now())`,
      [PHARMACIE],
    );
    stockId = 'stk-ch-1';
    S1 = randomUUID();
    expect((await envoyer('SESSION_OUVERTE', { sessionId: S1 })).statut).toBe(
      'APPLIQUE',
    );
    const rec = await envoyer('RECEPTION_ENREGISTREE', {
      id: randomUUID(),
      recueLe: new Date().toISOString(),
      lignes: [
        {
          stockId,
          lotId: randomUUID(),
          coefficientLocal: 10,
          nombreBoites: 50,
          dateExpiration: new Date(Date.now() + 300 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          numeroLot: 'LC1',
          coutAchatBoite: 777,
        },
      ],
    });
    expect(rec.statut).toBe('APPLIQUE');
  });

  afterAll(async () => {
    try {
      if (prisma) await fermerPrismaDeTest(prisma);
    } finally {
      if (base) await supprimerBaseDeTest(base);
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function envoyer(
    type: string,
    corps: Record<string, unknown>,
    o: {
      utilisateurId?: string;
      evenementId?: string;
      horodatage?: string;
    } = {},
  ): Promise<ResultatEvenement> {
    const r = await synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: D,
        etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' },
        evenements: [
          {
            evenementId: o.evenementId ?? randomUUID(),
            sequence: ++sequence,
            type,
            horodatageLocal: o.horodatage ?? new Date().toISOString(),
            utilisateurId: o.utilisateurId ?? RESPONSABLE,
            corps,
          },
        ],
      },
      '127.0.0.1',
    );
    return r.data.resultats[0];
  }

  const creerClient = (id = randomUUID(), plus: Record<string, unknown> = {}) =>
    envoyer('CLIENT_CREDIT_CREE', {
      id,
      nomComplet: NOM_CLIENT,
      telephone: TELEPHONE_CLIENT,
      ...plus,
    }).then((r) => ({ id, r }));

  function corpsVente(
    sessionId: string,
    plus: Record<string, unknown> = {},
    nombre = 2,
  ) {
    return {
      venteId: randomUUID(),
      sessionId,
      numeroSecours: ++secours,
      lignes: [{ stockId, unite: 'BOITE', nombre, prixUnitaire: 1000 }],
      paiements: [{ mode: 'CREDIT', montant: nombre * 1000 }],
      total: nombre * 1000,
      ordonnanceVerifiee: true,
      ...plus,
    };
  }

  async function reste(clientId: string) {
    const f = await credit.detail(PHARMACIE, RESPONSABLE, clientId);
    return f.data;
  }

  async function anomalies(type: string, pieceId: string) {
    const r = await sql(
      `SELECT "details", "attribueeAId" FROM "Anomalie" WHERE "type"::text = $1 AND "pieceId" = $2`,
      [type, pieceId],
    );
    return r.rows as {
      details: Record<string, unknown>;
      attribueeAId: string;
    }[];
  }

  async function compter(table: string, id: string): Promise<number> {
    const r = await sql(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "id" = $1`,
      [id],
    );
    return Number(r.rows[0].n);
  }

  async function refus<T>(
    promesse: Promise<T>,
  ): Promise<Record<string, unknown>> {
    try {
      await promesse;
    } catch (erreur) {
      if (erreur instanceof HttpException) {
        return erreur.getResponse() as Record<string, unknown>;
      }
      throw erreur;
    }
    throw new Error('Un refus était attendu.');
  }

  it('1. client créé par le poste (identifiant du poste), puis vente à crédit avec date limite, idempotentes', async () => {
    const { id, r } = await creerClient();
    expect(r.statut).toBe('APPLIQUE');
    expect(r.piece).toEqual({ type: 'CLIENT_CREDIT', id });
    const lu = await sql(
      `SELECT "nomComplet", "telephone", "structureId" FROM "ClientCredit" WHERE "id" = $1`,
      [id],
    );
    expect(lu.rows[0]).toEqual({
      nomComplet: NOM_CLIENT,
      telephone: TELEPHONE_CLIENT,
      structureId: PHARMACIE,
    });
    // Même client sous un autre événement : rien de plus
    const rejeu = await envoyer('CLIENT_CREDIT_CREE', {
      id,
      nomComplet: NOM_CLIENT,
    });
    expect(rejeu.statut).toBe('DEJA_APPLIQUE');
    expect(await compter('ClientCredit', id)).toBe(1);

    const corps = corpsVente(S1, {
      clientCreditId: id,
      dateLimiteCredit: '2020-01-15',
    });
    const v = await envoyer('VENTE', corps);
    expect(v.statut).toBe('APPLIQUE');
    expect(v.piece?.type).toBe('VENTE');
    const vente = await sql(
      `SELECT "clientCreditId", "clientNom", "total", "typePiece"::text AS "typePiece" FROM "Vente" WHERE "id" = $1`,
      [corps.venteId],
    );
    expect(vente.rows[0]).toEqual({
      clientCreditId: id,
      clientNom: NOM_CLIENT,
      total: 2000,
      typePiece: 'VENTE',
    });
    const paiement = await sql(
      `SELECT m."code", p."montant" FROM "Paiement" p JOIN "ModePaiement" m ON m."id" = p."modePaiementId" WHERE p."venteId" = $1`,
      [corps.venteId],
    );
    expect(paiement.rows).toEqual([{ code: 'CREDIT', montant: 2000 }]);
    // Une date limite passée n'est jamais refusée au rejeu
    const echeance = await sql(
      `SELECT to_char("dateLimite", 'YYYY-MM-DD') AS "d" FROM "EcheanceCredit" WHERE "venteId" = $1`,
      [corps.venteId],
    );
    expect(echeance.rows[0].d).toBe('2020-01-15');
    const fiche = await reste(id);
    expect(fiche.resteAPayer).toBe(2000);
    expect(fiche.statut).toBe('EN_RETARD');

    // Même vente rejouée sous un autre événement : identifiant déjà utilisé, rien de plus
    const doublon = await envoyer('VENTE', {
      ...corps,
      numeroSecours: ++secours,
    });
    expect(doublon.statut).toBe('REJETE');
    expect(doublon.code).toBe('IDENTIFIANT_DEJA_UTILISE');
    expect((await reste(id)).resteAPayer).toBe(2000);
  });

  it('2. vente avec nouveau client intégré : le client garde l’identifiant du poste, le rejeu ne le duplique pas', async () => {
    const clientId = randomUUID();
    const corps = corpsVente(S1, {
      nouveauClientCredit: { id: clientId, nomComplet: NOM_CLIENT },
    });
    const v = await envoyer('VENTE', corps);
    expect(v.statut).toBe('APPLIQUE');
    expect(await compter('ClientCredit', clientId)).toBe(1);
    const suite = corpsVente(S1, {
      nouveauClientCredit: { id: clientId, nomComplet: NOM_CLIENT },
    });
    expect((await envoyer('VENTE', suite)).statut).toBe('APPLIQUE');
    expect(await compter('ClientCredit', clientId)).toBe(1);
    expect((await reste(clientId)).resteAPayer).toBe(4000);
  });

  it('3. rejets : client inconnu, droit manquant, paiements incohérents, date limite sans crédit', async () => {
    const inconnu = await envoyer(
      'VENTE',
      corpsVente(S1, { clientCreditId: randomUUID() }),
    );
    expect(inconnu.statut).toBe('REJETE');
    expect(inconnu.code).toBe('CLIENT_CREDIT_INTROUVABLE');

    const { id } = await creerClient();
    const sansDroit = await envoyer(
      'VENTE',
      corpsVente(S1, { clientCreditId: id }),
      { utilisateurId: VENDEUR },
    );
    expect(sansDroit.statut).toBe('REJETE');
    expect(sansDroit.code).toBe('PERMISSION_INSUFFISANTE');

    const incoherent = await envoyer(
      'VENTE',
      corpsVente(S1, {
        clientCreditId: id,
        paiements: [
          { mode: 'CREDIT', montant: 1000 },
          { mode: 'ESPECES', montant: 1000 },
        ],
      }),
    );
    expect(incoherent.statut).toBe('REJETE');
    expect(incoherent.code).toBe('EVENEMENT_INVALIDE');

    const sansClient = await envoyer('VENTE', corpsVente(S1));
    expect(sansClient.statut).toBe('REJETE');
    expect(sansClient.code).toBe('EVENEMENT_INVALIDE');

    const dateSeule = await envoyer('VENTE', {
      ...corpsVente(S1),
      paiements: [{ mode: 'ESPECES', montant: 2000 }],
      dateLimiteCredit: '2030-01-01',
    });
    expect(dateSeule.statut).toBe('REJETE');
    expect(dateSeule.code).toBe('EVENEMENT_INVALIDE');
    expect((await reste(id)).resteAPayer).toBe(0);
  });

  it('4. client modifié : champ par champ, rien à changer = déjà appliqué, client inconnu rejeté', async () => {
    const { id } = await creerClient();
    const m = await envoyer('CLIENT_CREDIT_MODIFIE', {
      id,
      champs: { nomComplet: 'Fatoumata Barry', telephone: null },
    });
    expect(m.statut).toBe('APPLIQUE');
    const lu = await sql(
      `SELECT "nomComplet", "telephone" FROM "ClientCredit" WHERE "id" = $1`,
      [id],
    );
    expect(lu.rows[0]).toEqual({
      nomComplet: 'Fatoumata Barry',
      telephone: null,
    });
    const encore = await envoyer('CLIENT_CREDIT_MODIFIE', {
      id,
      champs: { nomComplet: 'Fatoumata Barry' },
    });
    expect(encore.statut).toBe('DEJA_APPLIQUE');
    const inconnu = await envoyer('CLIENT_CREDIT_MODIFIE', {
      id: randomUUID(),
      champs: { note: 'x' },
    });
    expect(inconnu.statut).toBe('REJETE');
    expect(inconnu.code).toBe('CLIENT_CREDIT_INTROUVABLE');
    const audit = await sql(
      `SELECT "metadata"::text AS "m" FROM "AuditLog" WHERE "entityType" = 'ClientCredit' AND "entityId" = $1`,
      [id],
    );
    expect(audit.rows.map((x) => x.m).join('')).not.toContain('Barry');
  });

  it('5. remboursement : partiel, idempotent par identifiant, versé dans la caisse de l’événement', async () => {
    const { id } = await creerClient();
    await envoyer('VENTE', corpsVente(S1, { clientCreditId: id }, 5));
    expect((await reste(id)).resteAPayer).toBe(5000);

    const sansVerser = {
      id: randomUUID(),
      clientId: id,
      montant: 1000,
      verseEnCaisse: false,
    };
    const r1 = await envoyer('REMBOURSEMENT_CREDIT', sansVerser);
    expect(r1.statut).toBe('APPLIQUE');
    expect(r1.piece).toEqual({
      type: 'REMBOURSEMENT_CREDIT',
      id: sansVerser.id,
    });
    expect((await reste(id)).resteAPayer).toBe(4000);
    // Même identifiant sous un autre événement : rien de plus
    const r1bis = await envoyer('REMBOURSEMENT_CREDIT', sansVerser);
    expect(r1bis.statut).toBe('DEJA_APPLIQUE');
    expect(await compter('RemboursementCredit', sansVerser.id)).toBe(1);
    expect((await reste(id)).resteAPayer).toBe(4000);

    const verse = {
      id: randomUUID(),
      clientId: id,
      montant: 1500,
      note: 'en espèces',
      verseEnCaisse: true,
      sessionId: S1,
    };
    expect((await envoyer('REMBOURSEMENT_CREDIT', verse)).statut).toBe(
      'APPLIQUE',
    );
    const mouvement = await sql(
      `SELECT "type"::text AS "type", "montant", "sessionCaisseId" FROM "MouvementCaisse" WHERE "id" = $1`,
      [verse.id],
    );
    expect(mouvement.rows).toEqual([
      { type: 'APPORT', montant: 1500, sessionCaisseId: S1 },
    ]);
    const lie = await sql(
      `SELECT "verseEnCaisse", "mouvementCaisseId" FROM "RemboursementCredit" WHERE "id" = $1`,
      [verse.id],
    );
    expect(lie.rows[0]).toEqual({
      verseEnCaisse: true,
      mouvementCaisseId: verse.id,
    });
    expect((await reste(id)).resteAPayer).toBe(2500);
    // Rejeu du versé : toujours un seul mouvement
    expect((await envoyer('REMBOURSEMENT_CREDIT', verse)).statut).toBe(
      'DEJA_APPLIQUE',
    );
    expect(await compter('MouvementCaisse', verse.id)).toBe(1);

    // Versé sans caisse indiquée : corps illisible
    const sansCaisse = await envoyer('REMBOURSEMENT_CREDIT', {
      id: randomUUID(),
      clientId: id,
      montant: 100,
      verseEnCaisse: true,
    });
    expect(sansCaisse.statut).toBe('REJETE');
    expect(sansCaisse.code).toBe('EVENEMENT_INVALIDE');
    const inconnu = await envoyer('REMBOURSEMENT_CREDIT', {
      id: randomUUID(),
      clientId: randomUUID(),
      montant: 100,
      verseEnCaisse: false,
    });
    expect(inconnu.code).toBe('CLIENT_CREDIT_INTROUVABLE');
    const sansDroit = await envoyer(
      'REMBOURSEMENT_CREDIT',
      { id: randomUUID(), clientId: id, montant: 100, verseEnCaisse: false },
      { utilisateurId: VENDEUR },
    );
    expect(sansDroit.code).toBe('PERMISSION_INSUFFISANTE');
    expect((await reste(id)).resteAPayer).toBe(2500);
  });

  it('6. remboursement supérieur au reste : accepté en entier, CREDIT_TROP_PERCU sans nom ni téléphone, crédit soldé', async () => {
    const { id } = await creerClient();
    await envoyer('VENTE', corpsVente(S1, { clientCreditId: id }, 3));
    const premier = {
      id: randomUUID(),
      clientId: id,
      montant: 2000,
      verseEnCaisse: false,
    };
    await envoyer('REMBOURSEMENT_CREDIT', premier);
    // Un second poste a encaissé 2 500 alors qu'il ne restait que 1 000
    const trop = {
      id: randomUUID(),
      clientId: id,
      montant: 2500,
      verseEnCaisse: true,
      sessionId: S1,
    };
    const r = await envoyer('REMBOURSEMENT_CREDIT', trop);
    expect(r.statut).toBe('APPLIQUE');
    expect(r.anomalies?.map((a) => a.type)).toEqual(['CREDIT_TROP_PERCU']);
    const lignes = await anomalies('CREDIT_TROP_PERCU', trop.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].details).toMatchObject({
      clientCreditId: id,
      montant: 2500,
      resteAvant: 1000,
      tropPercu: 1500,
    });
    const texte = JSON.stringify(lignes[0].details);
    expect(texte).not.toContain('Barry');
    expect(texte).not.toContain('622');
    // L'argent est entré dans la caisse en entier
    const mvt = await sql(
      `SELECT "montant" FROM "MouvementCaisse" WHERE "id" = $1`,
      [trop.id],
    );
    expect(mvt.rows[0].montant).toBe(2500);
    const fiche = await reste(id);
    expect(fiche.resteAPayer).toBe(0);
    expect(fiche.statut).toBe('SOLDE');
    expect(fiche.totalRembourse).toBe(4500);
    // Un client déjà soldé reçoit encore un remboursement : tout est trop-perçu
    const surSolde = {
      id: randomUUID(),
      clientId: id,
      montant: 700,
      verseEnCaisse: false,
    };
    const r2 = await envoyer('REMBOURSEMENT_CREDIT', surSolde);
    expect(r2.statut).toBe('APPLIQUE');
    const l2 = await anomalies('CREDIT_TROP_PERCU', surSolde.id);
    expect(l2[0].details).toMatchObject({ resteAvant: 0, tropPercu: 700 });
    // Rejeu : pas de seconde anomalie
    await envoyer('REMBOURSEMENT_CREDIT', surSolde);
    expect(await anomalies('CREDIT_TROP_PERCU', surSolde.id)).toHaveLength(1);
  });

  it('7. la route web garde son refus MONTANT_SUPERIEUR_AU_RESTE et CREDIT_DEJA_SOLDE', async () => {
    const { id } = await creerClient();
    await envoyer('VENTE', corpsVente(S1, { clientCreditId: id }, 1));
    const trop = await refus(
      credit.enregistrerRemboursement(PHARMACIE, RESPONSABLE, id, {
        montant: 1001,
      }),
    );
    expect(trop.code).toBe('MONTANT_SUPERIEUR_AU_RESTE');
    await credit.enregistrerRemboursement(PHARMACIE, RESPONSABLE, id, {
      montant: 1000,
    });
    const solde = await refus(
      credit.enregistrerRemboursement(PHARMACIE, RESPONSABLE, id, {
        montant: 1,
      }),
    );
    expect(solde.code).toBe('CREDIT_DEJA_SOLDE');
  });

  it('8. remboursement versé dans une caisse fermée ou inconnue : accepté sans mouvement, anomalie au responsable', async () => {
    const { id } = await creerClient();
    await envoyer('VENTE', corpsVente(S1, { clientCreditId: id }, 4));
    // La caisse du poste est fermée, puis un remboursement y est versé
    expect((await envoyer('SESSION_FERMEE', { sessionId: S1 })).statut).toBe(
      'APPLIQUE',
    );
    const fermee = {
      id: randomUUID(),
      clientId: id,
      montant: 1200,
      verseEnCaisse: true,
      sessionId: S1,
    };
    const r = await envoyer('REMBOURSEMENT_CREDIT', fermee);
    expect(r.statut).toBe('APPLIQUE');
    expect(await compter('MouvementCaisse', fermee.id)).toBe(0);
    const ligne = await sql(
      `SELECT "verseEnCaisse", "mouvementCaisseId" FROM "RemboursementCredit" WHERE "id" = $1`,
      [fermee.id],
    );
    expect(ligne.rows[0]).toEqual({
      verseEnCaisse: false,
      mouvementCaisseId: null,
    });
    const remontees = await anomalies('REMONTEE_APRES_CLOTURE', fermee.id);
    expect(remontees).toHaveLength(1);
    expect(remontees[0].details.raison).toBe(
      'REMBOURSEMENT_CREDIT_CAISSE_FERMEE',
    );
    expect(JSON.stringify(remontees[0].details)).not.toContain('Barry');
    expect((await reste(id)).resteAPayer).toBe(2800);

    const inconnue = {
      id: randomUUID(),
      clientId: id,
      montant: 300,
      verseEnCaisse: true,
      sessionId: randomUUID(),
    };
    expect((await envoyer('REMBOURSEMENT_CREDIT', inconnue)).statut).toBe(
      'APPLIQUE',
    );
    expect(
      (await anomalies('REMONTEE_APRES_CLOTURE', inconnue.id))[0].details
        .raison,
    ).toBe('REMBOURSEMENT_CREDIT_CAISSE_INCONNUE');
    expect((await reste(id)).resteAPayer).toBe(2500);
  });

  it('9. prise remontée après la fermeture de sa caisse (régularisation) : elle compte dans le reste', async () => {
    const { id } = await creerClient();
    // S1 est fermée (test 8)
    const v = await envoyer('VENTE', corpsVente(S1, { clientCreditId: id }, 2));
    expect(v.statut).toBe('APPLIQUE');
    expect(v.piece?.type).toBe('REGULARISATION');
    expect((await reste(id)).resteAPayer).toBe(2000);
  });

  it('10. date limite : posée, retirée, idempotente ; prise soldée, annulée ou inconnue rejetée', async () => {
    const { id } = await creerClient();
    const corps = corpsVente(S1, { clientCreditId: id }, 3);
    await envoyer('VENTE', corps);
    const pose = await envoyer('DATE_LIMITE_MODIFIEE', {
      venteId: corps.venteId,
      dateLimite: '2027-03-31',
    });
    expect(pose.statut).toBe('APPLIQUE');
    expect(pose.piece).toEqual({ type: 'ECHEANCE_CREDIT', id: corps.venteId });
    expect(
      (await reste(id)).prises.find((p) => p.venteId === corps.venteId)
        ?.dateLimite,
    ).toBe('2027-03-31');
    expect(
      (
        await envoyer('DATE_LIMITE_MODIFIEE', {
          venteId: corps.venteId,
          dateLimite: '2027-03-31',
        })
      ).statut,
    ).toBe('DEJA_APPLIQUE');
    // Une date passée n'est pas refusée au rejeu
    expect(
      (
        await envoyer('DATE_LIMITE_MODIFIEE', {
          venteId: corps.venteId,
          dateLimite: '2020-02-02',
        })
      ).statut,
    ).toBe('APPLIQUE');
    expect(
      (
        await envoyer('DATE_LIMITE_MODIFIEE', {
          venteId: corps.venteId,
          dateLimite: null,
        })
      ).statut,
    ).toBe('APPLIQUE');
    expect(
      (
        await sql(`SELECT 1 FROM "EcheanceCredit" WHERE "venteId" = $1`, [
          corps.venteId,
        ])
      ).rows,
    ).toHaveLength(0);
    const inconnue = await envoyer('DATE_LIMITE_MODIFIEE', {
      venteId: randomUUID(),
      dateLimite: null,
    });
    expect(inconnue.code).toBe('PRISE_INTROUVABLE');
    // Prise soldée
    await envoyer('REMBOURSEMENT_CREDIT', {
      id: randomUUID(),
      clientId: id,
      montant: 3000,
      verseEnCaisse: false,
    });
    const soldee = await envoyer('DATE_LIMITE_MODIFIEE', {
      venteId: corps.venteId,
      dateLimite: '2027-04-01',
    });
    expect(soldee.statut).toBe('REJETE');
    expect(soldee.code).toBe('PRISE_SOLDEE');
  });

  it('11. photographie : clients, prises et remboursements, jamais de coût, stable, sans le statut EN_RETARD', async () => {
    const a = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
    const b = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
    expect(JSON.stringify(a.clientsCredit)).toBe(
      JSON.stringify(b.clientsCredit),
    );
    expect(a.clientsCredit.length).toBeGreaterThan(3);
    const ids = a.clientsCredit.map((c) => c.id);
    expect([...ids].sort()).toEqual(ids);
    const avecPrise = a.clientsCredit.find((c) => c.prises.length > 0);
    expect(avecPrise).toBeDefined();
    const prise = avecPrise?.prises[0];
    const ligne = prise?.lignes[0];
    expect(Object.keys(ligne ?? {}).sort()).toEqual([
      'nomMedicament',
      'nombreAffiche',
      'sousTotal',
      'uniteAffichee',
    ]);
    expect(ligne?.nomMedicament).toBe('Paracétamol crédit');
    expect(ligne?.uniteAffichee).toBe('BOITE');
    expect(typeof ligne?.nombreAffiche).toBe('number');
    expect(typeof ligne?.sousTotal).toBe('number');
    for (const c of a.clientsCredit) {
      expect(['EN_COURS', 'SOLDE']).toContain(c.statut);
      const f = await reste(c.id);
      expect(c.resteAPayer).toBe(f.resteAPayer);
    }
    const json = JSON.stringify(a.clientsCredit);
    expect(json).not.toMatch(/"\w*(cout|marge|achat)\w*":/i);
    expect(
      a.clientsCredit.some((c) => c.remboursements.some((r) => r.montant > 0)),
    ).toBe(true);
  });

  it("12. photographie : sans credit:read, aucun client de crédit (nom et téléphone) n'est envoyé", async () => {
    const sans = await catalogue.photographier(PHARMACIE, VENDEUR, D);
    expect(sans.clientsCredit).toEqual([]);
    const avec = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
    expect(avec.clientsCredit.length).toBeGreaterThan(0);
    const sansService = new CatalogueSynchroService(
      prisma,
      new AccesPharmacieService(prisma),
      {
        getPublicUrl: (cle: string) => `logo/${cle}`,
      } as unknown as StorageService,
      new AnomaliesService(prisma, new AccesPharmacieService(prisma)),
    );
    expect(
      (await sansService.photographier(PHARMACIE, RESPONSABLE, D))
        .clientsCredit,
    ).toEqual([]);
  });

  it('13. taille de la part crédit de la photographie (mesure)', async () => {
    const a = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
    const octets = Buffer.byteLength(JSON.stringify(a.clientsCredit));
    console.info(
      `clientsCredit : ${a.clientsCredit.length} clients, ${octets} octets`,
    );
    expect(octets).toBeGreaterThan(0);
  });
});
