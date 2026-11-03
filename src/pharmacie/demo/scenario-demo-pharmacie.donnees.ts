/**
 * Données du scénario pharmacie du jeu de démonstration (D670 à D674).
 *
 * Tout est fictif : fournisseurs, bordereaux, références Mobile Money, aucun nom ni
 * téléphone de client. Les jours sont des décalages en jours par rapport à aujourd'hui
 * (J), les heures sont celles de Conakry (UTC+0). Aucune donnée de coût hors des
 * lignes de réception.
 */

export type PharmacieScenario = 'kaloum' | 'niger';

export type ModePaiementScenario = 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO';

export interface CoupureScenario {
  valeurFaciale: number;
  nombre: number;
}

export interface FournisseurScenario {
  pharmacie: PharmacieScenario;
  nom: string;
  telephone: string;
}

export const FOURNISSEURS_SCENARIO: FournisseurScenario[] = [
  {
    pharmacie: 'kaloum',
    nom: 'Comptoir Pharmaceutique de Matam',
    telephone: '+224 622 10 20 30',
  },
  {
    pharmacie: 'kaloum',
    nom: 'Grossiste Médical de Bonfi',
    telephone: '+224 664 40 50 60',
  },
  {
    pharmacie: 'niger',
    nom: 'Dépôt Pharmaceutique de Kankan',
    telephone: '+224 655 70 80 90',
  },
];

export interface LigneReceptionScenario {
  medicament: string;
  numeroLot: string;
  /** Décalage en jours de la date de péremption. */
  expirationJours: number;
  nombreBoites: number;
  /** Absent : coût d'achat inconnu. */
  coutAchatBoite?: number;
}

export interface ReceptionScenario {
  pharmacie: PharmacieScenario;
  fournisseur: string;
  reference: string;
  jour: number;
  heure: string;
  lignes: LigneReceptionScenario[];
}

export const RECEPTIONS_SCENARIO: ReceptionScenario[] = [
  {
    pharmacie: 'kaloum',
    fournisseur: 'Comptoir Pharmaceutique de Matam',
    reference: 'BL-MAT-0412',
    jour: -20,
    heure: '10:00',
    lignes: [
      {
        medicament: 'Doliprane 1000mg',
        numeroLot: 'DL24A118',
        expirationJours: 540,
        nombreBoites: 30,
        coutAchatBoite: 11500,
      },
      {
        medicament: 'Doliprane 1000mg',
        numeroLot: 'DL23K052',
        expirationJours: 25,
        nombreBoites: 4,
        coutAchatBoite: 11000,
      },
      {
        medicament: 'Augmentin 1g/125mg',
        numeroLot: 'AG24B031',
        expirationJours: 300,
        nombreBoites: 12,
        coutAchatBoite: 68000,
      },
      {
        medicament: 'Coartem 20/120',
        numeroLot: 'CT24C207',
        expirationJours: 420,
        nombreBoites: 15,
        coutAchatBoite: 34000,
      },
      {
        medicament: 'Coartem 20/120',
        numeroLot: 'CT23H990',
        expirationJours: 6,
        nombreBoites: 3,
        coutAchatBoite: 33000,
      },
      {
        medicament: 'Amlor 5mg',
        numeroLot: 'AM24A015',
        expirationJours: 200,
        nombreBoites: 6,
        coutAchatBoite: 27000,
      },
      {
        medicament: 'Glucophage 850mg',
        numeroLot: 'GL24D300',
        expirationJours: 480,
        nombreBoites: 12,
        coutAchatBoite: 19000,
      },
      {
        medicament: 'SRO',
        numeroLot: 'SRO2409',
        expirationJours: 700,
        nombreBoites: 150,
        coutAchatBoite: 2000,
      },
      {
        medicament: 'Flagyl 500mg',
        numeroLot: 'FG24E118',
        expirationJours: 80,
        nombreBoites: 14,
        coutAchatBoite: 14500,
      },
      {
        medicament: 'Amoxicilline 500mg',
        numeroLot: 'AX24F044',
        expirationJours: 310,
        nombreBoites: 15,
        coutAchatBoite: 16000,
      },
      {
        // Lot reçu sans coût : la marge des ventes qui le touchent n'est pas calculable.
        medicament: 'Ibuprofène 400mg',
        numeroLot: 'IB24G210',
        expirationJours: 450,
        nombreBoites: 14,
      },
    ],
  },
  {
    pharmacie: 'kaloum',
    fournisseur: 'Grossiste Médical de Bonfi',
    reference: 'BL-BON-0087',
    jour: -3,
    heure: '09:00',
    lignes: [
      {
        medicament: 'Doliprane 1000mg',
        numeroLot: 'DL24A240',
        expirationJours: 600,
        nombreBoites: 10,
        coutAchatBoite: 11800,
      },
    ],
  },
  {
    // Aucune réception de Gaviscon Pro : rupture au Niger.
    pharmacie: 'niger',
    fournisseur: 'Dépôt Pharmaceutique de Kankan',
    reference: 'BL-KAN-0153',
    jour: -15,
    heure: '11:00',
    lignes: [
      {
        medicament: 'Doliprane 1000mg',
        numeroLot: 'DL24A131',
        expirationJours: 500,
        nombreBoites: 20,
        coutAchatBoite: 11600,
      },
      {
        medicament: 'Coartem 20/120',
        numeroLot: 'CT24C311',
        expirationJours: 330,
        nombreBoites: 2,
        coutAchatBoite: 35000,
      },
      {
        medicament: 'Amoxicilline 500mg',
        numeroLot: 'AX24F102',
        expirationJours: 310,
        nombreBoites: 12,
        coutAchatBoite: 16500,
      },
      {
        medicament: 'Ibuprofène 400mg',
        numeroLot: 'IB24G305',
        expirationJours: 450,
        nombreBoites: 12,
        coutAchatBoite: 8000,
      },
    ],
  },
];

/** Stock repris de l'ancien logiciel, à qualifier : lot technique sans coût (D418). */
export const STOCK_REPRIS_SCENARIO = {
  pharmacie: 'niger' as PharmacieScenario,
  medicament: 'Spasfon',
  expirationJours: 400,
  quantite: 60,
  motif: "Stock repris de l'ancien logiciel (démonstration)",
};

export const POSTE_SCENARIO = {
  appareilId: 'demo-kaloum-comptoir-1',
  libelle: 'Comptoir principal',
};

export type CleSessionScenario = 'S1' | 'S2' | 'S3';

export interface LigneTicketScenario {
  medicament: string;
  unite: 'BOITE' | 'UNITE';
  nombre: number;
  /** Prix du ticket (boîte ou unité) ; la vente web lit le prix de la fiche. */
  prixUnitaire: number;
  ouvertureConditionnement?: boolean;
}

export interface PaiementScenario {
  mode: ModePaiementScenario;
  montant: number;
  reference?: string;
  montantRecu?: number;
}

interface EvenementBase {
  sequence: number;
  /** Décalage en jours de l'horodatage local du poste. */
  jour: number;
  heure: string;
}

export type EvenementPosteScenario =
  | (EvenementBase & { type: 'SESSION_OUVERTE'; session: CleSessionScenario })
  | (EvenementBase & {
      type: 'COMPTAGE_SAISI';
      session: CleSessionScenario;
      coupures: CoupureScenario[];
    })
  | (EvenementBase & {
      type: 'VENTE';
      session: CleSessionScenario;
      /** Rang du ticket dans la plage du poste, à partir de 1. */
      ticket: number;
      lignes: LigneTicketScenario[];
      paiements: PaiementScenario[];
      total: number;
      ordonnanceVerifiee: boolean;
    })
  | (EvenementBase & {
      type: 'MOUVEMENT_CAISSE';
      session: CleSessionScenario;
      mouvement: 'PRELEVEMENT';
      montant: number;
      motif: string;
    })
  | (EvenementBase & {
      type: 'SESSION_FERMEE';
      session: CleSessionScenario;
      coupures: CoupureScenario[];
      releves: { mode: ModePaiementScenario; montant: number }[];
    });

/** Fond de caisse de 200 000 GNF, compté à l'ouverture des deux caisses. */
const FOND_OUVERTURE: CoupureScenario[] = [
  { valeurFaciale: 20000, nombre: 5 },
  { valeurFaciale: 10000, nombre: 6 },
  { valeurFaciale: 5000, nombre: 4 },
  { valeurFaciale: 2000, nombre: 5 },
  { valeurFaciale: 1000, nombre: 10 },
];

/** Lot A du poste : caisse S2 de J-2 (fermée comptée) puis caisse S1 de J-1 (restée ouverte). */
export const EVENEMENTS_POSTE_LOT_A: EvenementPosteScenario[] = [
  {
    sequence: 1,
    type: 'SESSION_OUVERTE',
    jour: -2,
    heure: '07:55',
    session: 'S2',
  },
  {
    sequence: 2,
    type: 'COMPTAGE_SAISI',
    jour: -2,
    heure: '07:58',
    session: 'S2',
    coupures: FOND_OUVERTURE,
  },
  {
    sequence: 3,
    type: 'VENTE',
    jour: -2,
    heure: '09:12',
    session: 'S2',
    ticket: 1,
    lignes: [
      {
        medicament: 'Coartem 20/120',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 45000,
      },
      { medicament: 'SRO', unite: 'BOITE', nombre: 2, prixUnitaire: 3000 },
    ],
    paiements: [{ mode: 'ESPECES', montant: 51000, montantRecu: 60000 }],
    total: 51000,
    ordonnanceVerifiee: true,
  },
  {
    sequence: 4,
    type: 'VENTE',
    jour: -2,
    heure: '10:40',
    session: 'S2',
    ticket: 2,
    lignes: [
      {
        medicament: 'Amoxicilline 500mg',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 22000,
      },
    ],
    paiements: [
      { mode: 'ORANGE_MONEY', montant: 22000, reference: 'OM-7781203' },
    ],
    total: 22000,
    ordonnanceVerifiee: true,
  },
  {
    sequence: 5,
    type: 'VENTE',
    jour: -2,
    heure: '12:05',
    session: 'S2',
    ticket: 3,
    lignes: [
      {
        medicament: 'Flagyl 500mg',
        unite: 'UNITE',
        nombre: 10,
        prixUnitaire: 1200,
        ouvertureConditionnement: true,
      },
    ],
    paiements: [{ mode: 'MTN_MOMO', montant: 12000, reference: 'MM-55120934' }],
    total: 12000,
    ordonnanceVerifiee: true,
  },
  {
    sequence: 6,
    type: 'VENTE',
    jour: -2,
    heure: '15:30',
    session: 'S2',
    ticket: 4,
    lignes: [
      {
        medicament: 'Augmentin 1g/125mg',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 85000,
      },
      {
        medicament: 'Doliprane 1000mg',
        unite: 'BOITE',
        nombre: 2,
        prixUnitaire: 15000,
      },
    ],
    paiements: [
      { mode: 'ESPECES', montant: 50000 },
      { mode: 'ORANGE_MONEY', montant: 65000, reference: 'OM-7790544' },
    ],
    total: 115000,
    ordonnanceVerifiee: true,
  },
  {
    sequence: 7,
    type: 'MOUVEMENT_CAISSE',
    jour: -2,
    heure: '16:00',
    session: 'S2',
    mouvement: 'PRELEVEMENT',
    montant: 100000,
    motif: 'Versement à la banque',
  },
  {
    sequence: 8,
    type: 'VENTE',
    jour: -2,
    heure: '18:10',
    session: 'S2',
    ticket: 5,
    lignes: [
      {
        medicament: 'Ibuprofène 400mg',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 12000,
      },
    ],
    paiements: [{ mode: 'ESPECES', montant: 12000 }],
    total: 12000,
    ordonnanceVerifiee: false,
  },
  {
    sequence: 9,
    type: 'VENTE',
    jour: -2,
    heure: '19:45',
    session: 'S2',
    ticket: 6,
    lignes: [
      {
        medicament: 'Amlor 5mg',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 35000,
      },
    ],
    paiements: [{ mode: 'MTN_MOMO', montant: 35000, reference: 'MM-55127781' }],
    total: 35000,
    ordonnanceVerifiee: true,
  },
  {
    sequence: 10,
    type: 'SESSION_FERMEE',
    jour: -2,
    heure: '21:00',
    session: 'S2',
    coupures: [
      { valeurFaciale: 20000, nombre: 6 },
      { valeurFaciale: 10000, nombre: 6 },
      { valeurFaciale: 5000, nombre: 4 },
      { valeurFaciale: 2000, nombre: 4 },
      { valeurFaciale: 1000, nombre: 3 },
    ],
    releves: [
      { mode: 'ORANGE_MONEY', montant: 87000 },
      { mode: 'MTN_MOMO', montant: 47000 },
    ],
  },
  {
    sequence: 11,
    type: 'SESSION_OUVERTE',
    jour: -1,
    heure: '08:02',
    session: 'S1',
  },
  {
    sequence: 12,
    type: 'COMPTAGE_SAISI',
    jour: -1,
    heure: '08:05',
    session: 'S1',
    coupures: FOND_OUVERTURE,
  },
  {
    sequence: 13,
    type: 'VENTE',
    jour: -1,
    heure: '09:30',
    session: 'S1',
    ticket: 7,
    lignes: [
      {
        medicament: 'Doliprane 1000mg',
        unite: 'UNITE',
        nombre: 6,
        prixUnitaire: 2000,
        ouvertureConditionnement: true,
      },
    ],
    paiements: [{ mode: 'ESPECES', montant: 12000 }],
    total: 12000,
    ordonnanceVerifiee: false,
  },
  {
    sequence: 14,
    type: 'VENTE',
    jour: -1,
    heure: '11:15',
    session: 'S1',
    ticket: 8,
    lignes: [
      {
        medicament: 'Coartem 20/120',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 45000,
      },
    ],
    paiements: [
      { mode: 'ORANGE_MONEY', montant: 45000, reference: 'OM-7802216' },
    ],
    total: 45000,
    ordonnanceVerifiee: true,
  },
];

/** Lot B du poste, au retour du réseau : une vente et la fermeture de S1, après la clôture de J-1. */
export const EVENEMENTS_POSTE_LOT_B: EvenementPosteScenario[] = [
  {
    sequence: 15,
    type: 'VENTE',
    jour: -1,
    heure: '16:20',
    session: 'S1',
    ticket: 9,
    lignes: [
      { medicament: 'SRO', unite: 'BOITE', nombre: 4, prixUnitaire: 3000 },
    ],
    paiements: [{ mode: 'ESPECES', montant: 12000, montantRecu: 20000 }],
    total: 12000,
    ordonnanceVerifiee: false,
  },
  {
    sequence: 16,
    type: 'SESSION_FERMEE',
    jour: -1,
    heure: '21:05',
    session: 'S1',
    coupures: [
      { valeurFaciale: 20000, nombre: 7 },
      { valeurFaciale: 10000, nombre: 6 },
      { valeurFaciale: 5000, nombre: 4 },
      { valeurFaciale: 2000, nombre: 2 },
    ],
    releves: [{ mode: 'ORANGE_MONEY', montant: 45000 }],
  },
];

/**
 * Lot C du poste, après l'inventaire : la caisse S3 du jour, ouverte, comptée et restée
 * ouverte, porte la vente de Ventoline sans stock (D721). Cette vente est rejouée par
 * le poste, le seul chemin qui l'accepte sans stock : le stock de Ventoline finit à -1
 * en base, affiché 0 avec 1 boîte à régulariser. L'heure est proche de minuit : un
 * horodatage local plus tardif serait dans le futur pour une remise à zéro faite tôt
 * le matin.
 */
export const EVENEMENTS_POSTE_LOT_C: EvenementPosteScenario[] = [
  {
    sequence: 17,
    type: 'SESSION_OUVERTE',
    jour: 0,
    heure: '00:10',
    session: 'S3',
  },
  {
    sequence: 18,
    type: 'COMPTAGE_SAISI',
    jour: 0,
    heure: '00:12',
    session: 'S3',
    coupures: FOND_OUVERTURE,
  },
  {
    // Aucun stock de Ventoline : allocation provisoire et anomalie de stock négatif.
    sequence: 19,
    type: 'VENTE',
    jour: 0,
    heure: '00:15',
    session: 'S3',
    ticket: 10,
    lignes: [
      {
        medicament: 'Ventoline 100 µg',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 60000,
      },
    ],
    paiements: [
      { mode: 'ORANGE_MONEY', montant: 60000, reference: 'OM-7815530' },
    ],
    total: 60000,
    ordonnanceVerifiee: true,
  },
];

export const CLOTURE_FORCEE_MOTIF =
  "Le poste du comptoir n'a plus de réseau depuis midi : ses ventes de l'après-midi remonteront à son retour.";

export interface LigneInventaireScenario {
  medicament: string;
  numeroLot: string;
  /** Présent pour un lot trouvé au rayon et inconnu du stock. */
  expirationJours?: number;
  nombreBoites: number;
  unitesEnPlus?: number;
}

export const INVENTAIRE_SCENARIO = {
  commentaire: 'Inventaire tournant : antidiabétiques et antibiotiques',
  lignes: [
    {
      medicament: 'Glucophage 850mg',
      numeroLot: 'GL24D300',
      nombreBoites: 11,
      unitesEnPlus: 25,
    },
    {
      // Lot périmé trouvé au rayon, coût inconnu.
      medicament: 'Augmentin 1g/125mg',
      numeroLot: 'AG23C777',
      expirationJours: -12,
      nombreBoites: 2,
    },
  ] as LigneInventaireScenario[],
};

export interface VenteWebScenario {
  cle: 'W1' | 'W3';
  lignes: LigneTicketScenario[];
  /** Absent : espèces pour le total. */
  paiements?: PaiementScenario[];
  total: number;
  ordonnanceVerifiee?: boolean;
}

export const VENTES_WEB_SCENARIO: VenteWebScenario[] = [
  {
    cle: 'W1',
    lignes: [
      {
        medicament: 'Doliprane 1000mg',
        unite: 'UNITE',
        nombre: 4,
        prixUnitaire: 2000,
      },
    ],
    total: 8000,
  },
  {
    cle: 'W3',
    lignes: [
      {
        medicament: 'Amoxicilline 500mg',
        unite: 'BOITE',
        nombre: 1,
        prixUnitaire: 22000,
      },
    ],
    total: 22000,
    ordonnanceVerifiee: true,
  },
];

export const ANNULATION_SCENARIO_MOTIF =
  "Le client avait besoin d'un autre dosage.";

export const TRAITEMENT_ANOMALIE_COMMENTAIRE =
  'Tiroir du comptoir recompté avec Ousmane Keita : 224 000 GNF en espèces, conforme.';
