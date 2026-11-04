import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import { jourValide } from '../domaine/reception';
import { jourConakry, jourLisible, joursAvant } from '../jour-metier';
import { assurerPointDeVente } from '../point-de-vente';
import type { Reponse } from '../points-de-vente.service';
import { MESSAGE_JOUR_INVALIDE } from '../rapports/rapports.service';
import { estDoublonSur } from '../stock/erreurs-base';
import { dateVersJour, jourVersDate } from '../stock/lecture-stock';
import type {
  CloturerJourneeDto,
  ListerCloturesQueryDto,
} from '../dto/clotures.dto';
import { estJourCloture, verrouillerJourneesExclusif } from './journee';
import {
  exporterCloture,
  type MouvementExport,
  type PieceExport,
} from './export-cloture';
import {
  forcageAutorise,
  postesAttendus,
  totauxCloture,
  versPosteManquant,
  type PosteAttendu,
  type PosteCaisse,
  type PosteManquant,
  type ResultatPourCloture,
  type TotalCloture,
} from './cloture-regles';

type Client = PrismaService | Prisma.TransactionClient;

export const OPTIONS_TRANSACTION_CLOTURE = {
  maxWait: 10_000,
  timeout: 30_000,
};
export const MESSAGE_JOUR_FUTUR =
  "Cette journée n'a pas encore eu lieu : elle ne peut pas être clôturée.";
export const MESSAGE_MOTIF_FORCAGE_REQUIS =
  'Indiquez pourquoi vous clôturez sans attendre ces postes (3 caractères au moins).';

export function messageJourAvantDebutCaisse(debut: string): string {
  return `La caisse est utilisée depuis le ${jourLisible(debut)} : les journées précédentes ne se clôturent pas.`;
}

export function messageJourneeNonCloturee(jour: string): string {
  return `La journée du ${jourLisible(jour)} n'est pas encore clôturée : clôturez-la avant de l'exporter.`;
}

export function messageJourneeDejaCloturee(jour: string): string {
  return `La journée du ${jourLisible(jour)} est déjà clôturée.`;
}

/** Poste nommé pour le titulaire : libellé du poste, et vendeur de la caisse ouverte s'il y en a une (D627). */
function nommerPostes(postes: PosteManquant[]): string {
  return postes
    .map((p) =>
      p.utilisateurNom
        ? `${p.libelle} (caisse de ${p.utilisateurNom})`
        : p.libelle,
    )
    .join(', ');
}

export function messageClotureIncomplete(
  jour: string,
  attendus: PosteManquant[],
): string {
  const n = attendus.length;
  const entete = n === 1 ? 'Poste à attendre' : `${n} postes à attendre`;
  return `La journée du ${jourLisible(jour)} ne peut pas encore être clôturée. ${entete} : ${nommerPostes(attendus)}.`;
}

export function messageCaissesAFermer(caisses: PosteManquant[]): string {
  const liste = caisses
    .map((c) => `${c.utilisateurNom} (${c.posteCode})`)
    .join(', ');
  const suite =
    'Une caisse ouverte sur un navigateur se ferme avec le comptage du tiroir, même quand on force la clôture.';
  return caisses.length === 1
    ? `Fermez d'abord cette caisse ouverte sur un navigateur : ${liste}. ${suite}`
    : `Fermez d'abord ces caisses ouvertes sur un navigateur : ${liste}. ${suite}`;
}

export interface SessionResume {
  id: string;
  posteId: string;
  posteCode: string;
  posteLibelle: string;
  posteType: 'WEB' | 'DESKTOP';
  utilisateurId: string;
  utilisateurNom: string;
  statut: 'OUVERTE' | 'FERMEE' | 'INCLUSE_DANS_CLOTURE';
  ouverteLe: Date;
  fermeeLe: Date | null;
}

export interface ClotureReponse {
  id: string;
  jour: string;
  clotureeLe: Date;
  clotureParId: string;
  clotureParNom: string | null;
  forcee: boolean;
  motifForcage: string | null;
  postesManquants: PosteManquant[];
  nombreSessions: number;
  totaux: {
    mode: string;
    libelle: string;
    theorique: number;
    compte: number | null;
    ecart: number | null;
  }[];
}

export interface PreparationCloture {
  jour: string;
  cloture: ClotureReponse | null;
  sessions: SessionResume[];
  sessionsOuvertes: SessionResume[];
  postesAttendus: PosteAttendu[];
  totaux: TotalCloture[];
  peutCloturer: boolean;
  peutForcer: boolean;
}

const INCLUDE_CLOTURE = {
  totaux: { include: { modePaiement: true } },
  _count: { select: { sessions: true } },
} satisfies Prisma.ClotureJournaliereInclude;

type ClotureLue = Prisma.ClotureJournaliereGetPayload<{
  include: typeof INCLUDE_CLOTURE;
}>;

const INCLUDE_SESSION = { poste: true } satisfies Prisma.SessionCaisseInclude;

type SessionLue = Prisma.SessionCaisseGetPayload<{
  include: typeof INCLUDE_SESSION;
}>;

function refusJour(contrainte: string, message: string): BadRequestException {
  return new BadRequestException({
    message,
    code: 'VALIDATION',
    champs: [{ champ: 'jour', contraintes: [contrainte], message }],
  });
}

@Injectable()
export class ClotureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
  ) {}

  private async contexte(structure: {
    id: string;
    nom: string;
  }): Promise<{ pointDeVenteId: string; debutCaisse: string }> {
    const lire = async () => {
      const [pointDeVente, parametres] = await Promise.all([
        this.prisma.pointDeVente.findUnique({
          where: {
            structureId_ordre: { structureId: structure.id, ordre: 1 },
          },
        }),
        this.prisma.parametresPharmacie.findUnique({
          where: { structureId: structure.id },
        }),
      ]);
      return { pointDeVente, parametres };
    };
    let { pointDeVente, parametres } = await lire();
    if (!pointDeVente || !parametres) {
      await this.prisma.$transaction((tx) =>
        assurerPointDeVente(tx, structure),
      );
      ({ pointDeVente, parametres } = await lire());
    }
    return {
      pointDeVenteId: (pointDeVente as { id: string }).id,
      debutCaisse: dateVersJour(
        (parametres as { debutCaisse: Date }).debutCaisse,
      ),
    };
  }

  private validerJour(jour: string, debutCaisse: string): void {
    if (!jourValide(jour)) {
      throw refusJour('dateValide', MESSAGE_JOUR_INVALIDE);
    }
    if (jour > jourConakry(new Date())) {
      throw refusJour('jourFutur', MESSAGE_JOUR_FUTUR);
    }
    if (jour < debutCaisse) {
      throw new BadRequestException({
        message: messageJourAvantDebutCaisse(debutCaisse),
        code: 'JOUR_AVANT_DEBUT_CAISSE',
      });
    }
  }

  private lireSessions(
    client: Client,
    pointDeVenteId: string,
    jour: string,
  ): Promise<SessionLue[]> {
    return client.sessionCaisse.findMany({
      where: {
        pointDeVenteId,
        jourMetier: jourVersDate(jour),
        technique: false,
      },
      include: INCLUDE_SESSION,
      orderBy: [{ ouverteLe: 'asc' }, { id: 'asc' }],
    });
  }

  private async lireEtat(
    client: Client,
    pointDeVenteId: string,
    jour: string,
    verrouiller: boolean,
  ): Promise<{ sessions: SessionLue[]; attendus: PosteAttendu[] }> {
    if (verrouiller) {
      const tx = client as Prisma.TransactionClient;
      await tx.$queryRaw`SELECT "id" FROM "SessionCaisse" WHERE "pointDeVenteId" = ${pointDeVenteId} AND "jourMetier" = ${jourVersDate(jour)} AND NOT "technique" ORDER BY "id" FOR UPDATE`;
    }
    const sessions = await this.lireSessions(client, pointDeVenteId, jour);
    const postes = await client.poste.findMany({
      where: { pointDeVenteId, type: { in: ['WEB', 'DESKTOP'] } },
    });
    const vendus = await client.vente.findMany({
      where: {
        pointDeVenteId,
        jourMetier: {
          gte: jourVersDate(joursAvant(jour, 7)),
          lte: jourVersDate(jour),
        },
        poste: { type: 'DESKTOP' },
      },
      select: { posteId: true },
      distinct: ['posteId'],
    });
    const attendus = postesAttendus({
      debutJour: jourVersDate(jour),
      postes: postes as PosteCaisse[],
      sessionsOuvertes: sessions
        .filter((s) => s.statut === 'OUVERTE')
        .map((s) => ({
          id: s.id,
          posteId: s.posteId,
          utilisateurNom: s.utilisateurNom,
        })),
      postesAyantVendu: new Set(vendus.map((v) => v.posteId)),
    });
    return { sessions, attendus };
  }

  private async resultatsDe(
    client: Client,
    sessionIds: string[],
  ): Promise<{
    resultats: ResultatPourCloture[];
    modes: Map<string, string>;
  }> {
    const lus = await client.resultatSessionMode.findMany({
      where: { sessionCaisseId: { in: sessionIds } },
      include: { modePaiement: true },
    });
    const modes = new Map<string, string>();
    const resultats = lus.map((r) => {
      modes.set(r.modePaiement.code, r.modePaiementId);
      return {
        sessionId: r.sessionCaisseId,
        mode: r.modePaiement.code,
        libelle: r.modePaiement.libelle,
        ordre: r.modePaiement.ordre,
        theorique: r.theorique,
        compte: r.compte,
      };
    });
    return { resultats, modes };
  }

  private versSessionResume(s: SessionLue): SessionResume {
    return {
      id: s.id,
      posteId: s.posteId,
      posteCode: s.poste.code,
      posteLibelle: s.poste.libelle,
      posteType: s.poste.type as 'WEB' | 'DESKTOP',
      utilisateurId: s.utilisateurId ?? '',
      utilisateurNom: s.utilisateurNom,
      statut: s.statut,
      ouverteLe: s.ouverteLe,
      fermeeLe: s.fermeeLe,
    };
  }

  private presenterCloture(
    cloture: ClotureLue,
    clotureParNom: string | null,
  ): ClotureReponse {
    const totaux = [...cloture.totaux].sort((a, b) =>
      a.modePaiement.ordre !== b.modePaiement.ordre
        ? a.modePaiement.ordre - b.modePaiement.ordre
        : a.modePaiement.code < b.modePaiement.code
          ? -1
          : a.modePaiement.code > b.modePaiement.code
            ? 1
            : 0,
    );
    return {
      id: cloture.id,
      jour: dateVersJour(cloture.jourMetier),
      clotureeLe: cloture.clotureeLe,
      clotureParId: cloture.clotureParId,
      clotureParNom,
      forcee: cloture.forcee,
      motifForcage: cloture.motifForcage,
      postesManquants: cloture.postesManquants as unknown as PosteManquant[],
      nombreSessions: cloture._count.sessions,
      totaux: totaux.map((t) => ({
        mode: t.modePaiement.code,
        libelle: t.modePaiement.libelle,
        theorique: t.theorique,
        compte: t.compte,
        ecart: t.ecart,
      })),
    };
  }

  private async nomsUtilisateurs(ids: string[]): Promise<Map<string, string>> {
    const utilisateurs = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, prenom: true, nom: true },
    });
    return new Map(
      utilisateurs.map((u) => [u.id, `${u.prenom} ${u.nom}`.trim()]),
    );
  }

  async preparer(
    structureId: string,
    userId: string,
    jour: string,
  ): Promise<Reponse<PreparationCloture>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const { pointDeVenteId, debutCaisse } = await this.contexte(structure);
    this.validerJour(jour, debutCaisse);

    const cloture = await this.prisma.clotureJournaliere.findUnique({
      where: {
        pointDeVenteId_jourMetier: {
          pointDeVenteId,
          jourMetier: jourVersDate(jour),
        },
      },
      include: INCLUDE_CLOTURE,
    });

    if (cloture) {
      const sessions = await this.lireSessions(
        this.prisma,
        pointDeVenteId,
        jour,
      );
      const incluses = sessions
        .filter((s) => s.clotureJournaliereId === cloture.id)
        .map((s) => s.id);
      const { resultats } = await this.resultatsDe(this.prisma, incluses);
      const noms = await this.nomsUtilisateurs([cloture.clotureParId]);
      const resumes = sessions.map((s) => this.versSessionResume(s));
      return {
        data: {
          jour,
          cloture: this.presenterCloture(
            cloture,
            noms.get(cloture.clotureParId) ?? null,
          ),
          sessions: resumes,
          sessionsOuvertes: resumes.filter((s) => s.statut === 'OUVERTE'),
          postesAttendus: [],
          totaux: totauxCloture(resultats),
          peutCloturer: false,
          peutForcer: false,
        },
        message: `La journée du ${jourLisible(jour)} est clôturée.`,
        success: true,
      };
    }

    const { sessions, attendus } = await this.lireEtat(
      this.prisma,
      pointDeVenteId,
      jour,
      false,
    );
    const fermees = sessions
      .filter((s) => s.statut === 'FERMEE')
      .map((s) => s.id);
    const { resultats } = await this.resultatsDe(this.prisma, fermees);
    const resumes = sessions.map((s) => this.versSessionResume(s));
    return {
      data: {
        jour,
        cloture: null,
        sessions: resumes,
        sessionsOuvertes: resumes.filter((s) => s.statut === 'OUVERTE'),
        postesAttendus: attendus,
        totaux: totauxCloture(resultats),
        peutCloturer: attendus.length === 0,
        peutForcer: forcageAutorise(attendus),
      },
      message: `Préparation de la clôture du ${jourLisible(jour)}.`,
      success: true,
    };
  }

  async cloturer(
    structureId: string,
    userId: string,
    dto: CloturerJourneeDto,
    ip: string | null,
  ): Promise<Reponse<ClotureReponse>> {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const { pointDeVenteId, debutCaisse } = await this.contexte(structure);
    const jour = dto.jour;
    this.validerJour(jour, debutCaisse);

    const forcer = dto.forcer === true;
    const motif = dto.motifForcage?.trim() ?? '';
    if (forcer && motif.length < 3) {
      throw new BadRequestException({
        message: MESSAGE_MOTIF_FORCAGE_REQUIS,
        code: 'MOTIF_REQUIS',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await verrouillerJourneesExclusif(tx, structureId);
        if (await estJourCloture(tx, pointDeVenteId, jour)) {
          throw new ConflictException({
            message: messageJourneeDejaCloturee(jour),
            code: 'JOURNEE_DEJA_CLOTUREE',
          });
        }
        const { sessions, attendus } = await this.lireEtat(
          tx,
          pointDeVenteId,
          jour,
          true,
        );
        if (attendus.length > 0) {
          if (!forcer) {
            throw new ConflictException({
              message: messageClotureIncomplete(jour, attendus),
              code: 'CLOTURE_INCOMPLETE',
              details: attendus,
            });
          }
          if (!forcageAutorise(attendus)) {
            const web = attendus.filter((a) => a.type === 'WEB');
            throw new ConflictException({
              message: messageCaissesAFermer(web),
              code: 'CAISSES_A_FERMER',
              details: web,
            });
          }
        }
        const forcee = attendus.length > 0;
        const manquants = forcee ? attendus.map(versPosteManquant) : [];

        const cloture = await tx.clotureJournaliere.create({
          data: {
            pointDeVenteId,
            jourMetier: jourVersDate(jour),
            clotureParId: user.id,
            forcee,
            motifForcage: forcee ? motif : null,
            postesManquants: manquants as unknown as Prisma.InputJsonValue,
          },
        });

        const fermees = sessions
          .filter((s) => s.statut === 'FERMEE')
          .map((s) => s.id);
        if (fermees.length > 0) {
          const r = await tx.sessionCaisse.updateMany({
            where: { id: { in: fermees }, statut: 'FERMEE' },
            data: {
              statut: 'INCLUSE_DANS_CLOTURE',
              clotureJournaliereId: cloture.id,
            },
          });
          if (r.count !== fermees.length) {
            throw new Error('Clôture : sessions modifiées pendant la clôture.');
          }
        }

        const { resultats, modes } = await this.resultatsDe(tx, fermees);
        const totaux = totauxCloture(resultats);
        if (totaux.length > 0) {
          await tx.totalClotureMode.createMany({
            data: totaux.map((t) => ({
              clotureId: cloture.id,
              modePaiementId: modes.get(t.mode) as string,
              theorique: t.theorique,
              compte: t.compte,
              ecart: t.ecart,
            })),
          });
        }

        // Audit : jamais le motif de forçage.
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'create',
            entityType: 'ClotureJournaliere',
            entityId: cloture.id,
            ip,
            metadata: {
              jour,
              forcee,
              nombreSessions: fermees.length,
              postesManquants: manquants.map((m) => m.posteCode),
            },
          },
        });

        const relue = await tx.clotureJournaliere.findUniqueOrThrow({
          where: { id: cloture.id },
          include: INCLUDE_CLOTURE,
        });
        const jl = jourLisible(jour);
        const message = forcee
          ? `Journée du ${jl} clôturée sans ${manquants.length} poste(s) : ${nommerPostes(manquants)}. Leurs ventes envoyées plus tard seront rattachées à la journée en cours.`
          : forcer
            ? `Journée du ${jl} clôturée. Aucun poste n'était attendu : la clôture n'a pas eu besoin d'être forcée.`
            : `Journée du ${jl} clôturée.`;
        return {
          data: this.presenterCloture(
            relue,
            `${user.prenom} ${user.nom}`.trim(),
          ),
          message,
          success: true as const,
        };
      }, OPTIONS_TRANSACTION_CLOTURE);
    } catch (erreur) {
      if (estDoublonSur(erreur, 'ClotureJournaliere')) {
        throw new ConflictException({
          message: messageJourneeDejaCloturee(jour),
          code: 'JOURNEE_DEJA_CLOTUREE',
        });
      }
      throw erreur;
    }
  }

  async lister(
    structureId: string,
    userId: string,
    query: ListerCloturesQueryDto,
  ): Promise<Reponse<{ mois: string; clotures: ClotureReponse[] }>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const mois = query.mois ?? jourConakry(new Date()).slice(0, 7);
    const [annee, numero] = mois.split('-').map(Number);
    const suivant =
      numero === 12
        ? `${annee + 1}-01`
        : `${annee}-${String(numero + 1).padStart(2, '0')}`;
    const { pointDeVenteId } = await this.contexte(structure);
    const lues = await this.prisma.clotureJournaliere.findMany({
      where: {
        pointDeVenteId,
        jourMetier: {
          gte: jourVersDate(`${mois}-01`),
          lt: jourVersDate(`${suivant}-01`),
        },
      },
      include: INCLUDE_CLOTURE,
      orderBy: { jourMetier: 'asc' },
    });
    const noms = await this.nomsUtilisateurs([
      ...new Set(lues.map((c) => c.clotureParId)),
    ]);
    return {
      data: {
        mois,
        clotures: lues.map((c) =>
          this.presenterCloture(c, noms.get(c.clotureParId) ?? null),
        ),
      },
      message: `${lues.length} clôture(s) en ${mois}.`,
      success: true,
    };
  }

  /** Export CSV d'une journée clôturée : pièces, paiements et mouvements de caisse, sans coût, sans client (D622). */
  async exporter(
    structureId: string,
    userId: string,
    jour: string,
  ): Promise<{ nomFichier: string; contenu: Buffer }> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const { pointDeVenteId, debutCaisse } = await this.contexte(structure);
    this.validerJour(jour, debutCaisse);

    const cloture = await this.prisma.clotureJournaliere.findUnique({
      where: {
        pointDeVenteId_jourMetier: {
          pointDeVenteId,
          jourMetier: jourVersDate(jour),
        },
      },
    });
    if (!cloture) {
      throw new ConflictException({
        message: messageJourneeNonCloturee(jour),
        code: 'JOURNEE_NON_CLOTUREE',
      });
    }

    const lues = await this.prisma.vente.findMany({
      where: {
        pointDeVenteId,
        jourMetier: jourVersDate(jour),
        sessionCaisse: { technique: false },
      },
      select: {
        numero: true,
        typePiece: true,
        createdAt: true,
        vendeurNom: true,
        total: true,
        motifAnnulation: true,
        venteOrigine: { select: { numero: true } },
        poste: { select: { code: true } },
        sessionCaisse: { select: { clotureJournaliereId: true } },
        paiements: {
          select: {
            montant: true,
            referenceExterne: true,
            createdAt: true,
            modePaiement: {
              select: { code: true, libelle: true, ordre: true },
            },
          },
        },
      },
    });
    const pieces: PieceExport[] = lues.map((v) => ({
      numero: v.numero,
      typePiece: v.typePiece,
      numeroOrigine: v.venteOrigine?.numero ?? null,
      createdAt: v.createdAt,
      posteCode: v.poste.code,
      vendeurNom: v.vendeurNom,
      total: v.total,
      motif: v.typePiece === 'ANNULATION' ? v.motifAnnulation : null,
      caisseIncluse: v.sessionCaisse.clotureJournaliereId === cloture.id,
      paiements: v.paiements.map((p) => ({
        libelleMode: p.modePaiement.libelle,
        ordreMode: p.modePaiement.ordre,
        codeMode: p.modePaiement.code,
        reference: p.referenceExterne,
        montant: p.montant,
        createdAt: p.createdAt,
      })),
    }));

    const mouvementsLus = await this.prisma.mouvementCaisse.findMany({
      where: {
        sessionCaisse: {
          pointDeVenteId,
          jourMetier: jourVersDate(jour),
          technique: false,
        },
      },
      select: {
        type: true,
        montant: true,
        motif: true,
        horodatageServeur: true,
        modePaiement: { select: { libelle: true } },
        sessionCaisse: {
          select: {
            utilisateurNom: true,
            clotureJournaliereId: true,
            poste: { select: { code: true } },
          },
        },
      },
    });
    const mouvements: MouvementExport[] = mouvementsLus.map((m) => ({
      type: m.type,
      horodatage: m.horodatageServeur,
      posteCode: m.sessionCaisse.poste.code,
      utilisateurNom: m.sessionCaisse.utilisateurNom,
      libelleMode: m.modePaiement.libelle,
      montant: m.montant,
      motif: m.motif,
      caisseIncluse: m.sessionCaisse.clotureJournaliereId === cloture.id,
    }));

    return {
      nomFichier: `cloture-${jour}.csv`,
      contenu: Buffer.from(exporterCloture(jour, pieces, mouvements), 'utf8'),
    };
  }
}
