import type { Prisma } from 'generated/prisma/client';
import type {
  CorpsFicheCreeeDto,
  CorpsFicheModifieeDto,
} from '../dto/synchro.dto';
import { RejetSynchro } from './rejeu-regles';

type Tx = Prisma.TransactionClient;

/** Champs « sûrs » d'une fiche modifiables hors ligne (Q9). Coefficient, unité, déconditionnement et archivage restent en ligne. */
export const CHAMPS_FICHE_SURS = [
  'prixUnitaire',
  'prixUnite',
  'toleranceInventaire',
  'notes',
] as const;
export type ChampFicheSur = (typeof CHAMPS_FICHE_SURS)[number];

export const LIBELLES_CHAMP_FICHE: Record<ChampFicheSur, string> = {
  prixUnitaire: 'le prix de la boîte',
  prixUnite: "le prix à l'unité",
  toleranceInventaire: "la tolérance d'inventaire",
  notes: 'les notes',
};

type Valeur = number | string | null;

/** Valeur comparable : les notes vides valent null, les autres champs sont des entiers ou null. */
export function normaliserValeurFiche(
  champ: ChampFicheSur,
  valeur: unknown,
): Valeur {
  if (valeur === undefined || valeur === null) return null;
  if (champ === 'notes') {
    const texte = typeof valeur === 'string' ? valeur.trim() : '';
    return texte === '' ? null : texte;
  }
  return typeof valeur === 'number' ? valeur : null;
}

export interface ConflitChamp {
  champ: ChampFicheSur;
  avantPoste: Valeur;
  valeurServeur: Valeur;
  valeurVoulue: Valeur;
}

export interface ResultatFicheModifiee {
  stockId: string;
  nom: string;
  appliques: ChampFicheSur[];
  conflits: ConflitChamp[];
}

/**
 * Modification de fiche rejouée : chaque champ est appliqué seulement si la valeur du serveur est celle que le poste
 * avait vue (`avant`) ; sinon il est laissé tel quel et rendu en conflit (anomalie). Un champ déjà égal à la valeur
 * voulue n'est ni écrit ni signalé. Rien n'est écrit si le prix à l'unité est refusé.
 */
export async function appliquerFicheModifiee(
  tx: Tx,
  p: {
    structureId: string;
    auteurId: string;
    posteId: string;
    ip: string | null;
    corps: CorpsFicheModifieeDto;
  },
): Promise<ResultatFicheModifiee> {
  const { corps } = p;
  const voulus = CHAMPS_FICHE_SURS.filter((c) => corps.apres[c] !== undefined);
  if (voulus.length === 0) {
    throw new RejetSynchro('EVENEMENT_INVALIDE', { champs: ['apres'] });
  }
  if (voulus.some((c) => corps.avant[c] === undefined)) {
    throw new RejetSynchro('EVENEMENT_INVALIDE', { champs: ['avant'] });
  }
  const verrou = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "StockMedicament" WHERE "id" = ${corps.stockId} AND "structureId" = ${p.structureId} AND "archiveLe" IS NULL FOR NO KEY UPDATE`;
  if (verrou.length === 0) throw new RejetSynchro('STOCK_INTROUVABLE');
  const existante = await tx.stockMedicament.findUniqueOrThrow({
    where: { id: corps.stockId },
    select: {
      prixUnitaire: true,
      prixUnite: true,
      toleranceInventaire: true,
      notes: true,
      deconditionnable: true,
      medicament: { select: { nom: true } },
    },
  });

  const data: Record<string, Valeur> = {};
  const avantAudit: Record<string, Valeur> = {};
  const apresAudit: Record<string, Valeur> = {};
  const appliques: ChampFicheSur[] = [];
  const conflits: ConflitChamp[] = [];
  for (const champ of voulus) {
    const serveur = normaliserValeurFiche(champ, existante[champ]);
    const voulue = normaliserValeurFiche(champ, corps.apres[champ]);
    if (voulue === serveur) continue;
    const vu = normaliserValeurFiche(champ, corps.avant[champ]);
    if (serveur !== vu) {
      conflits.push({
        champ,
        avantPoste: vu,
        valeurServeur: serveur,
        valeurVoulue: voulue,
      });
      continue;
    }
    appliques.push(champ);
    data[champ] = voulue;
    // Les notes sont du texte libre : l'audit dit qu'elles ont changé, sans les recopier.
    if (champ !== 'notes') {
      avantAudit[champ] = serveur;
      apresAudit[champ] = voulue;
    }
  }

  if (
    appliques.includes('prixUnite') &&
    data.prixUnite !== null &&
    !existante.deconditionnable
  ) {
    throw new RejetSynchro('PRIX_UNITE_SANS_DECONDITIONNEMENT');
  }

  if (appliques.length > 0) {
    await tx.stockMedicament.update({ where: { id: corps.stockId }, data });
    await tx.auditLog.create({
      data: {
        userId: p.auteurId,
        action: 'update',
        entityType: 'StockMedicament',
        entityId: corps.stockId,
        ip: p.ip,
        metadata: {
          avant: avantAudit,
          apres: apresAudit,
          ...(appliques.includes('notes') ? { notesModifiees: true } : {}),
          posteId: p.posteId,
        },
      },
    });
  }
  return {
    stockId: corps.stockId,
    nom: existante.medicament.nom,
    appliques,
    conflits,
  };
}

export interface ResultatFicheCreee {
  /** Identifiant de la fiche retenue par le serveur : celui du poste, sauf fiche déjà existante. */
  id: string;
  cree: boolean;
  /** Une fiche existait déjà pour ce médicament sous un autre identifiant. */
  reutilisee: boolean;
  /** Rien à écrire : la fiche du poste existe déjà telle quelle. */
  dejaApplique: boolean;
}

/**
 * Fiche de stock ajoutée depuis le catalogue global, sans quantité. Une fiche déjà là pour ce médicament est réutilisée
 * (prix et notes seulement s'ils étaient vides, fiche archivée remise en service) : son identifiant devient l'alias de
 * celui du poste. Médicament inconnu : rejet.
 */
export async function appliquerFicheCreee(
  tx: Tx,
  p: {
    structureId: string;
    auteurId: string;
    posteId: string;
    ip: string | null;
    corps: CorpsFicheCreeeDto;
  },
): Promise<ResultatFicheCreee> {
  const { corps } = p;
  const medicament = await tx.medicament.findUnique({
    where: { id: corps.medicamentId },
    select: { id: true },
  });
  if (!medicament) throw new RejetSynchro('MEDICAMENT_INCONNU');
  const notes = normaliserValeurFiche('notes', corps.notes) as string | null;
  const prix = corps.prixUnitaire ?? null;

  const existante = await tx.stockMedicament.findUnique({
    where: {
      medicamentId_structureId: {
        medicamentId: corps.medicamentId,
        structureId: p.structureId,
      },
    },
    select: { id: true, prixUnitaire: true, notes: true, archiveLe: true },
  });
  if (existante) {
    const data: Record<string, Valeur | Date> = {};
    const apres: Record<string, Valeur | boolean> = {};
    if (existante.prixUnitaire === null && prix !== null) {
      data.prixUnitaire = prix;
      apres.prixUnitaire = prix;
    }
    if (normaliserValeurFiche('notes', existante.notes) === null && notes) {
      data.notes = notes;
      apres.notesModifiees = true;
    }
    if (existante.archiveLe) {
      data.archiveLe = null;
      apres.archiveLe = null;
    }
    const ecrit = Object.keys(data).length > 0;
    if (ecrit) {
      await tx.stockMedicament.update({ where: { id: existante.id }, data });
      await tx.auditLog.create({
        data: {
          userId: p.auteurId,
          action: 'update',
          entityType: 'StockMedicament',
          entityId: existante.id,
          ip: p.ip,
          metadata: {
            ...(existante.archiveLe
              ? { avant: { archiveLe: existante.archiveLe.toISOString() } }
              : {}),
            apres,
            posteId: p.posteId,
          },
        },
      });
    }
    return {
      id: existante.id,
      cree: false,
      reutilisee: existante.id !== corps.id,
      dejaApplique: !ecrit,
    };
  }

  const pris = await tx.stockMedicament.findUnique({
    where: { id: corps.id },
    select: { id: true },
  });
  if (pris) throw new RejetSynchro('IDENTIFIANT_DEJA_UTILISE');
  const creee = await tx.stockMedicament.create({
    data: {
      id: corps.id,
      medicamentId: corps.medicamentId,
      structureId: p.structureId,
      prixUnitaire: prix,
      notes,
    },
    select: { id: true },
  });
  await tx.auditLog.create({
    data: {
      userId: p.auteurId,
      action: 'create',
      entityType: 'StockMedicament',
      entityId: creee.id,
      ip: p.ip,
      metadata: {
        medicamentId: corps.medicamentId,
        prixUnitaire: prix,
        posteId: p.posteId,
      },
    },
  });
  return { id: creee.id, cree: true, reutilisee: false, dejaApplique: false };
}

// ------------------------------------------------------------------ correspondance des identifiants

function idsStock(type: string, corps: unknown): string[] {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) {
    return [];
  }
  const c = corps as Record<string, unknown>;
  if (
    type === 'SORTIE_STOCK' ||
    type === 'CORRECTION_QUANTITE' ||
    type === 'FICHE_MODIFIEE'
  ) {
    return typeof c.stockId === 'string' ? [c.stockId] : [];
  }
  if (
    (type === 'VENTE' ||
      type === 'RECEPTION_ENREGISTREE' ||
      type === 'INVENTAIRE_ENREGISTRE') &&
    Array.isArray(c.lignes)
  ) {
    return c.lignes.flatMap((l: unknown) =>
      l !== null &&
      typeof l === 'object' &&
      typeof (l as Record<string, unknown>).stockId === 'string'
        ? [(l as { stockId: string }).stockId]
        : [],
    );
  }
  return [];
}

/**
 * Fiche du serveur qui répond à l'identifiant d'une fiche créée sur le poste : l'identifiant retenu par l'événement
 * FICHE_CREEE (différent de celui du poste quand une fiche existait déjà pour ce médicament). Null si aucune.
 */
export async function ficheDuPoste(
  tx: Tx,
  structureId: string,
  idPoste: string,
): Promise<string | null> {
  const evenement = await tx.evenementSynchro.findFirst({
    where: {
      type: 'FICHE_CREEE',
      statut: 'APPLIQUE',
      poste: { pointDeVente: { structureId } },
      corps: { path: ['id'], equals: idPoste },
    },
    select: { resultat: true },
  });
  const resultat = evenement?.resultat;
  const piece =
    resultat !== null &&
    typeof resultat === 'object' &&
    !Array.isArray(resultat)
      ? (resultat as Record<string, unknown>).piece
      : undefined;
  const retenu =
    piece !== null && typeof piece === 'object' && !Array.isArray(piece)
      ? (piece as Record<string, unknown>).id
      : undefined;
  if (typeof retenu !== 'string') return null;
  const existe = await tx.stockMedicament.findFirst({
    where: { id: retenu, structureId },
    select: { id: true },
  });
  return existe ? existe.id : null;
}

/**
 * Corps dont les identifiants de fiche créée sur le poste (et absents du serveur) sont remplacés par ceux que le
 * serveur a retenus. Une seule lecture de plus dans le cas courant (les fiches citées existent).
 */
export async function corpsAvecFichesDuServeur(
  tx: Tx,
  structureId: string,
  type: string,
  corps: unknown,
): Promise<unknown> {
  const ids = [...new Set(idsStock(type, corps))];
  if (ids.length === 0) return corps;
  const presentes = await tx.stockMedicament.findMany({
    where: { id: { in: ids }, structureId },
    select: { id: true },
  });
  const connues = new Set(presentes.map((f) => f.id));
  const alias = new Map<string, string>();
  for (const id of ids) {
    if (connues.has(id)) continue;
    const retenu = await ficheDuPoste(tx, structureId, id);
    if (retenu) alias.set(id, retenu);
  }
  if (alias.size === 0) return corps;
  const c = { ...(corps as Record<string, unknown>) };
  if (typeof c.stockId === 'string' && alias.has(c.stockId)) {
    c.stockId = alias.get(c.stockId);
  }
  if (Array.isArray(c.lignes)) {
    c.lignes = c.lignes.map((l: unknown) => {
      const ligne = l as Record<string, unknown>;
      return typeof ligne?.stockId === 'string' && alias.has(ligne.stockId)
        ? { ...ligne, stockId: alias.get(ligne.stockId) }
        : l;
    });
  }
  return c;
}
