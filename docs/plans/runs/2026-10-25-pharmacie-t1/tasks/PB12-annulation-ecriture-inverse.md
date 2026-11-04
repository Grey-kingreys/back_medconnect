# PB12 - Annulation par écriture inverse et jour métier

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur et de succès lus par les pharmaciens au comptoir, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Sixième pas du jalon J2 (PB07 à PB13, indissociables, D445). Depuis PB09 l'annulation échoue en base (trigger d'immuabilité de `Vente`, D524). Cette tâche réécrit `VenteService.annulerVente` en **pièce d'annulation** (O5, D419) et `listerVentes` en **liste par jour métier** :

- une pièce `Vente` de type `ANNULATION` qui pointe la vente d'origine (`venteOrigineId`), avec lignes, allocations et paiements opposés ;
- des mouvements de stock inverses sur les lots d'origine (le stock revient exactement dans le lot d'où il est sorti) ;
- le remboursement dans la session de caisse ouverte de l'auteur (ouverte automatiquement si besoin, Q11), la pièce rattachée au jour métier de cette session ;
- plus aucune limite au jour même ; refus d'une seconde annulation, y compris quand deux annulations arrivent en même temps ;
- statut et champs d'annulation **dérivés** de la pièce dans toutes les réponses (colonnes gelées jamais écrites) ;
- liste des pièces par `jourMetier`, annulations comprises, total signé.

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`.** Ne pas toucher au domaine pur `src/pharmacie/domaine/`, aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`, à `test/db/non-regression-lectures.db-spec.ts`, ni à `test/db/vente.db-spec.ts` (ils doivent rester verts tels quels). Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables (lire dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D419, D423, D435, D458, D460, D466, D507, D519, D520, D527, D531, D536, D540, et celles de cette tâche, D544 à D553.

### Contexte vérifié (ne pas re-découvrir)

- Schéma (M6) : `Vente { id, structureId, pointDeVenteId, posteId, sessionCaisseId, typePiece (VENTE | ANNULATION | REGULARISATION), venteOrigineId? @unique, venteOrigine (relation "PieceLiee"), pieceLiee (relation inverse "PieceLiee", 0 ou 1 pièce), numero, numeroTicket?, jourMetier @db.Date, jourMetierOrigine?, vendeurId, vendeurNom, clientNom?, clientTelephone?, ordonnanceVerifiee, total, statut (gelé, VALIDEE par défaut), annuleeLe?, annuleeParId?, motifAnnulation?, cleIdempotence?, createdAt, sessionCaisse, lignes, paiements, poste }`. Uniques : `(structureId, numero)`, `(structureId, cleIdempotence)`, `(pointDeVenteId, numeroTicket)` (plusieurs `NULL` permis), `venteOrigineId`.
- CHECK en base qui concernent la pièce (déjà posés, D519) : ANNULATION exige `venteOrigineId` et un `motifAnnulation` non vide ; `LigneVente.quantite = nombreAffiche x coefficientApplique` (quantité et nombre négatifs ensemble : permis), coefficient >= 1, UNITE implique coefficient 1 ; `AllocationLot` : `quantite <> 0`, `coutUnitaire >= 0`, lot non nul si et seulement si DEFINITIVE, `remplaceeParPieceId` si et seulement si REMPLACEE, motif non vide si `sortieManuelle` ; `Paiement.montant <> 0`, `montantRecu` nul ou >= 0. Trigger `vente_verifier_rattachement` (BEFORE INSERT) : point de vente de la pharmacie, session de ce point de vente et de ce poste, origine du même point de vente. `Vente`, `LigneVente`, `Paiement` : aucune mise à jour ni suppression (trigger) ; un `SELECT ... FOR UPDATE` ne déclenche aucun trigger.
- `MouvementsStockService.ecrire(tx, { pointDeVenteId, stockMedicamentId, lotId, type, quantite, pieceOrigineType, pieceOrigineId, motif, auteurId, posteId })` : `ANNULATION` figure déjà dans `PIECES_SANS_LOT` (mouvement sans lot permis) ; il reprend le verrou consultatif de sa fiche (réentrant) et maintient `ConditionnementOuvert` (ouvert quand le reliquat devient non nul, fermé quand il revient à 0). `verrouillerFiches(tx, ids)` trie et dédoublonne. L'archivage d'une fiche (`archiveLe`) n'empêche aucun mouvement.
- `SessionsCaisseService.ouvrirDansTransaction` (D527) : verrou du poste, 409 `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR` ; session OUVERTE du même utilisateur renvoyée telle quelle (quel que soit son jour). `bilan(structureId, userId, sessionId)` renvoie `data.theorique [{ mode, libelle, montant }]` et `data.activite { nombreVentes, nombreAnnulations, montantEncaisse, parMode }` (D531, les pièces ANNULATION sont déjà comptées).
- `vente.service.ts` actuel (PB11) : `INCLUDE_VENTE`, `presenterVente` (champ `annulation: null` « Remplie par PB12 »), `creerVente` et `enregistrerVente` (étapes 7 « Poste » et 8 « Session de caisse »), `listerVentes` (filtre sur `createdAt`), `detailVente`, `annulerVente` (ancienne mutation, à remplacer entièrement). `jourVersDate` et `dateVersJour` viennent de `./stock/lecture-stock`. `estDoublonSur(erreur, modele)` vient de `./stock/erreurs-base`.
- Jeu « format actuel » (`test/db/fixtures/format-actuel.ts`) : ventes historiques `vte-p1-1`, `vte-p1-2`, `vte-p1-4` (VALIDEE) et `vte-p1-3` (ANNULEE) de `str-pharma-1` le jour J (aujourd'hui), `vte-p2-1` (VALIDEE) et `vte-p2-2` (ANNULEE) de `str-pharma-2` la veille ; toutes rattachées à la session technique de leur point de vente (M6). Utilisateurs : `usr-pharm-p1` (vendeur), `usr-admin-p1` (administrateur, `adminId` de `str-pharma-1`).

### 1. `src/pharmacie/vente-regles.ts` : règles pures de l'annulation (D544)

Ajouter, sans Nest ni Prisma (types littéraux locaux), à la fin du fichier :

```ts
export type TypePieceVente = 'VENTE' | 'ANNULATION' | 'REGULARISATION';
export type StatutVente = 'VALIDEE' | 'ANNULEE';
export type StatutAllocation = 'DEFINITIVE' | 'PROVISOIRE' | 'REMPLACEE';

/** Numéro d'une pièce d'annulation : A-<numero de l'origine> (D423). */
export function numeroAnnulation(numeroOrigine: string): string; // `A-${numeroOrigine}`

export interface AllocationOrigine {
  lotId: string | null;
  numeroLot: string | null;
  dateExpiration: Date | null;
  quantite: number;
  coutUnitaire: number;
  lotTechnique: boolean;
  statut: StatutAllocation;
}
export interface LigneOrigine {
  medicamentId: string;
  stockMedicamentId: string;
  nomMedicament: string;
  prixUnitaire: number;
  quantite: number;
  sousTotal: number;
  uniteAffichee: UniteVente;
  nombreAffiche: number;
  coefficientApplique: number;
  allocations: AllocationOrigine[];
}
export interface AllocationInverse {
  lotId: string | null;
  numeroLot: string | null;
  dateExpiration: Date | null;
  quantite: number;
  coutUnitaire: number;
  lotTechnique: boolean;
  statut: 'DEFINITIVE' | 'PROVISOIRE';
}
export interface LigneInverse extends Omit<LigneOrigine, 'allocations'> {
  allocations: AllocationInverse[];
}
export function lignesInverses(lignes: readonly LigneOrigine[]): LigneInverse[];

export interface PaiementOrigine { modePaiementId: string; montant: number; }
export interface PaiementInverse {
  modePaiementId: string;
  montant: number;
  referenceExterne: null;
  montantRecu: null;
}
export function paiementsInverses(
  paiements: readonly PaiementOrigine[],
  totalOrigine: number,
): PaiementInverse[];

export interface PieceLieeLue {
  id: string;
  numero: string;
  typePiece: TypePieceVente;
  motifAnnulation: string | null;
  createdAt: Date;
  vendeurId: string;
  vendeurNom: string;
}
export interface PieceAnnulable {
  typePiece: TypePieceVente;
  statut: StatutVente;
  annuleeLe: Date | null;
  annuleeParId: string | null;
  motifAnnulation: string | null;
}
export interface AnnulationExposee {
  id: string;
  numero: string;
  motif: string;
  le: Date;
  par: { id: string; nom: string };
}
export interface EtatAnnulation {
  statut: StatutVente;
  annuleeLe: Date | null;
  annuleeParId: string | null;
  motifAnnulation: string | null;
  motif: string | null;
  annulation: AnnulationExposee | null;
}
export function deriverAnnulation(
  piece: PieceAnnulable,
  liee: PieceLieeLue | null,
): EtatAnnulation;
```

Règles :

- Opposé d'un entier : `oppose(x) = x === 0 ? 0 : -x` (jamais `-0`), fonction locale non exportée.
- Les objets renvoyés par `lignesInverses` et `paiementsInverses` sont construits champ par champ avec les seules clés des interfaces ci-dessus, jamais par décomposition (`...l`, `...a`, `...p`) : les objets reçus du service portent aussi `id`, `venteId`, `ligneVenteId`, etc., qui ne doivent jamais atteindre une écriture.
- `lignesInverses` : une ligne inverse par ligne d'origine, dans l'ordre reçu. Copiés tels quels : `medicamentId`, `stockMedicamentId`, `nomMedicament`, `prixUnitaire`, `uniteAffichee`, `coefficientApplique`. Opposés : `quantite`, `sousTotal`, `nombreAffiche`. Allocations : celles de statut `REMPLACEE` sont ignorées ; pour chacune des autres, dans l'ordre reçu, une allocation inverse avec les mêmes `lotId`, `numeroLot`, `dateExpiration`, `coutUnitaire`, `lotTechnique`, `statut` et `quantite` opposée. Contrôle (erreur de programmation, `RangeError`) : une ligne sans allocation retenue, ou dont la somme des quantités retenues diffère de sa `quantite`, lève `RangeError` avec le message `Ligne ${index + 1} : allocations incohérentes, annulation impossible.` (D547, D548).
- `paiementsInverses` : un paiement inverse par paiement d'origine, dans l'ordre reçu, même `modePaiementId`, `montant` opposé, `referenceExterne: null`, `montantRecu: null`. Liste vide, ou somme des montants différente de `totalOrigine` : `RangeError('Paiements d’origine incohérents, annulation impossible.')`.
- `deriverAnnulation` (D550) :
  - `piece.typePiece === 'ANNULATION'` : `{ statut: 'VALIDEE', annuleeLe: null, annuleeParId: null, motifAnnulation: null, motif: piece.motifAnnulation, annulation: null }` ;
  - sinon, `liee !== null && liee.typePiece === 'ANNULATION'` : `{ statut: 'ANNULEE', annuleeLe: liee.createdAt, annuleeParId: liee.vendeurId, motifAnnulation: liee.motifAnnulation, motif: null, annulation: { id: liee.id, numero: liee.numero, motif: liee.motifAnnulation ?? '', le: liee.createdAt, par: { id: liee.vendeurId, nom: liee.vendeurNom } } }` ;
  - sinon : `{ statut: piece.statut, annuleeLe: piece.annuleeLe, annuleeParId: piece.annuleeParId, motifAnnulation: piece.motifAnnulation, motif: null, annulation: null }`.

### 2. `src/pharmacie/vente-regles.spec.ts` : tests purs ajoutés

Ajouter les imports nécessaires et ces blocs à la fin (les 16 tests existants restent inchangés) :

- `describe('numeroAnnulation')` :
  1. `numeroAnnulation('T1-0000042')` vaut `'A-T1-0000042'` ; `numeroAnnulation('V-2026-000003')` vaut `'A-V-2026-000003'`.
- `describe('lignesInverses')` :
  2. « ligne à l'unité, deux lots » : ligne `{ quantite: 15, sousTotal: 9000, nombreAffiche: 15, coefficientApplique: 1, uniteAffichee: 'UNITE', prixUnitaire: 600, ... }` avec allocations DEFINITIVE `L30:10` (coût 400, date `2026-07-15`) et `L90:5` (coût 450) : résultat `quantite -15`, `sousTotal -9000`, `nombreAffiche -15`, `prixUnitaire 600`, `coefficientApplique 1`, `uniteAffichee 'UNITE'`, allocations `[{ lotId: 'L30', quantite: -10, coutUnitaire: 400, statut: 'DEFINITIVE', dateExpiration: même Date }, { lotId: 'L90', quantite: -5, coutUnitaire: 450, statut: 'DEFINITIVE' }]` (`toEqual` sur l'objet complet).
  3. « provisoire conservée, remplacée ignorée » : ligne quantité 5 avec DEFINITIVE `A:2`, PROVISOIRE `null:3` (coût 0) : allocations inverses `A:-2` DEFINITIVE et `null:-3` PROVISOIRE ; ligne quantité 4 avec REMPLACEE `null:4` et DEFINITIVE `B:4` : une seule allocation inverse `B:-4`.
  4. « boîte : nombre et coefficient » : ligne `{ quantite: 40, nombreAffiche: 2, coefficientApplique: 20, uniteAffichee: 'BOITE', prixUnitaire: 500, sousTotal: 20000 }`, DEFINITIVE `A:40` : `quantite -40`, `nombreAffiche -2`, `coefficientApplique 20`, `sousTotal -20000`, et `quantite === nombreAffiche * coefficientApplique`.
  5. « incohérences » : ligne sans allocation, puis ligne quantité 5 avec seulement DEFINITIVE `A:3` : `RangeError` avec le message `Ligne 1 : allocations incohérentes, annulation impossible.` ; ligne valide puis ligne fautive : message `Ligne 2 : ...`.
- `describe('paiementsInverses')` :
  6. « paiement partagé » : `[{ modePaiementId: 'esp', montant: 1000 }, { modePaiementId: 'om', montant: 2000 }]`, total 3000 : `[{ modePaiementId: 'esp', montant: -1000, referenceExterne: null, montantRecu: null }, { modePaiementId: 'om', montant: -2000, referenceExterne: null, montantRecu: null }]`.
  7. « incohérences » : liste vide (total 0) et somme 2500 pour un total 3000 : `RangeError`.
- `describe('deriverAnnulation')` :
  8. « vente annulée par une pièce » : pièce `{ typePiece: 'VENTE', statut: 'VALIDEE', annuleeLe: null, annuleeParId: null, motifAnnulation: null }`, liée `{ id: 'p1', numero: 'A-T1-0000001', typePiece: 'ANNULATION', motifAnnulation: 'Erreur de quantité', createdAt: d, vendeurId: 'u2', vendeurNom: 'Fatoumata Camara' }` : `toEqual({ statut: 'ANNULEE', annuleeLe: d, annuleeParId: 'u2', motifAnnulation: 'Erreur de quantité', motif: null, annulation: { id: 'p1', numero: 'A-T1-0000001', motif: 'Erreur de quantité', le: d, par: { id: 'u2', nom: 'Fatoumata Camara' } } })`.
  9. « pièce d'annulation elle-même » : `{ typePiece: 'ANNULATION', statut: 'VALIDEE', annuleeLe: null, annuleeParId: null, motifAnnulation: 'Erreur de quantité' }`, liée nulle : `statut 'VALIDEE'`, `motifAnnulation null`, `motif 'Erreur de quantité'`, `annulation null`.
  10. « vente historique annulée » : `{ typePiece: 'VENTE', statut: 'ANNULEE', annuleeLe: d, annuleeParId: 'u2', motifAnnulation: 'Erreur de saisie' }`, liée nulle : colonnes recopiées, `motif null`, `annulation null`.
  11. « pièce liée de régularisation » : vente VALIDEE et liée de type `REGULARISATION` : `statut 'VALIDEE'`, `annulation null`.

Total attendu dans ce fichier : 27 tests (16 existants, 11 ajoutés).

### 3. `src/pharmacie/dto/vente.dto.ts`

`AnnulerVenteDto` gagne, après `motif`, le champ :

```ts
  @ApiPropertyOptional({
    description:
      "Poste de caisse d'où sort le remboursement ; absent : poste web de l'utilisateur, créé à la volée",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  posteId?: string;
```

Rien d'autre ne change dans ce fichier (imports existants suffisants ; ajouter seulement ce qui manquerait).

### 4. `src/common/filters/codes-erreur.ts`

- Remplacer le commentaire de `VENTE_DEJA_ANNULEE` par `// Vente déjà annulée : une pièce d'annulation existe (409).`
- Remplacer le commentaire de `ANNULATION_HORS_DELAI` par `// Ancien refus d'annulation d'une vente d'un autre jour (409) : plus jamais renvoyé depuis PB12, conservé (code stable).`
- Ajouter à la fin de la liste, avec son commentaire : `// Pièce qui ne peut pas être annulée : annulation, régularisation, vente déjà régularisée ou vente d'avant la caisse (409).` puis `'PIECE_NON_ANNULABLE',`. Pas de `details` (ne pas toucher à `CODES_AVEC_DETAILS` ni au filtre).

### 5. `src/pharmacie/vente.service.ts`

#### 5.1 Imports et constantes

- Importer `deriverAnnulation`, `lignesInverses`, `numeroAnnulation`, `paiementsInverses` de `./vente-regles` (avec les imports existants) et `estDoublonSur` de `./stock/erreurs-base`.
- La ligne `import { bornesDuJour, jourConakry } from './jour-metier';` devient `import { jourConakry } from './jour-metier';` (`bornesDuJour` n'est plus utilisé ici ; la ligne de réexport `export { bornesDuJour, jourConakry } from './jour-metier';` reste).
- Constantes exportées, après `MESSAGE_MOTIF_SORTIE_REQUIS` :

```ts
export const MESSAGE_VENTE_DEJA_ANNULEE = 'Cette vente a déjà été annulée.';
export const MESSAGE_PIECE_NON_ANNULABLE =
  'Cette pièce est une annulation ou une régularisation : elle ne peut pas être annulée.';
export const MESSAGE_VENTE_REGULARISEE =
  'Cette vente a déjà une pièce de régularisation : elle ne peut plus être annulée.';
export const MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE =
  "Cette vente date d'avant la mise en place de la caisse : elle ne peut pas être annulée. Corrigez le stock du médicament si besoin.";
export const MESSAGE_POSTE_AUTRE_POINT_DE_VENTE =
  "Ce poste de caisse n'appartient pas au point de vente de cette vente.";

export function messageVenteAnnulee(numero: string, numeroPiece: string): string {
  return `Vente ${numero} annulée (${numeroPiece}). Les quantités ont été remises en stock et le remboursement est enregistré dans votre caisse.`;
}
```

#### 5.2 Lecture complète d'une pièce

`INCLUDE_VENTE` devient :

```ts
const INCLUDE_VENTE = {
  lignes: { include: { allocations: true } },
  paiements: { include: { modePaiement: true } },
  poste: { select: { id: true, code: true } },
  venteOrigine: { select: { id: true, numero: true } },
  pieceLiee: { select: SELECT_PIECE_LIEE },
} satisfies Prisma.VenteInclude;
```

avec, déclaré juste avant :

```ts
/** Pièce liée (annulation ou régularisation) lue pour dériver le statut (D550). */
const SELECT_PIECE_LIEE = {
  id: true,
  numero: true,
  typePiece: true,
  motifAnnulation: true,
  createdAt: true,
  vendeurId: true,
  vendeurNom: true,
} satisfies Prisma.VenteSelect;
```

#### 5.3 `presenterVente`

Calculer `const etat = deriverAnnulation(vente, vente.pieceLiee);` en tête, puis dans l'objet renvoyé : `statut: etat.statut`, `annuleeLe: etat.annuleeLe`, `annuleeParId: etat.annuleeParId`, `motifAnnulation: etat.motifAnnulation` (mêmes positions qu'aujourd'hui), `annulation: etat.annulation` (supprimer le commentaire « Remplie par PB12 »), et, juste après `annulation`, les deux clés `venteOrigine: vente.venteOrigine ? { id: vente.venteOrigine.id, numero: vente.venteOrigine.numero } : null` et `motif: etat.motif`. Aucune autre clé ne change (instantanés PB02 : clés et valeurs identiques pour l'historique, D458).

#### 5.4 Extraction des étapes 7 et 8 de la création (D544)

Dans `enregistrerVente`, l'étape 7 devient :

```ts
    // 7. Poste
    let posteId = dto.posteId;
    if (!posteId) {
      const pointDeVente =
        (await tx.pointDeVente.findFirst({
          where: { structureId },
          orderBy: { ordre: 'asc' },
        })) ?? (await assurerPointDeVente(tx, structure)).pointDeVente;
      posteId = await this.posteParDefaut(tx, pointDeVente.id, user, ip);
    }
```

et l'étape 8 devient un appel à `const ouverte = await this.ouvrirSessionVerrouillee(tx, { structureId, userId: user.id, utilisateurNom, posteId });` suivi de `const { sessionId, posteCode, pointDeVenteId, ordre, jourMetier, ouverteAutomatiquement } = ouverte;` (les noms de variables utilisés plus bas dans `enregistrerVente` restent les mêmes). L'interface `LigneSession` sort de la méthode (niveau module, non exportée). Nouvelles méthodes privées de `VenteService`, au code repris à l'identique :

```ts
  /** Poste web par défaut de l'utilisateur dans ce point de vente, créé à la volée (D536). */
  private async posteParDefaut(
    tx: Prisma.TransactionClient,
    pointDeVenteId: string,
    user: { id: string; prenom: string },
    ip?: string | null,
  ): Promise<string> {
    const appareilId = PREFIXE_APPAREIL_WEB_DEFAUT + user.id;
    const existant = await tx.poste.findFirst({
      where: { pointDeVenteId, appareilId },
    });
    return (
      existant ??
      (
        await assurerPoste(tx, {
          pointDeVenteId,
          type: 'WEB',
          appareilId,
          user,
          ip,
        })
      ).poste
    ).id;
  }

  /**
   * Session OUVERTE de l'utilisateur sur ce poste, ouverte si besoin, verrouillée
   * (ordre D527 : poste, puis session) ; fermée entre-temps : une seule réouverture.
   */
  private async ouvrirSessionVerrouillee(
    tx: Prisma.TransactionClient,
    entree: { structureId: string; userId: string; utilisateurNom: string; posteId: string },
  ): Promise<{
    sessionId: string;
    posteCode: string;
    pointDeVenteId: string;
    ordre: number;
    jourMetier: Date;
    ouverteAutomatiquement: boolean;
  }>;
```

Le corps de `ouvrirSessionVerrouillee` est exactement le code actuel de l'étape 8 (`ouvrirEtVerrouiller`, deux appels au plus, mêmes requêtes SQL `FOR UPDATE OF s`), qui renvoie `{ sessionId: ouverte.session.id, posteCode: ouverte.session.poste.code, pointDeVenteId: ouverte.ligne.pointDeVenteId, ordre: ouverte.ligne.ordre, jourMetier: new Date(ouverte.ligne.jourMetier), ouverteAutomatiquement: ouverte.ouverteMaintenant }`. Le comportement de la création ne change pas : `test/db/vente.db-spec.ts` (20 tests) doit rester vert sans modification.

#### 5.5 `listerVentes` par jour métier (D551)

- Contrôle de la date inchangé (même message, mêmes contraintes `dateValide`).
- `const filtre = { structureId, jourMetier: jourVersDate(jour) };` (remplace les bornes de `createdAt`).
- `count` et `aggregate` inchangés par ailleurs (`_sum.total` avec `statut: 'VALIDEE'` en plus du filtre : la pièce d'annulation a le statut gelé VALIDEE et un total négatif, l'origine garde VALIDEE, une vente historique ANNULEE reste exclue).
- `findMany` : même `where`, même `orderBy: { createdAt: 'desc' }`, même pagination, `include: { lignes: { select: { quantite: true } }, venteOrigine: { select: { id: true, numero: true } }, pieceLiee: { select: SELECT_PIECE_LIEE } }`.
- Chaque élément, clés existantes d'abord dans le même ordre : `{ id, numero, createdAt, statut: etat.statut, total, nombreArticles (somme signée des quantités, inchangée), vendeur: { id, nom }, clientNom, typePiece, numeroTicket, jourMetier: dateVersJour(v.jourMetier), venteOrigine: v.venteOrigine ? { id, numero } : null, annulation: etat.annulation ? { id: etat.annulation.id, numero: etat.annulation.numero } : null }` avec `etat = deriverAnnulation(v, v.pieceLiee)`.
- Message inchangé : `${nombre} vente(s) le ${jour}.`.

#### 5.6 `detailVente`

Inchangé (il bénéficie de `INCLUDE_VENTE` et de `presenterVente`). Une pièce d'annulation se lit par son `id` comme une vente.

#### 5.7 `annulerVente` réécrite (D545 à D549, D552)

Signature inchangée : `annulerVente(structureId, venteId, userId, dto: AnnulerVenteDto, ip?)`. Code attendu (à suivre à la lettre, ordre compris) :

1. Hors transaction : `const { user, structure } = await this.accesPharmacie.verifier(structureId, userId);`, `const pharmacie = this.pharmacieRecu(structure);`, `const peutVoirMarge = await this.peutVoirMarge(userId);`, `const utilisateurNom = \`${user.prenom} ${user.nom}\`.trim();`, `const motif = dto.motif.trim();`.
2. `const dejaAnnulee = () => new ConflictException({ message: MESSAGE_VENTE_DEJA_ANNULEE, code: 'VENTE_DEJA_ANNULEE' });` et `const nonAnnulable = (message: string) => new ConflictException({ message, code: 'PIECE_NON_ANNULABLE' });`.
3. `try { resultat = await this.prisma.$transaction(async (tx) => { ... }, OPTIONS_TRANSACTION_VENTE); } catch (erreur) { if (estDoublonSur(erreur, 'Vente')) throw dejaAnnulee(); throw erreur; }` ; le corps de la transaction :
   1. **Origine** : `tx.vente.findFirst({ where: { id: venteId, structureId }, include: { lignes: { include: { allocations: true } }, paiements: true, pieceLiee: { select: { id: true, typePiece: true } }, sessionCaisse: { select: { technique: true } } } })` ; absente : `NotFoundException('Cette vente est introuvable.')` (une vente d'une autre pharmacie est donc introuvable).
   2. `origine.typePiece !== 'VENTE'` : `throw nonAnnulable(MESSAGE_PIECE_NON_ANNULABLE)`.
   3. `origine.statut === 'ANNULEE'` ou `origine.pieceLiee?.typePiece === 'ANNULATION'` : `throw dejaAnnulee()` ; `origine.pieceLiee` d'un autre type : `throw nonAnnulable(MESSAGE_VENTE_REGULARISEE)`.
   4. `origine.sessionCaisse.technique` : `throw nonAnnulable(MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE)` (D546).
   5. **Poste** : `const posteId = dto.posteId ?? (await this.posteParDefaut(tx, origine.pointDeVenteId, user, ip));`.
   6. **Session** : `const session = await this.ouvrirSessionVerrouillee(tx, { structureId, userId: user.id, utilisateurNom, posteId });` ; `session.pointDeVenteId !== origine.pointDeVenteId` : `throw new ConflictException({ message: MESSAGE_POSTE_AUTRE_POINT_DE_VENTE, code: 'POSTE_INCONNU' })`.
   7. **Verrou de l'origine** (D545) : ``await tx.$queryRaw`SELECT "id" FROM "Vente" WHERE "id" = ${origine.id} FOR UPDATE`;`` puis `const liee = await tx.vente.findUnique({ where: { venteOrigineId: origine.id }, select: { typePiece: true } });` ; si `liee` : `ANNULATION` donne `throw dejaAnnulee()`, sinon `throw nonAnnulable(MESSAGE_VENTE_REGULARISEE)`.
   8. **Verrous des fiches** : `await this.mouvementsStock.verrouillerFiches(tx, origine.lignes.map((l) => l.stockMedicamentId));`.
   9. **Calcul** : `const lignes = lignesInverses(origine.lignes);`, `const paiements = paiementsInverses(origine.paiements, origine.total);`, `const total = origine.total === 0 ? 0 : -origine.total;`, `const numero = numeroAnnulation(origine.numero);`.
   10. **Pièce** : `tx.vente.create({ data: { structureId, pointDeVenteId: session.pointDeVenteId, posteId, sessionCaisseId: session.sessionId, typePiece: 'ANNULATION', venteOrigineId: origine.id, numero, numeroTicket: null, jourMetier: session.jourMetier, vendeurId: user.id, vendeurNom: utilisateurNom, clientNom: origine.clientNom, clientTelephone: origine.clientTelephone, ordonnanceVerifiee: origine.ordonnanceVerifiee, total, motifAnnulation: motif, lignes: { create: lignes.map((l) => ({ medicamentId, stockMedicamentId, nomMedicament, prixUnitaire, quantite, sousTotal, uniteAffichee, nombreAffiche, coefficientApplique, allocations: { create: l.allocations.map((a) => ({ lotId: a.lotId, numeroLot: a.numeroLot, dateExpiration: a.dateExpiration, quantite: a.quantite, coutUnitaire: a.coutUnitaire, lotTechnique: a.lotTechnique, statut: a.statut, sortieManuelle: false, motif: null, auteurId: user.id })) } })) } }, select: { id: true } })`. Ne jamais écrire `statut`, `annuleeLe`, `annuleeParId`, `cleIdempotence`, `jourMetierOrigine` (défauts).
   11. **Paiements** : `tx.paiement.createMany({ data: paiements.map((p) => ({ venteId: piece.id, sessionCaisseId: session.sessionId, modePaiementId: p.modePaiementId, montant: p.montant, referenceExterne: null, montantRecu: null })) })`.
   12. **Mouvements** : pour chaque ligne inverse (ordre des lignes), pour chaque allocation (ordre des allocations) : `this.mouvementsStock.ecrire(tx, { pointDeVenteId: session.pointDeVenteId, stockMedicamentId: l.stockMedicamentId, lotId: a.lotId, type: 'CORRECTION', quantite: -a.quantite, pieceOrigineType: 'ANNULATION', pieceOrigineId: piece.id, motif, auteurId: user.id, posteId })` (quantité positive : `-a.quantite`, avec `a.quantite` négative ; lot nul pour une allocation PROVISOIRE, D548). Aucune anomalie, aucune alerte de stock, aucune écriture sur `StockMedicament`.
   13. **Audit** : `tx.auditLog.create({ data: { userId: user.id, action: 'annuler', entityType: 'Vente', entityId: origine.id, ip: ip ?? null, metadata: { numero: origine.numero, total: origine.total, pieceId: piece.id, numeroPiece: numero, sessionCaisseId: session.sessionId, sessionOuverteAutomatiquement: session.ouverteAutomatiquement } } })` : jamais le motif ni le client.
   14. **Relecture** : `const vente = await tx.vente.findUniqueOrThrow({ where: { id: origine.id }, include: INCLUDE_VENTE });` et retour `{ vente, numeroPiece: numero, pieceId: piece.id }`.
4. Après la transaction : `this.logger.log(\`vente.annulee venteId=${vente.id} pieceId=${pieceId}\`);` puis retour `{ data: masquerCouts(this.presenterVente(vente, pharmacie), peutVoirMarge), message: messageVenteAnnulee(vente.numero, numeroPiece), success: true }`.

Supprimer tout le reste de l'ancienne annulation (contrôle `ANNULATION_HORS_DELAI`, `updateMany` de la vente, incrément de `StockMedicament.quantite`, `lignesNonRemises` et ses messages). `jourConakry` reste importé (utilisé ailleurs dans le fichier).

Cas limites couverts par ce code, à ne pas traiter autrement :

- Deux annulations simultanées par deux utilisateurs (postes et sessions différents) : la seconde attend le verrou de l'origine, relit la pièce liée validée par la première et répond 409 `VENTE_DEJA_ANNULEE` ; sa session éventuellement ouverte automatiquement est annulée avec la transaction.
- Deux annulations simultanées par le même utilisateur : sérialisées dès le verrou du poste, même résultat.
- Origine dont la session est fermée, ou d'un autre jour, ou d'un autre vendeur : acceptée, la pièce va dans la session et au jour de l'auteur.
- Session de l'auteur ouverte la veille et toujours ouverte : la pièce prend le `jourMetier` de cette session (D435, D547).
- Fiche archivée depuis la vente : acceptée, stock rendu au lot d'origine (D552).
- Allocation PROVISOIRE : allocation inverse PROVISOIRE sans lot et mouvement sans lot (D548).

### 6. `src/pharmacie/vente.controller.ts`

- Route d'annulation : `@RequirePermissions(PERMISSIONS.VENTE_ANNULER, PERMISSIONS.CAISSE_UTILISER)` ; `@ApiOperation({ summary: 'Annuler une vente', description: "Crée une pièce d'annulation qui pointe la vente : lignes, lots et paiements opposés, quantités remises dans les lots d'origine, remboursement enregistré dans la caisse de l'auteur (ouverte automatiquement si besoin) et rattaché au jour de cette caisse. Aucune limite de date. Réservé aux permissions vente:annuler et caisse:utiliser." })` ; ajouter `@ApiResponse({ status: 200, description: "Vente d'origine, avec statut ANNULEE et annulation { id, numero, motif, le, par { id, nom } }. Les coûts ne sont renvoyés qu'avec la permission marge:read." })` ; la réponse 409 devient `'Vente déjà annulée (VENTE_DEJA_ANNULEE), pièce non annulable : annulation, régularisation ou vente d’avant la caisse (PIECE_NON_ANNULABLE), poste inconnu ou d’un autre point de vente (POSTE_INCONNU), caisse d’un autre utilisateur (SESSION_AUTRE_UTILISATEUR).'`. Le corps de la méthode est inchangé.
- Route de liste : description de `@ApiOperation` remplacée par `'Pièces du jour métier (défaut : aujourd’hui), ventes et annulations, avec le total signé des pièces validées et leur nombre.'`.
- Réponse 201 de la création : dans la liste des champs de `data`, remplacer `annulation, lignes` par `annulation, venteOrigine, motif, lignes`.

### 7. `src/pharmacie/vente.http.spec.ts`

- Ajouter au dictionnaire `profils` : `annuleursanscaisse: { type: 'PHARMACIE', codes: ['vente:read', 'vente:annuler'] },`.
- Nouveau test après `2b` : `it('2d. vente:annuler sans caisse:utiliser : annulation refusée (403 PERMISSION_REFUSEE)', ...)` : `POST /pharmacie/s1/ventes/v1/annuler` avec `x-essai-user: annuleursanscaisse` et `{ motif: 'Erreur de quantité' }` : statut 403, `code` `PERMISSION_REFUSEE`, `annulerVente` non appelé.
- Nouveau test : `it('2e. annulation avec posteId : transmis au service', ...)` : utilisateur `admin`, corps `{ motif: 'Erreur de quantité', posteId: 'p1' }` : statut 200, `annulerVente` appelé avec `('s1', 'v1', 'admin', { motif: 'Erreur de quantité', posteId: 'p1' }, expect.anything())`.
- Tableau `cas` du test 3 : ajouter `['annulation posteId vide', 'annuler', { motif: 'Erreur de quantité', posteId: '' }, 'posteId'],`.
- Les tests existants restent inchangés (`2b` passe toujours : le profil `admin` a `caisse:utiliser`).

### 8. `test/db/annulation.db-spec.ts` (nouveau)

Même structure que `test/db/vente.db-spec.ts` (à copier pour la mise en place) : base propre `creerBaseVide`, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations suivantes, `creerPrismaDeTest`, même construction de `VenteService`, `SessionsCaisseService`, `PointsDeVenteService`, `MouvementsStockService`, même doublure de permissions (`RESPONSABLE` = `usr-admin-p1` avec `vente:write`, `caisse:utiliser`, `caisse:superviser`, `marge:read` ; tout autre utilisateur `vente:write`, `caisse:utiliser`), mêmes `afterAll`, `sql`, `compter`, `refus`, `jour(n)`. Helpers copiés et adaptés : `nouvelleFiche` (identifiants `med-annul-<n>` et `stk-annul-<n>`, nom `Produit annulation <n>`, catégorie `Test PB12`), `nouveauLot`, `vendre`, `soldeProduit`, `soldeLot`, `prochainNumero`, plus :

```ts
  async function annuler(
    venteId: string,
    utilisateur = VENDEUR,
    o: { motif?: string; posteId?: string } = {},
  ): Promise<Reponse> {
    return (await service.annulerVente(
      PHARMACIE,
      venteId,
      utilisateur,
      { motif: o.motif ?? 'Erreur de quantité', ...(o.posteId ? { posteId: o.posteId } : {}) },
      '127.0.0.1',
    )) as unknown as Reponse;
  }

  async function piecesDe(origineId: string) {
    return (
      await sql(
        `SELECT "id", "numero", "typePiece"::text AS "typePiece", "total", "numeroTicket", "sessionCaisseId", "posteId", "pointDeVenteId", "vendeurId", "vendeurNom", "motifAnnulation", "statut"::text AS "statut", "jourMetierOrigine", to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "Vente" WHERE "venteOrigineId" = $1`,
        [origineId],
      )
    ).rows;
  }

  const theorique = async (utilisateur: string, sessionId: string, mode: string) =>
    (await sessions.bilan(PHARMACIE, utilisateur, sessionId)).data.theorique.find(
      (t) => t.mode === mode,
    )?.montant ?? 0;
```

Types de réponse : reprendre `VenteRep` de `vente.db-spec.ts` en ajoutant `annuleeLe: string | Date | null`, `annuleeParId: string | null`, `motifAnnulation: string | null`, `motif: string | null`, `venteOrigine: { id: string; numero: string } | null`, `annulation: { id: string; numero: string; motif: string; le: Date; par: { id: string; nom: string } } | null`.

`describe('Annulation par pièce inverse et jour métier, sur base de test (PB12)', ...)`. Tests, dans cet ordre, base partagée :

1. **Pièce inverse dans la même session** : poste `P` par `postes.enregistrerPoste(PHARMACIE, VENDEUR, { type: 'WEB', appareilId: 'appareil-pb12-a' })` ; fiche prix boîte 2000, lot `L` 10 UM coût 300. Vente de 3 boîtes avec `posteId: P` (espèces 6000). `const avant = await prochainNumero();` puis `annuler(origine.id, VENDEUR, { posteId: P })`. Attendus :
   - message `Vente ${origine.numero} annulée (A-${origine.numero}). Les quantités ont été remises en stock et le remboursement est enregistré dans votre caisse.` ;
   - `data.id` = origine, `data.statut` `ANNULEE`, `data.annuleeParId` VENDEUR, `data.motifAnnulation` `Erreur de quantité`, `data.annuleeLe` non nul, `data.motif` nul, `data.venteOrigine` nul, `data.annulation` `toMatchObject({ numero: 'A-' + origine.numero, motif: 'Erreur de quantité', par: { id: VENDEUR } })`, `data.annulation.le` égal à `data.annuleeLe` ; `cheminsCout(data)` vide ;
   - `piecesDe(origine.id)` : une seule ligne, `typePiece` ANNULATION, `total` -6000, `numero` `A-<numero>`, `numeroTicket` nul, `sessionCaisseId` = `origine.session.id`, `posteId` P, `pointDeVenteId` `pv1`, `vendeurId` VENDEUR, `motifAnnulation` `Erreur de quantité`, `statut` VALIDEE, `jourMetierOrigine` nul, `jour` = jour de la session ; `data.annulation.par.nom` = `vendeurNom` de la pièce ;
   - `LigneVente` de la pièce : une, `quantite` -3, `nombreAffiche` -3, `sousTotal` -6000, `prixUnitaire` 2000, `coefficientApplique` 1, `uniteAffichee` BOITE ;
   - `AllocationLot` de la pièce : une, `lotId` L, `quantite` -3, `statut` DEFINITIVE, `coutUnitaire` 300, `sortieManuelle` faux, `motif` nul, `auteurId` VENDEUR ;
   - `Paiement` de la pièce : un, mode ESPECES, `montant` -6000, `referenceExterne` nul, `montantRecu` nul, `sessionCaisseId` = session ;
   - `MouvementStock` de pièce `ANNULATION` et `pieceOrigineId` = id de la pièce : un, `type` CORRECTION, `quantite` 3, `lotId` L, `motif` `Erreur de quantité`, `auteurId` VENDEUR, `posteId` P ;
   - `soldeLot(L)` 10, `soldeProduit` 10 ; `prochainNumero()` = `avant` (aucun numéro de ticket consommé) ;
   - `bilan` de la session par VENDEUR : théorique ESPECES 0, `activite.nombreVentes` 1, `activite.nombreAnnulations` 1, `activite.montantEncaisse` 0 ;
   - `detailVente(PHARMACIE, pieceId, RESPONSABLE)` : `typePiece` ANNULATION, `statut` VALIDEE, `annuleeLe`, `annuleeParId`, `motifAnnulation`, `annulation` nuls, `motif` `Erreur de quantité`, `venteOrigine` `{ id: origine.id, numero: origine.numero }`, `total` -6000, `lignes[0].allocations[0]` `toMatchObject({ lotId: L, quantite: -3, statut: 'DEFINITIVE', coutUnitaire: 300 })`, `paiements` `toMatchObject([{ mode: 'ESPECES', montant: -6000, montantRecu: null, rendu: null }])` ; le même détail par VENDEUR : `cheminsCout` vide ; `detailVente` de l'origine par RESPONSABLE : `annulation.id` = id de la pièce et allocation d'origine avec `coutUnitaire` 300.
2. **Seconde annulation refusée** (origine du test 1) : `refus(annuler(origine.id, RESPONSABLE))` : 409, `code` `VENTE_DEJA_ANNULEE`, message `Cette vente a déjà été annulée.` ; une seule pièce, un seul mouvement de pièce ANNULATION pour cette origine, `soldeLot(L)` 10 ; nombre de `SessionCaisse` de RESPONSABLE inchangé.
3. **Pièces non annulables et introuvables** (nombre de `Vente` de la pharmacie et de `SessionCaisse` mesurés avant, inchangés après chaque cas) : la pièce du test 1 : 409 `PIECE_NON_ANNULABLE`, message `MESSAGE_PIECE_NON_ANNULABLE` ; `vte-p1-1` (historique VALIDEE) : 409 `PIECE_NON_ANNULABLE`, message `MESSAGE_VENTE_HISTORIQUE_NON_ANNULABLE` ; `vte-p1-3` (historique ANNULEE) : 409 `VENTE_DEJA_ANNULEE` ; `vente-inconnue` : 404, message `Cette vente est introuvable.` ; `vte-p2-1` (autre pharmacie) : 404.
4. **Deux annulations simultanées** : fiche, lot 5, vente de 2 par VENDEUR (sans `posteId`). `Promise.allSettled([annuler(id, VENDEUR), annuler(id, RESPONSABLE)])` : exactement une `fulfilled` et une `rejected` dont la raison est une `HttpException` de statut 409 et de `code` `VENTE_DEJA_ANNULEE` ; `piecesDe(id)` de longueur 1 ; un seul mouvement de pièce ANNULATION pour cette pièce ; `soldeLot` 5.
5. **Plus de limite de jour, jour métier et théorique de la session courante** : poste `Q` par `enregistrerPoste(PHARMACIE, VENDEUR, { type: 'WEB', appareilId: 'appareil-pb12-veille' })` ; session insérée par SQL : `INSERT INTO "SessionCaisse" ("id", "pointDeVenteId", "posteId", "utilisateurId", "utilisateurNom", "statut", "technique", "jourMetier", "ouverteLe", "evenementOuvertureId") VALUES ('ses-pb12-veille', $1, $2, $3, 'Mamadou Diallo', 'OUVERTE', false, $4::date, now() - interval '3 days', 'ses-pb12-veille')` avec `[pv1, Q, VENDEUR, jour(-3)]`. Fiche prix boîte 1000, lot 10 ; vente de 1 boîte avec `posteId: Q` : `data.jourMetier` = `jour(-3)` et `data.session.id` = `ses-pb12-veille`. Fermeture de cette session : `sessions.fermer(PHARMACIE, VENDEUR, 'ses-pb12-veille', { comptageFermeture: { coupures: [{ valeurFaciale: 500, nombre: 2 }] } })`. Puis RESPONSABLE vend 1 boîte d'une autre fiche (prix 1000, lot 10) sans `posteId` (sa session du jour s'ouvre ou existe) : `sessionR` = `data.session.id` ; `const thAvant = await theorique(RESPONSABLE, sessionR, 'ESPECES');` ; `const listeAvant = await service.listerVentes(PHARMACIE, VENDEUR, { date: jour(0) })`. Annulation de la vente de la veille par RESPONSABLE sans `posteId` : réussie ; la pièce a `sessionCaisseId` = `sessionR`, `jour` = `jour(0)` ; `theorique(RESPONSABLE, sessionR, 'ESPECES')` = `thAvant - 1000`. `listerVentes(PHARMACIE, VENDEUR, { date: jour(-3) })` : `nombre` 1, `totalJour` 1000, l'élément de l'origine a `statut` ANNULEE, `typePiece` VENTE, `annulation` `{ id: pieceId, numero: 'A-' + numero }`, `venteOrigine` nul, `jourMetier` `jour(-3)`. `listerVentes(... { date: jour(0) })` : `nombre` = `listeAvant.data.nombre + 1`, `totalJour` = `listeAvant.data.totalJour - 1000`, l'élément de la pièce (première page, tri décroissant : la pièce est la plus récente, en tête) a `typePiece` ANNULATION, `total` -1000, `statut` VALIDEE, `nombreArticles` -1, `venteOrigine` `{ id: origine.id, numero: origine.numero }`, `annulation` nul, `numeroTicket` nul ; message `${nombre} vente(s) le ${jour(0)}.`.
6. **Paiement partagé et session ouverte automatiquement** : poste `M` (`appareil-pb12-mobile`) et poste `R` (`appareil-pb12-remboursement`) enregistrés par VENDEUR, aucune session sur `R`. Fiche prix boîte 3000, lot 10 ; vente de 1 boîte avec `posteId: M`, `paiements: [{ mode: 'ESPECES', montant: 1000, montantRecu: 1000 }, { mode: 'ORANGE_MONEY', montant: 2000, reference: 'OM-PB12' }]`. Annulation par VENDEUR avec `posteId: R` : une session OUVERTE de VENDEUR existe maintenant sur `R` et porte la pièce ; `Paiement` de la pièce (triés par montant) : ESPECES -1000 et ORANGE_MONEY -2000, `referenceExterne` et `montantRecu` nuls ; somme = total de la pièce (-3000) ; théorique de la session de `R` : ESPECES -1000, ORANGE_MONEY -2000 ; théorique de la session de `M` inchangé (ESPECES 1000, ORANGE_MONEY 2000). Audit : une ligne `AuditLog` `action` `annuler`, `entityId` = origine, `metadata.sessionOuverteAutomatiquement` vrai, `metadata.pieceId` = id de la pièce, `metadata.numeroPiece` `A-<numero>`, et `metadata` sans clé `motif` ni `clientNom`.
7. **Lots, reliquat, provisoire et fiche archivée** :
   - (a) fiche coef 20, déconditionnable, prix boîte 10 000, prix unité 600 ; lot `A` 20 UM coef 20 `exp jour(30)`. Vente de 6 `UNITE` : `soldeLot(A)` 14 et un `ConditionnementOuvert` ouvert sur A. Annulation : `soldeLot(A)` 20, aucun `ConditionnementOuvert` ouvert (`fermeLe` nul) sur A ; ligne de la pièce `{ uniteAffichee: 'UNITE', nombreAffiche: -6, quantite: -6, coefficientApplique: 1, prixUnitaire: 600, sousTotal: -3600 }`.
   - (b) fiche coef 1 ; lots `L30` 10 (`exp jour(30)`) et `L90` 10 (`exp jour(90)`) ; vente de 15 (`L30:10`, `L90:5`). Annulation : `soldeLot(L30)` 10, `soldeLot(L90)` 10 ; mouvements de la pièce : `{ lotId: L30, quantite: 10 }` et `{ lotId: L90, quantite: 5 }`, tous `CORRECTION`.
   - (c) fiche, lot 2 ; vente de 5 : `soldeProduit` -3, une anomalie `STOCK_NEGATIF` pour cette vente. Annulation : allocations de la pièce `DEFINITIVE` -2 (le lot) et `PROVISOIRE` -3 (`lotId` nul, `coutUnitaire` 0) ; mouvements de la pièce +2 avec lot et +3 sans lot ; `soldeProduit` 2, `soldeLot` 2 ; `detailVente` de la pièce : `provisoire` vrai ; nombre d'anomalies de la pharmacie inchangé par l'annulation et celle de la vente toujours `OUVERTE`.
   - (d) fiche, lot 4 ; vente de 1 ; `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1` ; annulation réussie, `soldeLot` 4.
8. **Poste et session de l'annulation** (pour chaque cas : aucune pièce pour l'origine, `soldeLot` inchangé) : fiche, lot 5, vente de 1 par VENDEUR ; annulation par VENDEUR avec `posteId: 'poste-inconnu'` : 409 `POSTE_INCONNU` ; poste `O` enregistré par RESPONSABLE (`appareil-pb12-occupe`), session ouverte dessus par `sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: O })`, annulation par VENDEUR avec `posteId: O` : 409 `SESSION_AUTRE_UTILISATEUR`. Puis annulation par VENDEUR sans `posteId` : réussie.
9. **Invariants** (dernier test) : `verifierStock(base.client).totalAnomalies` vaut 0 ; requête du test 20 de `vente.db-spec.ts` (lignes avec allocations, aucune PROVISOIRE, somme des DEFINITIVE différente de la quantité) : 0 ; pour la pharmacie, pièces ANNULATION dont `total` diffère de l'opposé du total de l'origine, ou dont la somme des paiements diffère de `total`, ou dont `numero` diffère de `'A-' || origine.numero`, ou rattachées à une session technique : 0 (une requête SQL par contrôle, `compter`) ; pièces ANNULATION sans `venteOrigineId` : 0.

Aucune URL, aucun mot de passe, aucune valeur de `.env` dans les tests ni dans leurs messages (D454).

### 9. `CLAUDE.md` du dépôt back

- Puce « Ventes en pharmacie (B13, lot 7 ; B14, lot 8) », sous-puce « Création » : remplacer la phrase « Contrat de création remplacé par la tranche pharmacie 1 (PB11, puce « Vente recâblée » plus bas) ; les règles ci-dessous restent vraies pour la liste, le détail et l'annulation jusqu'à PB12. » par « Contrat de création remplacé par la tranche pharmacie 1 (PB11, puce « Vente recâblée » plus bas), liste et annulation remplacées par PB12 (puce « Annulation par pièce inverse » plus bas) ; les règles ci-dessous restent vraies pour le reste. »
- Puce PB11 : remplacer la dernière phrase « `annulerVente` et `listerVentes` restent inchangés jusqu'à PB12. » par « Annulation et liste : voir PB12. »
- Ajouter après la puce PB11 une puce « **Annulation par pièce inverse (tranche pharmacie 1, PB12)** » qui décrit en français, sans tiret long : route `POST /pharmacie/:structureId/ventes/:venteId/annuler` (`vente:annuler` et `caisse:utiliser`, 200), corps `{ motif (3 à 300 caractères), posteId? }` ; pièce `Vente` de type ANNULATION (`venteOrigineId` unique, numéro `A-<numero>`, sans numéro de ticket, total, lignes, allocations et paiements opposés, mouvements `CORRECTION` positifs sur les lots d'origine, pièce `ANNULATION`), rattachée à la session de l'auteur (poste web par défaut, ouverte automatiquement) et au jour de cette session ; plus de limite de jour ; codes 409 `VENTE_DEJA_ANNULEE` (y compris en course), `PIECE_NON_ANNULABLE` (annulation, régularisation, vente d'avant la caisse), `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `ANNULATION_HORS_DELAI` plus jamais renvoyé ; ordre des verrous poste, session, vente d'origine, fiches ; réponse = vente d'origine avec `statut`, `annuleeLe`, `annuleeParId`, `motifAnnulation` dérivés et `annulation { id, numero, motif, le, par { id, nom } }`, toute pièce porte `venteOrigine` et `motif` (D550) ; liste par `jourMetier` avec pièces d'annulation (`typePiece`, `numeroTicket`, `jourMetier`, `venteOrigine`, `annulation`), `totalJour` signé ; provisoire annulée jamais résolue (D548) ; message de succès (D552).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés (le seul déplacement permis est l'extraction de la section 5.4). Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite (contrainte de base, type Prisma), s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/pharmacie/vente-regles.ts`, `src/pharmacie/vente-regles.spec.ts`, `src/pharmacie/vente.service.ts`, `src/pharmacie/vente.controller.ts`, `src/pharmacie/dto/vente.dto.ts`, `src/pharmacie/vente.http.spec.ts`, `src/common/filters/codes-erreur.ts`, `test/db/annulation.db-spec.ts` (nouveau), `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/vente-regles.ts src/pharmacie/vente-regles.spec.ts src/pharmacie/vente.service.ts src/pharmacie/vente.controller.ts src/pharmacie/dto/vente.dto.ts src/pharmacie/vente.http.spec.ts src/common/filters/codes-erreur.ts test/db/annulation.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `vente-regles.spec.ts` (27 tests) et `vente.http.spec.ts` (avec `2d`, `2e` et le cas `annulation posteId vide`).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/annulation.db-spec.ts` (9 tests), `test/db/vente.db-spec.ts` (20 tests, fichier intouché), `test/db/non-regression-lectures.db-spec.ts` (fichier et instantanés intouchés), `sessions-caisse.db-spec.ts`, `commandes-stock.db-spec.ts`, `schema-derive.db-spec.ts`.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers de la section « Fichiers touchés attendus » ; `git diff --stat -- test/db/instantanes test/db/non-regression-lectures.db-spec.ts test/db/vente.db-spec.ts prisma` est vide.
6. `grep -n "ANNULATION_HORS_DELAI\|lignesNonRemises\|increment" src/pharmacie/vente.service.ts` : aucune ligne ; `grep -n "statut: 'ANNULEE'\|annuleeLe:\s*maintenant" src/pharmacie/vente.service.ts` : aucune ligne (les colonnes gelées ne sont jamais écrites).
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide, et de même sur `test/db/annulation.db-spec.ts`).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-26 | spécifié (codeur Sonnet, vérificateur Sonnet) | PASS | écart déclaré (FOR KEY SHARE avant le verrou de l'origine) remplacé par le chef par D554

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
tsc, eslint, npm test, npm run test:db (annulation x3) | 0 erreur, 903 tests, 191 tests db, stable | commit « feat(pharmacie): annulation par pièce inverse et liste par jour métier (PB12) »
