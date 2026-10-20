# Décisions - run 2026-10-06-p0-securite

Append-only. Une ligne par décision. Consulter par grep avant toute question.

Format : `D<NN> | AAAA-MM-JJ | <décision> | <pourquoi> | tranché par : plan, convention, défaut (révisable) ou user | tâches : T..`

D01 | 2026-10-06 | Exécution parallèle : T01, T03, T04 en worktrees de tâche (.worktrees/back-p0-T0x-*), T02 dans le worktree du run | fichiers disjoints, 4 orchestrateurs concurrents | plan | tâches : T01..T04
D02 | 2026-10-06 | Chat : participant = patientId, medecinId, ou membre de la structure (structureId) disposant de chat:structure, même règle que getConversations | cohérence avec la liste des conversations existante | convention | tâches : T01
D03 | 2026-10-06 | RDV status : pas de @RequirePermissions au niveau route (le patient doit pouvoir annuler) ; contrôle en service : patient du RDV limité à ANNULE, sinon rendezvous:write + médecin du RDV ou membre de la structure du RDV | le patient n'a pas rendezvous:write | défaut (révisable) | tâches : T03
D04 | 2026-10-06 | Le rôle par défaut « Administrateur de structure » n'a pas rendezvous:write : il perd la mise à jour de statut que le front lui propose (rendez-vous/page.tsx canAct) ; à signaler au front, l'admin peut s'attribuer la permission | moindre privilège, pas de changement du catalogue de rôles en P0 | défaut (révisable) | tâches : T03
D05 | 2026-10-06 | Les fichiers touchés doivent passer eslint (pre-commit) : dette préexistante corrigée dans ces seuls fichiers (eslint --fix pour prettier, typage minimal sans changement de comportement, RequestWithUser de src/auth/jwt.strategy.ts pour req) | convention du gate (gate-lib.sh : tout fichier touché doit être propre), --no-verify interdit ; risque de conflit de merge avec P1 sur carnet-sante.* | convention | tâches : T01, T02, T03, T04
D06 | 2026-10-06 | Ne jamais utiliser git stash dans un worktree de tâche (pile partagée entre worktrees, incident T01/T04 résolu) | contamination croisée constatée | convention | tâches : toutes
D07 | 2026-10-07 | Reprise du run par un orchestrateur unique qui exécute lui-même les tâches restantes (pas de sous-agent), même discipline : fichier de tâche, validation sur preuves, un commit par tâche | les sous-agents imbriqués se figeaient (orchestrateur précédent bloqué) | user | tâches : T01, T03, T04, T05
D08 | 2026-10-07 | Le pre-commit refuse les tirets cadratins sur toute ligne ajoutée, y compris une ligne préexistante seulement reformatée par prettier : remplacer le tiret par une ponctuation neutre (exemple Swagger du DTO analyse : « ; ») | --no-verify interdit, texte d'exemple sans portée fonctionnelle | défaut (révisable) | tâches : T03
D09 | 2026-10-07 | Run P0 clos côté back : T01, T03, T04 mergés en --no-ff dans orch/p0-securite (ordre T01, T03, T04, sans conflit), suite complète verte après merge | done-conditions toutes rejouées | plan | tâches : T01..T05
