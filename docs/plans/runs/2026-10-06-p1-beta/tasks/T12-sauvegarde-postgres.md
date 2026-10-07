# T12 - Point 13 (sauvegarde) : script pg_dump avec rotation (dépôt parent)

Tier: spécifié (agent implementeur-specifie)
Dépôt: parent de déploiement, worktree `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/parent-p1` (branche `orch/p1-beta`)
Audience: dev (exploitation)
Visuel: n/a
Background-safe: oui

## Spec

Constat : aucune sauvegarde de la base PostgreSQL (service `postgres` de `compose.yml`, image `postgres:17-alpine`, variables `POSTGRES_USER`, `POSTGRES_DB` fournies par `.env`).

À faire, dans le worktree parent uniquement :
1. Créer `scripts/sauvegarde-postgres.sh` (bash, `set -euo pipefail`, fins de ligne LF) :
   - se place à la racine du dépôt (`cd "$(dirname "$0")/.."`) ;
   - option de surcharge des fichiers compose par variable `COMPOSE_FILES` (défaut : `-f compose.yml -f compose.prod.yml`, l'usage visé est le serveur de prod) ;
   - dump via `docker compose $COMPOSE_FILES exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner'` (les variables sont lues **dans le conteneur**, aucune valeur de secret dans le script) ;
   - écriture dans `${SAUVEGARDE_DIR:-/var/backups/medconnecte}` sous le nom `medconnecte-AAAAMMJJ-HHMMSS.dump`, d'abord dans un fichier temporaire `.partiel` renommé seulement si le dump a réussi et n'est pas vide ; `umask 077` (données de santé) ;
   - rotation : supprime les dumps de plus de `${RETENTION_JOURS:-14}` jours dans ce dossier (seulement les fichiers `medconnecte-*.dump`) ;
   - copie hors serveur optionnelle : si `SAUVEGARDE_DISTANTE` est définie (cible `rclone`, par exemple `r2:medconnecte-sauvegardes`), lance `rclone copy` du dump vers cette cible ; si `rclone` est absent, message d'avertissement clair, code de sortie non nul ;
   - messages en français, horodatés ; code de sortie non nul en cas d'échec ;
   - en-tête de commentaires en français : rôle, variables, exemple de crontab (`0 3 * * * /chemin/medconnecte/scripts/sauvegarde-postgres.sh >> /var/log/medconnecte-sauvegarde.log 2>&1`), **commande de restauration** (`pg_restore` via `docker compose exec -T postgres`), et une note : une sauvegarde qui reste sur le même serveur ne protège ni d'une panne disque ni d'une perte du serveur, la copie hors serveur (`SAUVEGARDE_DISTANTE`) est indispensable en production ; les dumps contiennent des données de santé chiffrées en partie seulement (identité, téléphone en clair), donc la cible distante doit être privée et chiffrée ; tester une restauration régulièrement.
2. Ajouter dans `README.Docker.md` une courte section « Sauvegarde de la base » (5 à 10 lignes) qui renvoie au script et reprend la note sur la copie hors serveur.
3. Le marquer exécutable dans l'index git n'est pas à faire ici (l'orchestrateur le fera au commit avec `git update-index --chmod=+x`).

## Contraintes

Ne toucher à aucun autre fichier du dépôt parent (`compose.yml`, `.env.example`, `deploy.sh` sont modifiés par d'autres niveaux). Commentaires et messages en français, aucun tiret cadratin ni demi-cadratin. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter. Ne jamais lire ni afficher un fichier `.env*`. Docker ne tourne pas : ne pas lancer le script réel.

## Done when

- `bash -n scripts/sauvegarde-postgres.sh` : aucune erreur.
- `shellcheck` s'il est installé (sinon le signaler) : aucun avertissement de niveau error.
- Essai à blanc : avec un faux `docker` placé en tête de `PATH` (script temporaire dans le dossier temporaire du système, qui écrit quelques octets sur la sortie standard) et `SAUVEGARDE_DIR` pointant vers un dossier temporaire contenant un faux vieux dump (date modifiée avec `touch -d '30 days ago'`), le script crée un nouveau `.dump` non vide et supprime l'ancien. Donner la commande et le résultat en une ligne. Nettoyer ensuite.
- Grep : aucun mot de passe ni valeur de secret dans le script.

## Return

Fichiers créés ou modifiés + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-07 | orchestrateur (reprise, D08) | succès | shellcheck absent du poste (non lancé) ; marqué exécutable par `git update-index --chmod=+x` ; LF dans git (D13)

## Validation

bash -n ; essai à blanc (faux docker en tête de PATH, vieux dump daté de 30 jours) ; cas dump vide ; cas rclone absent ; grep secrets | OK ; nouveau dump de 24 octets créé, ancien supprimé, code 0 ; refus, code 1 ; avertissement clair, code 1 ; aucun | parent 4c345a2 (orch/p1-beta)
