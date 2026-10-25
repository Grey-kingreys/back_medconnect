# Vérification B11 : changement de mot de passe, 401 et codes machine

Date : 2026-10-21
Dépôt : back_medconnect, branche orch/lot5-back (non commité)
Tâche : docs/plans/runs/2026-10-21-lot5/tasks/B11-erreurs-401-mot-de-passe.md

## Commandes relancées par le vérificateur

- `docker compose exec -T backend npx tsc --noEmit` : sortie 0, aucune erreur.
- `docker compose exec -T backend npx eslint <11 fichiers de la liste B11>` : sortie 0, aucune erreur ni avertissement.
- `docker compose exec -T backend npx jest` : 55 suites sur 55 vertes, 621 tests passés, 3 ignorés (préexistants), 0 échec.
- `git -C back_medconnect grep -n "Le mot de passe actuel est incorrect'" -- src/auth/auth.service.ts` : aucun résultat (plus de 401).
- `git -C back_medconnect grep -n "MOT_DE_PASSE_ACTUEL_INCORRECT" -- src/auth/auth.service.ts src/common/filters/codes-erreur.ts` : une ligne dans chaque fichier (auth.service.ts l. 481, codes-erreur.ts l. 38).
- `git -C back_medconnect diff | grep -P "[\x{2013}\x{2014}]"` : aucun résultat.
- `grep -P "[\x{2013}\x{2014}]" src/structure/structure.details-publics.spec.ts` : aucun résultat.
- `git -C back_medconnect diff --name-only` et `status --short` : voir point 5 ci-dessous.

## Relecture du diff

- Changements conformes à la spec : codes-erreur.ts (4 codes à la fin, ordre respecté), auth.guard.ts (JETON_ABSENT, JETON_EXPIRE via `instanceof TokenExpiredError`, JETON_INVALIDE, messages inchangés), auth.service.ts (BadRequestException 400 avec code, COMPTE_DESACTIVE sur editProfile et changePassword, les autres UnauthorizedException intactes), structure.service.ts (NotFoundException, import UnauthorizedException conservé), erreur-validation.ts (message optionnel, MESSAGES_REGLES, pas de fuite de valeur), all-exceptions.filter.ts (assainirChamps recopie message seulement si chaîne, message du corps remplacé seulement pour un champ unique).
- Aucune valeur de saisie dans les réponses (le texte de règle vient d'une table constante).
- Aucun code par défaut ajouté aux 401 (test dédié présent).
- Tests : aucun test supprimé ni affaibli ; les tests existants sont modifiés uniquement par ajout (import et assertion `toMatchObject` complétée). Les nouveaux tests couvrent les points de la section 7 (a à e).
- Aucun secret ni valeur réelle ajouté. Les mots de passe de test sont des valeurs fictives déjà utilisées dans les specs.
- Dans les lignes ajoutées : aucun tiret cadratin ni demi-cadratin (vérifié sur le diff complet et sur le nouveau fichier).

## Points à signaler

1. Done when n°5 (fichiers modifiés uniquement dans la liste autorisée) n'est pas strictement respecté : `docs/plans/ACTIVE.md` et `docs/plans/runs/2026-10-21-lot5/decisions.md` apparaissent modifiés (ligne B11 ajoutée, B10 passée en « Faites », décisions D90 à D96). Ces modifications portent sur le suivi de l'orchestrateur, pas sur le code de la tâche ; le codeur n'a pas à les toucher. Action : l'orchestrateur doit confirmer qu'il les a écrites lui-même et les exclure du commit B11 (ou les commiter à part), sans modifier la liste de fichiers du code.
2. Fichiers non suivis : `src/structure/structure.details-publics.spec.ts` (nouveau, attendu) et la tâche elle-même (hors commit).
3. Avertissements Git « LF will be replaced by CRLF » : bruit de configuration de fin de ligne Windows, sans effet sur le verdict.

## Verdict

Code conforme à la spec. Tests, typage et lint verts. Un seul écart, côté suivi documentaire (point 1), à traiter par l'orchestrateur avant commit.
