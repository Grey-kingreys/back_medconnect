# B13 - Vérification (Haiku, vérificateur)

Date : 2026-10-22
Dépôt vérifié : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect` (arbre principal, branche `orch/lot7-back`, non commité)
Fiche : `docs/plans/runs/2026-10-22-lot7/tasks/B13-ventes-pharmacie.md`

## Commandes du Done when (relancées par le vérificateur)

1. `prisma migrate status` : base à jour, 14 migrations, schéma à jour. `prisma validate` : schéma valide. OK.
2. `tsc --noEmit` : sortie 0. OK.
3. `eslint` sur les 18 fichiers listés : sortie 0, aucun avertissement. OK.
4. `jest` complet : 59 suites passées sur 59, 689 tests passés, 3 ignorés, 0 échec. `vente.service.spec.ts` contient les 13 groupes numérotés (1 à 13) et est vert ; `vente.http.spec.ts` est vert (5 cas, dont les 4 demandés). Relance ciblée des 4 suites de la tâche (vente service, vente http, permissions type structure, filtre d'exceptions) : 92 tests verts.
5. Tiret cadratin / demi-cadratin : aucune occurrence dans les lignes ajoutées du diff ni dans les nouveaux fichiers (recherche par octets). OK.
6. Appel réel de bout en bout (section 10) : NON relancé par le vérificateur. Seule une sonde en lecture a été faite : `GET http://localhost:3101/auth/demo/comptes` renvoie 200 (mode démo actif, port publié 3101). Le scénario complet crée des ventes et modifie des quantités de stock dans les données démo ; les 9 lignes consignées par le codeur doivent être comparées à la fiche par le chef d'équipe.
7. `CLAUDE.md` : puce « Ventes en pharmacie (B13, lot 7) » présente (ligne 70), avec les 4 routes, permissions et codes HTTP. Le contenu détaillé de la section 11 n'a pas été comparé point par point.

## Contrôles complémentaires

- Aucun `any` ni `eslint-disable` dans les nouveaux fichiers.
- Aucun `console.*` dans le service ou le contrôleur ; les journaux ne contiennent que des identifiants de vente, pas de nom ni téléphone de client ni de motif.
- Migration : `USING ROUND("prixUnitaire")::INTEGER` présent ; reprise des permissions avec `ON CONFLICT` (idempotente).
- Schéma : `prixUnitaire Int?` sur `StockMedicament`, modèles `Vente`, `LigneVente`, `CompteurVente` ajoutés.

## Verdict

PASS sur les commandes automatisables (1 à 5 et 7 partiellement). Point 6 non vérifié par le vérificateur (appel réel), à faire valider par le chef d'équipe à partir du Return du codeur.

## Écarts relevés

- Le worktree indiqué au départ (`D:\tmp\wt-back-lot7b`, branche `orch/lot7b-back`) n'est pas l'arbre décrit par la fiche ; la vérification a été faite sur l'arbre principal indiqué par la fiche.
- `vente.http.spec.ts` contient 5 cas au lieu de 4 : écart positif, sans conséquence.
