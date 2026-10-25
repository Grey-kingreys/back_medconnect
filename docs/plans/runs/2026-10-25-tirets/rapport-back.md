# Rapport : retrait des tirets longs (back)

- Occurrences retirées : 82 lignes touchées (une occurrence par ligne), dans 37 fichiers (code, commentaires, CLAUDE.md, schema.prisma, Dockerfile, .gitignore, scripts).
- Exclus : `.agents/`, `prisma/migrations/`, `package-lock.json`, `.env*`, `generated/`, `node_modules`. Aucun tiret demi-cadratin n'existait.
- Règle appliquée : « A : B » pour les titres et définitions, virgule pour les incises, parenthèses dans les sujets d'email.

## Textes visibles (avant / après)
- Email : « Réinitialisation de votre mot de passe [tiret long] MedConnecte » devient « Réinitialisation de votre mot de passe MedConnecte ».
- Email : « Tentatives de connexion suspectes [tiret long] MedConnecte » devient « Tentatives de connexion suspectes sur MedConnecte ».
- Email : « Invitation [tiret long] Configurez votre X » devient « Invitation : configurez votre X ».
- Email : « Votre compte R sur MedConnecte [tiret long] Structure » devient « Votre compte R sur MedConnecte (Structure) ».
- Pied d'email : « © 2026 MedConnecte [tiret long] Plateforme de Santé Numérique » devient « ... MedConnecte, Plateforme de Santé Numérique ».
- Message d'accueil API : « MedConnecte API [tiret long] Plateforme... » devient « MedConnecte API : Plateforme... ».
- Erreur de configuration : « Configuration invalide [tiret long] l'application ne peut pas démarrer » devient « Configuration invalide : l'application ne peut pas démarrer ».
- Swagger : « Upsert [tiret long] crée si inexistant » devient « Upsert : crée si inexistant ».

## Gate
- tsc --noEmit : OK (aucune erreur).
- eslint (fichiers .ts touchés) : 130 problèmes (116 erreurs prettier/CRLF), identiques avant et après (vérifié par git stash), aucun introduit.
- jest : 62 suites passées, 715 tests passés, 3 ignorés.
- git grep des tirets (hors exclusions) : vide.

## Laissé volontairement
- Aucun test ne vérifiait un texte modifié : aucun spec adapté.
- Migrations Prisma et .agents/ non touchés (somme de contrôle, guides tiers).
