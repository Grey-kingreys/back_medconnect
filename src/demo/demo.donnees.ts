import type {
  AppointmentStatus,
  GroupeSanguin,
  NotificationType,
  Role,
  StructureType,
  UrgenceStatus,
} from 'generated/prisma/enums';
import { SUFFIXE_EMAIL_DEMO } from './demo-mode';

/**
 * Jeu de données du mode démo : structures, comptes et carnets de santé fictifs.
 *
 * Données pures, sans identifiant ni date absolue : le seeder (`demo.seeder.ts`)
 * génère les identifiants, convertit les décalages relatifs (jours, minutes) en
 * dates au moment du seed, et chiffre les champs médicaux comme les services.
 * Toute ressemblance avec des personnes réelles serait fortuite.
 */

/** Adresse email d'un compte ou d'une structure démo. */
const email = (local: string) => `${local}${SUFFIXE_EMAIL_DEMO}`;

/**
 * Comptes affichés sur la page de connexion : un seul par rôle, le plus riche en
 * données, tous liés entre eux autour de l'Hôpital National Donka quand c'est
 * possible (la patiente est suivie par le médecin, l'accueil et l'admin sont de
 * la même structure). Exception : l'administrateur de structure est proposé deux
 * fois (un hôpital, une pharmacie, pour tester l'annulation d'une vente). Les
 * autres comptes démo restent en base et utilisables.
 */
export const COMPTES_VITRINE: readonly string[] = [
  email('aminata.diallo'), // patiente : données dans toutes les catégories
  email('dr.mamadou.diallo'), // son médecin traitant, Donka
  email('ousmane.keita'), // pharmacie de garde, plus gros stock
  email('accueil.donka'), // accueil de Donka
  email('admin.donka'), // administrateur de Donka
  email('admin.kaloum'), // administratrice de la pharmacie de Kaloum : stock, ventes et annulation
  email('superadmin'),
];

// ─── Structures ─────────────────────────────────────────────────

export type CleStructure =
  | 'donka'
  | 'kindia'
  | 'fouta'
  | 'pharmaKaloum'
  | 'pharmaNiger';

export interface StructureDemo {
  cle: CleStructure;
  nom: string;
  type: StructureType;
  email: string;
  telephone: string;
  adresse: string;
  ville: string;
  latitude: number;
  longitude: number;
  description: string;
  /** Format lu par le front : jour en toutes lettres → « HH:MM-HH:MM » ou « Fermé ». */
  horaires: Record<string, string>;
  estDeGarde: boolean;
}

const JOURS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

const horaires = (
  semaine: string,
  samedi: string,
  dimanche: string,
): Record<string, string> =>
  Object.fromEntries(
    JOURS.map((jour) => [
      jour,
      jour === 'Samedi' ? samedi : jour === 'Dimanche' ? dimanche : semaine,
    ]),
  );

const H24 = horaires('00:00-23:59', '00:00-23:59', '00:00-23:59');

export const STRUCTURES_DEMO: StructureDemo[] = [
  {
    cle: 'donka',
    nom: 'Hôpital National Donka',
    type: 'HOPITAL',
    email: email('admin.donka'),
    telephone: '+224 622 10 20 30',
    adresse: 'Corniche Nord, Dixinn',
    ville: 'Conakry',
    latitude: 9.5371,
    longitude: -13.6795,
    description:
      'Centre hospitalier universitaire : urgences, cardiologie, pneumologie et laboratoire.',
    horaires: H24,
    estDeGarde: false,
  },
  {
    cle: 'kindia',
    nom: 'Hôpital Régional de Kindia',
    type: 'HOPITAL',
    email: email('admin.kindia'),
    telephone: '+224 628 40 50 60',
    adresse: 'Quartier Abattoir, route nationale 1',
    ville: 'Kindia',
    latitude: 10.0569,
    longitude: -12.8658,
    description:
      'Hôpital régional : médecine générale, maternité, laboratoire et urgences.',
    horaires: H24,
    estDeGarde: false,
  },
  {
    cle: 'fouta',
    nom: 'Clinique du Fouta',
    type: 'CLINIQUE',
    email: email('admin.fouta'),
    telephone: '+224 624 70 80 90',
    adresse: 'Quartier Kouroula, près du grand marché',
    ville: 'Labé',
    latitude: 11.3182,
    longitude: -12.2833,
    description:
      'Clinique privée : suivi du diabète, médecine interne et consultations sur rendez-vous.',
    horaires: horaires('08:00-20:00', '08:00-14:00', 'Fermé'),
    estDeGarde: false,
  },
  {
    cle: 'pharmaKaloum',
    nom: 'Pharmacie de Kaloum',
    type: 'PHARMACIE',
    email: email('admin.kaloum'),
    telephone: '+224 621 33 44 55',
    adresse: 'Avenue de la République, Kaloum',
    ville: 'Conakry',
    latitude: 9.5092,
    longitude: -13.7122,
    description: 'Pharmacie de garde cette semaine, ouverte jour et nuit.',
    horaires: horaires('08:00-21:00', '08:00-21:00', '09:00-13:00'),
    estDeGarde: true,
  },
  {
    cle: 'pharmaNiger',
    nom: 'Pharmacie du Niger',
    type: 'PHARMACIE',
    email: email('admin.niger'),
    telephone: '+224 625 66 77 88',
    adresse: 'Quartier Salamani, bord du fleuve',
    ville: 'Kankan',
    latitude: 10.3854,
    longitude: -9.3057,
    description:
      'Pharmacie de quartier, conseils et préparation des ordonnances.',
    horaires: horaires('08:00-20:00', '08:00-20:00', 'Fermé'),
    estDeGarde: false,
  },
];

// ─── Comptes ────────────────────────────────────────────────────

export interface ProfilMedicalDemo {
  groupeSanguin: GroupeSanguin;
  allergies: string;
  pathologies: string;
  traitements: string;
  genre: 'M' | 'F';
  contactNom: string;
  contactTelephone: string;
  /** Email du proche (optionnel). */
  contactEmail?: string;
}

export interface CompteDemoDef {
  /** Clé interne du jeu de données (référencée par le carnet, la messagerie...). */
  cle: string;
  email: string;
  nom: string;
  prenom: string;
  role: Role;
  telephone: string;
  /** Structure d'appartenance (soignants, accueil, administrateurs). */
  structure?: CleStructure;
  /** Structure dont ce compte est l'administrateur. */
  adminDe?: CleStructure;
  specialite?: string;
  /** Phrase affichée dans le sélecteur : ce qu'on peut tester avec ce compte. */
  description: string;
  // Champs propres aux patients
  dateNaissance?: string;
  taille?: number;
  poids?: number;
  profil?: ProfilMedicalDemo;
  medecinTraitant?: string;
  autorisations?: CleStructure[];
}

export const COMPTES_DEMO: CompteDemoDef[] = [
  // Super administrateur
  {
    cle: 'superAdmin',
    email: email('superadmin'),
    nom: 'Barry',
    prenom: 'Thierno',
    role: 'SUPER_ADMIN',
    telephone: '+224 620 00 00 01',
    description:
      'Super administrateur de la plateforme : structures, invitations, utilisateurs et statistiques globales.',
  },
  // Administrateurs de structure
  {
    cle: 'adminDonka',
    email: email('admin.donka'),
    nom: 'Kouyaté',
    prenom: 'Lansana',
    role: 'STRUCTURE_ADMIN',
    telephone: '+224 622 10 20 31',
    structure: 'donka',
    adminDe: 'donka',
    description:
      "Administrateur de l'Hôpital National Donka : équipe, rôles et permissions, informations de la structure.",
  },
  {
    cle: 'adminKindia',
    email: email('admin.kindia'),
    nom: 'Touré',
    prenom: 'Mariame',
    role: 'STRUCTURE_ADMIN',
    telephone: '+224 628 40 50 61',
    structure: 'kindia',
    adminDe: 'kindia',
    description:
      "Administratrice de l'Hôpital Régional de Kindia : gestion de l'équipe et des horaires.",
  },
  {
    cle: 'adminFouta',
    email: email('admin.fouta'),
    nom: 'Diallo',
    prenom: 'Boubacar',
    role: 'STRUCTURE_ADMIN',
    telephone: '+224 624 70 80 91',
    structure: 'fouta',
    adminDe: 'fouta',
    description:
      'Administrateur de la Clinique du Fouta : équipe, rôles personnalisés et fiche de la clinique.',
  },
  {
    cle: 'adminKaloum',
    email: email('admin.kaloum'),
    nom: 'Baldé',
    prenom: 'Djénabou',
    role: 'STRUCTURE_ADMIN',
    telephone: '+224 621 33 44 56',
    structure: 'pharmaKaloum',
    adminDe: 'pharmaKaloum',
    description:
      "Administratrice de la Pharmacie de Kaloum (de garde) : stock, ventes du jour, annulation d'une vente, équipe et horaires.",
  },
  {
    cle: 'adminNiger',
    email: email('admin.niger'),
    nom: 'Kanté',
    prenom: 'Moussa',
    role: 'STRUCTURE_ADMIN',
    telephone: '+224 625 66 77 89',
    structure: 'pharmaNiger',
    adminDe: 'pharmaNiger',
    description:
      'Administrateur de la Pharmacie du Niger : équipe et informations de la pharmacie.',
  },
  // Médecins
  {
    cle: 'drDiallo',
    email: email('dr.mamadou.diallo'),
    nom: 'Diallo',
    prenom: 'Mamadou',
    role: 'MEDECIN',
    telephone: '+224 622 41 52 63',
    structure: 'donka',
    specialite: 'Cardiologie',
    description:
      "Cardiologue à l'Hôpital National Donka : patients suivis, consultations, ordonnances, rendez-vous et prise en charge SOS.",
  },
  {
    cle: 'drCamara',
    email: email('dr.fatoumata.camara'),
    nom: 'Camara',
    prenom: 'Fatoumata',
    role: 'MEDECIN',
    telephone: '+224 622 74 85 96',
    structure: 'donka',
    specialite: 'Pneumologie',
    description:
      "Pneumologue à l'Hôpital National Donka : alerte SOS en cours de prise en charge, rendez-vous en attente de validation.",
  },
  {
    cle: 'drSoumah',
    email: email('dr.ibrahima.soumah'),
    nom: 'Soumah',
    prenom: 'Ibrahima',
    role: 'MEDECIN',
    telephone: '+224 628 12 23 34',
    structure: 'kindia',
    specialite: 'Médecine générale',
    description:
      "Médecin généraliste à l'Hôpital Régional de Kindia : carnets partagés, analyses, vaccinations et messagerie patient.",
  },
  {
    cle: 'drBah',
    email: email('dr.aissatou.bah'),
    nom: 'Bah',
    prenom: 'Aïssatou',
    role: 'MEDECIN',
    telephone: '+224 624 45 56 67',
    structure: 'fouta',
    specialite: 'Diabétologie',
    description:
      'Diabétologue à la Clinique du Fouta : suivi du diabète, ordonnances et réponse aux demandes de rendez-vous.',
  },
  {
    cle: 'drConde',
    email: email('dr.nene.conde'),
    nom: 'Condé',
    prenom: 'Néné',
    role: 'MEDECIN',
    telephone: '+224 622 36 47 58',
    structure: 'donka',
    specialite: 'Gynécologie',
    description:
      "Gynécologue à l'Hôpital National Donka : suivi gynécologique, ordonnances et demande de rendez-vous à valider.",
  },
  // Accueil
  {
    cle: 'accueilDonka',
    email: email('accueil.donka'),
    nom: 'Sylla',
    prenom: 'Mariama',
    role: 'ACCUEIL',
    telephone: '+224 622 98 87 76',
    structure: 'donka',
    description:
      "Agent d'accueil à l'Hôpital National Donka : prise de rendez-vous et messages adressés à la structure, sans accès au carnet.",
  },
  // Pharmaciens
  {
    cle: 'pharmaKeita',
    email: email('ousmane.keita'),
    nom: 'Keita',
    prenom: 'Ousmane',
    role: 'PHARMACIEN',
    telephone: '+224 621 55 66 77',
    structure: 'pharmaKaloum',
    description:
      'Pharmacien à la Pharmacie de Kaloum (de garde) : stocks, ruptures, alertes de stock faible et catalogue.',
  },
  {
    cle: 'pharmaKourouma',
    email: email('kadiatou.kourouma'),
    nom: 'Kourouma',
    prenom: 'Kadiatou',
    role: 'PHARMACIEN',
    telephone: '+224 625 11 22 33',
    structure: 'pharmaNiger',
    description:
      'Pharmacienne à la Pharmacie du Niger : stocks et réponses aux messages des patients.',
  },
  // Patients
  {
    cle: 'aminata',
    email: email('aminata.diallo'),
    nom: 'Diallo',
    prenom: 'Aminata',
    role: 'PATIENT',
    telephone: '+224 622 34 56 78',
    dateNaissance: '1986-04-12',
    taille: 164,
    poids: 68,
    profil: {
      groupeSanguin: 'O_POSITIF',
      allergies:
        'Pénicilline et dérivés (éruption cutanée en 2015) : amoxicilline et Augmentin contre-indiqués',
      pathologies:
        'Hypertension artérielle depuis 2019 ; extrasystoles bénignes ; glycémie limite (HbA1c à 5,9 %) ; paludisme simple traité il y a 2 ans. Antécédents familiaux : mère diabétique de type 2, père hypertendu.',
      traitements:
        "Amlodipine 5 mg, un comprimé le matin ; vitamine D3 1000 UI par jour jusqu'à la fin de la cure",
      genre: 'F',
      contactNom: 'Ibrahima Diallo (époux)',
      contactTelephone: '+224 622 11 22 33',
      contactEmail: email('proche.aminata'),
    },
    medecinTraitant: 'drDiallo',
    autorisations: ['donka', 'kindia', 'fouta'],
    description:
      'Patiente suivie depuis 3 ans par un cardiologue : 9 consultations dans 3 structures, ordonnances, analyses, vaccins, rendez-vous, alertes SOS et messagerie.',
  },
  {
    cle: 'mohamed',
    email: email('mohamed.camara'),
    nom: 'Camara',
    prenom: 'Mohamed',
    role: 'PATIENT',
    telephone: '+224 628 98 76 54',
    dateNaissance: '1994-09-03',
    taille: 178,
    poids: 72,
    profil: {
      groupeSanguin: 'A_POSITIF',
      allergies: 'Aucune allergie connue',
      pathologies: "Asthme depuis l'enfance",
      traitements: 'Ventoline 100 µg en cas de crise',
      genre: 'M',
      contactNom: 'Mariame Camara (mère)',
      contactTelephone: '+224 628 44 55 66',
    },
    autorisations: ['donka'],
    description:
      "Patient asthmatique : alerte SOS prise en charge avec délai d'arrivée, rendez-vous en attente et échange avec l'accueil.",
  },
  {
    cle: 'hawa',
    email: email('hawa.bangoura'),
    nom: 'Bangoura',
    prenom: 'Hawa',
    role: 'PATIENT',
    telephone: '+224 621 23 45 67',
    dateNaissance: '1992-01-25',
    taille: 160,
    poids: 59,
    profil: {
      groupeSanguin: 'B_POSITIF',
      allergies: 'Arachides',
      pathologies: 'Diabète gestationnel en 2023, résolu',
      traitements: 'Aucun traitement en cours',
      genre: 'F',
      contactNom: 'Sékou Bangoura (frère)',
      contactTelephone: '+224 621 77 88 99',
    },
    medecinTraitant: 'drSoumah',
    description:
      "Patiente de Kindia : paludisme traité, résultats d'analyses, vaccinations avec rappel et messagerie avec son médecin.",
  },
  {
    cle: 'abdoulaye',
    email: email('abdoulaye.barry'),
    nom: 'Barry',
    prenom: 'Abdoulaye',
    role: 'PATIENT',
    telephone: '+224 624 87 65 43',
    dateNaissance: '1958-11-08',
    taille: 172,
    poids: 84,
    profil: {
      groupeSanguin: 'AB_POSITIF',
      allergies: 'Sulfamides',
      pathologies: 'Diabète de type 2, arthrose du genou',
      traitements: 'Metformine 850 mg matin et soir',
      genre: 'M',
      contactNom: 'Oumou Barry (fille)',
      contactTelephone: '+224 624 12 34 56',
    },
    autorisations: ['fouta'],
    description:
      'Patient diabétique de Labé : dossier partagé avec la Clinique du Fouta, demande de rendez-vous refusée.',
  },
  {
    cle: 'fanta',
    email: email('fanta.kaba'),
    nom: 'Kaba',
    prenom: 'Fanta',
    role: 'PATIENT',
    telephone: '+224 625 43 21 09',
    dateNaissance: '2000-06-17',
    taille: 166,
    poids: 55,
    profil: {
      groupeSanguin: 'O_NEGATIF',
      allergies: 'Aucune allergie connue',
      pathologies: 'Drépanocytose (forme SC)',
      traitements: 'Acide folique 5 mg par jour',
      genre: 'F',
      contactNom: 'Nfaly Kaba (père)',
      contactTelephone: '+224 625 98 76 54',
    },
    description:
      'Patiente de Kankan sans médecin traitant : alerte SOS lancée, auto-diagnostic IA et échange avec une pharmacie.',
  },
  {
    cle: 'saliou',
    email: email('saliou.sow'),
    nom: 'Sow',
    prenom: 'Saliou',
    role: 'PATIENT',
    telephone: '+224 622 65 43 21',
    dateNaissance: '1979-03-30',
    taille: 175,
    poids: 79,
    profil: {
      groupeSanguin: 'A_NEGATIF',
      allergies: 'Aspirine',
      pathologies: 'Ulcère gastrique en 2021',
      traitements: 'Aucun traitement en cours',
      genre: 'M',
      contactNom: 'Kadidiatou Sow (épouse)',
      contactTelephone: '+224 622 54 32 10',
    },
    medecinTraitant: 'drDiallo',
    autorisations: ['kindia'],
    description:
      'Patient suivi à Conakry et soigné à Kindia : carnet portable entre deux structures, rendez-vous programmé.',
  },
];

// ─── Catalogue de médicaments ───────────────────────────────────

export interface MedicamentDemo {
  nom: string;
  nomGenerique: string;
  categorie: string;
  description: string;
  ordonnanceRequise: boolean;
  formes: string[];
}

/** Réutilisés s'ils existent déjà en base (recherche par nom), créés sinon. */
export const MEDICAMENTS_DEMO: MedicamentDemo[] = [
  {
    nom: 'Doliprane 1000mg',
    nomGenerique: 'Paracétamol',
    categorie: 'Antalgique',
    description: 'Soulage la douleur et fait baisser la fièvre.',
    ordonnanceRequise: false,
    formes: ['Comprimé'],
  },
  {
    nom: 'Augmentin 1g/125mg',
    nomGenerique: 'Amoxicilline et acide clavulanique',
    categorie: 'Antibiotique',
    description: 'Antibiotique pour les infections bactériennes courantes.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'Coartem 20/120',
    nomGenerique: 'Artéméther et luméfantrine',
    categorie: 'Antipaludéen',
    description: 'Traitement du paludisme simple.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'Ventoline 100 µg',
    nomGenerique: 'Salbutamol',
    categorie: 'Bronchodilatateur',
    description: "Soulage rapidement la crise d'asthme.",
    ordonnanceRequise: true,
    formes: ['Inhalation'],
  },
  {
    nom: 'Amlor 5mg',
    nomGenerique: 'Amlodipine',
    categorie: 'Antihypertenseur',
    description: "Traitement de l'hypertension artérielle.",
    ordonnanceRequise: true,
    formes: ['Gélule'],
  },
  {
    nom: 'Glucophage 850mg',
    nomGenerique: 'Metformine',
    categorie: 'Antidiabétique',
    description: 'Traitement du diabète de type 2.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'Spasfon',
    nomGenerique: 'Phloroglucinol',
    categorie: 'Antispasmodique',
    description: 'Soulage les douleurs abdominales.',
    ordonnanceRequise: false,
    formes: ['Comprimé'],
  },
  {
    nom: 'Gaviscon Pro',
    nomGenerique: 'Alginate de sodium et bicarbonate de potassium',
    categorie: 'Anti-acide',
    description: "Soulage les brûlures d'estomac.",
    ordonnanceRequise: false,
    formes: ['Suspension buvable'],
  },
  {
    nom: 'Flagyl 500mg',
    nomGenerique: 'Métronidazole',
    categorie: 'Antiparasitaire',
    description: 'Traitement des amibiases et de certaines infections.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'SRO',
    nomGenerique: 'Sels de réhydratation orale',
    categorie: 'Réhydratation',
    description: 'Compense les pertes en eau et en sels en cas de diarrhée.',
    ordonnanceRequise: false,
    formes: ['Sachet'],
  },
  {
    nom: 'Amoxicilline 500mg',
    nomGenerique: 'Amoxicilline',
    categorie: 'Antibiotique',
    description: 'Antibiotique de la famille des pénicillines.',
    ordonnanceRequise: true,
    formes: ['Gélule'],
  },
  {
    nom: 'Ibuprofène 400mg',
    nomGenerique: 'Ibuprofène',
    categorie: 'Anti-inflammatoire',
    description: "Soulage la douleur et l'inflammation.",
    ordonnanceRequise: false,
    formes: ['Comprimé'],
  },
];

export interface StockDemo {
  pharmacie: CleStructure;
  medicament: string;
  quantite: number;
  prixUnitaire: number;
  /** Décalage en jours de la date d'expiration. */
  expirationJours: number;
  notes?: string;
}

export const STOCKS_DEMO: StockDemo[] = [
  // Pharmacie de Kaloum : une rupture (Ventoline) et un stock faible (Amlor)
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Doliprane 1000mg',
    quantite: 240,
    prixUnitaire: 15000,
    expirationJours: 540,
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Augmentin 1g/125mg',
    quantite: 35,
    prixUnitaire: 85000,
    expirationJours: 300,
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Coartem 20/120',
    quantite: 60,
    prixUnitaire: 45000,
    expirationJours: 420,
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Ventoline 100 µg',
    quantite: 0,
    prixUnitaire: 60000,
    expirationJours: 365,
    notes: 'Livraison attendue la semaine prochaine',
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Amlor 5mg',
    quantite: 6,
    prixUnitaire: 35000,
    expirationJours: 200,
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Glucophage 850mg',
    quantite: 120,
    prixUnitaire: 25000,
    expirationJours: 480,
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'SRO',
    quantite: 300,
    prixUnitaire: 3000,
    expirationJours: 700,
  },
  {
    pharmacie: 'pharmaKaloum',
    medicament: 'Flagyl 500mg',
    quantite: 80,
    prixUnitaire: 20000,
    expirationJours: 260,
  },
  // Pharmacie du Niger : une rupture (Gaviscon) et un stock faible (Coartem)
  {
    pharmacie: 'pharmaNiger',
    medicament: 'Doliprane 1000mg',
    quantite: 140,
    prixUnitaire: 15000,
    expirationJours: 500,
  },
  {
    pharmacie: 'pharmaNiger',
    medicament: 'Coartem 20/120',
    quantite: 4,
    prixUnitaire: 47000,
    expirationJours: 330,
  },
  {
    pharmacie: 'pharmaNiger',
    medicament: 'Spasfon',
    quantite: 60,
    prixUnitaire: 18000,
    expirationJours: 400,
  },
  {
    pharmacie: 'pharmaNiger',
    medicament: 'Gaviscon Pro',
    quantite: 0,
    prixUnitaire: 40000,
    expirationJours: 365,
  },
  {
    pharmacie: 'pharmaNiger',
    medicament: 'Amoxicilline 500mg',
    quantite: 90,
    prixUnitaire: 22000,
    expirationJours: 310,
  },
  {
    pharmacie: 'pharmaNiger',
    medicament: 'Ibuprofène 400mg',
    quantite: 75,
    prixUnitaire: 12000,
    expirationJours: 450,
  },
];

// ─── Carnet de santé ────────────────────────────────────────────

export interface LigneOrdonnanceDemo {
  nom: string;
  dosage: string;
  duree: string;
  instructions?: string;
  /** Vrai : la ligne est liée au catalogue (`medicamentId`). Faux : saisie libre. */
  catalogue: boolean;
}

export interface ConsultationDemo {
  patient: string;
  medecin: string;
  structure: CleStructure;
  jours: number;
  motif: string;
  diagnostic: string;
  notes: string;
  ordonnance?: {
    lignes: LigneOrdonnanceDemo[];
    notes: string;
    validiteJours: number;
  };
}

export const CONSULTATIONS_DEMO: ConsultationDemo[] = [
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: -60,
    motif: 'Contrôle de la tension artérielle',
    diagnostic: 'Hypertension artérielle stade 1, équilibrée sous traitement',
    notes: 'Tension à 135/85. Poursuivre le traitement et réduire le sel.',
    ordonnance: {
      lignes: [
        {
          nom: 'Amlor 5mg',
          dosage: '1 gélule le matin',
          duree: '3 mois',
          catalogue: true,
        },
        {
          nom: 'Vitamine D3 1000 UI',
          dosage: '1 capsule par jour',
          duree: '2 mois',
          instructions: 'À prendre pendant le repas',
          catalogue: false,
        },
      ],
      notes: 'Renouvelable une fois.',
      validiteJours: 90,
    },
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: -10,
    motif: 'Palpitations et fatigue',
    diagnostic: 'Extrasystoles bénignes, bilan biologique demandé',
    notes: 'Électrocardiogramme normal. Revoir avec les résultats du bilan.',
  },
  // Histoire d'Aminata sur 3 ans : suivi de l'hypertension à Donka, paludisme
  // aux urgences, anémie corrigée, infection urinaire à Kindia, glycémie limite
  // découverte à Labé. Allergie à la pénicilline : aucune prescription de cette famille.
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: -1080,
    motif: 'Bilan cardiologique annuel',
    diagnostic:
      'Hypertension artérielle stade 1 connue depuis 2019, bien contrôlée',
    notes:
      'Tension à 132/84. Pas de retentissement cardiaque. Créatinine et ionogramme normaux. Poursuivre la marche quotidienne et limiter le sel.',
    ordonnance: {
      lignes: [
        {
          nom: 'Amlor 5mg',
          dosage: '1 gélule le matin',
          duree: '6 mois',
          catalogue: true,
        },
        {
          nom: 'Tensiomètre électronique de bras',
          dosage: 'Automesure matin et soir, 3 jours avant chaque consultation',
          duree: 'Au long cours',
          instructions: 'Noter les chiffres dans un carnet',
          catalogue: false,
        },
      ],
      notes: 'Renouvelable une fois.',
      validiteJours: 180,
    },
  },
  {
    patient: 'aminata',
    medecin: 'drCamara',
    structure: 'donka',
    jours: -720,
    motif: 'Fièvre à 39,5 °C, frissons et vomissements (urgences)',
    diagnostic:
      'Paludisme simple à Plasmodium falciparum, confirmé par test rapide',
    notes:
      'Vue aux urgences de Donka (garde de médecine). Pas de signe de gravité. Retour à domicile avec traitement oral et hydratation. Contrôle dans 15 jours.',
    ordonnance: {
      lignes: [
        {
          nom: 'Coartem 20/120',
          dosage: '4 comprimés à H0, H8, puis matin et soir',
          duree: '3 jours',
          instructions: 'Avec un repas gras ou du lait',
          catalogue: true,
        },
        {
          nom: 'Doliprane 1000mg',
          dosage: '1 comprimé toutes les 6 heures si fièvre',
          duree: '5 jours',
          catalogue: true,
        },
        {
          nom: 'SRO',
          dosage: "1 sachet dans 1 litre d'eau, à boire dans la journée",
          duree: '3 jours',
          catalogue: true,
        },
      ],
      notes: 'Revenir immédiatement si vomissements répétés ou confusion.',
      validiteJours: 15,
    },
  },
  {
    patient: 'aminata',
    medecin: 'drCamara',
    structure: 'donka',
    jours: -705,
    motif: 'Contrôle après paludisme',
    diagnostic: 'Paludisme guéri, anémie légère post-infectieuse',
    notes:
      'Apyrétique depuis 10 jours. Test rapide de contrôle négatif. Hémoglobine à 10,9 g/dL : avis gynécologique conseillé pour le bilan martial.',
  },
  {
    patient: 'aminata',
    medecin: 'drConde',
    structure: 'donka',
    jours: -540,
    motif: 'Consultation gynécologique annuelle et fatigue',
    diagnostic:
      'Examen gynécologique normal, anémie ferriprive par règles abondantes',
    notes:
      'Frottis cervico-utérin normal. Ferritine basse. Supplémentation en fer pendant 3 mois puis contrôle de la numération.',
    ordonnance: {
      lignes: [
        {
          nom: 'Fumarate ferreux et acide folique',
          dosage: '1 comprimé par jour',
          duree: '3 mois',
          instructions:
            'À prendre à distance du thé et du café ; selles noires sans gravité',
          catalogue: false,
        },
      ],
      notes: 'Contrôle de la numération formule sanguine dans 3 mois.',
      validiteJours: 90,
    },
  },
  {
    patient: 'aminata',
    medecin: 'drSoumah',
    structure: 'kindia',
    jours: -400,
    motif: "Brûlures en urinant depuis 2 jours, lors d'un déplacement",
    diagnostic: 'Cystite aiguë simple à Escherichia coli',
    notes:
      'Patiente de passage à Kindia, dossier consulté via MedConnecte. Allergie à la pénicilline relevée dans le carnet : traitement en dose unique adapté. Bandelette urinaire positive, ECBU envoyé.',
    ordonnance: {
      lignes: [
        {
          nom: 'Fosfomycine trométamol 3 g',
          dosage: '1 sachet en une seule prise, le soir au coucher',
          duree: 'Dose unique',
          instructions: 'Vessie vide, à distance du repas',
          catalogue: false,
        },
        {
          nom: 'Doliprane 1000mg',
          dosage: '1 comprimé si douleur',
          duree: '3 jours',
          catalogue: true,
        },
      ],
      notes: "Boire au moins 1,5 litre d'eau par jour.",
      validiteJours: 15,
    },
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: -300,
    motif: 'Suivi de la tension artérielle',
    diagnostic: 'Hypertension artérielle stade 1, équilibrée',
    notes:
      'Tension à 138/86, automesures correctes. Rappel du vaccin tétanos, diphtérie, poliomyélite fait le jour même.',
    ordonnance: {
      lignes: [
        {
          nom: 'Amlor 5mg',
          dosage: '1 gélule le matin',
          duree: '6 mois',
          catalogue: true,
        },
      ],
      notes: 'Renouvelable une fois.',
      validiteJours: 180,
    },
  },
  {
    patient: 'aminata',
    medecin: 'drBah',
    structure: 'fouta',
    jours: -180,
    motif: 'Soif et fatigue pendant une visite familiale à Labé',
    diagnostic: 'Glycémie limite (prédiabète), pas de diabète',
    notes:
      "Mère diabétique de type 2. Glycémie à jeun 1,08 g/L, HbA1c 5,9 %. Conseils alimentaires (moins de riz blanc et de boissons sucrées), activité physique. Contrôle de l'HbA1c dans 6 mois.",
  },
  {
    patient: 'mohamed',
    medecin: 'drCamara',
    structure: 'donka',
    jours: -20,
    motif: "Crises d'asthme nocturnes",
    diagnostic: 'Asthme partiellement contrôlé',
    notes: "Revoir la technique d'inhalation. Éviter la fumée de charbon.",
    ordonnance: {
      lignes: [
        {
          nom: 'Ventoline 100 µg',
          dosage: '2 bouffées en cas de gêne respiratoire',
          duree: '3 mois',
          catalogue: true,
        },
        {
          nom: 'Prednisolone 20 mg',
          dosage: '2 comprimés le matin',
          duree: '5 jours',
          instructions: 'Ne pas arrêter avant la fin du traitement',
          catalogue: false,
        },
      ],
      notes: 'Consulter en urgence si la Ventoline ne soulage plus.',
      validiteJours: 90,
    },
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    structure: 'kindia',
    jours: -30,
    motif: 'Fièvre et courbatures depuis 48 heures',
    diagnostic: 'Paludisme simple confirmé par test rapide',
    notes: 'Bien boire, dormir sous moustiquaire imprégnée.',
    ordonnance: {
      lignes: [
        {
          nom: 'Coartem 20/120',
          dosage: '4 comprimés matin et soir',
          duree: '3 jours',
          instructions: 'Avec un repas ou du lait',
          catalogue: true,
        },
        {
          nom: 'Doliprane 1000mg',
          dosage: '1 comprimé si fièvre',
          duree: '5 jours',
          catalogue: true,
        },
      ],
      notes: 'Revenir si la fièvre persiste après 3 jours.',
      validiteJours: 30,
    },
  },
  {
    patient: 'abdoulaye',
    medecin: 'drBah',
    structure: 'fouta',
    jours: -45,
    motif: 'Suivi du diabète',
    diagnostic: 'Diabète de type 2 déséquilibré (HbA1c à 8,1 %)',
    notes: 'Renforcer le régime alimentaire, marche quotidienne de 30 minutes.',
    ordonnance: {
      lignes: [
        {
          nom: 'Glucophage 850mg',
          dosage: '1 comprimé matin et soir',
          duree: '3 mois',
          instructions: 'En fin de repas',
          catalogue: true,
        },
      ],
      notes: 'Contrôle de la glycémie à jeun chaque semaine.',
      validiteJours: 90,
    },
  },
  {
    patient: 'saliou',
    medecin: 'drSoumah',
    structure: 'kindia',
    jours: -15,
    motif: "Brûlures d'estomac après les repas",
    diagnostic: 'Gastrite aiguë',
    notes: "Éviter les plats très épicés et l'aspirine (allergie connue).",
    ordonnance: {
      lignes: [
        {
          nom: 'Gaviscon Pro',
          dosage: '1 sachet après chaque repas',
          duree: '15 jours',
          catalogue: true,
        },
        {
          nom: 'Spasfon',
          dosage: '2 comprimés si douleur',
          duree: '7 jours',
          catalogue: true,
        },
      ],
      notes: '',
      validiteJours: 30,
    },
  },
];

export interface AnalyseDemo {
  patient: string;
  medecin?: string;
  jours: number;
  typeAnalyse: string;
  laboratoire: string;
  resultats: string;
  notes?: string;
}

export const ANALYSES_DEMO: AnalyseDemo[] = [
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -8,
    typeAnalyse: 'Bilan lipidique et ionogramme',
    laboratoire: "Laboratoire de l'Hôpital National Donka",
    resultats:
      'Cholestérol total 2,1 g/L ; LDL 1,3 g/L ; potassium 4,2 mmol/L : valeurs dans les normes.',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -1081,
    typeAnalyse: 'Créatinine, ionogramme et glycémie à jeun',
    laboratoire: "Laboratoire de l'Hôpital National Donka",
    resultats:
      'Créatinine 7,8 mg/L (DFG estimé 98 mL/min) ; sodium 139 mmol/L ; potassium 4,0 mmol/L ; glycémie à jeun 0,98 g/L : valeurs normales.',
    notes: "Bilan annuel de l'hypertension.",
  },
  {
    patient: 'aminata',
    medecin: 'drCamara',
    jours: -720,
    typeAnalyse: 'Test de diagnostic rapide du paludisme',
    laboratoire: "Laboratoire de l'Hôpital National Donka",
    resultats: 'Positif à Plasmodium falciparum.',
    notes: 'Réalisé aux urgences.',
  },
  {
    patient: 'aminata',
    medecin: 'drCamara',
    jours: -705,
    typeAnalyse: 'Goutte épaisse de contrôle et numération formule sanguine',
    laboratoire: "Laboratoire de l'Hôpital National Donka",
    resultats:
      'Goutte épaisse négative. Hémoglobine 10,9 g/dL ; VGM 76 fL ; leucocytes 5 800/mm3 ; plaquettes 210 000/mm3.',
    notes: 'Guérison du paludisme, anémie légère microcytaire.',
  },
  {
    patient: 'aminata',
    medecin: 'drSoumah',
    jours: -400,
    typeAnalyse: 'Examen cytobactériologique des urines (ECBU)',
    laboratoire: "Laboratoire de l'Hôpital Régional de Kindia",
    resultats:
      'Leucocyturie 85 000/mL ; Escherichia coli 10^5 UFC/mL, sensible à la fosfomycine, à la nitrofurantoïne et au cotrimoxazole.',
    notes:
      'Traitement adapté, pas de contrôle nécessaire si les signes disparaissent.',
  },
  {
    patient: 'aminata',
    medecin: 'drBah',
    jours: -181,
    typeAnalyse: 'Glycémie à jeun et hémoglobine glyquée (HbA1c)',
    laboratoire: 'Laboratoire de la Clinique du Fouta',
    resultats:
      'Glycémie à jeun 1,08 g/L (normale inférieure à 1,10) ; HbA1c 5,9 % (zone de prédiabète entre 5,7 et 6,4 %).',
    notes: 'À recontrôler dans 6 mois.',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -9,
    typeAnalyse: 'Électrocardiogramme et échographie cardiaque',
    laboratoire: "Service de cardiologie de l'Hôpital National Donka",
    resultats:
      "ECG : rythme sinusal à 74/min, extrasystoles auriculaires isolées, pas de trouble de conduction. Échographie : fraction d'éjection 62 %, hypertrophie ventriculaire gauche minime, valves normales.",
    notes: "Retentissement modéré de l'hypertension, sans gravité.",
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    jours: -30,
    typeAnalyse: 'Test de diagnostic rapide du paludisme',
    laboratoire: "Laboratoire de l'Hôpital Régional de Kindia",
    resultats: 'Positif à Plasmodium falciparum.',
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    jours: -2,
    typeAnalyse: 'Numération formule sanguine',
    laboratoire: "Laboratoire de l'Hôpital Régional de Kindia",
    resultats:
      'Hémoglobine 11,8 g/dL ; leucocytes 6 200/mm3 : contrôle satisfaisant.',
    notes: 'Légère anémie en cours de correction.',
  },
  {
    patient: 'abdoulaye',
    medecin: 'drBah',
    jours: -46,
    typeAnalyse: 'Hémoglobine glyquée (HbA1c)',
    laboratoire: 'Laboratoire de la Clinique du Fouta',
    resultats: 'HbA1c à 8,1 % (objectif inférieur à 7 %).',
  },
];

export interface VaccinationDemo {
  patient: string;
  medecin?: string;
  jours: number;
  vaccin: string;
  /** Décalage en jours du prochain rappel (absent : pas de rappel). */
  rappelJours?: number;
  lotNumero?: string;
  /** Texte libre si aucun médecin MedConnecte n'a administré le vaccin. */
  administrePar?: string;
  notes?: string;
}

export const VACCINATIONS_DEMO: VaccinationDemo[] = [
  {
    patient: 'aminata',
    jours: -1200,
    vaccin: 'Fièvre jaune',
    lotNumero: 'FJ-2023-118',
    administrePar: 'Centre de vaccination de Matam',
    notes: 'Protection à vie.',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -300,
    vaccin: 'Tétanos, diphtérie, poliomyélite (rappel)',
    rappelJours: 3350,
    lotNumero: 'DTP-4471',
  },
  {
    patient: 'aminata',
    jours: -1100,
    vaccin: 'COVID-19',
    lotNumero: 'CV-77310',
    administrePar: 'Campagne nationale de vaccination',
    notes: 'Schéma vaccinal complet.',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -1000,
    vaccin: 'Hépatite B (1re dose)',
    rappelJours: 30,
    lotNumero: 'HB-3301',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -970,
    vaccin: 'Hépatite B (2e dose)',
    rappelJours: 150,
    lotNumero: 'HB-3302',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -820,
    vaccin: 'Hépatite B (3e dose)',
    lotNumero: 'HB-3417',
    notes: 'Schéma complet en 3 doses, protection durable.',
  },
  {
    patient: 'aminata',
    jours: -900,
    vaccin: 'Méningite ACWY',
    lotNumero: 'MN-6620',
    administrePar: 'Centre de vaccination de Matam',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    jours: -25,
    vaccin: 'Grippe saisonnière',
    rappelJours: 340,
    lotNumero: 'GR-2026-08',
    notes: 'Recommandé chaque année.',
  },
  {
    patient: 'mohamed',
    jours: -500,
    vaccin: 'COVID-19',
    lotNumero: 'CV-90211',
    administrePar: 'Campagne nationale de vaccination',
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    jours: -60,
    vaccin: 'Hépatite B (2e dose)',
    rappelJours: 120,
    lotNumero: 'HB-5520',
    notes: 'Troisième dose à prévoir.',
  },
  {
    patient: 'abdoulaye',
    medecin: 'drBah',
    jours: -200,
    vaccin: 'Grippe saisonnière',
    rappelJours: 165,
  },
  {
    patient: 'fanta',
    jours: -2000,
    vaccin: 'Méningite A',
    administrePar: 'Campagne nationale MenAfriVac',
  },
];

export interface RendezVousDemo {
  patient: string;
  /** Absent : rendez-vous « avec la structure », pas encore affecté. */
  medecin?: string;
  structure: CleStructure;
  jours: number;
  heure: number;
  minute: number;
  motif: string;
  notes?: string;
  status: AppointmentStatus;
}

/** Couvre tous les statuts de `AppointmentStatus`. */
export const RENDEZ_VOUS_DEMO: RendezVousDemo[] = [
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: 5,
    heure: 9,
    minute: 30,
    motif: 'Suivi de la tension artérielle',
    status: 'CONFIRME',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: -10,
    heure: 10,
    minute: 0,
    motif: 'Palpitations',
    status: 'TERMINE',
  },
  {
    patient: 'aminata',
    medecin: 'drConde',
    structure: 'donka',
    jours: -540,
    heure: 11,
    minute: 0,
    motif: 'Consultation gynécologique annuelle',
    status: 'TERMINE',
  },
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: -300,
    heure: 9,
    minute: 0,
    motif: 'Suivi de la tension artérielle',
    status: 'TERMINE',
  },
  {
    patient: 'aminata',
    medecin: 'drBah',
    structure: 'fouta',
    jours: -90,
    heure: 10,
    minute: 0,
    motif: 'Contrôle de la glycémie',
    notes: 'Annulé par la patiente : visite à Labé reportée.',
    status: 'ANNULE',
  },
  {
    patient: 'aminata',
    medecin: 'drConde',
    structure: 'donka',
    jours: 18,
    heure: 11,
    minute: 30,
    motif: 'Consultation gynécologique annuelle',
    notes: "Proposé par l'accueil, en attente de validation par le médecin.",
    status: 'EN_ATTENTE',
  },
  {
    patient: 'mohamed',
    medecin: 'drCamara',
    structure: 'donka',
    jours: 12,
    heure: 14,
    minute: 0,
    motif: "Contrôle de l'asthme",
    status: 'PROGRAMME',
  },
  {
    patient: 'mohamed',
    structure: 'donka',
    jours: 3,
    heure: 8,
    minute: 30,
    motif: 'Consultation de pneumologie',
    notes: "Demande enregistrée par l'accueil, en attente d'un médecin.",
    status: 'EN_ATTENTE',
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    structure: 'kindia',
    jours: -5,
    heure: 11,
    minute: 0,
    motif: 'Contrôle après paludisme',
    notes: 'Annulé par la patiente.',
    status: 'ANNULE',
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    structure: 'kindia',
    jours: -30,
    heure: 9,
    minute: 0,
    motif: 'Fièvre',
    status: 'TERMINE',
  },
  {
    patient: 'abdoulaye',
    medecin: 'drBah',
    structure: 'fouta',
    jours: 2,
    heure: 16,
    minute: 0,
    motif: 'Visite à domicile',
    notes:
      'La clinique ne propose pas de visite à domicile. Merci de prendre un rendez-vous en consultation.',
    status: 'REFUSE',
  },
  {
    patient: 'abdoulaye',
    medecin: 'drBah',
    structure: 'fouta',
    jours: 20,
    heure: 10,
    minute: 30,
    motif: 'Suivi du diabète',
    status: 'PROGRAMME',
  },
  {
    patient: 'saliou',
    medecin: 'drDiallo',
    structure: 'donka',
    jours: 7,
    heure: 15,
    minute: 0,
    motif: 'Bilan cardiologique annuel',
    status: 'PROGRAMME',
  },
];

export interface AutoDiagnosticDemo {
  patient: string;
  jours: number;
  symptomes: string;
  maladie: string;
  reponse: string;
  confiance: number;
}

export const AUTO_DIAGNOSTICS_DEMO: AutoDiagnosticDemo[] = [
  {
    patient: 'aminata',
    jours: -12,
    symptomes:
      'Palpitations, fatigue et légers maux de tête depuis trois jours',
    maladie: 'Hypertension artérielle',
    reponse:
      'Vos symptômes peuvent être liés à votre tension. Consultez votre médecin traitant dans les prochains jours.',
    confiance: 0.72,
  },
  {
    patient: 'aminata',
    jours: -721,
    symptomes:
      'Fièvre forte depuis hier soir, frissons, maux de tête, courbatures et nausées',
    maladie: 'Paludisme',
    reponse:
      "Ces symptômes évoquent un paludisme. Faites un test rapide dans un centre de santé aujourd'hui, ou allez aux urgences si vous vomissez tout ce que vous buvez.",
    confiance: 0.88,
  },
  {
    patient: 'aminata',
    jours: -560,
    symptomes:
      'Grande fatigue, essoufflement en montant les escaliers, pâleur depuis plusieurs semaines',
    maladie: 'Anémie',
    reponse:
      'Ces signes peuvent traduire une anémie. Une prise de sang (numération) chez votre médecin permettra de le vérifier.',
    confiance: 0.67,
  },
  {
    patient: 'aminata',
    jours: -401,
    symptomes:
      'Brûlures en urinant, envies fréquentes, douleur en bas du ventre, sans fièvre',
    maladie: 'Infection urinaire',
    reponse:
      'Ces symptômes évoquent une infection urinaire. Consultez un médecin dans les 24 heures et signalez votre allergie à la pénicilline.',
    confiance: 0.81,
  },
  {
    patient: 'hawa',
    jours: -31,
    symptomes: 'Fièvre, frissons, courbatures et maux de tête',
    maladie: 'Paludisme',
    reponse:
      "Ces symptômes évoquent un paludisme. Faites un test rapide dans un centre de santé aujourd'hui.",
    confiance: 0.86,
  },
  {
    patient: 'fanta',
    jours: -1,
    symptomes: 'Douleurs intenses aux articulations et au dos, fièvre légère',
    maladie: 'Crise vaso-occlusive',
    reponse:
      'Avec vos antécédents de drépanocytose, ces douleurs demandent un avis médical rapide. Allez aux urgences si elles persistent.',
    confiance: 0.64,
  },
];

// ─── Messagerie ─────────────────────────────────────────────────

export interface ConversationDemo {
  patient: string;
  /** Conversation privée patient et médecin. */
  medecin?: string;
  /** Conversation patient et structure. */
  structure?: CleStructure;
  messages: { auteur: string; texte: string; minutes: number; lu: boolean }[];
}

export const CONVERSATIONS_DEMO: ConversationDemo[] = [
  {
    patient: 'aminata',
    medecin: 'drDiallo',
    messages: [
      {
        auteur: 'drDiallo',
        texte:
          'Bonjour Madame Diallo, les résultats de votre échographie cardiaque sont dans votre carnet, rubrique Analyses.',
        minutes: 12_960,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte:
          "Merci docteur. J'ai lu « hypertrophie ventriculaire gauche minime », est-ce grave ?",
        minutes: 12_900,
        lu: true,
      },
      {
        auteur: 'drDiallo',
        texte:
          "Non, c'est un léger épaississement du cœur dû à la tension. On le surveille, et le traitement actuel suffit. Continuez l'amlodipine et les automesures.",
        minutes: 12_840,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte:
          'Bonjour docteur, ma tension était à 15/9 ce matin. Dois-je augmenter le traitement ?',
        minutes: 600,
        lu: true,
      },
      {
        auteur: 'drDiallo',
        texte:
          "Bonjour Madame Diallo. Ne changez rien pour l'instant, reprenez la mesure au repos ce soir.",
        minutes: 540,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte: 'Ce soir elle est à 13/8. Merci docteur.',
        minutes: 60,
        lu: false,
      },
    ],
  },
  {
    patient: 'aminata',
    structure: 'donka',
    messages: [
      {
        auteur: 'aminata',
        texte:
          'Bonjour, je voudrais prendre mon rendez-vous annuel de gynécologie avec le Dr Condé.',
        minutes: 2_900,
        lu: true,
      },
      {
        auteur: 'accueilDonka',
        texte:
          'Bonjour Madame Diallo. Le Dr Condé consulte le mardi et le jeudi matin. Une date dans trois semaines vous conviendrait-elle ?',
        minutes: 2_840,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte: 'Oui, plutôt en fin de matinée si possible.',
        minutes: 2_800,
        lu: true,
      },
      {
        auteur: 'accueilDonka',
        texte:
          "C'est noté : demande enregistrée à 11 h 30. Le Dr Condé doit encore la valider, vous recevrez une notification.",
        minutes: 2_760,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte: 'Merci. Faut-il apporter quelque chose ?',
        minutes: 2_700,
        lu: true,
      },
      {
        auteur: 'accueilDonka',
        texte:
          "Votre pièce d'identité suffit, votre carnet MedConnecte est déjà partagé avec Donka. Bonne journée.",
        minutes: 2_650,
        lu: false,
      },
    ],
  },
  {
    patient: 'aminata',
    structure: 'pharmaKaloum',
    messages: [
      {
        auteur: 'aminata',
        texte:
          "Bonsoir, avez-vous de l'Amlor 5 mg ? Il me reste trois jours de traitement.",
        minutes: 1_500,
        lu: true,
      },
      {
        auteur: 'pharmaKeita',
        texte:
          'Bonsoir Madame, il nous en reste quelques boîtes. Voulez-vous que je vous en mette une de côté ?',
        minutes: 1_470,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte: "Oui s'il vous plaît, je passe demain matin avec l'ordonnance.",
        minutes: 1_460,
        lu: true,
      },
      {
        auteur: 'pharmaKeita',
        texte:
          "C'est réservé à votre nom. Nous sommes de garde cette semaine, ouverts jusqu'à 21 h.",
        minutes: 1_450,
        lu: true,
      },
      {
        auteur: 'aminata',
        texte: 'Merci beaucoup, à demain.',
        minutes: 1_440,
        lu: true,
      },
    ],
  },
  {
    patient: 'hawa',
    medecin: 'drSoumah',
    messages: [
      {
        auteur: 'drSoumah',
        texte:
          'Bonjour, vos résultats de numération sont disponibles dans votre carnet. Tout va bien.',
        minutes: 2800,
        lu: true,
      },
      {
        auteur: 'hawa',
        texte: 'Merci docteur, je me sens beaucoup mieux.',
        minutes: 2700,
        lu: true,
      },
    ],
  },
  {
    patient: 'saliou',
    medecin: 'drDiallo',
    messages: [
      {
        auteur: 'saliou',
        texte:
          'Bonjour docteur, puis-je venir à jeun pour le bilan de la semaine prochaine ?',
        minutes: 180,
        lu: false,
      },
    ],
  },
  {
    patient: 'mohamed',
    structure: 'donka',
    messages: [
      {
        auteur: 'mohamed',
        texte:
          'Bonjour, je voudrais un rendez-vous en pneumologie cette semaine.',
        minutes: 1500,
        lu: true,
      },
      {
        auteur: 'accueilDonka',
        texte:
          'Bonjour Monsieur Camara, une demande est enregistrée pour jeudi à 8 h 30. Un médecin va la confirmer.',
        minutes: 1440,
        lu: true,
      },
      { auteur: 'mohamed', texte: 'Merci beaucoup.', minutes: 1430, lu: false },
    ],
  },
  {
    patient: 'fanta',
    structure: 'pharmaNiger',
    messages: [
      {
        auteur: 'fanta',
        texte: "Bonsoir, avez-vous de l'acide folique 5 mg en stock ?",
        minutes: 300,
        lu: true,
      },
      {
        auteur: 'pharmaKourouma',
        texte: 'Bonsoir, oui, nous en avons. Vous pouvez passer avant 20 h.',
        minutes: 280,
        lu: false,
      },
    ],
  },
];

// ─── Urgences SOS ───────────────────────────────────────────────

export interface UrgenceDemo {
  patient: string;
  status: UrgenceStatus;
  /** Ancienneté de l'alerte, en minutes. */
  minutes: number;
  latitude: number;
  longitude: number;
  message: string;
  priseEnCharge?: {
    structure: CleStructure;
    par: string;
    /** Minutes écoulées entre l'alerte et la prise en charge. */
    minutesApres: number;
    delaiArriveeMinutes: number;
  };
}

export const URGENCES_DEMO: UrgenceDemo[] = [
  {
    patient: 'fanta',
    status: 'LANCE',
    minutes: 4,
    latitude: 10.3891,
    longitude: -9.3022,
    message:
      'Douleurs très fortes au dos et aux jambes, je ne peux plus marcher.',
  },
  {
    patient: 'mohamed',
    status: 'PRIS_EN_CHARGE',
    minutes: 12,
    latitude: 9.5412,
    longitude: -13.6731,
    message: "Crise d'asthme sévère, je respire très mal.",
    priseEnCharge: {
      structure: 'donka',
      par: 'drCamara',
      minutesApres: 2,
      delaiArriveeMinutes: 20,
    },
  },
  {
    patient: 'aminata',
    status: 'TERMINE',
    minutes: 3 * 24 * 60,
    latitude: 9.5305,
    longitude: -13.6872,
    message: 'Douleur dans la poitrine et vertiges.',
    priseEnCharge: {
      structure: 'donka',
      par: 'drDiallo',
      minutesApres: 3,
      delaiArriveeMinutes: 15,
    },
  },
  {
    // Ancienne alerte d'Aminata : la nuit du paludisme, il y a 2 ans
    patient: 'aminata',
    status: 'TERMINE',
    minutes: 720 * 24 * 60 + 300,
    latitude: 9.5305,
    longitude: -13.6872,
    message: 'Forte fièvre, je vomis tout et je tiens à peine debout.',
    priseEnCharge: {
      structure: 'donka',
      par: 'drCamara',
      minutesApres: 4,
      delaiArriveeMinutes: 25,
    },
  },
];

// ─── Notifications ──────────────────────────────────────────────

export interface NotificationDemo {
  destinataire: string;
  type: NotificationType;
  titre: string;
  message: string;
  lu: boolean;
  lien?: string;
  minutes: number;
}

export const NOTIFICATIONS_DEMO: NotificationDemo[] = [
  {
    destinataire: 'aminata',
    type: 'RENDEZ_VOUS',
    titre: 'Rendez-vous confirmé',
    message: 'Dr. Mamadou Diallo a confirmé votre rendez-vous de suivi.',
    lu: false,
    lien: '/dashboard/rendez-vous',
    minutes: 90,
  },
  {
    destinataire: 'aminata',
    type: 'NOUVELLE_ORDONNANCE',
    titre: 'Nouvelle ordonnance',
    message: 'Dr. Mamadou Diallo vous a prescrit une nouvelle ordonnance.',
    lu: true,
    lien: '/dashboard/ordonnances',
    minutes: 60 * 24 * 60,
  },
  {
    destinataire: 'aminata',
    type: 'RENDEZ_VOUS',
    titre: 'Rappel de rendez-vous',
    message:
      'Rappel : suivi de la tension avec Dr. Mamadou Diallo dans 5 jours à 9 h 30, Hôpital National Donka.',
    lu: false,
    lien: '/dashboard/rendez-vous',
    minutes: 30,
  },
  {
    destinataire: 'aminata',
    type: 'MESSAGE',
    titre: 'Nouveau message',
    message: "L'accueil de l'Hôpital National Donka vous a répondu.",
    lu: false,
    lien: '/dashboard/chat',
    minutes: 2_650,
  },
  {
    destinataire: 'aminata',
    type: 'SYSTEME',
    titre: "Résultat d'analyse disponible",
    message:
      'Votre bilan lipidique et ionogramme est disponible dans votre carnet.',
    lu: false,
    lien: '/dashboard/analyses',
    minutes: 8 * 24 * 60,
  },
  {
    destinataire: 'aminata',
    type: 'SYSTEME',
    titre: "Résultat d'analyse disponible",
    message:
      'Le compte rendu de votre électrocardiogramme et de votre échographie cardiaque est disponible.',
    lu: true,
    lien: '/dashboard/analyses',
    minutes: 9 * 24 * 60,
  },
  {
    destinataire: 'aminata',
    type: 'SOS_PRIS_EN_CHARGE',
    titre: 'Votre alerte est prise en charge',
    message:
      "L'Hôpital National Donka a pris en charge votre alerte. Arrivée estimée dans environ 15 minutes.",
    lu: true,
    minutes: 3 * 24 * 60 - 3,
  },
  {
    destinataire: 'aminata',
    type: 'SYSTEME',
    titre: 'Vaccination enregistrée',
    message:
      'Votre vaccination contre la grippe saisonnière a été ajoutée à votre carnet. Prochain rappel dans environ un an.',
    lu: true,
    lien: '/dashboard/vaccinations',
    minutes: 25 * 24 * 60,
  },
  {
    destinataire: 'aminata',
    type: 'RENDEZ_VOUS',
    titre: 'Rendez-vous annulé',
    message:
      'Votre rendez-vous de contrôle de la glycémie à la Clinique du Fouta a bien été annulé.',
    lu: true,
    lien: '/dashboard/rendez-vous',
    minutes: 92 * 24 * 60,
  },
  {
    destinataire: 'mohamed',
    type: 'SOS_PRIS_EN_CHARGE',
    titre: 'Votre alerte est prise en charge',
    message: "L'Hôpital National Donka arrive dans environ 20 minutes.",
    lu: false,
    minutes: 10,
  },
  {
    destinataire: 'hawa',
    type: 'SYSTEME',
    titre: 'Vaccination enregistrée',
    message:
      "Votre vaccination contre l'hépatite B a été ajoutée à votre carnet.",
    lu: true,
    lien: '/dashboard/vaccinations',
    minutes: 60 * 24 * 60,
  },
  {
    destinataire: 'drDiallo',
    type: 'MESSAGE',
    titre: 'Nouveau message',
    message: 'Aminata Diallo vous a envoyé un message.',
    lu: false,
    lien: '/dashboard/chat',
    minutes: 60,
  },
  {
    destinataire: 'drConde',
    type: 'RENDEZ_VOUS',
    titre: 'Demande de rendez-vous à valider',
    message:
      "L'accueil propose un rendez-vous de gynécologie à Aminata Diallo dans 18 jours à 11 h 30.",
    lu: false,
    lien: '/dashboard/rendez-vous',
    minutes: 2_760,
  },
  {
    destinataire: 'drCamara',
    type: 'SOS_ALERTE',
    titre: 'Alerte SOS à proximité',
    message: "Un patient a besoin d'aide près de Dixinn.",
    lu: true,
    minutes: 12,
  },
  {
    destinataire: 'pharmaKeita',
    type: 'STOCK_ALERTE',
    titre: 'Stock faible',
    message: 'Amlor 5mg : il ne reste que 6 unités.',
    lu: false,
    lien: '/dashboard/stock',
    minutes: 240,
  },
  {
    destinataire: 'pharmaKeita',
    type: 'STOCK_ALERTE',
    titre: 'Rupture de stock',
    message: 'Ventoline 100 µg est en rupture.',
    lu: true,
    lien: '/dashboard/stock',
    minutes: 1440,
  },
  {
    destinataire: 'superAdmin',
    type: 'SYSTEME',
    titre: 'Bienvenue dans la démonstration',
    message: 'Toutes les données affichées sont fictives.',
    lu: false,
    minutes: 5,
  },
];
