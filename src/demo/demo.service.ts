import { Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  estModeDemoActif,
  LIBELLES_ROLES,
  ORDRE_ROLES,
  SUFFIXE_EMAIL_DEMO,
} from './demo-mode';
import { COMPTES_DEMO, COMPTES_VITRINE } from './demo.donnees';

/** Compte proposé dans le sélecteur de la page de démonstration. */
export interface CompteDemo {
  id: string;
  email: string;
  nom: string;
  prenom: string;
  role: Role;
  roleLibelle: string;
  structureNom: string | null;
  description: string;
}

/** Description par défaut si un compte démo n'est plus dans le jeu de données. */
const DESCRIPTIONS_PAR_ROLE: Record<Role, string> = {
  PATIENT: 'Patient : carnet de santé, rendez-vous, messagerie et alerte SOS.',
  MEDECIN:
    'Médecin : consultations, ordonnances, rendez-vous et prise en charge SOS.',
  PHARMACIEN: 'Pharmacien : stocks, catalogue et messages des patients.',
  ACCUEIL: "Agent d'accueil : rendez-vous et messages adressés à la structure.",
  STRUCTURE_ADMIN:
    'Administrateur de structure : équipe, rôles et informations de la structure.',
  ADMIN: 'Administrateur de la plateforme.',
  SUPER_ADMIN:
    'Super administrateur : structures, utilisateurs et statistiques globales.',
};

@Injectable()
export class DemoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mode inactif : 404, comme si les routes démo n'existaient pas. */
  assurerModeActif(): void {
    if (!estModeDemoActif()) {
      throw new NotFoundException();
    }
  }

  /**
   * Comptes démo proposés sur la page de connexion : un par rôle (COMPTES_VITRINE),
   * triés par rôle puis par nom. Les autres comptes démo restent connectables.
   */
  async listerComptes() {
    this.assurerModeActif();

    const utilisateurs = await this.prisma.user.findMany({
      where: { email: { endsWith: SUFFIXE_EMAIL_DEMO }, isActive: true },
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        role: true,
        structure: { select: { nom: true } },
      },
    });

    const descriptions = new Map(
      COMPTES_DEMO.map((c) => [c.email, c.description]),
    );
    const rang = (role: Role) => ORDRE_ROLES.indexOf(role);

    const vitrine = new Set(COMPTES_VITRINE);
    const comptes: CompteDemo[] = utilisateurs
      .filter((u) => vitrine.has(u.email))
      .map((u) => ({
        id: u.id,
        email: u.email,
        nom: u.nom,
        prenom: u.prenom,
        role: u.role,
        roleLibelle: LIBELLES_ROLES[u.role],
        structureNom: u.structure?.nom ?? null,
        description: descriptions.get(u.email) ?? DESCRIPTIONS_PAR_ROLE[u.role],
      }))
      .sort(
        (a, b) =>
          rang(a.role) - rang(b.role) ||
          a.nom.localeCompare(b.nom, 'fr') ||
          a.prenom.localeCompare(b.prenom, 'fr'),
      );

    return {
      success: true,
      data: comptes,
      message: `${comptes.length} compte(s) de démonstration disponible(s)`,
    };
  }
}
