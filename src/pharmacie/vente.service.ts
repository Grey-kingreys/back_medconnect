import {
  BadRequestException,
  ConflictException,
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
import { bornesDuJour, jourConakry } from './jour-metier';
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
import {
  allouerLignes,
  cleLigneVente,
  formaterNumeroTicket,
  passagesStockBas,
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

/** Lecture complète d'une vente : lignes, allocations, paiements et poste. */
const INCLUDE_VENTE = {
  lignes: { include: { allocations: true } },
  paiements: { include: { modePaiement: true } },
  poste: { select: { id: true, code: true } },
} satisfies Prisma.VenteInclude;
type VenteComplete = Prisma.VenteGetPayload<{ include: typeof INCLUDE_VENTE }>;

export interface PharmacieRecu {
  id: string;
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  logoUrl: string | null;
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
    return {
      id: vente.id,
      numero: vente.numero,
      statut: vente.statut,
      createdAt: vente.createdAt,
      total: vente.total,
      ordonnanceVerifiee: vente.ordonnanceVerifiee,
      clientNom: vente.clientNom,
      clientTelephone: vente.clientTelephone,
      vendeur: { id: vente.vendeurId, nom: vente.vendeurNom },
      annuleeLe: vente.annuleeLe,
      annuleeParId: vente.annuleeParId,
      motifAnnulation: vente.motifAnnulation,
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
      // Remplie par PB12 (pièce d'annulation).
      annulation: null,
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

    const peutVoirMarge = await this.peutVoirMarge(userId);

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
      if (existante)
        return this.reponseRejeu(existante, pharmacie, peutVoirMarge);
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
          return this.reponseRejeu(existante, pharmacie, peutVoirMarge);
        }
      }
      throw erreur;
    }

    const { vente, passages, ouverteAutomatiquement } = resultat;
    await this.alerterStockBas(structureId, vente.id, passages);
    this.logger.log(`vente.creee venteId=${vente.id} numero=${vente.numero}`);

    return {
      data: masquerCouts(
        this.presenterVente(vente, pharmacie, ouverteAutomatiquement),
        peutVoirMarge,
      ),
      message: `Vente enregistrée (${vente.numero}).`,
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

    // 6. Paiements
    const modes = await tx.modePaiement.findMany({ where: { actif: true } });
    const prepares = preparerPaiements(
      total,
      dto.paiements?.map((p) => ({
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
      const appareilId = PREFIXE_APPAREIL_WEB_DEFAUT + user.id;
      const existant = await tx.poste.findFirst({
        where: { pointDeVenteId: pointDeVente.id, appareilId },
      });
      posteId = (
        existant ??
        (
          await assurerPoste(tx, {
            pointDeVenteId: pointDeVente.id,
            type: 'WEB',
            appareilId,
            user,
            ip,
          })
        ).poste
      ).id;
    }

    // 8. Session de caisse
    interface LigneSession {
      statut: string;
      pointDeVenteId: string;
      jourMetier: Date | string;
      ordre: number;
    }
    const ouvrirEtVerrouiller = async () => {
      const { session, ouverteMaintenant } =
        await this.sessionsCaisse.ouvrirDansTransaction(tx, {
          structureId,
          userId: user.id,
          utilisateurNom,
          posteId: posteId,
        });
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
    const ouverteAutomatiquement = ouverte.ouverteMaintenant;
    const sessionId = ouverte.session.id;
    const posteCode = ouverte.session.poste.code;
    const pointDeVenteId = ouverte.ligne.pointDeVenteId;
    const ordre = ouverte.ligne.ordre;
    const jourMetier = new Date(ouverte.ligne.jourMetier);

    // 9. Numéro de ticket
    const [{ numero: numeroTicket }] = await tx.$queryRaw<
      { numero: number }[]
    >`INSERT INTO "CompteurTicket" ("pointDeVenteId", "prochainNumero") VALUES (${pointDeVenteId}, 2)
      ON CONFLICT ("pointDeVenteId") DO UPDATE SET "prochainNumero" = "CompteurTicket"."prochainNumero" + 1
      RETURNING "prochainNumero" - 1 AS "numero"`;
    const numero = formaterNumeroTicket(ordre, Number(numeroTicket));

    // 10. Verrous et lots
    await this.mouvementsStock.verrouillerFiches(tx, ids);
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
    const aSortieManuelle = allouees.filter(
      (a) => a.resteProvisoire > 0 && a.lotsPerimesDisponibles.length > 0,
    );
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

    // 13. Vente
    const vente = await tx.vente.create({
      data: {
        structureId,
        pointDeVenteId,
        posteId,
        sessionCaisseId: sessionId,
        typePiece: 'VENTE',
        numero,
        numeroTicket: Number(numeroTicket),
        jourMetier,
        vendeurId: user.id,
        vendeurNom: utilisateurNom,
        clientNom: dto.clientNom?.trim() || null,
        clientTelephone: dto.clientTelephone?.trim() || null,
        ordonnanceVerifiee: dto.ordonnanceVerifiee === true,
        total,
        cleIdempotence: cle,
        lignes: {
          create: lignesCalculees.map((c, index) => {
            const a = allouees[index];
            return {
              medicamentId: c.fiche.medicamentId,
              stockMedicamentId: c.fiche.id,
              nomMedicament: c.fiche.medicament.nom,
              prixUnitaire: c.calcul.prixAppliqueParUm,
              quantite: c.calcul.quantiteUm,
              sousTotal: c.calcul.montantLigne,
              uniteAffichee: c.calcul.uniteAffichee,
              nombreAffiche: c.calcul.nombreAffiche,
              coefficientApplique: c.calcul.coefficientApplique,
              allocations: {
                create: [
                  ...a.allocations.map((al) => ({
                    lotId: al.lotId,
                    numeroLot: al.numeroLot,
                    dateExpiration: al.dateExpiration
                      ? jourVersDate(al.dateExpiration)
                      : null,
                    quantite: al.quantite,
                    coutUnitaire: al.coutUnitaire,
                    lotTechnique: al.lotTechnique,
                    statut: 'DEFINITIVE' as const,
                    sortieManuelle: al.sortieManuelle,
                    motif: al.motif,
                    auteurId: user.id,
                  })),
                  ...(a.resteProvisoire > 0
                    ? [
                        {
                          lotId: null,
                          numeroLot: null,
                          dateExpiration: null,
                          quantite: a.resteProvisoire,
                          coutUnitaire: 0,
                          lotTechnique: false,
                          statut: 'PROVISOIRE' as const,
                          sortieManuelle: false,
                          motif: null,
                          auteurId: user.id,
                        },
                      ]
                    : []),
                ],
              },
            };
          }),
        },
      },
      select: { id: true },
    });

    // 14. Paiements
    await tx.paiement.createMany({
      data: paiements.map((p) => ({
        venteId: vente.id,
        sessionCaisseId: sessionId,
        modePaiementId: p.modePaiementId,
        montant: p.montant,
        referenceExterne: p.referenceExterne,
        montantRecu: p.montantRecu,
      })),
    });

    // 15. Mouvements de stock
    const apresParFiche = new Map<string, number>();
    for (const [index, c] of lignesCalculees.entries()) {
      const a = allouees[index];
      for (const al of a.allocations) {
        const ecrit = await this.mouvementsStock.ecrire(tx, {
          pointDeVenteId,
          stockMedicamentId: c.fiche.id,
          lotId: al.lotId,
          type: 'VENTE',
          quantite: -al.quantite,
          pieceOrigineType: 'VENTE',
          pieceOrigineId: vente.id,
          motif: al.sortieManuelle ? al.motif : null,
          auteurId: user.id,
          posteId,
        });
        apresParFiche.set(c.fiche.id, ecrit.soldeProduit);
      }
      if (a.resteProvisoire > 0) {
        const ecrit = await this.mouvementsStock.ecrire(tx, {
          pointDeVenteId,
          stockMedicamentId: c.fiche.id,
          lotId: null,
          type: 'VENTE',
          quantite: -a.resteProvisoire,
          pieceOrigineType: 'VENTE',
          pieceOrigineId: vente.id,
          motif: null,
          auteurId: user.id,
          posteId,
        });
        apresParFiche.set(c.fiche.id, ecrit.soldeProduit);
      }
    }

    // 16. Anomalies de stock négatif (jamais de donnée du client)
    for (const [index, c] of lignesCalculees.entries()) {
      const a = allouees[index];
      if (a.resteProvisoire <= 0) continue;
      await tx.anomalie.create({
        data: {
          pointDeVenteId,
          type: 'STOCK_NEGATIF',
          attribueeAId: structure.adminId,
          pieceType: 'VENTE',
          pieceId: vente.id,
          details: {
            stockId: c.fiche.id,
            nom: c.fiche.medicament.nom,
            quantiteProvisoire: a.resteProvisoire,
            soldeProduit: apresParFiche.get(c.fiche.id) ?? 0,
            posteCode,
            utilisateurId: user.id,
            utilisateurNom,
            jourMetier: dateVersJour(jourMetier),
          },
        },
      });
    }

    // 17. Audit
    const provisoire = allouees.some((a) => a.resteProvisoire > 0);
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'create',
        entityType: 'Vente',
        entityId: vente.id,
        ip: ip ?? null,
        metadata: {
          numero,
          total,
          nombreLignes: lignesCalculees.length,
          provisoire,
          sessionOuverteAutomatiquement: ouverteAutomatiquement,
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
      where: { id: vente.id },
      include: INCLUDE_VENTE,
    });
    return { vente: complete, passages, ouverteAutomatiquement };
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
    const { debut, fin } = bornesDuJour(jour);
    const filtre = { structureId, createdAt: { gte: debut, lt: fin } };

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
        include: { lignes: { select: { quantite: true } } },
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
        ventes: ventes.map((v) => ({
          id: v.id,
          numero: v.numero,
          createdAt: v.createdAt,
          statut: v.statut,
          total: v.total,
          nombreArticles: v.lignes.reduce((n, l) => n + l.quantite, 0),
          vendeur: { id: v.vendeurId, nom: v.vendeurNom },
          clientNom: v.clientNom,
        })),
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
      data: masquerCouts(
        this.presenterVente(vente, this.pharmacieRecu(structure)),
        peutVoirMarge,
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
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const peutVoirMarge = await this.peutVoirMarge(userId);

    const { vente, lignesNonRemises } = await this.prisma.$transaction(
      async (tx) => {
        const maintenant = new Date();
        const courante = await tx.vente.findFirst({
          where: { id: venteId, structureId },
          include: INCLUDE_VENTE,
        });
        if (!courante)
          throw new NotFoundException('Cette vente est introuvable.');

        const dejaAnnulee = new ConflictException({
          message: 'Cette vente a déjà été annulée.',
          code: 'VENTE_DEJA_ANNULEE',
        });
        if (courante.statut === 'ANNULEE') throw dejaAnnulee;
        if (jourConakry(courante.createdAt) !== jourConakry(maintenant)) {
          throw new ConflictException({
            message:
              "Une vente ne peut être annulée que le jour même. Celle-ci date d'un autre jour.",
            code: 'ANNULATION_HORS_DELAI',
          });
        }

        // Passage conditionnel : une annulation simultanée ne remet pas le stock deux fois.
        const { count } = await tx.vente.updateMany({
          where: { id: venteId, structureId, statut: 'VALIDEE' },
          data: {
            statut: 'ANNULEE',
            annuleeLe: maintenant,
            annuleeParId: userId,
            motifAnnulation: dto.motif,
          },
        });
        if (count === 0) throw dejaAnnulee;

        let nonRemises = 0;
        const triees = [...courante.lignes].sort((a, b) =>
          a.stockMedicamentId < b.stockMedicamentId
            ? -1
            : a.stockMedicamentId > b.stockMedicamentId
              ? 1
              : 0,
        );
        for (const l of triees) {
          const remise = await tx.stockMedicament.updateMany({
            where: { id: l.stockMedicamentId, structureId },
            data: { quantite: { increment: l.quantite }, disponible: true },
          });
          if (remise.count === 0) nonRemises += 1;
        }

        await tx.auditLog.create({
          data: {
            userId,
            action: 'annuler',
            entityType: 'Vente',
            entityId: venteId,
            ip: ip ?? null,
            metadata: {
              numero: courante.numero,
              total: courante.total,
              lignesNonRemises: nonRemises,
            },
          },
        });

        const apres = await tx.vente.findFirst({
          where: { id: venteId, structureId },
          include: INCLUDE_VENTE,
        });
        if (!apres) throw new NotFoundException('Cette vente est introuvable.');
        return { vente: apres, lignesNonRemises: nonRemises };
      },
      OPTIONS_TRANSACTION_VENTE,
    );

    this.logger.log(`vente.annulee venteId=${vente.id}`);
    const message =
      lignesNonRemises === 0
        ? `Vente ${vente.numero} annulée. Les quantités ont été remises en stock.`
        : lignesNonRemises === 1
          ? `Vente ${vente.numero} annulée. 1 médicament n'était plus dans le stock et n'y a pas été remis.`
          : `Vente ${vente.numero} annulée. ${lignesNonRemises} médicaments n'étaient plus dans le stock et n'y ont pas été remis.`;
    return {
      data: masquerCouts(
        this.presenterVente(vente, this.pharmacieRecu(structure)),
        peutVoirMarge,
      ),
      message,
      success: true,
    };
  }
}
