import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Anomalie, Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import {
  LIBELLES_ANOMALIE,
  etatRattachement,
  type Rattachement,
} from '../domaine/anomalies';
import type {
  ListerAnomaliesDto,
  TraiterAnomalieDto,
} from '../dto/anomalies.dto';
import { detailsLisibles } from './details-lisibles';

export const MESSAGE_ANOMALIE_INTROUVABLE = 'Cette anomalie est introuvable.';
export const MESSAGE_ANOMALIE_DEJA_TRAITEE =
  'Cette anomalie a déjà été traitée.';
export const MESSAGE_COMMENTAIRE_TRAITEMENT_REQUIS =
  'Indiquez ce qui a été vérifié ou fait (3 caractères au moins).';
export const MESSAGE_ANOMALIE_TRAITEE = 'Anomalie traitée.';

const PAR_PAGE = 20;

interface PersonneAnomalie {
  id: string;
  nom: string;
}

export interface ElementAnomalie {
  id: string;
  type: Anomalie['type'];
  libelle: string;
  statut: Anomalie['statut'];
  creeLe: Date;
  pieceType: string;
  pieceId: string | null;
  details: Prisma.JsonValue;
  attribueeA: PersonneAnomalie | null;
  traiteeLe: Date | null;
  traiteePar: PersonneAnomalie | null;
  commentaireTraitement: string | null;
  rattachement: Rattachement | null;
}

function nombreDe(valeur: unknown): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : 0;
}

function detailsEnObjet(details: Prisma.JsonValue): Record<string, unknown> {
  return details !== null &&
    typeof details === 'object' &&
    !Array.isArray(details)
    ? details
    : {};
}

@Injectable()
export class AnomaliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
  ) {}

  async lister(structureId: string, userId: string, dto: ListerAnomaliesDto) {
    await this.accesPharmacie.verifier(structureId, userId);
    const page = dto.page ?? 1;
    const pointDeVente = await this.prisma.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId, ordre: 1 } },
      select: { id: true },
    });
    if (!pointDeVente) {
      return {
        data: {
          anomalies: [] as ElementAnomalie[],
          page,
          parPage: PAR_PAGE,
          total: 0,
          ouvertes: 0,
        },
        message: '0 anomalie(s)',
        success: true as const,
      };
    }
    const where: Prisma.AnomalieWhereInput = {
      pointDeVenteId: pointDeVente.id,
      statut: dto.statut ?? 'OUVERTE',
      ...(dto.type ? { type: dto.type } : {}),
    };
    const [lignes, total, ouvertes] = await Promise.all([
      this.prisma.anomalie.findMany({
        where,
        orderBy: [{ creeLe: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAR_PAGE,
        take: PAR_PAGE,
      }),
      this.prisma.anomalie.count({ where }),
      this.prisma.anomalie.count({
        where: { pointDeVenteId: pointDeVente.id, statut: 'OUVERTE' },
      }),
    ]);
    const anomalies = await this.presenter(this.prisma, lignes);
    return {
      data: { anomalies, page, parPage: PAR_PAGE, total, ouvertes },
      message: `${total} anomalie(s)`,
      success: true as const,
    };
  }

  async traiter(
    structureId: string,
    userId: string,
    anomalieId: string,
    dto: TraiterAnomalieDto,
    ip?: string | null,
  ) {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const commentaire = dto.commentaire.trim();
    if (commentaire.length < 3) {
      throw new BadRequestException({
        message: MESSAGE_COMMENTAIRE_TRAITEMENT_REQUIS,
        code: 'MOTIF_REQUIS',
      });
    }
    const anomalie = await this.prisma.anomalie.findFirst({
      where: { id: anomalieId, pointDeVente: { structureId } },
    });
    if (!anomalie) throw new NotFoundException(MESSAGE_ANOMALIE_INTROUVABLE);
    if (anomalie.statut === 'TRAITEE') throw this.dejaTraitee();

    await this.prisma.$transaction(async (tx) => {
      const maj = await tx.anomalie.updateMany({
        where: { id: anomalieId, statut: 'OUVERTE' },
        data: {
          statut: 'TRAITEE',
          traiteeLe: new Date(),
          traiteeParId: user.id,
          commentaireTraitement: commentaire,
        },
      });
      if (maj.count !== 1) throw this.dejaTraitee();
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'update',
          entityType: 'Anomalie',
          entityId: anomalieId,
          ip: ip ?? null,
          metadata: {
            type: anomalie.type,
            avant: { statut: 'OUVERTE' },
            apres: { statut: 'TRAITEE' },
          },
        },
      });
    });

    const relue = await this.prisma.anomalie.findUniqueOrThrow({
      where: { id: anomalieId },
    });
    const [element] = await this.presenter(this.prisma, [relue]);
    return {
      data: element,
      message: MESSAGE_ANOMALIE_TRAITEE,
      success: true as const,
    };
  }

  private dejaTraitee(): ConflictException {
    return new ConflictException({
      message: MESSAGE_ANOMALIE_DEJA_TRAITEE,
      code: 'ANOMALIE_DEJA_TRAITEE',
    });
  }

  private async presenter(
    client: Prisma.TransactionClient | PrismaService,
    lignes: Anomalie[],
  ): Promise<ElementAnomalie[]> {
    if (lignes.length === 0) return [];

    // Noms des personnes citées
    const idsPersonnes = [
      ...new Set(
        lignes.flatMap((l) =>
          [l.attribueeAId, l.traiteeParId].filter(
            (id): id is string => id !== null,
          ),
        ),
      ),
    ];
    const utilisateurs = idsPersonnes.length
      ? await client.user.findMany({
          where: { id: { in: idsPersonnes } },
          select: { id: true, nom: true, prenom: true },
        })
      : [];
    const noms = new Map(
      utilisateurs.map((u) => [u.id, `${u.prenom} ${u.nom}`.trim()]),
    );
    const personne = (id: string | null): PersonneAnomalie | null =>
      id === null ? null : { id, nom: noms.get(id) ?? 'Utilisateur inconnu' };

    // Rattachement des ventes sans stock
    const venteIds = [
      ...new Set(
        lignes
          .filter((l) => l.type === 'STOCK_NEGATIF' && l.pieceId !== null)
          .map((l) => l.pieceId as string),
      ),
    ];
    const initiales = new Map<string, number>();
    const enAttente = new Map<string, number>();
    let annulees = new Set<string>();
    if (venteIds.length > 0) {
      const toutes = await client.anomalie.findMany({
        where: { type: 'STOCK_NEGATIF', pieceId: { in: venteIds } },
        select: { pieceId: true, details: true },
      });
      for (const a of toutes) {
        const d = detailsEnObjet(a.details);
        const cle = `${a.pieceId}:${String(d.stockId)}`;
        initiales.set(
          cle,
          (initiales.get(cle) ?? 0) + nombreDe(d.quantiteProvisoire),
        );
      }
      const provisoires = await client.allocationLot.findMany({
        where: {
          statut: 'PROVISOIRE',
          quantite: { gt: 0 },
          ligneVente: { venteId: { in: venteIds } },
        },
        select: {
          quantite: true,
          ligneVente: { select: { venteId: true, stockMedicamentId: true } },
        },
      });
      for (const p of provisoires) {
        const cle = `${p.ligneVente.venteId}:${p.ligneVente.stockMedicamentId}`;
        enAttente.set(cle, (enAttente.get(cle) ?? 0) + p.quantite);
      }
      const ventesAnnulees = await client.vente.findMany({
        where: {
          id: { in: venteIds },
          pieceLiee: { is: { typePiece: 'ANNULATION' } },
        },
        select: { id: true },
      });
      annulees = new Set(ventesAnnulees.map((v) => v.id));
    }

    return lignes.map((l) => {
      let rattachement: Rattachement | null = null;
      if (l.type === 'STOCK_NEGATIF' && l.pieceId !== null) {
        const d = detailsEnObjet(l.details);
        const cle = `${l.pieceId}:${String(d.stockId)}`;
        rattachement = etatRattachement({
          quantiteInitiale: initiales.get(cle) ?? 0,
          quantiteEnAttente: enAttente.get(cle) ?? 0,
          venteAnnulee: annulees.has(l.pieceId),
        });
      }
      return {
        id: l.id,
        type: l.type,
        libelle: LIBELLES_ANOMALIE[l.type],
        statut: l.statut,
        creeLe: l.creeLe,
        pieceType: l.pieceType,
        pieceId: l.pieceId,
        details: detailsLisibles(l.type, l.details),
        attribueeA: personne(l.attribueeAId),
        traiteeLe: l.traiteeLe,
        traiteePar: personne(l.traiteeParId),
        commentaireTraitement: l.commentaireTraitement,
        rattachement,
      };
    });
  }
}
