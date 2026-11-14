# Inventaire consolidé et vérifié (Étape 0), tranche pharmacie 1

Chef d'orchestration (Opus). Lecture seule : aucune modification de code, aucun commit, aucune migration, aucune requête en base.
Sources : rapports `inventaire-A.md` et `inventaire-B.md`, puis vérification directe dans le code de chaque point décisif et de chaque désaccord.
Têtes lues : back `orch/pharmacie-t1-back` cbea6f8, front `orch/pharmacie-t1-front` 29aa696, mobile `orch/tm1-mobile` 6f033a8.
Chemins relatifs à `back_medconnect/`, `front_medconnect/`, `mobile_medconnect/` (préfixés back, front, mobile quand c'est ambigu). Aucune valeur de .env lue ni reproduite.

## 0. Les deux réponses décisives

1. **Le stock est un compteur mutable, sans aucun journal.** `StockMedicament.quantite Int @default(0)` (back `prisma/schema.prisma:441`), une seule ligne par couple médicament x pharmacie (`@@unique([medicamentId, structureId])`, `schema.prisma:449`), modifiée en place par décrément (vente), incrément (annulation, import livraison), écrasement (upsert, import inventaire) et ajustement à plancher 0. Aucune table de lots, de mouvements, d'inventaire ni d'anomalies. La migration demandée est un changement de paradigme complet, avec un point de départ unique : le solde courant.
2. **Aucune couche hors ligne réutilisable n'existe pour une caisse.** L'application Flutter est réservée aux patients par décision du porteur (mobile `CLAUDE.md:3-5`, `lib/core/session/app_user.dart:68-72`, `lib/app/router/routes.dart:65-67`), et sa couche locale est un cache clé/valeur chiffré sans file d'événements ni synchronisation (`lib/core/storage/local_database.dart:9-56`). Le web, où travaille aujourd'hui le pharmacien, n'a qu'un service worker pass-through sans cache (front `public/sw.js:1-36`). Tout le hors ligne de la demande est à construire.

## 1. Modèle de données pharmacie

### 1.1 Modèles Prisma (back `prisma/schema.prisma`)

| Modèle | Lignes | Champs | Contraintes, index, suppression |
|---|---|---|---|
| `Medicament` | 419-432 | `id`, `nom`, `nomGenerique?`, `categorie` (texte libre), `description?`, `ordonnanceRequise Boolean @default(false)`, `formes String[]` (texte libre, plusieurs formes par médicament), `createdAt`, `updatedAt` | Aucune unicité, aucun index. Catalogue GLOBAL partagé par toutes les pharmacies, sans prix, unité, coefficient ni conditionnement. |
| `StockMedicament` | 434-450 | `medicamentId`, `structureId`, `quantite Int @default(0)`, `prixUnitaire Int?` (GNF), `disponible Boolean @default(true)`, `dateExpiration DateTime?`, `notes?`, `updatedAt` (pas de `createdAt`) | `@@unique([medicamentId, structureId])` (449), aucun autre index. `onDelete: Cascade` vers `Medicament` (437) et `Structure` (439). |
| `StatutVente` | 452-455 | `VALIDEE`, `ANNULEE` | |
| `Vente` | 460-482 | `structureId`, `numero` (`V-AAAA-NNNNNN`), `vendeurId` (sans FK), `vendeurNom` (copie), `clientNom?`, `clientTelephone?`, `ordonnanceVerifiee`, `total Int`, `statut`, `annuleeLe?`, `annuleeParId?` (sans FK), `motifAnnulation?`, `cleIdempotence?`, `createdAt` | `@@unique([structureId, numero])`, `@@unique([structureId, cleIdempotence])`, `@@index([structureId, createdAt])`. `onDelete: Cascade` vers `Structure`. |
| `LigneVente` | 484-496 | `venteId`, `medicamentId` et `stockMedicamentId` (sans FK, D109), `nomMedicament` (copie), `prixUnitaire Int` (copie), `quantite Int`, `sousTotal Int` | `@@index([venteId])`, cascade depuis `Vente`. |
| `CompteurVente` | 499-506 | `structureId`, `annee`, `dernierNumero` | `@@id([structureId, annee])`, cascade vers `Structure`. |
| `Structure` | 159-220 | `type StructureType` (`HOPITAL`, `CLINIQUE`, `PHARMACIE`, 23-27), `latitude/longitude Float?` (167-168), relations `medicaments StockMedicament[]` (195), `ventes` (198), `compteursVente` (199) | Une pharmacie EST une `Structure` ; aucun point de vente distinct. |
| `AuditLog` | 355-371 | `userId?`, `action`, `entityType`, `entityId`, `ip?`, `metadata Json?` | Écrit par la vente (création, annulation), jamais par les écritures de stock. |
| `Notification` | 682-696 | type `STOCK_ALERTE` (677) | Support des alertes de stock bas. |
| `Session` | 705 et suivantes | Session d'AUTHENTIFICATION par appareil (TB3) | N'est pas une session de caisse. |

Absents (liste exhaustive des `model`/`enum` relue) : lot, mouvement de stock, fournisseur, réception, inventaire, anomalie, point de vente, poste de caisse, plage de tickets, session de caisse, comptage par coupure, mouvement de caisse, paiement, mode de paiement, clôture journalière, état de conditionnement ouvert, coût d'acquisition, unité minimale, coefficient, tolérance, journal d'événements de synchronisation, paramètres par pharmacie.

`deletedAt` n'existe que sur `Consultation`, `Ordonnance`, `ResultatAnalyse`, `Vaccination` (`schema.prisma:275, 302, 326, 347`) : rien côté pharmacie.

### 1.2 Migrations concernées (back `prisma/migrations/`)

- `20260425202451_init`, `20260426144501_init_migration`, `20260628161425_sync_schema_complet` : création de `Medicament` et `StockMedicament` (prix en Float à l'origine).
- `20260628170000_add_rbac_permissions` : tables `Permission`, `AppRole`, `RolePermission`.
- `20261022120000_ventes_pharmacie` : crée `StatutVente`, `Vente`, `LigneVente`, `CompteurVente`, convertit `StockMedicament.prixUnitaire` en entier par `ROUND`, insère les permissions `vente:*` et les rattache par SQL aux rôles existants des pharmacies. C'est la dernière migration du dépôt et le seul précédent de reprise de données en SQL manuel.

### 1.3 Tenue du stock aujourd'hui (point décisif, vérifié)

| Chemin d'écriture | Preuve | Effet |
|---|---|---|
| Vente | `src/pharmacie/vente.service.ts:396-402` | `updateMany` conditionnel `quantite >= demandée`, `decrement` ; puis `disponible=false` à 0 (429) |
| Annulation | `vente.service.ts:625-627` | `increment` + `disponible: true` |
| Upsert manuel | `src/pharmacie/pharmacie.service.ts:361-428` | ÉCRASE quantité, prix, date, notes |
| Ajustement | `pharmacie.service.ts:444-458` | `SELECT ... FOR UPDATE`, puis `Math.max(0, ancienne + variation)` (449) : plancher à 0, information perdue |
| Import Excel | `pharmacie.service.ts:646-678` | mode `inventaire` écrase, mode `livraison` incrémente ; la date fournie écrase la date existante (667, 675) |
| Suppression | `pharmacie.service.ts:542` | `stockMedicament.delete` physique, sans audit |

Aucune de ces écritures hors vente n'est tracée (aucun `auditLog` dans `pharmacie.service.ts`). Le stock négatif est impossible aujourd'hui (décrément conditionnel + plancher 0). `disponible` est un booléen dérivé maintenu à la main dans chaque chemin (D118 : il n'est pas lu à la vente, mais il l'est par la recherche publique, `pharmacie.service.ts:991`).

### 1.4 Péremption, prix, coût, unité

- **Une seule date d'expiration par ligne de stock** (`schema.prisma:444`). Deux livraisons de péremptions différentes se confondent : la dernière date saisie gagne.
- **Prix `Int` en GNF, nullable, porté par la pharmacie** (`StockMedicament.prixUnitaire Int?`, 442), un seul prix. `Medicament` n'a aucun prix. Lignes de vente : `prixUnitaire`, `quantite`, `sousTotal`, `Vente.total` en `Int` ; `sousTotal = prixUnitaire x quantite`, le prix unitaire est donc la référence (inverse de la demande, où le montant de ligne est la référence). Plafond `PRIX_MAX = 2147483647` (`vente.service.ts:25`, contrôle 360).
- **Aucun coût d'achat nulle part.** Le « dernier coût connu » que la demande veut reprendre n'existe pas : tous les lots techniques naîtront à coût nul, donc non valorisables.
- **Unité non définie** : la quantité est « des unités de la ligne de stock », boîte ou autre selon la saisie. `Medicament.formes` est un tableau de textes libres : un même `Medicament` peut couvrir plusieurs présentations (comprimé et sirop), il ne peut donc pas porter seul un coefficient de conditionnement.
- Défaut DTO : `UpsertStockDto.quantite` est `@IsNumber() @Min(0)` et non `@IsInt` (`dto/pharmacie.dto.ts:97-100`) : un décimal passe la validation et échoue en base.

## 2. Endpoints

Gardes : `AuthGuard` + `PermissionsGuard` ; `@RequirePermissions(a, b)` exige TOUTES les permissions (`src/common/rbac/permissions.service.ts:94`, `required.every`).

### 2.1 `PharmacieController` (`src/pharmacie/pharmacie.controller.ts`)

| Méthode, chemin | Ligne | Permission | Règle |
|---|---|---|---|
| GET `/pharmacie/rechercher` | 84 | publique | Disponibilité : `disponible: true`, `quantite > 0`, pharmacie active et configurée (`pharmacie.service.ts:982-1000`), Haversine. Ne filtre pas la péremption. Expose prix, quantité, date. |
| GET `/pharmacie/catalogue` | 111 | publique | Catalogue global |
| GET `/pharmacie/catalogue/categories` | 122 | publique | |
| GET `/pharmacie/catalogue/:medicamentId` | 128 | publique | Détail + pharmacies où disponible |
| POST `/pharmacie/catalogue` | 142 | `catalogue:write` | Crée un médicament GLOBAL |
| GET `/pharmacie/catalogue/import/modele` | 154 | `catalogue:write` | |
| POST `/pharmacie/catalogue/import/apercu` | 173 | `catalogue:write` | |
| POST `/pharmacie/catalogue/import` | 190 | `catalogue:write` | |
| PATCH `/pharmacie/catalogue/:medicamentId` | 213 | `catalogue:manage` | Modifie le médicament global |
| DELETE `/pharmacie/catalogue/:medicamentId` | 231 | `catalogue:manage` | Suppression physique (`pharmacie.service.ts:305`), cascade sur les stocks de TOUTES les pharmacies |
| GET `/pharmacie/stock/:structureId` | 249 | `stock:read` ET `stock:write` | Stock + alertes (section 3) |
| POST `/pharmacie/stock/:structureId` | 266 | idem | Upsert, écrase |
| PATCH `/pharmacie/stock/:structureId/:stockId/quantite` | 284 | idem | Variation entière signée, plancher 0 |
| DELETE `/pharmacie/stock/:structureId/:stockId` | 309 | idem | Suppression physique |
| GET `/pharmacie/stock/:structureId/import/modele` | 330 | idem | Une seule colonne « Date d'expiration » |
| POST `/pharmacie/stock/:structureId/import/apercu` | 355 | idem | |
| POST `/pharmacie/stock/:structureId/import` | 383 | idem | `mode` `inventaire` (défaut) ou `livraison`, transaction, alerte groupée |

Contrôle d'accès en plus du garde, `checkPharmacieAccess` (`pharmacie.service.ts:1077-1098`) : exige `user.role` enum `STRUCTURE_ADMIN` ou `PHARMACIEN` ET `user.structureId === structureId`. Les ventes utilisent `VenteService.verifierPharmacie` (`vente.service.ts:75-107`) : membre (`structureId`) OU administrateur (`Structure.adminId`), sans regarder l'enum. **Deux contrôles divergents** : un rôle personnalisé porté par un compte d'enum `ACCUEIL` vend mais ne voit pas le stock.

### 2.2 `VenteController` (`src/pharmacie/vente.controller.ts`, gardes de classe ligne 38)

| Méthode, chemin | Ligne | Permission |
|---|---|---|
| POST `/pharmacie/:structureId/ventes` | 42 | `vente:write` (201) |
| GET `/pharmacie/:structureId/ventes` | 93 | `vente:read` (liste d'un jour, 50 par page) |
| GET `/pharmacie/:structureId/ventes/:venteId` | 110 | `vente:read` |
| POST `/pharmacie/:structureId/ventes/:venteId/annuler` | 132 | `vente:annuler` |

DTO (`dto/vente.dto.ts`) : `CreerVenteDto { lignes: [{ stockId, quantite 1..10000 }] 1..50, clientNom?, clientTelephone?, ordonnanceVerifiee? }`, `AnnulerVenteDto { motif 3..300 }`, `ListerVentesQueryDto { date?, page? }`.

### 2.3 Règles métier codées (`vente.service.ts`)

- Transaction unique, `maxWait 5 s`, `timeout 15 s` (29, 221).
- Numérotation `V-AAAA-NNNNNN` par `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` sur `CompteurVente` en tête de transaction (266) : verrou de ligne qui sérialise toutes les ventes d'une pharmacie. Aucun poste, aucune plage. Un refus annule la transaction et ne consomme pas de numéro.
- Idempotence : en-tête `Idempotency-Key` facultatif, unicité `(structureId, cleIdempotence)`, fenêtre 24 h (`SOS_IDEMPOTENCE_HEURES`, 203), rejeu = même vente avec `data.rejeu: true`. Au-delà de 24 h, la clé de l'ancienne vente est remise à `null` par `vente.update` (207-210) et une nouvelle vente est créée.
- Ordre des refus (D114) : 404 `STOCK_INTROUVABLE`, 400 `MEDICAMENT_EXPIRE` (date avant le jour de Conakry, 292-304, le jour même reste vendable), 400 `PRIX_MANQUANT` (null ou 0, 321), 400 `ORDONNANCE_NON_CONFIRMEE` (case à cocher, 337), 409 `STOCK_INSUFFISANT` (424). Un seul code par réponse.
- Prix toujours lu du stock, aucune remise.
- Pas de réservation : retrait immédiat à la validation.
- Alerte `STOCK_ALERTE` au franchissement du seuil 10 (445), hors transaction, n'échoue jamais la vente.
- Audit `create` (450) et `annuler` (632) dans la transaction.
- Annulation (`annulerVente`, 572-656) : vente `VALIDEE` du jour même UTC (596), passage conditionnel de statut (605), remise en stock par incrément (625), ligne supprimée entre-temps comptée et signalée.
- Aucune session de caisse, aucun mode de paiement, aucun paiement : le seul encaissement est `Vente.total`.

### 2.4 Endpoints et chemins qui modifient ou suppriment une vente, une ligne de vente ou une délivrance

Aucun PATCH, PUT ni DELETE de vente ou de ligne de vente n'existe (décorateurs du contrôleur : Post, Get, Get, Post). En revanche, au regard de l'exigence d'immuabilité :

1. **POST `/pharmacie/:structureId/ventes/:venteId/annuler`** (`vente.controller.ts:132`) : MUTE la vente en place (`statut`, `annuleeLe`, `annuleeParId`, `motifAnnulation`, `vente.service.ts:605-613`) et remet le stock par incrément. C'est le conflit principal : pas d'écriture inverse pointant la pièce d'origine, et limité au jour même. Consommé par le front (`AnnulationVente.tsx`, `api_ventes.ts`).
2. **Mutation interne de `cleIdempotence`** sur une vente validée de plus de 24 h (`vente.service.ts:207-210`), sans endpoint dédié.
3. **POST `/super-admin/structures/:structureId/delete`** (`src/super-admin/super-admin.controller.ts:117`, `super-admin.service.ts:454`) : la cascade `Structure` supprime physiquement ventes, lignes et compteurs (D110).
4. **Purge du mode démo** (`src/demo/demo.seeder.ts:193`, `structure.deleteMany`) : même cascade, seulement avec `DEMO_MODE=true` et `DEMO_RESET=true`.
5. Indirects, sans toucher la vente : `DELETE /pharmacie/stock/:structureId/:stockId` (309) et `DELETE /pharmacie/catalogue/:medicamentId` (231) font disparaître la ligne référencée par `LigneVente.stockMedicamentId` (sans FK) ; l'annulation ne peut plus remettre en stock.
6. « Délivrance » : aucun objet distinct de la vente ; les ordonnances du carnet ne sont pas liées aux ventes. Sans objet dans le code. Session de caisse clôturée : n'existe pas.

### 2.5 Import Excel

`src/pharmacie/import-excel.ts`, `catalogue-import.service.ts`, `pharmacie.service.ts:549-980`. Titres reconnus par synonymes. Stock : Médicament et Quantité obligatoires, prix, une date d'expiration, notes ; aucune colonne lot, coût, fournisseur ou unité. Mode `inventaire` sans écart ni anomalie, mode `livraison` = incrément (embryon de réception sans trace).

## 3. Alertes de stock

- **Calcul à la volée** dans `getStockPharmacie` (`pharmacie.service.ts:489-527`) : `stockBas` = `0 < quantite < 10`, `rupture` = `quantite === 0` (510-511). Seuil en dur : `SEUIL_STOCK_BAS = 10` (`pharmacie.service.ts:35`, `vente.service.ts:27`) et littéraux `10` (`pharmacie.service.ts:408, 467`). Non paramétrable.
- **Notifications `STOCK_ALERTE`** aux comptes d'enum `PHARMACIEN` et `STRUCTURE_ADMIN` de la structure : upsert (408-424), ajustement qui franchit le seuil (467-483), import (696-716), vente (`vente.service.ts:445, 469-494`).
- **Aucune alerte de péremption côté serveur**, aucun horizon, aucune valorisation.
- **Contrat client** (`GET /pharmacie/stock/:structureId`) : `{ success, message, data: { stocks: [StockMedicament + medicament{...}], alertes: { stockBas: [{ id, nom, quantite }], rupture: [{ id, nom }] } } }`. Typé côté front `StockInfo` (front `src/lib/api_pharmacie.ts:42-50`), lu par `getMyStock` (97).
- **Consommateurs front** : `src/app/dashboard/stock/page.tsx:137,144` (compteurs) ; `src/lib/apercu_pharmacie.ts` RECALCULE ses propres alertes depuis `stocks` (`SEUIL_STOCK_BAS = 10` ligne 5, `JOURS_EXPIRATION_PROCHE = 60` ligne 7, catégories périmé, rupture, stock bas, expire bientôt, valeur au prix de vente), consommé par `ApercuPharmacie`, `PilotagePharmacie`, `ComptoirPharmacie` ; `NotificationBell.tsx` et `api_notifications.ts` pour le type `STOCK_ALERTE`. Le « contrat » à préserver est donc double : l'objet `alertes` ET les champs `quantite`, `prixUnitaire`, `dateExpiration` de chaque élément de `stocks`.
- **Aucun test dédié** au contrat `alertes` de `getStockPharmacie` (aucune occurrence dans les specs back) : le test de non-régression demandé doit être écrit avant le recâblage.

## 4. RBAC

- **Enum `Role`** (`schema.prisma:13-21`) : `PATIENT`, `MEDECIN`, `PHARMACIEN`, `STRUCTURE_ADMIN`, `ADMIN`, `SUPER_ADMIN`, `ACCUEIL` = 7 valeurs. En plus, RBAC dynamique `AppRole` (46-59) : rôles système (Patient, Administrateur plateforme, Super Administrateur) et rôles par défaut par type de structure (`DEFAULT_STRUCTURE_ROLES`, `src/common/rbac/permissions.constants.ts`) ; rôles personnalisés par structure possibles.
- **Pharmacie** (`permissions.constants.ts:296-332`) : « Pharmacien » = `stock:read`, `stock:write`, `catalogue:write`, `vente:read`, `vente:write`, `chat:structure`, `structure:read`, `membre:read` ; « Administrateur de structure » = `stock:read/write`, `vente:read/write/annuler`, `structure:read/write`, `membre:read/manage`, `role:manage` (pas `catalogue:write`). Aucun rôle « vendeur », « caissier » ou « titulaire ».
- **Format** : `domaine:action`, constante `PERMISSIONS` (11-49, pharmacie 23-30) + `PERMISSION_CATALOG`, persisté dans `Permission`.
- **Filtre par type** (`permissions-type-structure.ts:16-66`) : liste BLANCHE pharmacie (16-30) ; toute nouvelle permission y est refusée tant qu'elle n'est pas ajoutée ; `vente:*` retirées aux autres types (33-37). Appliqué dans `PermissionsService.getUserPermissions`, cache Redis `perms:v3:user:<id>` 5 min.
- **Synchronisation au démarrage** : `RolesService.onApplicationBootstrap` (`roles.service.ts:42-56`) : catalogue, rôles système, rôles des structures existantes, `completerRolesAdminPharmacie` (`PERMISSIONS_GARANTIES_ADMIN_PHARMACIE`, `permissions.constants.ts:338-345`), backfill ; un échec est avalé. Les permissions d'un rôle de structure existant ne sont appliquées qu'à sa création : une nouvelle permission exige constante, catalogue, liste blanche, rôle par défaut, ET migration SQL (D112) ou complément au démarrage (D304).
- **Vérification serveur** : `PermissionsGuard` + `@RequirePermissions` (logique ET). Aucun mécanisme de masquage de CHAMPS par permission : un droit « marge » demandera un filtrage du contenu des réponses, pas seulement une garde de route.
- Front : menu et accueil depuis `/auth/me` (`permissions`, `structureType`), `vuePharmacie(ctx)` (pilotage si `structure:write` ou `vente:annuler`, sinon comptoir).

## 5. Front web

- **Écrans** : stock `src/app/dashboard/stock/page.tsx` (+ `components/modals/StockModal.tsx`, `ImportStockModal.tsx`) ; nouvelle vente `src/app/dashboard/vente/page.tsx` (+ `ConfirmationVente.tsx`, `panier.ts`), qui charge tout le stock par `getMyStock` et filtre en mémoire ; ventes du jour `src/app/dashboard/ventes/page.tsx` (+ `AnnulationVente.tsx`, `affichage.ts`) ; reçu `src/app/dashboard/ventes/[venteId]/recu/page.tsx` ; catalogue `src/app/dashboard/catalogue`, `medicaments`, `pharmacies` ; accueil `components/dashboard/ApercuPharmacie.tsx`, `ComptoirPharmacie.tsx`, `PilotagePharmacie.tsx`, `app/dashboard/structure/MaPharmacie.tsx`. Aucun écran de caisse, de lot, de réception ou d'inventaire.
- **lib** : `api_pharmacie.ts`, `api_ventes.ts` (en-tête `Idempotency-Key`), `api_carnet.ts` (`nouvelleCleIdempotence`), `apercu_pharmacie.ts`, `ventes_tableau_de_bord.ts`, `compteurs_tableau_de_bord.ts`, `format_gnf.ts`, `navigation_tableau_de_bord.ts`.
- **Hors ligne web : inexistant.** `public/sw.js` pass-through, purge des caches, « NE RIEN METTRE EN CACHE ICI » (1-36) ; `src/app/sw.ts` (serwist) est du code mort, plugin commenté (`next.config.ts:1-7`) ; aucune IndexedDB, dexie, idb ni file (recherche vide) ; page `src/app/offline/page.tsx` purement informative ; backlog point 24 (`BACKLOG-PRIORISE.md:79`). Seul état local : panier en `localStorage` version 1 (`panier.ts:241-271`) avec clé d'idempotence par panier : renvoi sûr après coupure, pas de vente hors ligne. La recherche locale rapide existe seulement parce que le stock est en mémoire dans la page chargée.

## 6. Mobile

- **Public : patients uniquement** (option A, décision du porteur du 2026-10-18, `docs/PLAN-APPLICATION-MOBILE.md`, décision 1 ; mobile `CLAUDE.md:3-5`). `Capability` n'a qu'une valeur `patientSpace` (`app_user.dart:22-26`), accordée au seul rôle patient (68-72) ; le routeur envoie tout autre compte vers l'écran C17 (`routes.dart:65-67`). Le plan classe le pharmacien en « Plus tard », avec un périmètre limité à l'ajustement rapide de stock et à l'alerte (`PLAN-APPLICATION-MOBILE.md:173-175, 196`), jamais une caisse. Aucun code pharmacie dans `lib/`.
- **Couche locale réelle** : drift + SQLite3MultipleCiphers, une base chiffrée par compte, clé aléatoire en stockage sécurisé (`local_database_factory.dart`) ; une seule table `cache_entries(key, value, updated_at)`, `put`, `read`, `remove` (`local_database.dart:20-53`), `allTables` vide, « les tables métier typées viendront avec le lot TM2 ». Seuls la fabrique et `account_store.dart` y touchent.
- **Absents** : file d'événements, journal ordonné, numéro de séquence, identifiant de poste, rejeu idempotent, résolution de conflits. Le seul rejeu est réseau (`RetryInterceptor`) et `Idempotency-Key` est un paramètre optionnel du client HTTP (`lib/core/network/api_client.dart:71-89`).
- **Réutilisable pour une caisse : non.** Au mieux, le principe de base locale chiffrée par compte est une idée transposable. Utiliser le mobile pour la caisse contredirait une décision explicite du porteur.

## 7. Tests existants (comptés par `it(` / `test(`)

Back : `src/pharmacie/vente.service.spec.ts` 34, `vente.http.spec.ts` 6, `pharmacie.import.spec.ts` 21, `catalogue-import.spec.ts` 15, `pharmacie-import-mode.http.spec.ts` 4, `pharmacie.stock-quantite.spec.ts` 4 (pharmacie 84) ; `src/common/rbac/permissions-type-structure.spec.ts` 15, `roles.service.spec.ts` 6 (RBAC 21). Total 105. Pas d'e2e utile, aucun test de migration ni harnais de base chargée, aucun test du contrat `alertes`. Les tests de vente supposent le décrément direct de `StockMedicament`.

Front : `vente/page.test.tsx` 12, `vente/panier.test.ts` 37, `ventes/page.test.tsx` 13, `ventes/affichage.test.ts` 12, `recu/page.test.tsx` 7, `stock/page.test.tsx` 2, `ApercuPharmacie.test.tsx` 14, `ComptoirPharmacie.test.tsx` 8, `PilotagePharmacie.test.tsx` 7, `ImportStockModal.test.tsx` 17, `apercu_pharmacie.test.ts` 9 (fige les seuils client), `api_pharmacie.test.ts` 8, `api_ventes.test.ts` 14, `navigation_tableau_de_bord.pharmacie.test.ts` 12, `ventes_tableau_de_bord.test.ts` 5. Total 177.

Mobile : aucun test pharmacie (tests de la base locale dans `test/core/storage`).

## 8. Synthèse

### 8.1 Hypothèses de la demande confrontées au code

| Hypothèse | Verdict | Preuve |
|---|---|---|
| Backend NestJS + PostgreSQL | VRAIE | back `CLAUDE.md`, `schema.prisma` datasource postgresql |
| RBAC « à six rôles » | FAUSSE | 7 valeurs d'enum (`schema.prisma:13-21`) + rôles dynamiques `AppRole` ; aucun rôle vendeur, caissier ou titulaire |
| Front Next.js | VRAIE | `front_medconnect/src/app` |
| Hors ligne Flutter déjà implémenté, base de la vente | FAUSSE | cache clé/valeur sans file ni synchro (`local_database.dart`), application patients seuls (`app_user.dart:68-72`, `routes.dart:65-67`) |
| Mécanique de persistance locale et de synchronisation | FAUSSE pour la synchronisation, PARTIELLE pour la persistance (lecture chiffrée côté mobile, patients) | idem |
| Géolocalisation des pharmacies | VRAIE | `Structure.latitude/longitude` (167-168), `rechercherDisponibilite` Haversine (`pharmacie.service.ts:982+`) |
| Mise en ligne du catalogue | PARTIELLE | référentiel GLOBAL de noms sans prix ni conditionnement (`schema.prisma:419-432`) ; le prix et la quantité sont sur `StockMedicament` par pharmacie |
| Alertes de stock | PARTIELLE | stock bas et rupture à seuil fixe 10 ; aucune péremption serveur, aucun horizon, aucune valorisation (section 3) |
| Point de vente récent qui décrémente à la validation | VRAIE au sens « module de vente » | `vente.service.ts:396-402`, migration `20261022120000_ventes_pharmacie` |
| Point de vente au sens entité, par pharmacie | FAUSSE | aucune table ni colonne ; la pharmacie est la `Structure` |
| Aucune gestion de caisse | VRAIE | aucun modèle ; `SPEC-VENTES-PHARMACIE.md:4` « Pas de gestion de caisse » |
| Fournisseurs | FAUSSE | aucun modèle ni champ |
| Postes de caisse | FAUSSE | aucun ; `Session` = authentification |
| Montants entiers GNF | VRAIE | tous les montants `Int` ; mais le prix unitaire est la référence, pas le montant de ligne |
| Stock en compteur mutable | VRAIE | section 1.3 |
| Une vente ne se bloque jamais, stock négatif accepté | FAUSSE (état actuel) | 409 `STOCK_INSUFFISANT`, plancher 0 ; c'est l'objectif, pas l'existant |
| Sortie manuelle d'un périmé avec motif | FAUSSE (état actuel) | refus dur 400 `MEDICAMENT_EXPIRE` sans dérogation |
| Immuabilité des ventes | NON RESPECTÉE | annulation par mutation, cascades (2.4) |
| Unité minimale, coefficient, deux prix, lots, coût | N'EXISTENT PAS | `schema.prisma:419-450` |

### 8.2 Ce qui existe déjà sous une autre forme

- Vente transactionnelle, numérotation par pharmacie et année, idempotence 24 h, audit, annulation du jour, reçu imprimable : à étendre plutôt qu'à recréer.
- Prix entiers GNF par pharmacie (`StockMedicament.prixUnitaire`) : équivalent du futur prix boîte avec coefficient 1.
- `StockMedicament` = la fiche produit de la pharmacie (prix, seuil implicite, date) : c'est elle, et non `Medicament` global, qui correspond au « Product » de la demande pour les attributs propres à l'officine.
- Copie du nom et du prix sur la ligne de vente, identifiants sans FK (D109) : déjà la logique « recopié, pas référencé ».
- Import Excel `livraison` (embryon de réception) et `inventaire` (embryon d'inventaire), sans trace.
- Alertes stock bas et rupture, notifications `STOCK_ALERTE`, péremption approximative côté front.
- RBAC par permission, liste blanche pharmacie, complément au démarrage, cache, `/auth/me`.
- `AuditLog` générique, panier local et clé d'idempotence client, base mobile chiffrée par compte (idée transposable).

### 8.3 Ce qui entre en conflit avec la demande

1. Compteur mutable contre stock calculé depuis les mouvements.
2. Une ligne de stock par produit x pharmacie, une date unique, contre le stock par lot ; les ventes et le panier web référencent `stockId`.
3. Refus durs `STOCK_INSUFFISANT` et `MEDICAMENT_EXPIRE`, plancher 0, contre « ne jamais bloquer » et la sortie motivée d'un périmé.
4. Annulation par mutation et limitée au jour, cascades destructrices (super-admin, démo, catalogue, stock) contre l'immuabilité par écriture inverse.
5. Un seul prix, `sousTotal = prix x quantité` (prix de référence) contre deux prix indépendants et un montant de ligne de référence.
6. Numérotation sérialisée par pharmacie contre des plages de tickets par poste ; l'unicité `[structureId, numero]` impose un nouveau format.
7. Idempotence limitée à 24 h et clé remise à `null` contre un identifiant d'événement stable rejouable après une longue coupure.
8. Écritures de stock non tracées (upsert, ajustement, import, suppression) : toutes devront produire des mouvements, sinon divergence.
9. Deux contrôles d'accès divergents (`checkPharmacieAccess` sur l'enum, `verifierPharmacie` sur l'appartenance), à unifier avant d'ajouter des droits de caisse et de marge.
10. Mobile réservé aux patients contre l'idée de s'appuyer sur le hors ligne Flutter ; `SPEC-VENTES-PHARMACIE.md:96-97` classait la vente hors connexion en « Plus tard ».
11. Alertes en deux consommateurs (objet `alertes` serveur + recalcul client) : « ne pas changer le contrat » vise les deux.
12. `GET /pharmacie/rechercher` (public, patients) lit `quantite` et `disponible` : si la colonne est gelée, la recherche patient affichera un stock faux.

### 8.4 Ce qui manque complètement

Unité minimale, coefficient, deux prix, déconditionnable, tolérance d'inventaire ; lots (numéro, péremption, coût figé, fournisseur, réception, lot technique), FEFO, reliquat et état de conditionnement ouvert ; journal de mouvements et agrégat de lecture reconstructible ; allocations de lot (définitives et provisoires) ; fournisseurs ; coût d'acquisition ; inventaire, anomalies et file d'anomalies ; point de vente et poste ; plages de tickets ; sessions de caisse, comptages par coupure, mouvements de caisse, modes de paiement en table de référence, paiements multiples, théorique par mode ; clôture journalière et verrouillage, écritures inverses ; permission de marge et masquage serveur des coûts, marge réelle et volume non valorisable ; alertes de péremption par lot à horizons, valorisées au coût ; paramètres par pharmacie ; journal d'événements de synchronisation ; hors ligne web complet (stockage local, service worker de cache, file, rechargement de plage) ; harnais de tests de migration ; test de non-régression des alertes.

### 8.5 Risques de migration

1. **Volumes inconnus** (aucune lecture de données). `StockMedicament` est petit par nature ; `Vente` et `LigneVente` datent du 2026-10-22, donc petites et largement démo. Les tables à fort volume seront créées vides : ajouter `pointDeVenteId` non nul maintenant est peu coûteux. Un comptage en lecture seule avant déploiement reste nécessaire.
2. **Point de vente** : aucune entité à remplir aujourd'hui ; il faut d'abord créer un point de vente par pharmacie existante, puis remplir depuis `structureId` (toujours déterminable : pas de ligne orpheline possible grâce aux FK et cascades). Cas à contrôler : stock résiduel sur une structure non PHARMACIE (non interdit par la base).
3. **Compteur vers mouvements** : le mouvement initial égale le solde courant ; le test « calculé = compteur » prouve la migration, pas l'exactitude du compteur. Les ventes historiques ont déjà décrémenté le compteur et n'auront ni mouvement ni allocation.
4. **Péremption du lot technique** : la demande dit « péremption nulle », ce qui PERD la `dateExpiration` existante, casse le refus des périmés à la vente pour ce stock et vide les alertes de péremption front. À trancher (voir conséquences).
5. **Coût nul partout** : tous les lots techniques non valorisables ; les rapports de marge resteront vides jusqu'aux premières réceptions réelles.
6. **Unité ambiguë** de l'existant (boîtes en pratique : démo Doliprane `quantite 240`, `prixUnitaire 15000`, `src/demo/demo.donnees.ts:645-650`) : coefficient 1 garde les chiffres mais le sens reste « boîte » jusqu'à qualification ; le seuil 10 change de sens dès qu'un coefficient est renseigné.
7. **Contrats figés** : `stockId` dans `POST /ventes`, panier `localStorage` version 1, `LigneVente.stockMedicamentId` historique ; il faut conserver `StockMedicament` (au moins en lecture) et versionner le panier.
8. **Pendant la version de transition**, tous les chemins d'écriture existants (upsert, PATCH, import, DELETE, vente, annulation) doivent écrire des mouvements, sinon divergence immédiate.
9. **Cascades** `Structure` et `Medicament` : à revoir avant d'introduire des pièces comptables immuables (sessions, clôtures, mouvements).
10. **Seeds et démo** : `prisma/seed_medicaments.ts:115-130` et `src/demo/demo.seeder.ts:417-423` écrivent `StockMedicament` directement ; sans adaptation, le stock calculé des comptes démo vaut zéro. Purge démo par cascade.
11. **Permissions nouvelles** : liste blanche, rôles par défaut, migration SQL ou complément au démarrage, sinon invisibles pour les pharmacies existantes.
12. **Concurrence** : le verrou `CompteurVente` sérialise déjà les ventes ; le rejeu d'un journal hors ligne en rafale et la sélection multi lots demanderont un ordre de verrouillage stable des lots.

## Corrections apportées aux rapports A et B

1. **Comptage des tests back** : B donne 33, 5, 3, 14, 14 (total 100) ; A donne 34, 6, 4, 15, 15. Recompté : A a raison (pharmacie 84, RBAC 21, total 105).
2. **Tests front** : A omet `ventes/affichage.test.ts` (12 tests), relevé par B. Total front recompté : 177 (B annonçait « environ 176 »).
3. **Mobile réutilisable** : A dit « non », B dit « partiellement, comme fondation technique ». Vérité retenue : non pour une caisse (aucune file, aucune synchro, public patients par décision du porteur) ; seule l'idée d'une base locale chiffrée par compte est transposable, pas le code, puisque la caisse vivra sur le web.
4. **Catalogue** : B le dit VRAI, A PARTIEL. Retenu : PARTIEL, car c'est un référentiel global de noms, pas un catalogue de vente par officine (prix et quantité sont sur `StockMedicament`).
5. **Alertes** : B dit VRAIE mais minimale, A PARTIELLE. Retenu : PARTIELLE (aucune péremption serveur).
6. **Référence Structure** : A cite « relations stock/ventes 41-45 », faux ; les relations sont aux lignes 195, 198, 199 de `schema.prisma`.
7. **`Session` en 698-705** (B) : 698 est l'enum `SessionClientType`, le modèle `Session` commence ligne 705.
8. **Lignes de l'annulation** : B cite 597-607, l'écriture est en `vente.service.ts:605-613` (A exact).
9. **Ajouts absents des deux rapports** : `Medicament.formes` est un tableau (plusieurs présentations par médicament), donc le coefficient ne peut pas vivre sur `Medicament` global ; la fiche produit de l'officine est `StockMedicament` ; l'Administrateur de structure n'a pas `catalogue:write` par défaut ; `disponible` est lu par la recherche publique (`pharmacie.service.ts:991`) ; le plan mobile ne prévoit pour le pharmacien qu'un ajustement de stock et des alertes, jamais une caisse.
10. Points concordants vérifiés et confirmés : compteur mutable, remise à `null` de la clé d'idempotence (207-210), divergence des deux contrôles d'accès, absence de PATCH/DELETE de vente, cascades super-admin et démo, service worker pass-through, serwist mort, 7 valeurs d'enum, liste blanche pharmacie.

## Conséquences pour le plan (à trancher à l'Étape 1, sans rédiger le plan ici)

1. **Support du hors ligne** : web (service worker + IndexedDB + journal d'événements) ou levée de la décision « mobile patients seuls ». La seule option compatible avec les décisions du porteur est le web ; c'est un chantier propre, le plus lourd de la tranche, à découper (probablement en dernier lot, la vente en ligne sur lots d'abord).
2. **Où vit le « Product »** : unité minimale, coefficient, deux prix, déconditionnable, tolérance. Comme `Medicament` est global et multi-formes, ces attributs vont sur la fiche de l'officine (`StockMedicament` étendu, ou une entité produit-officine qui le remplace), pas sur le catalogue global ; dire aussi si une présentation globale (forme + conditionnement) doit être introduite.
3. **Devenir de `StockMedicament`** : conservé comme fiche produit de l'officine (prix, paramètres) avec `quantite` gelée une version, lots et mouvements à côté ; contrat `stockId` des ventes et du panier à maintenir ou versionner.
4. **Point de vente** : table `PointDeVente` créée et remplie (un par pharmacie) ou identifiant dérivé ; la demande exige une colonne non nulle, donc une table est le choix naturel.
5. **Lot technique** : reprendre `dateExpiration` actuelle (recommandé pour ne pas perdre le refus des périmés ni les alertes) ou suivre la lettre (péremption nulle). Question au porteur.
6. **Annulation existante** : la transformer en façade d'écriture inverse rattachée à la journée courante, ou la retirer ; impact front (`AnnulationVente.tsx`, `api_ventes.ts`).
7. **Rôles** : « titulaire » = Administrateur de structure, « vendeur » = Pharmacien ou nouveau rôle par défaut « Vendeur » (au comptoir en Guinée, le vendeur n'est souvent pas pharmacien) ; nouvelles permissions (caisse, clôture, marge, inventaire, réception) avec liste blanche, rôles par défaut et migration de rattachement ; unifier les deux contrôles d'accès.
8. **Masquage serveur des coûts** : définir où filtrer (sérialisation par permission) puisque rien n'existe.
9. **Idempotence** : identifiant d'événement permanent pour le rejeu, distinct de la clé 24 h actuelle.
10. **Numérotation** : format des tickets par poste et plage (compatible avec l'unicité actuelle) et coexistence avec `V-AAAA-NNNNNN` historique.
11. **Recherche publique** et alertes : les rebrancher sur l'agrégat de lecture, conserver le double contrat (objet `alertes` + champs de `stocks`), écrire le test de non-régression d'abord ; unifier le seuil (3 copies) et préciser son unité.
12. **Cascades** : retirer ou restreindre les cascades `Structure` et `Medicament` sur les nouvelles tables comptables, et décider du sort de `DELETE` stock et catalogue.
13. **Seeds, démo et harnais de migration** : à adapter et à créer dans la tranche.
14. **Compromis de vitesse** : verrou de numérotation par pharmacie, sélection FEFO et reliquat dans la transaction ; à chiffrer dans le plan.
15. **Validation existante à corriger au passage** : `UpsertStockDto.quantite` sans `@IsInt`.
