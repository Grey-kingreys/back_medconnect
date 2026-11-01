# PF07a : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-front` 1d2197f (code de PF07a, corrections du chef, `docs/plans/ACTIVE.md`) ; back `orch/pharmacie-t1-back`, commit `docs(pharmacie): contrôle de PF07a` (fiche, rapports PF07a, `decisions.md` D708, `ACTIVE.md`). Un commit par dépôt, sans amend, hooks actifs. Vérification PASS avec réserves R1 à R5, toutes corrigées ici.

## Relecture du diff contre la fiche et le contrat du back

- `api_pharmacie.ts` : types et cinq fonctions conformes à `receptions.dto.ts` et `receptions.service.ts` (`fournisseur { id, nom } | null`, `nombreLots`, `quantiteTotale`, `avertissements`, `cree`, coûts facultatifs avec commentaire D698), identifiants par `encodeURIComponent`.
- Corps envoyé : `id` client (D688), `fournisseurId`, `reference` rognée (100), `recueLe` maintenant ou `<jour>T12:00:00.000Z` (jamais futur), lignes avec exactement un de `nombreBoites` et `quantiteUnites`, `dateExpiration` au dernier jour du mois (D684) ou `sansPeremption: true`, lot (64) et coût entier seulement s'ils sont saisis, 200 lignes au plus.
- Erreurs : `VALIDATION` (`lignes.<i>.<champ>` rapporté par le rang dans le corps envoyé), `DATE_PEREMPTION_*` (`details[].stockId`), `JOURNEE_CLOTUREE`, `STOCK_INTROUVABLE` et 404, `IDENTIFIANT_DEJA_UTILISE` (nouvel `id`), `FOURNISSEUR_EXISTANT` : conformes. Message du serveur dans le bandeau (D687).
- Liste : colonnes, « Non renseigné », pagination, vide et erreur avec réessai : conformes.

## Corrections du chef (réserves du vérificateur)

1. **R1** : l'avertissement de fiche non confirmée a deux textes. Avec plus d'une unité par boîte, le conseil d'origine (le choix « en <unités> » existe). Avec 1 unité par boîte (toute fiche neuve, aucun choix d'unité) : « Si une boîte en contient plusieurs, indiquez-le dans sa fiche avant d'enregistrer cette réception. Sinon, vous pouvez l'enregistrer telle quelle. » (non bloquant). Deux actions sous le texte : lien « Ouvrir le stock dans un nouvel onglet » (la saisie en cours est gardée) et bouton « J'ai confirmé la fiche : actualiser », qui recharge les fiches sans toucher aux lignes ; l'avertissement disparaît dès que la fiche est confirmée (ou en passant la ligne en unités). Un échec de cette actualisation s'affiche dans la carte des lignes. Raison du conseil « avant » : une fois des lots reçus à 1 unité par boîte, la conversion de PB13 ne multiplie que les lots techniques (409 `CONVERSION_IMPOSSIBLE`).
2. **R2** : après un refus du serveur qui signale des lignes (`VALIDATION`, `DATE_PEREMPTION_*`), le focus va sur la première ligne en erreur (rang dans le corps, puis ordre des champs) et le bandeau `role="alert"` s'affiche en tête de la carte « Médicaments reçus », sous son titre ; il fait de même pour les contrôles locaux. Les autres refus et l'échec réseau (boutons « Réessayer l'envoi », « Modifier la saisie ») gardent le bandeau près du bouton d'envoi. Le champ Lot affiche aussi son message de refus (il n'avait que `aria-invalid`).
3. **R3** (D708) : `couvreSousPages: true` sur l'entrée `receptions` ; `estRouteAutorisee` applique sa règle à toute adresse `/dashboard/receptions/...` (préfixe arrêté au séparateur). Les autres entrées gardent la correspondance exacte.
4. **R4** : Entrée dans Quantité passe à Péremption (ou à Lot si « Sans date » est cochée), dans Péremption à Lot (la date lue s'affiche), dans Lot à Coût ; jamais d'envoi (aucun formulaire, `preventDefault`), rien pendant le verrou.
5. **R5** : plafonds du back appliqués localement : « Une ligne ne peut pas dépasser 1 000 000 boîtes : vérifiez la quantité. » et « ... 1 000 000 000 <unités> ... » (espaces insécables), focus sur le champ, rien n'est envoyé. Le coût reste plafonné à 2 147 483 647 comme le back.
6. Tests ajoutés : `nouvelle/page.test.tsx` 9 vers 13 (fiche à 1 unité par boîte puis actualisation, Entrée de champ en champ, plafonds, focus et place du bandeau après un refus `VALIDATION` sur deux lignes) ; test de navigation (saisie, avec ou sans barre oblique finale, et détail refusés au rôle Pharmacien, permis au titulaire, `/dashboard/receptionsX` non couvert).

## Preuves

- `docker compose exec -T frontend npx tsc --noEmit` exit 0.
- `npx eslint` sur les 8 fichiers de la fiche exit 0.
- `npx vitest run` : 65 fichiers, 562 verts (557 avant le chef).
- `npm run build` local réussi ; hook pre-commit du front passé.
- Aucun U+2013 ni U+2014 dans les fichiers touchés ; aucune valeur de `.env` lue.

## Test à la main (fait par le chef, au niveau de l'API)

Le panneau navigateur de l'application refuse `localhost` et le front appelle l'API sur `localhost:3101` : l'écran n'a pas pu être joué. La saisie a été rejouée par l'API avec le corps exact que la page construit, en compte démo (base de dev non remise à zéro : aucune réception, toutes les fiches de Kaloum à 1 unité par boîte et non confirmées, le cas de R1).

Facture d'exemple UbiPharm (`rapport/`, n° NCKY/714181), recopiée sur deux médicaments du stock de démo :

1. Djénabou Baldé (titulaire, Kaloum) : `reception:write` présent ; liste vide ; fournisseur « UbiPharm Guinée » créé (`+224 626 26 26 96`), puis « ubipharm guinée » : 409 « Un fournisseur porte déjà ce nom dans votre pharmacie. ».
2. Réception `NCKY/714181` : Ventoline 3 boîtes, péremption `6/28` (envoyée `2028-06-30`), coût 95 630 ; Amoxicilline 20 boîtes, `10/27` (`2027-10-31`), sans coût. Réponse « Réception enregistrée : 2 lots. », deux avertissements `FICHE_NON_QUALIFIEE`, coût absent sur le lot sans coût (jamais 0).
3. Même `id` renvoyé : « Cette réception était déjà enregistrée. », `cree: false`, même réception ; liste : 1 réception, UbiPharm Guinée, 2 lots.
4. Péremption passée : 400 `DATE_PEREMPTION_PASSEE` avec `details` (stockId, nom) ; 1 000 001 boîtes : 400 `VALIDATION` `lignes.0.nombreBoites`, désormais arrêté avant l'envoi par le front.
5. Ousmane Keita (vendeur) : pas de `reception:write`, `GET .../receptions` 403 `PERMISSION_REFUSEE` ; le menu et l'accès direct aux trois adresses sont refusés par la garde (test).

À faire par le porteur, démo remise à zéro, front `http://localhost:3100` : le parcours de la fiche à l'écran (liste avec `BL-BON-0087` et `BL-MAT-0412`, saisie au clavier avec Entrée de champ en champ, Ventoline reçue avec le message de rattachement de la vente sans stock), l'avertissement sur Spasfon (Niger) et les captures clair et sombre.

## Réserves

- `DATE_PEREMPTION_REQUISE` et `DATE_PEREMPTION_PASSEE` ne citent que la fiche (`stockId`, `nom`) : si une même fiche figure sur plusieurs lignes, toutes ses lignes sont signalées, y compris celle dont la date est valide (limite du contrat du back ; un indice de ligne dans `details` la lèverait).
- Message de rattachement des ventes sans stock non observé (base non remise à zéro, aucune vente provisoire sur les médicaments reçus).
- Écran, clavier réel et captures clair et sombre non joués (panneau navigateur sans accès à `localhost`), renvoyés au porteur.
- Les réceptions de test (UbiPharm Guinée, NCKY/714181) restent dans la base de dev jusqu'à la prochaine remise à zéro de la démo.
- Fins de ligne LF (avertissements git CRLF), sans effet sur les gates.
