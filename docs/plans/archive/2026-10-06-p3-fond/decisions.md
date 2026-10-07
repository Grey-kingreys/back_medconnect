# Décisions - run 2026-10-06-p3-fond

Append-only. Une ligne par décision. Consulter par grep avant toute question.

Format : `D<NN> | AAAA-MM-JJ | <décision> | <pourquoi> | tranché par : plan, convention, défaut (révisable) ou user | tâches : T..`

D01 | 2026-10-06 | Les tests de checkAccess décrivent le comportement actuel, sans modifier le service ; appel via la méthode privée (cast) ou via une méthode publique qui l'utilise | Le niveau P1 corrige le contrôle d'accès (point 10) en parallèle ; ses changements pourront faire évoluer ces tests à la fusion | plan | T03
D02 | 2026-10-06 | Spécification F4 rangée dans back_medconnect/docs/specs/F4-ordonnance-vers-pharmacie.md | Le modèle de données et les endpoints vivent au back ; un seul endroit | défaut (révisable) | T01
D03 | 2026-10-06 | Mode strict TypeScript du back parqué. Recommandation : après fusion des niveaux P0 à P2, activer d'abord strictNullChecks puis noImplicitAny module par module (carnet-sante, auth, pharmacie en premier), avec un compteur d'erreurs qui ne doit que baisser dans la CI | Diff transverse sur tout src/, conflits garantis avec les niveaux qui tournent en parallèle | plan | T10
D04 | 2026-10-06 | Code mort documenté par un commentaire d'en-tête, sans suppression ni changement de comportement | Consigne : ne supprimer aucun code existant | plan | T04
D05 | 2026-10-06 | deploy.sh du dépôt parent modifié dans le worktree .worktrees/parent-p3 (branche orch/p3-fond du parent), suivi ici car le parent n'a pas de plan d'orchestration | Un seul index de run côté back | défaut (révisable) | T09
D06 | 2026-10-06 | Erreurs de lint préexistantes du code mort (no-unsafe-assignment, no-unsafe-member-access) neutralisées par un eslint-disable de fichier justifié, et formatage prettier appliqué aux fichiers touchés | Le pre-commit lint les fichiers entiers ; corriger le typage d'un code inutilisé n'a pas de valeur | défaut (révisable) | T04
D07 | 2026-10-06 | T02 : en-tête eslint-disable des règles no-unsafe-* dans auth.service.spec.ts, les doublures jest.Mock étant typées any | Usage courant en test, limité au fichier de test | défaut (révisable) | T02
D08 | 2026-10-07 | CLAUDE.md du back : la dette « aucun test » est remplacée par « tests encore partiels » (AuthService, contrôle d'accès au carnet, stockage) | La mention était devenue fausse après T02 et T03 | plan | T02, T03
