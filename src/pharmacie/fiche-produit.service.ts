import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, StockMedicament } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from './acces-pharmacie.service';
import { assurerPointDeVente } from './point-de-vente';
import type { Reponse } from './points-de-vente.service';
import { avertissementEcartPrix, type AvertissementPrix } from './domaine/prix';
import { ModifierFicheDto } from './dto/fiche-produit.dto';

export const MESSAGE_FICHE_INTROUVABLE =
  'Ce médicament est introuvable dans le stock de cette pharmacie.';
export const MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT =
  "Un prix à l'unité n'est possible que si ce médicament se vend aussi à l'unité. Activez la vente à l'unité ou retirez le prix à l'unité.";
export const MESSAGE_CONVERSION_REQUISE =
  "Ce médicament a du stock : précisez comment convertir le stock existant avant de changer le nombre d'unités par boîte.";

const INCLUDE_FICHE = {
  medicament: { select: { id: true, nom: true, categorie: true } },
} satisfies Prisma.StockMedicamentInclude;

export type FicheAvecMedicament = Prisma.StockMedicamentGetPayload<{
  include: typeof INCLUDE_FICHE;
}>;
export type FicheReponse = FicheAvecMedicament & {
  avertissements: AvertissementPrix[];
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
  ) {}

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

    const { fiche, seuil, modifiee } = await this.prisma.$transaction(
      async (tx) => {
        const verrou = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structure.id} AND "archiveLe" IS NULL FOR UPDATE`;
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

        if (
          voulus.coefficientBoite !== existante.coefficientBoite &&
          !existante.qualifie &&
          existante.quantite !== 0
        ) {
          throw new BadRequestException({
            message: MESSAGE_CONVERSION_REQUISE,
            code: 'CONVERSION_REQUISE',
          });
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
          };
        }

        const avant: ValeursFiche = {};
        const apres: ValeursFiche = {};
        for (const c of changes) {
          avant[c] = existante[c];
          apres[c] = voulus[c];
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
            metadata: { avant, apres },
          },
        });
        return {
          fiche: misAJour,
          seuil: parametres.seuilAvertissementPrixPct,
          modifiee: true,
        };
      },
    );

    const avertissement = avertissementEcartPrix(
      fiche.prixUnitaire,
      fiche.prixUnite,
      fiche.coefficientBoite,
      seuil,
    );
    return {
      data: { ...fiche, avertissements: avertissement ? [avertissement] : [] },
      message: modifiee
        ? 'Fiche produit enregistrée.'
        : 'Aucune modification de la fiche produit.',
      success: true,
    };
  }
}
