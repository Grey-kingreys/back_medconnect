# PF07c - Vérification indépendante

Verdict : **PASS avec une réserve à corriger (chiffre compté perdu sur LOT_REQUIS, majeur terrain mais hors gate)**

Branche `orch/pharmacie-t1-front`, base 23a558c, modifications non commitées.

## 1. Gate « Done when »

| Commande | Résultat |
|---|---|
| `docker compose exec -T frontend npx tsc --noEmit` | aucune erreur |
| `docker compose exec -T frontend npx eslint` sur les 5 fichiers autorisés | aucune sortie, aucune erreur |
| `docker compose exec -T frontend npx vitest run` | 68 fichiers, 586 tests verts (576 + 10 : 9 de la page + 1 de navigation) |
| `npm run build` (local) | réussi (BUILD=0) |
| `git status --porcelain` | 3 fichiers modifiés (`api_pharmacie.ts`, `navigation_tableau_de_bord.ts`, son test pharmacie) et `src/app/dashboard/inventaire/` neuf : tous autorisés |
| `grep numeroLot` dans `page.tsx` | 4 occurrences, toutes en lecture d'affichage (l.122, 123, 400, 627) ; aucun envoi |
| U+2014 / U+2013 (Python sur les 5 fichiers) | 0 |
| `fetch(` brut dans la page | aucun ; tout passe par `enregistrerInventaire` (`authFetch`) |

Aucune écriture dans la base de dev (aucun appel API réel, tests mockés). Captures clair et sombre non prises (non demandé dans ce brief).

## 2. Conformité à la fiche et au back

Contrat relu : `LigneInventaireDto`, `ciblerLot` (D589, D600), `inventaires.service.ts` (refus, conversion avec `coefficientReception` du lot, doublons).

- Corps de POST : `id` = `cleInventaire` (UUID neuf à chaque saisie ; neuf après « Modifier la saisie », « Nouvel inventaire » et `IDENTIFIANT_DEJA_UTILISE`) ; « Réessayer l'envoi » renvoie `corpsEnvoye` à l'identique (même `id`), test 8 le prouve. Un refus 4xx ne crée rien côté serveur, la réutilisation de l'`id` est sans risque. Conforme.
- Lignes : lot proposé `{ stockId, lotId, nombreBoites, unitesEnPlus? }` (l.459, 493-494), jamais `numeroLot`, jamais `quantiteComptee`. Lot vide non envoyé, 0 envoyé. Fiche sans lot en solde positif : `{ stockId }` sans `lotId` (+ `dateExpiration` si saisie), ce qui couvre D600 (lot unique même épuisé, `ciblerLot` étape 4) ; avec date saisie, le serveur cible par date ou crée un lot, d'où l'intitulé « Péremption (si nouveau lot) », cohérent. « Autre lot » : `dateExpiration` ou `sansPeremption: true`, seule clé de ciblage. `unitesEnPlus` n'est envoyé que s'il est positif, `nombreBoites` toujours (0 admis par le DTO). Plafonds du DTO repris (1 000 000 boîtes, 1 000 000 000 unités). Conforme.
- Comptage à l'aveugle (D699) : libellés de lot sans quantité (`libelleLotAveugle`), la clé `quantite` des `details[].lots` du LOT_REQUIS est ignorée (l.389-402), l'attendu n'apparaît qu'au résultat. Conforme.
- Résultat : titre = message du serveur, tableau avec `caption` sr-only et en-têtes `scope`, Attendu (négatif géré par `formaterQuantite`), Compté, Écart signé en unités, rose si négatif hors tolérance, ambre si positif hors tolérance, neutre sinon (`classeEcart`), « Signalé au titulaire » Oui/Non, avertissements `FICHE_NON_QUALIFIEE`, `cree === false`, boutons « Nouvel inventaire » et « Voir le stock », focus sur le titre. Conforme.
- Erreurs : `VALIDATION` par ligne (rang du corps vers la clé de ligne, `aria-invalid`, focus sur la première), lot compté deux fois avec message dédié, `DATE_PEREMPTION_REQUISE` (champ de péremption des lignes sans lot de la fiche citée), `LOT_REQUIS` (message du serveur dans le bandeau, lots ajoutés comme lignes), 403 et 404 via `messageErreurPour`. Conforme, sauf les réserves ci-dessous.
- Menu : entrée `inventaire` après `receptions`, `perm(["inventaire:write"], { typesStructure: P })`, `rolesRepli: []`, icône `ClipboardCheck` ; test de navigation ajouté. Conforme (D695, D704).

## 3. Écarts déclarés, jugement

2. **LOT_REQUIS : la ligne « Stock de ce médicament » est retirée et ses quantités saisies sont perdues.** Jugé **à corriger**. En rayon, le vendeur ou le titulaire qui a compté 4 boîtes doit alors retrouver son chiffre de mémoire ; le chiffre compté est la seule donnée de valeur de la saisie et la perdre est évitable. Le serveur interdit toute répartition automatique (D589), donc il ne faut pas préremplir un lot. Forme recommandée : garder la saisie de la ligne retirée sous forme de **rappel en lecture seule** au-dessus des lots proposés, du type « Vous aviez compté 4 boîtes (et 6 comprimés) pour ce médicament. Ce médicament a plusieurs lots : répartissez ce comptage entre les lots ci-dessous. », porté par le `BlocFiche` (un champ `rappel: string | null`, vidé quand une des nouvelles lignes est saisie ou à « Nouvel inventaire »). Il ne dévoile rien du stock théorique. Le texte du rappel utilise `formaterQuantite` ou les valeurs saisies telles quelles. Un test à ajouter : après LOT_REQUIS, le rappel « 4 boîtes » est affiché et aucune ligne « Stock de ce médicament » n'existe. Variante moins coûteuse : ne pas retirer la ligne mais la figer en lecture seule jusqu'à ce que les lots soient saisis (plus lourd, déconseillée).
3. **Coefficient des lots venus de LOT_REQUIS** (`page.tsx:391, 402`, fiche utilisée) : jugé **mineur à corriger si simple**. Le serveur convertit les boîtes avec le `coefficientReception` du lot, le `details[].lots` n'en porte pas. Conséquences : le champ « unités en plus » n'apparaît pas si la fiche a un coefficient 1 alors que le lot en a plus, et le tableau de résultat lit attendu, compté et écart avec le coefficient de la fiche (l.582, 626). Cas rare (lot reçu avant un changement de coefficient), mais la valeur est fausse sans alerte. Correction minimale : sur LOT_REQUIS, au lieu de construire les lignes depuis `details`, relancer `chargerLots(stockId)` (lots à solde positif avec `coefficientReception`, même source que le chargement normal) en gardant les lignes « Autre lot » ; le `details` sert alors seulement à désigner les fiches. Même défaut résiduel au résultat pour une ligne « Stock de ce médicament » ciblée par le serveur sur un lot (fiche utilisée), acceptable.
1. **Unités en plus** (champ affiché seulement si coefficient > 1) : jugé **correct** : une boîte entamée n'a pas de sens à 1 unité par boîte, et le back accepte l'absence du champ. Réserve couverte par l'écart 3 (coefficient de la fiche pour une ligne « Autre lot » dont la date correspond en réalité à un lot existant d'un autre coefficient, cas très rare).
4. **Écart affiché en unités** (« +16 comprimés », « -5 comprimés ») : jugé **correct** et conforme à la fiche ; en boîtes quand la fiche n'a qu'une unité par boîte, ce qui est cohérent avec `formaterQuantite`.
5. **Messages ajoutés** (« Vérifiez cette quantité. », « Vérifiez cette date de péremption. », « Ce lot est compté deux fois : gardez une seule ligne par lot. », « Un inventaire ne peut pas dépasser 500 lignes : enregistrez-le en plusieurs fois. », « Indiquez... ») : jugés **acceptables** : français correct, actionnables, sans terme technique, aucun tiret long. Le bandeau reprend en plus le message du serveur.
6. **Date illisible refusée localement** (`lireDatePeremption`, message de la règle PF02b sous le champ) : jugé **correct** (D684) ; un refus local évite un aller-retour réseau et ne dépend pas du serveur.

## 4. Accessibilité, design, texte

- Groupes `fieldset` + `legend` par lot, champs reliés par `label htmlFor`, `aria-invalid`, `aria-describedby` vers le message, focus déplacé sur le premier champ en erreur, sur le premier lot après ajout et sur le titre du résultat ; combobox de recherche avec `aria-activedescendant`, `listbox`/`option`, flèches et Entrée ; boutons icône avec `aria-label` nominatif ; `role="alert"` sur le bandeau, `role="status"` sur les chargements et avertissements ; saisie en `readOnly` et boutons `disabled` pendant l'envoi et après échec réseau.
- Design : constantes de `classes.ts` (`CARTE`, `CHAMP`, `FOCUS`, boutons, alertes), teintes 700/300 AA, variantes sombres présentes, `CHAMP_INVALIDE` dérivé de `CHAMP` sans nouvelle couleur.
- Texte : français, aucun terme interdit (« théorique », « coefficient », identifiants) à l'écran ; le test `verifierTermes` le contrôle. « Attendu » et « Compté » utilisés.

## 5. Problèmes

1. (Majeur terrain, à corriger avant commit si possible) `page.tsx:404-410` : sur LOT_REQUIS, les lignes `genre === "stock"` sont écartées et leurs `boites`, `unites` et `peremption` saisis sont perdus. Voir écart 2, forme recommandée : rappel en lecture seule du chiffre compté.
2. (Mineur) `page.tsx:391, 402, 582, 626` : coefficient de la fiche pour des lots dont le coefficient réel peut différer ; recharger les lots par `chargerLots` après LOT_REQUIS.
3. (Mineur) `page.tsx:804-808` : quand une ligne a une erreur de boîtes ET d'unités, un seul message s'affiche et l'`aria-describedby` du champ des unités (`erreur-<cle>-unites`, l.766) pointe vers un identifiant absent. Afficher un message par champ.
4. (Mineur) Une ligne « Autre lot » dont la date correspond à plusieurs lots du serveur renvoie LOT_REQUIS ; la ligne reste et échouera de nouveau tant que l'utilisateur ne la retire pas. Le message du serveur l'explique, aucun correctif requis, à noter pour le test à la main.
