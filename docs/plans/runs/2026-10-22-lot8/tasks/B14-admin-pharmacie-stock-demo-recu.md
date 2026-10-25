# B14 - Admin de pharmacie : stock visible, compte démo de Kaloum, reçu documenté

Tier: spécifié (agent implementeur-specifie)
Audience: mixte (API dev ; la description du compte démo est lue sur la page de connexion, non-dev, fournie mot pour mot ci-dessous)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec ; curl)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot8-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : le chef d'équipe commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Spécification de référence : `D:\souleymane\perso-archive-20260923\perso\medconnecte\SPEC-VENTES-PHARMACIE.md` (lignes 39 à 61 : permissions et reçu). Décisions : `docs/plans/runs/2026-10-22-lot8/decisions.md`, D301 à D310 ; contexte du lot 7 : `docs/plans/runs/2026-10-22-lot7/decisions.md` (D111, D112). Cette fiche tranche tout : en cas d'écart apparent avec le code, suivre la fiche et le signaler dans le Return.

## Audit (état avant la tâche, établi par le chef d'équipe, à ne pas refaire)

- Le rôle de l'admin d'une pharmacie est le rôle de structure « Administrateur de structure » (`AppRole`, `structureId` = la pharmacie, `isSystem: false`), créé par `RolesService.seedStructureDefaultRoles` depuis `DEFAULT_STRUCTURE_ROLES.PHARMACIE[1]` (`src/common/rbac/permissions.constants.ts`, vers la ligne 289). Sa liste actuelle : `vente:read`, `vente:write`, `vente:annuler`, `structure:read`, `structure:write`, `membre:read`, `membre:manage`, `role:manage`. Ni `stock:read` ni `stock:write`.
- Toutes les routes de stock (`src/pharmacie/pharmacie.controller.ts` l. 248 à 383) exigent `@RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)` (les DEUX). `PharmacieService.checkPharmacieAccess` accepte déjà le rôle enum `STRUCTURE_ADMIN` rattaché à la pharmacie : seule la permission manque.
- `RolesService.ensureRole` n'applique les permissions d'un rôle de structure qu'à sa création (resync réservé au Super Admin) : modifier la constante ne change rien aux structures existantes, d'où l'étape de démarrage de la section 2.
- Le filtre par type (`src/common/rbac/permissions-type-structure.ts`) garde déjà `stock:*` et `vente:*` pour une PHARMACIE et retire `vente:*` aux autres types. Ne pas le modifier.
- `GET /auth/demo/comptes` (`DemoService.listerComptes`, `src/demo/demo.service.ts`) ne renvoie que les emails de `COMPTES_VITRINE` (`src/demo/demo.donnees.ts` l. 28 à 35), un par rôle ; le compte `adminKaloum` (`admin.kaloum@demo.medconnecte.gn`, Djénabou Baldé, rôle `STRUCTURE_ADMIN`, l. 251 à 262) n'y est pas. Le test `src/demo/demo.vitrine.spec.ts` impose « exactement un compte par rôle ».
- Reçu : `VenteService.pharmacieRecu` (`src/pharmacie/vente.service.ts` l. 110 à 128) renvoie `{ id, nom, adresse, ville, telephone, logoUrl }`, `logoUrl` = `this.storage.getPublicUrl(logoFile.key)` (bucket public, URL pérenne) sinon `null`, champs absents à `null`. Utilisé à la création, au rejeu, au détail (l. 558 à 566) et à l'annulation (l. 579 à 665). Rien à corriger dans le service (D309). Aucun `@ApiResponse` 2xx dans `vente.controller.ts`.
- Lint préexistant : `src/common/rbac/roles.service.ts` a 28 erreurs (26 prettier, 2 `@typescript-eslint/no-unsafe-member-access` sur `e.code` dans les `catch (e: any)` de `createRole` et `updateRole`). Les autres fichiers listés au Done when sont propres aujourd'hui.

## Spec

### 1. Permissions de l'admin d'une pharmacie (nouvelles structures)

Dans `src/common/rbac/permissions.constants.ts` :
1. Ajouter, juste après `DEFAULT_STRUCTURE_ROLES` et avant la ligne `DEFAULT_STRUCTURE_ROLES.CLINIQUE = ...`, une constante exportée :
   ```ts
   /**
    * Permissions toujours garanties au rôle « Administrateur de structure » d'une pharmacie,
    * y compris pour les pharmacies existantes (complétées au démarrage par RolesService).
    */
   export const PERMISSIONS_GARANTIES_ADMIN_PHARMACIE: readonly PermissionCode[] = [
     PERMISSIONS.STOCK_READ,
     PERMISSIONS.STOCK_WRITE,
     PERMISSIONS.VENTE_READ,
     PERMISSIONS.VENTE_WRITE,
     PERMISSIONS.VENTE_ANNULER,
   ];
   ```
   (Si l'ordre de déclaration pose problème au typage, la placer avant `DEFAULT_STRUCTURE_ROLES` ; même contenu.)
2. Dans `DEFAULT_STRUCTURE_ROLES.PHARMACIE`, rôle « Administrateur de structure » : ajouter `PERMISSIONS.STOCK_READ` et `PERMISSIONS.STOCK_WRITE` en tête de `permissions` (avant `VENTE_READ`). Description inchangée. Ne rien changer aux rôles HOPITAL (donc CLINIQUE) ni au rôle « Pharmacien ».

### 2. Pharmacies existantes : étape au démarrage

Dans `src/common/rbac/roles.service.ts` :
1. Importer `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE`.
2. Ajouter une méthode publique (publique pour le test) :
   ```ts
   /**
    * Complète le rôle « Administrateur de structure » de chaque pharmacie avec
    * PERMISSIONS_GARANTIES_ADMIN_PHARMACIE (ajout seul, jamais de retrait). Idempotent.
    * Retourne le nombre de permissions ajoutées.
    */
   async completerRolesAdminPharmacie(codeToId: Map<string, string>): Promise<number>
   ```
   Comportement exact :
   - `nomRole` = le `nom` de la définition de `DEFAULT_STRUCTURE_ROLES.PHARMACIE` dont `legacyRole === 'STRUCTURE_ADMIN'` (soit « Administrateur de structure » ; ne pas écrire le libellé en dur une seconde fois).
   - `permissionIds` = `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` passés par `codeToId`, en ignorant les codes absents. Si vide : retourner 0 sans requête.
   - `roles = await this.prisma.appRole.findMany({ where: { nom: nomRole, structure: { type: 'PHARMACIE' } }, select: { id: true } })`.
   - Pour chaque rôle, dans l'ordre : `const { count } = await this.prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ appRoleId: role.id, permissionId })), skipDuplicates: true })` ; si `count > 0`, `await this.permissionsService.invalidateRole(role.id)` et ajouter `count` au total, compter le rôle comme complété.
   - Si total > 0 : `this.logger.log(\`Rôles d'administrateur de pharmacie complétés : ${total} permission(s) ajoutée(s) sur ${nbRoles} rôle(s).\`)`. Sinon aucun journal.
   - Retourner le total.
3. Dans `onApplicationBootstrap`, appeler `await this.completerRolesAdminPharmacie(codeToId);` juste après `await this.seedExistingStructures(codeToId);` et avant `backfillUsers`, dans le même `try` (une erreur reste journalisée par le `catch` existant, l'API démarre quand même).
4. Mettre à jour le commentaire de classe (liste numérotée du démarrage) : ajouter l'étape « complète le rôle d'administrateur de chaque pharmacie (stock et ventes) ».
5. Lint (D310) : lancer `docker compose exec -T backend npx eslint --fix src/common/rbac/roles.service.ts` (formatage seul), puis remplacer dans `createRole` et `updateRole` `catch (e: any)` par `catch (e: unknown)` et `e?.code === 'P2002'` par `(e as { code?: string } | null)?.code === 'P2002'`. Aucun autre changement de comportement dans ce fichier.

Ne pas toucher `permissions-type-structure.ts`, `permissions.service.ts` (préfixe de cache `perms:v3` conservé, D306), ni aucune migration SQL.

### 3. Compte démo de l'administratrice de Kaloum

Dans `src/demo/demo.donnees.ts` :
1. `COMPTES_VITRINE` : ajouter `email('admin.kaloum'), // administratrice de la pharmacie de Kaloum : stock, ventes et annulation` juste après la ligne `email('admin.donka')`.
2. Mettre à jour le commentaire au-dessus de `COMPTES_VITRINE` : un compte par rôle, sauf l'administrateur de structure, proposé deux fois (un hôpital, une pharmacie, pour tester l'annulation d'une vente).
3. Compte `adminKaloum` : `description` devient exactement (guillemets doubles, apostrophe droite, comme les descriptions voisines du fichier)
   `"Administratrice de la Pharmacie de Kaloum (de garde) : stock, ventes du jour, annulation d'une vente, équipe et horaires."`

Rien à changer dans `demo.service.ts` (le tri par rôle puis par nom place Baldé avant Kouyaté).

### 4. Reçu : documentation Swagger

Dans `src/pharmacie/vente.controller.ts` (aucun changement de logique) :
- Sur `POST :structureId/ventes`, ajouter `@ApiResponse({ status: 201, description: 'Vente enregistrée (ou rejouée avec rejeu: true). data : id, numero, statut, createdAt, total, ordonnanceVerifiee, clientNom, clientTelephone, vendeur { id, nom }, annuleeLe, annuleeParId, motifAnnulation, lignes [ { id, stockId, medicamentId, nomMedicament, prixUnitaire, quantite, sousTotal } ], pharmacie { id, nom, adresse, ville, telephone, logoUrl } (champs absents à null, logoUrl = URL publique du logo ou null).' })` avant les `@ApiResponse` d'erreur existants.
- Sur `GET :structureId/ventes/:venteId`, ajouter `@ApiResponse({ status: 200, description: 'Même forme que la création, avec pharmacie { id, nom, adresse, ville, telephone, logoUrl } pour le reçu.' })`.

### 5. Tests Jest

1. Nouveau fichier `src/common/rbac/roles.service.spec.ts` (Prisma et PermissionsService en faux objets `jest.fn()`, `new RolesService(prisma as any, permissions as any)` ou équivalent typé ; aucun accès réseau ni base) :
   - « 1. définitions : l'admin d'une pharmacie a stock:read, stock:write et les trois vente:* » : `DEFAULT_STRUCTURE_ROLES.PHARMACIE` (rôle `legacyRole === 'STRUCTURE_ADMIN'`) contient chacun des 5 codes de `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE`.
   - « 2. définitions : aucun rôle d'hôpital ni de clinique n'a stock:* ni vente:* » : pour `HOPITAL` et `CLINIQUE`, aucun rôle ne contient `stock:read`, `stock:write`, `vente:read`, `vente:write`, `vente:annuler`.
   - « 3. complète les rôles d'admin des pharmacies et invalide le cache » : `appRole.findMany` renvoie `[{ id: 'r1' }, { id: 'r2' }]`, `rolePermission.createMany` renvoie `{ count: 2 }` puis `{ count: 0 }` ; `codeToId` contient les 5 codes. Attendus : `findMany` appelé avec `{ where: { nom: 'Administrateur de structure', structure: { type: 'PHARMACIE' } }, select: { id: true } }` ; `createMany` appelé 2 fois avec `skipDuplicates: true` et 5 lignes `{ appRoleId, permissionId }` ; `invalidateRole` appelé une seule fois, avec `'r1'` ; retour `2`.
   - « 4. idempotent : rien d'ajouté, aucun journal ni invalidation » : `createMany` renvoie toujours `{ count: 0 }` ; retour 0, `invalidateRole` jamais appelé.
   - « 5. catalogue sans ces permissions : aucune requête » : `codeToId` vide ; retour 0, `appRole.findMany` jamais appelé.
   - « 6. le démarrage appelle l'étape après le seed des structures » : faux Prisma complet minimal (`permission.upsert` renvoie `{ id: 'p-' + code, code }` à partir de `args.create.code`, `appRole.findFirst` renvoie `{ id: 'x' }`, `structure.findMany` renvoie `[]`, `user.findMany` renvoie `[]`, `appRole.findMany` renvoie `[{ id: 'r1' }]`, `rolePermission.createMany` renvoie `{ count: 5 }`) ; après `await service.onApplicationBootstrap()`, `rolePermission.createMany` a été appelé avec `appRoleId: 'r1'` et `invalidateRole` avec `'r1'`.
2. `src/demo/demo.vitrine.spec.ts` : remplacer le second test par « propose un compte par rôle, et deux administrateurs de structure (un hôpital, une pharmacie) » : chaque rôle présent dans `COMPTES_DEMO` apparaît dans la vitrine ; chaque rôle sauf `STRUCTURE_ADMIN` y apparaît exactement une fois ; `STRUCTURE_ADMIN` y apparaît exactement 2 fois, et les structures (`structure` du compte, clé `CleStructure`) de ces deux comptes sont l'une de type `HOPITAL` et l'autre de type `PHARMACIE` (lire le type dans `STRUCTURES_DEMO` par `cle`). Ajouter « l'administratrice de Kaloum est proposée, sa description parle du stock et de l'annulation » : `COMPTES_VITRINE` contient `admin.kaloum@demo.medconnecte.gn` et sa description contient « stock » et « annulation ».
3. `src/demo/demo.controller.spec.ts`, test « liste un compte vitrine par rôle... » : ajouter dans le faux `findMany` un compte `{ id: '7', email: 'admin.kaloum@demo.medconnecte.gn', nom: 'Baldé', prenom: 'Djénabou', role: 'STRUCTURE_ADMIN', structure: { nom: 'Pharmacie de Kaloum' } }` et un compte `{ id: '8', email: 'admin.donka@demo.medconnecte.gn', nom: 'Kouyaté', prenom: 'Lansana', role: 'STRUCTURE_ADMIN', structure: { nom: 'Hôpital National Donka' } }` ; adapter l'ordre attendu selon `ORDRE_ROLES` (rôle puis nom : '7' avant '8') ; vérifier que '7' a `structureNom: 'Pharmacie de Kaloum'` et une description qui contient « annulation ». Renommer le titre du test en « liste les comptes vitrine, triés par rôle puis par nom, avec libellé et description ».
4. `src/pharmacie/vente.service.spec.ts` (réutiliser le faux en mémoire existant, structures `S1` avec logo et `s2` sans logo) : ajouter
   - « reçu : détail et annulation renvoient la pharmacie complète » : après une vente sur `S1`, `detailVente` puis `annulerVente` (par un utilisateur autorisé du faux) renvoient `data.pharmacie` égal exactement (`toEqual`) à `{ id: S1, nom, adresse, ville, telephone, logoUrl: 'https://cdn.test/logos/s1.png' }` avec les valeurs du faux.
   - « reçu sans logo : logoUrl null, champs absents null » : une vente sur `s2` (ajouter au faux le stock et l'utilisateur nécessaires, ou compléter `s2` avec les champs voulus) renvoie `pharmacie.logoUrl === null` et `null` pour chaque champ absent de la structure du faux.
   Si le faux ne permet pas une vente sur `s2` sans refonte, faire le second cas sur `S1` en remplaçant sa structure dans `beforeEach` du test (`logoFile: null`, `adresse` absente) ; ne pas refondre le faux.

### 6. Documentation : `back_medconnect/CLAUDE.md`

1. Remplacer la puce « Ventes en pharmacie (B13, lot 7) » par une puce « Ventes en pharmacie (B13, lot 7 ; B14, lot 8) » qui donne le contrat EXACT, vérifié ligne par ligne contre le code (`vente.controller.ts`, `vente.service.ts`, `dto/vente.dto.ts`, `codes-erreur.ts`, `all-exceptions.filter.ts`). Garder la structure en sous-puces actuelle et la compléter ; chaque élément doit correspondre au code, sinon corriger la doc (jamais le code) :
   - Routes, méthode, permission, statut de succès (déjà là).
   - Corps de création, champ par champ, avec la contrainte class-validator (nom de contrainte tel que renvoyé dans `champs[].contraintes` : `arrayMinSize`, `arrayMaxSize` (50 lignes au plus), `isInt`, `min`, `max`, `maxLength`, `isBoolean`, `isString`, `isNotEmpty`, `stockUnique`, `totalMaximal`, et pour l'annulation `length`, pour la liste `matches` et `min` sur `page`). Lire les noms réels dans le DTO et dans le service.
   - Forme de réponse complète (déjà là), en précisant que `rejeu: true` n'est présent QUE sur un rejeu (absent sinon), et les valeurs exactes de `statut` (`VALIDEE`, `ANNULEE`).
   - Messages de succès exacts : création `Vente enregistrée (V-AAAA-NNNNNN).`, rejeu `Cette vente était déjà enregistrée.`, détail `Vente trouvée.`, liste `N vente(s) le AAAA-MM-JJ.`, annulation (lire le texte exact dans `annulerVente`, avec la variante « ligne de stock supprimée »).
   - Tableau des erreurs : pour chaque cas, statut HTTP, `code` (ou « sans code » pour les 404 « Cette pharmacie est introuvable. » et « Cette vente est introuvable. »), forme de `details`. Inclure 403 `PERMISSION_REFUSEE` (permission manquante, pharmacie d'un autre utilisateur avec « Vous n'avez pas accès aux ventes de cette pharmacie. », structure qui n'est pas une pharmacie), 404 `STOCK_INTROUVABLE` (`details: [{ stockId }]`), et les plafonds : 1 à 50 lignes, `details` tronqué à 50 éléments, `parPage` 50.
   - Reçu : `pharmacie { id, nom, adresse, ville, telephone, logoUrl }` présent à la création, au rejeu, au détail et à l'annulation ; `logoUrl` = URL publique pérenne du logo de la structure (bucket public, `R2_PUBLIC_URL`), `null` sans logo ; champs absents à `null`.
   - Permissions (remplacer la dernière phrase actuelle sur les rôles) : rôle « Pharmacien » des pharmacies : `stock:read`, `stock:write`, `vente:read`, `vente:write` ; rôle « Administrateur de structure » des pharmacies : `stock:read`, `stock:write`, `vente:read`, `vente:write`, `vente:annuler` (plus `structure:*`, `membre:*`, `role:manage`). Rôles existants : `vente:*` repris par la migration du lot 7 ; depuis B14, `RolesService.completerRolesAdminPharmacie` ajoute au démarrage les 5 permissions de `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` au rôle « Administrateur de structure » de chaque pharmacie (ajout seul, invalidation du cache du rôle ; une de ces permissions retirée à la main revient au démarrage suivant). Hôpitaux et cliniques : ni `stock:*` ni `vente:*`.
2. Section « Mode démo » : ajouter une phrase : `GET /auth/demo/comptes` propose un compte par rôle, et deux administrateurs de structure (Hôpital National Donka, Pharmacie de Kaloum : stock, ventes et annulation).
3. Aucun tiret cadratin ni demi-cadratin.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash (exception : la commande `eslint --fix` de la section 2.5, sur ce seul fichier).

- Pas de migration Prisma, pas de changement de schéma.
- Ne pas modifier `.env`, `compose*.yml`, ni le filtre de permissions par type.
- Commentaires, journaux et textes en français ; jamais de tiret cadratin ni demi-cadratin (y compris dans CLAUDE.md et les titres de tests).
- Aucun jeton, cookie ni identifiant de session dans le Return.

## Appel réel (obligatoire, une seule séquence)

Contre le back local `http://localhost:3101` (port publié de `backend`, `docker compose port backend 3001` pour confirmer), depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte`, avec `curl`.
0. Le conteneur recharge le code (`nest start --watch`). Vérifier que le démarrage a rejoué la synchronisation : `docker compose logs backend --since 15m | grep -i "administrateur de pharmacie"` doit montrer la ligne « Rôles d'administrateur de pharmacie complétés : ... » au premier redémarrage après le changement (si la ligne n'apparaît pas et que les étapes suivantes échouent, `docker compose restart backend` puis attendre `Nest application successfully started` dans les journaux).
1. `GET /auth/demo/comptes` : 200 ; une entrée `email: admin.kaloum@demo.medconnecte.gn`, `structureNom: Pharmacie de Kaloum`, avec la description de la section 3 ; noter son `id`. Mode démo inactif (404) : Return BLOCKED, ne pas modifier `.env`.
2. `POST /auth/demo/connexion` `{ "userId": <id> }` : 200, jeton d'accès (lire le nom du champ dans la réponse).
3. `GET /auth/me` : `data.structureType === 'PHARMACIE'`, `data.permissions` contient `stock:read`, `stock:write`, `vente:read`, `vente:write`, `vente:annuler` ; noter l'identifiant de la pharmacie (champ de structure renvoyé par `/auth/me`).
4. `GET /pharmacie/stock/<structureId>` : 200, nombre de lignes de stock > 0. Choisir un médicament avec prix > 0, non périmé, sans ordonnance obligatoire, quantité 1 ou plus ; noter sa quantité initiale.
5. `POST /pharmacie/<structureId>/ventes` avec `Idempotency-Key: <uuid neuf>`, 1 ligne de quantité 1 : 201, `numero`, `total`, et `data.pharmacie` avec les 6 clés (`id`, `nom`, `adresse`, `ville`, `telephone`, `logoUrl`), noter leurs valeurs (`logoUrl` : null ou non).
6. `GET /pharmacie/<structureId>/ventes/<venteId>` : 200, `data.pharmacie` identique à l'étape 5.
7. `POST /pharmacie/<structureId>/ventes/<venteId>/annuler` `{ "motif": "Test de recette B14" }` : 200, `statut: ANNULEE` ; `GET /pharmacie/stock/<structureId>` : la quantité du médicament est revenue à sa valeur initiale.
8. Contre-épreuve hôpital : connexion démo de `admin.donka@demo.medconnecte.gn` (id lu à l'étape 1) ; `GET /auth/me` : `data.permissions` ne contient aucun `stock:*` ni `vente:*` ; `GET /pharmacie/stock/<structureId de Kaloum>` : 403 `PERMISSION_REFUSEE`.

## Done when

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :
1. `docker compose exec -T backend npx tsc --noEmit` : sortie 0.
2. `docker compose exec -T backend npx eslint src/common/rbac/permissions.constants.ts src/common/rbac/roles.service.ts src/common/rbac/roles.service.spec.ts src/demo/demo.donnees.ts src/demo/demo.vitrine.spec.ts src/demo/demo.controller.spec.ts src/pharmacie/vente.controller.ts src/pharmacie/vente.service.spec.ts` : 0 erreur, 0 avertissement (si un autre fichier a dû être touché, l'ajouter à la commande et le signaler).
3. `docker compose exec -T backend npx jest` : 0 échec ; les 6 cas de `roles.service.spec.ts`, les cas de `demo.vitrine.spec.ts` et les 2 nouveaux cas de reçu de `vente.service.spec.ts` présents et verts.
4. `git -C back_medconnect diff -U0 | grep -nP '^\+.*[\x{2013}\x{2014}]'` et `grep -nP '[\x{2013}\x{2014}]' back_medconnect/src/common/rbac/roles.service.spec.ts` : aucune ligne.
5. `git -C back_medconnect diff --stat` : seuls les fichiers du point 2 et `CLAUDE.md` sont modifiés ou créés (aucune migration, aucun fichier sous `prisma/`).
6. `grep -n "B14" back_medconnect/CLAUDE.md` montre la puce des ventes mise à jour, qui contient `STOCK_INTROUVABLE`, `arrayMaxSize`, `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` et `logoUrl` ; et `grep -n "Pharmacie de Kaloum" back_medconnect/CLAUDE.md` montre la phrase du mode démo.
7. Appel réel fait, les 9 étapes (0 à 8) consignées dans le Return, une ligne chacune (requête, statut, champs clés), sans jeton.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

Liste exacte des fichiers créés ou modifiés (pour le staging ciblé), sortie en une ligne de chaque commande du Done when, les 9 lignes de l'appel réel, et tout écart à la fiche avec sa raison.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
