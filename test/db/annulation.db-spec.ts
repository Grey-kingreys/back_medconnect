import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import {
  assurerPoste,
  PointsDeVenteService,
} from 'src/pharmacie/points-de-vente.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
import {
  MESSAGE_PIECE_NON_ANNULABLE,
  MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE,
  VenteService,
} from 'src/pharmacie/vente.service';
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
import { rejeuParDefaut } from './rejeu-provisoire';

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

interface AllocationRep {
  lotId: string | null;
  numeroLot: string | null;
  dateExpiration: string | null;
  quantite: number;
  statut: string;
  sortieManuelle: boolean;
  motif: string | null;
  lotTechnique: boolean;
  coutUnitaire?: number;
}
interface LigneRep {
  id: string;
  stockId: string;
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
  uniteAffichee: string;
  nombreAffiche: number;
  coefficientApplique: number;
  allocations: AllocationRep[];
}
interface PaiementRep {
  id: string;
  mode: string;
  libelle: string;
  montant: number;
  reference: string | null;
  montantRecu: number | null;
  rendu: number | null;
}
interface VenteRep {
  id: string;
  numero: string;
  numeroTicket: number;
  typePiece: string;
  provisoire: boolean;
  annulation: {
    id: string;
    numero: string;
    motif: string;
    le: Date;
    par: { id: string; nom: string };
  } | null;
  annuleeLe: string | Date | null;
  annuleeParId: string | null;
  motifAnnulation: string | null;
  motif: string | null;
  venteOrigine: { id: string; numero: string } | null;
  jourMetier: string;
  statut: string;
  total: number;
  ordonnanceVerifiee: boolean;
  rejeu?: boolean;
  poste: { id: string; code: string };
  session: { id: string; ouverteAutomatiquement: boolean };
  paiements: PaiementRep[];
  lignes: LigneRep[];
}
interface Reponse {
  data: VenteRep;
  message: string;
  success: boolean;
}
interface ElementListe {
  id: string;
  numero: string;
  statut: string;
  total: number;
  nombreArticles: number;
  typePiece: string;
  numeroTicket: number | null;
  jourMetier: string;
  venteOrigine: { id: string; numero: string } | null;
  annulation: { id: string; numero: string } | null;
}
interface ReponseListe {
  data: {
    nombre: number;
    totalJour: number;
    ventes: ElementListe[];
  };
  message: string;
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Annulation par pièce inverse et jour métier, sur base de test (PB12)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let sessions: SessionsCaisseService;
  let postes: PointsDeVenteService;
  let mouvements: MouvementsStockService;
  let venteParRejeu: ReturnType<typeof rejeuParDefaut>;
  let pv1: string;
  let compteurFiche = 0;
  const alertes = jest.fn().mockResolvedValue(undefined);

  const jour = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    const notifications = {
      createManyNotifications: alertes,
    } as unknown as NotificationsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          id === RESPONSABLE
            ? [
                'vente:write',
                'caisse:utiliser',
                'caisse:superviser',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    mouvements = new MouvementsStockService();
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    service = new VenteService(
      prisma,
      notifications,
      stockage,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    postes = new PointsDeVenteService(prisma, acces);
    venteParRejeu = rejeuParDefaut({
      synchro: new SynchroService(prisma, acces, mouvements, sessions),
      postes,
      structureId: PHARMACIE,
      vendeurId: VENDEUR,
      responsableId: RESPONSABLE,
      appareilId: 'desktop-annul-1',
    });
    const pvs = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [PHARMACIE],
    );
    pv1 = String(pvs.rows[0].id);
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

  async function nouvelleFiche(
    o: {
      coef?: number;
      prixBoite?: number | null;
      prixUnite?: number | null;
      decond?: boolean;
    } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit annulation ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB12', false, now())`,
      [`med-annul-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "prixUnite", "coefficientBoite", "deconditionnable", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, $6, $7, now())`,
      [
        `stk-annul-${n}`,
        `med-annul-${n}`,
        PHARMACIE,
        o.prixBoite === undefined ? 1000 : o.prixBoite,
        o.prixUnite ?? null,
        o.coef ?? 1,
        o.decond ?? false,
      ],
    );
    return { stockId: `stk-annul-${n}`, nom };
  }

  async function nouveauLot(
    stockId: string,
    o: {
      quantite: number;
      coef?: number;
      exp?: string | null;
      cout?: number;
      numero?: string | null;
    },
  ): Promise<string> {
    const exp = o.exp === undefined ? jour(200) : o.exp;
    const { lot } = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: o.numero ?? null,
        dateExpiration: exp ? jourVersDate(exp) : null,
        quantite: o.quantite,
        coutUnitaire: o.cout ?? 0,
        coutAchatBoite: null,
        coefficientReception: o.coef ?? 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: false,
        auteurId: RESPONSABLE,
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: null,
        motif: null,
      }),
    );
    return lot.id;
  }

  async function vendre(
    dto: CreerVenteDto,
    utilisateur = VENDEUR,
    cle?: string,
  ): Promise<Reponse> {
    return (await service.creerVente(
      PHARMACIE,
      utilisateur,
      dto,
      cle,
      '127.0.0.1',
    )) as unknown as Reponse;
  }

  async function annuler(
    venteId: string,
    utilisateur = VENDEUR,
    o: { motif?: string; posteId?: string } = {},
  ): Promise<Reponse> {
    return (await service.annulerVente(
      PHARMACIE,
      venteId,
      utilisateur,
      {
        motif: o.motif ?? 'Erreur de quantité',
        ...(o.posteId ? { posteId: o.posteId } : {}),
      },
      '127.0.0.1',
    )) as unknown as Reponse;
  }

  async function piecesDe(origineId: string) {
    return (
      await sql(
        `SELECT "id", "numero", "typePiece"::text AS "typePiece", "total", "numeroTicket", "sessionCaisseId", "posteId", "pointDeVenteId", "vendeurId", "vendeurNom", "motifAnnulation", "statut"::text AS "statut", "jourMetierOrigine", to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "Vente" WHERE "venteOrigineId" = $1`,
        [origineId],
      )
    ).rows;
  }

  const theorique = async (
    utilisateur: string,
    sessionId: string,
    mode: string,
  ) =>
    (
      await sessions.bilan(PHARMACIE, utilisateur, sessionId)
    ).data.theorique.find((t) => t.mode === mode)?.montant ?? 0;

  async function soldeProduit(stockId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1 AND "pointDeVenteId" = $2',
      [stockId, pv1],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  async function soldeLot(lotId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  async function prochainNumero(): Promise<number> {
    const res = await sql(
      'SELECT "prochainNumero" FROM "CompteurTicket" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
    return Number(res.rows[0].prochainNumero);
  }

  const nombreVentes = () =>
    compter('SELECT count(*) AS n FROM "Vente" WHERE "structureId" = $1', [
      PHARMACIE,
    ]);
  const nombreSessions = (utilisateur?: string) =>
    utilisateur
      ? compter(
          'SELECT count(*) AS n FROM "SessionCaisse" WHERE "utilisateurId" = $1',
          [utilisateur],
        )
      : compter(
          'SELECT count(*) AS n FROM "SessionCaisse" WHERE "pointDeVenteId" = $1',
          [pv1],
        );
  const mouvementsDePiece = (pieceId: string) =>
    sql(
      `SELECT "type"::text AS "type", "quantite", "lotId", "motif", "auteurId", "posteId" FROM "MouvementStock" WHERE "pieceOrigineType" = 'ANNULATION' AND "pieceOrigineId" = $1 ORDER BY "quantite" DESC, "lotId"`,
      [pieceId],
    );

  let origine1: Reponse;
  let pieceId1: string;
  let lot1: string;

  it('1. pièce inverse dans la même session', async () => {
    const { data: poste } = await postes.enregistrerPoste(PHARMACIE, VENDEUR, {
      type: 'WEB',
      appareilId: 'appareil-pb12-a',
    });
    const { stockId } = await nouvelleFiche({ prixBoite: 2000 });
    const lotId = await nouveauLot(stockId, { quantite: 10, cout: 300 });
    lot1 = lotId;
    origine1 = await vendre({
      lignes: [{ stockId, quantite: 3 }],
      posteId: poste.id,
    });
    const origine = origine1.data;
    expect(origine.total).toBe(6000);
    const avant = await prochainNumero();

    const { data, message } = await annuler(origine.id, VENDEUR, {
      posteId: poste.id,
    });

    expect(message).toBe(
      `Vente ${origine.numero} annulée (A-${origine.numero}). Les quantités ont été remises en stock et le remboursement est enregistré dans votre caisse.`,
    );
    expect(data.id).toBe(origine.id);
    expect(data.statut).toBe('ANNULEE');
    expect(data.annuleeParId).toBe(VENDEUR);
    expect(data.motifAnnulation).toBe('Erreur de quantité');
    expect(data.annuleeLe).not.toBeNull();
    expect(data.motif).toBeNull();
    expect(data.venteOrigine).toBeNull();
    expect(data.annulation).toMatchObject({
      numero: 'A-' + origine.numero,
      motif: 'Erreur de quantité',
      par: { id: VENDEUR },
    });
    expect(data.annulation?.le).toEqual(data.annuleeLe);
    expect(cheminsCout(data)).toEqual([]);

    const pieces = await piecesDe(origine.id);
    expect(pieces).toHaveLength(1);
    const piece = pieces[0];
    pieceId1 = String(piece.id);
    const sessionJour = await sql(
      `SELECT to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "SessionCaisse" WHERE "id" = $1`,
      [origine.session.id],
    );
    expect(piece).toMatchObject({
      typePiece: 'ANNULATION',
      total: -6000,
      numero: 'A-' + origine.numero,
      numeroTicket: null,
      sessionCaisseId: origine.session.id,
      posteId: poste.id,
      pointDeVenteId: pv1,
      vendeurId: VENDEUR,
      motifAnnulation: 'Erreur de quantité',
      statut: 'VALIDEE',
      jourMetierOrigine: null,
      jour: sessionJour.rows[0].jour,
    });
    expect(data.annulation?.par.nom).toBe(piece.vendeurNom);

    const lignes = await sql(
      `SELECT "quantite", "nombreAffiche", "sousTotal", "prixUnitaire", "coefficientApplique", "uniteAffichee"::text AS "uniteAffichee" FROM "LigneVente" WHERE "venteId" = $1`,
      [pieceId1],
    );
    expect(lignes.rows).toEqual([
      {
        quantite: -3,
        nombreAffiche: -3,
        sousTotal: -6000,
        prixUnitaire: 2000,
        coefficientApplique: 1,
        uniteAffichee: 'BOITE',
      },
    ]);
    const allocations = await sql(
      `SELECT a."lotId", a."quantite", a."statut"::text AS "statut", a."coutUnitaire", a."sortieManuelle", a."motif", a."auteurId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1`,
      [pieceId1],
    );
    expect(allocations.rows).toEqual([
      {
        lotId,
        quantite: -3,
        statut: 'DEFINITIVE',
        coutUnitaire: 300,
        sortieManuelle: false,
        motif: null,
        auteurId: VENDEUR,
      },
    ]);
    const paiements = await sql(
      `SELECT m."code" AS "mode", p."montant", p."referenceExterne", p."montantRecu", p."sessionCaisseId" FROM "Paiement" p JOIN "ModePaiement" m ON m."id" = p."modePaiementId" WHERE p."venteId" = $1`,
      [pieceId1],
    );
    expect(paiements.rows).toEqual([
      {
        mode: 'ESPECES',
        montant: -6000,
        referenceExterne: null,
        montantRecu: null,
        sessionCaisseId: origine.session.id,
      },
    ]);
    expect((await mouvementsDePiece(pieceId1)).rows).toEqual([
      {
        type: 'CORRECTION',
        quantite: 3,
        lotId,
        motif: 'Erreur de quantité',
        auteurId: VENDEUR,
        posteId: poste.id,
      },
    ]);
    expect(await soldeLot(lotId)).toBe(10);
    expect(await soldeProduit(stockId)).toBe(10);
    expect(await prochainNumero()).toBe(avant);

    const bilan = await sessions.bilan(PHARMACIE, VENDEUR, origine.session.id);
    expect(
      bilan.data.theorique.find((t) => t.mode === 'ESPECES')?.montant ?? 0,
    ).toBe(0);
    expect(bilan.data.activite.nombreVentes).toBe(1);
    expect(bilan.data.activite.nombreAnnulations).toBe(1);
    expect(bilan.data.activite.montantEncaisse).toBe(0);

    const detailPiece = (
      await service.detailVente(PHARMACIE, pieceId1, RESPONSABLE)
    ).data as unknown as VenteRep;
    expect(detailPiece).toMatchObject({
      typePiece: 'ANNULATION',
      statut: 'VALIDEE',
      annuleeLe: null,
      annuleeParId: null,
      motifAnnulation: null,
      annulation: null,
      motif: 'Erreur de quantité',
      venteOrigine: { id: origine.id, numero: origine.numero },
      total: -6000,
    });
    expect(detailPiece.lignes[0].allocations[0]).toMatchObject({
      lotId,
      quantite: -3,
      statut: 'DEFINITIVE',
      coutUnitaire: 300,
    });
    expect(detailPiece.paiements).toMatchObject([
      { mode: 'ESPECES', montant: -6000, montantRecu: null, rendu: null },
    ]);
    const detailVendeur = await service.detailVente(
      PHARMACIE,
      pieceId1,
      VENDEUR,
    );
    expect(cheminsCout(detailVendeur.data)).toEqual([]);

    const detailOrigine = (
      await service.detailVente(PHARMACIE, origine.id, RESPONSABLE)
    ).data as unknown as VenteRep;
    expect(detailOrigine.annulation?.id).toBe(pieceId1);
    expect(detailOrigine.lignes[0].allocations[0].coutUnitaire).toBe(300);
  });

  it('2. seconde annulation refusée', async () => {
    const origine = origine1.data;
    const sessionsAvant = await nombreSessions(RESPONSABLE);
    const e = await refus(annuler(origine.id, RESPONSABLE));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('VENTE_DEJA_ANNULEE');
    expect(e.corps.message).toBe('Cette vente a déjà été annulée.');
    expect(await piecesDe(origine.id)).toHaveLength(1);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineType" = 'ANNULATION' AND "pieceOrigineId" = $1`,
        [pieceId1],
      ),
    ).toBe(1);
    expect(await soldeLot(lot1)).toBe(10);
    expect(await nombreSessions(RESPONSABLE)).toBe(sessionsAvant);
  });

  it('3. pièces non annulables et introuvables', async () => {
    const ventesAvant = await nombreVentes();
    const sessionsAvant = await nombreSessions();
    const verifierInchange = async () => {
      expect(await nombreVentes()).toBe(ventesAvant);
      expect(await nombreSessions()).toBe(sessionsAvant);
    };

    const piece = await refus(annuler(pieceId1));
    expect(piece.statut).toBe(409);
    expect(piece.corps.code).toBe('PIECE_NON_ANNULABLE');
    expect(piece.corps.message).toBe(MESSAGE_PIECE_NON_ANNULABLE);
    await verifierInchange();

    const historique = await refus(annuler('vte-p1-1'));
    expect(historique.statut).toBe(409);
    expect(historique.corps.code).toBe('PIECE_NON_ANNULABLE');
    expect(historique.corps.message).toBe(
      MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE,
    );
    await verifierInchange();

    const historiqueAnnulee = await refus(annuler('vte-p1-3'));
    expect(historiqueAnnulee.statut).toBe(409);
    expect(historiqueAnnulee.corps.code).toBe('VENTE_DEJA_ANNULEE');
    await verifierInchange();

    const inconnue = await refus(annuler('vente-inconnue'));
    expect(inconnue.statut).toBe(404);
    expect(inconnue.corps.message).toBe('Cette vente est introuvable.');
    await verifierInchange();

    const autrePharmacie = await refus(annuler('vte-p2-1'));
    expect(autrePharmacie.statut).toBe(404);
    await verifierInchange();
  });

  it('4. deux annulations simultanées : une réussite, un refus', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await nouveauLot(stockId, { quantite: 5 });
    const { data } = await vendre({ lignes: [{ stockId, quantite: 2 }] });
    expect(await soldeLot(lotId)).toBe(3);

    const resultats = await Promise.allSettled([
      annuler(data.id, VENDEUR),
      annuler(data.id, RESPONSABLE),
    ]);
    const reussies = resultats.filter((r) => r.status === 'fulfilled');
    const rejetees = resultats.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(reussies).toHaveLength(1);
    expect(rejetees).toHaveLength(1);
    expect(rejetees[0].reason).toBeInstanceOf(HttpException);
    const erreur = rejetees[0].reason as HttpException;
    expect(erreur.getStatus()).toBe(409);
    expect((erreur.getResponse() as { code?: string }).code).toBe(
      'VENTE_DEJA_ANNULEE',
    );

    const pieces = await piecesDe(data.id);
    expect(pieces).toHaveLength(1);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineType" = 'ANNULATION' AND "pieceOrigineId" = $1`,
        [pieces[0].id],
      ),
    ).toBe(1);
    expect(await soldeLot(lotId)).toBe(5);
  });

  it('5. plus de limite de jour, jour métier et théorique de la session courante', async () => {
    const { data: posteQ } = await postes.enregistrerPoste(PHARMACIE, VENDEUR, {
      type: 'WEB',
      appareilId: 'appareil-pb12-veille',
    });
    await sql(
      `INSERT INTO "SessionCaisse" ("id", "pointDeVenteId", "posteId", "utilisateurId", "utilisateurNom", "statut", "technique", "jourMetier", "ouverteLe", "evenementOuvertureId") VALUES ('ses-pb12-veille', $1, $2, $3, 'Mamadou Diallo', 'OUVERTE', false, $4::date, now() - interval '3 days', 'ses-pb12-veille')`,
      [pv1, posteQ.id, VENDEUR, jour(-3)],
    );
    const a = await nouvelleFiche({ prixBoite: 1000 });
    await nouveauLot(a.stockId, { quantite: 10 });
    const ancienne = await vendre({
      lignes: [{ stockId: a.stockId, quantite: 1 }],
      posteId: posteQ.id,
    });
    expect(ancienne.data.jourMetier).toBe(jour(-3));
    expect(ancienne.data.session.id).toBe('ses-pb12-veille');

    await sessions.fermer(PHARMACIE, VENDEUR, 'ses-pb12-veille', {
      comptageFermeture: { coupures: [{ valeurFaciale: 500, nombre: 2 }] },
    });

    const b = await nouvelleFiche({ prixBoite: 1000 });
    await nouveauLot(b.stockId, { quantite: 10 });
    const courante = await vendre(
      { lignes: [{ stockId: b.stockId, quantite: 1 }] },
      RESPONSABLE,
    );
    const sessionR = courante.data.session.id;
    const thAvant = await theorique(RESPONSABLE, sessionR, 'ESPECES');
    const listeAvant = (await service.listerVentes(PHARMACIE, VENDEUR, {
      date: jour(0),
    })) as unknown as ReponseListe;

    const { data } = await annuler(ancienne.data.id, RESPONSABLE);
    expect(data.statut).toBe('ANNULEE');
    const pieces = await piecesDe(ancienne.data.id);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].sessionCaisseId).toBe(sessionR);
    expect(pieces[0].jour).toBe(jour(0));
    expect(await theorique(RESPONSABLE, sessionR, 'ESPECES')).toBe(
      thAvant - 1000,
    );

    const listeVeille = (await service.listerVentes(PHARMACIE, VENDEUR, {
      date: jour(-3),
    })) as unknown as ReponseListe;
    expect(listeVeille.data.nombre).toBe(1);
    expect(listeVeille.data.totalJour).toBe(1000);
    expect(listeVeille.data.ventes[0]).toMatchObject({
      id: ancienne.data.id,
      statut: 'ANNULEE',
      typePiece: 'VENTE',
      annulation: {
        id: pieces[0].id,
        numero: 'A-' + ancienne.data.numero,
      },
      venteOrigine: null,
      jourMetier: jour(-3),
    });

    const listeJour = (await service.listerVentes(PHARMACIE, VENDEUR, {
      date: jour(0),
    })) as unknown as ReponseListe;
    expect(listeJour.data.nombre).toBe(listeAvant.data.nombre + 1);
    expect(listeJour.data.totalJour).toBe(listeAvant.data.totalJour - 1000);
    // Pièce retrouvée par son identifiant : le jeu « format actuel » place une vente à J + 11 h, avant elle dans le tri jusqu'à 11 h UTC
    expect(
      listeJour.data.ventes.find((v) => v.id === pieces[0].id),
    ).toMatchObject({
      id: pieces[0].id,
      typePiece: 'ANNULATION',
      total: -1000,
      statut: 'VALIDEE',
      nombreArticles: -1,
      venteOrigine: {
        id: ancienne.data.id,
        numero: ancienne.data.numero,
      },
      annulation: null,
      numeroTicket: null,
    });
    expect(listeJour.message).toBe(
      `${listeJour.data.nombre} vente(s) le ${jour(0)}.`,
    );
  });

  it('6. paiement partagé et session ouverte automatiquement', async () => {
    const { data: posteM } = await postes.enregistrerPoste(PHARMACIE, VENDEUR, {
      type: 'WEB',
      appareilId: 'appareil-pb12-mobile',
    });
    const { data: posteR } = await postes.enregistrerPoste(PHARMACIE, VENDEUR, {
      type: 'WEB',
      appareilId: 'appareil-pb12-remboursement',
    });
    const { stockId } = await nouvelleFiche({ prixBoite: 3000 });
    await nouveauLot(stockId, { quantite: 10 });
    const vente = await vendre({
      lignes: [{ stockId, quantite: 1 }],
      posteId: posteM.id,
      paiements: [
        { mode: 'ESPECES', montant: 1000, montantRecu: 1000 },
        { mode: 'ORANGE_MONEY', montant: 2000, reference: 'OM-PB12' },
      ],
    });
    const sessionM = vente.data.session.id;
    expect(
      await compter(
        `SELECT count(*) AS n FROM "SessionCaisse" WHERE "posteId" = $1`,
        [posteR.id],
      ),
    ).toBe(0);

    const { data } = await annuler(vente.data.id, VENDEUR, {
      posteId: posteR.id,
    });
    expect(data.statut).toBe('ANNULEE');

    const ouvertes = await sql(
      `SELECT "id" FROM "SessionCaisse" WHERE "posteId" = $1 AND "utilisateurId" = $2 AND "statut" = 'OUVERTE'`,
      [posteR.id, VENDEUR],
    );
    expect(ouvertes.rows).toHaveLength(1);
    const sessionR = String(ouvertes.rows[0].id);
    const pieces = await piecesDe(vente.data.id);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].sessionCaisseId).toBe(sessionR);
    expect(pieces[0].total).toBe(-3000);

    const paiements = await sql(
      `SELECT m."code" AS "mode", p."montant", p."referenceExterne", p."montantRecu" FROM "Paiement" p JOIN "ModePaiement" m ON m."id" = p."modePaiementId" WHERE p."venteId" = $1 ORDER BY p."montant" DESC`,
      [pieces[0].id],
    );
    expect(paiements.rows).toEqual([
      {
        mode: 'ESPECES',
        montant: -1000,
        referenceExterne: null,
        montantRecu: null,
      },
      {
        mode: 'ORANGE_MONEY',
        montant: -2000,
        referenceExterne: null,
        montantRecu: null,
      },
    ]);
    expect(
      paiements.rows.reduce((somme, p) => somme + Number(p.montant), 0),
    ).toBe(-3000);
    expect(await theorique(VENDEUR, sessionR, 'ESPECES')).toBe(-1000);
    expect(await theorique(VENDEUR, sessionR, 'ORANGE_MONEY')).toBe(-2000);
    expect(await theorique(VENDEUR, sessionM, 'ESPECES')).toBe(1000);
    expect(await theorique(VENDEUR, sessionM, 'ORANGE_MONEY')).toBe(2000);

    const audits = await sql(
      `SELECT "metadata" FROM "AuditLog" WHERE "action" = 'annuler' AND "entityId" = $1`,
      [vente.data.id],
    );
    expect(audits.rows).toHaveLength(1);
    const metadata = audits.rows[0].metadata as Record<string, unknown>;
    expect(metadata.sessionOuverteAutomatiquement).toBe(true);
    expect(metadata.pieceId).toBe(pieces[0].id);
    expect(metadata.numeroPiece).toBe('A-' + vente.data.numero);
    expect(metadata).not.toHaveProperty('motif');
    expect(metadata).not.toHaveProperty('clientNom');
  });

  describe('7. lots, reliquat, provisoire et fiche archivée', () => {
    it('(a) reliquat refermé', async () => {
      const { stockId } = await nouvelleFiche({
        coef: 20,
        prixBoite: 10000,
        prixUnite: 600,
        decond: true,
      });
      const lotA = await nouveauLot(stockId, {
        quantite: 20,
        coef: 20,
        exp: jour(30),
      });
      const vente = await vendre({
        lignes: [{ stockId, quantite: 6, unite: 'UNITE' }],
      });
      expect(await soldeLot(lotA)).toBe(14);
      expect(
        await compter(
          'SELECT count(*) AS n FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "fermeLe" IS NULL',
          [lotA],
        ),
      ).toBe(1);

      await annuler(vente.data.id);

      expect(await soldeLot(lotA)).toBe(20);
      expect(
        await compter(
          'SELECT count(*) AS n FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "fermeLe" IS NULL',
          [lotA],
        ),
      ).toBe(0);
      const pieces = await piecesDe(vente.data.id);
      const lignes = await sql(
        `SELECT "uniteAffichee"::text AS "uniteAffichee", "nombreAffiche", "quantite", "coefficientApplique", "prixUnitaire", "sousTotal" FROM "LigneVente" WHERE "venteId" = $1`,
        [pieces[0].id],
      );
      expect(lignes.rows).toEqual([
        {
          uniteAffichee: 'UNITE',
          nombreAffiche: -6,
          quantite: -6,
          coefficientApplique: 1,
          prixUnitaire: 600,
          sousTotal: -3600,
        },
      ]);
    });

    it('(b) retour dans les deux lots d’origine', async () => {
      const { stockId } = await nouvelleFiche();
      const l30 = await nouveauLot(stockId, { quantite: 10, exp: jour(30) });
      const l90 = await nouveauLot(stockId, { quantite: 10, exp: jour(90) });
      const vente = await vendre({ lignes: [{ stockId, quantite: 15 }] });
      expect(await soldeLot(l30)).toBe(0);
      expect(await soldeLot(l90)).toBe(5);

      await annuler(vente.data.id);

      expect(await soldeLot(l30)).toBe(10);
      expect(await soldeLot(l90)).toBe(10);
      const pieces = await piecesDe(vente.data.id);
      const mvts = await mouvementsDePiece(String(pieces[0].id));
      expect(mvts.rows).toHaveLength(2);
      expect(
        mvts.rows.map((m) => ({ lotId: m.lotId, quantite: m.quantite })),
      ).toEqual(
        expect.arrayContaining([
          { lotId: l30, quantite: 10 },
          { lotId: l90, quantite: 5 },
        ]),
      );
      expect(mvts.rows.every((m) => m.type === 'CORRECTION')).toBe(true);
    });

    it('(c) allocation provisoire annulée sans lot, anomalie intacte', async () => {
      const { stockId } = await nouvelleFiche();
      const lotId = await nouveauLot(stockId, { quantite: 2 });
      // Vente sans stock : seul le rejeu d'un poste l'accepte (D713.2) ; l'annulation
      // se fait ensuite depuis la caisse web
      const vente = await venteParRejeu({ stockId, nombre: 5 });
      expect(await soldeProduit(stockId)).toBe(-3);
      expect(
        await compter(
          `SELECT count(*) AS n FROM "Anomalie" WHERE "pieceId" = $1 AND "type"::text = 'STOCK_NEGATIF'`,
          [vente.data.id],
        ),
      ).toBe(1);
      const anomaliesAvant = await compter(
        `SELECT count(*) AS n FROM "Anomalie" WHERE "pointDeVenteId" = $1`,
        [pv1],
      );

      await annuler(vente.data.id);

      const pieces = await piecesDe(vente.data.id);
      const pieceId = String(pieces[0].id);
      const allocations = await sql(
        `SELECT a."lotId", a."quantite", a."statut"::text AS "statut", a."coutUnitaire" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."statut"`,
        [pieceId],
      );
      expect(allocations.rows).toEqual([
        { lotId, quantite: -2, statut: 'DEFINITIVE', coutUnitaire: 0 },
        { lotId: null, quantite: -3, statut: 'PROVISOIRE', coutUnitaire: 0 },
      ]);
      const mvts = await mouvementsDePiece(pieceId);
      expect(mvts.rows).toHaveLength(2);
      expect(
        mvts.rows.map((m) => ({ lotId: m.lotId, quantite: m.quantite })),
      ).toEqual(
        expect.arrayContaining([
          { lotId, quantite: 2 },
          { lotId: null, quantite: 3 },
        ]),
      );
      expect(await soldeProduit(stockId)).toBe(2);
      expect(await soldeLot(lotId)).toBe(2);

      const detail = (
        await service.detailVente(PHARMACIE, pieceId, RESPONSABLE)
      ).data as unknown as VenteRep;
      expect(detail.provisoire).toBe(true);
      expect(
        await compter(
          `SELECT count(*) AS n FROM "Anomalie" WHERE "pointDeVenteId" = $1`,
          [pv1],
        ),
      ).toBe(anomaliesAvant);
      const statutAnomalie = await sql(
        `SELECT "statut"::text AS "statut" FROM "Anomalie" WHERE "pieceId" = $1`,
        [vente.data.id],
      );
      expect(statutAnomalie.rows).toEqual([{ statut: 'OUVERTE' }]);
    });

    it('(d) fiche archivée depuis la vente', async () => {
      const { stockId } = await nouvelleFiche();
      const lotId = await nouveauLot(stockId, { quantite: 4 });
      const vente = await vendre({ lignes: [{ stockId, quantite: 1 }] });
      await sql(
        `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1`,
        [stockId],
      );

      await annuler(vente.data.id);

      expect(await soldeLot(lotId)).toBe(4);
    });
  });

  it('8. poste et session de l’annulation', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await nouveauLot(stockId, { quantite: 5 });
    const vente = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    const verifierRien = async () => {
      expect(await piecesDe(vente.data.id)).toHaveLength(0);
      expect(await soldeLot(lotId)).toBe(4);
    };

    const inconnu = await refus(
      annuler(vente.data.id, VENDEUR, { posteId: 'poste-inconnu' }),
    );
    expect(inconnu.statut).toBe(409);
    expect(inconnu.corps.code).toBe('POSTE_INCONNU');
    await verifierRien();

    const { data: posteO } = await postes.enregistrerPoste(
      PHARMACIE,
      RESPONSABLE,
      { type: 'WEB', appareilId: 'appareil-pb12-occupe' },
    );
    await sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: posteO.id });
    const collegue = await refus(
      annuler(vente.data.id, VENDEUR, { posteId: posteO.id }),
    );
    expect(collegue.statut).toBe(409);
    expect(collegue.corps.code).toBe('SESSION_AUTRE_UTILISATEUR');
    await verifierRien();

    await annuler(vente.data.id, VENDEUR);
    expect(await piecesDe(vente.data.id)).toHaveLength(1);
    expect(await soldeLot(lotId)).toBe(5);
  });

  it('8b. poste en cours de création par un collègue : vente et annulation n’attendent pas (D554)', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await nouveauLot(stockId, { quantite: 5 });
    const vente = await vendre({ lignes: [{ stockId, quantite: 1 }] });

    let signaler: () => void = () => undefined;
    const tenu = new Promise<void>((r) => (signaler = r));
    let liberer: () => void = () => undefined;
    const libere = new Promise<void>((r) => (liberer = r));
    const creation = prisma.$transaction(
      async (tx) => {
        await assurerPoste(tx, {
          pointDeVenteId: pv1,
          type: 'WEB',
          appareilId: 'appareil-pb12-en-cours',
          user: { id: RESPONSABLE, prenom: 'Test' },
          ip: null,
        });
        signaler();
        await libere;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    const sansAttente = async <T>(promesse: Promise<T>): Promise<T> => {
      let minuteur: NodeJS.Timeout | undefined;
      const delai = new Promise<never>((_, rejeter) => {
        minuteur = setTimeout(
          () => rejeter(new Error('Attente du verrou du point de vente.')),
          5_000,
        );
      });
      try {
        return await Promise.race([promesse, delai]);
      } finally {
        clearTimeout(minuteur);
      }
    };

    try {
      await tenu;
      await sansAttente(vendre({ lignes: [{ stockId, quantite: 1 }] }));
      await sansAttente(annuler(vente.data.id));
    } finally {
      liberer();
      await creation;
    }
    expect(await piecesDe(vente.data.id)).toHaveLength(1);
    expect(await soldeLot(lotId)).toBe(4);
  });

  it('9. invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);

    const ecarts = await compter(
      `SELECT count(*) AS n FROM (
         SELECT l."id", l."quantite", sum(a."quantite") FILTER (WHERE a."statut" = 'DEFINITIVE') AS "definitif",
                count(*) FILTER (WHERE a."statut" = 'PROVISOIRE') AS "provisoires"
         FROM "LigneVente" l JOIN "AllocationLot" a ON a."ligneVenteId" = l."id"
         JOIN "Vente" v ON v."id" = l."venteId"
         WHERE v."structureId" = $1
         GROUP BY l."id", l."quantite"
       ) t WHERE t."provisoires" = 0 AND t."definitif" <> t."quantite"`,
      [PHARMACIE],
    );
    expect(ecarts).toBe(0);

    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" p JOIN "Vente" o ON o."id" = p."venteOrigineId" WHERE p."structureId" = $1 AND p."typePiece"::text = 'ANNULATION' AND p."total" <> -o."total"`,
        [PHARMACIE],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" p WHERE p."structureId" = $1 AND p."typePiece"::text = 'ANNULATION' AND p."total" <> (SELECT COALESCE(sum(x."montant"), 0) FROM "Paiement" x WHERE x."venteId" = p."id")`,
        [PHARMACIE],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" p JOIN "Vente" o ON o."id" = p."venteOrigineId" WHERE p."structureId" = $1 AND p."typePiece"::text = 'ANNULATION' AND p."numero" <> 'A-' || o."numero"`,
        [PHARMACIE],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" p JOIN "SessionCaisse" s ON s."id" = p."sessionCaisseId" WHERE p."structureId" = $1 AND p."typePiece"::text = 'ANNULATION' AND s."technique"`,
        [PHARMACIE],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" WHERE "structureId" = $1 AND "typePiece"::text = 'ANNULATION' AND "venteOrigineId" IS NULL`,
        [PHARMACIE],
      ),
    ).toBe(0);
  });
});
