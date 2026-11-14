import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import {
  exigerJourOuvert,
  messageCaisseJourneeCloturee,
  verrouillerJourneesPartage,
} from '../caisse/journee';
import { SessionsCaisseService } from '../caisse/sessions-caisse.service';
import {
  CreerClientCreditDto,
  EnregistrerRemboursementDto,
  ListerClientsCreditQueryDto,
  ModifierClientCreditDto,
  ModifierDateLimiteDto,
} from '../dto/credit.dto';
import { jourConakry } from '../jour-metier';
import type { Reponse } from '../points-de-vente.service';
import { dateVersJour, jourVersDate } from '../stock/lecture-stock';
import {
  calculerEtatCredit,
  chiffres,
  normaliser,
  resumerMedicaments,
  type EtatCredit,
  type PriseCalcul,
  type StatutCredit,
} from './credit-regles';

export const MESSAGE_CLIENT_CREDIT_INTROUVABLE =
  'Ce client de crédit est introuvable.';
export const MESSAGE_PRISE_INTROUVABLE =
  'Cette prise à crédit est introuvable.';
export const MESSAGE_CREDIT_DEJA_SOLDE = 'Ce client ne doit plus rien.';
export const MESSAGE_CAISSE_NON_OUVERTE =
  'Aucune caisse ouverte à votre nom : ouvrez votre caisse pour y verser cet argent, ou décochez « Mettre cet argent dans ma caisse ».';
export const MESSAGE_PRISE_ANNULEE =
  'Cette prise a été annulée : elle ne compte plus dans ce que le client doit.';
export const MESSAGE_PRISE_SOLDEE =
  'Cette prise est déjà soldée : sa date limite ne se modifie plus.';
export const MESSAGE_DATE_LIMITE_PASSEE =
  "La date limite ne peut pas être antérieure à aujourd'hui.";

export function messageMontantSuperieurAuReste(reste: number): string {
  return `Le montant dépasse ce que le client doit : il reste ${formaterGnf(reste)} GNF à payer.`;
}

function formaterGnf(montant: number): string {
  return String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const PAR_PAGE_DEFAUT = 50;

const ORDRE_STATUT: Record<StatutCredit, number> = {
  EN_RETARD: 0,
  EN_COURS: 1,
  SOLDE: 2,
};

/** Une prise à crédit lue : vente rattachée, avec ses lignes (jamais de coût d'achat) et son éventuelle annulation. */
const SELECT_PRISE = {
  id: true,
  numero: true,
  clientCreditId: true,
  total: true,
  createdAt: true,
  jourMetier: true,
  vendeurNom: true,
  lignes: {
    select: {
      nomMedicament: true,
      quantite: true,
      nombreAffiche: true,
      uniteAffichee: true,
      sousTotal: true,
    },
  },
  pieceLiee: {
    select: { typePiece: true, motifAnnulation: true, createdAt: true },
  },
} satisfies Prisma.VenteSelect;
type PriseLue = Prisma.VenteGetPayload<{ select: typeof SELECT_PRISE }>;

type Client = PrismaService | Prisma.TransactionClient;

export interface ClientCreditResume {
  id: string;
  nomComplet: string;
  telephone: string | null;
  resteAPayer: number;
  statut: StatutCredit;
  /** Date (ISO) de la prise la plus récente non annulée, ou null. */
  dernierePrise: Date | null;
  /** Noms des médicaments des prises non soldées, tronqué (« A, B, C et 2 autres »). */
  resume: string;
  /** Date limite (AAAA-MM-JJ) la plus proche parmi les prises non soldées, ou null. */
  dateLimite: string | null;
  nombrePrises: number;
}

export interface PriseCreditReponse {
  venteId: string;
  numero: string;
  createdAt: Date;
  jourMetier: string;
  vendeurNom: string;
  total: number;
  /** Ce qu'il reste à payer sur cette prise (remboursements imputés aux prises les plus anciennes d'abord). */
  resteSurPrise: number;
  soldee: boolean;
  annulee: boolean;
  motifAnnulation: string | null;
  dateLimite: string | null;
  lignes: {
    nomMedicament: string;
    quantite: number;
    nombreAffiche: number;
    uniteAffichee: 'BOITE' | 'UNITE';
    sousTotal: number;
  }[];
}

export interface RemboursementReponse {
  id: string;
  montant: number;
  note: string | null;
  verseEnCaisse: boolean;
  auteurNom: string | null;
  createdAt: Date;
}

export interface FicheClientCredit {
  id: string;
  nomComplet: string;
  telephone: string | null;
  note: string | null;
  createdAt: Date;
  resteAPayer: number;
  totalPris: number;
  totalRembourse: number;
  statut: StatutCredit;
  dateLimite: string | null;
  prises: PriseCreditReponse[];
  remboursements: RemboursementReponse[];
}

function versPriseCalcul(
  v: PriseLue,
  echeances: Map<string, string>,
): PriseCalcul {
  return {
    venteId: v.id,
    total: v.total,
    annulee: v.pieceLiee?.typePiece === 'ANNULATION',
    dateLimite: echeances.get(v.id) ?? null,
    createdAt: v.createdAt,
  };
}

/** Cahier de crédit : clients, prises (ventes en mode CREDIT), remboursements. */
@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly sessionsCaisse: SessionsCaisseService,
  ) {}

  // ------------------------------------------------------------ lectures

  /** Prises, dates limites et total remboursé de clients donnés ; calcule l'état de chacun. */
  private async etatsDe(
    client: Client,
    structureId: string,
    clientIds: string[],
  ): Promise<
    Map<
      string,
      { etat: EtatCredit; ventes: Map<string, PriseLue>; rembourse: number }
    >
  > {
    const resultat = new Map<
      string,
      { etat: EtatCredit; ventes: Map<string, PriseLue>; rembourse: number }
    >();
    if (clientIds.length === 0) return resultat;
    const [ventes, remboursements] = await Promise.all([
      client.vente.findMany({
        where: {
          structureId,
          clientCreditId: { in: clientIds },
          typePiece: 'VENTE',
        },
        select: SELECT_PRISE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      client.remboursementCredit.groupBy({
        by: ['clientCreditId'],
        where: { clientCreditId: { in: clientIds } },
        _sum: { montant: true },
      }),
    ]);
    const echeances = new Map(
      (
        await client.echeanceCredit.findMany({
          where: { venteId: { in: ventes.map((v) => v.id) } },
          select: { venteId: true, dateLimite: true },
        })
      ).map((e) => [e.venteId, dateVersJour(e.dateLimite)]),
    );
    const rembourseParClient = new Map(
      remboursements.map((r) => [r.clientCreditId, r._sum.montant ?? 0]),
    );
    const aujourdhui = jourConakry(new Date());
    for (const id of clientIds) {
      const siennes = ventes.filter((v) => v.clientCreditId === id);
      const rembourse = rembourseParClient.get(id) ?? 0;
      resultat.set(id, {
        etat: calculerEtatCredit(
          siennes.map((v) => versPriseCalcul(v, echeances)),
          rembourse,
          aujourdhui,
        ),
        ventes: new Map(siennes.map((v) => [v.id, v])),
        rembourse,
      });
    }
    return resultat;
  }

  async lister(
    structureId: string,
    userId: string,
    query: ListerClientsCreditQueryDto,
  ): Promise<
    Reponse<{
      clients: ClientCreditResume[];
      total: number;
      page: number;
      parPage: number;
      totalPages: number;
      /** Reste à payer cumulé des clients qui correspondent à la recherche et au filtre. */
      resteTotal: number;
    }>
  > {
    await this.accesPharmacie.verifier(structureId, userId);
    const clients = await this.prisma.clientCredit.findMany({
      where: { structureId },
      select: { id: true, nomComplet: true, telephone: true },
    });
    const etats = await this.etatsDe(
      this.prisma,
      structureId,
      clients.map((c) => c.id),
    );

    const q = normaliser(query.q ?? '');
    const chiffresQ = chiffres(query.q ?? '');
    const lignes: ClientCreditResume[] = [];
    for (const c of clients) {
      if (q !== '') {
        const dansNom = normaliser(c.nomComplet).includes(q);
        const dansTel =
          chiffresQ.length >= 2 &&
          chiffres(c.telephone ?? '').includes(chiffresQ);
        if (!dansNom && !dansTel) continue;
      }
      const e = etats.get(c.id);
      if (!e) continue;
      if (query.statut && e.etat.statut !== query.statut) continue;
      const nonSoldees = e.etat.prises.filter((p) => p.nonSoldee);
      const actives = e.etat.prises.filter((p) => !p.annulee);
      const noms = nonSoldees.flatMap((p) =>
        (e.ventes.get(p.venteId)?.lignes ?? []).map((l) => l.nomMedicament),
      );
      const derniere = actives.reduce<Date | null>(
        (max, p) => (max === null || p.createdAt > max ? p.createdAt : max),
        null,
      );
      lignes.push({
        id: c.id,
        nomComplet: c.nomComplet,
        telephone: c.telephone,
        resteAPayer: e.etat.resteAPayer,
        statut: e.etat.statut,
        dernierePrise: derniere,
        resume: resumerMedicaments(noms),
        dateLimite: e.etat.dateLimiteProche,
        nombrePrises: actives.length,
      });
    }
    lignes.sort(
      (a, b) =>
        ORDRE_STATUT[a.statut] - ORDRE_STATUT[b.statut] ||
        (b.dernierePrise?.getTime() ?? 0) - (a.dernierePrise?.getTime() ?? 0) ||
        a.nomComplet.localeCompare(b.nomComplet, 'fr'),
    );

    const parPage = query.parPage ?? PAR_PAGE_DEFAUT;
    const page = query.page ?? 1;
    const total = lignes.length;
    return {
      data: {
        clients: lignes.slice((page - 1) * parPage, page * parPage),
        total,
        page,
        parPage,
        totalPages: Math.max(1, Math.ceil(total / parPage)),
        resteTotal: lignes.reduce((s, l) => s + l.resteAPayer, 0),
      },
      message: `${total} client(s) de crédit.`,
      success: true,
    };
  }

  private async lireClient(
    client: Client,
    structureId: string,
    clientId: string,
  ) {
    const trouve = await client.clientCredit.findFirst({
      where: { id: clientId, structureId },
    });
    if (!trouve) {
      throw new NotFoundException({
        message: MESSAGE_CLIENT_CREDIT_INTROUVABLE,
        code: 'CLIENT_CREDIT_INTROUVABLE',
      });
    }
    return trouve;
  }

  private async fiche(
    client: Client,
    structureId: string,
    clientId: string,
  ): Promise<FicheClientCredit> {
    const c = await this.lireClient(client, structureId, clientId);
    const e = (await this.etatsDe(client, structureId, [c.id])).get(c.id);
    if (!e) throw new RangeError('État du client introuvable.');
    const remboursements = await client.remboursementCredit.findMany({
      where: { clientCreditId: c.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const echeances = new Map(
      (
        await client.echeanceCredit.findMany({
          where: { venteId: { in: [...e.ventes.keys()] } },
          select: { venteId: true, dateLimite: true },
        })
      ).map((x) => [x.venteId, dateVersJour(x.dateLimite)]),
    );
    const auteurs = await client.user.findMany({
      where: {
        id: { in: [...new Set(remboursements.map((r) => r.auteurId))] },
      },
      select: { id: true, prenom: true, nom: true },
    });
    const nomAuteur = new Map(
      auteurs.map((u) => [u.id, `${u.prenom} ${u.nom}`.trim()]),
    );
    const prises = e.etat.prises
      .map((p): PriseCreditReponse => {
        const v = e.ventes.get(p.venteId) as PriseLue;
        return {
          venteId: v.id,
          numero: v.numero,
          createdAt: v.createdAt,
          jourMetier: dateVersJour(v.jourMetier),
          vendeurNom: v.vendeurNom,
          total: v.total,
          resteSurPrise: p.reste,
          soldee: !p.annulee && !p.nonSoldee,
          annulee: p.annulee,
          motifAnnulation: p.annulee
            ? (v.pieceLiee?.motifAnnulation ?? null)
            : null,
          dateLimite: echeances.get(v.id) ?? null,
          lignes: v.lignes.map((l) => ({
            nomMedicament: l.nomMedicament,
            quantite: l.quantite,
            nombreAffiche: l.nombreAffiche,
            uniteAffichee: l.uniteAffichee,
            sousTotal: l.sousTotal,
          })),
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      id: c.id,
      nomComplet: c.nomComplet,
      telephone: c.telephone,
      note: c.note,
      createdAt: c.createdAt,
      resteAPayer: e.etat.resteAPayer,
      totalPris: e.etat.totalPris,
      totalRembourse: e.etat.totalRembourse,
      statut: e.etat.statut,
      dateLimite: e.etat.dateLimiteProche,
      prises,
      remboursements: remboursements.map((r) => ({
        id: r.id,
        montant: r.montant,
        note: r.note,
        verseEnCaisse: r.verseEnCaisse,
        auteurNom: nomAuteur.get(r.auteurId) ?? null,
        createdAt: r.createdAt,
      })),
    };
  }

  async detail(
    structureId: string,
    userId: string,
    clientId: string,
  ): Promise<Reponse<FicheClientCredit>> {
    await this.accesPharmacie.verifier(structureId, userId);
    return {
      data: await this.fiche(this.prisma, structureId, clientId),
      message: 'Fiche du client de crédit.',
      success: true,
    };
  }

  // ------------------------------------------------------------ écritures

  async creerClient(
    structureId: string,
    userId: string,
    dto: CreerClientCreditDto,
    ip?: string | null,
  ): Promise<Reponse<FicheClientCredit>> {
    await this.accesPharmacie.verifier(structureId, userId);
    const cree = await this.prisma.$transaction(async (tx) => {
      const c = await tx.clientCredit.create({
        data: {
          structureId,
          nomComplet: dto.nomComplet,
          telephone: dto.telephone ?? null,
          note: dto.note ?? null,
          auteurId: userId,
        },
        select: { id: true },
      });
      // Jamais le nom, le téléphone ni la note dans le journal.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'create',
          entityType: 'ClientCredit',
          entityId: c.id,
          ip: ip ?? null,
          metadata: { structureId },
        },
      });
      return c;
    });
    return {
      data: await this.fiche(this.prisma, structureId, cree.id),
      message: 'Client de crédit enregistré.',
      success: true,
    };
  }

  async modifierClient(
    structureId: string,
    userId: string,
    clientId: string,
    dto: ModifierClientCreditDto,
    ip?: string | null,
  ): Promise<Reponse<FicheClientCredit>> {
    await this.accesPharmacie.verifier(structureId, userId);
    await this.prisma.$transaction(async (tx) => {
      const avant = await this.lireClient(tx, structureId, clientId);
      const data: Prisma.ClientCreditUpdateInput = {};
      const champs: string[] = [];
      if (dto.nomComplet !== undefined && dto.nomComplet !== avant.nomComplet) {
        data.nomComplet = dto.nomComplet;
        champs.push('nomComplet');
      }
      if (dto.telephone !== undefined && dto.telephone !== avant.telephone) {
        data.telephone = dto.telephone;
        champs.push('telephone');
      }
      if (dto.note !== undefined && dto.note !== avant.note) {
        data.note = dto.note;
        champs.push('note');
      }
      if (champs.length === 0) return;
      await tx.clientCredit.update({ where: { id: avant.id }, data });
      // Les champs modifiés, jamais leurs valeurs.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'update',
          entityType: 'ClientCredit',
          entityId: avant.id,
          ip: ip ?? null,
          metadata: { structureId, champs },
        },
      });
    });
    return {
      data: await this.fiche(this.prisma, structureId, clientId),
      message: 'Client de crédit mis à jour.',
      success: true,
    };
  }

  async modifierDateLimite(
    structureId: string,
    userId: string,
    venteId: string,
    dto: ModifierDateLimiteDto,
    ip?: string | null,
  ): Promise<Reponse<FicheClientCredit>> {
    await this.accesPharmacie.verifier(structureId, userId);
    const dateLimite = dto.dateLimite;
    if (dateLimite !== null) {
      const valide = new Date(`${dateLimite}T00:00:00.000Z`);
      if (
        Number.isNaN(valide.getTime()) ||
        jourConakry(valide) !== dateLimite
      ) {
        throw new BadRequestException({
          message: 'La date limite doit être une date valide (AAAA-MM-JJ).',
          code: 'VALIDATION',
          champs: [{ champ: 'dateLimite', contraintes: ['dateValide'] }],
        });
      }
      if (dateLimite < jourConakry(new Date())) {
        throw new BadRequestException({
          message: MESSAGE_DATE_LIMITE_PASSEE,
          code: 'DATE_LIMITE_PASSEE',
        });
      }
    }
    const vente = await this.prisma.vente.findFirst({
      where: {
        id: venteId,
        structureId,
        typePiece: 'VENTE',
        clientCreditId: { not: null },
      },
      select: { id: true, clientCreditId: true },
    });
    if (!vente?.clientCreditId) {
      throw new NotFoundException({
        message: MESSAGE_PRISE_INTROUVABLE,
        code: 'PRISE_INTROUVABLE',
      });
    }
    const clientId = vente.clientCreditId;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClientCredit" WHERE "id" = ${clientId} FOR UPDATE`;
      const e = (await this.etatsDe(tx, structureId, [clientId])).get(clientId);
      const prise = e?.etat.prises.find((p) => p.venteId === venteId);
      if (!prise) {
        throw new NotFoundException({
          message: MESSAGE_PRISE_INTROUVABLE,
          code: 'PRISE_INTROUVABLE',
        });
      }
      if (prise.annulee) {
        throw new ConflictException({
          message: MESSAGE_PRISE_ANNULEE,
          code: 'PRISE_ANNULEE',
        });
      }
      if (!prise.nonSoldee) {
        throw new ConflictException({
          message: MESSAGE_PRISE_SOLDEE,
          code: 'PRISE_SOLDEE',
        });
      }
      const avant = await tx.echeanceCredit.findUnique({
        where: { venteId },
        select: { dateLimite: true },
      });
      if (dateLimite === null) {
        if (avant) await tx.echeanceCredit.delete({ where: { venteId } });
      } else {
        await tx.echeanceCredit.upsert({
          where: { venteId },
          create: { venteId, dateLimite: jourVersDate(dateLimite) },
          update: { dateLimite: jourVersDate(dateLimite) },
        });
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: 'update',
          entityType: 'EcheanceCredit',
          entityId: venteId,
          ip: ip ?? null,
          metadata: {
            structureId,
            clientCreditId: clientId,
            avant: avant ? dateVersJour(avant.dateLimite) : null,
            apres: dateLimite,
          },
        },
      });
    });
    return {
      data: await this.fiche(this.prisma, structureId, clientId),
      message:
        dateLimite === null
          ? 'Date limite retirée.'
          : 'Date limite enregistrée.',
      success: true,
    };
  }

  async enregistrerRemboursement(
    structureId: string,
    userId: string,
    clientId: string,
    dto: EnregistrerRemboursementDto,
    ip?: string | null,
  ): Promise<
    Reponse<{
      remboursement: RemboursementReponse & {
        mouvementCaisseId: string | null;
      };
      resteAPayer: number;
      statut: StatutCredit;
    }>
  > {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const verse = dto.verseEnCaisse === true;
    const resultat = await this.prisma.$transaction(
      async (tx) => {
        // Même ordre de verrous que les ventes : journées (partagé), puis client, puis caisse.
        await verrouillerJourneesPartage(tx, structureId);
        await tx.$queryRaw`SELECT "id" FROM "ClientCredit" WHERE "id" = ${clientId} AND "structureId" = ${structureId} FOR UPDATE`;
        const c = await this.lireClient(tx, structureId, clientId);
        const avant = (await this.etatsDe(tx, structureId, [c.id])).get(c.id);
        const reste = avant?.etat.resteAPayer ?? 0;
        if (reste <= 0) {
          throw new ConflictException({
            message: MESSAGE_CREDIT_DEJA_SOLDE,
            code: 'CREDIT_DEJA_SOLDE',
          });
        }
        if (dto.montant > reste) {
          throw new BadRequestException({
            message: messageMontantSuperieurAuReste(reste),
            code: 'MONTANT_SUPERIEUR_AU_RESTE',
            details: { resteAPayer: reste },
          });
        }

        let mouvementCaisseId: string | null = null;
        if (verse) {
          const ouverte = await tx.sessionCaisse.findFirst({
            where: {
              utilisateurId: userId,
              statut: 'OUVERTE',
              technique: false,
              pointDeVente: { structureId },
            },
            orderBy: { ouverteLe: 'desc' },
            select: { id: true },
          });
          if (!ouverte) {
            throw new ConflictException({
              message: MESSAGE_CAISSE_NON_OUVERTE,
              code: 'CAISSE_NON_OUVERTE',
            });
          }
          const s = await this.sessionsCaisse.verrouillerSession(
            tx,
            ouverte.id,
          );
          if (s.statut !== 'OUVERTE') {
            throw new ConflictException({
              message: MESSAGE_CAISSE_NON_OUVERTE,
              code: 'CAISSE_NON_OUVERTE',
            });
          }
          const jourSession = dateVersJour(s.jourMetier);
          await exigerJourOuvert(
            tx,
            s.pointDeVenteId,
            jourSession,
            messageCaisseJourneeCloturee(jourSession),
          );
          // Entrée d'espèces dans la caisse, par le mécanisme des mouvements de caisse.
          const mouvement = await this.sessionsCaisse.ecrireMouvement(tx, {
            sessionId: s.id,
            pointDeVenteId: s.pointDeVenteId,
            type: 'APPORT',
            montant: dto.montant,
            motif: `Remboursement de crédit : ${c.nomComplet}`.slice(0, 200),
            auteurId: user.id,
          });
          mouvementCaisseId = mouvement.id;
        }

        const rembourse = await tx.remboursementCredit.create({
          data: {
            clientCreditId: c.id,
            montant: dto.montant,
            note: dto.note ?? null,
            verseEnCaisse: verse,
            mouvementCaisseId,
            auteurId: user.id,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'create',
            entityType: 'RemboursementCredit',
            entityId: rembourse.id,
            ip: ip ?? null,
            metadata: {
              structureId,
              clientCreditId: c.id,
              montant: dto.montant,
              verseEnCaisse: verse,
              mouvementCaisseId,
            },
          },
        });
        const apres = (await this.etatsDe(tx, structureId, [c.id])).get(c.id);
        return {
          rembourse,
          resteAPayer: apres?.etat.resteAPayer ?? 0,
          statut: apres?.etat.statut ?? 'SOLDE',
          mouvementCaisseId,
        };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    const { rembourse } = resultat;
    return {
      data: {
        remboursement: {
          id: rembourse.id,
          montant: rembourse.montant,
          note: rembourse.note,
          verseEnCaisse: rembourse.verseEnCaisse,
          auteurNom: `${user.prenom} ${user.nom}`.trim(),
          createdAt: rembourse.createdAt,
          mouvementCaisseId: resultat.mouvementCaisseId,
        },
        resteAPayer: resultat.resteAPayer,
        statut: resultat.statut,
      },
      message:
        resultat.resteAPayer === 0
          ? 'Remboursement enregistré : le crédit est soldé.'
          : `Remboursement enregistré : il reste ${formaterGnf(resultat.resteAPayer)} GNF à payer.`,
      success: true,
    };
  }
}
