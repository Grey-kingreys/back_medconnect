import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import { jourConakry } from '../jour-metier';
import { masquerCouts } from '../masquer-couts';
import { dateVersJour, jourVersDate } from '../stock/lecture-stock';
import { jourValide } from '../domaine/reception';
import { calculerMarge, type VenteMarge } from '../domaine/marge';
import {
  classerAlertesPeremption,
  joursEntre,
  type LotAlerte,
} from '../domaine/peremption';
import type { RapportMargeQueryDto } from '../dto/rapports.dto';

export const PERIODE_MARGE_MAX_JOURS = 92;
export const HORIZONS_PAR_DEFAUT = [90, 30, 7];
export const MESSAGE_JOUR_INVALIDE =
  "Cette date n'existe pas. Utilisez le format AAAA-MM-JJ (exemple : 2026-10-01).";
export const MESSAGE_PERIODE_INVERSEE =
  'La date de début doit être avant la date de fin.';
export const MESSAGE_PERIODE_TROP_LONGUE =
  'La période ne peut pas dépasser 92 jours. Choisissez un mois ou un trimestre.';

function refus(champ: string, contrainte: string, message: string) {
  return new BadRequestException({
    message,
    code: 'VALIDATION',
    champs: [{ champ, contraintes: [contrainte] }],
  });
}

@Injectable()
export class RapportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly permissions: PermissionsService,
  ) {}

  private async peutVoirMarge(userId: string): Promise<boolean> {
    return (await this.permissions.getUserPermissions(userId)).includes(
      PERMISSIONS.MARGE_READ,
    );
  }

  async alertesPeremption(structureId: string, userId: string) {
    await this.accesPharmacie.verifier(structureId, userId);
    const peutVoirMarge = await this.peutVoirMarge(userId);
    const jour = jourConakry(new Date());

    const parametres = await this.prisma.parametresPharmacie.findUnique({
      where: { structureId },
      select: { horizonsPeremptionJours: true },
    });
    const horizons = parametres?.horizonsPeremptionJours?.length
      ? parametres.horizonsPeremptionJours
      : HORIZONS_PAR_DEFAUT;

    const pointDeVente = await this.prisma.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });

    let lots: LotAlerte[] = [];
    if (pointDeVente) {
      const max = Math.max(...horizons);
      const limite = new Date(jourVersDate(jour).getTime() + max * 86_400_000);
      const lus = await this.prisma.lotStock.findMany({
        where: {
          pointDeVenteId: pointDeVente.id,
          agregat: { is: { quantite: { gt: 0 } } },
          OR: [{ dateExpiration: null }, { dateExpiration: { lte: limite } }],
        },
        select: {
          id: true,
          stockMedicamentId: true,
          numeroLot: true,
          dateExpiration: true,
          coefficientReception: true,
          coutUnitaire: true,
          lotTechnique: true,
          agregat: { select: { quantite: true } },
          stockMedicament: {
            select: {
              prixUnitaire: true,
              archiveLe: true,
              medicament: { select: { nom: true } },
            },
          },
        },
      });
      lots = lus.map((l) => ({
        lotId: l.id,
        stockId: l.stockMedicamentId,
        nom: l.stockMedicament.medicament.nom,
        numeroLot: l.numeroLot,
        dateExpiration: l.dateExpiration
          ? dateVersJour(l.dateExpiration)
          : null,
        quantite: l.agregat?.quantite ?? 0,
        coefficientReception: l.coefficientReception,
        prixBoite: l.stockMedicament.prixUnitaire,
        coutUnitaire: l.coutUnitaire,
        lotTechnique: l.lotTechnique,
        ficheArchivee: l.stockMedicament.archiveLe !== null,
      }));
    }

    const resultat = classerAlertesPeremption(lots, horizons, jour);
    const n =
      resultat.horizons.reduce((s, h) => s + h.nombreLots, 0) +
      resultat.perimes.nombreLots;
    return {
      data: masquerCouts(resultat, peutVoirMarge),
      message: `${n} lot(s) à surveiller.`,
      success: true as const,
    };
  }

  async rapportMarge(
    structureId: string,
    userId: string,
    dto: RapportMargeQueryDto,
  ) {
    await this.accesPharmacie.verifier(structureId, userId);
    const aujourdhui = jourConakry(new Date());
    const au = dto.au ?? aujourdhui;
    const du = dto.du ?? au.slice(0, 8) + '01';

    if (!jourValide(du)) {
      throw refus('du', 'jourInvalide', MESSAGE_JOUR_INVALIDE);
    }
    if (!jourValide(au)) {
      throw refus('au', 'jourInvalide', MESSAGE_JOUR_INVALIDE);
    }
    if (du > au) {
      throw refus('du', 'periodeInversee', MESSAGE_PERIODE_INVERSEE);
    }
    if (joursEntre(du, au) + 1 > PERIODE_MARGE_MAX_JOURS) {
      throw refus('au', 'periodeMaximale', MESSAGE_PERIODE_TROP_LONGUE);
    }

    const parametres = await this.prisma.parametresPharmacie.findUnique({
      where: { structureId },
      select: { debutFiabiliteMarge: true },
    });
    const debutFiabilite = parametres
      ? dateVersJour(parametres.debutFiabiliteMarge)
      : null;

    const pointDeVente = await this.prisma.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });

    const ventes = pointDeVente
      ? await this.prisma.vente.findMany({
          where: {
            pointDeVenteId: pointDeVente.id,
            jourMetier: { gte: jourVersDate(du), lte: jourVersDate(au) },
            statut: 'VALIDEE',
          },
          select: {
            id: true,
            lignes: {
              select: {
                sousTotal: true,
                allocations: {
                  select: {
                    quantite: true,
                    coutUnitaire: true,
                    lotTechnique: true,
                    statut: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const piecesMarge: VenteMarge[] = ventes.map((v) => ({
      id: v.id,
      lignes: v.lignes.map((l) => ({
        montantLigne: l.sousTotal,
        allocations: l.allocations,
      })),
    }));
    const resultat = calculerMarge(piecesMarge);
    const chiffreAffairesTotal = ventes.reduce(
      (s, v) => s + v.lignes.reduce((t, l) => t + l.sousTotal, 0),
      0,
    );

    return {
      data: {
        du,
        au,
        debutFiabilite,
        periodeAvantFiabilite: debutFiabilite !== null && du < debutFiabilite,
        nombrePieces: ventes.length,
        chiffreAffairesTotal,
        chiffreAffairesValorise: resultat.chiffreAffairesValorise,
        coutAlloue: resultat.coutAlloue,
        marge: resultat.marge,
        nonValorisable: resultat.nonValorisable,
        provisoires: resultat.provisoires,
      },
      message: `Marge du ${du} au ${au}.`,
      success: true as const,
    };
  }
}
