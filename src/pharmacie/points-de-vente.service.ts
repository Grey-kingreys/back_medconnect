import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type {
  ParametresPharmacie,
  Poste,
  Prisma,
} from 'generated/prisma/client';
import type { TypeCoupure, TypePoste } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from './acces-pharmacie.service';
import { assurerPointDeVente } from './point-de-vente';
import { jourConakry } from './jour-metier';
import {
  EnregistrerPosteDto,
  ModifierParametresDto,
  ModifierPosteDto,
  TypePosteEnregistrable,
} from './dto/points-de-vente.dto';

export const MESSAGE_POSTE_INTROUVABLE = 'Ce poste est introuvable.';
export const MESSAGE_POSTE_TYPE_DIFFERENT =
  'Cet appareil est déjà enregistré comme un autre type de poste.';

export interface ParametresReponse {
  horizonsPeremptionJours: number[];
  seuilEcartCaisse: number;
  seuilAvertissementPrixPct: number;
  seuilStockBas: number;
  taillePlageTickets: number;
  seuilRechargementPlagePct: number;
  debutCaisse: Date;
}

export interface ReferentielsCaisse {
  modesPaiement: {
    code: string;
    libelle: string;
    comptagePhysique: boolean;
    referenceAutorisee: boolean;
    ordre: number;
  }[];
  coupures: {
    devise: string;
    valeurFaciale: number;
    type: TypeCoupure;
    ordre: number;
  }[];
  parametres: ParametresReponse;
}

export interface PosteReponse {
  id: string;
  code: string;
  libelle: string;
  type: TypePoste;
  actif: boolean;
  appareilId: string | null;
  derniereSequenceAppliquee: number;
  dernierContactLe: Date | null;
  dernierEtat: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface PosteAvecSession extends PosteReponse {
  sessionOuverte: {
    id: string;
    utilisateurId: string | null;
    utilisateurNom: string;
    ouverteLe: Date;
    jourMetier: string;
  } | null;
}

export interface Reponse<T> {
  data: T;
  message: string;
  success: true;
}

/** Valeurs avant et après d'une modification, écrites dans le journal d'audit. */
type ValeursJson = Record<string, string | number | boolean | number[]>;

type ChampParametre =
  | 'horizonsPeremptionJours'
  | 'seuilEcartCaisse'
  | 'seuilAvertissementPrixPct'
  | 'seuilStockBas'
  | 'taillePlageTickets'
  | 'seuilRechargementPlagePct';

const CHAMPS_PARAMETRES: ChampParametre[] = [
  'horizonsPeremptionJours',
  'seuilEcartCaisse',
  'seuilAvertissementPrixPct',
  'seuilStockBas',
  'taillePlageTickets',
  'seuilRechargementPlagePct',
];

function versParametresReponse(p: ParametresPharmacie): ParametresReponse {
  return {
    horizonsPeremptionJours: p.horizonsPeremptionJours,
    seuilEcartCaisse: p.seuilEcartCaisse,
    seuilAvertissementPrixPct: p.seuilAvertissementPrixPct,
    seuilStockBas: p.seuilStockBas,
    taillePlageTickets: p.taillePlageTickets,
    seuilRechargementPlagePct: p.seuilRechargementPlagePct,
    debutCaisse: p.debutCaisse,
  };
}

function versPosteReponse(p: Poste): PosteReponse {
  return {
    id: p.id,
    code: p.code,
    libelle: p.libelle,
    type: p.type,
    actif: p.actif,
    appareilId: p.appareilId,
    derniereSequenceAppliquee: p.derniereSequenceAppliquee,
    dernierContactLe: p.dernierContactLe,
    dernierEtat: p.dernierEtat,
    createdAt: p.createdAt,
  };
}

function libelleParDefaut(
  type: TypePosteEnregistrable,
  code: string,
  prenom: string,
): string {
  const prenomRogne = prenom.trim();
  const libelle =
    type === 'WEB'
      ? prenomRogne
        ? `Navigateur de ${prenomRogne}`
        : 'Navigateur'
      : `Poste ${code}`;
  return libelle.slice(0, 60);
}

/**
 * Poste d'un appareil dans un point de vente : renvoyé s'il existe (même type),
 * sinon créé et audité ; verrou du PV (D482). Utilisé par l'enregistrement d'un
 * poste et par la vente sans poste (D536).
 */
export async function assurerPoste(
  tx: Prisma.TransactionClient,
  entree: {
    pointDeVenteId: string;
    type: TypePosteEnregistrable;
    appareilId: string;
    libelle?: string;
    user: { id: string; prenom: string };
    ip?: string | null;
  },
): Promise<{ poste: Poste; cree: boolean }> {
  const { pointDeVenteId, type, appareilId, user, ip } = entree;

  // Verrou : deux enregistrements simultanés du même appareil sont sérialisés.
  // NO KEY UPDATE et non UPDATE : les insertions qui pointent ce PV (vente, session,
  // mouvement) n'attendent pas la fin de cette transaction (pas d'interblocage, D554).
  await tx.$queryRaw`SELECT "id" FROM "PointDeVente" WHERE "id" = ${pointDeVenteId} FOR NO KEY UPDATE`;

  const existant = await tx.poste.findFirst({
    where: { pointDeVenteId, appareilId },
  });
  if (existant) {
    if (existant.type !== type) {
      throw new ConflictException({
        message: MESSAGE_POSTE_TYPE_DIFFERENT,
        code: 'POSTE_TYPE_DIFFERENT',
      });
    }
    return { poste: existant, cree: false };
  }

  const rang =
    (await tx.poste.count({
      where: { pointDeVenteId, type },
    })) + 1;
  const code = (type === 'WEB' ? 'W' : 'D') + String(rang);
  const nouveau = await tx.poste.create({
    data: {
      pointDeVenteId,
      code,
      libelle: entree.libelle ?? libelleParDefaut(type, code, user.prenom),
      type,
      appareilId,
      enregistreParId: user.id,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: user.id,
      action: 'create',
      entityType: 'Poste',
      entityId: nouveau.id,
      ip: ip ?? null,
      metadata: { code, type },
    },
  });
  return { poste: nouveau, cree: true };
}

@Injectable()
export class PointsDeVenteService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PointsDeVenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
  ) {}

  /** Complète au démarrage les pharmacies créées par l'ancien code (jamais de levée). */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.completerPointsDeVente();
    } catch (e) {
      this.logger.error(
        `Complément des points de vente échoué (l'app démarre quand même) : ${e instanceof Error ? e.message : 'raison inconnue'}`,
      );
    }
  }

  /** Crée point de vente, poste REPRISE, compteur et paramètres des pharmacies qui en manquent. */
  async completerPointsDeVente(): Promise<number> {
    const pharmacies = await this.prisma.structure.findMany({
      where: {
        type: 'PHARMACIE',
        OR: [
          { pointsDeVente: { none: {} } },
          { parametresPharmacie: { is: null } },
        ],
      },
      select: { id: true, nom: true },
      orderBy: { id: 'asc' },
    });
    for (const pharmacie of pharmacies) {
      await this.prisma.$transaction((tx) =>
        assurerPointDeVente(tx, pharmacie),
      );
    }
    if (pharmacies.length > 0) {
      this.logger.log(
        `Points de vente complétés pour ${pharmacies.length} pharmacie(s).`,
      );
    }
    return pharmacies.length;
  }

  async referentiels(
    structureId: string,
    userId: string,
  ): Promise<Reponse<ReferentielsCaisse>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const [modesPaiement, coupures, parametres] = await Promise.all([
      this.prisma.modePaiement.findMany({
        where: { actif: true },
        orderBy: [{ ordre: 'asc' }, { code: 'asc' }],
        select: {
          code: true,
          libelle: true,
          comptagePhysique: true,
          referenceAutorisee: true,
          ordre: true,
        },
      }),
      this.prisma.coupureMonnaie.findMany({
        where: { actif: true },
        orderBy: [{ ordre: 'asc' }, { valeurFaciale: 'desc' }],
        select: {
          devise: true,
          valeurFaciale: true,
          type: true,
          ordre: true,
        },
      }),
      this.lireParametres(structure),
    ]);
    return {
      data: {
        modesPaiement,
        coupures,
        parametres: versParametresReponse(parametres),
      },
      message: 'Référentiels de caisse.',
      success: true,
    };
  }

  async parametres(
    structureId: string,
    userId: string,
  ): Promise<Reponse<ParametresReponse>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const parametres = await this.lireParametres(structure);
    return {
      data: versParametresReponse(parametres),
      message: 'Paramètres de la pharmacie.',
      success: true,
    };
  }

  async modifierParametres(
    structureId: string,
    userId: string,
    dto: ModifierParametresDto,
    ip?: string,
  ): Promise<Reponse<ParametresReponse>> {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const resultat = await this.prisma.$transaction(async (tx) => {
      const existants =
        (await tx.parametresPharmacie.findUnique({
          where: { structureId: structure.id },
        })) ?? (await assurerPointDeVente(tx, structure)).parametres;

      const voulus = {
        horizonsPeremptionJours: dto.horizonsPeremptionJours
          ? [...dto.horizonsPeremptionJours].sort((a, b) => b - a)
          : existants.horizonsPeremptionJours,
        seuilEcartCaisse: dto.seuilEcartCaisse ?? existants.seuilEcartCaisse,
        seuilAvertissementPrixPct:
          dto.seuilAvertissementPrixPct ?? existants.seuilAvertissementPrixPct,
        seuilStockBas: dto.seuilStockBas ?? existants.seuilStockBas,
        taillePlageTickets:
          dto.taillePlageTickets ?? existants.taillePlageTickets,
        seuilRechargementPlagePct:
          dto.seuilRechargementPlagePct ?? existants.seuilRechargementPlagePct,
      };

      const changes = CHAMPS_PARAMETRES.filter(
        (c) => JSON.stringify(voulus[c]) !== JSON.stringify(existants[c]),
      );
      if (changes.length === 0) return existants;

      const avant: ValeursJson = {};
      const apres: ValeursJson = {};
      for (const c of changes) {
        avant[c] = existants[c];
        apres[c] = voulus[c];
      }

      const misAJour = await tx.parametresPharmacie.update({
        where: { structureId: structure.id },
        data: { ...voulus, misAJourParId: user.id },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'update',
          entityType: 'ParametresPharmacie',
          entityId: structure.id,
          ip: ip ?? null,
          metadata: { avant, apres },
        },
      });
      return misAJour;
    });
    return {
      data: versParametresReponse(resultat),
      message: 'Paramètres enregistrés.',
      success: true,
    };
  }

  async enregistrerPoste(
    structureId: string,
    userId: string,
    dto: EnregistrerPosteDto,
    ip?: string,
  ): Promise<Reponse<PosteReponse & { cree: boolean }>> {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const { poste, cree } = await this.prisma.$transaction(async (tx) => {
      const pointDeVente =
        (await tx.pointDeVente.findFirst({
          where: { structureId: structure.id },
          orderBy: { ordre: 'asc' },
        })) ?? (await assurerPointDeVente(tx, structure)).pointDeVente;

      return assurerPoste(tx, {
        pointDeVenteId: pointDeVente.id,
        type: dto.type,
        appareilId: dto.appareilId,
        libelle: dto.libelle,
        user,
        ip,
      });
    });
    return {
      data: { ...versPosteReponse(poste), cree },
      message: cree ? 'Poste enregistré.' : 'Ce poste était déjà enregistré.',
      success: true,
    };
  }

  async listerPostes(
    structureId: string,
    userId: string,
  ): Promise<Reponse<PosteAvecSession[]>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const postes = await this.prisma.poste.findMany({
      where: {
        pointDeVente: { structureId: structure.id },
        type: { not: 'TECHNIQUE' },
      },
      include: {
        sessionsCaisse: {
          where: { statut: 'OUVERTE' },
          select: {
            id: true,
            utilisateurId: true,
            utilisateurNom: true,
            ouverteLe: true,
            jourMetier: true,
          },
          take: 1,
        },
      },
      orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
    });
    return {
      data: postes.map((p) => {
        const s = p.sessionsCaisse[0];
        return {
          ...versPosteReponse(p),
          sessionOuverte: s
            ? {
                id: s.id,
                utilisateurId: s.utilisateurId,
                utilisateurNom: s.utilisateurNom,
                ouverteLe: s.ouverteLe,
                jourMetier: jourConakry(s.jourMetier),
              }
            : null,
        };
      }),
      message: `${postes.length} poste(s).`,
      success: true,
    };
  }

  async modifierPoste(
    structureId: string,
    userId: string,
    posteId: string,
    dto: ModifierPosteDto,
    ip?: string,
  ): Promise<Reponse<PosteReponse>> {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const resultat = await this.prisma.$transaction(async (tx) => {
      const poste = await tx.poste.findFirst({
        where: {
          id: posteId,
          type: { not: 'TECHNIQUE' },
          pointDeVente: { structureId: structure.id },
        },
      });
      if (!poste) throw new NotFoundException(MESSAGE_POSTE_INTROUVABLE);

      const changements: { libelle?: string; actif?: boolean } = {};
      const avant: ValeursJson = {};
      const apres: ValeursJson = {};
      if (dto.libelle !== undefined && dto.libelle !== poste.libelle) {
        changements.libelle = dto.libelle;
        avant.libelle = poste.libelle;
        apres.libelle = dto.libelle;
      }
      if (dto.actif !== undefined && dto.actif !== poste.actif) {
        changements.actif = dto.actif;
        avant.actif = poste.actif;
        apres.actif = dto.actif;
      }
      if (Object.keys(changements).length === 0) return poste;

      const misAJour = await tx.poste.update({
        where: { id: poste.id },
        data: changements,
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'update',
          entityType: 'Poste',
          entityId: poste.id,
          ip: ip ?? null,
          metadata: { avant, apres },
        },
      });
      return misAJour;
    });
    return {
      data: versPosteReponse(resultat),
      message: 'Poste mis à jour.',
      success: true,
    };
  }

  private async lireParametres(structure: {
    id: string;
    nom: string;
  }): Promise<ParametresPharmacie> {
    const existants = await this.prisma.parametresPharmacie.findUnique({
      where: { structureId: structure.id },
    });
    if (existants) return existants;
    return (
      await this.prisma.$transaction((tx) => assurerPointDeVente(tx, structure))
    ).parametres;
  }
}
