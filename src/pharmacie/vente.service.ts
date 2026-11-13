import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { StorageService } from 'src/storage/storage.service';
import { AccesPharmacieService } from './acces-pharmacie.service';
import { verrouillerJourneesPartage } from './caisse/journee';
import {
  estConflitCleIdempotence,
  lireCleIdempotence,
} from 'src/carnet-sante/sos-idempotence';
import {
  AnnulerVenteDto,
  CreerVenteDto,
  ListerVentesQueryDto,
} from './dto/vente.dto';
import {
  messageModeInconnu,
  SessionsCaisseService,
} from './caisse/sessions-caisse.service';
import { calculerLigne, type UniteVente } from './domaine/prix';
import {
  formaterQuantiteLisible,
  type UniteMinimaleLisible,
} from './domaine/quantites';
import { ecrirePieceVente } from './ecriture-vente';
import { CODE_CREDIT, estVenteACredit } from './credit/credit-regles';
import { jourConakry } from './jour-metier';
import { masquerCouts } from './masquer-couts';
import { assurerPointDeVente } from './point-de-vente';
import { MESSAGE_LOT_INTROUVABLE } from './pharmacie.service';
import { assurerPoste } from './points-de-vente.service';
import {
  MESSAGE_STOCK_LOT_INSUFFISANT,
  MouvementsStockService,
} from './stock/mouvements-stock.service';
import {
  dateVersJour,
  jourVersDate,
  lireLotsCandidats,
} from './stock/lecture-stock';
import { estDoublonSur } from './stock/erreurs-base';
import {
  allouerLignes,
  cleLigneVente,
  controlerStockVente,
  deriverAnnulation,
  formaterNumeroTicket,
  lignesInverses,
  numeroAnnulation,
  passagesStockBas,
  paiementsInverses,
  preparerPaiements,
  type LigneAAllouer,
} from './vente-regles';

export { bornesDuJour, jourConakry } from './jour-metier';

/** Plus grand montant enregistrable (colonne Int de PostgreSQL). */
const PRIX_MAX = 2147483647;
const VENTES_PAR_PAGE = 50;
/** Seuil de stock bas en boîtes, si la pharmacie n'a pas de paramètres. */
const SEUIL_STOCK_BAS_DEFAUT = 10;
/** Transaction interactive d'une vente : session, ticket, lots, vente, audit. */
const OPTIONS_TRANSACTION_VENTE = { maxWait: 5_000, timeout: 15_000 };

export const PREFIXE_APPAREIL_WEB_DEFAUT = 'web-defaut:';
export const MESSAGE_MOTIF_SORTIE_REQUIS =
  'Indiquez le motif de la sortie de ce lot (3 caractères au moins).';
export const MESSAGE_VENTE_DEJA_ANNULEE = 'Cette vente a déjà été annulée.';
export const MESSAGE_PIECE_NON_ANNULABLE =
  'Cette pièce est une annulation ou une régularisation : elle ne peut pas être annulée.';
export const MESSAGE_VENTE_REGULARISEE =
  'Cette vente a déjà une pièce de régularisation : elle ne peut plus être annulée.';
export const MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE =
  "Cette vente date d'avant la mise en place de la caisse : elle ne peut pas être annulée. Corrigez le stock du médicament si besoin.";
export const MESSAGE_POSTE_AUTRE_POINT_DE_VENTE =
  "Ce poste de caisse n'appartient pas au point de vente de cette vente.";
export const MESSAGE_FICHE_MODIFIEE =
  "La fiche d'un médicament du panier vient d'être modifiée (nombre d'unités par boîte). Vérifiez le panier puis validez de nouveau.";
export const MESSAGE_VENTE_AVANT_QUALIFICATION =
  "Cette vente date d'avant la conversion du stock de ce médicament en unités : elle ne peut pas être annulée. Corrigez le stock du médicament si besoin.";

export function messageVenteAnnulee(
  numero: string,
  numeroPiece: string,
): string {
  return `Vente ${numero} annulée (${numeroPiece}). Les quantités ont été remises en stock et le remboursement est enregistré dans votre caisse.`;
}

export function messageVenteUniteInterdite(noms: string[]): string {
  return noms.length === 1
    ? `Ce médicament se vend uniquement à la boîte : « ${noms[0]} ». Passez-le en vente à la boîte.`
    : `${noms.length} médicaments du panier se vendent uniquement à la boîte. Passez-les en vente à la boîte.`;
}

export function messagePrixUniteManquant(noms: string[]): string {
  return noms.length === 1
    ? `Vente impossible : « ${noms[0]} » n'a pas de prix à l'unité. Ajoutez son prix à l'unité dans la fiche du médicament, ou vendez-le à la boîte.`
    : `Vente impossible : ${noms.length} médicaments du panier n'ont pas de prix à l'unité. Ajoutez leur prix à l'unité dans leur fiche, ou vendez-les à la boîte.`;
}

export function messageSortieManuelleRequise(noms: string[]): string {
  return noms.length === 1
    ? `Le stock non périmé de « ${noms[0]} » ne suffit pas : il ne reste que des lots périmés. Réduisez la quantité, ou choisissez un lot et indiquez le motif de la sortie.`
    : `Le stock non périmé de ${noms.length} médicaments du panier ne suffit pas : il ne reste que des lots périmés. Réduisez les quantités, ou choisissez un lot et indiquez le motif de chaque sortie.`;
}

export interface FicheStockInsuffisant {
  nom: string;
  /** Reste vendable de la fiche, en unités minimales. */
  disponibleUm: number;
  coefficientBoite: number;
  uniteMinimale: UniteMinimaleLisible;
}

/** Message du 409 STOCK_INSUFFISANT (D715, D727) : stock restant en boîtes et unités. */
export function messageStockInsuffisant(
  fiches: readonly FicheStockInsuffisant[],
): string {
  const reste = (f: FicheStockInsuffisant) =>
    f.disponibleUm === 0
      ? 'il ne reste rien'
      : `il reste ${formaterQuantiteLisible(f.disponibleUm, f.coefficientBoite, f.uniteMinimale)}`;
  if (fiches.length === 1) {
    return `Stock insuffisant pour « ${fiches[0].nom} » : ${reste(fiches[0])}. Réduisez la quantité, ou faites enregistrer la livraison si ces boîtes viennent d'arriver.`;
  }
  const liste = fiches
    .map((f) =>
      f.disponibleUm === 0
        ? `${f.nom} (il ne reste rien)`
        : `${f.nom} (${reste(f)})`,
    )
    .join(', ');
  return `Stock insuffisant : ${liste}. Réduisez les quantités, ou faites enregistrer la livraison si ces boîtes viennent d'arriver.`;
}

export function messagePaiementsIncoherents(
  somme: number,
  total: number,
): string {
  return `Le total des paiements (${somme} GNF) ne correspond pas au montant de la vente (${total} GNF). Corrigez les montants puis validez de nouveau.`;
}

/** Numéro lisible d'une vente : V-AAAA-NNNNNN. */
export function formaterNumero(annee: number, n: number): string {
  return `V-${annee}-${String(n).padStart(6, '0')}`;
}

/** Pièce liée (annulation ou régularisation) lue pour dériver le statut (D550). */
const SELECT_PIECE_LIEE = {
  id: true,
  numero: true,
  typePiece: true,
  motifAnnulation: true,
  createdAt: true,
  vendeurId: true,
  vendeurNom: true,
  posteId: true,
  sessionCaisseId: true,
  jourMetier: true,
} satisfies Prisma.VenteSelect;

/** Lecture complète d'une vente : lignes, allocations, paiements et poste. */
const INCLUDE_VENTE = {
  lignes: { include: { allocations: true } },
  paiements: { include: { modePaiement: true } },
  poste: { select: { id: true, code: true } },
  venteOrigine: { select: { id: true, numero: true } },
  pieceLiee: { select: SELECT_PIECE_LIEE },
} satisfies Prisma.VenteInclude;
type VenteComplete = Prisma.VenteGetPayload<{ include: typeof INCLUDE_VENTE }>;

export interface CreditVente {
  clientCreditId: string;
  nomComplet: string;
  /** AAAA-MM-JJ ou null. */
  dateLimite: string | null;
}

export interface PharmacieRecu {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  logoUrl: string | null;
}

interface LigneSession {
  statut: string;
  pointDeVenteId: string;
  jourMetier: Date | string;
  ordre: number;
}

interface LignePassage {
  nom: string;
  apres: number;
}

const RANG_STATUT: Record<string, number> = {
  DEFINITIVE: 0,
  PROVISOIRE: 1,
  REMPLACEE: 2,
};

type AllocationLue = VenteComplete['lignes'][number]['allocations'][number];

function comparerAllocations(a: AllocationLue, b: AllocationLue): number {
  const rang = (RANG_STATUT[a.statut] ?? 3) - (RANG_STATUT[b.statut] ?? 3);
  if (rang !== 0) return rang;
  if (a.dateExpiration === null && b.dateExpiration !== null) return -1;
  if (a.dateExpiration !== null && b.dateExpiration === null) return 1;
  if (a.dateExpiration !== null && b.dateExpiration !== null) {
    const diff = a.dateExpiration.getTime() - b.dateExpiration.getTime();
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (a.lotId === b.lotId) return 0;
  if (a.lotId === null) return 1;
  if (b.lotId === null) return -1;
  return a.lotId < b.lotId ? -1 : 1;
}

@Injectable()
export class VenteService {
  private readonly logger = new Logger(VenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storage: StorageService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly permissions: PermissionsService,
    private readonly mouvementsStock: MouvementsStockService,
    private readonly sessionsCaisse: SessionsCaisseService,
  ) {}

  private pharmacieRecu(structure: {
    id: string;
    nom: string;
    adresse?: string | null;
    ville?: string | null;
    telephone?: string | null;
    logoFile?: { key: string } | null;
  }): PharmacieRecu {
    return {
      id: structure.id,
      nom: structure.nom,
      adresse: structure.adresse ?? null,
      ville: structure.ville ?? null,
      telephone: structure.telephone ?? null,
      logoUrl: structure.logoFile
        ? this.storage.getPublicUrl(structure.logoFile.key)
        : null,
    };
  }

  private async peutVoirMarge(userId: string): Promise<boolean> {
    return (await this.permissions.getUserPermissions(userId)).includes(
      PERMISSIONS.MARGE_READ,
    );
  }

  /** Forme renvoyée à la création, au rejeu, au détail et à l'annulation (sans clé d'idempotence). */
  private presenterVente(
    vente: VenteComplete,
    pharmacie: PharmacieRecu,
    ouverteAutomatiquement = false,
  ) {
    const paiements = [...vente.paiements].sort((a, b) => {
      if (a.modePaiement.ordre !== b.modePaiement.ordre) {
        return a.modePaiement.ordre - b.modePaiement.ordre;
      }
      return a.modePaiement.code < b.modePaiement.code ? -1 : 1;
    });
    const etat = deriverAnnulation(vente, vente.pieceLiee);
    return {
      id: vente.id,
      numero: vente.numero,
      statut: etat.statut,
      createdAt: vente.createdAt,
      total: vente.total,
      ordonnanceVerifiee: vente.ordonnanceVerifiee,
      telephonePrescripteur: vente.telephonePrescripteur,
      clientNom: vente.clientNom,
      clientTelephone: vente.clientTelephone,
      clientCreditId: vente.clientCreditId,
      vendeur: { id: vente.vendeurId, nom: vente.vendeurNom },
      annuleeLe: etat.annuleeLe,
      annuleeParId: etat.annuleeParId,
      motifAnnulation: etat.motifAnnulation,
      typePiece: vente.typePiece,
      numeroTicket: vente.numeroTicket,
      jourMetier: dateVersJour(vente.jourMetier),
      provisoire: vente.lignes.some((l) =>
        l.allocations.some((a) => a.statut === 'PROVISOIRE'),
      ),
      poste: { id: vente.poste.id, code: vente.poste.code },
      session: { id: vente.sessionCaisseId, ouverteAutomatiquement },
      paiements: paiements.map((p) => ({
        id: p.id,
        mode: p.modePaiement.code,
        libelle: p.modePaiement.libelle,
        montant: p.montant,
        reference: p.referenceExterne,
        montantRecu: p.montantRecu,
        rendu: p.montantRecu === null ? null : p.montantRecu - p.montant,
      })),
      annulation: etat.annulation,
      venteOrigine: vente.venteOrigine
        ? { id: vente.venteOrigine.id, numero: vente.venteOrigine.numero }
        : null,
      motif: etat.motif,
      lignes: vente.lignes.map((l) => ({
        id: l.id,
        stockId: l.stockMedicamentId,
        medicamentId: l.medicamentId,
        nomMedicament: l.nomMedicament,
        prixUnitaire: l.prixUnitaire,
        quantite: l.quantite,
        sousTotal: l.sousTotal,
        uniteAffichee: l.uniteAffichee,
        nombreAffiche: l.nombreAffiche,
        coefficientApplique: l.coefficientApplique,
        allocations: [...l.allocations].sort(comparerAllocations).map((a) => ({
          lotId: a.lotId,
          numeroLot: a.numeroLot,
          dateExpiration: a.dateExpiration
            ? dateVersJour(a.dateExpiration)
            : null,
          quantite: a.quantite,
          statut: a.statut,
          sortieManuelle: a.sortieManuelle,
          motif: a.motif,
          lotTechnique: a.lotTechnique,
          coutUnitaire: a.coutUnitaire,
        })),
      })),
      pharmacie,
    };
  }

  /** Ajoute `credit` (client et date limite) à la réponse d'une vente à crédit ; null sinon. */
  private async avecCredit<T extends object>(
    data: T,
    vente: { id: string; clientCreditId: string | null; structureId: string },
  ): Promise<T & { credit: CreditVente | null }> {
    if (!vente.clientCreditId) return { ...data, credit: null };
    const [client, echeance] = await Promise.all([
      this.prisma.clientCredit.findFirst({
        where: { id: vente.clientCreditId, structureId: vente.structureId },
        select: { id: true, nomComplet: true },
      }),
      this.prisma.echeanceCredit.findUnique({
        where: { venteId: vente.id },
        select: { dateLimite: true },
      }),
    ]);
    return {
      ...data,
      credit: client
        ? {
            clientCreditId: client.id,
            nomComplet: client.nomComplet,
            dateLimite: echeance ? dateVersJour(echeance.dateLimite) : null,
          }
        : null,
    };
  }

  private reponseRejeu(
    vente: VenteComplete,
    pharmacie: PharmacieRecu,
    peutVoirMarge: boolean,
  ) {
    this.logger.log(`vente.rejeu venteId=${vente.id}`);
    return {
      data: masquerCouts(
        { ...this.presenterVente(vente, pharmacie), rejeu: true },
        peutVoirMarge,
      ),
      message: 'Cette vente était déjà enregistrée.',
      success: true,
    };
  }

  async creerVente(
    structureId: string,
    userId: string,
    dto: CreerVenteDto,
    enTeteIdempotence?: string,
    ip?: string | null,
  ) {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const pharmacie = this.pharmacieRecu(structure);

    const cles = dto.lignes.map((l) =>
      cleLigneVente(l.stockId, l.unite as UniteVente | undefined),
    );
    if (new Set(cles).size !== cles.length) {
      throw new BadRequestException({
        message:
          "Un même médicament ne peut apparaître qu'une fois par unité dans la vente (une ligne à la boîte, une ligne à l'unité). Regroupez les quantités.",
        code: 'VALIDATION',
        champs: [{ champ: 'lignes', contraintes: ['stockUnique'] }],
      });
    }

    const permissionsUtilisateur =
      await this.permissions.getUserPermissions(userId);
    const peutVoirMarge = permissionsUtilisateur.includes(
      PERMISSIONS.MARGE_READ,
    );
    // Vente à crédit : credit:write en plus des droits de vente.
    if (
      estVenteACredit(dto) &&
      !permissionsUtilisateur.includes(PERMISSIONS.CREDIT_WRITE)
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas la permission d'effectuer cette action.",
      );
    }

    // Idempotence, comme le SOS : même clé et même pharmacie = même vente, sans limite de durée.
    const cle = lireCleIdempotence(enTeteIdempotence);
    if (cle === null && enTeteIdempotence?.trim()) {
      this.logger.warn('vente.cle_idempotence_ignoree format invalide');
    }
    if (cle) {
      const existante = await this.prisma.vente.findUnique({
        where: {
          structureId_cleIdempotence: { structureId, cleIdempotence: cle },
        },
        include: INCLUDE_VENTE,
      });
      if (existante) {
        const rejeu = this.reponseRejeu(existante, pharmacie, peutVoirMarge);
        return { ...rejeu, data: await this.avecCredit(rejeu.data, existante) };
      }
    }

    let resultat: {
      vente: VenteComplete;
      passages: LignePassage[];
      ouverteAutomatiquement: boolean;
    };
    try {
      resultat = await this.prisma.$transaction(
        (tx) => this.enregistrerVente(tx, { structure, user, dto, cle, ip }),
        OPTIONS_TRANSACTION_VENTE,
      );
    } catch (erreur) {
      // Rejeu simultané de la même clé : la vente de l'autre requête fait foi.
      if (cle && estConflitCleIdempotence(erreur)) {
        const existante = await this.prisma.vente.findUnique({
          where: {
            structureId_cleIdempotence: { structureId, cleIdempotence: cle },
          },
          include: INCLUDE_VENTE,
        });
        if (existante) {
          this.logger.log(`vente.rejeu_concurrent venteId=${existante.id}`);
          const rejeu = this.reponseRejeu(existante, pharmacie, peutVoirMarge);
          return {
            ...rejeu,
            data: await this.avecCredit(rejeu.data, existante),
          };
        }
      }
      throw erreur;
    }

    const { vente, passages, ouverteAutomatiquement } = resultat;
    await this.alerterStockBas(structureId, vente.id, passages);
    this.logger.log(`vente.creee venteId=${vente.id} numero=${vente.numero}`);

    return {
      data: await this.avecCredit(
        masquerCouts(
          this.presenterVente(vente, pharmacie, ouverteAutomatiquement),
          peutVoirMarge,
        ),
        vente,
      ),
      message: vente.clientCreditId
        ? `Vente à crédit enregistrée (${vente.numero}).`
        : `Vente enregistrée (${vente.numero}).`,
      success: true,
    };
  }

  /** Corps de la transaction de création : tout ou rien (D535). */
  private async enregistrerVente(
    tx: Prisma.TransactionClient,
    entree: {
      structure: { id: string; nom: string; adminId: string | null };
      user: { id: string; nom: string; prenom: string };
      dto: CreerVenteDto;
      cle: string | null;
      ip?: string | null;
    },
  ): Promise<{
    vente: VenteComplete;
    passages: LignePassage[];
    ouverteAutomatiquement: boolean;
  }> {
    const { structure, user, dto, cle, ip } = entree;
    const structureId = structure.id;
    const utilisateurNom = `${user.prenom} ${user.nom}`.trim();

    // 0. Verrou de journée partagé (D613) : aucune clôture ne s'intercale
    await verrouillerJourneesPartage(tx, structureId);

    // 1. Fiches
    const ids = [...new Set(dto.lignes.map((l) => l.stockId))];
    const fiches = await tx.stockMedicament.findMany({
      where: { id: { in: ids }, structureId, archiveLe: null },
      include: {
        medicament: {
          select: { id: true, nom: true, ordonnanceRequise: true },
        },
      },
    });
    const parId = new Map(fiches.map((f) => [f.id, f]));
    const introuvables = ids.filter((id) => !parId.has(id));
    if (introuvables.length > 0) {
      throw new NotFoundException({
        message:
          introuvables.length === 1
            ? "Un médicament du panier n'est plus dans le stock de la pharmacie. Retirez-le du panier puis validez de nouveau."
            : 'Certains médicaments du panier ne sont plus dans le stock de la pharmacie. Retirez-les du panier puis validez de nouveau.',
        code: 'STOCK_INTROUVABLE',
        details: introuvables.map((stockId) => ({ stockId })),
      });
    }

    // 2. Lignes : prix de la fiche, jamais du client
    const calculees = dto.lignes.map((l) => {
      const fiche = parId.get(l.stockId)!;
      const resultat = calculerLigne({
        unite: l.unite ?? 'BOITE',
        nombre: l.quantite,
        coefficientBoite: fiche.coefficientBoite,
        prixBoite: fiche.prixUnitaire,
        prixUnite: fiche.prixUnite,
        deconditionnable: fiche.deconditionnable,
      });
      return { ligne: l, fiche, resultat };
    });
    const refus = (code: string) => {
      const vus = new Set<string>();
      const lignes: { stockId: string; nom: string }[] = [];
      for (const c of calculees) {
        if (c.resultat.ok || c.resultat.code !== code) continue;
        if (vus.has(c.fiche.id)) continue;
        vus.add(c.fiche.id);
        lignes.push({ stockId: c.fiche.id, nom: c.fiche.medicament.nom });
      }
      return lignes;
    };
    const interdites = refus('VENTE_UNITE_INTERDITE');
    if (interdites.length > 0) {
      throw new BadRequestException({
        message: messageVenteUniteInterdite(interdites.map((i) => i.nom)),
        code: 'VENTE_UNITE_INTERDITE',
        details: interdites,
      });
    }
    const sansPrixUnite = refus('PRIX_UNITE_MANQUANT');
    if (sansPrixUnite.length > 0) {
      throw new BadRequestException({
        message: messagePrixUniteManquant(sansPrixUnite.map((i) => i.nom)),
        code: 'PRIX_UNITE_MANQUANT',
        details: sansPrixUnite,
      });
    }
    const sansPrix = refus('PRIX_MANQUANT');
    if (sansPrix.length > 0) {
      throw new BadRequestException({
        message:
          sansPrix.length === 1
            ? `Vente impossible : « ${sansPrix[0].nom} » n'a pas de prix. Ajoutez son prix dans le stock puis validez de nouveau.`
            : `Vente impossible : ${sansPrix.length} médicaments du panier n'ont pas de prix. Ajoutez leur prix dans le stock puis validez de nouveau.`,
        code: 'PRIX_MANQUANT',
        details: sansPrix,
      });
    }
    const lignesCalculees = calculees.map((c) => {
      if (!c.resultat.ok) {
        throw new RangeError('Ligne refusée non traitée.');
      }
      return { ligne: c.ligne, fiche: c.fiche, calcul: c.resultat };
    });

    // 3. Motifs des sorties manuelles
    const motifs = new Map<number, string>();
    dto.lignes.forEach((l, index) => {
      if (!l.sortieManuelle) return;
      const motif = (l.sortieManuelle.motif ?? '').trim();
      if (motif.length < 3) {
        throw new BadRequestException({
          message: MESSAGE_MOTIF_SORTIE_REQUIS,
          code: 'MOTIF_REQUIS',
        });
      }
      motifs.set(index, motif);
    });

    // 4. Ordonnance
    if (dto.ordonnanceVerifiee !== true) {
      const surOrdonnance = [
        ...new Map(
          lignesCalculees
            .filter((c) => c.fiche.medicament.ordonnanceRequise)
            .map((c) => [c.fiche.id, c.fiche]),
        ).values(),
      ];
      if (surOrdonnance.length > 0) {
        throw new BadRequestException({
          message:
            "Ce panier contient un médicament vendu sur ordonnance. Cochez « J'ai vu l'ordonnance » pour valider la vente.",
          code: 'ORDONNANCE_NON_CONFIRMEE',
          details: surOrdonnance.map((s) => ({
            stockId: s.id,
            nom: s.medicament.nom,
          })),
        });
      }
    }

    // 5. Total
    const total = lignesCalculees.reduce(
      (somme, c) => somme + c.calcul.montantLigne,
      0,
    );
    if (total > PRIX_MAX) {
      throw new BadRequestException({
        message:
          'Le montant total de la vente est trop élevé. Divisez-la en plusieurs ventes.',
        code: 'VALIDATION',
        champs: [{ champ: 'lignes', contraintes: ['totalMaximal'] }],
      });
    }

    // 5b. Vente à crédit : client du cahier de la pharmacie, date limite
    const credit = await this.preparerCredit(tx, {
      structureId,
      userId: user.id,
      dto,
      ip,
    });

    // 6. Paiements
    const modes = await tx.modePaiement.findMany({ where: { actif: true } });
    const prepares = preparerPaiements(
      total,
      credit
        ? [{ mode: CODE_CREDIT, montant: total }]
        : dto.paiements?.map((p) => ({
            mode: p.mode,
            montant: p.montant,
            reference: p.reference,
            montantRecu: p.montantRecu,
          })),
      modes,
    );
    if (!prepares.ok) {
      switch (prepares.code) {
        case 'MODE_PAIEMENT_INCONNU':
          throw new BadRequestException({
            message: messageModeInconnu(prepares.mode),
            code: 'MODE_PAIEMENT_INCONNU',
          });
        case 'MODE_EN_DOUBLE':
          throw new BadRequestException({
            message:
              'Un même mode de paiement ne peut apparaître qu’une fois. Regroupez les montants.',
            code: 'VALIDATION',
            champs: [{ champ: 'paiements', contraintes: ['modeUnique'] }],
          });
        case 'MONTANT_RECU_INSUFFISANT':
          throw new BadRequestException({
            message:
              'La somme reçue en espèces est inférieure au montant à payer en espèces.',
            code: 'VALIDATION',
            champs: [
              { champ: 'paiements', contraintes: ['montantRecuInsuffisant'] },
            ],
          });
        case 'PAIEMENTS_INCOHERENTS':
          throw new BadRequestException({
            message: messagePaiementsIncoherents(prepares.somme, total),
            code: 'PAIEMENTS_INCOHERENTS',
          });
      }
    }
    const paiements = prepares.paiements;

    // 7. Poste
    let posteId = dto.posteId;
    if (!posteId) {
      const pointDeVente =
        (await tx.pointDeVente.findFirst({
          where: { structureId },
          orderBy: { ordre: 'asc' },
        })) ?? (await assurerPointDeVente(tx, structure)).pointDeVente;
      posteId = await this.posteParDefaut(tx, pointDeVente.id, user, ip);
    }

    // 8. Session de caisse
    const ouverte = await this.ouvrirSessionVerrouillee(tx, {
      structureId,
      userId: user.id,
      utilisateurNom,
      posteId,
    });
    const {
      sessionId,
      posteCode,
      pointDeVenteId,
      ordre,
      jourMetier,
      ouverteAutomatiquement,
    } = ouverte;

    // 9. Numéro de ticket
    const [{ numero: numeroTicket }] = await tx.$queryRaw<
      { numero: number }[]
    >`INSERT INTO "CompteurTicket" ("pointDeVenteId", "prochainNumero") VALUES (${pointDeVenteId}, 2)
      ON CONFLICT ("pointDeVenteId") DO UPDATE SET "prochainNumero" = "CompteurTicket"."prochainNumero" + 1
      RETURNING "prochainNumero" - 1 AS "numero"`;
    const numero = formaterNumeroTicket(ordre, Number(numeroTicket));

    // 10. Verrous et lots
    await this.mouvementsStock.verrouillerFiches(tx, ids);
    const coefficients = await tx.stockMedicament.findMany({
      where: { id: { in: ids } },
      select: { id: true, coefficientBoite: true },
    });
    const modifiees = fiches.filter(
      (f) =>
        coefficients.find((c) => c.id === f.id)?.coefficientBoite !==
        f.coefficientBoite,
    );
    if (modifiees.length > 0) {
      throw new ConflictException({
        message: MESSAGE_FICHE_MODIFIEE,
        code: 'FICHE_MODIFIEE',
        details: modifiees.map((f) => ({
          stockId: f.id,
          nom: f.medicament.nom,
        })),
      });
    }
    const agregatsAvant = await tx.agregatStockProduit.findMany({
      where: { pointDeVenteId, stockMedicamentId: { in: ids } },
    });
    const avantParFiche = new Map(
      agregatsAvant.map((a) => [a.stockMedicamentId, a.quantite]),
    );
    const lotsParFiche = await lireLotsCandidats(tx, pointDeVenteId, ids);
    const jour = jourConakry(new Date());

    // 11. Lots de sortie manuelle
    for (const l of dto.lignes) {
      if (!l.sortieManuelle) continue;
      const lotId = l.sortieManuelle.lotId;
      const connus = lotsParFiche.get(l.stockId) ?? [];
      if (connus.some((c) => c.id === lotId)) continue;
      const lot = await tx.lotStock.findFirst({
        where: { id: lotId, stockMedicamentId: l.stockId, pointDeVenteId },
      });
      if (!lot) throw new NotFoundException(MESSAGE_LOT_INTROUVABLE);
      throw new ConflictException({
        message: MESSAGE_STOCK_LOT_INSUFFISANT,
        code: 'STOCK_LOT_NEGATIF',
      });
    }

    // 12. Allocation
    const aAllouer: LigneAAllouer[] = lignesCalculees.map((c, index) => ({
      index,
      stockMedicamentId: c.fiche.id,
      unite: c.calcul.uniteAffichee,
      quantiteUm: c.calcul.quantiteUm,
      sortieManuelle: c.ligne.sortieManuelle
        ? { lotId: c.ligne.sortieManuelle.lotId, motif: motifs.get(index)! }
        : null,
    }));
    const allouees = allouerLignes(jour, aAllouer, lotsParFiche);
    // Contrôle du stock vendable, sous les verrous (D713 à D715) : d'abord le
    // stock insuffisant, puis la sortie manuelle requise.
    const { insuffisantes, sortiesManuelles: aSortieManuelle } =
      controlerStockVente({
        lignes: lignesCalculees.map((c, index) => ({
          index,
          stockMedicamentId: c.fiche.id,
          nom: c.fiche.medicament.nom,
          unite: c.calcul.uniteAffichee,
          nombre: c.ligne.quantite,
          quantiteUm: c.calcul.quantiteUm,
          coefficientLigne:
            c.calcul.uniteAffichee === 'UNITE'
              ? 1
              : c.calcul.coefficientApplique,
          sortieManuelle: Boolean(c.ligne.sortieManuelle),
        })),
        allouees,
        soldeProduit: avantParFiche,
      });
    if (insuffisantes.length > 0) {
      const fichesEnCause = new Map<string, FicheStockInsuffisant>();
      for (const i of insuffisantes) {
        const f = parId.get(i.stockMedicamentId)!;
        fichesEnCause.set(f.id, {
          nom: f.medicament.nom,
          disponibleUm: i.disponibleUm,
          coefficientBoite: f.coefficientBoite,
          uniteMinimale: f.uniteMinimale,
        });
      }
      throw new ConflictException({
        message: messageStockInsuffisant([...fichesEnCause.values()]),
        code: 'STOCK_INSUFFISANT',
        details: insuffisantes.map((i) => ({
          stockId: i.stockMedicamentId,
          nom: i.nom,
          unite: i.unite,
          demande: i.demande,
          disponible: i.disponible,
          disponibleUm: i.disponibleUm,
        })),
      });
    }
    if (aSortieManuelle.length > 0) {
      const noms = aSortieManuelle.map(
        (a) => lignesCalculees[a.index].fiche.medicament.nom,
      );
      throw new ConflictException({
        message: messageSortieManuelleRequise(noms),
        code: 'SORTIE_MANUELLE_REQUISE',
        details: aSortieManuelle.map((a) => ({
          stockId: lignesCalculees[a.index].fiche.id,
          nom: lignesCalculees[a.index].fiche.medicament.nom,
          disponible: a.quantiteAllouee,
          demande: lignesCalculees[a.index].calcul.quantiteUm,
          lots: a.lotsPerimesDisponibles,
        })),
      });
    }

    // 13 à 16. Pièce, paiements, mouvements et anomalies de stock négatif (D657)
    const { venteId, apresParFiche } = await ecrirePieceVente(
      tx,
      this.mouvementsStock,
      {
        structureId,
        adminId: structure.adminId,
        pointDeVenteId,
        posteId,
        posteCode,
        sessionId,
        typePiece: 'VENTE',
        provisoireAutorise: false,
        numero,
        numeroTicket: Number(numeroTicket),
        jourMetier,
        vendeur: { id: user.id, nom: utilisateurNom },
        clientNom: dto.clientNom?.trim() || credit?.nomComplet || null,
        clientTelephone:
          dto.clientTelephone?.trim() || credit?.telephone || null,
        clientCreditId: credit?.clientCreditId ?? null,
        ordonnanceVerifiee: dto.ordonnanceVerifiee === true,
        telephonePrescripteur: dto.telephonePrescripteur ?? null,
        total,
        cleIdempotence: cle,
        lignes: lignesCalculees.map((c, index) => ({
          fiche: {
            id: c.fiche.id,
            medicamentId: c.fiche.medicamentId,
            nom: c.fiche.medicament.nom,
          },
          calcul: c.calcul,
          allocation: allouees[index],
        })),
        paiements,
      },
    );

    // 16b. Date limite de la prise à crédit (Vente est immuable : la date vit à part)
    if (credit?.dateLimite) {
      await tx.echeanceCredit.create({
        data: { venteId, dateLimite: jourVersDate(credit.dateLimite) },
      });
    }

    // 17. Audit
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'create',
        entityType: 'Vente',
        entityId: venteId,
        ip: ip ?? null,
        metadata: {
          numero,
          total,
          nombreLignes: lignesCalculees.length,
          sessionOuverteAutomatiquement: ouverteAutomatiquement,
          ...(credit
            ? {
                credit: true,
                clientCreditId: credit.clientCreditId,
                dateLimite: credit.dateLimite,
              }
            : {}),
        },
      },
    });

    // 18. Stock bas
    const parametres = await tx.parametresPharmacie.findUnique({
      where: { structureId },
      select: { seuilStockBas: true },
    });
    const seuil = parametres?.seuilStockBas ?? SEUIL_STOCK_BAS_DEFAUT;
    const passages = passagesStockBas(
      fiches.map((f) => ({
        nom: f.medicament.nom,
        coefficientBoite: f.coefficientBoite,
        avant: avantParFiche.get(f.id) ?? 0,
        apres: apresParFiche.get(f.id) ?? avantParFiche.get(f.id) ?? 0,
      })),
      seuil,
    );

    // 19. Relecture (les paiements sont créés après la vente)
    const complete = await tx.vente.findUniqueOrThrow({
      where: { id: venteId },
      include: INCLUDE_VENTE,
    });
    return { vente: complete, passages, ouverteAutomatiquement };
  }

  /**
   * Vente à crédit : vérifie le corps, retrouve le client de la pharmacie ou le crée dans
   * la transaction, contrôle la date limite. Null si la vente n'est pas à crédit.
   */
  private async preparerCredit(
    tx: Prisma.TransactionClient,
    entree: {
      structureId: string;
      userId: string;
      dto: CreerVenteDto;
      ip?: string | null;
    },
  ): Promise<{
    clientCreditId: string;
    nomComplet: string;
    telephone: string | null;
    dateLimite: string | null;
  } | null> {
    const { structureId, userId, dto, ip } = entree;
    if (!estVenteACredit(dto)) {
      if (dto.dateLimiteCredit !== undefined) {
        throw new BadRequestException({
          message:
            "Une date limite ne s'applique qu'à une vente à crédit : choisissez un client de crédit.",
          code: 'CREDIT_PAIEMENTS_INCOHERENTS',
        });
      }
      return null;
    }
    if (dto.clientCreditId && dto.nouveauClientCredit) {
      throw new BadRequestException({
        message:
          'Choisissez un client existant ou créez-en un nouveau, pas les deux.',
        code: 'VALIDATION',
        champs: [{ champ: 'nouveauClientCredit', contraintes: ['exclusif'] }],
      });
    }
    if (!dto.clientCreditId && !dto.nouveauClientCredit) {
      throw new BadRequestException({
        message: 'Choisissez le client à qui accorder ce crédit.',
        code: 'CREDIT_CLIENT_REQUIS',
      });
    }
    if (
      dto.paiements &&
      !(dto.paiements.length === 1 && dto.paiements[0].mode === CODE_CREDIT)
    ) {
      throw new BadRequestException({
        message:
          'Une vente à crédit se règle entièrement à crédit : retirez les autres paiements.',
        code: 'CREDIT_PAIEMENTS_INCOHERENTS',
      });
    }
    const dateLimite = dto.dateLimiteCredit ?? null;
    if (dateLimite !== null) {
      const valide = new Date(`${dateLimite}T00:00:00.000Z`);
      if (
        Number.isNaN(valide.getTime()) ||
        jourConakry(valide) !== dateLimite
      ) {
        throw new BadRequestException({
          message: 'La date limite doit être une date valide (AAAA-MM-JJ).',
          code: 'VALIDATION',
          champs: [{ champ: 'dateLimiteCredit', contraintes: ['dateValide'] }],
        });
      }
      if (dateLimite < jourConakry(new Date())) {
        throw new BadRequestException({
          message: "La date limite ne peut pas être antérieure à aujourd'hui.",
          code: 'DATE_LIMITE_PASSEE',
        });
      }
    }

    if (dto.clientCreditId) {
      const client = await tx.clientCredit.findFirst({
        where: { id: dto.clientCreditId, structureId },
        select: { id: true, nomComplet: true, telephone: true },
      });
      if (!client) {
        throw new NotFoundException({
          message: 'Ce client de crédit est introuvable.',
          code: 'CLIENT_CREDIT_INTROUVABLE',
        });
      }
      return {
        clientCreditId: client.id,
        nomComplet: client.nomComplet,
        telephone: client.telephone,
        dateLimite,
      };
    }
    const nouveau = dto.nouveauClientCredit as NonNullable<
      CreerVenteDto['nouveauClientCredit']
    >;
    const cree = await tx.clientCredit.create({
      data: {
        structureId,
        nomComplet: nouveau.nomComplet,
        telephone: nouveau.telephone ?? null,
        auteurId: userId,
      },
      select: { id: true, nomComplet: true, telephone: true },
    });
    // Jamais le nom ni le téléphone dans le journal.
    await tx.auditLog.create({
      data: {
        userId,
        action: 'create',
        entityType: 'ClientCredit',
        entityId: cree.id,
        ip: ip ?? null,
        metadata: { structureId, origine: 'vente' },
      },
    });
    return {
      clientCreditId: cree.id,
      nomComplet: cree.nomComplet,
      telephone: cree.telephone,
      dateLimite,
    };
  }

  /** Poste web par défaut de l'utilisateur dans ce point de vente, créé à la volée (D536). */
  private async posteParDefaut(
    tx: Prisma.TransactionClient,
    pointDeVenteId: string,
    user: { id: string; prenom: string },
    ip?: string | null,
  ): Promise<string> {
    const appareilId = PREFIXE_APPAREIL_WEB_DEFAUT + user.id;
    const existant = await tx.poste.findFirst({
      where: { pointDeVenteId, appareilId },
    });
    return (
      existant ??
      (
        await assurerPoste(tx, {
          pointDeVenteId,
          type: 'WEB',
          appareilId,
          user,
          ip,
        })
      ).poste
    ).id;
  }

  /**
   * Session OUVERTE de l'utilisateur sur ce poste, ouverte si besoin, verrouillée
   * (ordre D527 : poste, puis session) ; fermée entre-temps : une seule réouverture.
   */
  private async ouvrirSessionVerrouillee(
    tx: Prisma.TransactionClient,
    entree: {
      structureId: string;
      userId: string;
      utilisateurNom: string;
      posteId: string;
    },
  ): Promise<{
    sessionId: string;
    posteCode: string;
    pointDeVenteId: string;
    ordre: number;
    jourMetier: Date;
    ouverteAutomatiquement: boolean;
  }> {
    const ouvrirEtVerrouiller = async () => {
      const { session, ouverteMaintenant } =
        await this.sessionsCaisse.ouvrirDansTransaction(tx, entree);
      const lignes = await tx.$queryRaw<LigneSession[]>`
        SELECT s."statut"::text AS "statut", s."pointDeVenteId", s."jourMetier", pv."ordre"
        FROM "SessionCaisse" s JOIN "PointDeVente" pv ON pv."id" = s."pointDeVenteId"
        WHERE s."id" = ${session.id} FOR UPDATE OF s`;
      return { session, ouverteMaintenant, ligne: lignes[0] };
    };
    let ouverte = await ouvrirEtVerrouiller();
    if (!ouverte.ligne || ouverte.ligne.statut !== 'OUVERTE') {
      // Fermée entre-temps : le poste est verrouillé, on en ouvre une nouvelle.
      ouverte = await ouvrirEtVerrouiller();
    }
    return {
      sessionId: ouverte.session.id,
      posteCode: ouverte.session.poste.code,
      pointDeVenteId: ouverte.ligne.pointDeVenteId,
      ordre: ouverte.ligne.ordre,
      jourMetier: new Date(ouverte.ligne.jourMetier),
      ouverteAutomatiquement: ouverte.ouverteMaintenant,
    };
  }

  /** Alerte de stock bas aux pharmaciens ; n'échoue jamais la vente. */
  private async alerterStockBas(
    structureId: string,
    venteId: string,
    passages: LignePassage[],
  ): Promise<void> {
    if (passages.length === 0) return;
    try {
      const staff = await this.prisma.user.findMany({
        where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } },
        select: { id: true },
      });
      const destinataires = staff.map((u) => u.id);
      for (const p of passages) {
        await this.notificationsService.createManyNotifications(destinataires, {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message:
            p.apres === 0
              ? `Le stock de "${p.nom}" est épuisé.`
              : `Le stock de "${p.nom}" est descendu à ${p.apres} unités.`,
        });
      }
    } catch {
      this.logger.warn(`vente.alerte_stock_echec venteId=${venteId}`);
    }
  }

  async listerVentes(
    structureId: string,
    userId: string,
    query: ListerVentesQueryDto,
  ) {
    await this.accesPharmacie.verifier(structureId, userId);

    const jour = query.date ?? jourConakry(new Date());
    const dateValide = new Date(`${jour}T00:00:00.000Z`);
    if (
      Number.isNaN(dateValide.getTime()) ||
      jourConakry(dateValide) !== jour
    ) {
      throw new BadRequestException({
        message: 'La date doit être une date valide au format AAAA-MM-JJ.',
        code: 'VALIDATION',
        champs: [{ champ: 'date', contraintes: ['dateValide'] }],
      });
    }
    const page = query.page ?? 1;
    const filtre = { structureId, jourMetier: jourVersDate(jour) };

    const [nombre, somme, ventes] = await Promise.all([
      this.prisma.vente.count({ where: filtre }),
      this.prisma.vente.aggregate({
        _sum: { total: true },
        where: { ...filtre, statut: 'VALIDEE' },
      }),
      this.prisma.vente.findMany({
        where: filtre,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * VENTES_PAR_PAGE,
        take: VENTES_PAR_PAGE,
        include: {
          lignes: { select: { quantite: true } },
          venteOrigine: { select: { id: true, numero: true } },
          pieceLiee: { select: SELECT_PIECE_LIEE },
        },
      }),
    ]);

    return {
      data: {
        date: jour,
        totalJour: somme._sum.total ?? 0,
        nombre,
        page,
        parPage: VENTES_PAR_PAGE,
        totalPages: Math.max(1, Math.ceil(nombre / VENTES_PAR_PAGE)),
        ventes: ventes.map((v) => {
          const etat = deriverAnnulation(v, v.pieceLiee);
          return {
            id: v.id,
            numero: v.numero,
            createdAt: v.createdAt,
            statut: etat.statut,
            total: v.total,
            nombreArticles: v.lignes.reduce((n, l) => n + l.quantite, 0),
            vendeur: { id: v.vendeurId, nom: v.vendeurNom },
            clientNom: v.clientNom,
            clientCreditId: v.clientCreditId,
            telephonePrescripteur: v.telephonePrescripteur,
            typePiece: v.typePiece,
            numeroTicket: v.numeroTicket,
            jourMetier: dateVersJour(v.jourMetier),
            venteOrigine: v.venteOrigine
              ? { id: v.venteOrigine.id, numero: v.venteOrigine.numero }
              : null,
            annulation: etat.annulation
              ? { id: etat.annulation.id, numero: etat.annulation.numero }
              : null,
          };
        }),
      },
      message: `${nombre} vente(s) le ${jour}.`,
      success: true,
    };
  }

  async detailVente(structureId: string, venteId: string, userId: string) {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const peutVoirMarge = await this.peutVoirMarge(userId);
    const vente = await this.prisma.vente.findFirst({
      where: { id: venteId, structureId },
      include: INCLUDE_VENTE,
    });
    if (!vente) throw new NotFoundException('Cette vente est introuvable.');
    return {
      data: await this.avecCredit(
        masquerCouts(
          this.presenterVente(vente, this.pharmacieRecu(structure)),
          peutVoirMarge,
        ),
        vente,
      ),
      message: 'Vente trouvée.',
      success: true,
    };
  }

  async annulerVente(
    structureId: string,
    venteId: string,
    userId: string,
    dto: AnnulerVenteDto,
    ip?: string | null,
  ) {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const pharmacie = this.pharmacieRecu(structure);
    const peutVoirMarge = await this.peutVoirMarge(userId);
    const utilisateurNom = `${user.prenom} ${user.nom}`.trim();
    const motif = dto.motif.trim();

    const dejaAnnulee = () =>
      new ConflictException({
        message: MESSAGE_VENTE_DEJA_ANNULEE,
        code: 'VENTE_DEJA_ANNULEE',
      });
    const nonAnnulable = (message: string) =>
      new ConflictException({ message, code: 'PIECE_NON_ANNULABLE' });

    let resultat: {
      vente: VenteComplete;
      numeroPiece: string;
      pieceId: string;
    };
    try {
      resultat = await this.prisma.$transaction(async (tx) => {
        // 0. Verrou de journée partagé (D613) : aucune clôture ne s'intercale
        await verrouillerJourneesPartage(tx, structureId);

        // 1. Origine
        const origine = await tx.vente.findFirst({
          where: { id: venteId, structureId },
          include: {
            lignes: { include: { allocations: true } },
            paiements: true,
            pieceLiee: { select: { id: true, typePiece: true } },
            sessionCaisse: { select: { technique: true } },
          },
        });
        if (!origine) {
          throw new NotFoundException('Cette vente est introuvable.');
        }
        if (origine.typePiece !== 'VENTE') {
          throw nonAnnulable(MESSAGE_PIECE_NON_ANNULABLE);
        }
        if (
          origine.statut === 'ANNULEE' ||
          origine.pieceLiee?.typePiece === 'ANNULATION'
        ) {
          throw dejaAnnulee();
        }
        if (origine.pieceLiee) {
          throw nonAnnulable(MESSAGE_VENTE_REGULARISEE);
        }
        if (origine.sessionCaisse.technique) {
          throw nonAnnulable(MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE);
        }

        // 1b. Vente à crédit : verrou du client AVANT tout autre, comme le remboursement (ordre des
        // verrous : journées, client de crédit, poste, session, vente d'origine, fiches). Un remboursement
        // concurrent relit ainsi le reste après cette annulation et ne peut plus le dépasser.
        if (origine.clientCreditId) {
          await tx.$queryRaw`SELECT "id" FROM "ClientCredit" WHERE "id" = ${origine.clientCreditId} FOR UPDATE`;
        }

        // 2. Poste et session de l'auteur (verrous : poste, session)
        const posteId =
          dto.posteId ??
          (await this.posteParDefaut(tx, origine.pointDeVenteId, user, ip));
        const session = await this.ouvrirSessionVerrouillee(tx, {
          structureId,
          userId: user.id,
          utilisateurNom,
          posteId,
        });
        if (session.pointDeVenteId !== origine.pointDeVenteId) {
          throw new ConflictException({
            message: MESSAGE_POSTE_AUTRE_POINT_DE_VENTE,
            code: 'POSTE_INCONNU',
          });
        }

        // 3. Verrou de l'origine : deux annulations simultanées sont sérialisées (D545).
        await tx.$queryRaw`SELECT "id" FROM "Vente" WHERE "id" = ${origine.id} FOR UPDATE`;
        const liee = await tx.vente.findUnique({
          where: { venteOrigineId: origine.id },
          select: { typePiece: true },
        });
        if (liee) {
          throw liee.typePiece === 'ANNULATION'
            ? dejaAnnulee()
            : nonAnnulable(MESSAGE_VENTE_REGULARISEE);
        }

        // 4. Verrous des fiches
        await this.mouvementsStock.verrouillerFiches(
          tx,
          origine.lignes.map((l) => l.stockMedicamentId),
        );

        // 4a. Allocations relues sous les verrous des fiches : une réception a pu résoudre une provisoire (D578)
        const allocationsRelues = await tx.allocationLot.findMany({
          where: { ligneVenteId: { in: origine.lignes.map((l) => l.id) } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const lignesOrigine = origine.lignes.map((l) => ({
          ...l,
          allocations: allocationsRelues.filter((a) => a.ligneVenteId === l.id),
        }));

        // 4b. Vente antérieure à une multiplication du stock (D561)
        const lotsAlloues = [
          ...new Set(
            lignesOrigine
              .flatMap((l) => l.allocations)
              .map((a) => a.lotId)
              .filter((id): id is string => id !== null),
          ),
        ];
        if (lotsAlloues.length > 0) {
          const qualification = await tx.mouvementStock.findFirst({
            where: {
              pieceOrigineType: 'QUALIFICATION',
              lotId: { in: lotsAlloues },
              horodatageServeur: { gte: origine.createdAt },
            },
            select: { id: true },
          });
          if (qualification) {
            throw nonAnnulable(MESSAGE_VENTE_AVANT_QUALIFICATION);
          }
        }

        // 5. Calcul des opposés
        const lignes = lignesInverses(lignesOrigine);
        const paiements = paiementsInverses(origine.paiements, origine.total);
        const total = origine.total === 0 ? 0 : -origine.total;
        const numero = numeroAnnulation(origine.numero);

        // 6. Pièce d'annulation
        const piece = await tx.vente.create({
          data: {
            structureId,
            pointDeVenteId: session.pointDeVenteId,
            posteId,
            sessionCaisseId: session.sessionId,
            typePiece: 'ANNULATION',
            venteOrigineId: origine.id,
            numero,
            numeroTicket: null,
            jourMetier: session.jourMetier,
            vendeurId: user.id,
            vendeurNom: utilisateurNom,
            clientNom: origine.clientNom,
            clientTelephone: origine.clientTelephone,
            ordonnanceVerifiee: origine.ordonnanceVerifiee,
            telephonePrescripteur: origine.telephonePrescripteur,
            total,
            motifAnnulation: motif,
            lignes: {
              create: lignes.map((l) => ({
                medicamentId: l.medicamentId,
                stockMedicamentId: l.stockMedicamentId,
                nomMedicament: l.nomMedicament,
                prixUnitaire: l.prixUnitaire,
                quantite: l.quantite,
                sousTotal: l.sousTotal,
                uniteAffichee: l.uniteAffichee,
                nombreAffiche: l.nombreAffiche,
                coefficientApplique: l.coefficientApplique,
                allocations: {
                  create: l.allocations.map((a) => ({
                    lotId: a.lotId,
                    numeroLot: a.numeroLot,
                    dateExpiration: a.dateExpiration,
                    quantite: a.quantite,
                    coutUnitaire: a.coutUnitaire,
                    lotTechnique: a.lotTechnique,
                    statut: a.statut,
                    sortieManuelle: false,
                    motif: null,
                    auteurId: user.id,
                  })),
                },
              })),
            },
          },
          select: { id: true },
        });

        // 7. Remboursement dans la session de l'auteur
        await tx.paiement.createMany({
          data: paiements.map((p) => ({
            venteId: piece.id,
            sessionCaisseId: session.sessionId,
            modePaiementId: p.modePaiementId,
            montant: p.montant,
            referenceExterne: null,
            montantRecu: null,
          })),
        });

        // 8. Mouvements de stock : retour dans les lots d'origine
        for (const l of lignes) {
          for (const a of l.allocations) {
            await this.mouvementsStock.ecrire(tx, {
              pointDeVenteId: session.pointDeVenteId,
              stockMedicamentId: l.stockMedicamentId,
              lotId: a.lotId,
              type: 'CORRECTION',
              quantite: -a.quantite,
              pieceOrigineType: 'ANNULATION',
              pieceOrigineId: piece.id,
              motif,
              auteurId: user.id,
              posteId,
            });
          }
        }

        // 9. Audit (jamais le motif ni le client)
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'annuler',
            entityType: 'Vente',
            entityId: origine.id,
            ip: ip ?? null,
            metadata: {
              numero: origine.numero,
              total: origine.total,
              pieceId: piece.id,
              numeroPiece: numero,
              sessionCaisseId: session.sessionId,
              sessionOuverteAutomatiquement: session.ouverteAutomatiquement,
            },
          },
        });

        // 10. Relecture de l'origine
        const vente = await tx.vente.findUniqueOrThrow({
          where: { id: origine.id },
          include: INCLUDE_VENTE,
        });
        return { vente, numeroPiece: numero, pieceId: piece.id };
      }, OPTIONS_TRANSACTION_VENTE);
    } catch (erreur) {
      if (estDoublonSur(erreur, 'Vente')) throw dejaAnnulee();
      throw erreur;
    }

    const { vente, numeroPiece, pieceId } = resultat;
    this.logger.log(`vente.annulee venteId=${vente.id} pieceId=${pieceId}`);
    return {
      data: masquerCouts(this.presenterVente(vente, pharmacie), peutVoirMarge),
      message: vente.clientCreditId
        ? `Vente à crédit ${vente.numero} annulée (${numeroPiece}). Les quantités ont été remises en stock et le crédit du client est réduit d'autant : aucun argent n'a été rendu.`
        : messageVenteAnnulee(vente.numero, numeroPiece),
      success: true,
    };
  }
}
