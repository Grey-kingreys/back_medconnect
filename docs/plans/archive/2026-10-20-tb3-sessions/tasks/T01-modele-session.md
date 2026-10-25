# T01 - Modèle Prisma Session et migration

Tier: spécifié (agent implementeur-specifie)
Audience: n/a
Visuel: n/a
Background-safe: non, car docker compose exec sur l'arbre principal

Arbre de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/back_medconnect`, branche `orch/tb3-sessions` (déjà créée, ne pas en changer). Ne commite pas : l'orchestrateur commite. Toutes les commandes `docker compose` se lancent depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` (racine du monorepo) ; dans le conteneur `backend`, le dépôt back est monté sur `/app`.

## Spec

Lot TB3 (sessions par appareil). Décisions du run : `docs/plans/runs/2026-10-20-tb3-sessions/decisions.md` (D02, D12, D13, D18). Cette tâche ne touche QUE le schéma Prisma et ajoute une migration. Aucun code TypeScript.

### 1. `prisma/schema.prisma`

a) Dans `model User`, juste après la ligne `refreshTokenExpires DateTime?`, ajouter (ligne vide avant) :

```prisma
  // Sessions par appareil (TB3). Les champs refreshToken et refreshTokenExpires
  // ci-dessus ne servent plus qu'au retour arrière SESSIONS_MULTI_APPAREILS=false,
  // conservés une version.
  sessions Session[]
```

Ne modifier aucune autre ligne de `User`.

b) À la fin du fichier, ajouter exactement :

```prisma
// ====== SESSIONS PAR APPAREIL (TB3) ======

enum SessionClientType {
  WEB
  MOBILE
}

// Une session = une connexion sur un appareil = une famille de refresh tokens.
// Le refresh présenté par le client vaut `<id>.<secret>` ; seul le sha256 du secret est stocké.
model Session {
  id                  String            @id @default(uuid())
  userId              String
  user                User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientType          SessionClientType
  platform            String? // android ou ios (mobile seulement)
  deviceId            String? // identifiant d'appareil envoyé par le mobile
  deviceName          String?
  appVersion          String?
  refreshHash         String // sha256 hex du secret courant
  previousRefreshHash String? // sha256 hex du secret précédent
  graceUntil          DateTime? // fin de la fenêtre de grâce du secret précédent
  graceSecretEnc      String? // secret courant chiffré (EncryptionService), renvoyé pendant la grâce
  createdAt           DateTime          @default(now())
  lastUsedAt          DateTime          @default(now())
  expiresAt           DateTime
  revokedAt           DateTime?
  revokedReason       String? // DECONNEXION, REUTILISATION, NOUVELLE_CONNEXION

  @@index([userId])
  @@index([userId, deviceId])
}
```

### 2. Vérifier puis générer la migration (dans le conteneur, sans jamais réinitialiser la base)

1. `docker compose exec -T backend npx prisma validate` : doit réussir.
2. `docker compose exec -T backend npx prisma migrate status` : doit afficher « Database schema is up to date ». Sinon, STOP et retourner BLOCKED (ne rien appliquer).
3. `docker compose exec -T backend npx prisma migrate dev --create-only --name tb3_sessions`
   - Si la commande propose ou exige une réinitialisation (« reset », « drift », perte de données) : NE PAS accepter, ne rien lancer d'autre, retourner BLOCKED avec la sortie résumée.
   - Si elle refuse uniquement parce que l'environnement est non interactif : créer à la main le dossier `prisma/migrations/20261020120000_tb3_sessions/` puis produire le SQL avec
     `docker compose exec -T backend npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
     et écrire cette sortie (sans les éventuelles lignes de bannière « Loaded Prisma config » ou de mise à jour de Prisma) dans `prisma/migrations/20261020120000_tb3_sessions/migration.sql` avec l'outil Write.
4. Relire `migration.sql` : il doit contenir uniquement `CREATE TYPE "SessionClientType"`, `CREATE TABLE "Session"`, les deux `CREATE INDEX` et l'`ALTER TABLE "Session" ADD CONSTRAINT ... FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE`. Aucun `DROP`, aucun `ALTER TABLE "User"`. Sinon, BLOCKED.
5. Appliquer : `docker compose exec -T backend npx prisma migrate deploy`.
6. Générer le client : `docker compose exec -T backend npx prisma generate`.

Interdits absolus : `prisma migrate reset`, `prisma db push`, `--force-reset`, `--accept-data-loss`, suppression ou modification d'une migration existante, `docker compose down -v`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Commentaires en français, aucun tiret cadratin ni demi-cadratin. Ne jamais lire ni afficher de fichier `.env*`.

## Done when

Depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` :
- `docker compose exec -T backend npx prisma validate` : succès.
- `docker compose exec -T backend npx prisma migrate status` : « Database schema is up to date ».
- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `grep -c "CREATE TABLE \"Session\"" back_medconnect/prisma/migrations/*_tb3_sessions/migration.sql` vaut 1 et `grep -ciE "drop|alter table \"user\"" ` sur ce fichier vaut 0.
- `git -C back_medconnect status --porcelain` ne liste que `prisma/schema.prisma` et le nouveau dossier `prisma/migrations/<horodatage>_tb3_sessions/`.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

2026-10-20 | codeur | échec | migration générée contenant la dérive AuditLog, bloquée avant deploy

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
