# PD02a - Règles portées, stockage local, catalogue et stock dérivé

Tier: dur (codeur Sonnet, vérificateur Sonnet ; fiche détaillée)
Audience: dev (aucun écran)
Visuel: n/a
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD01 validé

## Spec

### Objectif

Porter les règles manquantes dans `src/lib/caisse/regles/`, poser le stockage SQLite derrière une interface, enregistrer la photographie du serveur et calculer le stock local d'une fiche. Aucune vente encore (PD02b).

Décisions : D439, D441, D477, D633, D690, D714, D717, D719, D723, D734, D737, D738, D740, D741. Plan 4.3.

### Écart au plan, vérifié

Le plan dit que `src/lib/caisse/` a déjà la sélection de lots, le théorique et les vecteurs. **Non** : D690 les a repoussés. Présents : `regles/prix.ts`, `regles/quantites.ts`, `source.ts`, `source_en_ligne.ts`. C'est ici qu'on les porte.

### 1. Portages dans `src/lib/caisse/regles/` (fichiers purs, aucun import de React, Next ni réseau)

| Nouveau fichier | Source (lecture seule) | À porter |
|---|---|---|
| `selection_lots.ts` | `back_medconnect/src/pharmacie/domaine/selection-lots.ts` | tout, à l'identique |
| `caisse.ts` | `.../domaine/caisse.ts` | `CODE_ESPECES`, `totalComptage`, `calculerTheorique`, `ecartCaisse` |
| `paiements.ts` | `back_medconnect/src/pharmacie/vente-regles.ts` | `preparerPaiements` et ses types, sans Nest |
| `numeros.ts` | `vente-regles.ts:12`, `synchro/rejeu-regles.ts:330` | `formaterNumeroTicket`, `numeroSecours` |

`quantites.ts` gagne `reliquatLot` (`back_medconnect/src/pharmacie/domaine/quantites.ts:114`) et exporte `exigerEntier`.

`coutUnitaire` reste dans `LotCandidat` pour jouer les vecteurs sans les changer ; le poste passe toujours 0, jamais affiché ni envoyé (photographie sans coût, D633).

Vecteurs : copier **à l'identique** `back_medconnect/test/vecteurs/selection-lots.json` (24 cas, version 1) vers `src/lib/caisse/regles/vecteurs/selection-lots.json`. Ne pas le créer dans `desktop/vecteurs/` : le plan 4.1 place la copie là, mais les règles et leurs tests vivent dans `src`.

Tests dans `src/lib/caisse/regles/` : `selection_lots.test.ts` joue les 24 cas (allocations `lotId` et `quantite`, `resteProvisoire`, `lotsPerimesDisponibles`) ; un test compare la copie à l'original si le fichier du back est présent (saute sinon, le dépôt front se clone seul). `caisse.test.ts` : scénario CA15 : fond 200 000, paiements espèces 400 000, prélèvement 100 000 : théorique 500 000, compté 490 000 : écart -10 000. `paiements.test.ts` : défaut espèces, moitié espèces moitié Orange Money, somme fausse `PAIEMENTS_INCOHERENTS`, mode inconnu, rendu. `numeros.test.ts` : `T1-0000123`, `S1-D1-4`. Reprendre les specs du back comme modèle.

### 2. `src/lib/caisse/regles/stock_local.ts` (nouveau, pur, D738)

Une seule règle, celle des lectures du back, appliquée aux données locales :

```ts
export interface LotPhoto { id: string; numeroLot: string | null; dateExpiration: string | null; dateReception: string; coefficientReception: number; solde: number; lotTechnique: boolean }
export interface FichePhoto { quantite: number; quantiteARegulariser: number; lots: LotPhoto[] }
export interface SortieLocale { lotId: string | null; quantiteUm: number } // lotId null = provisoire
export interface StockLocal { quantite: number; quantiteARegulariser: number; quantiteVendable: number; lots: LotPhoto[]; reliquat: { lotId: string; unitesRestantes: number }[]; dateExpiration: string | null }
export function calculerStockLocal(fiche: FichePhoto, sorties: SortieLocale[], jour: string): StockLocal;
```

Calcul :
1. `sommeLots0` = somme des soldes de la photographie. `agregat0` = `fiche.quantite` si positif, sinon `sommeLots0 - fiche.quantiteARegulariser`.
2. Soldes des lots moins les sorties de ce lot, jamais sous zéro ; lots à zéro retirés.
3. `agregat` = `agregat0` moins toutes les sorties (provisoires comprises).
4. `quantite = max(0, agregat)`. `quantiteARegulariser = max(0, sommeLots - agregat)`. `quantiteVendable = min(somme des lots non périmés, max(0, agregat))`.
5. `reliquat` : lots à `reliquatLot > 0`. `dateExpiration` : date du lot que la vente prendrait en premier (`ordonnerLotsPourVente`), sinon la plus ancienne des lots restants, sinon null.

Jamais de valeur négative en sortie (D713). Tests `stock_local.test.ts`, tous exacts :

| Photo (quantite, aRegul, lots) | Sorties | Attendu (quantite, aRegul, vendable) |
|---|---|---|
| 40, 0, L1=40 | aucune | 40, 0, 40 |
| 5, 0, L1=5 | L1=5, provisoire=2 | 0, 2, 0 |
| 3, 2, L1=5 | L1=4 | 0, 2, 0 |
| 0, 1, aucun (agrégat -1) | provisoire=2 | 0, 3, 0 |
| 0, 0, aucun | provisoire=1 | 0, 1, 0 |
| 10, 0, L1=10 périmé | aucune | 10, 0, 0 |
| 50, 0, L1=30 + L2=20, coefficient 20 | L1=6 | 44, 0, 44, reliquat L1=4 (solde 24), rien sur L2 |
| plaquettes : 26, 0, L1=26, coef 10 | L1=7 | 19, 0, 19, reliquat L1=9 |

### 3. `desktop/coeur/`

Rien dans ce dossier n'importe `electron`, `next` ou `react` ; `stockage_sqlite.ts` seul importe `better-sqlite3`. Test `garde_imports.test.ts` : parcourt `coeur/**/*.ts` hors tests et échoue sinon.

`stockage.ts` :

```ts
export interface Stockage {
  executer(sql: string, params?: unknown[]): void;
  lire<T>(sql: string, params?: unknown[]): T[];
  lireUn<T>(sql: string, params?: unknown[]): T | undefined;
  transaction<T>(travail: () => T): T;
  fermer(): void;
}
```

`stockage_sqlite.ts` : `ouvrirStockage(chemin)`, `journal_mode=WAL`, **`synchronous=FULL`** (coupures de courant à Conakry, D740), `foreign_keys=ON`, `busy_timeout=5000`. `controlerBase()` : `PRAGMA quick_check`, renvoie vrai si `ok`.

`schema.ts` : `migrer(stockage)` par `PRAGMA user_version`, liste ordonnée, chaque étape en transaction (les mises à jour de l'application changeront le schéma). Version 1 :

| Table | Colonnes |
|---|---|
| `etat_poste` (une ligne, `id = 1`) | `appareilId`, `structureId`, `posteId`, `posteCode`, `posteLibelle`, `ordrePointDeVente`, `pointDeVenteId`, `sequenceAppliquee`, `prochaineSequence`, `etag`, `photographieLe`, `heureServeurEcartMs`, `prochainSecours` |
| `pharmacie`, `parametres`, `modes_paiement`, `coupures` | document JSON de la dernière photographie |
| `fiches` | `stockId` PK, `document` JSON (fiche de la photographie, lots compris), `nom` |
| `plages` | `id` PK, `debut`, `fin`, `dernierUtilise` (nul au départ) |
| `sessions` | `id` PK, `utilisateurId`, `utilisateurNom`, `statut`, `jourMetier`, `ouverteLe`, `fermeeLe`, `commentaireEcart`, `adoptee` (0 ou 1) |
| `comptages` | `id` PK, `sessionId`, `moment`, `document` JSON (coupures, relevés), `totalEspeces`, `auteurId`, `createdAt` |
| `mouvements_caisse` | `id` PK, `sessionId`, `type`, `mode`, `montant`, `motif`, `auteurId`, `horodatage` |
| `ventes` | `id` PK, `sequence`, `sessionId`, `jourMetier`, `numero`, `total`, `document` JSON (forme `Vente` du front), `createdAt` |
| `sorties_stock` | `venteId`, `sequence`, `stockId`, `lotId` nul si provisoire, `quantiteUm` ; index sur `(stockId, sequence)` |
| `paiements_locaux` | `venteId`, `sessionId`, `mode`, `montant` signé |
| `evenements` | `sequence` PK, `evenementId` unique, `type`, `horodatageLocal`, `utilisateurId`, `corps` JSON (texte, renvoyé tel quel), `statut` (`A_ENVOYER`, `ENVOYE`, `EN_ATTENTE`, `REJETE`), `code`, `message` |
| `profil_local` (une ligne) | `document` JSON du dernier `/auth/me`, `utilisateurId`, `enregistreLe` (PD04b) |

Écart au plan 4.3 : pas de table `lots` ni `lignes` : le document de la fiche porte ses lots, `sorties_stock` suffit au calcul et la pièce vit en JSON. Aucun jeton dans aucune table (test : parcours des colonnes après un scénario, aucun nom `token`, `jeton`, `refresh`).

`coeur.ts` :

```ts
export interface Outils { horloge: () => Date; genererId: () => string }
export class CoeurCaisse {
  constructor(stockage: Stockage, outils: Outils);
  appareilId(): string;                    // crée l'UUID au premier appel, jamais changé
  rattacher(entree: { structureId: string }): void;
  structureRattachee(): string | null;
  enregistrerPoste(p: { id: string; code: string; libelle: string }): void;
  appliquerPhotographie(photo: Photographie, etag: string | null, dateServeur: Date | null): void;
  aUnCatalogue(): boolean;
  jour(): string;                          // jour UTC, comme jourConakry du back, jamais le fuseau Windows
  lireStock(): FicheLocale[];              // fiches au format StockMedicament du front
  lireReferentiels(): Referentiels | null;
}
```

`Photographie` : le type exact de `CatalogueSynchro` (`back_medconnect/src/pharmacie/synchro/catalogue-synchro.service.ts`), à recopier dans `desktop/coeur/types_synchro.ts`.

`appliquerPhotographie`, en une transaction :
- remplace `pharmacie`, `parametres`, `modes_paiement`, `coupures`, `fiches` ;
- `sequenceAppliquee = photo.poste.sequenceAppliquee` ;
- `prochaineSequence = max(prochaineSequence, photo.poste.sequenceMaxRecue + 1)` (poste réinstallé, D633) ;
- plages : ajoute les nouvelles, ne touche jamais `dernierUtilise`, ne retire pas une plage locale absente de la réponse tant qu'il y reste des numéros ;
- `heureServeurEcartMs` si `dateServeur` est donnée.

`lireStock` : pour chaque fiche, sorties `sequence > sequenceAppliquee`, puis `calculerStockLocal`, puis mise en forme `StockMedicament` (`id` = `stockId`, `medicament { id, nom, nomGenerique, categorie, formes, ordonnanceRequise }`, `structureId`, `prixUnitaire` sans null, `prixUnite`, `coefficientBoite`, `uniteMinimale`, `deconditionnable`, `disponible = quantite > 0`, lots au format `LotFiche` de `api_pharmacie.ts`, `coefficientReception` compris). Une `uniteMinimale` inconnue devient `UNITE`.

### 4. `desktop/vitest.config.mts`

`environment: "node"`, `include: ["coeur/**/*.test.ts"]`, alias `@` vers `../src`. Les tests tournent sous Node ordinaire : `better-sqlite3` 13 est en Node-API, même binaire qu'Electron (D734).

Tests `desktop/coeur/` (`:memory:`) :
1. migration : base neuve à la version 1, rejouée sans erreur ;
2. photographie : stock lu conforme ; `sequenceMaxRecue` 40 donne `prochaineSequence` 41 ;
3. pas de double décompte : sorties fictives de séquences 5 et 6, photographie `sequenceAppliquee` 5 : seule la 6 compte ;
4. seconde photographie : `dernierUtilise` et plage entamée conservés ;
5. **5 000 fiches et 500 sorties : `lireStock()` en moins de 150 ms** (médiane de 5 mesures, valeur rendue dans le rapport). Le plan parlait de `rechercher` ; l'écran de vente filtre dans sa propre liste en mémoire (`vente/page.tsx`), c'est donc `lireStock` qui compte (D738) ;
6. fiche plaquette (D723) : `uniteMinimale` `PLAQUETTE`, coefficient 10 ;
7. `jour()` en UTC quelle que soit `TZ` ;
8. `controlerBase` vrai sur une base saine, garde des imports, aucun nom de colonne de jeton.

## Fichiers autorisés

`src/lib/caisse/regles/**`, tout sous `desktop/` (hors `electron/`).

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée.
- Pas de tiret cadratin ni demi-cadratin, français.
- `npm run build` du front en local, jamais dans le conteneur.
- Le web ne change pas de comportement : aucun écran touché ici.
- Rien sur la base de dev du porteur : aucun test n'appelle l'API.
- Le fichier JSON des vecteurs n'est jamais édité ni généré.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

`docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés sous `src` ; dans `desktop/` : `npm run types`, `npm test`.

## Done when

- [ ] Sélection, théorique, paiements, numéros portés, 24 vecteurs verts
- [ ] Tableau de `stock_local` exact, aucune sortie négative
- [ ] Base locale migrée, WAL, `synchronous=FULL`
- [ ] Photographie enregistrée, séquences et plages justes
- [ ] 5 000 fiches lues en moins de 150 ms

## Return

Fichiers touchés, sorties des gates, mesure de `lireStock`, tout écart à la fiche.

## Historique

## Validation
