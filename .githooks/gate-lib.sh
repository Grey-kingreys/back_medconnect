#!/bin/sh
# Bibliotheque commune des hooks git (sourcee par pre-commit et pre-push).
#
# run_gate <commande...> : lance une commande de gate
#   1. dans le conteneur Docker "$GATE_SERVICE" s'il tourne ET si le commit vient
#      de l'arbre principal (le conteneur monte l'arbre principal, pas les worktrees) ;
#   2. sinon en local, avec les binaires de node_modules de l'arbre principal.
#
# Requiert : GATE_SERVICE (nom du service dans compose.yml), defini par le hook.

# Le hook est appele par chemin absolu (core.hooksPath absolu) :
# .../<depot>/.githooks/<hook> -> arbre principal = parent de .githooks.
HOOK_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_MAIN=$(dirname "$HOOK_DIR")
COMPOSE_DIR=$(dirname "$REPO_MAIN")
TOPLEVEL=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)

conteneur_actif() {
  [ "$TOPLEVEL" = "$REPO_MAIN" ] || return 1
  [ -f "$COMPOSE_DIR/compose.yml" ] || return 1
  command -v docker >/dev/null 2>&1 || return 1
  [ -n "$(cd "$COMPOSE_DIR" && docker compose ps --status running -q "$GATE_SERVICE" 2>/dev/null)" ]
}

if conteneur_actif; then
  GATE_MODE=docker
  echo "Gate: conteneur Docker '$GATE_SERVICE'." >&2
elif [ -d "$REPO_MAIN/node_modules/.bin" ]; then
  GATE_MODE=local
  PATH="$REPO_MAIN/node_modules/.bin:$PATH"
  export PATH
  echo "Gate: local (conteneur '$GATE_SERVICE' arrete ou worktree)." >&2
else
  echo "Gate impossible: conteneur '$GATE_SERVICE' arrete et node_modules absent." >&2
  echo "Lancer 'docker compose up' a la racine, ou './setup-dev.sh' (voir CLAUDE.md racine)." >&2
  echo "Contournement volontaire: --no-verify." >&2
  exit 1
fi

# Commande dans le conteneur ou en local selon GATE_MODE.
run_gate() {
  if [ "$GATE_MODE" = docker ]; then
    (cd "$COMPOSE_DIR" && docker compose exec -T "$GATE_SERVICE" "$@")
  else
    "$@"
  fi
}

# Fichiers indexes (ajoutes, copies, modifies, renommes) dont le chemin correspond
# a l'expression reguliere etendue $1. Chemins relatifs a la racine du depot, valables
# aussi dans le conteneur (WORKDIR /app = racine du depot montee).
# Sert a linter seulement ce que le commit touche : la dette existante du projet
# ne bloque pas les commits, mais tout fichier touche doit etre propre.
fichiers_indexes() {
  git diff --cached --name-only --diff-filter=ACMR | grep -E "$1" || true
}

# Commande toujours locale (ex. build qui ne doit pas ecraser le .next du conteneur de dev).
run_local() {
  if [ ! -d "$REPO_MAIN/node_modules/.bin" ]; then
    echo "node_modules local absent: lancer './setup-dev.sh' a la racine." >&2
    exit 1
  fi
  case ":$PATH:" in
    *":$REPO_MAIN/node_modules/.bin:"*) ;;
    *) PATH="$REPO_MAIN/node_modules/.bin:$PATH"; export PATH ;;
  esac
  "$@"
}
