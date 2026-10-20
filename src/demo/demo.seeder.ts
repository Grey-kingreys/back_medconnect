import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { EncryptionService } from 'src/common/services/encryption.service';
import { RolesService } from 'src/common/rbac/roles.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import {
  estModeDemoActif,
  estResetDemoDemande,
  SUFFIXE_EMAIL_DEMO,
} from './demo-mode';
import {
  ANALYSES_DEMO,
  AUTO_DIAGNOSTICS_DEMO,
  CleStructure,
  COMPTES_DEMO,
  CompteDemoDef,
  CONSULTATIONS_DEMO,
  CONVERSATIONS_DEMO,
  MEDICAMENTS_DEMO,
  NOTIFICATIONS_DEMO,
  RENDEZ_VOUS_DEMO,
  STOCKS_DEMO,
  STRUCTURES_DEMO,
  URGENCES_DEMO,
  VACCINATIONS_DEMO,
} from './demo.donnees';

const MINUTE = 60_000;

/** Rôles système résolus avant la transaction (patients et super administrateur). */
type RolesSysteme = { PATIENT: string | null; SUPER_ADMIN: string | null };

/** Préparation coûteuse faite hors transaction (hachages, rôles système). */
type Preparation = { hashes: string[]; rolesSysteme: RolesSysteme };

/** Bilan de la purge des données démo. */
export type BilanPurgeDemo = { comptes: number; structures: number };

const OPTIONS_TRANSACTION = { maxWait: 10_000, timeout: 120_000 };

/**
 * Seeder du jeu de données de démonstration (sur le modèle de `SuperAdminSeeder`).
 *
 * Ne fait rien si le mode démo est inactif (`DEMO_MODE` différent de `true`).
 * Sinon, au démarrage :
 *  1. journalise un avertissement (renforcé en production) ;
 *  2. crée tout le jeu de données dans UNE transaction, seulement si aucun compte
 *     ni aucune structure en `@demo.medconnecte.gn` n'existe (idempotent : une
 *     relance ne duplique rien, un échec ne laisse pas de données partielles) ;
 *  3. rattache les rôles RBAC (rôles par défaut des structures démo, `appRoleId`
 *     des comptes), étape rejouée à chaque démarrage pour réparer un oubli.
 *
 * Avec `DEMO_RESET=true` (et le mode démo actif), l'étape 2 devient : supprimer
 * toutes les données démo puis recréer le jeu complet, dans la même transaction.
 * Utile pour faire apparaître un jeu de données enrichi sur une base déjà semée.
 *
 * Les champs médicaux sont chiffrés avec `EncryptionService`, exactement comme dans
 * `CarnetSanteService` : sans cela le front afficherait « [Donnée illisible] ».
 * Les mots de passe sont aléatoires, forts et jamais conservés : la seule entrée
 * possible sur un compte démo est la connexion démo.
 */
@Injectable()
export class DemoSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!estModeDemoActif()) {
      if (estResetDemoDemande()) {
        this.logger.warn(
          'DEMO_RESET=true ignoré : le mode démo est inactif (DEMO_MODE différent de true), aucune donnée supprimée.',
        );
      }
      return;
    }

    this.avertir();
    try {
      if (estResetDemoDemande()) {
        await this.reinitialiserJeuDeDonnees();
      } else {
        await this.creerJeuDeDonnees();
      }
      await this.rattacherRoles();
    } catch (e) {
      // Ne jamais empêcher le démarrage de l'API à cause du jeu de démonstration.
      this.logger.error({
        evenement: 'demo.seed_echoue',
        message: 'Création des données de démonstration impossible',
        raison: e instanceof Error ? e.message : 'inconnue',
      });
    }
  }

  private avertir(): void {
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(
        'MODE DÉMO ACTIF EN PRODUCTION : tout visiteur peut ouvrir les comptes de démonstration sans mot de passe, y compris un super administrateur. Mettez DEMO_MODE=false si cette instance contient de vraies données de santé.',
      );
      return;
    }
    this.logger.warn(
      'Mode démo actif : comptes fictifs en @demo.medconnecte.gn accessibles sans mot de passe (GET /auth/demo/comptes, POST /auth/demo/connexion).',
    );
  }

  /**
   * Crée le jeu de données s'il n'existe pas encore.
   * Retourne `true` s'il a été créé, `false` s'il existait déjà.
   */
  async creerJeuDeDonnees(): Promise<boolean> {
    const filtre = { email: { endsWith: SUFFIXE_EMAIL_DEMO } };
    const [comptes, structures] = await Promise.all([
      this.prisma.user.count({ where: filtre }),
      this.prisma.structure.count({ where: filtre }),
    ]);
    if (comptes > 0 || structures > 0) {
      this.logger.log(
        'Données de démonstration déjà présentes : aucune création.',
      );
      return false;
    }

    const { hashes, rolesSysteme } = await this.preparer();
    await this.prisma.$transaction(
      (tx) => this.inserer(tx, hashes, rolesSysteme),
      OPTIONS_TRANSACTION,
    );

    this.logger.log(
      `Données de démonstration créées : ${STRUCTURES_DEMO.length} structures, ${COMPTES_DEMO.length} comptes.`,
    );
    return true;
  }

  /**
   * Remise à zéro (`DEMO_RESET=true`) : supprime toutes les données démo puis
   * recrée le jeu complet, dans UNE transaction (un échec ne laisse ni base vide
   * ni données partielles). Ne fait rien si le mode démo est inactif.
   * Retourne le bilan de la purge, ou `null` si rien n'a été fait.
   */
  async reinitialiserJeuDeDonnees(): Promise<BilanPurgeDemo | null> {
    if (!estModeDemoActif()) return null;

    const { hashes, rolesSysteme } = await this.preparer();
    const bilan = await this.prisma.$transaction(async (tx) => {
      const purge = await this.purger(tx);
      await this.inserer(tx, hashes, rolesSysteme);
      return purge;
    }, OPTIONS_TRANSACTION);

    this.logger.log(
      `Données de démonstration supprimées puis recréées : ${bilan.comptes} compte(s) et ${bilan.structures} structure(s) supprimés, ${COMPTES_DEMO.length} comptes et ${STRUCTURES_DEMO.length} structures recréés.`,
    );
    return bilan;
  }

  /**
   * Purge physique et volontaire des seules données démo (le soft-delete du
   * projet ne s'applique pas à ces données fictives).
   *
   * Périmètre : comptes et structures dont l'email est en `@demo.medconnecte.gn`.
   * Les journaux d'audit de ces comptes sont supprimés explicitement (leur clé
   * étrangère est en SET NULL) ; tout le reste suit les `onDelete: Cascade` du
   * schéma : profil, carnet (consultations, ordonnances, analyses, vaccinations),
   * rendez-vous, auto-diagnostics, urgences, notifications, conversations et
   * messages, autorisations, fichiers, stocks et rôles propres aux structures.
   * Le catalogue de médicaments, partagé, n'est jamais touché.
   */
  private async purger(tx: Prisma.TransactionClient): Promise<BilanPurgeDemo> {
    const filtre = { email: { endsWith: SUFFIXE_EMAIL_DEMO } };
    const comptes = await tx.user.findMany({
      where: filtre,
      select: { id: true },
    });
    if (comptes.length > 0) {
      await tx.auditLog.deleteMany({
        where: { userId: { in: comptes.map((c) => c.id) } },
      });
    }
    // Comptes d'abord : `Structure.adminId` passe à null, puis les structures partent.
    const comptesSupprimes = await tx.user.deleteMany({ where: filtre });
    const structuresSupprimees = await tx.structure.deleteMany({
      where: filtre,
    });
    return {
      comptes: comptesSupprimes.count,
      structures: structuresSupprimees.count,
    };
  }

  /** Hachages (lents) et rôles système, hors transaction. */
  private async preparer(): Promise<Preparation> {
    // Un mot de passe aléatoire par compte, jamais conservé.
    const hashes = await Promise.all(
      COMPTES_DEMO.map(() =>
        bcrypt.hash(randomBytes(32).toString('base64url'), 12),
      ),
    );
    const rolesSysteme: RolesSysteme = {
      PATIENT: await this.resoudreRole('PATIENT'),
      SUPER_ADMIN: await this.resoudreRole('SUPER_ADMIN'),
    };
    return { hashes, rolesSysteme };
  }

  /**
   * Rôles RBAC des structures et comptes démo (idempotent, rejoué à chaque démarrage).
   *
   * Si le catalogue de permissions n'est pas encore synchronisé, on s'abstient :
   * `RolesService` créera lui-même les rôles des structures et rattachera les
   * comptes à son passage (sinon des rôles vides seraient figés).
   */
  async rattacherRoles(): Promise<void> {
    const nbPermissions = await this.prisma.permission.count();
    if (nbPermissions === 0) {
      this.logger.warn(
        'Catalogue de permissions pas encore synchronisé : rôles des comptes démo laissés à RolesService.',
      );
      return;
    }

    const filtre = { email: { endsWith: SUFFIXE_EMAIL_DEMO } };
    const structures = await this.prisma.structure.findMany({
      where: filtre,
      select: { id: true, type: true },
    });
    for (const s of structures) {
      await this.rolesService.seedStructureDefaultRoles(s.id, s.type);
    }

    const sansRole = await this.prisma.user.findMany({
      where: { ...filtre, appRoleId: null },
      select: { id: true, role: true, structureId: true },
    });
    let rattaches = 0;
    for (const u of sansRole) {
      const appRoleId = await this.rolesService.resolveAssignableRoleId({
        legacyRole: u.role,
        structureId: u.structureId,
      });
      if (!appRoleId) continue;
      await this.prisma.user.update({
        where: { id: u.id },
        data: { appRoleId },
      });
      await this.permissionsService.invalidateUser(u.id);
      rattaches++;
    }
    if (rattaches > 0) {
      this.logger.log(
        `Rôles rattachés à ${rattaches} compte(s) de démonstration.`,
      );
    }
  }

  private async resoudreRole(legacyRole: string): Promise<string | null> {
    try {
      return await this.rolesService.resolveAssignableRoleId({ legacyRole });
    } catch {
      return null;
    }
  }

  // ─── Insertion (dans la transaction) ──────────────────────────

  private async inserer(
    tx: Prisma.TransactionClient,
    hashes: string[],
    rolesSysteme: RolesSysteme,
  ): Promise<void> {
    const chiffrer = (texte: string) => this.encryption.encrypt(texte);
    const maintenant = new Date();
    const jour = (decalage: number, heure = 10, minute = 0) => {
      const d = new Date(maintenant);
      d.setDate(d.getDate() + decalage);
      d.setHours(heure, minute, 0, 0);
      return d;
    };
    const ilYA = (minutes: number) =>
      new Date(maintenant.getTime() - minutes * MINUTE);

    // Identifiants générés ici : les createMany n'ont pas à relire la base.
    const idsStructures = new Map<CleStructure, string>(
      STRUCTURES_DEMO.map((s) => [s.cle, randomUUID()]),
    );
    const idsComptes = new Map<string, string>(
      COMPTES_DEMO.map((c) => [c.cle, randomUUID()]),
    );
    const structureId = (cle: CleStructure) => trouver(idsStructures, cle);
    const compteId = (cle: string) => trouver(idsComptes, cle);
    const compte = (cle: string): CompteDemoDef => {
      const c = COMPTES_DEMO.find((x) => x.cle === cle);
      if (!c) throw new Error(`Compte démo inconnu : ${cle}`);
      return c;
    };
    const nomStructure = (cle: CleStructure) =>
      STRUCTURES_DEMO.find((s) => s.cle === cle)?.nom ?? '';
    const nomMedecin = (cle: string) => {
      const m = compte(cle);
      return `Dr. ${m.prenom} ${m.nom}`;
    };

    // 1. Structures (l'administrateur est rattaché après la création des comptes)
    await tx.structure.createMany({
      data: STRUCTURES_DEMO.map((s) => ({
        id: structureId(s.cle),
        nom: s.nom,
        type: s.type,
        email: s.email,
        telephone: s.telephone,
        adresse: s.adresse,
        ville: s.ville,
        latitude: s.latitude,
        longitude: s.longitude,
        description: s.description,
        horaires: JSON.stringify(s.horaires),
        estDeGarde: s.estDeGarde,
        isActive: true,
        isConfigured: true,
      })),
    });

    // 2. Comptes : professionnels d'abord (cibles de `medecinTraitantId`), puis patients
    const versUtilisateur = (c: CompteDemoDef, i: number) => ({
      id: compteId(c.cle),
      email: c.email,
      password: hashes[i],
      nom: c.nom,
      prenom: c.prenom,
      telephone: c.telephone,
      role: c.role,
      isActive: true,
      specialite: c.specialite ?? null,
      structureId: c.structure ? structureId(c.structure) : null,
      dateNaissance: c.dateNaissance ? new Date(c.dateNaissance) : null,
      taille: c.taille ?? null,
      poids: c.poids ?? null,
      medecinTraitantId: c.medecinTraitant ? compteId(c.medecinTraitant) : null,
      appRoleId:
        c.role === 'PATIENT' || c.role === 'SUPER_ADMIN'
          ? rolesSysteme[c.role]
          : null,
    });
    const utilisateurs = COMPTES_DEMO.map(versUtilisateur);
    await tx.user.createMany({
      data: utilisateurs.filter((u) => u.role !== 'PATIENT'),
    });
    await tx.user.createMany({
      data: utilisateurs.filter((u) => u.role === 'PATIENT'),
    });

    for (const c of COMPTES_DEMO.filter((x) => x.adminDe)) {
      await tx.structure.update({
        where: { id: structureId(c.adminDe as CleStructure) },
        data: { adminId: compteId(c.cle) },
      });
    }

    // 3. Profils médicaux (champs sensibles chiffrés) et autorisations d'accès
    const patients = COMPTES_DEMO.filter((c) => c.role === 'PATIENT');
    await tx.profilMedical.createMany({
      data: patients
        .filter((p) => p.profil)
        .map((p) => {
          const profil = p.profil as NonNullable<CompteDemoDef['profil']>;
          return {
            userId: compteId(p.cle),
            groupeSanguin: profil.groupeSanguin,
            allergies: chiffrer(profil.allergies),
            pathologies: chiffrer(profil.pathologies),
            traitements: chiffrer(profil.traitements),
            taille: p.taille ?? null,
            poids: p.poids ?? null,
            dateNaissance: p.dateNaissance ? new Date(p.dateNaissance) : null,
            genre: profil.genre,
            contactNom: profil.contactNom,
            contactTelephone: profil.contactTelephone,
            contactEmail: profil.contactEmail ?? null,
          };
        }),
    });
    await tx.autorisationStructure.createMany({
      data: patients.flatMap((p) =>
        (p.autorisations ?? []).map((s) => ({
          patientId: compteId(p.cle),
          structureId: structureId(s),
        })),
      ),
    });

    // 4. Catalogue de médicaments (réutilisé s'il existe) et stocks des pharmacies
    const idsMedicaments = new Map<string, string>();
    for (const m of MEDICAMENTS_DEMO) {
      const existant = await tx.medicament.findFirst({
        where: { nom: m.nom },
        select: { id: true },
      });
      if (existant) {
        idsMedicaments.set(m.nom, existant.id);
        continue;
      }
      const id = randomUUID();
      await tx.medicament.create({ data: { id, ...m } });
      idsMedicaments.set(m.nom, id);
    }
    await tx.stockMedicament.createMany({
      data: STOCKS_DEMO.map((s) => ({
        medicamentId: trouver(idsMedicaments, s.medicament),
        structureId: structureId(s.pharmacie),
        quantite: s.quantite,
        prixUnitaire: s.prixUnitaire,
        disponible: s.quantite > 0,
        dateExpiration: jour(s.expirationJours, 0, 0),
        notes: s.notes ?? null,
      })),
    });

    // 5. Consultations et ordonnances (mêmes champs chiffrés que CarnetSanteService)
    for (const c of CONSULTATIONS_DEMO) {
      const consultationId = randomUUID();
      const date = jour(c.jours);
      await tx.consultation.create({
        data: {
          id: consultationId,
          patientId: compteId(c.patient),
          medecinId: compteId(c.medecin),
          structureId: structureId(c.structure),
          medecinNom: nomMedecin(c.medecin),
          motif: chiffrer(c.motif),
          diagnostic: chiffrer(c.diagnostic),
          notes: chiffrer(c.notes),
          dateConsultation: date,
        },
      });
      if (!c.ordonnance) continue;
      const lignes = c.ordonnance.lignes.map((l) => ({
        nom: l.nom,
        dosage: l.dosage,
        duree: l.duree,
        ...(l.instructions ? { instructions: l.instructions } : {}),
        ...(l.catalogue
          ? { medicamentId: trouver(idsMedicaments, l.nom) }
          : {}),
      }));
      await tx.ordonnance.create({
        data: {
          patientId: compteId(c.patient),
          medecinId: compteId(c.medecin),
          consultationId,
          medecinNom: nomMedecin(c.medecin),
          medicaments: chiffrer(JSON.stringify(lignes)),
          notes: chiffrer(c.ordonnance.notes),
          dateEmission: date,
          dateExpiration: jour(c.jours + c.ordonnance.validiteJours),
        },
      });
    }

    // 6. Résultats d'analyses, vaccinations, rendez-vous, auto-diagnostics IA
    await tx.resultatAnalyse.createMany({
      data: ANALYSES_DEMO.map((a) => ({
        patientId: compteId(a.patient),
        medecinId: a.medecin ? compteId(a.medecin) : null,
        typeAnalyse: chiffrer(a.typeAnalyse),
        laboratoire: chiffrer(a.laboratoire),
        resultats: chiffrer(a.resultats),
        dateAnalyse: jour(a.jours, 8, 0),
        notes: chiffrer(a.notes ?? ''),
      })),
    });

    await tx.vaccination.createMany({
      data: VACCINATIONS_DEMO.map((v) => {
        const medecin = v.medecin ? compte(v.medecin) : null;
        const administrePar =
          v.administrePar ??
          (medecin && v.medecin
            ? `${nomMedecin(v.medecin)}${medecin.structure ? ` (${nomStructure(medecin.structure)})` : ''}`
            : null);
        return {
          patientId: compteId(v.patient),
          medecinId: v.medecin ? compteId(v.medecin) : null,
          vaccin: chiffrer(v.vaccin),
          dateVaccin: jour(v.jours, 9, 0),
          prochainRappel:
            v.rappelJours !== undefined
              ? jour(v.jours + v.rappelJours, 9, 0)
              : null,
          lotNumero: v.lotNumero ?? null,
          administrePar,
          notes: chiffrer(v.notes ?? ''),
        };
      }),
    });

    await tx.rendezVous.createMany({
      data: RENDEZ_VOUS_DEMO.map((r) => ({
        patientId: compteId(r.patient),
        medecinId: r.medecin ? compteId(r.medecin) : null,
        structureId: structureId(r.structure),
        date: jour(r.jours, r.heure, r.minute),
        motif: r.motif,
        notes: r.notes ?? null,
        status: r.status,
      })),
    });

    await tx.autoDiagnostic.createMany({
      data: AUTO_DIAGNOSTICS_DEMO.map((d) => ({
        patientId: compteId(d.patient),
        symptomes: chiffrer(d.symptomes),
        // Même forme que la réponse du service IA (cf. AiService.predictMaladie)
        analyseia: JSON.stringify({
          maladie: d.maladie,
          reponse: d.reponse,
          confiance: d.confiance,
          certain: d.confiance >= 0.8,
        }),
        recommendation: chiffrer(d.reponse),
        createdAt: jour(d.jours, 20, 0),
      })),
    });

    // 7. Messagerie : conversations patient et médecin, patient et structure
    for (const conv of CONVERSATIONS_DEMO) {
      const conversationId = randomUUID();
      await tx.conversation.create({
        data: conv.medecin
          ? {
              id: conversationId,
              type: 'PRIVE',
              patientId: compteId(conv.patient),
              medecinId: compteId(conv.medecin),
            }
          : {
              id: conversationId,
              type: 'STRUCTURE',
              patientId: compteId(conv.patient),
              structureId: structureId(conv.structure as CleStructure),
            },
      });
      await tx.message.createMany({
        data: conv.messages.map((m) => ({
          conversationId,
          senderId: compteId(m.auteur),
          content: m.texte,
          lu: m.lu,
          createdAt: ilYA(m.minutes),
        })),
      });
    }

    // 8. Alertes SOS : lancée, prise en charge avec délai annoncé, terminée
    await tx.urgence.createMany({
      data: URGENCES_DEMO.map((u) => ({
        patientId: compteId(u.patient),
        latitude: u.latitude,
        longitude: u.longitude,
        message: u.message,
        status: u.status,
        createdAt: ilYA(u.minutes),
        structurePriseEnChargeId: u.priseEnCharge
          ? structureId(u.priseEnCharge.structure)
          : null,
        priseEnChargeParId: u.priseEnCharge
          ? compteId(u.priseEnCharge.par)
          : null,
        priseEnChargeAt: u.priseEnCharge
          ? ilYA(u.minutes - u.priseEnCharge.minutesApres)
          : null,
        delaiArriveeMinutes: u.priseEnCharge?.delaiArriveeMinutes ?? null,
      })),
    });

    // 9. Notifications lues et non lues
    await tx.notification.createMany({
      data: NOTIFICATIONS_DEMO.map((n) => ({
        userId: compteId(n.destinataire),
        type: n.type,
        titre: n.titre,
        message: n.message,
        lu: n.lu,
        lien: n.lien ?? null,
        createdAt: ilYA(n.minutes),
      })),
    });
  }
}

/** Lecture d'une table de correspondance du jeu de données (clé absente : erreur). */
function trouver<K>(table: Map<K, string>, cle: K): string {
  const valeur = table.get(cle);
  if (!valeur)
    throw new Error(`Clé du jeu de démonstration inconnue : ${String(cle)}`);
  return valeur;
}
