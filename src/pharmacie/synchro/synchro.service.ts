import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { isISO8601 } from 'class-validator';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import {
  estJourCloture,
  jourDeRattachement,
  verrouillerJourneesPartage,
} from '../caisse/journee';
import { formaterGnf } from '../caisse/bilan-caisse';
import {
  MESSAGE_POSTE_INCONNU,
  SessionsCaisseService,
  type EntreeComptage,
  type SessionChargee,
} from '../caisse/sessions-caisse.service';
import { CODE_ESPECES } from '../domaine/caisse';
import { reliquatLot } from '../domaine/quantites';
import { estPerime } from '../domaine/selection-lots';
import { ecrirePieceVente } from '../ecriture-vente';
import { jourConakry, jourLisible } from '../jour-metier';
import type { Reponse } from '../points-de-vente.service';
import {
  dateVersJour,
  jourVersDate,
  lireLotsCandidats,
} from '../stock/lecture-stock';
import { MouvementsStockService } from '../stock/mouvements-stock.service';
import {
  allouerLignes,
  formaterNumeroTicket,
  preparerPaiements,
  type LigneAAllouer,
} from '../vente-regles';
import {
  CorpsComptageSaisiDto,
  CorpsMouvementCaisseDto,
  CorpsSessionFermeeDto,
  CorpsSessionOuverteDto,
  CorpsVenteDto,
  TYPES_EVENEMENT,
  type RecevoirEvenementsDto,
} from '../dto/synchro.dto';
import {
  anomaliesApplication,
  ARenvoyerSynchro,
  calculerLigneRejeu,
  codeRejetDepuisHttp,
  contientNul,
  corpsIllisible,
  corpsStockable,
  echecPassager,
  empreinteEvenement,
  horodatageBorne,
  MESSAGES_REJET,
  messageSynthese,
  numeroHorsPlage,
  numeroSecours as formaterNumeroSecours,
  RejetSynchro,
  resumeEvenement,
  SEUIL_ECHECS_IMPREVUS,
  verifierCoherenceVente,
  type CodeARenvoyer,
  type StatutResultat,
} from './rejeu-regles';
import { validerCorps } from './valider-corps';

const OPTIONS_TRANSACTION = { maxWait: 5_000, timeout: 15_000 };
const DELAI_SAUT_MS = 24 * 60 * 60 * 1000;

export interface ResultatEvenement {
  evenementId: string;
  sequence: number;
  statut: StatutResultat;
  code?: string;
  message?: string;
  champs?: string[];
  differe?: true;
  horsOrdre?: true;
  anomalies?: { type: string; id: string }[];
  piece?: {
    type:
      | 'SESSION'
      | 'COMPTAGE'
      | 'MOUVEMENT_CAISSE'
      | 'VENTE'
      | 'REGULARISATION';
    id: string;
    numero?: string;
  };
}

export interface ReponseSynchro {
  resultats: ResultatEvenement[];
  sequenceAppliquee: number;
  enAttente: number;
}

/** Événement tel que reçu du poste : seuls l'identifiant et la séquence sont garantis. */
export interface EvenementBrut {
  evenementId: string;
  sequence: number;
  type?: unknown;
  horodatageLocal?: unknown;
  utilisateurId?: unknown;
  corps?: unknown;
}

interface UtilisateurCharge {
  id: string;
  nom: string;
  prenom: string;
  structureId: string | null;
}

export interface ContexteRejeu {
  structure: { id: string; nom: string; adminId: string | null };
  poste: {
    id: string;
    code: string;
    libelle: string;
    pointDeVenteId: string;
    ordre: number;
  };
  ip?: string;
  /** Vrai dès qu'un événement a répondu A_RENVOYER pendant l'appel. */
  aRenvoyer: boolean;
  /** Échecs imprévus consécutifs de l'événement qui bloque le poste, gardés dans `dernierEtat` (D664). */
  echecImprevu: EchecImprevu | null;
  chargerUtilisateur(id: string): Promise<UtilisateurCharge | null>;
}

interface EchecImprevu {
  evenementId: string;
  nombre: number;
}

interface ResultatApplication {
  code?: string;
  piece?: ResultatEvenement['piece'];
  anomalies?: { type: string; id: string }[];
}

type Tx = Prisma.TransactionClient;

function chaineLisible(valeur: unknown, max: number): string | null {
  return typeof valeur === 'string' &&
    valeur.length > 0 &&
    valeur.length <= max &&
    !valeur.includes('\u0000')
    ? valeur
    : null;
}

function lireEchecImprevu(etat: unknown): EchecImprevu | null {
  if (etat === null || typeof etat !== 'object') return null;
  const echec = (etat as Record<string, unknown>).echecImprevu;
  if (echec === null || typeof echec !== 'object') return null;
  const { evenementId, nombre } = echec as Record<string, unknown>;
  return typeof evenementId === 'string' && typeof nombre === 'number'
    ? { evenementId, nombre }
    : null;
}

function dateLisible(valeur: unknown): Date | null {
  if (typeof valeur !== 'string' || !isISO8601(valeur, { strict: true })) {
    return null;
  }
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class SynchroService {
  private readonly logger = new Logger(SynchroService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    // Sert au rejeu des ventes (PB18c).
    private readonly mouvementsStock: MouvementsStockService,
    private readonly sessionsCaisse: SessionsCaisseService,
  ) {}

  // ------------------------------------------------------------------ route

  async recevoir(
    structureId: string,
    userId: string,
    dto: RecevoirEvenementsDto,
    ip?: string,
  ): Promise<Reponse<ReponseSynchro>> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );
    const poste = await this.prisma.poste.findFirst({
      where: { id: dto.posteId, pointDeVente: { structureId } },
      include: { pointDeVente: { select: { ordre: true } } },
    });
    if (!poste || poste.type !== 'DESKTOP') {
      throw new ConflictException({
        message: MESSAGE_POSTE_INCONNU,
        code: 'POSTE_INCONNU',
      });
    }

    const utilisateurs = new Map<string, UtilisateurCharge | null>();
    const identifiants = [
      ...new Set(
        dto.evenements
          .map((e) => chaineLisible(e.utilisateurId, 64))
          .filter((id): id is string => id !== null),
      ),
    ];
    if (identifiants.length > 0) {
      const trouves = await this.prisma.user.findMany({
        where: { id: { in: identifiants } },
        select: { id: true, nom: true, prenom: true, structureId: true },
      });
      for (const id of identifiants) {
        utilisateurs.set(id, trouves.find((u) => u.id === id) ?? null);
      }
    }
    const ctx: ContexteRejeu = {
      structure: {
        id: structure.id,
        nom: structure.nom,
        adminId: structure.adminId,
      },
      poste: {
        id: poste.id,
        code: poste.code,
        libelle: poste.libelle,
        pointDeVenteId: poste.pointDeVenteId,
        ordre: poste.pointDeVente.ordre,
      },
      ip,
      aRenvoyer: false,
      echecImprevu: lireEchecImprevu(poste.dernierEtat),
      chargerUtilisateur: async (id) => {
        if (!utilisateurs.has(id)) {
          utilisateurs.set(
            id,
            await this.prisma.user.findUnique({
              where: { id },
              select: { id: true, nom: true, prenom: true, structureId: true },
            }),
          );
        }
        return utilisateurs.get(id) ?? null;
      },
    };

    const ordonnes = dto.evenements
      .map((e, position) => ({ e, position }))
      .sort((a, b) => a.e.sequence - b.e.sequence || a.position - b.position)
      .map(({ e }) => e);

    const resultats: ResultatEvenement[] = [];
    for (const e of ordonnes) {
      if (ctx.aRenvoyer) {
        resultats.push(this.aRenvoyer(e, 'SERVICE_INDISPONIBLE'));
        continue;
      }
      const resultat = await this.traiterUn(
        ctx,
        e,
        empreinteEvenement({
          sequence: e.sequence,
          type: e.type,
          horodatageLocal: e.horodatageLocal,
          utilisateurId: e.utilisateurId,
          corps: e.corps,
        }),
        false,
      );
      resultats.push(resultat);
      if (
        (resultat.statut === 'APPLIQUE' || resultat.statut === 'REJETE') &&
        !resultat.horsOrdre
      ) {
        resultats.push(...(await this.drainer(ctx)));
      }
    }
    if (!ctx.aRenvoyer && (await this.sauterTrouAncien(ctx))) {
      resultats.push(...(await this.drainer(ctx)));
    }

    const enAttente = await this.prisma.evenementSynchro.count({
      where: { posteId: poste.id, statut: 'EN_ATTENTE' },
    });
    const apres = await this.prisma.poste.findUniqueOrThrow({
      where: { id: poste.id },
      select: { derniereSequenceAppliquee: true },
    });
    await this.prisma.poste.update({
      where: { id: poste.id },
      data: {
        dernierContactLe: new Date(),
        dernierEtat: {
          fileVide: dto.etat.fileVide && enAttente === 0 && !ctx.aRenvoyer,
          fileVideDeclaree: dto.etat.fileVide,
          sessionOuverte: dto.etat.sessionOuverte,
          versionApp: dto.etat.versionApp,
          enAttente,
          // Tout traité sans A_RENVOYER : l'événement en échec est passé, compteur oublié.
          ...(ctx.aRenvoyer && ctx.echecImprevu
            ? { echecImprevu: { ...ctx.echecImprevu } }
            : {}),
        },
      },
    });
    return {
      data: {
        resultats,
        sequenceAppliquee: apres.derniereSequenceAppliquee,
        enAttente,
      },
      message: messageSynthese(resultats),
      success: true,
    };
  }

  // ------------------------------------------------------- un événement

  private aRenvoyer(e: EvenementBrut, code: CodeARenvoyer): ResultatEvenement {
    return {
      evenementId: e.evenementId,
      sequence: e.sequence,
      statut: 'A_RENVOYER',
      code,
      message: MESSAGES_REJET[code],
    };
  }

  private echec(ctx: ContexteRejeu, e: EvenementBrut, erreur: unknown) {
    // Jamais le corps de l'événement ni le message de l'erreur (il peut citer des valeurs).
    this.logger.warn(
      `synchro.evenement_echec posteId=${ctx.poste.id} sequence=${e.sequence} evenementId=${e.evenementId} erreur=${erreur instanceof Error ? erreur.name : 'inconnue'}`,
    );
    ctx.aRenvoyer = true;
    return this.aRenvoyer(e, 'SERVICE_INDISPONIBLE');
  }

  private async traiterUn(
    ctx: ContexteRejeu,
    e: EvenementBrut,
    empreinte: string,
    differe: boolean,
  ): Promise<ResultatEvenement> {
    try {
      return await this.prisma.$transaction(
        (tx) => this.traiterDansTransaction(tx, ctx, e, empreinte, differe),
        OPTIONS_TRANSACTION,
      );
    } catch (erreur) {
      let rejet: RejetSynchro;
      if (erreur instanceof RejetSynchro) {
        rejet = erreur;
      } else if (erreur instanceof ARenvoyerSynchro) {
        ctx.aRenvoyer = true;
        return this.aRenvoyer(e, erreur.code);
      } else if (erreur instanceof HttpException) {
        const reponse = erreur.getResponse();
        const code =
          typeof reponse === 'object'
            ? (reponse as { code?: string }).code
            : undefined;
        rejet = new RejetSynchro(codeRejetDepuisHttp(code));
      } else {
        return this.echecImprevu(ctx, e, empreinte, erreur, differe);
      }
      try {
        return await this.enregistrerRejet(ctx, e, empreinte, rejet, differe);
      } catch (erreurRejet) {
        return this.echecImprevu(ctx, e, empreinte, erreurRejet, differe);
      }
    }
  }

  /**
   * Erreur imprévue : rien d'écrit, A_RENVOYER (D640). Si elle revient sur le même
   * événement (panne passagère de la base exclue), l'événement est mis de côté au
   * SEUIL_ECHECS_IMPREVUS-ième essai et la séquence avance : un poste n'est jamais
   * bloqué à vie (D664).
   */
  private async echecImprevu(
    ctx: ContexteRejeu,
    e: EvenementBrut,
    empreinte: string,
    erreur: unknown,
    differe: boolean,
  ): Promise<ResultatEvenement> {
    if (echecPassager(erreur)) return this.echec(ctx, e, erreur);
    const nombre =
      (ctx.echecImprevu?.evenementId === e.evenementId
        ? ctx.echecImprevu.nombre
        : 0) + 1;
    ctx.echecImprevu = { evenementId: e.evenementId, nombre };
    if (nombre < SEUIL_ECHECS_IMPREVUS) return this.echec(ctx, e, erreur);
    this.logger.warn(
      `synchro.evenement_mis_de_cote posteId=${ctx.poste.id} sequence=${e.sequence} evenementId=${e.evenementId} essais=${nombre} erreur=${erreur instanceof Error ? erreur.name : 'inconnue'}`,
    );
    try {
      const resultat = await this.enregistrerRejet(
        ctx,
        e,
        empreinte,
        new RejetSynchro('EVENEMENT_INAPPLICABLE'),
        differe,
      );
      ctx.echecImprevu = null;
      return resultat;
    } catch (erreurRejet) {
      return this.echec(ctx, e, erreurRejet);
    }
  }

  private async verrouillerPoste(tx: Tx, posteId: string): Promise<number> {
    const lignes = await tx.$queryRaw<
      { derniereSequenceAppliquee: number }[]
    >`SELECT "derniereSequenceAppliquee" FROM "Poste" WHERE "id" = ${posteId} FOR UPDATE`;
    return lignes[0].derniereSequenceAppliquee;
  }

  private versResultat(ligne: {
    evenementId: string;
    sequence: number;
    statut: string;
    resultat: Prisma.JsonValue | null;
  }): ResultatEvenement {
    const reste = { ...((ligne.resultat ?? {}) as Record<string, unknown>) };
    delete reste.statut;
    return {
      ...(reste as Partial<ResultatEvenement>),
      evenementId: ligne.evenementId,
      sequence: ligne.sequence,
      statut: ligne.statut === 'APPLIQUE' ? 'DEJA_APPLIQUE' : 'REJETE',
    };
  }

  private champsLigne(ctx: ContexteRejeu, e: EvenementBrut, empreinte: string) {
    return {
      evenementId: e.evenementId,
      posteId: ctx.poste.id,
      sequence: e.sequence,
      type: chaineLisible(e.type, 40) ?? '',
      utilisateurId: chaineLisible(e.utilisateurId, 64),
      horodatageLocal: dateLisible(e.horodatageLocal),
      corps: corpsStockable(e.corps) as Prisma.InputJsonValue,
      empreinte,
    };
  }

  private async traiterDansTransaction(
    tx: Tx,
    ctx: ContexteRejeu,
    e: EvenementBrut,
    empreinte: string,
    differe: boolean,
  ): Promise<ResultatEvenement> {
    await verrouillerJourneesPartage(tx, ctx.structure.id);
    const derniere = await this.verrouillerPoste(tx, ctx.poste.id);

    const connu = await tx.evenementSynchro.findUnique({
      where: { evenementId: e.evenementId },
    });
    let stocke: { id: string } | null = null;
    if (connu) {
      if (connu.posteId !== ctx.poste.id || connu.empreinte !== empreinte) {
        throw new RejetSynchro('EVENEMENT_MODIFIE', { stocker: false });
      }
      if (connu.statut !== 'EN_ATTENTE') return this.versResultat(connu);
      if (connu.sequence !== derniere + 1) {
        return {
          evenementId: e.evenementId,
          sequence: e.sequence,
          statut: 'EN_ATTENTE',
        };
      }
      stocke = connu;
    } else {
      const autre = await tx.evenementSynchro.findUnique({
        where: {
          posteId_sequence: { posteId: ctx.poste.id, sequence: e.sequence },
        },
        select: { id: true },
      });
      if (autre) {
        throw new RejetSynchro('SEQUENCE_DEJA_UTILISEE', { stocker: false });
      }
      if (e.sequence > derniere + 1) {
        await tx.evenementSynchro.create({
          data: {
            ...this.champsLigne(ctx, e, empreinte),
            statut: 'EN_ATTENTE',
          },
        });
        return {
          evenementId: e.evenementId,
          sequence: e.sequence,
          statut: 'EN_ATTENTE',
        };
      }
    }

    const horsOrdre = !stocke && e.sequence <= derniere;
    const application = await this.appliquer(tx, ctx, e);
    const resultat = {
      statut: 'APPLIQUE',
      ...application,
      ...(horsOrdre ? { horsOrdre: true } : {}),
    } as Prisma.InputJsonObject;
    if (stocke) {
      await tx.evenementSynchro.update({
        where: { id: stocke.id },
        data: { statut: 'APPLIQUE', resultat },
      });
    } else {
      await tx.evenementSynchro.create({
        data: {
          ...this.champsLigne(ctx, e, empreinte),
          statut: 'APPLIQUE',
          resultat,
        },
      });
    }
    if (!horsOrdre) {
      await tx.poste.update({
        where: { id: ctx.poste.id },
        data: { derniereSequenceAppliquee: e.sequence },
      });
    }
    return {
      ...application,
      evenementId: e.evenementId,
      sequence: e.sequence,
      statut: 'APPLIQUE',
      ...(differe ? { differe: true as const } : {}),
      ...(horsOrdre ? { horsOrdre: true as const } : {}),
    };
  }

  // ------------------------------------------------------------------ rejet

  private async enregistrerRejet(
    ctx: ContexteRejeu,
    e: EvenementBrut,
    empreinte: string,
    rejetInitial: RejetSynchro,
    differe: boolean,
  ): Promise<ResultatEvenement> {
    return this.prisma.$transaction(async (tx) => {
      await verrouillerJourneesPartage(tx, ctx.structure.id);
      const derniere = await this.verrouillerPoste(tx, ctx.poste.id);
      let rejet = rejetInitial;
      const stocker = rejet.options.stocker !== false;

      const connu = await tx.evenementSynchro.findUnique({
        where: { evenementId: e.evenementId },
      });
      // Traité entre-temps par un envoi concurrent : on rend son résultat.
      if (stocker && connu && connu.statut !== 'EN_ATTENTE') {
        return this.versResultat(connu);
      }
      if (stocker) {
        const autre = await tx.evenementSynchro.findUnique({
          where: {
            posteId_sequence: { posteId: ctx.poste.id, sequence: e.sequence },
          },
          select: { evenementId: true },
        });
        if (autre && autre.evenementId !== e.evenementId) {
          rejet = new RejetSynchro('SEQUENCE_DEJA_UTILISEE', {
            stocker: false,
          });
        }
      }

      const message = MESSAGES_REJET[rejet.code];
      const champs = rejet.options.champs;
      const detailsBase = {
        evenementId: e.evenementId,
        sequence: e.sequence,
        type: chaineLisible(e.type, 40),
        code: rejet.code,
        message,
        ...(champs ? { champs } : {}),
        posteCode: ctx.poste.code,
        utilisateurId: chaineLisible(e.utilisateurId, 64),
        horodatageLocal: dateLisible(e.horodatageLocal)?.toISOString() ?? null,
        resume: resumeEvenement(e.type, e.corps),
      };

      if (rejet.options.stocker === false) {
        const existante = await tx.anomalie.findFirst({
          where: {
            pointDeVenteId: ctx.poste.pointDeVenteId,
            type: 'EVENEMENT_REJETE',
            pieceType: 'Poste',
            pieceId: ctx.poste.id,
            details: { path: ['evenementId'], equals: e.evenementId },
          },
          select: { id: true },
        });
        const anomalieId =
          existante?.id ??
          (
            await this.creerAnomalie(
              tx,
              ctx,
              'EVENEMENT_REJETE',
              'Poste',
              ctx.poste.id,
              detailsBase,
            )
          ).id;
        return {
          evenementId: e.evenementId,
          sequence: e.sequence,
          statut: 'REJETE',
          code: rejet.code,
          message,
          anomalies: [{ type: 'EVENEMENT_REJETE', id: anomalieId }],
          ...(differe ? { differe: true as const } : {}),
        };
      }

      const ligneId = connu?.id ?? randomUUID();
      const anomalie = await this.creerAnomalie(
        tx,
        ctx,
        'EVENEMENT_REJETE',
        'EvenementSynchro',
        ligneId,
        detailsBase,
      );
      const anomalies = [{ type: 'EVENEMENT_REJETE', id: anomalie.id }];
      const resultat = {
        statut: 'REJETE',
        code: rejet.code,
        message,
        ...(champs ? { champs } : {}),
        anomalies,
      } as Prisma.InputJsonObject;
      if (connu) {
        await tx.evenementSynchro.update({
          where: { id: connu.id },
          data: { statut: 'REJETE', resultat },
        });
      } else {
        await tx.evenementSynchro.create({
          data: {
            id: ligneId,
            ...this.champsLigne(ctx, e, empreinte),
            statut: 'REJETE',
            resultat,
          },
        });
      }
      if (e.sequence === derniere + 1) {
        await tx.poste.update({
          where: { id: ctx.poste.id },
          data: { derniereSequenceAppliquee: e.sequence },
        });
      }
      return {
        evenementId: e.evenementId,
        sequence: e.sequence,
        statut: 'REJETE',
        code: rejet.code,
        message,
        ...(champs ? { champs } : {}),
        anomalies,
        ...(differe ? { differe: true as const } : {}),
      };
    }, OPTIONS_TRANSACTION);
  }

  private async creerAnomalie(
    tx: Tx,
    ctx: ContexteRejeu,
    type:
      | 'EVENEMENT_REJETE'
      | 'SEQUENCE_MANQUANTE'
      | 'ECART_CAISSE'
      | 'REMONTEE_APRES_CLOTURE'
      | 'PRIX_DIVERGENT'
      | 'VENTE_UNITE_INTERDITE'
      | 'ORDONNANCE_NON_CONFIRMEE'
      | 'PRODUIT_ARCHIVE'
      | 'CONDITIONNEMENT_CONCURRENT'
      | 'PLAGE_EPUISEE',
    pieceType: string,
    pieceId: string,
    details: Prisma.InputJsonObject,
    attribueeAId: string | null = ctx.structure.adminId,
  ): Promise<{ type: string; id: string }> {
    const creee = await tx.anomalie.create({
      data: {
        pointDeVenteId: ctx.poste.pointDeVenteId,
        type,
        attribueeAId,
        pieceType,
        pieceId,
        details,
      },
      select: { id: true },
    });
    return { type, id: creee.id };
  }

  // ------------------------------------------------------------- application

  private async appliquer(
    tx: Tx,
    ctx: ContexteRejeu,
    e: EvenementBrut,
  ): Promise<ResultatApplication> {
    // Caractère NUL (refusé par PostgreSQL) : sûrement illisible, mis de côté avant
    // toute écriture, jamais renvoyé à l'infini (D664).
    const illisibles: string[] = (
      ['type', 'horodatageLocal', 'utilisateurId'] as const
    ).filter((champ) => contientNul(e[champ]));
    if (corpsIllisible(e.corps)) illisibles.push('corps');
    if (illisibles.length > 0) {
      throw new RejetSynchro('EVENEMENT_INVALIDE', { champs: illisibles });
    }

    const champsEnveloppe: string[] = [];
    const type = (TYPES_EVENEMENT as readonly unknown[]).includes(e.type)
      ? (e.type as (typeof TYPES_EVENEMENT)[number])
      : null;
    if (type === null) champsEnveloppe.push('type');
    const local = dateLisible(e.horodatageLocal);
    if (local === null) champsEnveloppe.push('horodatageLocal');
    const utilisateurId = chaineLisible(e.utilisateurId, 64);
    if (utilisateurId === null) champsEnveloppe.push('utilisateurId');
    if (type === null || local === null || utilisateurId === null) {
      throw new RejetSynchro('EVENEMENT_INVALIDE', {
        champs: champsEnveloppe,
      });
    }

    const utilisateur = await ctx.chargerUtilisateur(utilisateurId);
    if (
      !utilisateur ||
      (utilisateur.structureId !== ctx.structure.id &&
        ctx.structure.adminId !== utilisateur.id)
    ) {
      throw new RejetSynchro('UTILISATEUR_NON_AUTORISE');
    }
    const borne = horodatageBorne(local, new Date());

    switch (type) {
      case 'VENTE': {
        const corps = await this.corpsValide(CorpsVenteDto, e.corps);
        return this.appliquerVente(
          tx,
          ctx,
          e,
          corps,
          utilisateur,
          local,
          borne,
        );
      }
      case 'SESSION_OUVERTE': {
        const corps = await this.corpsValide(CorpsSessionOuverteDto, e.corps);
        return this.ouvrirSession(tx, ctx, e, corps, utilisateur, local, borne);
      }
      case 'COMPTAGE_SAISI': {
        const corps = await this.corpsValide(CorpsComptageSaisiDto, e.corps);
        const s = await this.sessionDuPoste(tx, ctx, corps.sessionId);
        if (s.statut !== 'OUVERTE') throw new RejetSynchro('SESSION_FERMEE');
        // Un jour clôturé n'empêche pas le comptage de la caisse d'origine (D625 point 5).
        const { comptage } = await this.sessionsCaisse.enregistrerComptage(
          tx,
          s,
          corps.moment,
          {
            id: corps.comptageId,
            coupures: corps.coupures,
            releves: corps.releves,
          },
          utilisateur.id,
          local,
        );
        return { piece: { type: 'COMPTAGE', id: comptage.id } };
      }
      case 'MOUVEMENT_CAISSE': {
        const corps = await this.corpsValide(CorpsMouvementCaisseDto, e.corps);
        return this.enregistrerMouvement(tx, ctx, corps, utilisateur.id, local);
      }
      case 'SESSION_FERMEE': {
        const corps = await this.corpsValide(CorpsSessionFermeeDto, e.corps);
        const s = await this.sessionDuPoste(tx, ctx, corps.sessionId);
        if (s.statut !== 'OUVERTE') {
          return {
            piece: { type: 'SESSION', id: s.id },
            code: 'SESSION_DEJA_FERMEE',
          };
        }
        const anomalies = await this.fermerParRejeu(tx, ctx, s, {
          comptageFermeture: corps.comptageFermeture
            ? {
                id: corps.comptageFermeture.comptageId,
                coupures: corps.comptageFermeture.coupures,
                releves: corps.comptageFermeture.releves,
              }
            : undefined,
          commentaire: corps.commentaire,
          horodatageLocal: local,
          evenementFermetureId: e.evenementId,
          auteurId: utilisateur.id,
        });
        return { piece: { type: 'SESSION', id: s.id }, anomalies };
      }
    }
  }

  private async corpsValide<T extends object>(
    classe: new () => T,
    corps: unknown,
  ): Promise<T> {
    const verdict = await validerCorps(classe, corps);
    if (!verdict.ok) {
      throw new RejetSynchro('EVENEMENT_INVALIDE', { champs: verdict.champs });
    }
    return verdict.valeur;
  }

  private async sessionDuPoste(
    tx: Tx,
    ctx: ContexteRejeu,
    sessionId: string,
  ): Promise<SessionChargee> {
    const session = await tx.sessionCaisse.findUnique({
      where: { id: sessionId },
      select: { id: true, posteId: true },
    });
    if (!session || session.posteId !== ctx.poste.id) {
      throw new RejetSynchro('SESSION_INCONNUE');
    }
    return this.sessionsCaisse.verrouillerSession(tx, session.id);
  }

  // ------------------------------------------------------ gestionnaire vente

  /** Vente faite sur le poste : le serveur réalloue les lots selon son état, jamais de refus de fond (D651 à D658). */
  private async appliquerVente(
    tx: Tx,
    ctx: ContexteRejeu,
    e: EvenementBrut,
    corps: CorpsVenteDto,
    utilisateur: UtilisateurCharge,
    local: Date,
    borne: Date,
  ): Promise<ResultatApplication> {
    const structureId = ctx.structure.id;
    const pointDeVenteId = ctx.poste.pointDeVenteId;
    const s = await this.sessionDuPoste(tx, ctx, corps.sessionId);
    // Caisse fermée ou d'un jour clôturé : régularisation sur la journée en cours,
    // la journée clôturée ne bouge pas (D659).
    const jourCaisse = dateVersJour(s.jourMetier);
    const clos = await estJourCloture(tx, pointDeVenteId, jourCaisse);
    const regularisation = s.statut !== 'OUVERTE' || clos;
    let jourMetier = s.jourMetier;
    let jourMetierOrigine: Date | null = null;
    let jourRattachement = jourCaisse;
    if (regularisation) {
      // Sous le verrou de journée partagé pris en tête de transaction (D613).
      jourRattachement = (
        await jourDeRattachement(tx, pointDeVenteId, new Date())
      ).jour;
      jourMetier = jourVersDate(jourRattachement);
      jourMetierOrigine = s.jourMetier;
    }
    const existante = await tx.vente.findUnique({
      where: { id: corps.venteId },
      select: { id: true },
    });
    if (existante) throw new RejetSynchro('IDENTIFIANT_DEJA_UTILISE');

    const coherence = verifierCoherenceVente(corps);
    if (!coherence.ok) {
      throw new RejetSynchro('EVENEMENT_INVALIDE', {
        champs: coherence.champs,
      });
    }
    const prepares = preparerPaiements(
      corps.total,
      corps.paiements.map((p) => ({
        mode: p.mode,
        montant: p.montant,
        reference: p.reference,
        montantRecu: p.montantRecu,
      })),
      await tx.modePaiement.findMany(),
    );
    if (!prepares.ok) {
      throw new RejetSynchro('EVENEMENT_INVALIDE', { champs: ['paiements'] });
    }

    const ids = [...new Set(corps.lignes.map((l) => l.stockId))];
    await this.mouvementsStock.verrouillerFiches(tx, ids);
    // Lues après les verrous : le coefficient est à jour (D560).
    const fiches = await tx.stockMedicament.findMany({
      where: { id: { in: ids }, structureId },
      include: {
        medicament: {
          select: { id: true, nom: true, ordonnanceRequise: true },
        },
      },
    });
    const parId = new Map(fiches.map((f) => [f.id, f]));
    if (ids.some((id) => !parId.has(id))) {
      throw new RejetSynchro('STOCK_INTROUVABLE');
    }

    const jourVente = jourConakry(borne);
    const lotsParFiche = await lireLotsCandidats(tx, pointDeVenteId, ids);
    const lignes = corps.lignes.map((l) => {
      const fiche = parId.get(l.stockId)!;
      const calcul = calculerLigneRejeu({
        unite: l.unite,
        nombre: l.nombre,
        prixTicket: l.prixUnitaire,
        coefficientBoite: fiche.coefficientBoite,
      });
      // Sortie manuelle gardée seulement si le lot a encore du stock au serveur.
      const sortieManuelle =
        l.sortieManuelle &&
        (lotsParFiche.get(l.stockId) ?? []).some(
          (c) => c.id === l.sortieManuelle?.lotId,
        )
          ? { lotId: l.sortieManuelle.lotId, motif: l.sortieManuelle.motif }
          : null;
      return { l, fiche, calcul, sortieManuelle };
    });

    // Deux postes ont chacun entamé une boîte : seul le serveur le voit (D654).
    const concurrents: { stockId: string; nom: string }[] = [];
    for (const { l, fiche } of lignes) {
      if (l.unite !== 'UNITE' || l.ouvertureConditionnement !== true) continue;
      if (concurrents.some((c) => c.stockId === fiche.id)) continue;
      const entame = (lotsParFiche.get(fiche.id) ?? []).some(
        (c) =>
          !estPerime(c.dateExpiration, jourVente) &&
          reliquatLot(c.solde, c.coefficientReception) > 0,
      );
      if (entame) {
        concurrents.push({ stockId: fiche.id, nom: fiche.medicament.nom });
      }
    }

    const aAllouer: LigneAAllouer[] = lignes.map((c, index) => ({
      index,
      stockMedicamentId: c.fiche.id,
      unite: c.calcul.uniteAffichee,
      quantiteUm: c.calcul.quantiteUm,
      sortieManuelle: c.sortieManuelle,
    }));
    const allouees = allouerLignes(jourVente, aAllouer, lotsParFiche);

    // Numéro (D655) : jamais de refus, la base reste sans doublon.
    const { ordre, code: posteCode } = ctx.poste;
    let numero: string;
    let numeroTicket: number | null = null;
    let secours = false;
    let horsPlage: { numeroImprime: string } | null = null;
    const horsPlageDe = (numeroImprime: string) => {
      horsPlage = { numeroImprime };
      return numeroHorsPlage(ordre, posteCode, e.sequence);
    };
    if (corps.numeroTicket !== undefined) {
      const n = corps.numeroTicket;
      const plage = await tx.plageTicket.findFirst({
        where: { posteId: ctx.poste.id, debut: { lte: n }, fin: { gte: n } },
        select: { id: true },
      });
      const prise = await tx.vente.findFirst({
        where: { pointDeVenteId, numeroTicket: n },
        select: { id: true },
      });
      if (plage && !prise) {
        numero = formaterNumeroTicket(ordre, n);
        numeroTicket = n;
      } else {
        numero = horsPlageDe(formaterNumeroTicket(ordre, n));
      }
    } else {
      const secoursNumero = formaterNumeroSecours(
        ordre,
        posteCode,
        corps.numeroSecours as number,
      );
      const pris = await tx.vente.findFirst({
        where: { structureId, numero: secoursNumero },
        select: { id: true },
      });
      if (pris) {
        numero = horsPlageDe(secoursNumero);
      } else {
        numero = secoursNumero;
        secours = true;
      }
    }

    const nomVendeur = `${utilisateur.prenom} ${utilisateur.nom}`.trim();
    const ecrit = await ecrirePieceVente(tx, this.mouvementsStock, {
      id: corps.venteId,
      structureId,
      adminId: ctx.structure.adminId,
      pointDeVenteId,
      posteId: ctx.poste.id,
      posteCode,
      sessionId: s.id,
      typePiece: regularisation ? 'REGULARISATION' : 'VENTE',
      numero,
      numeroTicket,
      jourMetier,
      jourMetierOrigine,
      vendeur: { id: utilisateur.id, nom: nomVendeur },
      clientNom: corps.clientNom || null,
      clientTelephone: corps.clientTelephone || null,
      ordonnanceVerifiee: corps.ordonnanceVerifiee,
      total: corps.total,
      cleIdempotence: null,
      horodatageLocal: local,
      sequencePoste: e.sequence,
      lignes: lignes.map((c, index) => ({
        fiche: {
          id: c.fiche.id,
          medicamentId: c.fiche.medicamentId,
          nom: c.fiche.medicament.nom,
        },
        calcul: c.calcul,
        allocation: allouees[index],
        detailsAnomalie: {
          origine: 'SYNCHRO',
          quantiteProvisoireLocale: c.l.quantiteProvisoireLocale ?? 0,
          perimesDisponibles: allouees[index].lotsPerimesDisponibles.length,
          evenementId: e.evenementId,
        },
        anomalieMemeSansProvisoire: (c.l.quantiteProvisoireLocale ?? 0) > 0,
      })),
      paiements: prepares.paiements,
      evenementIdMouvement: (i, lotId) =>
        `synchro:${e.evenementId}:${i}:${lotId ?? 'provisoire'}`,
    });

    // Anomalies d'application, au titulaire : la vente est toujours appliquée (D653).
    const anomalies: { type: string; id: string }[] = [...ecrit.anomalies];
    const jour = dateVersJour(jourMetier);
    const causes = anomaliesApplication(
      lignes.map((c) => ({
        fiche: {
          id: c.fiche.id,
          nom: c.fiche.medicament.nom,
          prixUnitaire: c.fiche.prixUnitaire,
          prixUnite: c.fiche.prixUnite,
          deconditionnable: c.fiche.deconditionnable,
          ordonnanceRequise: c.fiche.medicament.ordonnanceRequise,
          archive: c.fiche.archiveLe !== null,
        },
        unite: c.l.unite,
        prixTicket: c.l.prixUnitaire,
      })),
      corps.ordonnanceVerifiee,
    );
    const detailsVente = (
      lignesEnCause: Prisma.InputJsonValue,
      message: string,
    ): Prisma.InputJsonObject => ({
      numero,
      posteCode,
      utilisateurId: utilisateur.id,
      utilisateurNom: nomVendeur,
      jourMetier: jour,
      horodatageLocal: local.toISOString(),
      lignes: lignesEnCause,
      message,
    });
    const nombre = (n: number) => `${n} médicament(s)`;
    const aSignaler: {
      type:
        | 'PRIX_DIVERGENT'
        | 'VENTE_UNITE_INTERDITE'
        | 'ORDONNANCE_NON_CONFIRMEE'
        | 'PRODUIT_ARCHIVE'
        | 'CONDITIONNEMENT_CONCURRENT';
      lignes: Prisma.InputJsonValue[];
      message: string;
    }[] = [
      {
        type: 'PRIX_DIVERGENT',
        lignes: causes.prixDivergents,
        message: `La vente ${numero} a été faite sur le poste à un prix différent du prix enregistré pour ${nombre(causes.prixDivergents.length)} : le prix du ticket a été gardé. Vérifiez les prix de ces fiches.`,
      },
      {
        type: 'VENTE_UNITE_INTERDITE',
        lignes: causes.uniteInterdite,
        message: `La vente ${numero} contient un médicament vendu à l'unité alors que sa fiche ne le permet pas.`,
      },
      {
        type: 'ORDONNANCE_NON_CONFIRMEE',
        lignes: causes.ordonnance,
        message: `La vente ${numero} contient un médicament sur ordonnance sans que l'ordonnance ait été confirmée.`,
      },
      {
        type: 'PRODUIT_ARCHIVE',
        lignes: causes.archives,
        message: `La vente ${numero} contient un médicament retiré du stock (archivé) : vérifiez sa fiche.`,
      },
      {
        type: 'CONDITIONNEMENT_CONCURRENT',
        lignes: concurrents,
        message: `Pour la vente ${numero}, le poste a entamé une nouvelle boîte alors qu'une boîte entamée existait déjà : comptez les boîtes ouvertes de ce médicament.`,
      },
    ];
    for (const a of aSignaler) {
      if (a.lignes.length === 0) continue;
      anomalies.push(
        await this.creerAnomalie(
          tx,
          ctx,
          a.type,
          'VENTE',
          corps.venteId,
          detailsVente(a.lignes, a.message),
        ),
      );
    }
    if (secours) {
      const ouverte = await tx.anomalie.findFirst({
        where: {
          pointDeVenteId,
          type: 'PLAGE_EPUISEE',
          statut: 'OUVERTE',
          pieceType: 'Poste',
          pieceId: ctx.poste.id,
        },
        select: { id: true },
      });
      if (!ouverte) {
        anomalies.push(
          await this.creerAnomalie(
            tx,
            ctx,
            'PLAGE_EPUISEE',
            'Poste',
            ctx.poste.id,
            {
              raison: 'PLAGE_EPUISEE',
              posteCode,
              numero,
              jourMetier: jour,
              message: `Le poste ${ctx.poste.libelle} n'avait plus de numéros de tickets réservés : il a utilisé des numéros de secours (${numero}). Connectez-le pour qu'il recharge ses numéros.`,
            },
          ),
        );
      }
    }
    const imprime = horsPlage as { numeroImprime: string } | null;
    if (imprime) {
      anomalies.push(
        await this.creerAnomalie(
          tx,
          ctx,
          'PLAGE_EPUISEE',
          'VENTE',
          corps.venteId,
          {
            raison: 'NUMERO_HORS_PLAGE',
            posteCode,
            numeroImprime: imprime.numeroImprime,
            numero,
            message: `Le ticket ${imprime.numeroImprime} du poste ${ctx.poste.libelle} porte un numéro qui ne lui était pas réservé : la vente est enregistrée sous le numéro ${numero}.`,
          },
        ),
      );
    }

    if (regularisation) {
      const raison = clos ? 'JOURNEE_CLOTUREE' : 'CAISSE_FERMEE';
      const cloture = clos
        ? await tx.clotureJournaliere.findUnique({
            where: {
              pointDeVenteId_jourMetier: {
                pointDeVenteId,
                jourMetier: s.jourMetier,
              },
            },
            select: { id: true, postesManquants: true },
          })
        : null;
      const manquants = Array.isArray(cloture?.postesManquants)
        ? (cloture.postesManquants as { sessionId?: string }[])
        : [];
      const posteManquantDeLaCloture = manquants.some(
        (p) => p?.sessionId === s.id,
      );
      const message = clos
        ? `La vente ${numero} du ${jourLisible(jourCaisse)} est arrivée après la clôture de cette journée : elle est enregistrée sur la journée du ${jourLisible(jourRattachement)} (régularisation). La journée clôturée n'a pas changé.`
        : `La vente ${numero} est arrivée après la fermeture de sa caisse (caisse de ${s.utilisateurNom}) : elle est enregistrée sur la journée du ${jourLisible(jourRattachement)} (régularisation). Vérifiez l'argent de cette caisse.`;
      anomalies.push(
        await this.creerAnomalie(
          tx,
          ctx,
          'REMONTEE_APRES_CLOTURE',
          'VENTE',
          corps.venteId,
          {
            raison,
            clotureId: cloture?.id ?? null,
            jourOrigine: jourCaisse,
            jourRattachement,
            posteManquantDeLaCloture,
            numero,
            total: corps.total,
            posteCode,
            sessionId: s.id,
            utilisateurId: utilisateur.id,
            utilisateurNom: nomVendeur,
            horodatageLocal: local.toISOString(),
            message,
          },
          s.utilisateurId ?? ctx.structure.adminId,
        ),
      );
    }

    await tx.auditLog.create({
      data: {
        userId: utilisateur.id,
        action: 'create',
        entityType: 'Vente',
        entityId: corps.venteId,
        ip: ctx.ip ?? null,
        metadata: {
          numero,
          typePiece: regularisation ? 'REGULARISATION' : 'VENTE',
          total: corps.total,
          nombreLignes: lignes.length,
          provisoire: allouees.some((a) => a.resteProvisoire > 0),
          origine: 'synchro',
          posteCode,
          sequence: e.sequence,
        },
      },
    });
    return {
      piece: {
        type: regularisation ? 'REGULARISATION' : 'VENTE',
        id: corps.venteId,
        numero,
      },
      anomalies,
    };
  }

  // ------------------------------------------------------ gestionnaires caisse

  private async ouvrirSession(
    tx: Tx,
    ctx: ContexteRejeu,
    e: EvenementBrut,
    corps: CorpsSessionOuverteDto,
    utilisateur: UtilisateurCharge,
    local: Date,
    borne: Date,
  ): Promise<ResultatApplication> {
    const existante = await tx.sessionCaisse.findUnique({
      where: { id: corps.sessionId },
      select: { id: true, posteId: true },
    });
    if (existante) {
      if (existante.posteId !== ctx.poste.id) {
        throw new RejetSynchro('IDENTIFIANT_DEJA_UTILISE');
      }
      return { piece: { type: 'SESSION', id: existante.id } };
    }

    const anomalies: { type: string; id: string }[] = [];
    const ouverte = await tx.sessionCaisse.findFirst({
      where: { posteId: ctx.poste.id, statut: 'OUVERTE' },
      select: { id: true },
    });
    if (ouverte) {
      // La fermeture de l'ancienne caisse n'est jamais arrivée : un poste n'a qu'une
      // caisse ouverte, on la ferme sans comptage (D647).
      const ancienne = await this.sessionsCaisse.verrouillerSession(
        tx,
        ouverte.id,
      );
      anomalies.push(
        ...(await this.fermerParRejeu(tx, ctx, ancienne, {
          auteurId: utilisateur.id,
          evenementFermetureId: `fermeture-implicite:${e.evenementId}`,
        })),
      );
      anomalies.push(
        await this.creerAnomalie(
          tx,
          ctx,
          'SEQUENCE_MANQUANTE',
          'SessionCaisse',
          ancienne.id,
          {
            raison: 'FERMETURE_MANQUANTE',
            sessionId: ancienne.id,
            posteCode: ctx.poste.code,
            utilisateurNom: ancienne.utilisateurNom,
            jourMetier: jourConakry(ancienne.jourMetier),
            message: `La fermeture de la caisse de ${ancienne.utilisateurNom} sur ${ctx.poste.libelle} n'est jamais arrivée : elle a été fermée automatiquement, sans comptage, à l'ouverture de la caisse suivante. Vérifiez l'argent de ce tiroir.`,
          },
        ),
      );
    }

    const jourLocal = jourConakry(borne);
    let jour = jourLocal;
    let jourMetierOrigine: Date | null = null;
    if (await estJourCloture(tx, ctx.poste.pointDeVenteId, jourLocal)) {
      jour = (
        await jourDeRattachement(tx, ctx.poste.pointDeVenteId, new Date())
      ).jour;
      jourMetierOrigine = jourVersDate(jourLocal);
    }
    const creee = await tx.sessionCaisse.create({
      data: {
        id: corps.sessionId,
        pointDeVenteId: ctx.poste.pointDeVenteId,
        posteId: ctx.poste.id,
        utilisateurId: utilisateur.id,
        utilisateurNom: `${utilisateur.prenom} ${utilisateur.nom}`.trim(),
        jourMetier: jourVersDate(jour),
        jourMetierOrigine,
        ouverteLe: new Date(),
        ouverteLeLocal: local,
        evenementOuvertureId: e.evenementId,
      },
      select: { id: true },
    });
    return {
      piece: { type: 'SESSION', id: creee.id },
      ...(anomalies.length > 0 ? { anomalies } : {}),
    };
  }

  private async enregistrerMouvement(
    tx: Tx,
    ctx: ContexteRejeu,
    corps: CorpsMouvementCaisseDto,
    auteurId: string,
    local: Date,
  ): Promise<ResultatApplication> {
    const s = await this.sessionDuPoste(tx, ctx, corps.sessionId);
    if (s.statut !== 'OUVERTE') throw new RejetSynchro('SESSION_FERMEE');
    const existant = await tx.mouvementCaisse.findUnique({
      where: { id: corps.mouvementId },
      select: { id: true, sessionCaisseId: true },
    });
    if (existant) {
      if (existant.sessionCaisseId !== s.id) {
        throw new RejetSynchro('IDENTIFIANT_DEJA_UTILISE');
      }
      return { piece: { type: 'MOUVEMENT_CAISSE', id: existant.id } };
    }
    // Un mode désactivé depuis reste accepté : l'argent a bougé (D648).
    const mode = await tx.modePaiement.findUnique({
      where: { code: corps.mode ?? CODE_ESPECES },
      select: { id: true },
    });
    if (!mode) {
      throw new RejetSynchro('EVENEMENT_INVALIDE', { champs: ['mode'] });
    }
    await tx.mouvementCaisse.create({
      data: {
        id: corps.mouvementId,
        sessionCaisseId: s.id,
        pointDeVenteId: s.pointDeVenteId,
        type: corps.type,
        modePaiementId: mode.id,
        montant: corps.montant,
        motif: corps.motif,
        auteurId,
        horodatageLocal: local,
        evenementId: corps.mouvementId,
      },
    });
    return { piece: { type: 'MOUVEMENT_CAISSE', id: corps.mouvementId } };
  }

  private async fermerParRejeu(
    tx: Tx,
    ctx: ContexteRejeu,
    s: SessionChargee,
    o: {
      auteurId: string;
      comptageFermeture?: EntreeComptage;
      commentaire?: string;
      horodatageLocal?: Date | null;
      evenementFermetureId: string;
    },
  ): Promise<{ type: string; id: string }[]> {
    const { bilan, anomalies } =
      await this.sessionsCaisse.fermerSessionVerrouillee(tx, s, ctx.structure, {
        auteurId: o.auteurId,
        comptageFermeture: o.comptageFermeture,
        commentaire: o.commentaire,
        exigerComptage: false,
        exigerCommentaire: false,
        fermeeLeLocal: o.horodatageLocal,
        evenementFermetureId: o.evenementFermetureId,
        horodatageLocalComptage: o.horodatageLocal,
      });
    const resultat: { type: string; id: string }[] = [...anomalies];
    const jour = jourConakry(s.jourMetier);
    const theoriqueEspeces =
      bilan.theorique.find((t) => t.mode === CODE_ESPECES)?.montant ?? null;
    const compteEspeces =
      bilan.compte.find((c) => c.mode === CODE_ESPECES)?.montant ?? null;

    if (compteEspeces === null) {
      resultat.push(
        await this.creerAnomalie(
          tx,
          ctx,
          'ECART_CAISSE',
          'SessionCaisse',
          s.id,
          {
            posteCode: ctx.poste.code,
            utilisateurId: s.utilisateurId,
            utilisateurNom: s.utilisateurNom,
            jourMetier: jour,
            raison: 'COMPTAGE_FERMETURE_ABSENT',
            theorique: theoriqueEspeces,
            compte: null,
            ecart: null,
            message: `La caisse de ${s.utilisateurNom} a été fermée sur le poste sans comptage des billets : l'argent du tiroir n'a pas été vérifié.`,
          },
        ),
      );
    }

    const cloture = await tx.clotureJournaliere.findUnique({
      where: {
        pointDeVenteId_jourMetier: {
          pointDeVenteId: s.pointDeVenteId,
          jourMetier: s.jourMetier,
        },
      },
    });
    if (cloture) {
      const manquants = cloture.postesManquants as unknown as {
        sessionId?: string;
      }[];
      resultat.push(
        await this.creerAnomalie(
          tx,
          ctx,
          'REMONTEE_APRES_CLOTURE',
          'SessionCaisse',
          s.id,
          {
            raison: 'CAISSE_FERMEE_APRES_CLOTURE',
            clotureId: cloture.id,
            jourCloture: jourConakry(cloture.jourMetier),
            posteManquantDeLaCloture: manquants.some(
              (m) => m.sessionId === s.id,
            ),
            posteCode: ctx.poste.code,
            sessionId: s.id,
            utilisateurId: s.utilisateurId,
            utilisateurNom: s.utilisateurNom,
            nombrePieces:
              bilan.activite.nombreVentes + bilan.activite.nombreAnnulations,
            montantEncaisse: bilan.activite.montantEncaisse,
            theoriqueEspeces,
            compteEspeces,
            ecartEspeces: bilan.ecartEspeces,
            message: `La caisse de ${s.utilisateurNom} (journée du ${jourLisible(jour)}, déjà clôturée) a été fermée après la clôture : son argent (${formaterGnf(bilan.activite.montantEncaisse)} GNF encaissés) n'est compté dans aucune clôture. Vérifiez-le et rapprochez-le.`,
          },
        ),
      );
    }
    return resultat;
  }

  // ------------------------------------------------- attente et saut de trou

  /** Applique les événements en attente dès que le trou est comblé. */
  private async drainer(ctx: ContexteRejeu): Promise<ResultatEvenement[]> {
    const resultats: ResultatEvenement[] = [];
    let precedente = -1;
    for (;;) {
      const poste = await this.prisma.poste.findUniqueOrThrow({
        where: { id: ctx.poste.id },
        select: { derniereSequenceAppliquee: true },
      });
      const derniere = poste.derniereSequenceAppliquee;
      if (derniere === precedente) return resultats;
      precedente = derniere;
      const ligne = await this.prisma.evenementSynchro.findUnique({
        where: {
          posteId_sequence: { posteId: ctx.poste.id, sequence: derniere + 1 },
        },
      });
      if (!ligne || ligne.statut !== 'EN_ATTENTE') return resultats;
      const resultat = await this.traiterUn(
        ctx,
        {
          evenementId: ligne.evenementId,
          sequence: ligne.sequence,
          type: ligne.type,
          horodatageLocal: ligne.horodatageLocal?.toISOString() ?? null,
          utilisateurId: ligne.utilisateurId,
          corps: ligne.corps,
        },
        ligne.empreinte,
        true,
      );
      resultats.push(resultat);
      if (
        resultat.statut === 'EN_ATTENTE' ||
        resultat.statut === 'A_RENVOYER'
      ) {
        return resultats;
      }
    }
  }

  /** Après 24 h d'attente, saute le trou : un poste n'est jamais bloqué à vie (D642). */
  private async sauterTrouAncien(ctx: ContexteRejeu): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await verrouillerJourneesPartage(tx, ctx.structure.id);
        const derniere = await this.verrouillerPoste(tx, ctx.poste.id);
        const suivante = await tx.evenementSynchro.findUnique({
          where: {
            posteId_sequence: { posteId: ctx.poste.id, sequence: derniere + 1 },
          },
          select: { id: true },
        });
        if (suivante) return false;
        const premier = await tx.evenementSynchro.findFirst({
          where: { posteId: ctx.poste.id, statut: 'EN_ATTENTE' },
          orderBy: { sequence: 'asc' },
          select: { sequence: true },
        });
        const ancien = await tx.evenementSynchro.findFirst({
          where: { posteId: ctx.poste.id, statut: 'EN_ATTENTE' },
          orderBy: { recuLe: 'asc' },
          select: { recuLe: true },
        });
        if (
          !premier ||
          !ancien ||
          ancien.recuLe.getTime() >= Date.now() - DELAI_SAUT_MS
        ) {
          return false;
        }
        const nombre = premier.sequence - 1 - derniere;
        const a = derniere + 1;
        const b = premier.sequence - 1;
        await this.creerAnomalie(
          tx,
          ctx,
          'SEQUENCE_MANQUANTE',
          'Poste',
          ctx.poste.id,
          {
            raison: 'SEQUENCE_MANQUANTE',
            posteCode: ctx.poste.code,
            premiere: a,
            derniere: b,
            nombre,
            message: `Le poste ${ctx.poste.libelle} n'a jamais envoyé ${nombre} opération(s) de caisse (numéros ${a} à ${b}) depuis plus de 24 heures : les opérations suivantes ont été enregistrées sans elles. Vérifiez la caisse de ce poste.`,
          },
        );
        await tx.poste.update({
          where: { id: ctx.poste.id },
          data: { derniereSequenceAppliquee: b },
        });
        return true;
      }, OPTIONS_TRANSACTION);
    } catch (erreur) {
      this.logger.warn(
        `synchro.saut_echec posteId=${ctx.poste.id} erreur=${erreur instanceof Error ? erreur.name : 'inconnue'}`,
      );
      return false;
    }
  }
}
