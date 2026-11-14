# PF03a : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur à faire par l'orchestrateur principal. Front `orch/pharmacie-t1-front` add367c.

## Ligne d'ouverture

Défaut confirmé : la date dépendait du bandeau (`jourMetier`), donc une caisse ouverte hier soir et rattachée à aujourd'hui affichait « Ouverte à 22:00 », comme si elle avait été ouverte aujourd'hui.

Correction du chef : `momentOuverture` suit le seul jour d'ouverture ; le bandeau reste sur `jourMetier` (D730). La phrase « Ce poste est occupé par la caisse de ..., ouverte à ... » avait le même défaut et prend la même règle.

Tests ajoutés (`caisse/page.test.tsx`) : caisse d'hier soir datée et sans bandeau, caisse du jour sans date, caisse d'un autre vendeur datée.

## Bandeau

Ajout hors fiche, consigné en D730. Il demande de fermer la caisse : tant que PF03b n'est pas livré, l'écran ne propose pas cette fermeture.

## Preuves

- Après la correction du chef : `vitest` 71 fichiers et 688 verts, `eslint` sans erreur sur les 2 fichiers touchés, crochet pre-commit (`tsc`, `eslint`) passé.
- Le reste de la fiche repose sur la vérification Sonnet (PASS), non refaite ici : seules la ligne d'ouverture, le bandeau et le diff de la vente et de la navigation ont été relus.
- Correction du chef non revue par un agent. Aucun test navigateur.
