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
import { NotificationsService } from 'src/notifications/notifications.service';
import { StorageService } from 'src/storage/storage.service';
import {
  estConflitCleIdempotence,
  lireCleIdempotence,
  SOS_IDEMPOTENCE_HEURES,
} from 'src/carnet-sante/sos-idempotence';
import {
  AnnulerVenteDto,
  CreerVenteDto,
  ListerVentesQueryDto,
} from './dto/vente.dto';

/** Plus grand montant enregistrable (colonne Int de PostgreSQL). */
const PRIX_MAX = 2147483647;
const VENTES_PAR_PAGE = 50;
const SEUIL_STOCK_BAS = 10;
/** Transaction interactive d'une vente : compteur, stocks, vente, audit. */
const OPTIONS_TRANSACTION_VENTE = { maxWait: 5_000, timeout: 15_000 };

/** Jour calendaire (AAAA-MM-JJ) d'une date. Conakry est à UTC+0, donc le jour UTC. */
export function jourConakry(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bornes [début, fin[ d'un jour AAAA-MM-JJ. */
export function bornesDuJour(jour: string): { debut: Date; fin: Date } {
  const debut = new Date(`${jour}T00:00:00.000Z`);
  const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000);
  return { debut, fin };
}

/** Numéro lisible d'une vente : V-AAAA-NNNNNN. */
export function formaterNumero(annee: number, n: number): string {
  return `V-${annee}-${String(n).padStart(6, '0')}`;
}

type VenteAvecLignes = Prisma.VenteGetPayload<{ include: { lignes: true } }>;

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

@Injectable()
export class VenteService {
  private readonly logger = new Logger(VenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /** Membre de la pharmacie (ou son administrateur) ; la structure doit être une pharmacie. */
  private async verifierPharmacie(structureId: string, userId: string) {
    const [user, structure] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nom: true, prenom: true, structureId: true },
      }),
      this.prisma.structure.findUnique({
        where: { id: structureId },
        select: {
          id: true,
          type: true,
          adminId: true,
          nom: true,
          adresse: true,
          ville: true,
          telephone: true,
          logoFile: { select: { key: true } },
        },
      }),
    ]);
    if (!structure) {
      throw new NotFoundException('Cette pharmacie est introuvable.');
    }
    if (
      !user ||
      (user.structureId !== structureId && structure.adminId !== userId) ||
      structure.type !== 'PHARMACIE'
    ) {
      throw new ForbiddenException(
        "Vous n'avez pas accès aux ventes de cette pharmacie.",
      );
    }
    return { user, structure };
  }

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

  /** Forme renvoyée à la création, au rejeu, au détail et à l'annulation (sans clé d'idempotence). */
  private presenterVente(vente: VenteAvecLignes, pharmacie: PharmacieRecu) {
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
      lignes: vente.lignes.map((l) => ({
        id: l.id,
        stockId: l.stockMedicamentId,
        medicamentId: l.medicamentId,
        nomMedicament: l.nomMedicament,
        prixUnitaire: l.prixUnitaire,
        quantite: l.quantite,
        sousTotal: l.sousTotal,
      })),
      pharmacie,
    };
  }

  private reponseRejeu(vente: VenteAvecLignes, pharmacie: PharmacieRecu) {
    this.logger.log(`vente.rejeu venteId=${vente.id}`);
    return {
      data: { ...this.presenterVente(vente, pharmacie), rejeu: true },
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
    const { user, structure } = await this.verifierPharmacie(
      structureId,
      userId,
    );
    const pharmacie = this.pharmacieRecu(structure);

    const ids = dto.lignes.map((l) => l.stockId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        message:
          "Un même médicament ne peut apparaître qu'une fois dans la vente. Regroupez les quantités sur une seule ligne.",
        code: 'VALIDATION',
        champs: [{ champ: 'lignes', contraintes: ['stockUnique'] }],
      });
    }

    // Idempotence, comme le SOS : même clé et même pharmacie dans les 24 h = même vente.
    const cle = lireCleIdempotence(enTeteIdempotence);
    if (cle === null && enTeteIdempotence?.trim()) {
      this.logger.warn('vente.cle_idempotence_ignoree format invalide');
    }
    if (cle) {
      const existante = await this.prisma.vente.findUnique({
        where: {
          structureId_cleIdempotence: { structureId, cleIdempotence: cle },
        },
        include: { lignes: true },
      });
      if (existante) {
        const limite = Date.now() - SOS_IDEMPOTENCE_HEURES * 3600 * 1000;
        if (existante.createdAt.getTime() >= limite) {
          return this.reponseRejeu(existante, pharmacie);
        }
        await this.prisma.vente.update({
          where: { id: existante.id },
          data: { cleIdempotence: null },
        });
        this.logger.log(
          `vente.cle_idempotence_expiree venteId=${existante.id}`,
        );
      }
    }

    let resultat: { vente: VenteAvecLignes; passages: LignePassage[] };
    try {
      resultat = await this.prisma.$transaction(
        (tx) => this.enregistrerVente(tx, structureId, user, dto, cle, ip),
        OPTIONS_TRANSACTION_VENTE,
      );
    } catch (erreur) {
      // Rejeu simultané de la même clé : la vente de l'autre requête fait foi.
      if (cle && estConflitCleIdempotence(erreur)) {
        const existante = await this.prisma.vente.findUnique({
          where: {
            structureId_cleIdempotence: { structureId, cleIdempotence: cle },
          },
          include: { lignes: true },
        });
        if (existante) {
          this.logger.log(`vente.rejeu_concurrent venteId=${existante.id}`);
          return this.reponseRejeu(existante, pharmacie);
        }
      }
      throw erreur;
    }

    const { vente, passages } = resultat;
    await this.alerterStockBas(structureId, vente.id, passages);
    this.logger.log(`vente.creee venteId=${vente.id} numero=${vente.numero}`);

    return {
      data: this.presenterVente(vente, pharmacie),
      message: `Vente enregistrée (${vente.numero}).`,
      success: true,
    };
  }

  /** Corps de la transaction de création : tout ou rien. */
  private async enregistrerVente(
    tx: Prisma.TransactionClient,
    structureId: string,
    user: { id: string; nom: string; prenom: string },
    dto: CreerVenteDto,
    cle: string | null,
    ip?: string | null,
  ): Promise<{ vente: VenteAvecLignes; passages: LignePassage[] }> {
    const maintenant = new Date();
    const annee = maintenant.getUTCFullYear();

    // Le compteur verrouille la ligne : les ventes d'une pharmacie passent l'une après l'autre.
    const [{ dernierNumero }] = await tx.$queryRaw<
      { dernierNumero: number }[]
    >`INSERT INTO "CompteurVente" ("structureId", "annee", "dernierNumero") VALUES (${structureId}, ${annee}, 1) ON CONFLICT ("structureId", "annee") DO UPDATE SET "dernierNumero" = "CompteurVente"."dernierNumero" + 1 RETURNING "dernierNumero"`;

    const ids = dto.lignes.map((l) => l.stockId);
    const stocks = await tx.stockMedicament.findMany({
      where: { id: { in: ids }, structureId },
      include: {
        medicament: {
          select: { id: true, nom: true, ordonnanceRequise: true },
        },
      },
    });
    const parId = new Map(stocks.map((s) => [s.id, s]));

    // Refus, un seul code par réponse, toutes les lignes concernées dans `details`.
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

    const jourMaintenant = jourConakry(maintenant);
    const perimes = stocks.filter(
      (s) =>
        s.dateExpiration !== null &&
        jourConakry(s.dateExpiration) < jourMaintenant,
    );
    if (perimes.length > 0) {
      throw new BadRequestException({
        message:
          perimes.length === 1
            ? `Vente impossible : « ${perimes[0].medicament.nom} » est périmé. Retirez-le du panier.`
            : `Vente impossible : ${perimes.length} médicaments du panier sont périmés. Retirez-les du panier.`,
        code: 'MEDICAMENT_EXPIRE',
        details: perimes.map((s) => ({
          stockId: s.id,
          nom: s.medicament.nom,
        })),
      });
    }

    const sansPrix = stocks.filter(
      (s) => s.prixUnitaire === null || s.prixUnitaire <= 0,
    );
    if (sansPrix.length > 0) {
      throw new BadRequestException({
        message:
          sansPrix.length === 1
            ? `Vente impossible : « ${sansPrix[0].medicament.nom} » n'a pas de prix. Ajoutez son prix dans le stock puis validez de nouveau.`
            : `Vente impossible : ${sansPrix.length} médicaments du panier n'ont pas de prix. Ajoutez leur prix dans le stock puis validez de nouveau.`,
        code: 'PRIX_MANQUANT',
        details: sansPrix.map((s) => ({
          stockId: s.id,
          nom: s.medicament.nom,
        })),
      });
    }

    if (dto.ordonnanceVerifiee !== true) {
      const surOrdonnance = stocks.filter(
        (s) => s.medicament.ordonnanceRequise,
      );
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

    // Montants : le prix vient du stock, jamais du client.
    const lignes = dto.lignes.map((l) => {
      const stock = parId.get(l.stockId)!;
      const prixUnitaire = stock.prixUnitaire!;
      return {
        medicamentId: stock.medicamentId,
        stockMedicamentId: stock.id,
        nomMedicament: stock.medicament.nom,
        prixUnitaire,
        quantite: l.quantite,
        sousTotal: prixUnitaire * l.quantite,
      };
    });
    const total = lignes.reduce((somme, l) => somme + l.sousTotal, 0);
    if (total > PRIX_MAX) {
      throw new BadRequestException({
        message:
          'Le montant total de la vente est trop élevé. Divisez-la en plusieurs ventes.',
        code: 'VALIDATION',
        champs: [{ champ: 'lignes', contraintes: ['totalMaximal'] }],
      });
    }

    // La vente est créée avant les retraits : un rejeu simultané de la même clé échoue ici.
    const vente = await tx.vente.create({
      data: {
        structureId,
        numero: formaterNumero(annee, dernierNumero),
        vendeurId: user.id,
        vendeurNom: `${user.prenom} ${user.nom}`.trim(),
        clientNom: dto.clientNom?.trim() || null,
        clientTelephone: dto.clientTelephone?.trim() || null,
        ordonnanceVerifiee: dto.ordonnanceVerifiee === true,
        total,
        cleIdempotence: cle,
        lignes: { create: lignes },
      },
      include: { lignes: true },
    });

    // Retraits atomiques, dans un ordre stable (pas d'interblocage entre ventes).
    const insuffisantes: string[] = [];
    const triees = [...lignes].sort((a, b) =>
      a.stockMedicamentId < b.stockMedicamentId
        ? -1
        : a.stockMedicamentId > b.stockMedicamentId
          ? 1
          : 0,
    );
    for (const l of triees) {
      const { count } = await tx.stockMedicament.updateMany({
        where: {
          id: l.stockMedicamentId,
          structureId,
          quantite: { gte: l.quantite },
        },
        data: { quantite: { decrement: l.quantite } },
      });
      if (count === 0) insuffisantes.push(l.stockMedicamentId);
    }
    if (insuffisantes.length > 0) {
      const restants = await tx.stockMedicament.findMany({
        where: { id: { in: insuffisantes } },
        select: { id: true, quantite: true },
      });
      const details = insuffisantes.map((stockId) => {
        const stock = parId.get(stockId)!;
        const disponible =
          restants.find((r) => r.id === stockId)?.quantite ?? 0;
        const demande =
          lignes.find((l) => l.stockMedicamentId === stockId)?.quantite ?? 0;
        return { stockId, nom: stock.medicament.nom, disponible, demande };
      });
      throw new ConflictException({
        message:
          details.length === 1
            ? `Le stock ne suffit plus pour « ${details[0].nom} » : il en reste ${details[0].disponible}. Ajustez la quantité puis validez de nouveau.`
            : `Le stock ne suffit plus pour ${details.length} médicaments du panier. Ajustez les quantités puis validez de nouveau.`,
        code: 'STOCK_INSUFFISANT',
        details,
      });
    }

    await tx.stockMedicament.updateMany({
      where: { id: { in: ids }, structureId, quantite: 0 },
      data: { disponible: false },
    });

    const apresStocks = await tx.stockMedicament.findMany({
      where: { id: { in: ids } },
      select: { id: true, quantite: true },
    });
    const passages: LignePassage[] = [];
    for (const l of lignes) {
      const apres = apresStocks.find(
        (s) => s.id === l.stockMedicamentId,
      )?.quantite;
      if (apres === undefined) continue;
      const avant = apres + l.quantite;
      if (avant >= SEUIL_STOCK_BAS && apres < SEUIL_STOCK_BAS) {
        passages.push({ nom: l.nomMedicament, apres });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'create',
        entityType: 'Vente',
        entityId: vente.id,
        ip: ip ?? null,
        metadata: {
          numero: vente.numero,
          total,
          nombreLignes: lignes.length,
        },
      },
    });

    return { vente, passages };
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
    await this.verifierPharmacie(structureId, userId);

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
    const { structure } = await this.verifierPharmacie(structureId, userId);
    const vente = await this.prisma.vente.findFirst({
      where: { id: venteId, structureId },
      include: { lignes: true },
    });
    if (!vente) throw new NotFoundException('Cette vente est introuvable.');
    return {
      data: this.presenterVente(vente, this.pharmacieRecu(structure)),
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
    const { structure } = await this.verifierPharmacie(structureId, userId);

    const { vente, lignesNonRemises } = await this.prisma.$transaction(
      async (tx) => {
        const maintenant = new Date();
        const courante = await tx.vente.findFirst({
          where: { id: venteId, structureId },
          include: { lignes: true },
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
          include: { lignes: true },
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
      data: this.presenterVente(vente, this.pharmacieRecu(structure)),
      message,
      success: true,
    };
  }
}
