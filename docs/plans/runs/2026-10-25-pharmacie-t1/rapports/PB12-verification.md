# PB12 - Vérification indépendante

Verdict : PASS

## Commandes relancées (depuis la racine medconnecte)

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint <8 fichiers de la fiche>` : aucune erreur.
- `docker compose exec -T backend npm test` : 79 suites passées, 903 tests passés, 3 ignorés (déjà ignorés avant), 0 échec ; vente-regles.spec.ts compte 27 `it`.
- `docker compose exec -T backend npm run test:db` : 17 suites, 190 tests, tout vert (annulation, vente 20 tests, non-regression-lectures, sessions-caisse, schema-derive, etc.).
- `test/db/annulation.db-spec.ts` x3 : 12 tests passés à chaque fois (9 blocs de la fiche, le 7 étant en 4 sous-tests a à d) ; test de concurrence stable.
- `git status --porcelain` : seuls les 9 fichiers attendus + fiche + docs du run (ACTIVE.md, decisions.md, fiche), tous du chef ; `git diff --stat -- test/db/instantanes test/db/non-regression-lectures.db-spec.ts test/db/vente.db-spec.ts prisma` : vide.
- grep `ANNULATION_HORS_DELAI|lignesNonRemises|increment`, `statut: 'ANNULEE'|annuleeLe: maintenant` dans vente.service.ts : aucune ligne.
- Tirets cadratin et demi-cadratin (U+2013, U+2014) dans les lignes ajoutées et dans annulation.db-spec.ts (recherche Python, grep -P inutilisable ici) : aucun.

## Relecture du diff contre la fiche

Conforme : contrat (champs, codes 409, permissions vente:annuler + caisse:utiliser, posteId optionnel validé), annulerVente suit la fiche à la lettre (ordre des étapes, pièce unique via venteOrigineId unique + verrou de l'origine + capture de doublon, mouvements CORRECTION positifs sur les lots d'origine, provisoire sans lot, paiements opposés rattachés à la session de l'auteur, jourMetier de cette session, aucune colonne gelée écrite, audit sans motif ni client). Entiers uniquement, `oppose` évite -0, objets construits champ par champ. Coûts via masquerCouts. Messages en français lisibles par un vendeur. Aucun test supprimé (0 suppression dans les deux specs), aucun secret. CLAUDE.md : trois modifications demandées présentes, sans tiret long.

## Écart déclaré : FOR KEY SHARE sur PointDeVente avant FOR UPDATE de la vente d'origine

Verdict sur l'écart : justifié, sans cycle nouveau.

Ordres de verrous réels relevés :
- annulation : [PointDeVente FOR UPDATE via assurerPoste, seulement si poste par défaut absent] puis Poste FOR UPDATE OF p, session (insert éventuel) puis SessionCaisse FOR UPDATE OF s, puis PointDeVente FOR KEY SHARE, Vente(origine) FOR UPDATE, verrous consultatifs des fiches, insertions.
- enregistrerVente : [PointDeVente FOR UPDATE via assurerPoste] puis Poste, SessionCaisse, ligne CompteurTicket, fiches consultatives, insertions (clés étrangères en KEY SHARE sur le PV). Elle ne verrouille jamais une Vente existante, donc aucune arête vers le verrou de l'origine.
- sessions-caisse ouvrir (ouvrirDansTransaction) : Poste puis insertion de session ; fermer : SessionCaisse FOR UPDATE seul (aucun verrou de poste ni de PV FOR UPDATE ensuite, seulement des clés étrangères en KEY SHARE).
- assurerPoste : PV FOR UPDATE en premier, puis insertions de poste et d'audit, sans attente sur aucun verrou de poste, session ou vente.

Raisonnement : KEY SHARE est compatible avec KEY SHARE, FOR NO KEY UPDATE et les insertions à clé étrangère ; il ne conflit qu'avec le FOR UPDATE de assurerPoste. L'ordre pris est donc PV(partagé) avant Vente(origine), alors que la création de poste tient PV(exclusif) sans jamais attendre une vente : un détenteur de l'origine ne peut plus attendre le PV exclusif d'un tiers (il a déjà son KEY SHARE, ce qui bloque ce tiers en amont), ce qui supprime le cycle observé (B tient l'origine et attend le PV via la clé étrangère de l'insertion ; C tient le PV et attend l'origine). La vente, l'ouverture et la fermeture de session n'ajoutent aucune arête vers la Vente d'origine ni vers le PV exclusif après avoir tenu une session.

## Remarque non bloquante (risque résiduel, préexistant)

Triple course d'un même utilisateur à son tout premier usage (une création du poste web par défaut validée entre le findFirst d'une requête C et son assurerPoste, pendant qu'une annulation A du même utilisateur a déjà trouvé ce poste et le verrouille) : C tient PV FOR UPDATE puis attend le verrou du poste détenu par A, qui attend le PV KEY SHARE. La même forme existe déjà dans enregistrerVente (clé étrangère à l'insertion de la pièce) et n'est pas introduite par le correctif ; fenêtre très étroite, aucune action requise pour PB12. À noter pour une éventuelle passe de durcissement (reprendre le findFirst du poste après le verrou PV).

## Problèmes à corriger

Aucun.
