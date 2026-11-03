import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, StockMedicament } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from './acces-pharmacie.service';
import { assurerPointDeVente } from './point-de-vente';
import type { Reponse } from './points-de-vente.service';
import { avertissementEcartPrix, type AvertissementPrix } from './domaine/prix';
import {
  ModifierFicheDto,
  type ConversionStock,
} from './dto/fiche-produit.dto';
import {
  aDuStock,
  planifierMultiplication,
  type LotAConvertir,
  type PlanMultiplication,
} from './domaine/qualification';
import { MouvementsStockService } from './stock/mouvements-stock.service';

export const MESSAGE_FICHE_INTROUVABLE =
  'Ce médicament est introuvable dans le stock de cette pharmacie.';
export const MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT =
  "Un prix à l'unité n'est possible que si ce médicament se vend aussi à l'unité. Activez la vente à l'unité ou retirez le prix à l'unité.";
export const MESSAGE_CONVERSION_REQUISE =
  "Ce médicament a du stock : précisez comment convertir le stock existant avant de changer le nombre d'unités par boîte.";
export const MESSAGE_FICHE_DEJA_QUALIFIEE =
  "Ce médicament est déjà qualifié : son stock n'est plus converti. Enregistrez le nouveau nombre d'unités par boîte sans conversion : il vaudra pour les prochaines réceptions.";
export const MESSAGE_CONVERSION_IMPOSSIBLE =
  'Le stock de ce médicament ne vient pas seulement de la reprise initiale : il ne peut pas être multiplié automatiquement. Choisissez « Conserver », puis corrigez la quantité en unités par un inventaire.';
export const MESSAGE_CONVERSION_TROP_GRANDE =
  "La conversion donnerait une quantité trop grande pour être enregistrée. Vérifiez le nombre d'unités par boîte.";
export const MESSAGE_UNITE_CHANGEMENT_AVEC_STOCK =
  "Ce médicament a du stock compté dans une autre unité : changer l'unité fausserait les quantités. Comptez-le à 0 par un inventaire, changez l'unité, puis enregistrez la prochaine livraison.";
function refusUniteAvecStock(): ConflictException {
  return new ConflictException({
    message: MESSAGE_UNITE_CHANGEMENT_AVEC_STOCK,
    code: 'UNITE_CHANGEMENT_AVEC_STOCK',
  });
}
export const MESSAGE_FICHE_ENREGISTREE = 'Fiche produit enregistrée.';
export const MESSAGE_AUCUNE_MODIFICATION =
  'Aucune modification de la fiche produit.';
export const MESSAGE_STOCK_CONSERVE =
  'Fiche produit enregistrée. Le stock existant est gardé tel quel, compté en unités.';
export function messageStockMultiplie(quantite: number): string {
  return `Fiche produit enregistrée. Le stock existant a été converti : ${quantite} unités.`;
}

const INCLUDE_FICHE = {
  medicament: { select: { id: true, nom: true, categorie: true } },
} satisfies Prisma.StockMedicamentInclude;

export type FicheAvecMedicament = Prisma.StockMedicamentGetPayload<{
  include: typeof INCLUDE_FICHE;
}>;
export interface ConversionAppliquee {
  mode: ConversionStock;
  coefficientAvant: number;
  coefficientApres: number;
  quantiteAvant: number;
  quantiteApres: number;
  lots: { lotId: string; quantiteAvant: number; quantiteApres: number }[];
}
export type FicheReponse = FicheAvecMedicament & {
  avertissements: AvertissementPrix[];
  conversion: ConversionAppliquee | null;
};

type ChampFiche =
  | 'prixUnitaire'
  | 'prixUnite'
  | 'coefficientBoite'
  | 'uniteMinimale'
  | 'deconditionnable'
  | 'toleranceInventaire'
  | 'qualifie';

const CHAMPS_FICHE: ChampFiche[] = [
  'prixUnitaire',
  'prixUnite',
  'coefficientBoite',
  'uniteMinimale',
  'deconditionnable',
  'toleranceInventaire',
  'qualifie',
];

/** Valeurs avant et après d'une modification, écrites dans le journal d'audit. */
type ValeursFiche = Record<string, string | number | boolean | null>;

@Injectable()
export class FicheProduitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
  ) {}

  /** Lots à solde positif et agrégats produit d'une fiche, à lire sous ses verrous. */
  private async lireStockFiche(
    tx: Prisma.TransactionClient,
    stockId: string,
  ): Promise<{
    lots: LotAConvertir[];
    produits: { pointDeVenteId: string; quantite: number }[];
  }> {
    const lotsLus = await tx.lotStock.findMany({
      where: {
        stockMedicamentId: stockId,
        agregat: { is: { quantite: { gt: 0 } } },
      },
      select: {
        id: true,
        pointDeVenteId: true,
        lotTechnique: true,
        coefficientReception: true,
        coutUnitaire: true,
        agregat: { select: { quantite: true } },
      },
    });
    const lots: LotAConvertir[] = lotsLus.map((l) => ({
      lotId: l.id,
      pointDeVenteId: l.pointDeVenteId,
      lotTechnique: l.lotTechnique,
      coefficientReception: l.coefficientReception,
      coutUnitaire: l.coutUnitaire,
      solde: l.agregat?.quantite ?? 0,
    }));
    const produits = await tx.agregatStockProduit.findMany({
      where: { stockMedicamentId: stockId },
      select: { pointDeVenteId: true, quantite: true },
    });
    return { lots, produits };
  }

  async modifierFiche(
    structureId: string,
    userId: string,
    stockId: string,
    dto: ModifierFicheDto,
    ip?: string,
  ): Promise<Reponse<FicheReponse>> {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );

    const { fiche, seuil, modifiee, conversion } =
      await this.prisma.$transaction(async (tx) => {
        const verrou = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structure.id} AND "archiveLe" IS NULL FOR NO KEY UPDATE`;
        if (verrou.length === 0) {
          throw new NotFoundException(MESSAGE_FICHE_INTROUVABLE);
        }

        const existante = await tx.stockMedicament.findUniqueOrThrow({
          where: { id: stockId },
          include: INCLUDE_FICHE,
        });

        const voulus: Pick<StockMedicament, ChampFiche> = {
          prixUnitaire:
            dto.prixUnitaire !== undefined
              ? dto.prixUnitaire
              : existante.prixUnitaire,
          prixUnite:
            dto.prixUnite !== undefined ? dto.prixUnite : existante.prixUnite,
          toleranceInventaire:
            dto.toleranceInventaire !== undefined
              ? dto.toleranceInventaire
              : existante.toleranceInventaire,
          coefficientBoite: dto.coefficientBoite ?? existante.coefficientBoite,
          uniteMinimale: dto.uniteMinimale ?? existante.uniteMinimale,
          deconditionnable: dto.deconditionnable ?? existante.deconditionnable,
          qualifie: dto.qualifie ?? existante.qualifie,
        };

        if (!voulus.deconditionnable && voulus.prixUnite !== null) {
          throw new BadRequestException({
            message: MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT,
            code: 'PRIX_UNITE_SANS_DECONDITIONNEMENT',
          });
        }

        const coefficientChange =
          voulus.coefficientBoite !== existante.coefficientBoite;
        if (
          coefficientChange &&
          existante.qualifie &&
          dto.conversionStock !== undefined
        ) {
          throw new ConflictException({
            message: MESSAGE_FICHE_DEJA_QUALIFIEE,
            code: 'FICHE_DEJA_QUALIFIEE',
          });
        }

        const uniteChange = voulus.uniteMinimale !== existante.uniteMinimale;
        let conversion: ConversionAppliquee | null = null;
        let plan: Extract<PlanMultiplication, { ok: true }> | null = null;
        let maintenant = new Date();
        if (uniteChange && !(coefficientChange && !existante.qualifie)) {
          // Unité seule : le stock compté dans l'ancienne unité ne peut pas changer de sens (D724)
          await this.mouvementsStock.verrouillerFiches(tx, [stockId]);
          const { lots, produits } = await this.lireStockFiche(tx, stockId);
          // Reprise non qualifiée en UNITE à 1 par boîte : valeur par défaut, aucun chiffre ne change de sens
          const priseEnCharge =
            !existante.qualifie &&
            existante.uniteMinimale === 'UNITE' &&
            existante.coefficientBoite === 1 &&
            !coefficientChange;
          if (!priseEnCharge && aDuStock(produits, lots)) {
            throw refusUniteAvecStock();
          }
        }
        if (coefficientChange && !existante.qualifie) {
          await this.mouvementsStock.verrouillerFiches(tx, [stockId]);
          const [{ maintenant: horloge }] = await tx.$queryRaw<
            { maintenant: Date }[]
          >`SELECT clock_timestamp() AS "maintenant"`;
          maintenant = horloge;
          const { lots, produits } = await this.lireStockFiche(tx, stockId);
          const stock = aDuStock(produits, lots);
          if (stock && dto.conversionStock === undefined) {
            throw new BadRequestException({
              message: MESSAGE_CONVERSION_REQUISE,
              code: 'CONVERSION_REQUISE',
            });
          }
          // Changement d'unité avec du stock : seule la conversion d'une fiche de la reprise (UNITE, 1 par boîte) le permet (D724)
          if (
            uniteChange &&
            stock &&
            !(
              dto.conversionStock !== undefined &&
              existante.uniteMinimale === 'UNITE' &&
              existante.coefficientBoite === 1
            )
          ) {
            throw refusUniteAvecStock();
          }
          if (dto.conversionStock !== undefined) {
            voulus.qualifie = true;
            const quantiteAvant = produits.reduce(
              (somme, p) => somme + p.quantite,
              0,
            );
            if (dto.conversionStock === 'CONSERVER' || !stock) {
              conversion = {
                mode: dto.conversionStock,
                coefficientAvant: existante.coefficientBoite,
                coefficientApres: voulus.coefficientBoite,
                quantiteAvant,
                quantiteApres: quantiteAvant,
                lots: [],
              };
            } else {
              // Le stock repris compte des boîtes seulement si la fiche comptait 1 unité par boîte (D565)
              if (existante.coefficientBoite !== 1) {
                throw new ConflictException({
                  message: MESSAGE_CONVERSION_IMPOSSIBLE,
                  code: 'CONVERSION_IMPOSSIBLE',
                });
              }
              const calcul = planifierMultiplication(
                voulus.coefficientBoite,
                produits,
                lots,
              );
              if (!calcul.ok) {
                throw new ConflictException({
                  message:
                    calcul.code === 'STOCK_NON_CONVERTIBLE'
                      ? MESSAGE_CONVERSION_IMPOSSIBLE
                      : MESSAGE_CONVERSION_TROP_GRANDE,
                  code: 'CONVERSION_IMPOSSIBLE',
                });
              }
              plan = calcul;
              conversion = {
                mode: 'MULTIPLIER',
                coefficientAvant: existante.coefficientBoite,
                coefficientApres: voulus.coefficientBoite,
                quantiteAvant: calcul.quantiteAvant,
                quantiteApres: calcul.quantiteApres,
                lots: calcul.lots.map(
                  ({ lotId, quantiteAvant: avant, quantiteApres: apres }) => ({
                    lotId,
                    quantiteAvant: avant,
                    quantiteApres: apres,
                  }),
                ),
              };
            }
          }
        }

        const parametres =
          (await tx.parametresPharmacie.findUnique({
            where: { structureId: structure.id },
          })) ?? (await assurerPointDeVente(tx, structure)).parametres;

        const changes = CHAMPS_FICHE.filter((c) => voulus[c] !== existante[c]);
        if (changes.length === 0) {
          return {
            fiche: existante,
            seuil: parametres.seuilAvertissementPrixPct,
            modifiee: false,
            conversion: null,
          };
        }

        const avant: ValeursFiche = {};
        const apres: ValeursFiche = {};
        for (const c of changes) {
          avant[c] = existante[c];
          apres[c] = voulus[c];
        }

        if (plan) {
          for (const l of plan.lots) {
            if (l.correction > 0) {
              await this.mouvementsStock.qualifierLotTechnique(tx, {
                lotId: l.lotId,
                stockMedicamentId: stockId,
                pointDeVenteId: l.pointDeVenteId,
                coefficient: voulus.coefficientBoite,
                coutUnitaire: l.coutUnitaireApres,
                correction: l.correction,
                auteurId: user.id,
                horodatageServeur: maintenant,
              });
            }
          }
        }
        const misAJour = await tx.stockMedicament.update({
          where: { id: stockId },
          data: voulus,
          include: INCLUDE_FICHE,
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'update',
            entityType: 'StockMedicament',
            entityId: stockId,
            ip: ip ?? null,
            metadata: conversion
              ? { avant, apres, conversion: { ...conversion } }
              : { avant, apres },
          },
        });
        return {
          fiche: misAJour,
          seuil: parametres.seuilAvertissementPrixPct,
          modifiee: true,
          conversion,
        };
      });

    const avertissement = avertissementEcartPrix(
      fiche.prixUnitaire,
      fiche.prixUnite,
      fiche.coefficientBoite,
      seuil,
    );
    return {
      data: {
        ...fiche,
        avertissements: avertissement ? [avertissement] : [],
        // Quantités écrêtées à la réponse seulement ; l'audit garde la vérité (D717)
        conversion: conversion
          ? {
              ...conversion,
              quantiteAvant: Math.max(0, conversion.quantiteAvant),
              quantiteApres: Math.max(0, conversion.quantiteApres),
              lots: conversion.lots.map((l) => ({
                lotId: l.lotId,
                quantiteAvant: Math.max(0, l.quantiteAvant),
                quantiteApres: Math.max(0, l.quantiteApres),
              })),
            }
          : null,
      },
      message: !modifiee
        ? MESSAGE_AUCUNE_MODIFICATION
        : conversion && conversion.quantiteAvant !== 0
          ? conversion.mode === 'MULTIPLIER'
            ? messageStockMultiplie(Math.max(0, conversion.quantiteApres))
            : MESSAGE_STOCK_CONSERVE
          : MESSAGE_FICHE_ENREGISTREE,
      success: true,
    };
  }
}
