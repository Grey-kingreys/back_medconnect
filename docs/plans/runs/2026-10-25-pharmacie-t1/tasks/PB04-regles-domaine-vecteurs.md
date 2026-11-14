# PB04 - Règles pures du domaine et vecteurs de test

Tier: dur (codeur Sonnet selon l'arbitrage A2, fiche très détaillée ; aucune décision laissée ouverte)
Audience: dev (fonctions internes, aucun texte vu par l'utilisateur final ; les messages de `RangeError` sont des erreurs de programmation, en français)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Jalon J1 : aucun changement de comportement visible. Cette tâche crée des **fonctions pures** (aucune base, aucun service Nest, aucune route) que les tâches suivantes brancheront : PB08 (lectures, stock bas), PB10 (théorique de caisse), PB11 (vente), PB14 (coût par UM), PB16 (marge), et que le front recopiera (PF01, D439). Rien d'existant n'est modifié : `vente.service.ts`, `pharmacie.service.ts`, `SEUIL_STOCK_BAS` et `jourConakry` restent tels quels.

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D404, D405, D409, D413, D416, D420, D422, D439, D469 à D477, et l'arbitrage A4 de `CORRECTIONS-PORTEUR.md`.

### Contexte vérifié (ne pas re-découvrir)

- Jest unitaire : `jest.config.js`, racine `src/`, motif `*.spec.ts`, `moduleDirectories` inclut la racine du dépôt. Les specs vont donc à côté du code, sous `src/pharmacie/domaine/`. Les vecteurs JSON vivent hors `src/` (`test/vecteurs/`) : la spec les lit par `fs.readFileSync` (le `tsconfig` n'a pas `resolveJsonModule`, ne pas l'ajouter).
- `tsconfig` : `strictNullChecks` vrai, `noImplicitAny` faux. ESLint : `recommendedTypeChecked` + prettier (`eslint.config.mjs`) ; `JSON.parse` renvoie `any` : le typer par `as FichierVecteurs` au point d'appel.
- `npm test` actuel (après PB03) : 64 suites, 740 réussis, 3 ignorés. `npm run test:db` : 3 suites, 26 tests (harnais 11, PB02 9, M1 6).
- Règle actuelle de péremption (`vente.service.ts`, `jourConakry`) : périmé si le jour de la date est avant le jour courant (Conakry = UTC+0), le jour même reste vendable. Règle actuelle du prix : `null` ou 0 = manquant.
- Les noms de champs suivent le plan (1.3 à 1.5) : `coefficientReception`, `coutUnitaire`, `lotTechnique`, `dateExpiration`, `numeroLot`. Tout nom qui contient « cout » ou « marge » est une donnée de coût (D466) : ne pas en inventer d'autres.

### Fichiers (liste fermée)

Créés :
- `src/pharmacie/domaine/quantites.ts` et `src/pharmacie/domaine/quantites.spec.ts`
- `src/pharmacie/domaine/prix.ts` et `src/pharmacie/domaine/prix.spec.ts`
- `src/pharmacie/domaine/selection-lots.ts` et `src/pharmacie/domaine/selection-lots.spec.ts`
- `src/pharmacie/domaine/caisse.ts` et `src/pharmacie/domaine/caisse.spec.ts`
- `src/pharmacie/domaine/marge.ts` et `src/pharmacie/domaine/marge.spec.ts`
- `test/vecteurs/selection-lots.json`

Aucun fichier existant n'est modifié. Pas de fichier `index.ts`.

### Règles communes aux cinq fichiers de code

1. Imports autorisés dans les fichiers de code : uniquement entre fichiers du dossier (`./quantites`, `./prix`). Aucun import de `@nestjs/*`, `generated/prisma/*`, `src/*`, `../*`, ni de module Node. Les specs peuvent en plus importer `fs` et `path` (`import { readFileSync } from 'fs'; import { join } from 'path';`).
2. Aucune horloge : ni `new Date(`, ni `Date.now(` dans les fichiers de code. `Date.parse` est permis (comparaison des réceptions).
3. Aucune mutation des entrées (tableaux et objets reçus). Fonctions exportées nommées (`export function`), pas de classe, pas de `default export`.
4. Une entrée impossible lève `new RangeError(message)` ; un refus métier est une valeur renvoyée. Messages en français, sans tiret cadratin ni demi-cadratin.
5. Chaque fonction exportée porte un commentaire JSDoc court en français qui énonce la règle (une à trois lignes).
6. Aucun `any` explicite, aucun `eslint-disable`, aucun `console.*`.

### 1. `src/pharmacie/domaine/quantites.ts`

Signatures exactes et règles :

```ts
/** Lève une RangeError si la valeur n'est pas un entier supérieur ou égal au minimum. */
export function exigerEntier(valeur: number, nom: string, minimum: number): void;
```
- Lève si `!Number.isInteger(valeur) || valeur < minimum`. Message exact : `` `${nom} doit être un entier supérieur ou égal à ${minimum} (reçu : ${valeur}).` ``
- Pour « entier signé sans minimum », les appelants passent `Number.MIN_SAFE_INTEGER` comme minimum.

```ts
/** Arrondi à l'entier GNF le plus proche, moitié éloignée de zéro ; jamais -0. */
export function arrondiGnf(valeur: number): number;
```
- Lève une `RangeError` si `!Number.isFinite(valeur)` (message `` `Montant non fini (reçu : ${valeur}).` ``).
- `const r = Math.sign(valeur) * Math.round(Math.abs(valeur)); return r === 0 ? 0 : r;`

```ts
/** Nombre de boîtes vers unités minimales : n x coefficient. */
export function boitesVersUm(nombreBoites: number, coefficientBoite: number): number;
```
- `exigerEntier(nombreBoites, 'nombreBoites', 0)`, `exigerEntier(coefficientBoite, 'coefficientBoite', 1)`.

```ts
export interface BoitesEtUnites {
  boites: number;
  unites: number;
}
/** Unités minimales vers boîtes entières et unités restantes, tronqué vers zéro (symétrique pour un stock négatif). */
export function umVersBoites(quantiteUm: number, coefficientBoite: number): BoitesEtUnites;
```
- `exigerEntier(quantiteUm, 'quantiteUm', Number.MIN_SAFE_INTEGER)`, `exigerEntier(coefficientBoite, 'coefficientBoite', 1)`.
- `boites = Math.trunc(q / c)`, `unites = q - boites * c` ; normaliser `-0` en `0` sur les deux champs.

```ts
/** Coût d'achat par unité minimale depuis le coût d'une boîte, arrondi GNF (D413). */
export function coutUnitaireDepuisBoite(coutAchatBoite: number, coefficientBoite: number): number;
```
- `exigerEntier(coutAchatBoite, 'coutAchatBoite', 0)`, `exigerEntier(coefficientBoite, 'coefficientBoite', 1)` ; renvoie `arrondiGnf(coutAchatBoite / coefficientBoite)`.

```ts
/** Reliquat dérivé d'un lot : solde modulo coefficient de réception si solde > 0 et coefficient > 1, sinon 0 (D405). */
export function reliquatLot(soldeLot: number, coefficientReception: number): number;
```
- `exigerEntier(soldeLot, 'soldeLot', Number.MIN_SAFE_INTEGER)`, `exigerEntier(coefficientReception, 'coefficientReception', 1)`.
- `soldeLot > 0 && coefficientReception > 1 ? soldeLot % coefficientReception : 0`.

```ts
export type EtatStock = 'RUPTURE' | 'BAS' | 'NORMAL';
/** Rupture si quantité <= 0 ; bas si 0 < quantité < seuil x coefficient (seuil en boîtes, arbitrage A4) ; sinon normal. */
export function etatStock(quantiteUm: number, coefficientBoite: number, seuilBoites: number): EtatStock;
```
- `exigerEntier(quantiteUm, 'quantiteUm', Number.MIN_SAFE_INTEGER)`, `exigerEntier(coefficientBoite, 'coefficientBoite', 1)`, `exigerEntier(seuilBoites, 'seuilBoites', 0)`.
- Comparaison entière, sans division : `q <= 0` RUPTURE ; `q < seuilBoites * coefficientBoite` BAS ; sinon NORMAL.

### 2. `src/pharmacie/domaine/prix.ts`

```ts
import { arrondiGnf, exigerEntier } from './quantites';

/** Unité d'une ligne de vente (valeurs identiques au futur enum Prisma UniteVente, PB09). */
export type UniteVente = 'BOITE' | 'UNITE';

export interface EntreeLigne {
  unite: UniteVente;
  /** Nombre saisi : boîtes ou unités minimales. */
  nombre: number;
  coefficientBoite: number;
  /** Prix de vente de la boîte (colonne StockMedicament.prixUnitaire, D409). */
  prixBoite: number | null;
  prixUnite: number | null;
  deconditionnable: boolean;
}

export type CodeRefusLigne = 'VENTE_UNITE_INTERDITE' | 'PRIX_UNITE_MANQUANT' | 'PRIX_MANQUANT';

export interface LigneCalculee {
  ok: true;
  uniteAffichee: UniteVente;
  nombreAffiche: number;
  coefficientApplique: number;
  quantiteUm: number;
  prixAppliqueParUm: number;
  montantLigne: number;
}

export interface RefusLigne {
  ok: false;
  code: CodeRefusLigne;
}

export type ResultatLigne = LigneCalculee | RefusLigne;

/** Calcule une ligne de vente : quantité en UM, prix appliqué par UM (affichage), montant de ligne (référence des totaux). */
export function calculerLigne(entree: EntreeLigne): ResultatLigne;
```

Règles de `calculerLigne`, dans cet ordre :
1. `exigerEntier(entree.nombre, 'nombre', 1)`, `exigerEntier(entree.coefficientBoite, 'coefficientBoite', 1)`. Si `prixBoite` (resp. `prixUnite`) n'est pas `null`, `exigerEntier(prix, 'prixBoite' | 'prixUnite', 0)`.
2. `unite === 'UNITE'` et `!deconditionnable` : `{ ok: false, code: 'VENTE_UNITE_INTERDITE' }` (même si un prix unité est renseigné).
3. `unite === 'UNITE'` et (`prixUnite === null` ou `prixUnite === 0`) : `{ ok: false, code: 'PRIX_UNITE_MANQUANT' }`.
4. `unite === 'BOITE'` et (`prixBoite === null` ou `prixBoite === 0`) : `{ ok: false, code: 'PRIX_MANQUANT' }`.
5. UNITE : `quantiteUm = nombre`, `prixAppliqueParUm = prixUnite`, `montantLigne = nombre * prixUnite`, `coefficientApplique = 1`. Le prix boîte n'intervient jamais.
6. BOITE : `quantiteUm = nombre * coefficientBoite`, `prixAppliqueParUm = arrondiGnf(prixBoite / coefficientBoite)`, `montantLigne = nombre * prixBoite`, `coefficientApplique = coefficientBoite`. Le prix unité n'intervient jamais.
7. Toujours `uniteAffichee = unite`, `nombreAffiche = nombre`. Invariant : `quantiteUm === nombreAffiche * coefficientApplique`.
8. Le dépassement de 2147483647 n'est pas contrôlé ici (le service garde sa contrainte `totalMaximal`).

```ts
export interface AvertissementPrix {
  code: 'ECART_PRIX';
  ecartPct: number;
}
/** Avertissement non bloquant si prix unité x coefficient s'écarte du prix boîte de plus de seuilPct % (D472). */
export function avertissementEcartPrix(
  prixBoite: number | null,
  prixUnite: number | null,
  coefficientBoite: number,
  seuilPct: number,
): AvertissementPrix | null;
```
Règles : `exigerEntier(coefficientBoite, 'coefficientBoite', 1)`, `exigerEntier(seuilPct, 'seuilPct', 0)` ; prix non nuls contrôlés par `exigerEntier(prix, nom, 0)`. Renvoie `null` si `prixBoite` ou `prixUnite` vaut `null` ou 0. Sinon `ecart = Math.abs(prixUnite * coefficientBoite - prixBoite)` ; avertissement si et seulement si `ecart * 100 > seuilPct * prixBoite` (strict), avec `ecartPct = Math.round((ecart * 100) / prixBoite)`.

### 3. `src/pharmacie/domaine/selection-lots.ts`

```ts
import { exigerEntier, reliquatLot } from './quantites';
import { UniteVente } from './prix';

/** Lot candidat à une sortie, avec son solde courant (agrégat du lot). */
export interface LotCandidat {
  id: string;
  numeroLot: string | null;
  /** AAAA-MM-JJ ou null (sans péremption). */
  dateExpiration: string | null;
  /** ISO 8601. */
  dateReception: string;
  /** Solde du lot en UM, >= 0 (D404). */
  solde: number;
  coefficientReception: number;
  coutUnitaire: number;
  lotTechnique: boolean;
}

export interface DemandeSelection {
  /** Jour courant à Conakry, AAAA-MM-JJ. */
  jour: string;
  unite: UniteVente;
  quantiteUm: number;
  lots: LotCandidat[];
}

/** Allocation calculée : champs du lot recopiés (la demande exige une copie, pas une référence). */
export interface AllocationCalculee {
  lotId: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  quantite: number;
  coutUnitaire: number;
  lotTechnique: boolean;
}

/** Forme identique aux `details[].lots` du futur 409 SORTIE_MANUELLE_REQUISE (plan 3.1). */
export interface LotPerimeDisponible {
  lotId: string;
  numeroLot: string | null;
  dateExpiration: string;
  quantite: number;
}

export interface ResultatSelection {
  allocations: AllocationCalculee[];
  resteProvisoire: number;
  lotsPerimesDisponibles: LotPerimeDisponible[];
}

/** Un lot est périmé si sa date est avant le jour courant ; le jour même reste vendable ; sans date, jamais périmé. */
export function estPerime(dateExpiration: string | null, jour: string): boolean;

/** Ordre FEFO : date nulle d'abord, date croissante, réception croissante, identifiant croissant. */
export function comparerFefo(a: LotCandidat, b: LotCandidat): number;

/** Lots dans l'ordre où une vente à l'unité les prendrait : lots éligibles à reliquat (FEFO), puis les autres (FEFO). */
export function ordonnerLotsPourVente(lots: LotCandidat[], jour: string): LotCandidat[];

/** Sélection automatique reliquat puis FEFO (D473), sans jamais prendre un lot périmé ; le reste non couvert est provisoire. */
export function selectionnerLots(demande: DemandeSelection): ResultatSelection;
```

Validation (fonction interne `validerLots(lots: LotCandidat[], jour: string): void`, appelée par `ordonnerLotsPourVente` et `selectionnerLots`) :
- `jour` doit vérifier `/^\d{4}-\d{2}-\d{2}$/`, sinon `RangeError` `` `Jour invalide, format AAAA-MM-JJ attendu (reçu : ${jour}).` `` ; même contrôle dans `estPerime` pour `jour`, et pour `dateExpiration` quand elle n'est pas `null` (message `` `Date de péremption invalide, format AAAA-MM-JJ attendu (reçu : ${dateExpiration}).` ``).
- Pour chaque lot : `exigerEntier(lot.solde, 'solde', 0)`, `exigerEntier(lot.coefficientReception, 'coefficientReception', 1)`, `exigerEntier(lot.coutUnitaire, 'coutUnitaire', 0)`, format de `dateExpiration` comme ci-dessus, `Number.isNaN(Date.parse(lot.dateReception))` : `RangeError` `` `Date de réception invalide (reçue : ${lot.dateReception}).` `` ; identifiant déjà vu : `RangeError` `` `Lot en double dans la sélection : ${lot.id}.` ``.
- `selectionnerLots` contrôle en plus `exigerEntier(quantiteUm, 'quantiteUm', 1)`.

`estPerime` : `dateExpiration !== null && dateExpiration < jour` (comparaison de chaînes AAAA-MM-JJ, exacte).

`comparerFefo(a, b)`, dans cet ordre, premier critère non nul :
1. `a.dateExpiration === null` et `b` datée : -1 ; inverse : 1 ; deux nulles : critère suivant.
2. dates différentes : `a.dateExpiration < b.dateExpiration ? -1 : 1`.
3. `Date.parse(a.dateReception) - Date.parse(b.dateReception)` si non nul (signe seulement).
4. identifiants : `a.id < b.id ? -1 : a.id > b.id ? 1 : 0` (unités de code, jamais `localeCompare`).

`ordonnerLotsPourVente(lots, jour)` : `validerLots` ; éligibles = `lots.filter(l => l.solde > 0 && !estPerime(l.dateExpiration, jour))` copiés puis triés par `comparerFefo` ; renvoie `[...éligibles à reliquatLot > 0, ...éligibles à reliquat 0]` en gardant l'ordre FEFO dans chaque groupe. (Servira à PB08 pour la `dateExpiration` exposée, plan 1.7.)

`selectionnerLots(demande)`, algorithme exact :
```
validerLots(demande.lots, demande.jour) ; exigerEntier(quantiteUm, 'quantiteUm', 1)
eligibles = lots avec solde > 0 et non périmés, copie triée par comparerFefo
pris = new Map<string, number>()        // ordre d'insertion = ordre de première prise
reste = quantiteUm
prendre(lot, maximum): q = Math.min(reste, maximum) ; si q > 0 : pris.set(lot.id, (pris.get(lot.id) ?? 0) + q) ; reste -= q
disponible(lot) = lot.solde - (pris.get(lot.id) ?? 0)
si unite === 'UNITE' :
  pour chaque lot de eligibles (ordre FEFO) : prendre(lot, reliquatLot(lot.solde, lot.coefficientReception))
  pour chaque lot de eligibles (ordre FEFO) : prendre(lot, disponible(lot))
si unite === 'BOITE' :
  pour chaque lot de eligibles (ordre FEFO) : prendre(lot, lot.solde - reliquatLot(lot.solde, lot.coefficientReception))
  pour chaque lot de eligibles (ordre FEFO) : prendre(lot, disponible(lot))
arrêter les boucles dès que reste === 0
allocations = pour chaque [lotId, quantite] de pris : { lotId, numeroLot, dateExpiration, quantite, coutUnitaire, lotTechnique } recopiés du lot
lotsPerimesDisponibles = reste > 0
  ? lots avec solde > 0 et estPerime, copie triée par comparerFefo, en { lotId, numeroLot, dateExpiration, quantite: solde }
  : []
renvoyer { allocations, resteProvisoire: reste, lotsPerimesDisponibles }
```
Invariants (testés) : `somme(allocations.quantite) + resteProvisoire === quantiteUm` ; aucune allocation ne dépasse le solde de son lot ; aucune allocation sur un lot périmé ou à solde nul ; une seule allocation par lot.

Hors périmètre de cette fonction (décidé, ne pas implémenter) : la sortie manuelle d'un lot choisi (PB11), le choix entre 409 `SORTIE_MANUELLE_REQUISE` et allocation provisoire (PB11, PB18), le maintien de `ConditionnementOuvert` (PB08).

### 4. `src/pharmacie/domaine/caisse.ts`

```ts
import { exigerEntier } from './quantites';

/** Code du mode de paiement compté physiquement et porteur du fond de caisse. */
export const CODE_ESPECES = 'ESPECES';

export type TypeMouvementCaisse = 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';

export interface LigneComptageCalcul {
  valeurFaciale: number;
  nombre: number;
}

export interface PaiementCalcul {
  mode: string;
  /** Signé : négatif pour une pièce d'annulation. */
  montant: number;
}

export interface MouvementCaisseCalcul {
  type: TypeMouvementCaisse;
  mode: string;
  /** Strictement positif (CHECK du plan 1.5). */
  montant: number;
}

export interface EntreeTheorique {
  /** Codes de TOUS les modes de paiement connus, actifs ou non, dans l'ordre d'affichage. */
  modes: string[];
  /** Total du comptage d'ouverture (0 si absent). */
  fondEspeces: number;
  paiements: PaiementCalcul[];
  mouvements: MouvementCaisseCalcul[];
}

export interface TheoriqueMode {
  mode: string;
  theorique: number;
}

/** Total d'un comptage par coupure : somme de valeur faciale x nombre. */
export function totalComptage(lignes: LigneComptageCalcul[]): number;

/** Théorique par mode (D474) : fond si espèces, plus paiements et apports, moins prélèvements et remboursements du mode. */
export function calculerTheorique(entree: EntreeTheorique): TheoriqueMode[];

/** Écart signé compté moins théorique, jamais corrigé ; null sans comptage (non rapproché). */
export function ecartCaisse(compte: number | null, theorique: number): number | null;
```

Règles :
- `totalComptage` : pour chaque ligne `exigerEntier(valeurFaciale, 'valeurFaciale', 1)`, `exigerEntier(nombre, 'nombre', 0)` ; liste vide : 0.
- `calculerTheorique` :
  - `exigerEntier(fondEspeces, 'fondEspeces', 0)` ; modes en double : `RangeError` `` `Mode de paiement en double : ${mode}.` `` ;
  - si `fondEspeces > 0` et `CODE_ESPECES` absent de `modes` : `RangeError` `Le fond de caisse exige le mode ESPECES.` ;
  - paiement ou mouvement d'un mode absent de `modes` : `RangeError` `` `Mode de paiement inconnu : ${mode}.` `` ;
  - paiement : `exigerEntier(montant, 'montant', Number.MIN_SAFE_INTEGER)` ; mouvement : `exigerEntier(montant, 'montant', 1)` ;
  - pour chaque mode, dans l'ordre de `modes` : `theorique = (mode === CODE_ESPECES ? fondEspeces : 0) + somme(paiements du mode) + somme(APPORT du mode) - somme(PRELEVEMENT du mode) - somme(REMBOURSEMENT du mode)` ; un mode sans opération vaut 0 et figure dans le résultat.
- `ecartCaisse` : `compte === null ? null : compte - theorique` ; `exigerEntier` signé sur les deux nombres.

### 5. `src/pharmacie/domaine/marge.ts`

```ts
import { exigerEntier } from './quantites';

export type StatutAllocationCalcul = 'DEFINITIVE' | 'PROVISOIRE' | 'REMPLACEE';

export interface AllocationMarge {
  /** UM, signée (négative dans une pièce d'annulation). */
  quantite: number;
  coutUnitaire: number;
  lotTechnique: boolean;
  statut: StatutAllocationCalcul;
}

export interface LigneMarge {
  /** LigneVente.sousTotal, signé. */
  montantLigne: number;
  allocations: AllocationMarge[];
}

export interface VenteMarge {
  id: string;
  lignes: LigneMarge[];
}

export interface ResultatMarge {
  chiffreAffairesValorise: number;
  coutAlloue: number;
  marge: number;
  nonValorisable: { nombreVentes: number; nombreLignes: number; chiffreAffaires: number };
  provisoires: { nombreLignes: number; chiffreAffaires: number };
}

/** Marge réelle depuis les allocations (D475) : provisoires à part par ligne, ventes non valorisables à part, jamais de coût inventé. */
export function calculerMarge(ventes: VenteMarge[]): ResultatMarge;
```

Algorithme exact, vente par vente :
1. Contrôles : `exigerEntier` signé sur `montantLigne` et `quantite`, `exigerEntier(coutUnitaire, 'coutUnitaire', 0)`.
2. Pour chaque ligne, `actives = allocations.filter(a => a.statut !== 'REMPLACEE')`.
3. Ligne provisoire = au moins une allocation active `PROVISOIRE` : `provisoires.nombreLignes += 1`, `provisoires.chiffreAffaires += montantLigne` ; la ligne sort de la suite du calcul.
4. Lignes restantes (résolues) : si aucune, la vente s'arrête là.
5. Ligne « en cause » = `actives.length === 0` (aucune allocation, ventes historiques D422) ou au moins une active avec `coutUnitaire === 0` ou `lotTechnique`.
6. S'il existe au moins une ligne en cause parmi les restantes : `nonValorisable.nombreVentes += 1`, `nonValorisable.nombreLignes += nombre de lignes en cause`, `nonValorisable.chiffreAffaires += somme des montantLigne des lignes restantes` (toutes, en cause ou non).
7. Sinon : `chiffreAffairesValorise += somme des montantLigne des lignes restantes`, `coutAlloue += somme(quantite x coutUnitaire)` des allocations actives de ces lignes.
8. À la fin : `marge = chiffreAffairesValorise - coutAlloue`. Liste vide : tous les champs à 0. Normaliser `-0` en `0` sur chaque nombre renvoyé.

### 6. `test/vecteurs/selection-lots.json`

Contenu exact (à recopier tel quel, indentation 2 espaces, fin de fichier par un saut de ligne) :

```json
{
  "version": 1,
  "description": "Vecteurs de la sélection de lots (reliquat puis FEFO, D473). Source unique : back_medconnect/test/vecteurs/selection-lots.json, copiée à l'identique dans le front (PF01). Soldes et quantités en unités minimales ; dates de péremption AAAA-MM-JJ ; jour = jour courant à Conakry. attendu.allocations : lotId et quantite dans l'ordre de première prise ; attendu.lotsPerimesDisponibles : identifiants dans l'ordre FEFO.",
  "cas": [
    {
      "nom": "V01 CA5 : ouverture d'une plaquette de 20 pour 6 unités",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 6,
        "lots": [
          { "id": "L1", "numeroLot": "A123", "dateExpiration": "2027-06-30", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 40, "coefficientReception": 20, "coutUnitaire": 250, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "L1", "quantite": 6 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V02 CA7 : le reliquat du lot B sort avant le lot A qui périme plus tôt",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 4,
        "lots": [
          { "id": "A", "numeroLot": "A-01", "dateExpiration": "2027-03-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 20, "coefficientReception": 20, "coutUnitaire": 280, "lotTechnique": false },
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 26, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "B", "quantite": 4 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V03 CA7 : reliquat du lot B épuisé exactement",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 6,
        "lots": [
          { "id": "A", "numeroLot": "A-01", "dateExpiration": "2027-03-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 20, "coefficientReception": 20, "coutUnitaire": 280, "lotTechnique": false },
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 26, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "B", "quantite": 6 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V04 CA7 : le lot A prend la main à l'ouverture suivante",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 10,
        "lots": [
          { "id": "A", "numeroLot": "A-01", "dateExpiration": "2027-03-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 20, "coefficientReception": 20, "coutUnitaire": 280, "lotTechnique": false },
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 26, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "B", "quantite": 6 }, { "lotId": "A", "quantite": 4 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V05 CA9 : deux allocations, le lot à 30 jours vidé d'abord",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 30,
        "lots": [
          { "id": "L90", "numeroLot": "N-90", "dateExpiration": "2027-01-30", "dateReception": "2026-09-15T08:00:00.000Z", "solde": 50, "coefficientReception": 10, "coutUnitaire": 120, "lotTechnique": false },
          { "id": "L30", "numeroLot": "N-30", "dateExpiration": "2026-12-01", "dateReception": "2026-10-15T08:00:00.000Z", "solde": 20, "coefficientReception": 10, "coutUnitaire": 100, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "L30", "quantite": 20 }, { "lotId": "L90", "quantite": 10 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V06 CA10 : un lot sans date sort avant un lot daté",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 5,
        "lots": [
          { "id": "DATE", "numeroLot": "D-15", "dateExpiration": "2026-11-15", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 90, "lotTechnique": false },
          { "id": "TECH", "numeroLot": null, "dateExpiration": null, "dateReception": "2026-10-25T00:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 0, "lotTechnique": true }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "TECH", "quantite": 5 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V07 CA10 : le lot sans date est vidé puis le lot daté complète",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 12,
        "lots": [
          { "id": "DATE", "numeroLot": "D-15", "dateExpiration": "2026-11-15", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 90, "lotTechnique": false },
          { "id": "TECH", "numeroLot": null, "dateExpiration": null, "dateReception": "2026-10-25T00:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 0, "lotTechnique": true }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "TECH", "quantite": 10 }, { "lotId": "DATE", "quantite": 2 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V08 Égalité de péremption : le lot reçu le plus tôt sort d'abord",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 3,
        "lots": [
          { "id": "R2", "numeroLot": "R-2", "dateExpiration": "2027-01-31", "dateReception": "2026-10-05T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 100, "lotTechnique": false },
          { "id": "R1", "numeroLot": "R-1", "dateExpiration": "2027-01-31", "dateReception": "2026-09-05T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 110, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "R1", "quantite": 3 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V09 Égalité de péremption et de réception : le plus petit identifiant d'abord",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 3,
        "lots": [
          { "id": "L-B", "numeroLot": "X-B", "dateExpiration": "2027-01-31", "dateReception": "2026-09-05T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 100, "lotTechnique": false },
          { "id": "L-A", "numeroLot": "X-A", "dateExpiration": "2027-01-31", "dateReception": "2026-09-05T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 100, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "L-A", "quantite": 3 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V10 CA13 : un lot périmé n'est jamais pris automatiquement",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 5,
        "lots": [
          { "id": "PER", "numeroLot": "P-31", "dateExpiration": "2026-10-31", "dateReception": "2026-05-01T08:00:00.000Z", "solde": 50, "coefficientReception": 1, "coutUnitaire": 80, "lotTechnique": false },
          { "id": "OK", "numeroLot": "O-31", "dateExpiration": "2027-01-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 10, "coefficientReception": 1, "coutUnitaire": 90, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "OK", "quantite": 5 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V11 Un lot qui périme aujourd'hui reste vendable",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 2,
        "lots": [
          { "id": "J", "numeroLot": "J-0", "dateExpiration": "2026-11-01", "dateReception": "2026-08-01T08:00:00.000Z", "solde": 5, "coefficientReception": 1, "coutUnitaire": 70, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "J", "quantite": 2 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V12 CA13 : seuls des lots périmés, reste provisoire et périmés listés",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 3,
        "lots": [
          { "id": "P1", "numeroLot": "P-15", "dateExpiration": "2026-10-15", "dateReception": "2026-04-01T08:00:00.000Z", "solde": 8, "coefficientReception": 1, "coutUnitaire": 70, "lotTechnique": false },
          { "id": "P2", "numeroLot": "P-30", "dateExpiration": "2026-09-30", "dateReception": "2026-05-01T08:00:00.000Z", "solde": 4, "coefficientReception": 1, "coutUnitaire": 75, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [], "resteProvisoire": 3, "lotsPerimesDisponibles": ["P2", "P1"] }
    },
    {
      "nom": "V13 Aucun lot : toute la quantité est provisoire",
      "entree": { "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 4, "lots": [] },
      "attendu": { "allocations": [], "resteProvisoire": 4, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V14 Stock insuffisant : lot vidé puis reste provisoire",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 5,
        "lots": [
          { "id": "S", "numeroLot": "S-1", "dateExpiration": "2027-02-28", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 3, "coefficientReception": 1, "coutUnitaire": 95, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "S", "quantite": 3 }], "resteProvisoire": 2, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V15 Le reliquat d'un lot périmé est ignoré",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 3,
        "lots": [
          { "id": "PR", "numeroLot": "P-20", "dateExpiration": "2026-10-20", "dateReception": "2026-03-01T08:00:00.000Z", "solde": 15, "coefficientReception": 10, "coutUnitaire": 60, "lotTechnique": false },
          { "id": "VA", "numeroLot": "V-28", "dateExpiration": "2027-02-28", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 20, "coefficientReception": 10, "coutUnitaire": 65, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "VA", "quantite": 3 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V16 Plusieurs reliquats : sortis dans l'ordre FEFO avant toute ouverture",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 9,
        "lots": [
          { "id": "R1", "numeroLot": "R-05", "dateExpiration": "2027-05-31", "dateReception": "2026-08-01T08:00:00.000Z", "solde": 13, "coefficientReception": 10, "coutUnitaire": 50, "lotTechnique": false },
          { "id": "R2", "numeroLot": "R-02", "dateExpiration": "2027-02-28", "dateReception": "2026-08-15T08:00:00.000Z", "solde": 24, "coefficientReception": 10, "coutUnitaire": 55, "lotTechnique": false },
          { "id": "I", "numeroLot": "I-12", "dateExpiration": "2026-12-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 10, "coefficientReception": 10, "coutUnitaire": 60, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "R2", "quantite": 4 }, { "lotId": "R1", "quantite": 3 }, { "lotId": "I", "quantite": 2 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V17 Un même lot pris au reliquat puis à l'ouverture : une seule allocation",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 15,
        "lots": [
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 26, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false },
          { "id": "A", "numeroLot": "A-01", "dateExpiration": "2027-03-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 5, "coefficientReception": 1, "coutUnitaire": 280, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "B", "quantite": 10 }, { "lotId": "A", "quantite": 5 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V18 Un lot à solde nul est ignoré",
      "entree": {
        "jour": "2026-11-01", "unite": "UNITE", "quantiteUm": 2,
        "lots": [
          { "id": "Z", "numeroLot": "Z-0", "dateExpiration": "2026-11-10", "dateReception": "2026-07-01T08:00:00.000Z", "solde": 0, "coefficientReception": 1, "coutUnitaire": 80, "lotTechnique": false },
          { "id": "L", "numeroLot": "L-1", "dateExpiration": "2027-01-01", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 5, "coefficientReception": 1, "coutUnitaire": 85, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "L", "quantite": 2 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V19 Vente par boîte : boîte intacte du lot FEFO, le reliquat du lot B est laissé",
      "entree": {
        "jour": "2026-11-01", "unite": "BOITE", "quantiteUm": 20,
        "lots": [
          { "id": "A", "numeroLot": "A-01", "dateExpiration": "2027-03-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 40, "coefficientReception": 20, "coutUnitaire": 280, "lotTechnique": false },
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 26, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "A", "quantite": 20 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V20 Vente par boîte : prise sur les boîtes intactes sans entamer le reliquat",
      "entree": {
        "jour": "2026-11-01", "unite": "BOITE", "quantiteUm": 20,
        "lots": [
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 46, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "B", "quantite": 20 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V21 Vente par boîte : boîtes intactes insuffisantes, reliquats puis provisoire",
      "entree": {
        "jour": "2026-11-01", "unite": "BOITE", "quantiteUm": 40,
        "lots": [
          { "id": "B", "numeroLot": "B-02", "dateExpiration": "2027-09-30", "dateReception": "2026-09-01T08:00:00.000Z", "solde": 26, "coefficientReception": 20, "coutUnitaire": 300, "lotTechnique": false },
          { "id": "C", "numeroLot": "C-01", "dateExpiration": "2027-01-31", "dateReception": "2026-09-20T08:00:00.000Z", "solde": 8, "coefficientReception": 20, "coutUnitaire": 310, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "B", "quantite": 26 }, { "lotId": "C", "quantite": 8 }], "resteProvisoire": 6, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V22 Vente par boîte sur plusieurs lots",
      "entree": {
        "jour": "2026-11-01", "unite": "BOITE", "quantiteUm": 30,
        "lots": [
          { "id": "B", "numeroLot": "B-06", "dateExpiration": "2027-06-30", "dateReception": "2026-10-10T08:00:00.000Z", "solde": 30, "coefficientReception": 10, "coutUnitaire": 105, "lotTechnique": false },
          { "id": "A", "numeroLot": "A-12", "dateExpiration": "2026-12-31", "dateReception": "2026-10-01T08:00:00.000Z", "solde": 20, "coefficientReception": 10, "coutUnitaire": 100, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "A", "quantite": 20 }, { "lotId": "B", "quantite": 10 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    },
    {
      "nom": "V23 Vente par boîte : seul un lot périmé, reste provisoire",
      "entree": {
        "jour": "2026-11-01", "unite": "BOITE", "quantiteUm": 10,
        "lots": [
          { "id": "P", "numeroLot": "P-01", "dateExpiration": "2026-10-01", "dateReception": "2026-01-10T08:00:00.000Z", "solde": 20, "coefficientReception": 10, "coutUnitaire": 90, "lotTechnique": false }
        ]
      },
      "attendu": { "allocations": [], "resteProvisoire": 10, "lotsPerimesDisponibles": ["P"] }
    },
    {
      "nom": "V24 Lot technique repris à coefficient 1 vendu par boîte de la fiche",
      "entree": {
        "jour": "2026-11-01", "unite": "BOITE", "quantiteUm": 20,
        "lots": [
          { "id": "TECH", "numeroLot": null, "dateExpiration": null, "dateReception": "2026-10-25T00:00:00.000Z", "solde": 30, "coefficientReception": 1, "coutUnitaire": 0, "lotTechnique": true }
        ]
      },
      "attendu": { "allocations": [{ "lotId": "TECH", "quantite": 20 }], "resteProvisoire": 0, "lotsPerimesDisponibles": [] }
    }
  ]
}
```

Le JSON ci-dessus est valide tel quel ; si prettier n'est pas appliqué aux `.json` (il ne l'est pas : ESLint ne lit que les `.ts`), garder la mise en forme compacte des lots sur une ligne.

### 7. Tests à écrire (noms exacts, `describe` puis `it`)

Tous les tests en français, `expect(...).toBe` / `toEqual` / `toThrow(RangeError)`. Pas de `it.skip`, pas de `it.only`.

**`src/pharmacie/domaine/quantites.spec.ts`**, `describe('quantites (domaine pharmacie)')` :
1. `it('arrondiGnf arrondit au plus proche, moitié éloignée de zéro')` : `arrondiGnf(2.5)` 3, `arrondiGnf(-2.5)` -3, `arrondiGnf(2.4999)` 2, `arrondiGnf(10000 / 3)` 3333, `arrondiGnf(62.5)` 63, `Object.is(arrondiGnf(-0.4), 0)` vrai.
2. `it('arrondiGnf refuse un nombre non fini')` : `NaN` et `Infinity` lèvent `RangeError`.
3. `it('boitesVersUm multiplie par le coefficient')` : `(3, 20)` 60, `(0, 20)` 0 ; `(1.5, 20)`, `(-1, 20)`, `(2, 0)` lèvent `RangeError`.
4. `it('umVersBoites donne boîtes entières et unités restantes')` : `(34, 20)` `{ boites: 1, unites: 14 }`, `(40, 20)` `{ boites: 2, unites: 0 }`, `(0, 20)` `{ boites: 0, unites: 0 }`, `(7, 1)` `{ boites: 7, unites: 0 }`.
5. `it('umVersBoites est symétrique pour un stock négatif, sans -0')` : `(-25, 20)` `{ boites: -1, unites: -5 }` ; `(-20, 20)` : `boites` -1 et `Object.is(unites, 0)` vrai ; `(-3, 20)` : `Object.is(boites, 0)` vrai et `unites` -3.
6. `it('coutUnitaireDepuisBoite arrondit le coût par UM (D413)')` : `(7500, 20)` 375, `(1000, 3)` 333, `(500, 8)` 63, `(0, 20)` 0 ; `(-1, 20)` lève.
7. `it('reliquatLot : CA5, 14 unités restent après 6 sur une plaquette de 20')` : `reliquatLot(40 - 6, 20)` 14.
8. `it('reliquatLot vaut 0 sans plaquette entamée')` : `(40, 20)` 0, `(26, 1)` 0, `(0, 20)` 0, `(-5, 20)` 0 ; `(26, 20)` 6.
9. `it('reliquatLot refuse un coefficient inférieur à 1')` : `(10, 0)` lève.
10. `it('etatStock : seuil en boîtes, identique à aujourd hui à coefficient 1 (A4)')` : `(9, 1, 10)` BAS, `(10, 1, 10)` NORMAL, `(1, 1, 10)` BAS, `(0, 1, 10)` RUPTURE.
11. `it('etatStock : seuil multiplié par le coefficient')` : `(199, 20, 10)` BAS, `(200, 20, 10)` NORMAL, `(1, 20, 10)` BAS.
12. `it('etatStock : un stock négatif est une rupture (D416)')` : `(-3, 1, 10)` RUPTURE, `(-3, 20, 10)` RUPTURE ; `(5, 1, 0)` NORMAL (seuil 0 : jamais bas).
13. `it('exigerEntier nomme le champ dans le message')` : `expect(() => exigerEntier(1.5, 'solde', 0)).toThrow('solde doit être un entier supérieur ou égal à 0 (reçu : 1.5).')`.

**`src/pharmacie/domaine/prix.spec.ts`**, `describe('calculerLigne (domaine pharmacie)')` puis `describe('avertissementEcartPrix (domaine pharmacie)')`. Fiche de référence : `const fiche = { coefficientBoite: 20, prixBoite: 10000, prixUnite: 600, deconditionnable: true }`.
1. `it('CA1 : 6 unités à 600 donnent 6 UM et 3 600 GNF')` : `calculerLigne({ ...fiche, unite: 'UNITE', nombre: 6 })` `toEqual({ ok: true, uniteAffichee: 'UNITE', nombreAffiche: 6, coefficientApplique: 1, quantiteUm: 6, prixAppliqueParUm: 600, montantLigne: 3600 })`.
2. `it('CA1 : le prix boîte n intervient pas dans une vente à l unité')` : même appel avec `prixBoite: null` puis `prixBoite: 99999` : résultat identique au test 1.
3. `it('CA2 : une boîte de 20 à 10 000 donne 20 UM, 500 par UM et 10 000 GNF')` : `toEqual({ ok: true, uniteAffichee: 'BOITE', nombreAffiche: 1, coefficientApplique: 20, quantiteUm: 20, prixAppliqueParUm: 500, montantLigne: 10000 })` ; vérifier explicitement `montantLigne` différent de 200000.
4. `it('L arrondi est porté par le prix affiché, jamais par le montant de ligne')` : `{ unite: 'BOITE', nombre: 3, coefficientBoite: 3, prixBoite: 1000, prixUnite: null, deconditionnable: false }` : `quantiteUm` 9, `prixAppliqueParUm` 333, `montantLigne` 3000 ; `{ unite: 'BOITE', nombre: 1, coefficientBoite: 8, prixBoite: 500, ... }` : `prixAppliqueParUm` 63, `montantLigne` 500.
5. `it('Coefficient 1 par boîte : identique au calcul actuel prix x quantité')` : `{ unite: 'BOITE', nombre: 2, coefficientBoite: 1, prixBoite: 1500, prixUnite: null, deconditionnable: false }` : `quantiteUm` 2, `prixAppliqueParUm` 1500, `montantLigne` 3000.
6. `it('CA3 au calcul : changer le prix boîte ne change pas une ligne à l unité, et réciproquement')` : ligne UNITE identique avec `prixBoite` 10000 et 12000 ; ligne BOITE identique avec `prixUnite` 600 et 700.
7. `it('CA4 : vente à l unité refusée sur une fiche non déconditionnable, même avec un prix unité')` : `{ ...fiche, deconditionnable: false, unite: 'UNITE', nombre: 2 }` `toEqual({ ok: false, code: 'VENTE_UNITE_INTERDITE' })`.
8. `it('CA4 : la même fiche se vend par boîte')` : `{ ...fiche, deconditionnable: false, prixUnite: null, unite: 'BOITE', nombre: 1 }` : `ok` vrai, `montantLigne` 10000.
9. `it('Prix unité absent ou nul : PRIX_UNITE_MANQUANT')` : `prixUnite: null` puis `prixUnite: 0`.
10. `it('Prix boîte absent ou nul : PRIX_MANQUANT')` : `prixBoite: null` puis `prixBoite: 0`, `unite: 'BOITE'`.
11. `it('Entrées impossibles : RangeError')` : `nombre: 0`, `nombre: 1.5`, `coefficientBoite: 0`, `prixUnite: -1`.
12. `it('Invariant : quantiteUm = nombreAffiche x coefficientApplique')` : sur les deux unités, pour `nombre` dans `[1, 2, 7]` et `coefficientBoite` dans `[1, 10, 20]` (prix 1000 et 60, déconditionnable).
13. `it('Écart de 20 % sous le seuil de 25 : aucun avertissement')` : `avertissementEcartPrix(10000, 600, 20, 25)` `toBeNull()`.
14. `it('Écart de 30 % : avertissement ECART_PRIX 30')` : `(10000, 650, 20, 25)` `toEqual({ code: 'ECART_PRIX', ecartPct: 30 })`.
15. `it('Écart égal au seuil : aucun avertissement, au-delà : avertissement')` : `(10000, 625, 20, 25)` null ; `(10000, 370, 20, 25)` `{ code: 'ECART_PRIX', ecartPct: 26 }` ; `(10000, 375, 20, 25)` null.
16. `it('Prix unité moins cher que la boîte : l écart compte en valeur absolue')` : `(10000, 300, 20, 25)` `{ code: 'ECART_PRIX', ecartPct: 40 }`.
17. `it('Un prix absent ou nul : jamais d avertissement')` : `(null, 600, 20, 25)`, `(10000, null, 20, 25)`, `(0, 600, 20, 25)`, `(10000, 0, 20, 25)` : null.
18. `it('Seuil 0 : avertissement dès le moindre écart')` : `(10000, 500, 20, 0)` null ; `(10000, 501, 20, 0)` `{ code: 'ECART_PRIX', ecartPct: 0 }` (écart 20 sur 10000 : 0,2 % arrondi à 0, l'avertissement part quand même car 2000 > 0).

**`src/pharmacie/domaine/selection-lots.spec.ts`** :

En tête :
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
// types locaux du fichier de vecteurs
interface CasVecteur {
  nom: string;
  entree: DemandeSelection;
  attendu: { allocations: { lotId: string; quantite: number }[]; resteProvisoire: number; lotsPerimesDisponibles: string[] };
}
interface FichierVecteurs { version: number; description: string; cas: CasVecteur[] }
const fichier = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'test', 'vecteurs', 'selection-lots.json'), 'utf8'),
) as FichierVecteurs;
```
Une fabrique locale `lot(id: string, champs: Partial<LotCandidat>): LotCandidat` (défauts : `numeroLot: id`, `dateExpiration: '2027-01-31'`, `dateReception: '2026-10-01T08:00:00.000Z'`, `solde: 10`, `coefficientReception: 1`, `coutUnitaire: 100`, `lotTechnique: false`) pour les tests hors vecteurs.

`describe('selectionnerLots : vecteurs partagés back et front')` :
1. `it('le fichier de vecteurs est en version 1 et compte 24 cas')`.
2. `it.each(fichier.cas)('$nom', (cas) => { ... })` : projette le résultat en `{ allocations: r.allocations.map(a => ({ lotId: a.lotId, quantite: a.quantite })), resteProvisoire: r.resteProvisoire, lotsPerimesDisponibles: r.lotsPerimesDisponibles.map(l => l.lotId) }` et `toEqual(cas.attendu)` ; vérifie aussi, dans le même test, l'invariant `somme des quantites + resteProvisoire === entree.quantiteUm` et qu'aucune allocation ne dépasse le `solde` de son lot (24 tests).

`describe('selectionnerLots : règles')` :
3. `it('recopie les champs du lot dans chaque allocation (CA11)')` : vecteur V04 : allocation B `{ lotId: 'B', numeroLot: 'B-02', dateExpiration: '2027-09-30', quantite: 6, coutUnitaire: 300, lotTechnique: false }` et A `{ lotId: 'A', numeroLot: 'A-01', dateExpiration: '2027-03-31', quantite: 4, coutUnitaire: 280, lotTechnique: false }` (`toEqual` complet).
4. `it('ne modifie pas les lots reçus')` : `structuredClone` de l'entrée V21 avant appel, `toEqual` après appel.
5. `it('le résultat ne dépend pas de l ordre des lots reçus')` : V16 avec `lots` inversés : même résultat que V16.
6. `it('les lots périmés disponibles ont la forme du 409 SORTIE_MANUELLE_REQUISE')` : V12 : `toEqual([{ lotId: 'P2', numeroLot: 'P-30', dateExpiration: '2026-09-30', quantite: 4 }, { lotId: 'P1', numeroLot: 'P-15', dateExpiration: '2026-10-15', quantite: 8 }])`.
7. `it('aucun périmé listé quand la quantité est couverte')` : V10 : `lotsPerimesDisponibles` `[]`.
8. `it('refuse les entrées impossibles')` : `RangeError` pour `quantiteUm` 0, `quantiteUm` 1.5, `jour` `'2026-11-1'`, lot `coefficientReception` 0, lot `solde` -1, lot `coutUnitaire` -1, lot `dateExpiration` `'31/01/2027'`, `dateReception` `'pas une date'`, deux lots de même `id`.

`describe('estPerime, comparerFefo, ordonnerLotsPourVente')` :
9. `it('estPerime : veille périmée, jour même et futur vendables, sans date jamais périmé')` : `('2026-10-31', '2026-11-01')` vrai, `('2026-11-01', '2026-11-01')` faux, `('2026-11-02', '2026-11-01')` faux, `(null, '2026-11-01')` faux.
10. `it('comparerFefo : date nulle, puis date, puis réception, puis identifiant')` : signe négatif pour (sans date, daté), (2026-12-01, 2027-01-01), (même date reçu le 2026-09-01, même date reçu le 2026-10-01), (même date et réception, `id` 'A' contre 'B') ; 0 pour un lot comparé à lui-même.
11. `it('ordonnerLotsPourVente : lots à reliquat d abord, périmés et soldes nuls exclus')` : lots V16 plus un périmé (`dateExpiration: '2026-10-01'`) et un à solde 0 : identifiants dans l'ordre `['R2', 'R1', 'I']`.

**`src/pharmacie/domaine/caisse.spec.ts`**, `describe('caisse (domaine pharmacie)')`, `const modes = ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO']` :
1. `it('totalComptage : coupures du franc guinéen de 20 000 à 500')` : `[{20000,10},{10000,5},{5000,4},{2000,0},{1000,7},{500,6}]` (objets `{ valeurFaciale, nombre }`) donne 280000 ; liste vide 0.
2. `it('totalComptage refuse un nombre négatif ou une coupure nulle')`.
3. `it('CA15 : fond 200 000, ventes 400 000, prélèvement 100 000 : théorique 500 000, écart -10 000')` : paiements ESPECES 150000, 100000, 150000 ; mouvement PRELEVEMENT ESPECES 100000 ; résultat `toEqual([{ mode: 'ESPECES', theorique: 500000 }, { mode: 'ORANGE_MONEY', theorique: 0 }, { mode: 'MTN_MOMO', theorique: 0 }])` ; `ecartCaisse(totalComptage(...)` d'un comptage de 490000 (par exemple `[{20000,24},{10000,1}]`), `500000)` vaut -10000.
4. `it('CA16 au calcul : moitié espèces moitié Orange Money, chaque mode a son théorique et son écart')` : fond 50000, paiements ESPECES 10000 et ORANGE_MONEY 10000 : ESPECES 60000, ORANGE_MONEY 10000, MTN_MOMO 0 ; `ecartCaisse(9500, 10000)` -500 ; `ecartCaisse(null, 10000)` null.
5. `it('apports et remboursements s appliquent à leur mode')` : fond 0, apport ESPECES 20000, remboursement ESPECES 3000, paiement MTN_MOMO 7000, remboursement MTN_MOMO 2000 : ESPECES 17000, MTN_MOMO 5000, ORANGE_MONEY 0.
6. `it('un paiement négatif d annulation diminue le théorique')` : fond 0, ESPECES +8000 puis -5000 : 3000.
7. `it('l ordre du résultat suit l ordre des modes reçus')` : `modes` inversés : résultat dans l'ordre inversé.
8. `it('refuse un mode inconnu, un mouvement non positif, un fond négatif, un fond sans espèces et un mode en double')` : cinq `RangeError`.
9. `it('ecartCaisse : écart positif affiché tel quel')` : `ecartCaisse(510000, 500000)` 10000 ; `ecartCaisse(500000, 500000)` 0.

**`src/pharmacie/domaine/marge.spec.ts`**, `describe('calculerMarge (domaine pharmacie)')`, fabrique locale `alloc(quantite, coutUnitaire, champs?: Partial<AllocationMarge>)` (défauts `lotTechnique: false`, `statut: 'DEFINITIVE'`) :
1. `it('CA11 : marge = somme des montants de ligne moins somme des coûts alloués')` : vente V1, ligne 10000 avec `alloc(12, 300)` et `alloc(8, 350)`, ligne 3600 avec `alloc(6, 250)` : `chiffreAffairesValorise` 13600, `coutAlloue` 7900, `marge` 5700, `nonValorisable` tout à 0, `provisoires` tout à 0.
2. `it('CA12 : une allocation de lot technique rend la vente non valorisable')` : vente de 5000 avec `alloc(10, 0, { lotTechnique: true })` : `nonValorisable` `{ nombreVentes: 1, nombreLignes: 1, chiffreAffaires: 5000 }`, `chiffreAffairesValorise` 0, `marge` 0.
3. `it('CA12 : un coût nul rend la vente non valorisable')` : `alloc(4, 0)` sur une ligne de 2000 : `nonValorisable.nombreVentes` 1.
4. `it('CA12 : vente mixte, toute la vente sort du calcul mais seule la ligne en cause est comptée')` : ligne 3000 `alloc(10, 100)` et ligne 2000 `alloc(5, 0, { lotTechnique: true })` : `nonValorisable` `{ nombreVentes: 1, nombreLignes: 1, chiffreAffaires: 5000 }`, `coutAlloue` 0.
5. `it('une ligne provisoire est exclue jusqu à sa résolution, le reste de la vente est calculé')` : ligne 2000 `alloc(4, 200)`, ligne 1000 `alloc(5, 0, { statut: 'PROVISOIRE' })` : `provisoires` `{ nombreLignes: 1, chiffreAffaires: 1000 }`, `chiffreAffairesValorise` 2000, `coutAlloue` 800, `marge` 1200, `nonValorisable.nombreVentes` 0.
6. `it('les allocations remplacées sont ignorées après résolution')` : ligne 1500 avec `alloc(5, 0, { statut: 'REMPLACEE' })` et `alloc(5, 100)` : valorisée, `coutAlloue` 500, `marge` 1000.
7. `it('une ligne sans allocation (vente historique) est non valorisable')` : ligne 4000 sans allocation : `nonValorisable` `{ nombreVentes: 1, nombreLignes: 1, chiffreAffaires: 4000 }`.
8. `it('une vente et sa pièce d annulation s annulent')` : V6 ligne 5000 `alloc(10, 200)` et A-V6 ligne -5000 `alloc(-10, 200)` : `chiffreAffairesValorise` 0, `coutAlloue` 0, `marge` 0, et aucun `-0` (`Object.is(r.marge, 0)` vrai).
9. `it('une marge négative est renvoyée telle quelle')` : ligne 1000, `alloc(10, 150)` : `marge` -500.
10. `it('aucune vente : tout à zéro')` : `calculerMarge([])` `toEqual` l'objet complet à zéros.
11. `it('refuse un coût négatif ou une quantité non entière')` : deux `RangeError`.

Total attendu : 13 + 18 + (1 + 24 + 6 + 3 = 34) + 9 + 11 = 85 tests ajoutés ; le seuil exigé est **au moins 80**.

### Mise en forme et lint

Après écriture, lancer `docker compose exec -T backend npx eslint --fix <les 10 fichiers .ts>` puis la commande de vérification sans `--fix` (Done when, point 2).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifiques : français partout (commentaires, noms de tests, messages) ; aucun tiret cadratin ni demi-cadratin (y compris dans le JSON) ; aucun `eslint-disable`, aucun `any` explicite, aucun `console.*` ; ne toucher à aucun fichier existant (en particulier `package.json`, `package-lock.json`, `tsconfig.json`, `jest.config.js`, `prisma/`, `test/db/`, `vente.service.ts`, `pharmacie.service.ts`, `CLAUDE.md`) ; aucune migration, aucun `prisma generate` (le schéma ne change pas) ; aucun commit (le chef commite) ; ne jamais afficher ni écrire d'URL de base, de mot de passe ou de valeur de `.env`. Si une valeur attendue d'un test ou d'un vecteur semble fausse au regard de l'algorithme de la fiche, ne pas modifier l'attendu : renvoyer un bloc BLOCKED qui nomme le cas, l'attendu et le résultat obtenu.

## Done when

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré), chacune avec un code de sortie 0 :

1. `docker compose exec -T backend npx tsc --noEmit`
2. `docker compose exec -T backend npx eslint src/pharmacie/domaine/quantites.ts src/pharmacie/domaine/quantites.spec.ts src/pharmacie/domaine/prix.ts src/pharmacie/domaine/prix.spec.ts src/pharmacie/domaine/selection-lots.ts src/pharmacie/domaine/selection-lots.spec.ts src/pharmacie/domaine/caisse.ts src/pharmacie/domaine/caisse.spec.ts src/pharmacie/domaine/marge.ts src/pharmacie/domaine/marge.spec.ts` : aucune erreur ni avertissement.
3. `docker compose exec -T backend npm test` : toutes les suites passent ; 69 suites (64 + 5) ; réussis = 740 + au moins 80 ; ignorés : 3 (inchangé).
4. `docker compose exec -T backend npx jest src/pharmacie/domaine` : 5 suites vertes, dont les 24 cas de vecteurs nommés `V01` à `V24`.
5. `docker compose exec -T backend npm run test:db` : 3 suites, 26 tests verts (inchangé : la tâche ne touche pas la base).
6. Pureté (depuis `back_medconnect`) : `grep -rnE "from '" src/pharmacie/domaine --include=*.ts | grep -vE "from '\./(quantites|prix|selection-lots|caisse|marge)'" | grep -vE "\.spec\.ts:[0-9]+:.*from '(fs|path)'"` ne renvoie rien ; `grep -rnE "new Date\(|Date\.now\(" src/pharmacie/domaine --include=*.ts | grep -v "\.spec\.ts"` ne renvoie rien.
7. JSON valide et complet : `docker compose exec -T backend node -e "const f=require('./test/vecteurs/selection-lots.json');if(f.version!==1||f.cas.length!==24)process.exit(1);console.log('ok')"` affiche `ok`.
8. `LC_ALL=C.UTF-8 grep -rnP "\x{2013}|\x{2014}" src/pharmacie/domaine test/vecteurs` (depuis `back_medconnect`) ne renvoie rien.
9. `git status --short` (depuis `back_medconnect`) ne liste que `src/pharmacie/domaine/` et `test/vecteurs/` (plus `docs/plans/`, tenu par l'orchestrateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
2026-10-25 | chef Opus : tsc, eslint (10 fichiers), npm test, test:db, puretés, JSON | 0 erreur ; 69 suites, 825 réussis, 3 ignorés ; test:db 26 verts ; JSON identique à la fiche | voir rapports/PB04-chef.md
