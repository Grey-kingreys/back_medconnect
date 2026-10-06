# Décisions - run 2026-10-06-p3-fond

Append-only. Une ligne par décision. Consulter par grep avant toute question.

Format : `D<NN> | AAAA-MM-JJ | <décision> | <pourquoi> | tranché par : plan, convention, défaut (révisable) ou user | tâches : T..`

D01 | 2026-10-06 | Les tests de checkAccess décrivent le comportement actuel, sans modifier le service ; appel via la méthode privée (cast) ou via une méthode publique qui l'utilise | Le niveau P1 corrige le contrôle d'accès (point 10) en parallèle ; ses changements pourront faire évoluer ces tests à la fusion | plan | T03
D02 | 2026-10-06 | Spécification F4 rangée dans back_medconnect/docs/specs/F4-ordonnance-vers-pharmacie.md | Le modèle de données et les endpoints vivent au back ; un seul endroit | défaut (révisable) | T01
D03 | 2026-10-06 | Mode strict TypeScript du back parqué. Recommandation : après fusion des niveaux P0 à P2, activer d'abord strictNullChecks puis noImplicitAny module par module (carnet-sante, auth, pharmacie en premier), avec un compteur d'erreurs qui ne doit que baisser dans la CI | Diff transverse sur tout src/, conflits garantis avec les niveaux qui tournent en parallèle | plan | T10
D04 | 2026-10-06 | Code mort documenté par un commentaire d'en-tête, sans suppression ni changement de comportement | Consigne : ne supprimer aucun code existant | plan | T04
D05 | 2026-10-06 | deploy.sh du dépôt parent modifié dans le worktree .worktrees/parent-p3 (branche orch/p3-fond du parent), suivi ici car le parent n'a pas de plan d'orchestration | Un seul index de run côté back | défaut (révisable) | T09
