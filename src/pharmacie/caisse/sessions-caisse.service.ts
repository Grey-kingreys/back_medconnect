import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import { assurerPointDeVente } from '../point-de-vente';
import type { Reponse } from '../points-de-vente.service';
import { jourConakry, jourLisible } from '../jour-metier';
import {
  exigerJourOuvert,
  jourDeRattachement,
  messageCaisseJourneeCloturee,
  verrouillerJourneesPartage,
} from './journee';
import { CODE_ESPECES, totalComptage } from '../domaine/caisse';
import {
  commentaireEcartRequis,
  formaterGnf,
  resultatsParMode,
  type ResultatMode,
} from './bilan-caisse';
import type {
  FermerSessionDto,
  ListerSessionsQueryDto,
  MouvementCaisseDto,
  OuvrirSessionDto,
  SaisirComptageDto,
} from '../dto/sessions-caisse.dto';

export const MESSAGE_SESSION_INTROUVABLE =
  'Cette session de caisse est introuvable.';
export const MESSAGE_SESSION_AUTRE_VENDEUR =
  'Cette caisse appartient à un autre vendeur : seul un responsable peut la consulter ou la modifier.';
export const MESSAGE_POSTE_INCONNU =
  "Ce poste de caisse est inconnu ou désactivé. Rechargez la page pour l'enregistrer à nouveau.";
export const MESSAGE_SESSION_FERMEE =
  'Cette caisse est déjà fermée : ouvrez une nouvelle caisse pour continuer.';
export const MESSAGE_IDENTIFIANT_DEJA_UTILISE =
  'Cet identifiant est déjà utilisé par un autre enregistrement de caisse.';
export const MESSAGE_COMPTAGE_FERMETURE_REQUIS =
  'Comptez les billets du tiroir avant de fermer la caisse.';
export const MESSAGE_MOTIF_MOUVEMENT_REQUIS =
  'Indiquez le motif de ce mouvement de caisse (3 caractères au moins).';
export function messageOuvertureJourSuivant(jour: string): string {
  return `Caisse ouverte. La journée d'aujourd'hui est déjà clôturée : cette caisse compte pour le ${jourLisible(jour)}.`;
}
export function messageSessionAutreUtilisateur(nom: string): string {
  return `La caisse de ce poste est ouverte par ${nom}. Elle doit être fermée avant que vous puissiez encaisser ici.`;
}
export function messageComptageDejaSaisi(
  moment: 'OUVERTURE' | 'FERMETURE',
): string {
  return moment === 'OUVERTURE'
    ? "Le comptage d'ouverture de cette caisse est déjà enregistré."
    : 'Le comptage de fermeture de cette caisse est déjà enregistré.';
}
export function messageModeInconnu(code: string): string {
  return `Le mode de paiement ${code} n'existe pas ou n'est plus accepté.`;
}
export function messageCommentaireRequis(ecart: number, seuil: number): string {
  return `L'écart d'espèces est de ${formaterGnf(ecart)} GNF, au-delà du seuil de ${formaterGnf(seuil)} GNF : ajoutez un commentaire pour fermer la caisse.`;
}

export interface ComptageReponse {
  id: string;
  moment: 'OUVERTURE' | 'FERMETURE';
  totalEspeces: number;
  coupures: { valeurFaciale: number; nombre: number }[];
  releves: { mode: string; libelle: string; montant: number }[];
  auteurId: string;
  createdAt: Date;
}

export interface SessionReponse {
  id: string;
  poste: { id: string; code: string; libelle: string; type: 'WEB' | 'DESKTOP' };
  utilisateurId: string;
  utilisateurNom: string;
  statut: 'OUVERTE' | 'FERMEE' | 'INCLUSE_DANS_CLOTURE';
  jourMetier: string;
  ouverteLe: Date;
  fermeeLe: Date | null;
  commentaireEcart: string | null;
  fondCaisse: number;
  fondCompte: boolean;
  comptageOuverture: ComptageReponse | null;
  comptageFermeture: ComptageReponse | null;
}

export interface MouvementCaisseReponse {
  id: string;
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';
  mode: string;
  montant: number;
  motif: string;
  auteurId: string;
  horodatageServeur: Date;
}

export interface BilanSession {
  activite: {
    nombreVentes: number;
    nombreAnnulations: number;
    montantEncaisse: number;
    parMode: {
      mode: string;
      libelle: string;
      montant: number;
      nombrePaiements: number;
    }[];
  };
  session: SessionReponse;
  fond: { montant: number; compte: boolean };
  mouvements: MouvementCaisseReponse[];
  theorique: { mode: string; libelle: string; montant: number }[];
  compte: { mode: string; libelle: string; montant: number | null }[];
  ecarts: { mode: string; libelle: string; ecart: number | null }[];
  ecartEspeces: number | null;
  seuilEcartCaisse: number;
  commentaireRequis: boolean;
  fige: boolean;
}

export const includeSession = {
  poste: true,
  comptages: {
    include: { lignes: true, releves: { include: { modePaiement: true } } },
  },
} satisfies Prisma.SessionCaisseInclude;

export type SessionChargee = Prisma.SessionCaisseGetPayload<{
  include: typeof includeSession;
}>;
type ComptageCharge = SessionChargee['comptages'][number];
type Client = PrismaService | Prisma.TransactionClient;

export interface EntreeComptage {
  id?: string;
  coupures: { valeurFaciale: number; nombre: number }[];
  releves?: { mode: string; montant: number }[];
}

function erreurValidation(
  champ: string,
  contrainte: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    message,
    code: 'VALIDATION',
    champs: [{ champ, contraintes: [contrainte], message }],
  });
}

function versComptageReponse(c: ComptageCharge): ComptageReponse {
  return {
    id: c.id,
    moment: c.moment,
    totalEspeces: c.totalEspeces,
    coupures: [...c.lignes]
      .sort((a, b) => b.valeurFaciale - a.valeurFaciale)
      .map((l) => ({ valeurFaciale: l.valeurFaciale, nombre: l.nombre })),
    releves: [...c.releves]
      .sort(
        (a, b) =>
          a.modePaiement.ordre - b.modePaiement.ordre ||
          a.modePaiement.code.localeCompare(b.modePaiement.code),
      )
      .map((r) => ({
        mode: r.modePaiement.code,
        libelle: r.modePaiement.libelle,
        montant: r.montantDeclare,
      })),
    auteurId: c.auteurId,
    createdAt: c.createdAt,
  };
}

function versSessionReponse(s: SessionChargee): SessionReponse {
  const ouverture = s.comptages.find((c) => c.moment === 'OUVERTURE');
  const fermeture = s.comptages.find((c) => c.moment === 'FERMETURE');
  return {
    id: s.id,
    poste: {
      id: s.poste.id,
      code: s.poste.code,
      libelle: s.poste.libelle,
      type: s.poste.type as 'WEB' | 'DESKTOP',
    },
    utilisateurId: s.utilisateurId as string,
    utilisateurNom: s.utilisateurNom,
    statut: s.statut,
    jourMetier: jourConakry(s.jourMetier),
    ouverteLe: s.ouverteLe,
    fermeeLe: s.fermeeLe,
    commentaireEcart: s.commentaireEcart,
    fondCaisse: ouverture?.totalEspeces ?? 0,
    fondCompte: ouverture !== undefined,
    comptageOuverture: ouverture ? versComptageReponse(ouverture) : null,
    comptageFermeture: fermeture ? versComptageReponse(fermeture) : null,
  };
}

const MESSAGES_MOUVEMENT = {
  PRELEVEMENT: 'Prélèvement enregistré.',
  APPORT: 'Apport enregistré.',
  REMBOURSEMENT: 'Remboursement enregistré.',
} as const;

@Injectable()
export class SessionsCaisseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly permissions: PermissionsService,
  ) {}

  // ------------------------------------------------------------------ routes

  async ouvrir(
    structureId: string,
    userId: string,
    dto: OuvrirSessionDto,
  ): Promise<Reponse<SessionReponse & { ouverteMaintenant: boolean }>> {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const { session, ouverteMaintenant, rattacheeAuJourSuivant } =
      await this.prisma.$transaction((tx) =>
        this.ouvrirDansTransaction(tx, {
          structureId,
          userId,
          utilisateurNom: `${user.prenom} ${user.nom}`.trim(),
          posteId: dto.posteId,
          sessionId: dto.id,
          comptage: dto.comptage,
        }),
      );
    return {
      data: { ...session, ouverteMaintenant },
      message: rattacheeAuJourSuivant
        ? messageOuvertureJourSuivant(session.jourMetier)
        : ouverteMaintenant
          ? 'Caisse ouverte.'
          : 'Votre caisse était déjà ouverte.',
      success: true,
    };
  }

  async courante(
    structureId: string,
    userId: string,
    posteId: string,
  ): Promise<Reponse<SessionReponse | null>> {
    await this.accesPharmacie.verifier(structureId, userId);
    const poste = await this.prisma.poste.findFirst({
      where: {
        id: posteId,
        type: { not: 'TECHNIQUE' },
        pointDeVente: { structureId },
      },
    });
    if (!poste) {
      throw new ConflictException({
        message: MESSAGE_POSTE_INCONNU,
        code: 'POSTE_INCONNU',
      });
    }
    const session = await this.prisma.sessionCaisse.findFirst({
      where: { posteId, statut: 'OUVERTE' },
      include: includeSession,
    });
    return {
      data: session ? versSessionReponse(session) : null,
      message: session
        ? 'Caisse ouverte sur ce poste.'
        : 'Aucune caisse ouverte sur ce poste.',
      success: true,
    };
  }

  async saisirComptage(
    structureId: string,
    userId: string,
    sessionId: string,
    dto: SaisirComptageDto,
  ): Promise<Reponse<ComptageReponse & { cree: boolean }>> {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const session = await this.lireSessionPharmacie(structureId, sessionId);
    await this.exigerDroitSurSession(session, userId);
    const { comptage, cree } = await this.prisma.$transaction(async (tx) => {
      await verrouillerJourneesPartage(tx, structureId);
      const s = await this.verrouillerSession(tx, sessionId);
      if (s.statut !== 'OUVERTE') this.leverSessionFermee();
      const jourSession = jourConakry(s.jourMetier);
      await exigerJourOuvert(
        tx,
        s.pointDeVenteId,
        jourSession,
        messageCaisseJourneeCloturee(jourSession),
      );
      return this.enregistrerComptage(tx, s, dto.moment, dto, user.id);
    });
    return {
      data: { ...comptage, cree },
      message: cree
        ? 'Comptage enregistré.'
        : 'Ce comptage était déjà enregistré.',
      success: true,
    };
  }

  async enregistrerMouvement(
    structureId: string,
    userId: string,
    sessionId: string,
    dto: MouvementCaisseDto,
  ): Promise<Reponse<MouvementCaisseReponse & { cree: boolean }>> {
    const { user } = await this.accesPharmacie.verifier(structureId, userId);
    const motif = dto.motif ?? '';
    if (motif.length < 3) {
      throw new BadRequestException({
        message: MESSAGE_MOTIF_MOUVEMENT_REQUIS,
        code: 'MOTIF_REQUIS',
      });
    }
    const session = await this.lireSessionPharmacie(structureId, sessionId);
    await this.exigerDroitSurSession(session, userId);
    const { mouvement, cree } = await this.prisma.$transaction(async (tx) => {
      await verrouillerJourneesPartage(tx, structureId);
      const s = await this.verrouillerSession(tx, sessionId);
      if (s.statut !== 'OUVERTE') this.leverSessionFermee();
      const jourSession = jourConakry(s.jourMetier);
      await exigerJourOuvert(
        tx,
        s.pointDeVenteId,
        jourSession,
        messageCaisseJourneeCloturee(jourSession),
      );
      if (dto.id) {
        const existant = await tx.mouvementCaisse.findUnique({
          where: { id: dto.id },
          include: { modePaiement: true },
        });
        if (existant) {
          if (existant.sessionCaisseId !== sessionId) {
            throw new ConflictException({
              message: MESSAGE_IDENTIFIANT_DEJA_UTILISE,
              code: 'IDENTIFIANT_DEJA_UTILISE',
            });
          }
          return { mouvement: existant, cree: false };
        }
      }
      const codeMode = dto.mode ?? CODE_ESPECES;
      const mode = await tx.modePaiement.findFirst({
        where: { code: codeMode, actif: true },
      });
      if (!mode) {
        throw new BadRequestException({
          message: messageModeInconnu(codeMode),
          code: 'MODE_PAIEMENT_INCONNU',
        });
      }
      const id = dto.id ?? randomUUID();
      const cree = await tx.mouvementCaisse.create({
        data: {
          id,
          sessionCaisseId: sessionId,
          pointDeVenteId: s.pointDeVenteId,
          type: dto.type,
          modePaiementId: mode.id,
          montant: dto.montant,
          motif,
          auteurId: user.id,
          evenementId: id,
        },
        include: { modePaiement: true },
      });
      return { mouvement: cree, cree: true };
    });
    return {
      data: { ...versMouvementReponse(mouvement), cree },
      message: cree
        ? MESSAGES_MOUVEMENT[mouvement.type]
        : 'Ce mouvement était déjà enregistré.',
      success: true,
    };
  }

  async bilan(
    structureId: string,
    userId: string,
    sessionId: string,
  ): Promise<Reponse<BilanSession>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const session = await this.lireSessionPharmacie(structureId, sessionId);
    await this.exigerDroitSurSession(session, userId);
    return {
      data: await this.calculerBilan(this.prisma, session, structure),
      message: 'Bilan de la caisse.',
      success: true,
    };
  }

  async fermer(
    structureId: string,
    userId: string,
    sessionId: string,
    dto: FermerSessionDto,
  ): Promise<Reponse<BilanSession>> {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const lue = await this.lireSessionPharmacie(structureId, sessionId);
    await this.exigerDroitSurSession(lue, userId);

    return this.prisma.$transaction(async (tx) => {
      await verrouillerJourneesPartage(tx, structureId);
      const s = await this.verrouillerSession(tx, sessionId);
      if (s.statut !== 'OUVERTE') {
        return {
          data: await this.calculerBilan(tx, s, structure),
          message: 'Cette session était déjà fermée.',
          success: true as const,
        };
      }
      const jourSession = jourConakry(s.jourMetier);
      await exigerJourOuvert(
        tx,
        s.pointDeVenteId,
        jourSession,
        messageCaisseJourneeCloturee(jourSession),
      );
      const { bilan } = await this.fermerSessionVerrouillee(tx, s, structure, {
        auteurId: user.id,
        comptageFermeture: dto.comptageFermeture,
        commentaire: dto.commentaire,
        exigerComptage: true,
        exigerCommentaire: true,
        evenementFermetureId: `fermeture:${sessionId}`,
      });
      return {
        data: bilan,
        message: 'Caisse fermée.',
        success: true as const,
      };
    });
  }

  /**
   * Cœur de la fermeture, session déjà verrouillée et ouverte (D650) : partagé par
   * la route web (qui exige comptage et commentaire) et le rejeu du desktop (qui ne
   * refuse jamais une fermeture déjà faite sur le poste).
   */
  async fermerSessionVerrouillee(
    tx: Prisma.TransactionClient,
    s: SessionChargee,
    structure: { id: string; nom: string; adminId: string | null },
    options: {
      auteurId: string;
      comptageFermeture?: EntreeComptage;
      commentaire?: string;
      exigerComptage: boolean;
      exigerCommentaire: boolean;
      fermeeLeLocal?: Date | null;
      evenementFermetureId: string;
      horodatageLocalComptage?: Date | null;
    },
  ): Promise<{
    bilan: BilanSession;
    anomalies: { type: 'FOND_NON_COMPTE' | 'ECART_CAISSE'; id: string }[];
  }> {
    const sessionId = s.id;
    if (options.comptageFermeture) {
      await this.enregistrerComptage(
        tx,
        s,
        'FERMETURE',
        options.comptageFermeture,
        options.auteurId,
        options.horodatageLocalComptage,
      );
      s = await this.relire(tx, sessionId);
    }
    if (
      options.exigerComptage &&
      !s.comptages.some((c) => c.moment === 'FERMETURE')
    ) {
      throw new BadRequestException({
        message: MESSAGE_COMPTAGE_FERMETURE_REQUIS,
        code: 'COMPTAGE_FERMETURE_REQUIS',
      });
    }
    const bilan = await this.calculerBilan(tx, s, structure);
    const commentaire = options.commentaire ?? '';
    if (
      options.exigerCommentaire &&
      bilan.commentaireRequis &&
      commentaire.length < 3
    ) {
      throw new BadRequestException({
        message: messageCommentaireRequis(
          bilan.ecartEspeces as number,
          bilan.seuilEcartCaisse,
        ),
        code: 'COMMENTAIRE_ECART_REQUIS',
      });
    }
    const avecCommentaire = commentaire.length >= 3;
    await tx.sessionCaisse.update({
      where: { id: sessionId },
      data: {
        statut: 'FERMEE',
        fermeeLe: new Date(),
        fermeeLeLocal: options.fermeeLeLocal ?? null,
        evenementFermetureId: options.evenementFermetureId,
        commentaireEcart: avecCommentaire ? commentaire : null,
        commentaireParId: avecCommentaire ? options.auteurId : null,
      },
    });
    const modes = await this.modesReferentiel(tx);
    const idParCode = new Map(modes.map((m) => [m.code, m.id]));
    await tx.resultatSessionMode.createMany({
      data: bilan.theorique.map((t, i) => ({
        sessionCaisseId: sessionId,
        modePaiementId: idParCode.get(t.mode) as string,
        theorique: t.montant,
        compte: bilan.compte[i].montant,
        ecart: bilan.ecarts[i].ecart,
      })),
    });

    const anomalies: {
      type: 'FOND_NON_COMPTE' | 'ECART_CAISSE';
      id: string;
    }[] = [];
    const identite = {
      posteCode: s.poste.code,
      utilisateurId: s.utilisateurId,
      utilisateurNom: s.utilisateurNom,
      jourMetier: jourConakry(s.jourMetier),
    };
    if (!s.comptages.some((c) => c.moment === 'OUVERTURE')) {
      const creee = await tx.anomalie.create({
        data: {
          pointDeVenteId: s.pointDeVenteId,
          type: 'FOND_NON_COMPTE',
          attribueeAId: structure.adminId,
          pieceType: 'SessionCaisse',
          pieceId: sessionId,
          details: identite,
        },
      });
      anomalies.push({ type: 'FOND_NON_COMPTE', id: creee.id });
    }
    if (bilan.commentaireRequis) {
      const indexEspeces = bilan.theorique.findIndex(
        (t) => t.mode === CODE_ESPECES,
      );
      const creee = await tx.anomalie.create({
        data: {
          pointDeVenteId: s.pointDeVenteId,
          type: 'ECART_CAISSE',
          attribueeAId: structure.adminId,
          pieceType: 'SessionCaisse',
          pieceId: sessionId,
          details: {
            ...identite,
            theorique: bilan.theorique[indexEspeces].montant,
            compte: bilan.compte[indexEspeces].montant,
            ecart: bilan.ecarts[indexEspeces].ecart,
            seuilEcartCaisse: bilan.seuilEcartCaisse,
          },
        },
      });
      anomalies.push({ type: 'ECART_CAISSE', id: creee.id });
    }
    const fermee = await this.relire(tx, sessionId);
    return {
      bilan: await this.calculerBilan(tx, fermee, structure),
      anomalies,
    };
  }

  async listerDuJour(
    structureId: string,
    userId: string,
    query: ListerSessionsQueryDto,
  ): Promise<Reponse<SessionReponse[]>> {
    await this.accesPharmacie.verifier(structureId, userId);
    const jour = query.jour ?? jourConakry(new Date());
    const date = new Date(`${jour}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || jourConakry(date) !== jour) {
      throw erreurValidation(
        'jour',
        'dateValide',
        'La date doit être une date valide au format AAAA-MM-JJ.',
      );
    }
    const sessions = await this.prisma.sessionCaisse.findMany({
      where: {
        technique: false,
        pointDeVente: { structureId },
        jourMetier: date,
      },
      include: includeSession,
      orderBy: [{ ouverteLe: 'asc' }, { id: 'asc' }],
    });
    return {
      data: sessions.map(versSessionReponse),
      message: `${sessions.length} session(s) le ${jour}.`,
      success: true,
    };
  }

  // ------------------------------------------------- ouverture (réutilisée)

  async ouvrirDansTransaction(
    tx: Prisma.TransactionClient,
    entree: {
      structureId: string;
      userId: string;
      utilisateurNom: string;
      posteId: string;
      sessionId?: string;
      comptage?: { coupures: { valeurFaciale: number; nombre: number }[] };
    },
  ): Promise<{
    session: SessionReponse;
    ouverteMaintenant: boolean;
    rattacheeAuJourSuivant: boolean;
  }> {
    const { structureId, userId, utilisateurNom, posteId, sessionId } = entree;
    await verrouillerJourneesPartage(tx, structureId);
    const postes = await tx.$queryRaw<
      { id: string; pointDeVenteId: string; type: string; actif: boolean }[]
    >`SELECT p."id", p."pointDeVenteId", p."type"::text AS "type", p."actif" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE p."id" = ${posteId} AND pv."structureId" = ${structureId} FOR UPDATE OF p`;
    const poste = postes[0];
    if (!poste || poste.type === 'TECHNIQUE' || !poste.actif) {
      throw new ConflictException({
        message: MESSAGE_POSTE_INCONNU,
        code: 'POSTE_INCONNU',
      });
    }

    let existante: SessionChargee | null = null;
    if (sessionId) {
      const connue = await tx.sessionCaisse.findUnique({
        where: { id: sessionId },
        include: includeSession,
      });
      if (connue) {
        if (connue.posteId === posteId && connue.utilisateurId === userId) {
          if (connue.statut !== 'OUVERTE') this.leverSessionFermee();
          existante = connue;
        } else {
          throw new ConflictException({
            message: MESSAGE_IDENTIFIANT_DEJA_UTILISE,
            code: 'IDENTIFIANT_DEJA_UTILISE',
          });
        }
      }
    }
    if (!existante) {
      const ouverte = await tx.sessionCaisse.findFirst({
        where: { posteId, statut: 'OUVERTE' },
        include: includeSession,
      });
      if (ouverte) {
        if (ouverte.utilisateurId !== userId) {
          throw new ConflictException({
            message: messageSessionAutreUtilisateur(ouverte.utilisateurNom),
            code: 'SESSION_AUTRE_UTILISATEUR',
          });
        }
        existante = ouverte;
      }
    }

    if (existante) {
      const jourExistante = jourConakry(existante.jourMetier);
      await exigerJourOuvert(
        tx,
        existante.pointDeVenteId,
        jourExistante,
        messageCaisseJourneeCloturee(jourExistante),
      );
      let session = existante;
      if (
        entree.comptage &&
        !session.comptages.some((c) => c.moment === 'OUVERTURE')
      ) {
        await this.enregistrerComptage(
          tx,
          session,
          'OUVERTURE',
          entree.comptage,
          userId,
        );
        session = await this.relire(tx, session.id);
      }
      return {
        session: versSessionReponse(session),
        ouverteMaintenant: false,
        rattacheeAuJourSuivant: false,
      };
    }

    const id = sessionId ?? randomUUID();
    const maintenant = new Date();
    const { jour, jourReel } = await jourDeRattachement(
      tx,
      poste.pointDeVenteId,
      maintenant,
    );
    let creee = await tx.sessionCaisse.create({
      data: {
        id,
        pointDeVenteId: poste.pointDeVenteId,
        posteId,
        utilisateurId: userId,
        utilisateurNom,
        jourMetier: new Date(`${jour}T00:00:00.000Z`),
        jourMetierOrigine:
          jour !== jourReel ? new Date(`${jourReel}T00:00:00.000Z`) : null,
        ouverteLe: maintenant,
        evenementOuvertureId: id,
      },
      include: includeSession,
    });
    if (entree.comptage) {
      await this.enregistrerComptage(
        tx,
        creee,
        'OUVERTURE',
        entree.comptage,
        userId,
      );
      creee = await this.relire(tx, id);
    }
    return {
      session: versSessionReponse(creee),
      ouverteMaintenant: true,
      rattacheeAuJourSuivant: jour !== jourReel,
    };
  }

  // -------------------------------------------------------------- internes

  private leverSessionFermee(): never {
    throw new ConflictException({
      message: MESSAGE_SESSION_FERMEE,
      code: 'SESSION_FERMEE',
    });
  }

  private modesReferentiel(client: Client) {
    return (client as Prisma.TransactionClient).modePaiement.findMany({
      orderBy: [{ ordre: 'asc' }, { code: 'asc' }],
    });
  }

  private relire(tx: Prisma.TransactionClient, id: string) {
    return tx.sessionCaisse.findUniqueOrThrow({
      where: { id },
      include: includeSession,
    });
  }

  private async lireSessionPharmacie(
    structureId: string,
    sessionId: string,
  ): Promise<SessionChargee> {
    const session = await this.prisma.sessionCaisse.findFirst({
      where: {
        id: sessionId,
        technique: false,
        pointDeVente: { structureId },
      },
      include: includeSession,
    });
    if (!session) throw new NotFoundException(MESSAGE_SESSION_INTROUVABLE);
    return session;
  }

  /** Appelé AVANT d'ouvrir la transaction (appel Redis). */
  private async exigerDroitSurSession(
    session: SessionChargee,
    userId: string,
  ): Promise<void> {
    if (session.utilisateurId === userId) return;
    const permissions = await this.permissions.getUserPermissions(userId);
    if (permissions.includes(PERMISSIONS.CAISSE_SUPERVISER)) return;
    throw new ForbiddenException(MESSAGE_SESSION_AUTRE_VENDEUR);
  }

  async verrouillerSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<SessionChargee> {
    await tx.$queryRaw`SELECT "id" FROM "SessionCaisse" WHERE "id" = ${sessionId} FOR UPDATE`;
    return this.relire(tx, sessionId);
  }

  async enregistrerComptage(
    tx: Prisma.TransactionClient,
    session: SessionChargee,
    moment: 'OUVERTURE' | 'FERMETURE',
    dto: EntreeComptage,
    auteurId: string,
    horodatageLocal?: Date | null,
  ): Promise<{ comptage: ComptageReponse; cree: boolean }> {
    const existant = session.comptages.find((c) => c.moment === moment);
    if (existant) {
      if (dto.id === existant.id) {
        return { comptage: versComptageReponse(existant), cree: false };
      }
      throw new ConflictException({
        message: messageComptageDejaSaisi(moment),
        code: 'COMPTAGE_DEJA_SAISI',
      });
    }
    if (dto.id) {
      const pris = await tx.comptageCaisse.findUnique({
        where: { id: dto.id },
        select: { id: true },
      });
      if (pris) {
        throw new ConflictException({
          message: MESSAGE_IDENTIFIANT_DEJA_UTILISE,
          code: 'IDENTIFIANT_DEJA_UTILISE',
        });
      }
    }

    const coupures = dto.coupures;
    const vues = new Set<number>();
    for (const c of coupures) {
      if (vues.has(c.valeurFaciale)) {
        throw erreurValidation(
          'coupures',
          'coupureUnique',
          "Chaque billet ne doit être compté qu'une fois.",
        );
      }
      vues.add(c.valeurFaciale);
    }
    const referentiel = await tx.coupureMonnaie.findMany({
      where: { actif: true, devise: 'GNF' },
    });
    const connues = new Set(referentiel.map((c) => c.valeurFaciale));
    for (const c of coupures) {
      if (!connues.has(c.valeurFaciale)) {
        throw erreurValidation(
          'coupures',
          'coupureConnue',
          `La coupure de ${formaterGnf(c.valeurFaciale)} GNF n'existe pas : comptez uniquement les billets proposés.`,
        );
      }
    }

    const releves = dto.releves ?? [];
    if (moment === 'OUVERTURE' && releves.length > 0) {
      throw erreurValidation(
        'releves',
        'releveFermetureSeulement',
        'Les relevés Orange Money et MTN MoMo se saisissent à la fermeture.',
      );
    }
    const modeVus = new Set<string>();
    for (const r of releves) {
      if (modeVus.has(r.mode)) {
        throw erreurValidation(
          'releves',
          'releveUnique',
          "Chaque mode de paiement ne doit être relevé qu'une fois.",
        );
      }
      modeVus.add(r.mode);
    }
    const modes = await this.modesReferentiel(tx);
    const parCode = new Map(modes.map((m) => [m.code, m]));
    for (const r of releves) {
      if (!parCode.has(r.mode)) {
        throw new BadRequestException({
          message: messageModeInconnu(r.mode),
          code: 'MODE_PAIEMENT_INCONNU',
        });
      }
    }
    for (const r of releves) {
      if (
        (parCode.get(r.mode) as { comptagePhysique: boolean }).comptagePhysique
      ) {
        throw erreurValidation(
          'releves',
          'releveSansEspeces',
          'Les espèces se comptent billet par billet, pas par relevé.',
        );
      }
    }

    const id = dto.id ?? randomUUID();
    const cree = await tx.comptageCaisse.create({
      data: {
        id,
        sessionCaisseId: session.id,
        moment,
        totalEspeces: totalComptage(coupures),
        auteurId,
        evenementId: id,
        horodatageLocal: horodatageLocal ?? null,
        lignes: {
          create: coupures.map((c) => ({
            valeurFaciale: c.valeurFaciale,
            nombre: c.nombre,
          })),
        },
        releves: {
          create: releves.map((r) => ({
            modePaiementId: (parCode.get(r.mode) as { id: string }).id,
            montantDeclare: r.montant,
          })),
        },
      },
      include: {
        lignes: true,
        releves: { include: { modePaiement: true } },
      },
    });
    return { comptage: versComptageReponse(cree), cree: true };
  }

  async calculerBilan(
    client: Client,
    session: SessionChargee,
    structure: { id: string; nom: string },
  ): Promise<BilanSession> {
    const c = client as Prisma.TransactionClient;
    const modes = await this.modesReferentiel(c);
    let parametres = await c.parametresPharmacie.findUnique({
      where: { structureId: structure.id },
    });
    if (!parametres) {
      parametres =
        client === this.prisma
          ? (
              await this.prisma.$transaction((tx) =>
                assurerPointDeVente(tx, structure),
              )
            ).parametres
          : (await assurerPointDeVente(c, structure)).parametres;
    }
    const seuil = parametres.seuilEcartCaisse;

    const [paiements, mouvements, pieces] = await Promise.all([
      c.paiement.findMany({
        where: { sessionCaisseId: session.id },
        select: { montant: true, modePaiement: { select: { code: true } } },
      }),
      c.mouvementCaisse.findMany({
        where: { sessionCaisseId: session.id },
        include: { modePaiement: true },
        orderBy: [{ horodatageServeur: 'asc' }, { id: 'asc' }],
      }),
      c.vente.groupBy({
        by: ['typePiece'],
        where: { sessionCaisseId: session.id },
        _count: { _all: true },
      }),
    ]);

    const compteDe = (type: string) =>
      pieces.find((p) => p.typePiece === type)?._count._all ?? 0;
    const parMode = modes
      .map((m) => {
        const siens = paiements.filter((p) => p.modePaiement.code === m.code);
        return {
          mode: m.code,
          libelle: m.libelle,
          montant: siens.reduce((somme, p) => somme + p.montant, 0),
          nombrePaiements: siens.length,
        };
      })
      .filter((m) => m.nombrePaiements > 0);

    const ouverture = session.comptages.find((x) => x.moment === 'OUVERTURE');
    const fermeture = session.comptages.find((x) => x.moment === 'FERMETURE');
    const fige = session.statut !== 'OUVERTE';
    let resultats: ResultatMode[];
    if (!fige) {
      resultats = resultatsParMode({
        modes,
        fondEspeces: ouverture?.totalEspeces ?? 0,
        paiements: paiements.map((p) => ({
          mode: p.modePaiement.code,
          montant: p.montant,
        })),
        mouvements: mouvements.map((m) => ({
          type: m.type,
          mode: m.modePaiement.code,
          montant: m.montant,
        })),
        totalEspecesCompte: fermeture?.totalEspeces ?? null,
        releves: (fermeture?.releves ?? []).map((r) => ({
          mode: r.modePaiement.code,
          montant: r.montantDeclare,
        })),
      });
    } else {
      const figes = await c.resultatSessionMode.findMany({
        where: { sessionCaisseId: session.id },
        include: { modePaiement: true },
      });
      resultats = figes
        .sort(
          (a, b) =>
            a.modePaiement.ordre - b.modePaiement.ordre ||
            a.modePaiement.code.localeCompare(b.modePaiement.code),
        )
        .map((r) => ({
          mode: r.modePaiement.code,
          libelle: r.modePaiement.libelle,
          theorique: r.theorique,
          compte: r.compte,
          ecart: r.ecart,
        }));
    }

    const ecartEspeces =
      resultats.find((r) => r.mode === CODE_ESPECES)?.ecart ?? null;
    return {
      activite: {
        nombreVentes: compteDe('VENTE') + compteDe('REGULARISATION'),
        nombreAnnulations: compteDe('ANNULATION'),
        montantEncaisse: paiements.reduce((somme, p) => somme + p.montant, 0),
        parMode,
      },
      session: versSessionReponse(session),
      fond: {
        montant: ouverture?.totalEspeces ?? 0,
        compte: ouverture !== undefined,
      },
      mouvements: mouvements.map(versMouvementReponse),
      theorique: resultats.map((r) => ({
        mode: r.mode,
        libelle: r.libelle,
        montant: r.theorique,
      })),
      compte: resultats.map((r) => ({
        mode: r.mode,
        libelle: r.libelle,
        montant: r.compte,
      })),
      ecarts: resultats.map((r) => ({
        mode: r.mode,
        libelle: r.libelle,
        ecart: r.ecart,
      })),
      ecartEspeces,
      seuilEcartCaisse: seuil,
      commentaireRequis: commentaireEcartRequis(ecartEspeces, seuil),
      fige,
    };
  }
}

function versMouvementReponse(m: {
  id: string;
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';
  montant: number;
  motif: string;
  auteurId: string;
  horodatageServeur: Date;
  modePaiement: { code: string };
}): MouvementCaisseReponse {
  return {
    id: m.id,
    type: m.type,
    mode: m.modePaiement.code,
    montant: m.montant,
    motif: m.motif,
    auteurId: m.auteurId,
    horodatageServeur: m.horodatageServeur,
  };
}
