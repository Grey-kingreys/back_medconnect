import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  AccesPharmacieService,
  type AccesPharmacie,
} from '../acces-pharmacie.service';
import { assurerPointDeVente } from '../point-de-vente';
import { jourConakry } from '../jour-metier';
import {
  ciblerLot,
  lotsEnStockFefo,
  normaliserNumeroLot,
  planifierInventaireFiche,
  type LigneCiblee,
  type PlanInventaireFiche,
} from '../domaine/inventaire';
import { ENTIER_MAX, jourValide } from '../domaine/reception';
import type { ProvisoireAResoudre } from '../domaine/resolution';
import type { LotCandidat } from '../domaine/selection-lots';
import { estDoublonSur } from '../stock/erreurs-base';
import {
  dateVersJour,
  jourVersDate,
  lireTousLesLots,
} from '../stock/lecture-stock';
import { MouvementsStockService } from '../stock/mouvements-stock.service';
import {
  ecrireResolutions,
  lireProvisoiresEligibles,
  lireResolutionsDePiece,
  type ProvisoireEligible,
  type ResolutionEcrite,
} from '../stock/resolution-provisoires';
import {
  MESSAGE_FICHE_NON_QUALIFIEE,
  type AvertissementReception,
} from '../receptions/receptions.service';
import type {
  CreerInventaireDto,
  ListerInventairesDto,
} from '../dto/inventaires.dto';

export const MESSAGE_QUANTITE_COMPTEE_REQUISE =
  "Indiquez la quantité comptée : un nombre d'unités, ou un nombre de boîtes (et les unités en plus d'une boîte entamée).";
export const MESSAGE_QUANTITE_COMPTEE_UNIQUE =
  "Indiquez soit le nombre d'unités, soit le nombre de boîtes, pas les deux.";
export const MESSAGE_UNITES_SANS_BOITES =
  "Les unités en plus s'ajoutent à un nombre de boîtes : indiquez aussi le nombre de boîtes (0 si aucune boîte entière).";
export const MESSAGE_QUANTITE_COMPTEE_TROP_GRANDE =
  'La quantité comptée est trop grande pour être enregistrée. Vérifiez la quantité.';
export const MESSAGE_DATE_INVALIDE_INVENTAIRE =
  "La date de péremption n'existe pas : vérifiez-la (format AAAA-MM-JJ).";
export const MESSAGE_STOCK_INTROUVABLE_INVENTAIRE =
  "Un médicament de l'inventaire est introuvable dans le stock de cette pharmacie.";
export const MESSAGE_LOT_INTROUVABLE_INVENTAIRE =
  'Ce lot est introuvable pour ce médicament.';
export const MESSAGE_INVENTAIRE_LOT_REQUIS =
  'Ce médicament a plusieurs lots en stock : précisez le lot compté (numéro ou date de péremption), une ligne par lot.';
export const MESSAGE_INVENTAIRE_DATE_REQUISE =
  "Ces boîtes ne correspondent à aucun lot en stock : indiquez leur date de péremption, ou précisez que ce médicament n'en a pas.";
export const MESSAGE_LOT_INCONNU_VIDE =
  "Ce lot n'est pas dans votre stock : une quantité comptée de 0 n'a rien à enregistrer. Retirez la ligne ou vérifiez le numéro de lot.";
export const MESSAGE_LOT_COMPTE_DEUX_FOIS =
  "Ce lot est compté deux fois dans l'inventaire : gardez une seule ligne par lot.";
export const MESSAGE_INVENTAIRE_INTROUVABLE = 'Cet inventaire est introuvable.';
export const MESSAGE_IDENTIFIANT_INVENTAIRE =
  'Cet identifiant est déjà utilisé par un autre inventaire.';
export const MESSAGE_INVENTAIRE_REJOUE =
  'Cet inventaire était déjà enregistré.';
export const MESSAGE_VENTES_RATTACHEES_INVENTAIRE =
  'Les ventes faites en attente de stock ont été rattachées aux lots comptés.';
export function messageInventaireEnregistre(
  nombreLignes: number,
  nombreAnomalies: number,
): string {
  const debut =
    nombreLignes === 1
      ? 'Inventaire enregistré : 1 ligne.'
      : `Inventaire enregistré : ${nombreLignes} lignes.`;
  if (nombreAnomalies === 0) return debut;
  return nombreAnomalies === 1
    ? `${debut} 1 écart dépasse la tolérance : il est signalé dans les anomalies.`
    : `${debut} ${nombreAnomalies} écarts dépassent la tolérance : ils sont signalés dans les anomalies.`;
}

export interface LigneInventaireAEnregistrer {
  stockId: string;
  lotId: string | null;
  numeroLot: string | null;
  dateExpiration: string | null;
  sansPeremption: boolean;
  quantiteComptee: number | null;
  nombreBoites: number | null;
  unitesEnPlus: number | null;
}
export interface InventaireAEnregistrer {
  id?: string;
  commentaire: string | null;
  lignes: LigneInventaireAEnregistrer[];
}
export type CodeRefusLigneInventaire =
  | 'STOCK_INTROUVABLE'
  | 'LOT_INTROUVABLE'
  | 'LOT_REQUIS'
  | 'DATE_PEREMPTION_REQUISE'
  | 'LOT_INCONNU_VIDE'
  | 'LOT_EN_DOUBLE'
  | 'QUANTITE_TROP_GRANDE';
export interface RefusLigneInventaire {
  index: number;
  code: CodeRefusLigneInventaire;
  /** Pour LOT_REQUIS : lots à solde positif en FEFO. */
  lots?: {
    lotId: string;
    numeroLot: string | null;
    dateExpiration: string | null;
    quantite: number;
  }[];
}
export interface LigneEvaluee {
  index: number;
  stockId: string;
  /** Réel ; null pour un nouveau lot (simulation) ou SANS_LOT. */
  lotId: string | null;
  nouveauLot: boolean;
  soldeAvant: number;
  quantiteTheorique: number;
  quantiteComptee: number;
  ecart: number;
  sousTolerance: boolean;
}
export interface InventaireEcrit {
  /** Nul si aucune ligne n'est retenue (mode rejeterLignes). */
  inventaireId: string | null;
  cree: boolean;
  /** lotId réel, nouveaux lots compris. */
  lignes: (LigneEvaluee & { anomalieId: string | null })[];
  refusees: RefusLigneInventaire[];
  anomalies: { id: string; stockId: string }[];
  resolutions: ResolutionEcrite[];
  avertissements: AvertissementReception[];
}

const OPTIONS_TRANSACTION_INVENTAIRE = { maxWait: 10_000, timeout: 60_000 };
const PAR_PAGE = 20;

interface FicheLue {
  id: string;
  nom: string;
  coefficientBoite: number;
  toleranceInventaire: number | null;
  qualifie: boolean;
}

interface Evaluation {
  fiches: Map<string, FicheLue>;
  lotsParFiche: Map<string, LotCandidat[]>;
  provisoiresParFiche: Map<string, ProvisoireEligible[]>;
  /** Lignes retenues par fiche, dans l'ordre de la saisie. */
  retenues: Map<string, LigneCiblee[]>;
  refus: RefusLigneInventaire[];
  plans: Map<string, PlanInventaireFiche>;
  dateReceptionNouveaux: string;
}

type ClientEvaluation = Pick<
  Prisma.TransactionClient,
  'stockMedicament' | 'lotStock' | 'allocationLot'
>;

type ClientLecture = Pick<
  Prisma.TransactionClient,
  'inventaire' | 'user' | 'anomalie' | 'allocationLot' | 'mouvementStock'
>;

const ORDRE_REFUS: CodeRefusLigneInventaire[] = [
  'LOT_INTROUVABLE',
  'LOT_REQUIS',
  'DATE_PEREMPTION_REQUISE',
  'LOT_INCONNU_VIDE',
  'LOT_EN_DOUBLE',
  'QUANTITE_TROP_GRANDE',
];

function quantiteNulle(l: LigneInventaireAEnregistrer): boolean {
  return (
    (l.quantiteComptee ?? (l.nombreBoites ?? 0) + (l.unitesEnPlus ?? 0)) === 0
  );
}

function comparerNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

@Injectable()
export class InventairesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
  ) {}

  /** Contrôle de forme sans base (route seulement) : toutes les lignes en cause, une seule exception. */
  private controlerForme(lignes: LigneInventaireAEnregistrer[]): void {
    const champs: { champ: string; contraintes: string[] }[] = [];
    let message: string | null = null;
    const refuser = (champ: string, contrainte: string, texte: string) => {
      champs.push({ champ, contraintes: [contrainte] });
      message ??= texte;
    };
    lignes.forEach((l, i) => {
      if (l.quantiteComptee === null && l.nombreBoites === null) {
        refuser(
          `lignes.${i}.quantiteComptee`,
          'quantiteRequise',
          MESSAGE_QUANTITE_COMPTEE_REQUISE,
        );
      } else if (l.quantiteComptee !== null && l.nombreBoites !== null) {
        refuser(
          `lignes.${i}.quantiteComptee`,
          'quantiteUnique',
          MESSAGE_QUANTITE_COMPTEE_UNIQUE,
        );
      }
      if (l.unitesEnPlus !== null && l.nombreBoites === null) {
        refuser(
          `lignes.${i}.unitesEnPlus`,
          'unitesSansBoites',
          MESSAGE_UNITES_SANS_BOITES,
        );
      }
      if (l.dateExpiration !== null && !jourValide(l.dateExpiration)) {
        refuser(
          `lignes.${i}.dateExpiration`,
          'dateValide',
          MESSAGE_DATE_INVALIDE_INVENTAIRE,
        );
      }
    });
    if (message !== null) {
      throw new BadRequestException({
        message,
        code: 'VALIDATION',
        champs,
      });
    }
  }

  /** Évaluation commune (lecture seule ; sous verrous quand l'appelant les tient). */
  private async evaluer(
    client: ClientEvaluation,
    pointDeVenteId: string | null,
    structureId: string,
    lignes: readonly LigneInventaireAEnregistrer[],
    jour: string,
  ): Promise<Evaluation> {
    const ids = [...new Set(lignes.map((l) => l.stockId))].sort();

    // 1. Fiches
    const fiches = new Map<string, FicheLue>();
    for (const f of await client.stockMedicament.findMany({
      where: { id: { in: ids }, structureId },
      select: {
        id: true,
        coefficientBoite: true,
        toleranceInventaire: true,
        qualifie: true,
        medicament: { select: { nom: true } },
      },
    })) {
      fiches.set(f.id, {
        id: f.id,
        nom: f.medicament.nom,
        coefficientBoite: f.coefficientBoite,
        toleranceInventaire: f.toleranceInventaire,
        qualifie: f.qualifie,
      });
    }

    // 2. Lots et ventes sans stock
    const lotsParFiche =
      pointDeVenteId === null
        ? new Map<string, LotCandidat[]>()
        : await lireTousLesLots(client, pointDeVenteId, [...fiches.keys()]);
    const provisoiresParFiche = new Map<string, ProvisoireEligible[]>();
    if (pointDeVenteId !== null) {
      for (const id of [...fiches.keys()].sort()) {
        provisoiresParFiche.set(
          id,
          await lireProvisoiresEligibles(client, pointDeVenteId, id),
        );
      }
    }
    const sommeProvisoires = (stockId: string) =>
      (provisoiresParFiche.get(stockId) ?? []).reduce(
        (s, p) => s + p.quantite,
        0,
      );

    // 3. Ciblage et quantités
    const refus: RefusLigneInventaire[] = [];
    const retenues = new Map<string, LigneCiblee[]>();
    const vusLot = new Set<string>();
    lignes.forEach((l, index) => {
      const fiche = fiches.get(l.stockId);
      if (!fiche) {
        refus.push({ index, code: 'STOCK_INTROUVABLE' });
        return;
      }
      const lots = lotsParFiche.get(l.stockId) ?? [];
      const nul = quantiteNulle(l);
      const cible = ciblerLot(
        {
          lotId: l.lotId,
          numeroLot: l.numeroLot?.trim() ? l.numeroLot.trim() : null,
          dateExpiration: l.dateExpiration,
          sansPeremption: l.sansPeremption,
          quantiteNulle: nul,
        },
        lots,
      );
      if (cible.type === 'REFUS') {
        refus.push({
          index,
          code: cible.code,
          ...(cible.code === 'LOT_REQUIS'
            ? {
                lots: lotsEnStockFefo(lots).map((x) => ({
                  lotId: x.id,
                  numeroLot: x.numeroLot,
                  dateExpiration: x.dateExpiration,
                  quantite: x.solde,
                })),
              }
            : {}),
        });
        return;
      }

      // Quantité en unités minimales
      const coefficient =
        cible.type === 'LOT'
          ? (lots.find((x) => x.id === cible.lotId)?.coefficientReception ?? 1)
          : cible.type === 'NOUVEAU'
            ? fiche.coefficientBoite
            : 0;
      const quantiteComptee =
        cible.type === 'SANS_LOT'
          ? 0
          : (l.quantiteComptee ??
            (l.nombreBoites ?? 0) * coefficient + (l.unitesEnPlus ?? 0));

      // 4. Doublons
      const cle =
        cible.type === 'LOT'
          ? `${l.stockId}|lot|${cible.lotId}`
          : cible.type === 'NOUVEAU'
            ? `${l.stockId}|nouveau|${normaliserNumeroLot(cible.numeroLot ?? '')}|${cible.dateExpiration ?? ''}`
            : `${l.stockId}|sans-lot`;
      if (vusLot.has(cle)) {
        refus.push({ index, code: 'LOT_EN_DOUBLE' });
        return;
      }
      vusLot.add(cle);

      // 5. Bornes
      if (quantiteComptee + sommeProvisoires(l.stockId) > ENTIER_MAX) {
        refus.push({ index, code: 'QUANTITE_TROP_GRANDE' });
        return;
      }

      const liste = retenues.get(l.stockId) ?? [];
      liste.push({
        index,
        cible:
          cible.type === 'NOUVEAU'
            ? {
                type: 'NOUVEAU',
                idVirtuel: `nouveau:${index}`,
                numeroLot: cible.numeroLot,
                dateExpiration: cible.dateExpiration,
              }
            : cible,
        quantiteComptee,
      });
      retenues.set(l.stockId, liste);
    });

    // 6. Plans par fiche
    const dateReceptionNouveaux = new Date().toISOString();
    const plans = new Map<string, PlanInventaireFiche>();
    for (const [stockId, liste] of retenues) {
      const fiche = fiches.get(stockId) as FicheLue;
      const provisoires: ProvisoireAResoudre[] = (
        provisoiresParFiche.get(stockId) ?? []
      ).map((p) => ({
        allocationId: p.id,
        venteCreeLe: p.ligneVente.vente.createdAt.toISOString(),
        quantite: p.quantite,
      }));
      plans.set(
        stockId,
        planifierInventaireFiche({
          lots: lotsParFiche.get(stockId) ?? [],
          lignes: liste,
          provisoires,
          coefficientBoite: fiche.coefficientBoite,
          dateReceptionNouveaux,
          tolerance: fiche.toleranceInventaire ?? 0,
          jour,
        }),
      );
    }

    return {
      fiches,
      lotsParFiche,
      provisoiresParFiche,
      retenues,
      refus,
      plans,
      dateReceptionNouveaux,
    };
  }

  private lignesEvaluees(evaluation: Evaluation): LigneEvaluee[] {
    const resultat: LigneEvaluee[] = [];
    for (const [stockId, plan] of evaluation.plans) {
      for (const l of plan.lignes) {
        resultat.push({
          index: l.index,
          stockId,
          lotId: l.nouveauLot ? null : l.lotId,
          nouveauLot: l.nouveauLot,
          soldeAvant: l.soldeAvant,
          quantiteTheorique: l.quantiteTheorique,
          quantiteComptee: l.quantiteComptee,
          ecart: l.ecart,
          sousTolerance: plan.sousTolerance,
        });
      }
    }
    return resultat.sort((a, b) => a.index - b.index);
  }

  /** Aperçu sans écriture ni verrou (import d'inventaire). */
  async simuler(
    client: Pick<
      Prisma.TransactionClient,
      'pointDeVente' | 'stockMedicament' | 'lotStock' | 'allocationLot'
    >,
    structureId: string,
    lignes: LigneInventaireAEnregistrer[],
    jour: string,
  ): Promise<{ lignes: LigneEvaluee[]; refusees: RefusLigneInventaire[] }> {
    const pointDeVente = await client.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });
    const evaluation = await this.evaluer(
      client,
      pointDeVente?.id ?? null,
      structureId,
      lignes,
      jour,
    );
    return {
      lignes: this.lignesEvaluees(evaluation),
      refusees: evaluation.refus,
    };
  }

  /**
   * Enregistre un inventaire dans la transaction de l'appelant (D589 à D595).
   * Réutilisée par l'import d'inventaire.
   */
  async enregistrerDansTransaction(
    tx: Prisma.TransactionClient,
    acces: AccesPharmacie,
    entree: InventaireAEnregistrer,
    ip: string | null = null,
    options: { rejeterLignes?: boolean } = {},
  ): Promise<InventaireEcrit> {
    const structureId = acces.structure.id;
    const user = acces.user;
    const rejeter = options.rejeterLignes === true;

    // 1. Point de vente
    const existant = await tx.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
    });
    const pointDeVente =
      existant ?? (await assurerPointDeVente(tx, acces.structure)).pointDeVente;
    const pointDeVenteId = pointDeVente.id;

    // 2. Rejeu par identifiant client
    if (entree.id) {
      const deja = await tx.inventaire.findUnique({
        where: { id: entree.id },
        select: { id: true, pointDeVenteId: true },
      });
      if (deja) {
        if (deja.pointDeVenteId === pointDeVenteId) {
          return {
            inventaireId: deja.id,
            cree: false,
            lignes: [],
            refusees: [],
            anomalies: [],
            resolutions: [],
            avertissements: [],
          };
        }
        throw new ConflictException({
          message: MESSAGE_IDENTIFIANT_INVENTAIRE,
          code: 'IDENTIFIANT_DEJA_UTILISE',
        });
      }
    }

    // 3. Verrous de ligne des fiches, triés (D570)
    const ids = [...new Set(entree.lignes.map((l) => l.stockId))].sort();
    const fichesVerrouillees = new Map<string, Date | null>();
    for (const id of ids) {
      const lues = await tx.$queryRaw<
        { id: string; archiveLe: Date | null }[]
      >`SELECT "id", "archiveLe" FROM "StockMedicament" WHERE "id" = ${id} AND "structureId" = ${structureId} FOR NO KEY UPDATE`;
      if (lues.length > 0) fichesVerrouillees.set(id, lues[0].archiveLe);
    }
    if (!rejeter) {
      const absentes = ids.filter((id) => !fichesVerrouillees.has(id));
      if (absentes.length > 0) {
        throw new NotFoundException({
          message: MESSAGE_STOCK_INTROUVABLE_INVENTAIRE,
          code: 'STOCK_INTROUVABLE',
          details: absentes.map((stockId) => ({ stockId })),
        });
      }
    }

    // 5. Verrous consultatifs
    await this.mouvementsStock.verrouillerFiches(tx, ids);

    // 6. Évaluation
    const jour = jourConakry(new Date());
    const evaluation = await this.evaluer(
      tx,
      pointDeVenteId,
      structureId,
      entree.lignes,
      jour,
    );

    // 7. Refus
    if (!rejeter) this.leverRefus(entree, evaluation);
    if (evaluation.plans.size === 0) {
      return {
        inventaireId: null,
        cree: false,
        lignes: [],
        refusees: evaluation.refus,
        anomalies: [],
        resolutions: [],
        avertissements: [],
      };
    }

    // 7 bis. Désarchivage d'une fiche dont une ligne retenue compte une quantité
    // non nulle. Fait après l'évaluation pour qu'une ligne refusée (mode
    // rejeterLignes) ne désarchive rien ; la ligne de la fiche est déjà
    // verrouillée (FOR NO KEY UPDATE), la mise à jour n'attend aucun verrou.
    for (const id of ids) {
      const archiveLe = fichesVerrouillees.get(id);
      if (!archiveLe) continue;
      const compte = (evaluation.retenues.get(id) ?? []).some(
        (c) => c.quantiteComptee > 0,
      );
      if (!compte) continue;
      await tx.stockMedicament.update({
        where: { id },
        data: { archiveLe: null },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'update',
          entityType: 'StockMedicament',
          entityId: id,
          ip: null,
          metadata: {
            avant: { archiveLe: archiveLe.toISOString() },
            apres: { archiveLe: null },
          },
        },
      });
    }

    // 8. Inventaire
    const inventaire = await tx.inventaire.create({
      data: {
        ...(entree.id ? { id: entree.id } : {}),
        pointDeVenteId,
        auteurId: user.id,
        commentaire: entree.commentaire,
      },
      select: { id: true },
    });
    const inventaireId = inventaire.id;
    const utilisateurNom = `${user.prenom} ${user.nom}`.trim();

    // 9. Écritures par fiche
    const lignesEcrites: InventaireEcrit['lignes'] = [];
    const anomalies: InventaireEcrit['anomalies'] = [];
    const resolutions: ResolutionEcrite[] = [];
    for (const stockId of [...evaluation.plans.keys()].sort()) {
      const plan = evaluation.plans.get(stockId) as PlanInventaireFiche;
      const fiche = evaluation.fiches.get(stockId) as FicheLue;
      const cibles = new Map(
        (evaluation.retenues.get(stockId) ?? []).map((c) => [c.index, c]),
      );
      const lotsConnus = new Map(
        (evaluation.lotsParFiche.get(stockId) ?? []).map((l) => [l.id, l]),
      );
      const reels = new Map<string, string>();

      for (const l of plan.lignes) {
        if (l.mouvement === null || l.lotId === null) continue;
        const evenementId = `inventaire:${inventaireId}:${l.index}`;
        if (l.nouveauLot) {
          const cible = cibles.get(l.index)?.cible;
          if (cible?.type !== 'NOUVEAU') continue;
          const { lot } = await this.mouvementsStock.creerLot(tx, {
            stockMedicamentId: stockId,
            pointDeVenteId,
            numeroLot: cible.numeroLot,
            dateExpiration: cible.dateExpiration
              ? jourVersDate(cible.dateExpiration)
              : null,
            quantite: l.mouvement,
            coutUnitaire: 0,
            coutAchatBoite: null,
            coefficientReception: fiche.coefficientBoite,
            fournisseurId: null,
            receptionId: null,
            lotTechnique: false,
            auteurId: user.id,
            pieceOrigineType: 'INVENTAIRE',
            pieceOrigineId: inventaireId,
            motif: null,
            evenementId,
            dateReception: new Date(evaluation.dateReceptionNouveaux),
            typeMouvement: 'INVENTAIRE',
          });
          reels.set(l.lotId, lot.id);
        } else {
          await this.mouvementsStock.ecrire(tx, {
            evenementId,
            pointDeVenteId,
            stockMedicamentId: stockId,
            lotId: l.lotId,
            type: 'INVENTAIRE',
            quantite: l.mouvement,
            pieceOrigineType: 'INVENTAIRE',
            pieceOrigineId: inventaireId,
            motif: null,
            auteurId: user.id,
          });
          reels.set(l.lotId, l.lotId);
        }
      }

      if (plan.resolution.length > 0) {
        resolutions.push(
          ...(await ecrireResolutions(
            tx,
            this.mouvementsStock,
            {
              pointDeVenteId,
              stockId,
              pieceId: inventaireId,
              auteurId: user.id,
            },
            evaluation.provisoiresParFiche.get(stockId) ?? [],
            plan.resolution.map((r) => ({
              ...r,
              prises: r.prises.map((p) => ({
                ...p,
                lotId: reels.get(p.lotId) ?? p.lotId,
              })),
            })),
          )),
        );
      }

      const lotReel = (lotId: string | null) =>
        lotId === null ? null : (reels.get(lotId) ?? lotId);
      let anomalieId: string | null = null;
      if (!plan.sousTolerance) {
        const detailLots = plan.lignes
          .filter((l) => l.lotId !== null)
          .map((l) => {
            const cible = cibles.get(l.index)?.cible;
            const connu = l.nouveauLot
              ? undefined
              : lotsConnus.get(l.lotId as string);
            return {
              lotId: lotReel(l.lotId),
              numeroLot:
                cible?.type === 'NOUVEAU'
                  ? cible.numeroLot
                  : (connu?.numeroLot ?? null),
              dateExpiration:
                cible?.type === 'NOUVEAU'
                  ? cible.dateExpiration
                  : (connu?.dateExpiration ?? null),
              quantiteTheorique: l.quantiteTheorique,
              quantiteComptee: l.quantiteComptee,
              ecart: l.ecart,
            };
          });
        const anomalie = await tx.anomalie.create({
          data: {
            pointDeVenteId,
            type: 'ECART_INVENTAIRE',
            attribueeAId: user.id,
            pieceType: 'INVENTAIRE',
            pieceId: inventaireId,
            details: {
              stockId,
              nom: fiche.nom,
              ecart: plan.ecartFiche,
              tolerance: fiche.toleranceInventaire ?? 0,
              utilisateurId: user.id,
              utilisateurNom,
              lignes: detailLots,
            },
          },
          select: { id: true },
        });
        anomalieId = anomalie.id;
        anomalies.push({ id: anomalie.id, stockId });
      }

      await tx.ligneInventaire.createMany({
        data: plan.lignes.map((l) => ({
          inventaireId,
          stockMedicamentId: stockId,
          lotId: lotReel(l.lotId),
          quantiteTheorique: l.quantiteTheorique,
          quantiteComptee: l.quantiteComptee,
          ecart: l.ecart,
          sousTolerance: plan.sousTolerance,
          anomalieId,
        })),
      });
      for (const l of plan.lignes) {
        lignesEcrites.push({
          index: l.index,
          stockId,
          lotId: lotReel(l.lotId),
          nouveauLot: l.nouveauLot,
          soldeAvant: l.soldeAvant,
          quantiteTheorique: l.quantiteTheorique,
          quantiteComptee: l.quantiteComptee,
          ecart: l.ecart,
          sousTolerance: plan.sousTolerance,
          anomalieId,
        });
      }
    }
    lignesEcrites.sort((a, b) => a.index - b.index);

    // 10. Audit (aucun coût)
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'create',
        entityType: 'Inventaire',
        entityId: inventaireId,
        ip,
        metadata: {
          nombreLignes: lignesEcrites.length,
          nombreFiches: evaluation.plans.size,
          nombreAnomalies: anomalies.length,
          ...(resolutions.length > 0
            ? { nombreResolutions: resolutions.length }
            : {}),
        },
      },
    });

    // 11. Avertissements non bloquants
    const avertissements: AvertissementReception[] = [
      ...evaluation.plans.keys(),
    ]
      .sort()
      .filter((stockId) => {
        const fiche = evaluation.fiches.get(stockId) as FicheLue;
        return (
          !fiche.qualifie &&
          (evaluation.retenues.get(stockId) ?? []).some(
            (c) => entree.lignes[c.index].nombreBoites !== null,
          )
        );
      })
      .map((stockId) => ({
        code: 'FICHE_NON_QUALIFIEE' as const,
        stockId,
        nom: (evaluation.fiches.get(stockId) as FicheLue).nom,
        message: MESSAGE_FICHE_NON_QUALIFIEE,
      }));

    return {
      inventaireId,
      cree: true,
      lignes: lignesEcrites,
      refusees: evaluation.refus,
      anomalies,
      resolutions,
      avertissements,
    };
  }

  /** Lève le premier groupe de refus, toutes les lignes du code citées (7). */
  private leverRefus(
    entree: InventaireAEnregistrer,
    evaluation: Evaluation,
  ): void {
    const nom = (index: number) =>
      evaluation.fiches.get(entree.lignes[index].stockId)?.nom ?? '';
    const stockId = (index: number) => entree.lignes[index].stockId;
    for (const code of ORDRE_REFUS) {
      const refus = evaluation.refus.filter((r) => r.code === code);
      if (refus.length === 0) continue;
      const validation = (message: string, champ: string, contrainte: string) =>
        new BadRequestException({
          message,
          code: 'VALIDATION',
          champs: refus.map((r) => ({
            champ: `lignes.${r.index}.${champ}`,
            contraintes: [contrainte],
          })),
        });
      switch (code) {
        case 'LOT_INTROUVABLE':
          throw new NotFoundException(MESSAGE_LOT_INTROUVABLE_INVENTAIRE);
        case 'LOT_REQUIS':
          throw new ConflictException({
            message: MESSAGE_INVENTAIRE_LOT_REQUIS,
            code: 'LOT_REQUIS',
            details: refus.map((r) => ({
              stockId: stockId(r.index),
              nom: nom(r.index),
              lots: r.lots ?? [],
            })),
          });
        case 'DATE_PEREMPTION_REQUISE':
          throw new BadRequestException({
            message: MESSAGE_INVENTAIRE_DATE_REQUISE,
            code: 'DATE_PEREMPTION_REQUISE',
            details: refus.map((r) => ({
              stockId: stockId(r.index),
              nom: nom(r.index),
            })),
          });
        case 'LOT_INCONNU_VIDE':
          throw validation(
            MESSAGE_LOT_INCONNU_VIDE,
            'quantiteComptee',
            'lotInconnuVide',
          );
        case 'LOT_EN_DOUBLE':
          throw validation(MESSAGE_LOT_COMPTE_DEUX_FOIS, 'lotId', 'lotUnique');
        default:
          throw validation(
            MESSAGE_QUANTITE_COMPTEE_TROP_GRANDE,
            'quantiteComptee',
            'quantiteMaximale',
          );
      }
    }
  }

  async enregistrer(
    structureId: string,
    userId: string,
    dto: CreerInventaireDto,
    ip?: string | null,
  ) {
    const acces = await this.accesPharmacie.verifier(structureId, userId);
    const lignes: LigneInventaireAEnregistrer[] = dto.lignes.map((l) => ({
      stockId: l.stockId,
      lotId: l.lotId ?? null,
      numeroLot: l.numeroLot?.trim() ? l.numeroLot.trim() : null,
      dateExpiration: l.dateExpiration ?? null,
      sansPeremption: l.sansPeremption ?? false,
      quantiteComptee: l.quantiteComptee ?? null,
      nombreBoites: l.nombreBoites ?? null,
      unitesEnPlus: l.unitesEnPlus ?? null,
    }));
    this.controlerForme(lignes);
    const entree: InventaireAEnregistrer = {
      id: dto.id,
      commentaire: dto.commentaire?.trim() ? dto.commentaire.trim() : null,
      lignes,
    };

    let ecrit: InventaireEcrit;
    try {
      ecrit = await this.prisma.$transaction(
        (tx) => this.enregistrerDansTransaction(tx, acces, entree, ip ?? null),
        OPTIONS_TRANSACTION_INVENTAIRE,
      );
    } catch (erreur) {
      if (!dto.id || !estDoublonSur(erreur, 'Inventaire')) throw erreur;
      // Course : un autre appel a inséré cet identifiant entre-temps.
      const autre = await this.prisma.inventaire.findUnique({
        where: { id: dto.id },
        select: { pointDeVente: { select: { structureId: true } } },
      });
      if (autre?.pointDeVente.structureId !== structureId) {
        throw new ConflictException({
          message: MESSAGE_IDENTIFIANT_INVENTAIRE,
          code: 'IDENTIFIANT_DEJA_UTILISE',
        });
      }
      ecrit = {
        inventaireId: dto.id,
        cree: false,
        lignes: [],
        refusees: [],
        anomalies: [],
        resolutions: [],
        avertissements: [],
      };
    }
    if (ecrit.inventaireId === null) {
      throw new Error("Aucun inventaire n'a été enregistré.");
    }

    const presente = await this.presenter(this.prisma, ecrit.inventaireId);
    return {
      data: {
        ...presente,
        cree: ecrit.cree,
        avertissements: ecrit.avertissements,
      },
      message: ecrit.cree
        ? messageInventaireEnregistre(
            ecrit.lignes.length,
            ecrit.anomalies.length,
          ) +
          (ecrit.resolutions.length > 0
            ? ` ${MESSAGE_VENTES_RATTACHEES_INVENTAIRE}`
            : '')
        : MESSAGE_INVENTAIRE_REJOUE,
      success: true as const,
    };
  }

  private async presenter(client: ClientLecture, inventaireId: string) {
    const inventaire = await client.inventaire.findUniqueOrThrow({
      where: { id: inventaireId },
      select: {
        id: true,
        createdAt: true,
        commentaire: true,
        auteurId: true,
        lignes: {
          select: {
            id: true,
            stockMedicamentId: true,
            stockMedicament: {
              select: { medicament: { select: { nom: true } } },
            },
            lotId: true,
            lot: {
              select: {
                numeroLot: true,
                dateExpiration: true,
                lotTechnique: true,
              },
            },
            quantiteTheorique: true,
            quantiteComptee: true,
            ecart: true,
            sousTolerance: true,
            anomalieId: true,
          },
        },
      },
    });
    const auteur = await client.user.findUnique({
      where: { id: inventaire.auteurId },
      select: { nom: true, prenom: true },
    });
    const lignes = inventaire.lignes.map((l) => ({
      id: l.id,
      stockId: l.stockMedicamentId,
      nom: l.stockMedicament.medicament.nom,
      lotId: l.lotId,
      numeroLot: l.lot?.numeroLot ?? null,
      dateExpiration: l.lot?.dateExpiration
        ? dateVersJour(l.lot.dateExpiration)
        : null,
      lotTechnique: l.lot?.lotTechnique ?? false,
      quantiteTheorique: l.quantiteTheorique,
      quantiteComptee: l.quantiteComptee,
      ecart: l.ecart,
      sousTolerance: l.sousTolerance,
      anomalieId: l.anomalieId,
    }));
    lignes.sort(
      (a, b) =>
        (a.nom !== b.nom ? (a.nom < b.nom ? -1 : 1) : 0) ||
        comparerNullable(a.dateExpiration, b.dateExpiration) ||
        comparerNullable(a.numeroLot, b.numeroLot) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    const noms = new Map(lignes.map((l) => [l.stockId, l.nom]));
    const anomalies = (
      await client.anomalie.findMany({
        where: {
          type: 'ECART_INVENTAIRE',
          pieceType: 'INVENTAIRE',
          pieceId: inventaireId,
        },
        select: { id: true, statut: true, details: true },
      })
    )
      .map((a) => {
        const d = (a.details ?? {}) as { stockId?: unknown; ecart?: unknown };
        const stockId = typeof d.stockId === 'string' ? d.stockId : '';
        return {
          id: a.id,
          stockId,
          nom: noms.get(stockId) ?? '',
          ecart: typeof d.ecart === 'number' ? d.ecart : 0,
          statut: a.statut,
        };
      })
      .sort((a, b) =>
        a.nom !== b.nom ? (a.nom < b.nom ? -1 : 1) : a.id < b.id ? -1 : 1,
      );

    return {
      id: inventaire.id,
      createdAt: inventaire.createdAt,
      commentaire: inventaire.commentaire,
      auteur: {
        id: inventaire.auteurId,
        nom: auteur ? `${auteur.prenom} ${auteur.nom}`.trim() : '',
      },
      lignes,
      anomalies,
      resolutions: await lireResolutionsDePiece(client, inventaireId),
    };
  }

  async detail(structureId: string, userId: string, inventaireId: string) {
    await this.accesPharmacie.verifier(structureId, userId);
    const existe = await this.prisma.inventaire.findFirst({
      where: { id: inventaireId, pointDeVente: { structureId } },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException(MESSAGE_INVENTAIRE_INTROUVABLE);
    return {
      data: await this.presenter(this.prisma, inventaireId),
      message: 'Inventaire trouvé.',
      success: true as const,
    };
  }

  async lister(structureId: string, userId: string, dto: ListerInventairesDto) {
    await this.accesPharmacie.verifier(structureId, userId);
    const page = dto.page ?? 1;
    const pointDeVente = await this.prisma.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });
    let inventaires: {
      id: string;
      createdAt: Date;
      commentaire: string | null;
      auteur: { id: string; nom: string };
      nombreLignes: number;
      nombreEcarts: number;
      nombreAnomalies: number;
    }[] = [];
    let total = 0;
    if (pointDeVente) {
      const [lues, nombre] = await Promise.all([
        this.prisma.inventaire.findMany({
          where: { pointDeVenteId: pointDeVente.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * PAR_PAGE,
          take: PAR_PAGE,
          select: {
            id: true,
            createdAt: true,
            commentaire: true,
            auteurId: true,
            lignes: { select: { ecart: true, anomalieId: true } },
          },
        }),
        this.prisma.inventaire.count({
          where: { pointDeVenteId: pointDeVente.id },
        }),
      ]);
      total = nombre;
      const auteurs = new Map(
        (
          await this.prisma.user.findMany({
            where: { id: { in: [...new Set(lues.map((i) => i.auteurId))] } },
            select: { id: true, nom: true, prenom: true },
          })
        ).map((u) => [u.id, `${u.prenom} ${u.nom}`.trim()]),
      );
      inventaires = lues.map((i) => ({
        id: i.id,
        createdAt: i.createdAt,
        commentaire: i.commentaire,
        auteur: { id: i.auteurId, nom: auteurs.get(i.auteurId) ?? '' },
        nombreLignes: i.lignes.length,
        nombreEcarts: i.lignes.filter((l) => l.ecart !== 0).length,
        nombreAnomalies: new Set(
          i.lignes.map((l) => l.anomalieId).filter((a) => a !== null),
        ).size,
      }));
    }
    return {
      data: { inventaires, page, parPage: PAR_PAGE, total },
      message: `${total} inventaire(s)`,
      success: true as const,
    };
  }
}
