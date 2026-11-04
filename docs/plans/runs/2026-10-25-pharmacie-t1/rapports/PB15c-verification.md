# PB15c - Vérification (Sonnet, indépendant)

Verdict : PASS (avec 2 remarques non bloquantes)

## Commandes relancées

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `npx eslint` des 8 fichiers dto/specs/db-specs : 0 erreur, 0 avertissement.
- `npx eslint pharmacie.service.ts pharmacie.controller.ts` : 0 erreur, 7 avertissements `no-unsafe-argument` dans le contrôleur, lignes 148 à 332, hors du code ajouté (qui commence ligne 344).
- `npm test` : 88 suites, 982 passés, 3 ignorés (préexistants), 0 échec.
- `pharmacie.import.spec.ts` : 25 tests, conforme à la fiche.
- `npm run test:db` : 24 suites, 290 passés ; `import-inventaire.db-spec.ts` compte 11 `it` (conforme).
- `git diff --stat -- prisma test/db/instantanes` : vide. Aucune migration.
- `grep IMPORT_INVENTAIRE_INDISPONIBLE pharmacie.service.ts` : seule la constante de message (l.107), aucun `code:`. `stockMedicament.upsert` : seulement `upsertStock`.
- Tirets cadratins ou demi-cadratins dans les lignes ajoutées et dans le fichier nouveau : aucun.
- Encodage : tous les fichiers sont en CRLF cohérent (le dépôt normalise en LF à l'index, l'avertissement git est celui de tout le dépôt), pas de BOM, diff de taille raisonnable : pas de réécriture complète.
- Quatre specs de construction : seuls l'import et l'appel `new InventairesService(...)` changent. `import-livraison.db-spec.ts` : en plus l'import des constantes et le seul test 5 (403 et `MESSAGE_IMPORT_INVENTAIRE_INTERDIT`). Aucun test affaibli ni supprimé ; `pharmacie.import.spec.ts` ne perd que l'ancien test 16 (remplacé comme prévu) et les imports devenus inutiles.
- CLAUDE.md : phrase 409 remplacée, puce PB15c ajoutée.

## Conformité fiche, PLAN et décisions

Mode absent = inventaire, `inventaire:write` exigé avant lecture du fichier (403 `MESSAGE_IMPORT_INVENTAIRE_INTERDIT`, donc le rôle Pharmacien reçoit 403, D598). Colonnes, raisons, doublons par lot, refus du cœur traduits ligne par ligne, fiche absente (0 rejeté, positif créé avec anomalie), un seul `Inventaire` (commentaire « Import Excel »), `inventaireId` et `receptionId` null selon le mode, modèle `?mode=inventaire` et nom de fichier, aperçu sans écriture, prix, coût et notes ignorés, coûts masqués en livraison : conformes. Textes en français clair.

## Points précis

(a) `MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE` (service l.107) n'est plus utilisée nulle part (ni `src` ni `test`). La fiche demandait de la garder, mais c'est du code mort. Le code `IMPORT_INVENTAIRE_INDISPONIBLE` reste au catalogue (`codes-erreur.ts`) comme voulu. Action suggérée : retirer la constante (3 lignes) au prochain passage, sans risque ; non bloquant puisque la fiche l'imposait.

(b) Écart 4 : conforme à D589 tel qu'écrit. La règle `ciblerLot` (domaine/inventaire.ts, PB15b, déjà commité) n'accepte « lot unique en stock » que parmi les lots à solde strictement positif. Pour une fiche dont l'unique lot est à solde 0 ou négatif, sans numéro ni date, quantité positive : refus `DATE_PEREMPTION_REQUISE`.
- Cas réel : le vendeur a vendu un produit à stock enregistré 0 (ventes faites sans stock, solde du lot négatif ou nul), puis retrouve 3 boîtes en rayon et les compte sans lot ni date. Message reçu : « Ces boîtes ne correspondent à aucun lot en stock : indiquez leur date de péremption (AAAA-MM-JJ) ou « sans péremption ». »
- Contournement existant : écrire le numéro de lot (l'étape 2 cible aussi un lot à solde nul). Sans numéro, donner la date ne cible pas le lot épuisé (l'étape 3 exige un solde positif) : un nouveau lot est créé, et l'ancien reste négatif à côté. C'est le vrai défaut de fond.
- Correction possible, qui demande de réviser D589 (cœur PB15b, hors PB15c) : à l'étape 4, si aucun lot n'a de solde positif mais que la fiche n'a qu'un seul lot au total (solde nul ou négatif), le cibler, et pour l'étape 3 accepter aussi un lot à solde nul quand sa date correspond et qu'il est le seul. Ainsi le comptage ramène le lot épuisé à la quantité comptée et rattache les ventes sans stock. À proposer au chef comme décision, pas à faire dans PB15c.

(c) Écriture propre : UTF-8, CRLF cohérent sur tous les fichiers, pas de réécriture complète.

## Problèmes

Aucun bloquant.
1. Mineur : constante morte `MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE` (voir a).
2. Recommandation de produit : lot épuisé unique non ciblé sans numéro (voir b), à trancher par une décision D589 révisée.
