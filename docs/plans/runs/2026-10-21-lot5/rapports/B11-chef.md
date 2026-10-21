# B11 : rapport du chef d'équipe back

Date : 2026-10-21. Branche `orch/lot5-back`. Statut : **validé**.

## Ce qui a été fait

- `POST /auth/change-password` avec un mot de passe actuel faux : 400 `MOT_DE_PASSE_ACTUEL_INCORRECT` (« Le mot de passe actuel est incorrect. ») au lieu de 401 ; rien n'est modifié, aucune session révoquée.
- `AuthGuard` : 401 codés `JETON_ABSENT`, `JETON_EXPIRE` (`TokenExpiredError`), `JETON_INVALIDE` ; messages et bloc de révocation inchangés.
- `editProfile` et `changePassword` : utilisateur introuvable ou inactif en 401 `COMPTE_DESACTIVE` (message `MESSAGES_SESSION.compteDesactive`).
- `getPublicStructureDetails` : structure introuvable en 404 (message inchangé).
- Validation : `MESSAGES_REGLES` (seul `newPassword`) pose une règle lisible constante dans `champs[].message` ; le filtre la recopie seulement si c'est une chaîne et la met en message de la 400 quand elle est l'unique champ fautif.
- Quatre codes ajoutés au catalogue `codes-erreur.ts`. Aucun code par défaut sur les 401.
- Tests : `auth.guard.spec.ts`, `auth.service.spec.ts`, `erreur-validation.spec.ts`, `all-exceptions.filter.spec.ts` complétés ; nouveau `structure.details-publics.spec.ts`.

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : code de sortie 0.
- `docker compose exec -T backend npx eslint` sur les 11 fichiers de la tâche : code de sortie 0.
- `docker compose exec -T backend npx jest` : 55 suites sur 55, 621 tests passent, 3 ignorés (préexistants).
- Diff relu en entier : conforme à la spec, aucun test affaibli, aucune valeur saisie renvoyée (texte de règle constant, test de non-fuite en production).
- Tirets cadratin et demi-cadratin : 0 dans les lignes ajoutées et dans le nouveau fichier.
- Régression web et mobile : `grep` sur `front_medconnect/src` et le mobile, aucun client ne dépend du 401 ni des anciens textes (« mot de passe actuel est incorrect », « Utilisateur non trouvé ou inactif ») ; messages des 401 de la garde inchangés.

## Décisions

- Écart signalé par le vérificateur (ACTIVE.md et decisions.md modifiés) : modifications de suivi écrites par l'orchestrateur, commitées avec B11 comme pour B10 (consigne du lot).
- `MESSAGES_REGLES` est indexé par nom de champ : `newPassword` existe aussi dans le DTO de réinitialisation et dans `ChangeUserPasswordDto` (module user) avec exactement les mêmes règles (8 à 50, majuscule, minuscule, chiffre). Le texte y est donc juste aussi ; accepté.

## Réserves

- Front (web et mobile) à adapter : ne rafraîchir que sur `JETON_ABSENT`, `JETON_EXPIRE`, `JETON_INVALIDE` ; afficher le 400 `MOT_DE_PASSE_ACTUEL_INCORRECT` sous le champ « mot de passe actuel » ; lire `champs[].message`. Tant que ce n'est pas fait, le 400 s'affiche comme une erreur de saisie classique (plus de déconnexion intempestive).
- Si une règle de `newPassword` change dans un DTO, `MESSAGES_REGLES` doit suivre (texte non dérivé du DTO, par choix D95).
- `CLAUDE.md` du back (puce Erreurs TB2) ne mentionne pas encore les codes `JETON_*` ni `champs[].message` : à ajouter par l'orchestrateur s'il le souhaite (fichier hors liste de la tâche).
