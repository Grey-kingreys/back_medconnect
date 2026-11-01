# PF02b - Fiche produit : deux prix, unité, qualification, péremption obligatoire à l'ajout

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire, vendeur avec `stock:write`)
Visuel: oui (fenêtre `StockModal` existante étendue)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Quatrième sous-fiche (D685), après PF02a. La fenêtre « Ajouter au stock / Modifier le stock » devient la fiche produit de PB06 et PB13 : prix de la boîte et prix de l'unité indépendants, unité minimale, nombre d'unités par boîte, vente à l'unité, tolérance d'inventaire, confirmation de la fiche (qualification) avec le choix de conversion du stock à la première qualification, avertissement d'écart de prix non bloquant. À l'ajout, une quantité initiale exige une date de péremption ou la case « Sans date de péremption » (D701), saisie au format des factures (MM/AA) grâce à la règle commune `date_peremption.ts` créée ici (D684, réutilisée par PF07).

Décisions applicables : D684, D686, D687, D693, D697, D701.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/components/modals/StockModal.tsx` (387 lignes) : recherche dans le catalogue (`getCatalogue`, à partir de 2 caractères, 500 ms), création d'un médicament (`createMedicament`), puis `upsertStock(structureId, { medicamentId, quantite, prixUnitaire, dateExpiration, notes })` ; en modification, envoie la quantité et la date saisies (ce qui, depuis PB08, écrit un mouvement d'inventaire ou donne 409 `LOT_REQUIS` sur plusieurs lots) ; aucune gestion de `sansPeremption` (400 `DATE_PEREMPTION_REQUISE` sur une nouvelle fiche avec quantité sans date) ; `prixUnitaire` lu par `parseFloat`.
- `src/lib/api_pharmacie.ts` : `upsertStock` (sans `sansPeremption`), pas de `modifierFiche`.
- PF01a : types `StockMedicament` étendus, `UniteMinimale`, `LIBELLES_UNITE_MINIMALE`, `erreurs_api.ts`, `classes.ts`.
- Contrats (back `CLAUDE.md`, puces PB06, PB08, PB13) : upsert `POST /pharmacie/stock/:structureId` `{ medicamentId, quantite (unités minimales, entier >= 0), prixUnitaire?, dateExpiration? (AAAA-MM-JJ), notes?, sansPeremption? }` : fiche sans lot et quantité positive : date obligatoire sauf `sansPeremption` (400 `DATE_PEREMPTION_REQUISE`) ; quantité égale au stock et sans date : rien ne bouge côté stock (prix et notes mis à jour) ; `PATCH /pharmacie/:structureId/stock/:stockId/fiche` `{ prixUnitaire?, prixUnite?, coefficientBoite?, uniteMinimale?, deconditionnable?, toleranceInventaire?, qualifie?: true, conversionStock?: "MULTIPLIER" | "CONSERVER" }` (`null` efface `prixUnitaire`, `prixUnite`, `toleranceInventaire`) ; réponse fiche + `avertissements: [{ code: "ECART_PRIX", ecartPct }]` + `conversion` ; 400 `PRIX_UNITE_SANS_DECONDITIONNEMENT`, 400 `CONVERSION_REQUISE`, 409 `CONVERSION_IMPOSSIBLE`, 409 `FICHE_DEJA_QUALIFIEE`, 404.

### 1. `src/lib/date_peremption.ts` (nouveau, D684)

```ts
export type LectureDate = { ok: true; jour: string } | { ok: false; message: string };
/** Lit une date de péremption saisie au comptoir ; renvoie le jour AAAA-MM-JJ. */
export function lireDatePeremption(saisie: string): LectureDate;
/** Jour AAAA-MM-JJ affiché « 30/06/2028 ». */
export function afficherDatePeremption(jour: string): string;
```
Règles exactes (espaces retirés autour ; séparateurs acceptés `/`, `-`, `.`) :
1. `M/AA`, `MM/AA`, `M/AAAA`, `MM/AAAA` (format des factures, par exemple `6/28`) : **dernier jour du mois** (`6/28` donne `2028-06-30`, `2/28` donne `2028-02-29`, `2/27` donne `2027-02-28`) ; année à deux chiffres = 2000 + AA.
2. `JJ/MM/AA` et `JJ/MM/AAAA` : ce jour exact ; `AAAA-MM-JJ` (valeur d'un champ date) : ce jour exact.
3. Mois hors 1 à 12, jour inexistant (`31/04/28`), texte vide ou autre forme : `{ ok: false, message: "Date de péremption illisible : écrivez par exemple 06/28 ou 30/06/2028." }`.
4. Aucune comparaison avec aujourd'hui ici (le serveur refuse une date passée : `DATE_PEREMPTION_PASSEE`, message affiché tel quel) ; calcul en UTC, aucune dépendance à l'heure locale.

Tests `src/lib/date_peremption.test.ts` (8) : `6/28` et `06/2028` donnent `2028-06-30` ; `2/28` donne `2028-02-29` ; `2/27` donne `2027-02-28` ; `12/27` donne `2027-12-31` ; `15/03/2027` et `15/03/27` donnent `2027-03-15` ; `2027-03-15` est gardé ; `13/28`, `31/04/2028`, `abc` et `""` sont refusés avec le message exact ; `afficherDatePeremption("2028-06-30")` = `30/06/2028`.

### 2. `src/lib/api_pharmacie.ts`

- `upsertStock` : ajouter `sansPeremption?: boolean` au corps.
- `export interface AvertissementFiche { code: "ECART_PRIX"; ecartPct: number }` ; `export interface CorpsFiche { prixUnitaire?: number | null; prixUnite?: number | null; coefficientBoite?: number; uniteMinimale?: UniteMinimale; deconditionnable?: boolean; toleranceInventaire?: number | null; qualifie?: true; conversionStock?: "MULTIPLIER" | "CONSERVER" }` ; `modifierFiche(structureId, stockId, corps: CorpsFiche)` : `PATCH /pharmacie/:structureId/stock/:stockId/fiche`, réponse `StockMedicament & { avertissements: AvertissementFiche[]; conversion: unknown }`.

### 3. `StockModal.tsx`

Garder la recherche, la création de médicament, l'en-tête et les classes de la fenêtre. Montants et quantités : champs texte `inputMode="numeric"` lus en entier (chiffres seuls, `parseInt`, jamais `parseFloat`).

**Bloc « Vente et prix »** (ajout et modification) :
- « Prix de la boîte (GNF) » (facultatif) ;
- « Unité de vente au détail » : liste des 7 unités (`LIBELLES_UNITE_MINIMALE`, singulier avec majuscule : « Comprimé », « Gélule », « ml », « Sachet », « Gramme », « Ampoule », « Unité ») ;
- « Nombre d'unités par boîte » (entier >= 1, défaut 1) ;
- case « Se vend aussi à l'unité (boîte entamée) » ;
- « Prix d'une unité (GNF) », affiché et activé seulement si la case est cochée ; décocher la case efface ce prix à l'envoi (`prixUnite: null`) ;
- « Écart toléré à l'inventaire (en unités) » (facultatif, aide « Au-delà, un écart d'inventaire est signalé au titulaire. »).
Phrase d'aide sous les deux prix : « Les deux prix sont indépendants : changer l'un ne change pas l'autre. ».

**Qualification** (modification d'une fiche `qualifie === false`) : bandeau `ALERTE_ATTENTION` « Le nombre d'unités par boîte de ce médicament n'est pas encore confirmé. Vérifiez-le, puis cochez la case ci-dessous. » et case « Je confirme ces informations » (envoie `qualifie: true`). Si le nombre d'unités par boîte change et que le stock n'est pas nul (`quantite !== 0`), choix obligatoire en boutons radio (légende « Le stock actuel de <formaterQuantite(quantite, 1, "UNITE")> compte : ») :
- « des boîtes : les convertir en unités (<q> boîtes deviennent <q x N> <pluriel>) » → `conversionStock: "MULTIPLIER"` ;
- « déjà des unités : ne rien changer » → `"CONSERVER"`.
Tout changement du nombre d'unités par boîte sur une fiche non qualifiée la qualifie (le serveur le fait) ; texte sous le choix : « Ce choix ne se fera qu'une fois. ». Fiche déjà qualifiée : le champ reste modifiable, aide « S'applique aux prochaines réceptions et aux ventes à la boîte. ».

**Ajout** (pas de `editItem`) :
- « Quantité de départ (en boîtes) » facultative (défaut vide = 0) ; si elle est positive : champ « Date de péremption » (texte, placeholder « 06/28 », aide « Comme sur la facture : mois/année (06/28) ou date complète. ») lu par `lireDatePeremption`, ou case « Sans date de péremption » ; sinon message « Indiquez la date de péremption, ou cochez « Sans date de péremption ». » et aucun envoi. La date lue est affichée en clair sous le champ (« Péremption : 30/06/2028 »).
- Champ « Notes » inchangé.
- Envoi, dans cet ordre (D701) : (a) `createMedicament` si nouveau ; (b) `upsertStock({ medicamentId, quantite: 0, prixUnitaire, notes })` ; (c) `modifierFiche` avec les champs du bloc « Vente et prix » différents des valeurs par défaut, plus `qualifie: true` ; (d) si quantité de départ positive : `upsertStock({ medicamentId, quantite: boites x coefficient, dateExpiration | sansPeremption: true })`. Chaque étape réussie n'est pas refaite sur un « Réessayer » après un échec réseau (état local des étapes faites) ; (b) et (d) sont sans effet si répétés à l'identique.

**Modification** (`editItem`) :
- La quantité et la date ne sont **plus modifiables ici** : ligne en lecture « Stock actuel : <formaterQuantite> » et aide « Pour changer la quantité : « Corriger la quantité » dans la liste, ou faites un inventaire. ».
- Envoi : `modifierFiche` avec les seuls champs changés (dont `prixUnitaire`) ; si les notes ont changé : `upsertStock({ medicamentId, quantite: editItem.quantite, notes })` (aucun mouvement de stock). Aucun appel si rien n'a changé : fermeture simple.

**Après succès** : s'il y a un avertissement `ECART_PRIX`, la fenêtre reste ouverte en lecture avec `ALERTE_ATTENTION` « Enregistré. Le prix d'une unité s'écarte de <ecartPct> % du prix de la boîte divisé par le nombre d'unités : vérifiez qu'il n'y a pas d'erreur. » et un seul bouton « Fermer » ; sinon `onSuccess()` puis fermeture.

**Erreurs** : message du serveur dans le bloc d'erreur existant (`PRIX_UNITE_SANS_DECONDITIONNEMENT`, `CONVERSION_REQUISE`, `CONVERSION_IMPOSSIBLE`, `FICHE_DEJA_QUALIFIEE`, `DATE_PEREMPTION_REQUISE`, `DATE_PEREMPTION_PASSEE`, `LOT_REQUIS`, 403, 404) ; `CONVERSION_REQUISE` affiche aussi le choix de conversion ; échec réseau : « L'enregistrement n'a peut-être pas abouti. Vérifiez votre connexion puis appuyez sur Réessayer. » et le bouton principal devient « Réessayer ».

### 4. Tests

`src/components/modals/StockModal.test.tsx` (nouveau, 8) :
1. ajout avec quantité sans date ni case : aucun appel, message exact ;
2. ajout avec `6/28` : dernier appel `upsertStock` avec `dateExpiration: "2028-06-30"` et `quantite` = boîtes x coefficient (3 boîtes de 20 donnent 60) ; ordre des appels (b), (c), (d) respecté ;
3. ajout « Sans date de péremption » : `sansPeremption: true`, aucune `dateExpiration` ;
4. modification : aucun champ quantité ni date ; changer seulement le prix de la boîte appelle `modifierFiche` avec `{ prixUnitaire }` seul et jamais `upsertStock` ;
5. modification d'une fiche non qualifiée au stock 12 : passer de 1 à 20 unités par boîte sans choisir la conversion bloque l'envoi ; choisir « des boîtes » envoie `{ coefficientBoite: 20, conversionStock: "MULTIPLIER", qualifie: true }` ;
6. décocher « Se vend aussi à l'unité » envoie `deconditionnable: false` et `prixUnite: null` ;
7. avertissement `ECART_PRIX` (`ecartPct: 32`) : texte exact et bouton « Fermer » seul ;
8. 409 `CONVERSION_IMPOSSIBLE` : message du serveur affiché, fenêtre ouverte.

## Contraintes

Faire uniquement ce qui est demandé. Audience non-dev : jamais « coefficient », « qualifier », « UM » à l'écran (« nombre d'unités par boîte », « confirmer la fiche ») ; termes interdits absents. Visuel : classes de la fenêtre existante, clair et sombre, AA, libellés reliés aux champs (`htmlFor`). Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/date_peremption.ts`, `src/lib/date_peremption.test.ts`, `src/lib/api_pharmacie.ts`, `src/components/modals/StockModal.tsx`, `src/components/modals/StockModal.test.tsx`.

## Test à la main

Démo remise à zéro, **Moussa Kanté** (titulaire, Pharmacie du Niger) : « Modifier » sur Spasfon (60, non confirmé), passer à 20 unités par boîte, choisir « des boîtes » : 1 200 unités, la fiche sort du filtre « À qualifier ». **Djénabou Baldé** (Kaloum) : « Ajouter un médicament » avec 5 boîtes et la péremption `6/28` ; modifier le prix d'une unité du Doliprane pour provoquer l'avertissement d'écart. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur nouvelle (les deux `eslint-disable-next-line` préexistants de `StockModal.tsx` peuvent rester).
3. `npm test` : tout vert, dont `date_peremption.test.ts` (8) et `StockModal.test.tsx` (8).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -n "parseFloat" src/components/modals/StockModal.tsx` : aucune ligne.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
