# Inventaire A (Étape 0) : module pharmacie MedConnecte

Inventoriste A (Sonnet). Lecture seule : aucun code, aucune migration, aucun commit, aucune écriture en base.
Dépôts lus : back `orch/pharmacie-t1-back` (tête cbea6f8), front `orch/pharmacie-t1-front` (tête 29aa696), mobile `orch/tm1-mobile` (tête 6f033a8).
Chemins relatifs à `back_medconnect/` (back), `front_medconnect/` (front), `mobile_medconnect/` (mobile), sauf mention contraire.

## 0. Réponse courte aux deux points décisifs

1. **Le stock est un compteur mutable.** `StockMedicament.quantite Int @default(0)` (`prisma/schema.prisma:441`), modifié en place par `increment`/`decrement`/`update`. Il n'existe aucun journal de mouvements, aucune table de lots, aucune trace des variations hors `AuditLog` (et l'`AuditLog` n'est écrit que pour la création et l'annulation d'une vente, pas pour le stock). Toute la migration vers un stock calculé part donc de zéro.
2. **La gestion hors ligne de l'application Flutter n'est PAS réutilisable pour une caisse de pharmacie.** L'application mobile est réservée aux patients (une seule capacité, `patientSpace`), la couche locale est un simple cache clé/valeur chiffré sans aucun appelant métier, et il n'y a ni file d'événements, ni synchronisation, ni numéros de ticket. Le web a un service worker volontairement vide (pass-through, aucun cache). La demande suppose un acquis qui n'existe pas.

## 1. Modèle de données pharmacie

### 1.1 Modèles Prisma concernés (`prisma/schema.prisma`)

| Modèle | Lignes | Champs utiles | Contraintes / index |
|---|---|---|---|
| `Medicament` (catalogue GLOBAL, partagé, sans structure) | 419-432 | `id`, `nom`, `nomGenerique?`, `categorie` (texte libre), `description?`, `ordonnanceRequise Boolean`, `formes String[]` (texte libre, ex. "comprimé"), `createdAt`, `updatedAt` | Aucune unicité sur `nom`. Aucun champ prix, unité, coefficient, conditionnement. |
| `StockMedicament` (UNE ligne par couple produit x pharmacie) | 434-450 | `id`, `medicamentId`, `structureId`, `quantite Int @default(0)`, `prixUnitaire Int?` (GNF), `disponible Boolean @default(true)`, `dateExpiration DateTime?` (UNE seule date), `notes?`, `updatedAt` | `@@unique([medicamentId, structureId])` (449). `onDelete: Cascade` vers `Medicament` et `Structure`. Aucun index secondaire en dehors de cette unicité. |
| `Vente` | 460-482 | `id`, `structureId`, `numero String` (`V-AAAA-NNNNNN`), `vendeurId` (sans FK), `vendeurNom` (copie), `clientNom?`, `clientTelephone?`, `ordonnanceVerifiee`, `total Int`, `statut StatutVente` (`VALIDEE`/`ANNULEE`), `annuleeLe?`, `annuleeParId?` (sans FK), `motifAnnulation?`, `cleIdempotence?`, `createdAt` | `@@unique([structureId, numero])`, `@@unique([structureId, cleIdempotence])`, `@@index([structureId, createdAt])`. `onDelete: Cascade` vers `Structure`. |
| `LigneVente` | 484-496 | `venteId`, `medicamentId` (sans FK), `stockMedicamentId` (sans FK), `nomMedicament` (copie), `prixUnitaire Int` (copie), `quantite Int`, `sousTotal Int` | `@@index([venteId])`. Cascade depuis `Vente`. |
| `CompteurVente` | 499-506 | `structureId`, `annee`, `dernierNumero` | PK composite `[structureId, annee]` |
| `Structure` | 159-220 (relations stock/ventes 41-45) | `type StructureType` (`HOPITAL`/`CLINIQUE`/`PHARMACIE`), `latitude/longitude Float?`, `estDeGarde`, `horaires` (JSON texte), `isActive`, `isConfigured` | `email @unique` |
| `AuditLog` | 355-371 | `userId?`, `action`, `entityType`, `entityId`, `ip?`, `metadata Json?` | index sur `userId`, `(entityType, entityId)`, `createdAt` |

Modèles ABSENTS (recherchés dans le schéma et dans `src/`, aucun résultat) : lot, mouvement de stock, fournisseur, réception d'achat, poste de caisse, session de caisse, comptage par coupure, mouvement de caisse, paiement, mode de paiement, clôture journalière, état de conditionnement ouvert, point de vente distinct de la structure, coût d'acquisition, unité minimale, coefficient de conversion, tolérance d'inventaire, anomalie, journal d'événements de synchronisation, `StatutVente` autre que `VALIDEE`/`ANNULEE`.

Le seul identifiant de "point de vente" qui existe est `structureId` (une pharmacie = une `Structure` de type `PHARMACIE` = un point de vente implicite). Il n'y a pas de table `PointDeVente`.

### 1.2 Migrations concernées (`prisma/migrations/`)

- `20260425202451_init`, `20260426144501_init_migration`, `20260628161425_sync_schema_complet` : création initiale de `Medicament` et `StockMedicament` (prix en `Float` à l'époque).
- `20260704_add_soft_delete_audit_trail` : ajoute `deletedAt` aux modèles de carnet (`Consultation`, `Ordonnance`, `ResultatAnalyse`, `Vaccination`, schema.prisma:275, 302, 326, 347) et l'`AuditLog`. **Ni `StockMedicament`, ni `Medicament`, ni `Vente` n'ont de `deletedAt`** (grep `deletedAt` : 4 occurrences, toutes dans le carnet).
- `20261022120000_ventes_pharmacie/migration.sql` : crée `StatutVente`, `Vente`, `LigneVente`, `CompteurVente` ; passe `StockMedicament.prixUnitaire` de Float à Integer avec `ROUND(...)::INTEGER` (ligne `ALTER TABLE "StockMedicament"`), insère les permissions `vente:*` et les rattache aux rôles existants des pharmacies. C'est la dernière migration du dépôt.

### 1.3 Comment le stock est tenu AUJOURD'HUI (point décisif)

**Compteur mutable sur la ligne produit x pharmacie.** Preuves :
- `schema.prisma:441` : `quantite Int @default(0)`.
- Vente : décrément conditionnel atomique `updateMany({ where: { id, structureId, quantite: { gte } }, data: { quantite: { decrement } } })`, `src/pharmacie/vente.service.ts:396-405`.
- Annulation : `increment` + `disponible: true`, `vente.service.ts:625-629`.
- Ajustement manuel : `SELECT ... FOR UPDATE` puis `update({ quantite: Math.max(0, ancienne + variation) })`, `src/pharmacie/pharmacie.service.ts:444-458` (plancher à 0 en ligne 449).
- Upsert manuel (écrase la quantité par la valeur reçue) : `pharmacie.service.ts:361-420` (`quantite: dto.quantite` en create ET update).
- Import Excel : mode `inventaire` (remplace) ou `livraison` (`increment`), `pharmacie.service.ts:623-720`.
- Suppression physique de la ligne de stock : `pharmacie.service.ts:542` (`stockMedicament.delete`).
- `disponible` est un booléen dérivé de la quantité, maintenu à la main dans chaque chemin d'écriture (redondance).

Conséquences : aucun historique des entrées/sorties ; un ajustement positif ou négatif, un upsert ou un import "inventaire" ne laissent aucune trace dans le stock (aucun `AuditLog` dans `pharmacie.service.ts`, grep "audit" sans résultat) ; le stock négatif est impossible aujourd'hui (plancher 0 et décrément conditionnel `quantite >= demandée`).

### 1.4 Dates d'expiration, prix, coût

- **Une seule date d'expiration par ligne de stock** (`StockMedicament.dateExpiration DateTime?`, schema.prisma:444). Une livraison (import mode `livraison`) ou un upsert écrase la date sans conserver l'ancienne : deux livraisons de péremptions différentes se confondent. Il n'y a donc aucune notion de lot.
- **Prix en `Int` (GNF)**, nullable : `prixUnitaire Int?` (schema.prisma:442) ; `Vente.total`, `LigneVente.prixUnitaire`, `quantite`, `sousTotal` sont des `Int`. Le DTO impose `@IsInt` 0..2147483647 (`dto/pharmacie.dto.ts:104-110`). Plafond total vente `PRIX_MAX = 2147483647` (`pharmacie.service.ts:39`, contrôle `vente.service.ts` dans `enregistrerVente`).
- **Il y a UN seul prix par ligne de stock**, porté par la pharmacie (pas par le catalogue). Pas de prix boîte / prix unité. `Medicament` n'a aucun prix.
- **Aucun coût d'achat n'existe nulle part** (ni sur `StockMedicament`, ni sur `Medicament`, ni sur `LigneVente`). La marge réelle n'est pas calculable aujourd'hui, et la migration ne peut pas "reprendre le dernier coût connu" : il n'y en a pas, tous les lots techniques démarreraient à coût nul/inconnu.
- Quantité de vente : `LigneVenteDto.quantite` entier 1..10000 (`dto/vente.dto.ts:32-36`) ; la quantité est le nombre d'unités de la ligne de stock, dont l'unité n'est pas définie (le texte `Medicament.formes` est libre).

## 2. Endpoints pharmacie, stock, catalogue, ventes, import

Tous sous le préfixe `/pharmacie`. Gardes : `AuthGuard` + `PermissionsGuard` (`@RequirePermissions`) sauf routes publiques. `PermissionsGuard` : `src/common/rbac/permissions.guard.ts:91-114`.

### 2.1 `PharmacieController` (`src/pharmacie/pharmacie.controller.ts`)

| Méthode et chemin | Ligne | Garde / permission | Notes |
|---|---|---|---|
| `GET /pharmacie/rechercher` | 84 | publique | Recherche de disponibilité (`q`, `ville`, `lat`, `lng`, `pharmacieId`) : stocks `disponible = true`, `quantite > 0`, structure PHARMACIE active et configurée (`pharmacie.service.ts:982-1075`). Distance Haversine. Ne filtre PAS la péremption. Expose `prixUnitaire`, `quantite`, `dateExpiration`. |
| `GET /pharmacie/catalogue` | 111 | publique | Catalogue global (recherche, catégorie) |
| `GET /pharmacie/catalogue/categories` | 122 | publique | |
| `GET /pharmacie/catalogue/:medicamentId` | 128 | publique | Détail + pharmacies où disponible |
| `POST /pharmacie/catalogue` | 142 | `catalogue:write` | Création d'un médicament (`CreateMedicamentDto`) |
| `GET /pharmacie/catalogue/import/modele` | 154 | `catalogue:write` | Modèle Excel |
| `POST /pharmacie/catalogue/import/apercu` | 173 | `catalogue:write` | Aperçu import catalogue |
| `POST /pharmacie/catalogue/import` | 190 | `catalogue:write` | Import catalogue |
| `PATCH /pharmacie/catalogue/:medicamentId` | 213 | `catalogue:manage` | Modification du médicament |
| `DELETE /pharmacie/catalogue/:medicamentId` | 231 | `catalogue:manage` | **Suppression physique** (`pharmacie.service.ts:298-305`), cascade sur tous les `StockMedicament` du produit dans toutes les pharmacies |
| `GET /pharmacie/stock/:structureId` | 249 | `stock:read` ET `stock:write` | Stock + alertes (voir §3) |
| `POST /pharmacie/stock/:structureId` | 266 | `stock:read` ET `stock:write` | Upsert stock (200). DTO `UpsertStockDto` : `medicamentId`, `quantite` (`IsNumber`, `Min(0)`, pas `IsInt`), `prixUnitaire?` Int, `dateExpiration?`, `notes?` (`dto/pharmacie.dto.ts:91-121`). Remplace la quantité. |
| `PATCH /pharmacie/stock/:structureId/:stockId/quantite` | 284 | `stock:read` ET `stock:write` | Ajustement `variation` entier (`UpdateStockQuantiteDto`), plancher 0 |
| `DELETE /pharmacie/stock/:structureId/:stockId` | 309 | `stock:read` ET `stock:write` | **Suppression physique** de la ligne de stock |
| `GET /pharmacie/stock/:structureId/import/modele` | 330 | idem | Modèle Excel stock |
| `POST /pharmacie/stock/:structureId/import/apercu` | 355 | idem | Aperçu |
| `POST /pharmacie/stock/:structureId/import` | 383 | idem | Import, option `mode` = `inventaire` ou `livraison` (`dto/pharmacie.dto.ts:145-159`). Plafond fichier 10 Mo mémoire, limite métier 2 Mo. |

Remarque RBAC : les routes de stock exigent `stock:read` ET `stock:write` (logique ET, `require-permissions.decorator.ts`), donc un rôle personnalisé "lecture seule du stock" est refusé. De plus, `checkPharmacieAccess` (`pharmacie.service.ts:1077-1098`) exige en plus que `user.role` (enum) soit `STRUCTURE_ADMIN` ou `PHARMACIEN` et `user.structureId === structureId` : un rôle personnalisé porté par un utilisateur d'un autre rôle enum, et l'administrateur dont seul `Structure.adminId` pointe vers lui (sans `structureId`), sont refusés côté stock alors que `VenteService.verifierPharmacie` (`vente.service.ts:75-107`) les accepte. Incohérence entre les deux gardes d'accès.

### 2.2 `VenteController` (`src/pharmacie/vente.controller.ts`, garde de classe ligne 38)

| Méthode et chemin | Ligne | Permission | Code |
|---|---|---|---|
| `POST /pharmacie/:structureId/ventes` | 42 | `vente:write` | 201 |
| `GET /pharmacie/:structureId/ventes` | 93 | `vente:read` | 200 (liste du jour, paginée par 50) |
| `GET /pharmacie/:structureId/ventes/:venteId` | 110 | `vente:read` | 200 |
| `POST /pharmacie/:structureId/ventes/:venteId/annuler` | 132 | `vente:annuler` | 200 |

DTO : `CreerVenteDto { lignes: [{ stockId, quantite }] (1..50), clientNom?, clientTelephone?, ordonnanceVerifiee? }`, `AnnulerVenteDto { motif }` 3..300 car., `ListerVentesQueryDto { date?, page? }` (`dto/vente.dto.ts`).

### 2.3 Règles métier de vente codées (`src/pharmacie/vente.service.ts`)

- **Transaction unique** `$transaction` avec `maxWait 5 s / timeout 15 s` (`vente.service.ts:28`, appel dans `creerVente`). Contenu : compteur, lecture des stocks, refus, création de la vente, retraits, audit.
- **Numérotation** `V-AAAA-NNNNNN` par pharmacie et par année, `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` sur `CompteurVente` (`vente.service.ts:266`) ; le verrou de la ligne sérialise TOUTES les ventes d'une pharmacie. Aucune plage réservée par poste, pas de notion de poste.
- **Idempotence** : en-tête `Idempotency-Key` facultatif (8 à 128 car.), unicité `(structureId, cleIdempotence)`, rejeu sous 24 h = même vente en 201 avec `data.rejeu: true` (`vente.service.ts:167-250`). **Au-delà de 24 h la clé est remise à `null` par un `vente.update`** (`vente.service.ts:207`).
- **Refus** dans l'ordre : ligne introuvable (404 `STOCK_INTROUVABLE`), périmé (400 `MEDICAMENT_EXPIRE`, `jourConakry(dateExpiration) < jour`, ligne 293-296), sans prix ou prix <= 0 (400 `PRIX_MANQUANT`, ligne 312), ordonnance requise non cochée (400 `ORDONNANCE_NON_CONFIRMEE`, ligne 329), stock insuffisant (409 `STOCK_INSUFFISANT`, détails `stockId, nom, disponible, demande`). Un seul code par réponse, tout refus annule la transaction.
- **Périmé : refus dur, sans dérogation possible** (pas de motif, pas de sortie manuelle). Conflit direct avec "sortie manuelle d'un lot périmé avec motif".
- **Stock insuffisant : refus dur** (409). Conflit direct avec "une vente ne se bloque jamais, stock négatif temporaire accepté".
- **Le prix vient du stock, jamais du client**, pas de remise (`enregistrerVente`, calcul `sousTotal = prixUnitaire * quantite`). Un prix 0 ou nul bloque la vente.
- **Alerte stock bas** (`STOCK_ALERTE`) : notification aux `PHARMACIEN` et `STRUCTURE_ADMIN` de la pharmacie au franchissement du seuil 10 (`vente.service.ts:445`), hors transaction, n'échoue jamais la vente.
- **Audit** : `AuditLog` `create` (et `annuler`) écrit dans la transaction, `entityType: 'Vente'`, métadonnées sans donnée client ni motif (`vente.service.ts:450` et `632`).
- **Annulation** (`annulerVente`, `vente.service.ts:572-670`) : vente `VALIDEE` créée le jour même (UTC), motif 3..300, passage conditionnel `updateMany` sur `statut: 'VALIDEE'` (605), remise en stock par `increment` + `disponible: true` (625-629), ligne de stock supprimée entre-temps ignorée et comptée. Pas de réservation de stock : le retrait est immédiat à la validation.
- **Pas de session de caisse, pas de mode de paiement, pas de paiement** : le seul "encaissement" est `Vente.total`.

### 2.4 Endpoints qui modifient ou suppriment une vente / ligne de vente / délivrance (conflit avec l'immuabilité)

1. **`POST /pharmacie/:structureId/ventes/:venteId/annuler`** (`vente.controller.ts:132`) : **MODIFIE la vente en place** (`vente.service.ts:605-613`, `updateMany` qui écrase `statut`, `annuleeLe`, `annuleeParId`, `motifAnnulation`) et modifie le stock par incrément. Ce n'est pas une écriture inverse rattachée à la journée courante, c'est une mutation de la pièce d'origine, limitée au jour même.
2. **Mutation interne de la clé d'idempotence** : `vente.service.ts:207` met `cleIdempotence = null` sur une vente de plus de 24 h lors d'un rejeu (pas un endpoint dédié, mais une écriture sur une vente validée).
3. **`DELETE /pharmacie/stock/:structureId/:stockId`** (`pharmacie.controller.ts:309`) : ne supprime pas la vente, mais supprime la ligne de stock référencée par les `LigneVente.stockMedicamentId` (sans FK, donc pas bloqué). Perte du lien vente / produit actuel.
4. **`DELETE /pharmacie/catalogue/:medicamentId`** (`pharmacie.controller.ts:231`) : cascade sur les stocks de TOUTES les pharmacies.
5. **`POST /super-admin/structures/:structureId/delete`** (`src/super-admin/super-admin.controller.ts:117`, service `super-admin.service.ts:454` `tx.structure.delete`) : `onDelete: Cascade` supprime physiquement les `Vente`, `LigneVente` et `CompteurVente` de la pharmacie.
6. **Purge du mode démo** (`src/demo/demo.seeder.ts:193`, `structure.deleteMany`) : même cascade, uniquement avec `DEMO_MODE=true` et `DEMO_RESET=true`.

Il n'existe AUCUN endpoint de mise à jour générique ni de suppression de ligne de vente ; les ventes ne sont jamais supprimées par l'API métier. En revanche les points 1 et 3 à 6 contredisent l'immuabilité demandée (le point 1 est le principal).

### 2.5 Import Excel (`src/pharmacie/import-excel.ts`, `catalogue-import.service.ts`, `pharmacie.service.ts:549-980`)

- Lecture de la ligne de titres parmi les 10 premières, colonnes obligatoires stock : Médicament, Quantité ; catalogue : Nom, Catégorie ; synonymes reconnus (`COLONNES_IMPORT_STOCK`, `COLONNES_IMPORT_CATALOGUE`).
- Stock : colonnes quantité, prix, date d'expiration (UNE date par produit), notes. Pas de colonne lot, coût, fournisseur, unité.
- Import en transaction (timeout 60 s, `pharmacie.service.ts:41`), une alerte groupée de stock bas à la fin (seuil 10, ligne 696).
- Mode `inventaire` : écrase la quantité, sans mouvement ni anomalie. Mode `livraison` : incrément.

## 3. Alertes de stock

- **Où et comment** : (a) liste calculée à la volée dans `getStockPharmacie` (`pharmacie.service.ts:489-527`) : `stockBas` = `quantite > 0 && quantite < 10`, `rupture` = `quantite === 0` (lignes 510-511), seuil codé en dur `SEUIL_STOCK_BAS = 10` (`pharmacie.service.ts:35`, `vente.service.ts:27`), non paramétrable par pharmacie ni par produit ; (b) notifications `STOCK_ALERTE` (type de `Notification`) créées à la volée à l'upsert (`pharmacie.service.ts:416`), à l'ajustement qui franchit le seuil (475), à l'import (706) et après une vente (`vente.service.ts:483`), destinataires `PHARMACIEN` et `STRUCTURE_ADMIN` de la structure.
- **Aucune alerte de péremption côté serveur.** Pas de tâche planifiée, pas d'horizons paramétrables, pas de valorisation. Seul le front calcule l'expiration proche (voir §5).
- **Contrat renvoyé au client** (`GET /pharmacie/stock/:structureId`) : `data: { stocks: [StockMedicament + medicament{id,nom,nomGenerique,categorie,formes,ordonnanceRequise}], alertes: { stockBas: [{id, nom, quantite}], rupture: [{id, nom}] } }`, `message: "N médicament(s) en stock"`, `success`. Le front type ce contrat dans `src/lib/api_pharmacie.ts:42-50` (`StockInfo`).
- **Consommateurs côté front** : `src/app/dashboard/stock/page.tsx:137,144` lit `stockInfo.alertes.stockBas.length` et `.rupture.length` ; `src/app/dashboard/stock/page.tsx:78` filtre `rupture` sur `quantite === 0` ; `src/lib/apercu_pharmacie.ts:73-138` (`calculerApercuStock`) RECALCULE les alertes côté client à partir de `stocks` avec ses propres seuils (`SEUIL_STOCK_BAS = 10`, `JOURS_EXPIRATION_PROCHE = 60`, lignes 5-7), utilisé par `ApercuPharmacie`, `PilotagePharmacie`, `ComptoirPharmacie` (via `getMyStock`). Le contrat de la liste `stocks` (champs `quantite`, `prixUnitaire`, `dateExpiration`) est donc consommé par le front : toute évolution en stock par lot doit conserver ces champs agrégés au niveau produit.
- **Seuil codé trois fois** (back x2, front x1) : à unifier lors du recâblage.

## 4. RBAC

### 4.1 Rôles réels

- **Enum `Role`** (`prisma/schema.prisma:13-21`) : `PATIENT`, `MEDECIN`, `PHARMACIEN`, `STRUCTURE_ADMIN`, `ADMIN`, `SUPER_ADMIN`, `ACCUEIL` = **7 valeurs**, pas six. Le mobile en liste 7 également plus `unknown` (`mobile_medconnect/lib/core/session/app_user.dart:3-11`).
- **`AppRole`** (données, `schema.prisma:46-59`) : rôles système globaux (`structureId = null`) : Patient, Administrateur plateforme, Super Administrateur ; rôles par défaut par type de structure (`DEFAULT_STRUCTURE_ROLES`, `src/common/rbac/permissions.constants.ts:248-332`) : HOPITAL/CLINIQUE : Médecin, Accueil, Administrateur de structure ; PHARMACIE : **Pharmacien, Administrateur de structure**. Un rôle personnalisé par structure est possible (`RolesService.createRole`).
- **Il n'existe PAS de rôle "vendeur" ni "caissier" ni "titulaire" distincts.** Pour une pharmacie, "le titulaire" correspond à l'Administrateur de structure et "le vendeur" au Pharmacien (ou à un rôle personnalisé). Le décompte "six rôles" de la demande n'est pas vérifié par le code (7 valeurs d'enum, 8 rôles nommés par défaut en comptant les rôles par type).

### 4.2 Permissions

- **Format** : chaîne `domaine:action` (ex. `stock:write`), catalogue en dur `PERMISSIONS` et `PERMISSION_CATALOG` (`permissions.constants.ts:11-185`), persisté dans la table `Permission` (`code` unique, `libelle`, `categorie`).
- **Pharmacie déjà déclarées** (`permissions.constants.ts:25-31`) : `stock:read`, `stock:write`, `catalogue:write`, `catalogue:manage`, `vente:read`, `vente:write`, `vente:annuler`. **Aucune** permission de caisse, de marge/coût, d'inventaire, de réception, de clôture ni de fournisseur.
- **Attribution par type de structure** : `PHARMACIEN` : stock:read, stock:write, catalogue:write, vente:read, vente:write, chat:structure, structure:read, membre:read (`permissions.constants.ts:302-311`). Admin de pharmacie : stock:read/write, vente:read/write/annuler, structure:read/write, membre:read/manage, role:manage (318-329). NB : le `CLAUDE.md` du back cite une liste plus courte pour le pharmacien ; le code fait foi.
- **Filtre selon le type de structure** (`src/common/rbac/permissions-type-structure.ts:16-66`) : liste BLANCHE pour une pharmacie (`PERMISSIONS_AUTORISEES_PHARMACIE`, 16-30) ; **toute nouvelle permission est refusée aux pharmacies tant qu'elle n'y est pas ajoutée** ; les `vente:*` sont retirées aux autres types (33-37). Appliqué dans `PermissionsService.getUserPermissions` (`permissions.service.ts:41-80`), cache Redis `perms:v3:user:<id>` 5 min (`permissions.service.ts:28-29`).
- **Synchronisation au démarrage** : `RolesService.onApplicationBootstrap` (`roles.service.ts:42-56`) : upsert du catalogue (`syncCatalog`, 58), rôles système, rôles par défaut des structures existantes, `completerRolesAdminPharmacie` (ajout seul des `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` : stock:r/w, vente:r/w/annuler, `permissions.constants.ts:338-345`), backfill utilisateurs. Un échec est avalé (l'app démarre quand même). **Important** : `RolesService` n'applique les permissions d'un rôle de structure qu'à sa création ; pour les rôles existants, une NOUVELLE permission doit être rattachée par migration SQL (précédent : `20261022120000_ventes_pharmacie` qui insère dans `Permission` et `RolePermission`) ou par une fonction de complément comme `completerRolesAdminPharmacie`.
- **Garde côté serveur** : `PermissionsGuard` (`permissions.guard.ts`) lit `@RequirePermissions` (`require-permissions.decorator.ts`, logique ET) et appelle `hasPermissions`. Donc une permission "voir la marge" est faisable côté serveur selon le mécanisme existant, mais il faudra aussi filtrer le CONTENU des réponses (pas seulement le garder), car aucun mécanisme de masquage de champs par permission n'existe dans le code actuel (les routes de vente renvoient tout ou rien).
- Front : le menu est construit à partir de `/auth/me` (`data.permissions`, `data.structureType`), registre `src/lib/navigation_tableau_de_bord.ts`, décision `vuePharmacie(ctx)` (pilotage si `structure:write` ou `vente:annuler`, sinon comptoir).

## 5. Front web (`front_medconnect`)

- **Écrans pharmacie existants** : `src/app/dashboard/stock/page.tsx` (331 lignes : liste, filtres tout/bas/rupture, ajustement, import via `components/modals/ImportStockModal.tsx`, `StockModal.tsx`) ; `src/app/dashboard/vente/page.tsx` (697 lignes, "Nouvelle vente" = point de vente web : recherche dans le stock, panier, ordonnance, client, validation) + `ConfirmationVente.tsx` + `panier.ts` ; `src/app/dashboard/ventes/page.tsx` (ventes du jour, annulation via `AnnulationVente.tsx`) ; `src/app/dashboard/ventes/[venteId]/recu/page.tsx` (reçu imprimable 58/80 mm/A4) ; `src/app/dashboard/catalogue`, `medicaments`, `pharmacies` (recherche publique) ; accueil : `components/dashboard/ApercuPharmacie.tsx`, `ComptoirPharmacie.tsx`, `PilotagePharmacie.tsx` ; page structure (pharmacie) modifiable par blocs. Alertes visibles dans `stock/page.tsx` et `ApercuPharmacie`.
- **Fichiers `lib/api_*.ts`** : `api_pharmacie.ts` (catalogue, stock, import, types `Medicament`, `StockMedicament`, `StockInfo`), `api_ventes.ts` (types `Vente`, `LigneVente`, `creerVente` avec en-tête `Idempotency-Key` ligne 100, `listerVentes`, `getVente`, `annulerVente`, codes d'erreur `CODES_ERREUR_VENTE`), `api_carnet.ts` (`nouvelleCleIdempotence` partagée), `format_gnf.ts`, `apercu_pharmacie.ts`, `ventes_tableau_de_bord.ts`, `compteurs_tableau_de_bord.ts`, `acces.ts`, `navigation_tableau_de_bord.ts`.
- **Hors ligne sur le web : INEXISTANT.**
  - `public/sw.js` = service worker MINIMAL, `fetch` vide (pass-through), purge les caches à l'activation, "NE RIEN METTRE EN CACHE ICI" (`public/sw.js:1-13, 35-40`), enregistré par `components/ServiceWorkerRegistration.tsx:14-18` uniquement pour l'installabilité.
  - `src/app/sw.ts` (serwist, NetworkFirst sur `/api`, cache 24 h) est du code MORT : `next.config.ts:1-7` a le plugin `@serwist/next` commenté, et rien ne le construit.
  - Aucune IndexedDB, aucune file d'attente, aucune synchro (grep `indexedDB` : un seul résultat sans rapport, `src/lib/api_auth.ts`).
  - La page `src/app/offline/page.tsx` annonce seulement "Pas de connexion internet" et que le carnet nécessite internet. Le backlog le note : point 24, "Hors ligne non fonctionnel" (`BACKLOG-PRIORISE.md:79`).
  - Le seul état local de la vente est le panier en `localStorage` (clé par pharmacie et utilisateur, `dashboard/vente/panier.ts:241-271`) et la clé d'idempotence par panier réutilisée en cas de renvoi : la vente web ne fonctionne PAS sans réseau (`creerVente` -> `authFetch`), elle supporte seulement un renvoi après coupure.

## 6. Mobile (`mobile_medconnect`, branche `orch/tm1-mobile`)

- **Public visé : PATIENTS uniquement.** `docs/PLAN-APPLICATION-MOBILE.md`, "Décisions du porteur (2026-10-18)", point 1 : l'application mobile est réservée aux patients (option A) ; "Les rôles de structure et d'administration restent sur le web". Code : `lib/core/session/app_user.dart:68-72`, `capabilities` ne renvoie `Capability.patientSpace` que pour `UserRole.patient` ; l'enum `Capability` n'a que cette valeur (ligne 22-26). Aucun écran ni module pharmacie/vente/stock dans `lib/` (recherche `pharmac|vente|stock` : seulement des faux positifs "stockage sécurisé").
- **Couche locale réelle** : `lib/core/storage/local_database.dart` (61 lignes) = base drift/SQLite3MultipleCiphers chiffrée, une par compte, clé aléatoire 256 bits en stockage sécurisé (`local_database_factory.dart:1-27`), avec UNE table `cache_entries(key, value, updated_at)` et trois méthodes `put/read/remove` (`local_database.dart:20-53`). Le commentaire dit : "Socle du lot TM0 : une table de cache clé-valeur ... Les tables métier typées viendront avec le lot TM2". `allTables` est vide (ligne 13). **Aucun appelant métier** de `put/read` en dehors de ce fichier (grep : seules la fabrique et `account_store` manipulent la base).
- **File d'événements, synchronisation, idempotence applicative : ABSENTES.** Grep `outbox|file d'attente|queue|sync` sans fichier pertinent. Le seul rejeu est `RetryInterceptor` (réseau, `lib/core/network/api_client.dart:35-37`, `interceptors.dart`) ; `Idempotency-Key` est un paramètre optionnel de l'appel HTTP (`api_client.dart:71-82`), "Écriture jamais rejouée" sinon (89). Le plan (section 8, `PLAN-APPLICATION-MOBILE.md:1309-1330`) décrit une mise en file future pour le profil médical et les messages du patient, "pas implémentée". Pas de numéros de ticket, pas de séquence par poste, pas de journal ordonné, pas de résolution de conflit inter postes.
- **Réutilisable pour une caisse ?** Non, pour trois raisons : (1) l'application n'est pas destinée aux rôles de pharmacie, et le porteur a décidé que les rôles de structure restent sur le web ; (2) la couche hors ligne est un cache de lecture chiffré, pas un moteur d'écriture différée ; (3) rien n'est construit pour la synchronisation (le plan prévoit "profil modifié hors ligne puis synchronisé" comme futur test). Seul le chiffrement par compte et le client HTTP avec `Idempotency-Key` sont des briques de départ, à compléter lourdement.
- Tests : 32 fichiers `*_test.dart` dans `test/` (77 fichiers Dart dans `lib/`), aucun sur pharmacie.

## 7. Tests existants sur ces zones

Back (`it(`/`test(` comptés par grep, hors `describe`) :
- `src/pharmacie/vente.service.spec.ts` : 34 ; `vente.http.spec.ts` : 6
- `src/pharmacie/pharmacie.import.spec.ts` : 21 ; `catalogue-import.spec.ts` : 15 ; `pharmacie-import-mode.http.spec.ts` : 4 ; `pharmacie.stock-quantite.spec.ts` : 4
- `src/common/rbac/permissions-type-structure.spec.ts` : 15 ; `roles.service.spec.ts` : 6
- Total pharmacie 84, RBAC 21. Aussi touchés : `demo.seeder.spec.ts`, `demo.vitrine.spec.ts`, `all-exceptions.filter.spec.ts`.
- e2e : un seul `test/app.e2e-spec.ts` (squelette), pas de test e2e de vente. Aucun test de migration. Aucun test d'alertes de stock du service `getStockPharmacie` identifié dans les noms de fichiers (à vérifier : la non-régression demandée sur les alertes n'a pas de test de référence dédié, il faudra l'écrire AVANT de recâbler).

Front (comptage `it(`/`test(`) : `dashboard/vente/page.test.tsx` 12, `vente/panier.test.ts` 37, `ventes/page.test.tsx` 13, `ventes/[venteId]/recu/page.test.tsx` 7, `stock/page.test.tsx` 2, `components/dashboard/ApercuPharmacie.test.tsx` 14, `ComptoirPharmacie.test.tsx` 8, `PilotagePharmacie.test.tsx` 7, `ImportStockModal.test.tsx` 17, `lib/apercu_pharmacie.test.ts` 9, `lib/api_pharmacie.test.ts` 8, `lib/api_ventes.test.ts` 14, `navigation_tableau_de_bord.pharmacie.test.ts` 12, `ventes_tableau_de_bord.test.ts` 5, `compteurs_tableau_de_bord.test.ts` 10 (le fichier `apercu_pharmacie.test.ts` fige les seuils d'alerte côté client).

Mobile : 32 fichiers de test, aucun sur la pharmacie.

## 8. Synthèse

### 8.1 Hypothèses de la demande confrontées au code

| Hypothèse du prompt | Verdict | Preuve |
|---|---|---|
| Backend NestJS + PostgreSQL | VRAIE | `CLAUDE.md` back ; `prisma/schema.prisma:7-9` (postgresql) |
| Un "RBAC à six rôles" en place | FAUSSE | `schema.prisma:13-21` : 7 valeurs d'enum ; 8 rôles nommés par défaut (`permissions.constants.ts:217-331`). RBAC dynamique par permissions, rôles personnalisés possibles. Pas de rôle vendeur/caissier/titulaire dédié. |
| Le front web est en Next.js | VRAIE | `front_medconnect/package.json`, `src/app/` |
| L'application Flutter existe | VRAIE | `mobile_medconnect/pubspec.yaml` |
| La gestion hors ligne Flutter est "déjà implémentée" et réutilisable (persistance locale + synchronisation) | FAUSSE | Persistance = cache clé/valeur sans appelant (`lib/core/storage/local_database.dart:5-26`) ; aucune synchronisation, aucune file ; app réservée aux patients (`PLAN-APPLICATION-MOBILE.md`, décision 1 ; `app_user.dart:68-72`). |
| La géolocalisation des pharmacies existe | VRAIE | `Structure.latitude/longitude` (`schema.prisma:159+`), `rechercherDisponibilite` avec Haversine (`pharmacie.service.ts:982-1075, 1101`), page `dashboard/map` et `dashboard/pharmacies` |
| "La mise en ligne du catalogue de médicaments" existe | PARTIELLE | Catalogue GLOBAL partagé : `Medicament` (`schema.prisma:419`), routes publiques GET (`pharmacie.controller.ts:111-128`), création/modification/suppression et import Excel par permission (`:142-231`). C'est un référentiel de noms, sans prix, sans unité ni conditionnement. Le stock de la pharmacie est une ligne séparée `StockMedicament`. |
| Des "alertes de stock" existent | PARTIELLE | Alertes stock bas / rupture (seuil fixe 10) et notifications `STOCK_ALERTE` (§3). AUCUNE alerte de péremption côté serveur, aucun horizon, aucune valorisation, aucune notion de lot. |
| Un "point de vente récemment ajouté" qui décrémente le stock à la validation | VRAIE | Lots 7/8 : `VenteController`, `VenteService`, décrément atomique (`vente.service.ts:396-405`), migration `20261022120000_ventes_pharmacie`. NB : "point de vente" au sens module de vente, pas au sens entité "PointDeVente". |
| "Il n'y a aucune gestion de caisse aujourd'hui" | VRAIE | Aucun modèle ni route de caisse, session, paiement, mode de paiement, clôture. |
| Il existe des fournisseurs | FAUSSE | Aucun modèle ni champ fournisseur. |
| Il existe des postes de caisse | FAUSSE | Aucune notion de poste ; la numérotation est par pharmacie (`CompteurVente`), pas par poste. |
| Il existe des points de vente par pharmacie (identifiant de point de vente) | FAUSSE | Pas de table `PointDeVente`. Une pharmacie = une `Structure` ; `structureId` en tient lieu. |
| Une "devise en entiers, sans décimale" est déjà respectée | VRAIE | Prix, quantités, totaux en `Int` (`schema.prisma:442,470,491-493`, migration ROUND). Mais la quantité de stock n'est pas typée en "unité minimale" (§1.4). |
| Une vente ne se bloque jamais ; le stock négatif est accepté | FAUSSE (état actuel) | Le code refuse : `STOCK_INSUFFISANT` 409 (`vente.service.ts` retraits conditionnels) et plancher 0 (`pharmacie.service.ts:449`). C'est le comportement ATTENDU de la demande, pas l'existant. |
| La vente fonctionne hors ligne | FAUSSE | Voir §5 : aucun hors ligne sur le web, mobile non concerné. `SPEC-VENTES-PHARMACIE.md` liste explicitement "vente hors connexion" en "Plus tard". |

### 8.2 Ce qui EXISTE déjà sous une autre forme

- Vente avec numérotation par pharmacie/année, idempotence 24 h, transaction, audit, annulation du jour : à étendre (session de caisse, paiements) plutôt qu'à recréer.
- Prix entiers en GNF, copie du nom et du prix sur la ligne de vente (équivaut à "prix recopié").
- Permissions de pharmacie, liste blanche par type de structure, complément au démarrage, cache Redis, `/auth/me` : le mécanisme de déclaration d'un droit "marge" existe.
- Alertes de stock bas/rupture + notifications `STOCK_ALERTE`.
- Import Excel du stock avec modes `inventaire` et `livraison` (équivalent embryonnaire d'une réception et d'un inventaire, sans trace).
- Recherche publique de disponibilité par pharmacie et géolocalisation.
- Reçu imprimable, ventes du jour, écran "Nouvelle vente" avec panier persistant localement et clé d'idempotence.
- `AuditLog` générique réutilisable pour des événements de caisse ou d'anomalie.
- Mode démo avec jeu de stocks (`src/demo/demo.donnees.ts:631-740`) et script `prisma/seed_medicaments.ts`.

### 8.3 Ce qui ENTRE EN CONFLIT avec la demande

1. **Stock = compteur mutable** (`StockMedicament.quantite`), alors que la demande l'interdit ("jamais un compteur mutable"). La migration est un changement de paradigme, pas un ajout de colonnes.
2. **Une seule ligne de stock par produit x pharmacie** (`@@unique([medicamentId, structureId])`, `schema.prisma:449`) et une seule date d'expiration : incompatible avec le stock par lot. Le front et les ventes référencent cette ligne par `stockId` (`CreerVenteDto.lignes[].stockId`, `LigneVente.stockMedicamentId`, le panier web `localStorage`).
3. **Refus dur du stock insuffisant** (409) et **refus dur du périmé** (400, sans motif ni dérogation) contre "ne jamais bloquer" et "sortie manuelle d'un lot périmé avec motif".
4. **Plancher à 0** dans l'ajustement (`pharmacie.service.ts:449`) contre le stock négatif temporaire.
5. **Annulation = mutation de la vente** (`vente.service.ts:605`), contre l'immuabilité par écriture inverse ; et suppression physique possible du stock, du catalogue et, par cascade, des ventes (super-admin, démo).
6. **Un seul prix** par ligne de stock, contre deux prix indépendants (boîte / unité). La ligne de vente stocke `quantite`/`prixUnitaire` sans unité affichée ni montant de ligne distinct du `sousTotal = prix x quantite` (la règle "montant de ligne = référence, arrondi porté par le montant" n'y est pas : le prix unitaire est le prix de référence).
7. **Numérotation unique par pharmacie sérialisée par un verrou de ligne** (`vente.service.ts:266`), contre des plages de tickets réservées par poste consommées localement ; aujourd'hui toutes les ventes d'une pharmacie passent l'une après l'autre.
8. **Alertes recalculées côté client** avec des seuils propres (`apercu_pharmacie.ts:5-7`) : le "même contrat" n'est pas un seul contrat mais deux consommateurs (liste `stocks` brute + objet `alertes`).
9. **Gardes d'accès incohérents** entre stock (`checkPharmacieAccess`, enum de rôle) et vente (`verifierPharmacie`, appartenance à la structure) : à unifier avant d'ajouter la caisse.
10. **Hors ligne** : la demande (vente, catalogue et session de caisse hors ligne) s'appuie sur un acquis mobile inexistant, et le web n'a aucun cache. Il faudra construire le mécanisme (probablement web, puisque la pharmacie est servie par le web et que le mobile est patient seul), ce qui est un chantier à part entière.
11. **Tolérance d'inventaire, anomalies, mouvements d'inventaire** : l'import "inventaire" et l'upsert écrasent la quantité sans écart ni anomalie.

### 8.4 Ce qui MANQUE complètement

Unité minimale et coefficient de conversion ; prix boîte et prix unité séparés ; produit déconditionnable ; tolérance d'inventaire ; état de conditionnement ouvert (reliquat) ; lots, numéro de lot fournisseur, FEFO ; coût d'acquisition ; fournisseurs et réceptions ; journal de mouvements de stock ; allocations de lot par ligne de vente ; ventes sans stock (allocation provisoire) ; file d'anomalies ; postes de caisse, sessions, comptages par coupure, mouvements de caisse, clôture journalière, écriture inverse ; paiements multiples et table de modes de paiement (Orange Money, MTN MoMo) ; plages de tickets par poste ; journal d'événements de synchronisation (séquence par poste, identifiant client d'événement) ; alertes de péremption à horizons ; paramètres par pharmacie (horizons, seuils, tolérance d'écart de caisse) ; droit "marge" et masquage serveur des coûts ; marge réelle et "non valorisable" ; hors ligne web (stockage local, file, rechargement de plage) ; identifiant de point de vente explicite sur mouvement, session, vente, lot (aujourd'hui seulement `structureId` sur `Vente` et `StockMedicament`) ; aucune permission de caisse, d'inventaire, de réception ni de marge ; test de non-régression des alertes existantes.

### 8.5 Hypothèses FAUSSES du prompt (récapitulatif)

1. L'application Flutter n'a PAS de gestion hors ligne réutilisable : cache clé/valeur chiffré sans appelant, aucune synchronisation, et application réservée aux patients.
2. Le RBAC n'est pas "à six rôles" : 7 valeurs d'enum, rôles par défaut nommés au nombre de 8, rôles personnalisés possibles, et aucun rôle vendeur/caissier/titulaire.
3. Il n'existe pas de fournisseurs, de postes de caisse ni de points de vente par pharmacie (une structure pharmacie tient lieu de point de vente).
4. Les "alertes de stock" ne couvrent pas la péremption ; elles sont à seuil unique fixe de 10 et recalculées à part côté front.
5. Le "catalogue mis en ligne" est un référentiel global sans prix ni conditionnement, pas un catalogue de vente par pharmacie.
6. Le point de vente "ne bloque jamais" : faux aujourd'hui (409 `STOCK_INSUFFISANT`, 400 `MEDICAMENT_EXPIRE`, plancher 0).
7. (Implicite) Le stock n'est pas un journal : c'est un compteur mutable sans historique.

### 8.6 Risques de migration

- **Volumes** : inconnus de mon côté (aucun accès base de production, aucune lecture de données). La table `StockMedicament` a un faible volume attendu (produits x pharmacies) ; `Vente`/`LigneVente` existent depuis le 2026-10-22 seulement, donc volume probablement faible et beaucoup de données de démonstration. Les nouvelles tables à fort volume (mouvements, allocations, paiements) seront créées vides : le risque de réécriture lourde est limité, ce qui est favorable à l'ajout de `pointDeVenteId` non nul dès le départ. À faire confirmer par un comptage en lecture seule avant le plan.
- **Nullabilité** : `StockMedicament.prixUnitaire` est nullable (`:442`) ; `dateExpiration` nullable ; ces valeurs devront alimenter un lot technique (péremption nulle, coût nul ou inconnu). Le coût d'acquisition n'existe pas : "dernier coût connu" = toujours nul, donc tous les lots techniques seront non valorisables (rapports de marge vides jusqu'aux premières réceptions réelles). Les prix uniques existants devront être répartis soit en prix boîte soit en prix unité : la demande suppose coefficient 1 et prix unité vide, ce qui fait du prix existant le prix boîte avec produit non déconditionnable (cohérent).
- **Unité d'un stock existant inconnue** : les quantités actuelles peuvent être des boîtes, des plaquettes ou des unités selon la pharmacie ; l'import Excel n'impose aucune unité. Le coefficient par défaut 1 laisse les chiffres inchangés mais la signification métier est ambiguë jusqu'à qualification par produit. Les données de démonstration (ex. Doliprane `quantite: 240`, `prixUnitaire: 15000`, `demo.donnees.ts:645-650`) sont par boîte de fait.
- **Références sans clé étrangère** : `LigneVente.stockMedicamentId` et `medicamentId`, `Vente.vendeurId`, `annuleeParId` n'ont pas de FK (décision D109 du lot 7). Si la ligne `StockMedicament` est remplacée par des lots, ces identifiants resteront valides en lecture mais pointeront vers une ligne qui n'existe plus ou qui change de sens ; les ventes historiques "ne sont pas réécrites" donc il faut conserver la table `StockMedicament` (ou une vue) au moins en lecture seule, et la colonne `quantite` figée une version avec la commande de comparaison demandée.
- **Contrat d'API figé côté client** : `POST /ventes` prend `stockId` (identifiant de la ligne de stock) ; le panier web mémorisé en `localStorage` (version 1, `panier.ts:271`) et le front référencent ce `stockId`. Un changement de sémantique (lot vs produit) invalide les paniers en cours et la clé d'idempotence ; prévoir une version de format.
- **Point de vente non nul** : le remplissage est déterministe (`structureId` -> point de vente unique), donc pas de ligne indéterminée attendue pour `StockMedicament` et `Vente`. Cas à contrôler : `Vente.vendeurId` sans FK, `Structure.type` non PHARMACIE avec stock résiduel (le stock est limité aux pharmacies par le code, pas par une contrainte base).
- **Cascades destructrices** (`Structure` -> `Vente`, `StockMedicament` -> rien côté vente) : à revoir avant d'introduire des tables comptables immuables (une suppression de structure détruirait des sessions de caisse et clôtures).
- **Seed et démo** : `prisma/seed_medicaments.ts:115` et `src/demo/demo.seeder.ts:417` écrivent `StockMedicament` directement (quantité absolue). Après la bascule, ils devront créer lots et mouvements d'entrée, sinon le stock calculé des comptes démo vaut zéro. Le mode démo purge physiquement (`DEMO_RESET`, `demo.seeder.ts:193`).
- **Migrations idempotentes et permissions** : les nouvelles permissions doivent être ajoutées à la liste blanche pharmacie (`permissions-type-structure.ts:16-30`) ET rattachées aux rôles existants par migration SQL ou fonction de complément au démarrage (`RolesService` ne rattache qu'à la création). Oubli = fonction invisible pour les pharmacies existantes. Le cache `perms:v3` devra être incrémenté (précédent D112).
- **Concurrence** : le verrou de numérotation par pharmacie (`CompteurVente`) deviendrait un goulot si les ventes hors ligne rejouées arrivent en rafale ; le remplacer par des plages par poste évite ce verrou mais le rejeu doit rester idempotent sur un identifiant d'événement.
- **Rétro-compat de l'alerte `STOCK_ALERTE`** : les notifications existantes sont des messages texte ("Le stock de X est bas (N unités)") ; passer à un stock par lot change le sens de "N unités" (unité minimale). Contrat `alertes.stockBas[].quantite` : à conserver en agrégat par produit, avec une règle explicite sur l'unité du seuil 10 (10 comprimés n'est pas 10 boîtes).
- **Tests de migration inexistants** : aucun harnais ne charge une base au format actuel ; le seul précédent de migration avec reprise de données est `20261022120000_ventes_pharmacie` (SQL manuel). Il faudra créer le harnais.

## 9. Sources consultées (lecture seule)

`DEMANDE.md` (run pharmacie-t1), `SPEC-VENTES-PHARMACIE.md`, `BACKLOG-PRIORISE.md`, `JOURNAL-ORCHESTRATION.md`, `mobile_medconnect/docs/PLAN-APPLICATION-MOBILE.md`, `CLAUDE.md` racine/back, `back_medconnect/docs/plans/runs/2026-10-22-lot7/decisions.md` (D107 à D128), `front_medconnect/docs/plans/runs/2026-10-22-lot9/decisions.md` (D05 à D24), code cité ci-dessus. Aucune valeur de `.env` ni secret lu ni reproduit.
