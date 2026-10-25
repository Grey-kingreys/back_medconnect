# B7 - Réalignement du modèle AuditLog de schema.prisma sur la migration existante

Tier: mécanique (agent mecanique)
Audience: n/a (schéma interne, aucun texte visible)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot3-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot3/decisions.md`, D63 à D65.

## Spec

### Contexte (constaté par le chef le 2026-10-21)

La migration `prisma/migrations/20260704_add_soft_delete_audit_trail/migration.sql` a créé la table `AuditLog` avec :
- la clé étrangère `AuditLog_userId_fkey` en `ON DELETE SET NULL` **sans clause ON UPDATE** (donc `NO ACTION` en PostgreSQL) ;
- trois index : `AuditLog_userId_idx` (`userId`), `AuditLog_entityType_entityId_idx` (`entityType`, `entityId`), `AuditLog_createdAt_idx` (`createdAt`).

`prisma/schema.prisma` déclare déjà la relation `user` et le champ inverse `auditLogs AuditLog[]` sur `User` (ligne 143), mais sans `onUpdate` (Prisma suppose alors `ON UPDATE CASCADE`) et sans aucun `@@index`. Résultat actuel de `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` : suppression puis recréation de `AuditLog_userId_fkey` en `ON UPDATE CASCADE`, et `DROP INDEX` des trois index.

Le chef a vérifié sur une copie du schéma (dans `/tmp` du conteneur, rien écrit dans le dépôt) que la modification ci-dessous donne `-- This is an empty migration.` et un schéma valide.

### Modification unique

Dans `prisma/schema.prisma`, modèle `AuditLog` (vers la ligne 351), et nulle part ailleurs :

1. Remplacer la ligne
   ```
     user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
   ```
   par
   ```
     user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull, onUpdate: NoAction)
   ```
2. Après la ligne `  createdAt   DateTime @default(now())` du modèle `AuditLog`, ajouter une ligne vide puis exactement ces trois lignes (dans cet ordre, sans argument `name` ni `map` : les noms par défaut de Prisma sont ceux de la migration) :
   ```

     @@index([userId])
     @@index([entityType, entityId])
     @@index([createdAt])
   ```

Le modèle final doit être, à l'identique (commentaires existants conservés) :

```
model AuditLog {
  id          String   @id @default(uuid())
  userId      String?  // NULL si action système
  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull, onUpdate: NoAction)

  action      String   // ex. "create", "update", "delete"
  entityType  String   // ex. "Consultation", "Ordonnance", "Vaccination", "ResultatAnalyse"
  entityId    String   // ID de l'entité modifiée
  ip          String?  // adresse IP source
  metadata    Json?    // données contextuelles supplémentaires (ex. ancienne/nouvelle valeur)

  createdAt   DateTime @default(now())

  @@index([userId])
  @@index([entityType, entityId])
  @@index([createdAt])
}
```

### Interdits

- Aucune nouvelle migration (`prisma/migrations/` inchangé), aucun `prisma migrate dev`, `migrate reset`, `db push`, `migrate deploy` ni requête SQL d'écriture : la base ne doit pas bouger.
- Ne pas toucher au modèle `User` : le champ inverse `auditLogs AuditLog[]` existe déjà.
- Ne pas lancer `npx prisma format` (il réaligne tout le fichier et produirait un diff hors périmètre).
- Aucun autre fichier modifié.

### Après l'édition

Régénérer le client pour que le code compile contre le schéma à jour : `docker compose exec -T backend npx prisma generate` (depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte`). Le client généré est dans `generated/prisma`, hors suivi git.

Fichiers touchés (liste fermée) : `prisma/schema.prisma` (modifié). Aucun fichier TypeScript : pas de lint applicable (voir Done when 4).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

## Done when

Toutes les commandes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (Git Bash, conteneurs `backend` et `postgres` démarrés), après `npx prisma generate` :

1. `docker compose exec -T backend npx prisma validate` : annonce le schéma valide, code 0.
2. `docker compose exec -T backend npx prisma migrate status` : annonce « Database schema is up to date! » (aucune migration en attente, aucune migration nouvelle).
3. Preuve d'alignement : `docker compose exec -T backend npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` affiche `-- This is an empty migration.` (la base de dev porte exactement les migrations du dépôt, cf. point 2 ; c'est donc l'écart migrations contre schéma).
4. `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0. Lint : aucun fichier TypeScript touché, `npx eslint` sans objet (ne pas le lancer sur d'autres fichiers).
5. `docker compose exec -T backend npx jest` : toutes les suites vertes, dont `src/common/interceptors/audit.interceptor.spec.ts` et `src/demo/demo.seeder.spec.ts`.
6. `git -C back_medconnect status --porcelain` liste uniquement ` M prisma/schema.prisma` ; `git -C back_medconnect diff --stat` montre 1 fichier, 5 insertions, 1 suppression ; `git -C back_medconnect diff -- prisma/migrations` est vide.
7. (Git Bash) `git -C back_medconnect diff -U0 | grep "^+" | LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]"` : aucune ligne.

## Return

Fichier modifié, puis pour chaque point du « Done when » : commande lancée, résultat en une ligne (citer la sortie exacte du point 3). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
