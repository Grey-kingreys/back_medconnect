# Inventaire B, module pharmacie (Étape 0, lecture seule)

Inventoriste B (Sonnet). Aucune modification de code, aucun commit, aucune migration, aucun appel en base. Branches lues : back `orch/pharmacie-t1-back`, front `orch/pharmacie-t1-front`, mobile `orch/tm1-mobile`. Chemins relatifs à `back_medconnect/` (back), `front_medconnect/` (front), `mobile_medconnect/` (mobile) sauf mention. Aucune valeur de .env lue ni reproduite.

## 0. Réponse courte aux deux points décisifs

1. **Stock : compteur mutable.** `StockMedicament.quantite Int @default(0)` (prisma/schema.prisma:441) est décrémenté par `updateMany ... data: { quantite: { decrement } }` (src/pharmacie/vente.service.ts:396-402), incrémenté à l'annulation (vente.service.ts:625-628), écrasé ou incrémenté à l'import (pharmacie.service.ts:645-676), écrasé par `upsertStock` (pharmacie.service.ts:381-399) et ajusté par `updateStockQuantite` (pharmacie.service.ts:451-458). Il n'existe AUCUN modèle de mouvement, de lot, de journal ni d'inventaire (liste complète des modèles : schema.prisma lignes 13-705, aucun nom ressemblant).
2. **La couche hors ligne du mobile n'est pas réutilisable pour une caisse.** L'application Flutter est réservée aux patients (mobile CLAUDE.md:3-5, `lib/app/router/routes.dart:65-66`) et sa "couche hors ligne" est un cache clé-valeur (`cache_entries`) sans file d'événements, sans synchronisation, sans idempotence (lib/core/storage/local_database.dart:12-38). Détail en section 6.

## 1. Modèle de données pharmacie

### 1.1 Modèles Prisma concernés (prisma/schema.prisma)

| Modèle | Lignes | Contenu |
|---|---|---|
| `Medicament` | 419-432 | Catalogue GLOBAL, partagé entre pharmacies : `nom`, `nomGenerique?`, `categorie`, `description?`, `ordonnanceRequise Boolean`, `formes String[]` (texte libre : "comprimé", "sirop"). Aucune unité minimale, aucun coefficient de conditionnement, aucun prix. |
| `StockMedicament` | 434-450 | Une ligne par (médicament, pharmacie) : `quantite Int`, `prixUnitaire Int?` (GNF), `disponible Boolean`, `dateExpiration DateTime?`, `notes?`, `updatedAt`. `@@unique([medicamentId, structureId])` (l.449). FK vers `Medicament` et `Structure`, tous deux `onDelete: Cascade`. Aucun index secondaire en plus de l'unicité. |
| `Vente` | 460-482 | `structureId`, `numero String` (V-AAAA-NNNNNN), `vendeurId`, `vendeurNom` (copie), `clientNom?`, `clientTelephone?`, `ordonnanceVerifiee`, `total Int`, `statut StatutVente` (VALIDEE, ANNULEE), `annuleeLe?`, `annuleeParId?`, `motifAnnulation?`, `cleIdempotence?`, `createdAt`. Uniques : `[structureId, numero]`, `[structureId, cleIdempotence]`. Index : `[structureId, createdAt]`. FK Structure en `Cascade`. |
| `LigneVente` | 484-497 | `venteId` (Cascade), `medicamentId`, `stockMedicamentId` (SANS FK, décision D109), `nomMedicament` (copie), `prixUnitaire Int` (copie), `quantite Int`, `sousTotal Int`. Index `[venteId]`. |
| `CompteurVente` | 499-508 | PK composite `[structureId, annee]`, `dernierNumero Int`. |
| `Structure` | 159-220 | Une pharmacie EST une `Structure` de `type = PHARMACIE` (enum `StructureType` HOPITAL, CLINIQUE, PHARMACIE, l.23-27). Relations `medicaments StockMedicament[]`, `ventes`, `compteursVente`. |
| `Permission`, `AppRole`, `RolePermission` | 37-67 | RBAC dynamique (section 4). |
| `AuditLog` | 355-371 | `userId?`, `action`, `entityType`, `entityId`, `ip?`, `metadata Json?`, `createdAt`. Utilisé par les ventes (create, annuler). |
| `Notification` | 682-696 | Support des alertes `STOCK_ALERTE`. |

**Modèles qui n'existent pas** : `StockLot`, `StockMovement`, `SaleLineLotAllocation`, `Payment`, `ModePaiement`, `CashSession`, `CashCount`, `CashMovement`, `DailyClosure`, `OpenCartonState`, `Fournisseur`, `PointDeVente`, `PosteCaisse`, `Inventaire`, `Anomalie`, coût d'achat. Vérifié par `grep "^model \|^enum "` (liste complète : Permission, AppRole, RolePermission, User, Structure, ProfilMedical, Consultation, Ordonnance, ResultatAnalyse, Vaccination, AuditLog, RendezVous, AutoDiagnostic, Medicament, StockMedicament, Vente, LigneVente, CompteurVente, AutorisationStructure, Conversation, Message, Urgence, StoredFile, Notification, Session).

### 1.2 Migrations concernées

Liste : prisma/migrations (init 20260425202451, 20260426144501, 20260628161425_sync_schema_complet, 20260628170000_add_rbac_permissions, 20260704_add_soft_delete_audit_trail, 20260723_add_stored_file, 20260724_add_r2_entity_links, 20260725_add_accueil_role, 20260725_rdv_validation, 20261006120000_urgence_prise_en_charge, 20261020143041_tb3_sessions, 20261021120000_tb17_telephone_unique, 20261021150000_tb10b_sos_position_idempotence, **20261022120000_ventes_pharmacie**).

Seule `20261022120000_ventes_pharmacie/migration.sql` touche la zone récente : crée `StatutVente`, `Vente`, `LigneVente`, `CompteurVente`, convertit `StockMedicament.prixUnitaire` de Float en `INTEGER USING ROUND(...)` (l.8), insère les permissions `vente:*` et les rattache aux rôles existants des pharmacies (l.67-85). `StockMedicament` et `Medicament` viennent des migrations init / sync_schema_complet (non relues en détail, la forme actuelle est dans schema.prisma).

### 1.3 Comment le stock est tenu AUJOURD'HUI

**Compteur mutable, sans journal.** Preuves de chaque écriture sur `quantite` :
- Vente : décrément conditionnel `quantite >= demandée` (vente.service.ts:396-402), puis `disponible=false` si 0 (l.426-429).
- Annulation : incrément (vente.service.ts:625-628), `disponible: true`.
- `upsertStock` (POST stock) : ÉCRASE la quantité (pharmacie.service.ts:381-399).
- `updateStockQuantite` (PATCH quantite) : `SELECT ... FOR UPDATE` puis `quantite = max(0, ancienne + variation)` (pharmacie.service.ts:443-458), plancher 0.
- Import Excel : mode `inventaire` écrase, mode `livraison` incrémente (pharmacie.service.ts:652-676).
- Aucune de ces écritures sur le stock (hors vente) n'écrit d'`AuditLog` (grep `auditLog` dans pharmacie.service.ts : aucun résultat). Seule la vente écrit un audit (vente.service.ts:438-449 et 603-616).

Conséquences : aucun historique de mouvements, impossible de reconstruire le stock à une date, un ajustement manuel n'est pas tracé, le plancher à 0 de `updateStockQuantite` perd silencieusement de l'information.

### 1.4 Dates d'expiration

Une seule `dateExpiration DateTime?` par ligne de stock, donc par (médicament, pharmacie) (schema.prisma:444). Pas de notion de lot. En mode `livraison`, une nouvelle livraison ÉCRASE la date existante si une date est fournie (pharmacie.service.ts:666, `dateExpiration: date`), ce qui perd la date du stock déjà présent.

### 1.5 Prix et coût

- Prix de vente : `StockMedicament.prixUnitaire Int?` en GNF (schema.prisma:442), donc porté par la pharmacie, pas par le produit global. Un seul prix, c'est le prix "de l'unité de stock" (boîte ou autre, non défini). Entier depuis la migration du lot 7.
- Ligne de vente : `prixUnitaire Int` et `sousTotal Int` (copie), `sousTotal = prixUnitaire * quantite` (vente.service.ts:329-345 environ). Pas d'arrondi nécessaire aujourd'hui car tout est entier.
- `quantite` : `Int` partout en base ; mais `UpsertStockDto.quantite` est `@IsNumber() @Min(0)` et NON `@IsInt` (src/pharmacie/dto/pharmacie.dto.ts:97-100), donc un décimal passe la validation DTO et échoue en base (risque, à corriger dans la tranche).
- **Coût d'achat : n'existe pas** (aucune colonne de coût dans `StockMedicament`, `Medicament`, `LigneVente`). Le "dernier coût connu" que la demande veut reprendre à la migration n'existe donc nulle part : tous les lots techniques auraient un coût nul.
- Plafond : `PRIX_MAX = 2147483647` (vente.service.ts:25), total au-delà refusé en 400 `VALIDATION` / `totalMaximal`.

## 2. Endpoints

Tous sous le préfixe `/pharmacie`. Deux contrôleurs : `src/pharmacie/pharmacie.controller.ts` (catalogue, stock, imports) et `src/pharmacie/vente.controller.ts` (ventes). Gardes `AuthGuard` + `PermissionsGuard` ; `@RequirePermissions(a, b)` exige TOUTES les permissions listées (`required.every`, src/common/rbac/permissions.service.ts:90-95).

### 2.1 Catalogue, recherche (pharmacie.controller.ts)

| Méthode, chemin | Ligne | Garde / permission | Notes |
|---|---|---|---|
| GET `/pharmacie/rechercher` | 84 | PUBLIC (aucune garde) | Disponibilité d'un médicament dans les pharmacies actives et configurées, filtre `disponible: true, quantite > 0` (pharmacie.service.ts:982-1000). Expose prix et dateExpiration du stock. |
| GET `/pharmacie/catalogue` | 111 | PUBLIC | Liste du catalogue global. |
| GET `/pharmacie/catalogue/categories` | 122 | PUBLIC | |
| GET `/pharmacie/catalogue/:medicamentId` | 128 | PUBLIC | Détail + pharmacies où il est disponible. |
| POST `/pharmacie/catalogue` | 142 | `catalogue:write` | Crée un médicament (global). |
| GET `/pharmacie/catalogue/import/modele` | 154 | `catalogue:write` | Modèle Excel. |
| POST `/pharmacie/catalogue/import/apercu` | 173 | `catalogue:write` | Aperçu import. |
| POST `/pharmacie/catalogue/import` | 190 | `catalogue:write` | Import catalogue. |
| PATCH `/pharmacie/catalogue/:medicamentId` | 213 | `catalogue:manage` | Modifie un médicament global. |
| DELETE `/pharmacie/catalogue/:medicamentId` | 231 | `catalogue:manage` | **Suppression physique** du médicament (pharmacie.service.ts:305), qui CASCADE sur toutes les lignes `StockMedicament` de toutes les pharmacies (schema.prisma:437). Les `LigneVente` survivent (pas de FK), mais le stock disparaît. |

DTO : `CreateMedicamentDto`, `UpdateMedicamentDto` (dto/pharmacie.dto.ts:19-86).

### 2.2 Stock (pharmacie.controller.ts)

| Méthode, chemin | Ligne | Permissions | Règle |
|---|---|---|---|
| GET `/pharmacie/stock/:structureId` | 249 | `stock:read` ET `stock:write` | Liste + alertes (section 3). |
| POST `/pharmacie/stock/:structureId` | 266 | idem | `upsertStock` : écrase quantité, prix, date, notes (pharmacie.service.ts:361-428). Alerte si `quantite < 10`. |
| PATCH `/pharmacie/stock/:structureId/:stockId/quantite` | 284 | idem | Variation signée `variation` (`@IsInt`) + `notes`, verrou de ligne, plancher 0. |
| DELETE `/pharmacie/stock/:structureId/:stockId` | 309 | idem | **Suppression physique** d'une ligne de stock (pharmacie.service.ts:542), sans audit. |
| GET `/pharmacie/stock/:structureId/import/modele` | 330 | idem | Modèle Excel. |
| POST `/pharmacie/stock/:structureId/import/apercu` | 355 | idem | Aperçu. |
| POST `/pharmacie/stock/:structureId/import` | 383 | idem | Import ; option `mode` `inventaire` (défaut) ou `livraison` (`OptionsImportStockDto`, dto/pharmacie.dto.ts:149-158). Transaction (OPTIONS_TRANSACTION_IMPORT), une alerte groupée. Limite fichier 2 Mo contrôlée par le service, plafond mémoire 10 Mo (pharmacie.controller.ts:71). |

Observation de garde : en plus du `PermissionsGuard`, le service applique `checkPharmacieAccess` (pharmacie.service.ts:1077-1097) qui exige `user.role` égal à `STRUCTURE_ADMIN` ou `PHARMACIEN` (enum, pas la permission) ET `user.structureId === structureId`. Donc un rôle personnalisé de pharmacie (AppRole) avec `stock:*` mais dont l'enum `role` est ACCUEIL, par exemple, est refusé. À l'inverse, `VenteService.verifierPharmacie` (vente.service.ts:75-98) accepte tout membre de la pharmacie ou son administrateur (`Structure.adminId`) sans regarder l'enum. Les deux contrôles d'accès ne sont pas alignés.

### 2.3 Ventes (vente.controller.ts, gardes de classe l.38)

| Méthode, chemin | Ligne | Permission | Règle |
|---|---|---|---|
| POST `/pharmacie/:structureId/ventes` | 42 | `vente:write` | Création (201). |
| GET `/pharmacie/:structureId/ventes` | 93 | `vente:read` | Liste du jour, `?date=AAAA-MM-JJ&page=`, 50 par page. |
| GET `/pharmacie/:structureId/ventes/:venteId` | 110 | `vente:read` | Détail. |
| POST `/pharmacie/:structureId/ventes/:venteId/annuler` | 132 | `vente:annuler` | Annulation. |

DTO : `CreerVenteDto` (lignes `{stockId, quantite}` 1..50, quantite 1..10000, clientNom, clientTelephone, ordonnanceVerifiee), `AnnulerVenteDto` (motif 3 à 300), `ListerVentesQueryDto` (dto/vente.dto.ts).

Règles métier codées dans la transaction de création (vente.service.ts:167-250 pour l'orchestration, 252-452 pour `enregistrerVente`) :
- **Transaction unique** (`$transaction`, OPTIONS_TRANSACTION_VENTE maxWait 5 s, timeout 15 s, l.29 et l.219-221).
- **Numérotation** `V-AAAA-NNNNNN` par `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` sur `CompteurVente` (l.266), ce qui verrouille la ligne et sérialise toutes les ventes d'une pharmacie. Année UTC. Un refus annule la transaction donc consomme aucun numéro.
- **Idempotence** : en-tête facultatif `Idempotency-Key` (8 à 128 car.), unicité `[structureId, cleIdempotence]`, fenêtre 24 h (`SOS_IDEMPOTENCE_HEURES`, l.203), rejeu renvoie la vente avec `data.rejeu: true`, conflit d'unicité simultané résolu à l'enregistrement (l.223-235). Fonctions réutilisées de `src/carnet-sante/sos-idempotence`.
- **Refus d'un médicament périmé** : `dateExpiration` avant le jour courant UTC, le jour même reste vendable (l.292-300), 400 `MEDICAMENT_EXPIRE`. Pas de choix de lot possible.
- **Prix manquant** : `prixUnitaire` null ou <= 0 refusé (l.316), 400 `PRIX_MANQUANT`.
- **Ordonnance** : si `Medicament.ordonnanceRequise` et `ordonnanceVerifiee !== true`, 400 `ORDONNANCE_NON_CONFIRMEE` (l.334-349). Simple case à cocher, aucune pièce rattachée.
- **Stock insuffisant** : décrément conditionnel ligne par ligne dans l'ordre des `stockMedicamentId` (anti interblocage), 409 `STOCK_INSUFFISANT` (l.380-424). **Le stock négatif est donc IMPOSSIBLE aujourd'hui** (conflit avec l'exigence "vente jamais bloquée par le stock").
- **Audit** `create` dans la transaction (l.438-449), metadata sans client.
- **Alerte stock bas** : après la transaction, par franchissement du seuil 10 (l.431-436, 469-494), ne fait jamais échouer la vente.
- Pas de remise ni de prix modifié ; prix toujours lu du stock.
- **Pas de réservation de stock.**
- Pas d'unité "boîte vs unité" : la quantité vendue est "des unités du stock", non qualifiée.

Annulation (vente.service.ts:572-648) : réservée à `vente:annuler` (administrateur de pharmacie par défaut), uniquement une vente VALIDEE du MÊME JOUR UTC, motif obligatoire, passage de statut conditionnel (`updateMany where statut VALIDEE`), remet les quantités par incrément (ligne de stock supprimée entre temps : non remise, signalé dans le message), audit `annuler`.

### 2.4 Endpoints qui modifient ou suppriment une vente, une ligne de vente ou une délivrance (conflit avec l'immuabilité)

1. **POST `.../ventes/:venteId/annuler`** (vente.controller.ts:132) : MUTE la ligne `Vente` en place (`statut`, `annuleeLe`, `annuleeParId`, `motifAnnulation`, vente.service.ts:597-607) et remet le stock en place. C'est une annulation par modification d'état, pas une écriture inverse qui pointe la pièce d'origine. Conflit direct avec "une vente validée ne se modifie pas, elle se corrige par écriture inverse". Elle reste sans suppression et tracée dans `AuditLog`, donc c'est le point de départ naturel d'une migration vers l'écriture inverse.
2. **Aucun PATCH, PUT ou DELETE de vente ni de ligne de vente n'existe** (grep des décorateurs dans vente.controller.ts : seulement Post, Get, Get, Post).
3. **Chemins indirects de destruction** :
   - `DELETE /super-admin/structures/...` : `tx.structure.delete` (src/super-admin/super-admin.service.ts:454) ; `Vente.structure` est `onDelete: Cascade` (schema.prisma, relation de `Vente`), donc la suppression d'une structure supprime physiquement toutes ses ventes et lignes (via cascade `LigneVente.vente`). Décision D110 : voulu pour la purge démo, mais incompatible avec une exigence d'immuabilité réelle.
   - Purge du mode démo (`DEMO_RESET`, src/demo/demo.seeder.ts:193) : `structure.deleteMany`, même cascade, données fictives.
   - `DELETE /pharmacie/stock/:structureId/:stockId` et `DELETE /pharmacie/catalogue/:medicamentId` ne touchent pas aux ventes (pas de FK), mais cassent la remise en stock à l'annulation (ligne non remise).
4. **"Délivrance"** : il n'existe aucun objet "délivrance" distinct de la vente. Les ordonnances (module carnet-sante) ne sont pas liées aux ventes (spec ventes, décision 1 : "pas de lien patient pour l'instant"). Hypothèse du prompt sur une délivrance : SANS OBJET dans le code.
5. **Session de caisse clôturée** : n'existe pas, donc rien à protéger encore.

### 2.5 Import Excel

Module `src/pharmacie/import-excel.ts` (234 lignes), services `pharmacie.service.ts` (stock) et `catalogue-import.service.ts` (434 lignes, catalogue). Colonnes reconnues par synonymes (CLAUDE.md back, section "Imports Excel") ; stock : colonnes obligatoires Médicament et Quantité ; catalogue : Nom et Catégorie. Le modèle d'import stock a une colonne "Date d'expiration" unique (pharmacie.service.ts:566) : l'import porte donc aussi la limitation d'une seule date par produit.

## 3. Alertes de stock

- **Alerte "notification"** : type `STOCK_ALERTE` envoyée via `NotificationsService.createManyNotifications` aux utilisateurs de la structure de rôle enum `PHARMACIEN` ou `STRUCTURE_ADMIN` (pharmacie.service.ts:410-424, 466-483, 694-716 ; vente.service.ts:469-494). Seuil codé en dur : **10 unités**, constantes `SEUIL_STOCK_BAS = 10` en doublon (pharmacie.service.ts:35 et vente.service.ts:27), plus un `10` littéral dans `upsertStock` (l.411) et `updateStockQuantite` (l.463). Non paramétrable par pharmacie ni par produit.
- **Alertes dans la réponse du stock** : `GET /pharmacie/stock/:structureId` renvoie `data: { stocks, alertes: { stockBas: [{id, nom, quantite}], rupture: [{id, nom}] } }` (pharmacie.service.ts:489-527). `stockBas` = `0 < quantite < 10`, `rupture` = `quantite === 0`. C'est le contrat client à préserver.
- **Péremption côté serveur : AUCUNE alerte.** Aucun calcul d'horizon (90/30/7 jours) côté back.
- **Péremption côté front** : calculée côté client dans `front_medconnect/src/lib/apercu_pharmacie.ts` : `SEUIL_STOCK_BAS = 10` (l.5), `JOURS_EXPIRATION_PROCHE = 60` (l.7), catégories `perime`, `rupture`, `stockBas`, `expireBientot` ; valeur du stock = quantité x prix de vente (l.30). Par ligne de stock (donc par produit, pas par lot). Horizon unique 60 jours, non paramétrable.
- **Consommateurs front** : `src/app/dashboard/stock/page.tsx:137,144` (compteurs `alertes.stockBas.length` et `alertes.rupture.length`) ; `src/components/dashboard/ApercuPharmacie.tsx` (aperçu, via `calculerApercuStock`) ; `src/components/NotificationBell.tsx:33,46` et `src/lib/api_notifications.ts:14` (type STOCK_ALERTE) ; type `StockInfo` dans `src/lib/api_pharmacie.ts:42-49`.
- **Valorisation au coût d'acquisition** : impossible (pas de coût). Le front valorise au prix de vente.

## 4. RBAC

- **Rôles (enum `Role`, schema.prisma:13-21)** : PATIENT, MEDECIN, PHARMACIEN, STRUCTURE_ADMIN, ADMIN, SUPER_ADMIN, ACCUEIL = **SEPT valeurs, pas six** (ACCUEIL ajouté par la migration 20260725_add_accueil_role). Le commentaire du schéma dit que `AppRole` coexiste avec l'enum en "transition" (schema.prisma:34-35).
- **Rôles dynamiques** : `AppRole` (nom, `isSystem`, `structureId` nullable, `@@unique([structureId, nom])`, schema.prisma:46-59). Rôles système : "Patient", "Administrateur plateforme", "Super Administrateur" (src/common/rbac/permissions.constants.ts, `SYSTEM_ROLES`). Rôles par défaut d'une pharmacie (`DEFAULT_STRUCTURE_ROLES.PHARMACIE`) : "Pharmacien" (`stock:read/write`, `catalogue:write`, `vente:read/write`, `chat:structure`, `structure:read`, `membre:read`) et "Administrateur de structure" (`stock:read/write`, `vente:read/write/annuler`, `structure:read/write`, `membre:read/manage`, `role:manage`). Il n'y a pas de rôle "vendeur" ni "caissier" ni "titulaire" distinct : l'administrateur de structure joue le titulaire.
- **Format** : chaîne `ressource:action` (`stock:read`, `vente:annuler`...). Déclaration : constante `PERMISSIONS` (permissions.constants.ts:11-49) + tableau `PERMISSION_CATALOG` avec libellé et catégorie.
- **Synchronisation au démarrage** : `RolesService.onApplicationBootstrap` (src/common/rbac/roles.service.ts:42-55) : `syncCatalog` (upsert des permissions), `seedSystemRoles` (Super Admin resynchronisé en entier), `seedExistingStructures`, `completerRolesAdminPharmacie` (ajout seul au rôle "Administrateur de structure" des pharmacies de `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE`), `backfillUsers`. Piège connu : les permissions d'un rôle de structure existant ne sont appliquées qu'à la création du rôle (commentaire de la migration ventes, l.66), d'où des migrations SQL qui rattachent les nouvelles permissions. Toute nouvelle permission pharmacie exige donc : constante, catalogue, liste blanche, rôles par défaut ET migration ou étape de complétion.
- **Filtre par type de structure** : src/common/rbac/permissions-type-structure.ts. PHARMACIE : liste blanche `PERMISSIONS_AUTORISEES_PHARMACIE` (stock, catalogue, vente x3, structure, membre, role, chat). Autres types : les `vente:*` sont retirées. **Toute nouvelle permission (marge, caisse, clôture, inventaire) est refusée aux pharmacies tant qu'elle n'est pas ajoutée à cette liste blanche** et il faut aussi la rendre inaccessible aux autres types si elle est réservée aux pharmacies (`PERMISSIONS_RESERVEES_PHARMACIE`).
- **Vérification serveur** : `PermissionsGuard` (src/common/rbac/permissions.guard.ts) avec `@RequirePermissions`, résolution à chaque requête par `PermissionsService.getUserPermissions` (cache Redis `perms:v3:user:<id>`, TTL 300 s, repli base si Redis indisponible), jamais portée par le JWT. Un changement de rôle prend effet après au plus 5 minutes ou à l'invalidation explicite.
- **Cloisonnement des données de coût** : rien n'existe. Aucune permission de "marge" ni "coût". La seule distinction aujourd'hui est la présence de `vente:annuler`.
- **Point d'attention** : le contrôle d'appartenance (membre de la pharmacie) est fait dans les services, pas dans le guard, avec deux implémentations divergentes (voir 2.2).

## 5. Front web (front_medconnect, branche orch/pharmacie-t1-front)

Écrans pharmacie existants :
- Stock : `src/app/dashboard/stock/page.tsx` (+ `StockModal.tsx`, `ImportStockModal.tsx` dans src/components/modals/), filtres tous, bas, rupture (page.tsx:39,78), compteurs d'alertes (l.137,144).
- Comptoir / nouvelle vente : `src/app/dashboard/vente/page.tsx` (+ `ConfirmationVente.tsx`, `panier.ts`). Charge TOUT le stock via `getMyStock` (page.tsx:10,94) puis filtre côté client (recherche locale). Panier persisté en `localStorage` (panier.ts:241,269,271) avec version 1 ; clé d'idempotence créée une fois par panier (`cleIdempotence`, panier.ts:26).
- Ventes du jour : `src/app/dashboard/ventes/page.tsx` (+ `AnnulationVente.tsx`).
- Reçu : `src/app/dashboard/ventes/[venteId]/recu/page.tsx`.
- Import : `ImportStockModal`, entrée de menu "importer-stock" (`src/lib/navigation_tableau_de_bord.ts:538-545`).
- Catalogue : `src/app/dashboard/catalogue/page.tsx` ; recherche publique : `src/app/catalogue`, `src/app/dashboard/pharmacies`.
- Accueil pharmacie : `src/components/dashboard/ApercuPharmacie.tsx` (424 lignes, aperçu stock), `ComptoirPharmacie.tsx` (202), `PilotagePharmacie.tsx` (258), `src/app/dashboard/structure/MaPharmacie.tsx`.
- Menu : entrées "vente" (`vente:write`, nav.ts:361-366), "ventes" (`vente:read`, l.375-380), "stock" (`stock:read` + `stock:write`, l.417), le tout réservé au type PHARMACIE.

Fichiers `lib/api_*.ts` concernés : `api_pharmacie.ts` (types `Medicament`, `StockMedicament`, `StockInfo`, fonctions catalogue, stock, import), `api_ventes.ts` (`creerVente`, `listerVentes`, `getVente`, `annulerVente`, codes d'erreur), plus `apercu_pharmacie.ts`, `ventes_tableau_de_bord.ts`, `format_gnf.ts`, `compteurs_tableau_de_bord.ts`.

**Hors ligne sur le web : AUCUN fonctionnement réel.**
- `public/sw.js` : service worker minimal, "installabilité uniquement, aucun cache", `fetch` en pass-through (sw.js:1-40). Il purge même les caches à l'activation.
- `src/app/sw.ts` (serwist, NetworkFirst sur `/api`) existe mais n'est PAS branché : `next.config.ts` a l'init serwist en commentaire (ligne 1, `/* import withSerwistInit ...`). Le backlog le confirme : point 24 de BACKLOG-PRIORISE.md:79 "Hors ligne non fonctionnel".
- `src/components/ServiceWorkerRegistration.tsx` n'enregistre que `/sw.js`.
- Page `/offline` (src/app/offline/page.tsx) : message "Pas de connexion internet ... Rien n'a été perdu".
- Aucun IndexedDB, dexie, idb ni file d'attente (grep `indexedDB|IndexedDB|idb|localforage|dexie` dans src : aucun résultat).
- Le seul stockage local de la vente est le panier en `localStorage`. L'envoi (`creerVente`) est en ligne uniquement ; en cas d'échec, la clé d'idempotence est réutilisée à la relance, mais il n'y a pas de file persistante ni de numéro de ticket local.
- Conséquence : le rechercher produit "local en moins de 150 ms" est vrai aujourd'hui seulement parce que tout le stock est chargé en mémoire dans la page (donc pas de réseau par frappe), mais le catalogue n'est pas disponible hors ligne si la page n'a pas été chargée.

## 6. Mobile (mobile_medconnect, branche orch/tm1-mobile)

- **Public visé : PATIENT uniquement**, par décision du porteur du 2026-10-18 (docs/PLAN-APPLICATION-MOBILE.md, "Décisions du porteur", point 1 ; mobile CLAUDE.md:3-5 : "Les rôles de structure et d'administration restent sur le web : un compte professionnel voit l'écran C17"). Le routeur refuse les comptes sans capacité `patientSpace` (lib/app/router/routes.dart:65-66 ; `lib/core/session/app_user.dart:71` n'accorde `patientSpace` qu'au rôle patient). Le plan classe le pharmacien en "web / Plus tard (J4)" (PLAN-APPLICATION-MOBILE.md, tableau l.424 et FONCTIONNALITES-MOBILE.md:49). **Aucun code pharmacie ou vente dans lib/** (grep `pharmac|vente|stock` : seuls des faux positifs dans la sécurité et la session).
- **Couche hors ligne réelle** (TM0 / TM1) :
  - Stockage : Drift sur `sqlite3` avec SQLite3MultipleCiphers (pubspec.yaml:24-25 et `hooks.user_defines.sqlite3.source: sqlite3mc`), une base chiffrée par compte, clé aléatoire 256 bits en `flutter_secure_storage` (lib/core/storage/local_database_factory.dart:1-25).
  - Schéma : UNE table `cache_entries(key, value, updated_at)` (lib/core/storage/local_database.dart:21-27), API `put`, `read`, `remove`. Le fichier le dit : "les tables métier typées viendront avec le lot TM2". `allTables` est vide (l.15), `schemaVersion` 1.
  - **Pas de file d'événements, pas de synchronisation, pas d'idempotence, pas de numéro de séquence ni d'identifiant de poste** : grep de `outbox|queue|sync|offline` ne ramène que des usages de connectivité et de sécurité. `LocalDatabase` n'est consommée que par la fabrique et le `account_store` (lib/core/session/account_store.dart:73-78,200), pas par des fonctionnalités.
  - Connexion hors ligne par vérificateur local à dérivation lente (`lib/core/security/password_verifier.dart`), décision porteur point 8.
  - Tests : test/core/storage (account_isolation_test.dart 3 tests, local_database_test.dart 8 tests) ; 115 fichiers .dart dans lib et test.
- **Réutilisable pour une caisse ?** Partiellement et seulement comme fondation technique : le chiffrement par compte (SQLCipher-like) et le principe de base locale sont réutilisables. TOUT le reste (tables métier, journal d'événements rejoué par séquence et poste, idempotence, plages de tickets, stock local, interface de vente, rôles pharmacien) est à construire, et l'application n'accepte pas les rôles de pharmacie. Réutiliser le mobile exigerait de lever la décision "patients seuls" du porteur. **L'hypothèse "la gestion hors ligne de Flutter est déjà implémentée et sert de base à la vente" est donc FAUSSE (ou au mieux très PARTIELLE : un cache clé-valeur de lecture).**
- Rappel : le web, où travaille aujourd'hui le pharmacien, n'a aucune couche hors ligne (section 5). Le chantier "hors ligne" de la demande est donc à créer côté web (IndexedDB plus service worker plus journal) et non à "s'appuyer sur" une mécanique existante.

## 7. Tests existants sur ces zones

Back (nombre de `it`/`test` par fichier, comptage grep) :
- src/pharmacie/vente.service.spec.ts : 33
- src/pharmacie/vente.http.spec.ts : 5
- src/pharmacie/pharmacie.import.spec.ts : 21
- src/pharmacie/pharmacie-import-mode.http.spec.ts : 3
- src/pharmacie/pharmacie.stock-quantite.spec.ts : 4
- src/pharmacie/catalogue-import.spec.ts : 14
- src/common/rbac/permissions-type-structure.spec.ts : 14 ; src/common/rbac/roles.service.spec.ts : 6
- Total zone pharmacie + RBAC : 100. Pas d'e2e utile (test/app.e2e-spec.ts seul). Aucun test de migration, aucun test d'alertes de stock dédié au contrat `alertes` de `getStockPharmacie` (le contrat n'est couvert que via les tests d'import et de quantité, à vérifier avant la non-régression demandée).

Front (nombre de tests) : vente/page.test.tsx 12, vente/panier.test.ts 37, ventes/page.test.tsx 13, ventes/affichage.test.ts 12, recu/page.test.tsx 7, stock/page.test.tsx 2, ApercuPharmacie.test.tsx 14, ComptoirPharmacie.test.tsx 8, PilotagePharmacie.test.tsx 7, ImportStockModal.test.tsx 17, apercu_pharmacie.test.ts 9, api_pharmacie.test.ts 8, api_ventes.test.ts 13, navigation_tableau_de_bord.pharmacie.test.ts 12, ventes_tableau_de_bord.test.ts 5. Total environ 176.

Mobile : aucun test pharmacie ; 11 tests sur la base locale.

## 8. Synthèse

### 8.1 Hypothèses du prompt confrontées au code

| Hypothèse | Verdict | Preuve |
|---|---|---|
| RBAC "à six rôles" | FAUSSE (sept valeurs d'enum) et incomplète (RBAC dynamique `AppRole` en plus) | schema.prisma:13-21 (PATIENT, MEDECIN, PHARMACIEN, STRUCTURE_ADMIN, ADMIN, SUPER_ADMIN, ACCUEIL) ; schema.prisma:46 |
| Backend NestJS avec PostgreSQL | VRAIE | CLAUDE.md back |
| Front Next.js | VRAIE | CLAUDE.md racine |
| Gestion hors ligne Flutter déjà implémentée, réutilisable pour la vente | FAUSSE (au mieux PARTIELLE) : cache clé-valeur chiffré, application réservée aux patients, pas de file ni de synchronisation | mobile lib/core/storage/local_database.dart:12-38 ; routes.dart:65-66 ; PLAN-APPLICATION-MOBILE.md décision 1 |
| "Mécanique de persistance locale et de synchronisation" existante | FAUSSE pour la synchronisation, PARTIELLE pour la persistance (chiffrement par compte) | idem, aucune file ni rejeu dans lib/ |
| Géolocalisation des pharmacies | VRAIE | `Structure.latitude/longitude` (schema.prisma, Structure) ; `calculateDistance` Haversine pharmacie.service.ts:1099-1118 ; module `src/geo` |
| Mise en ligne du catalogue de médicaments | VRAIE mais c'est un catalogue GLOBAL partagé, pas un catalogue par pharmacie | schema.prisma:419-432, endpoints 2.1 |
| Alertes de stock | VRAIE mais minimales : seuil fixe 10, par produit, notification + liste, aucune péremption côté serveur | pharmacie.service.ts:35,489-527 ; vente.service.ts:27 |
| Point de vente récent qui décrémente le stock à la validation | VRAIE | vente.service.ts:396-402 ; spec SPEC-VENTES-PHARMACIE.md |
| "Point de vente" au sens de l'établissement (point de vente par pharmacie, identifiant de point de vente) | FAUSSE : aucun modèle ni colonne ; la pharmacie EST la `Structure` | schema.prisma:159-220, aucune entité PointDeVente |
| Fournisseurs | FAUSSE : aucun modèle ni champ | liste des modèles, 1.1 |
| Postes de caisse | FAUSSE : aucun ; `Session` est la session d'AUTHENTIFICATION par appareil (TB3) et non une session de caisse | schema.prisma:698-705 |
| "Aucune gestion de caisse aujourd'hui" | VRAIE | aucun objet de caisse ; SPEC-VENTES-PHARMACIE.md:4 "Pas de gestion de caisse" |
| Les montants sont des entiers, arrondi seulement au montant de ligne | VRAIE pour l'existant (prix Int, sousTotal Int) ; la règle d'arrondi de la division n'a pas lieu d'être tant qu'il n'y a pas de prix à l'unité | schema.prisma:442,494-495 |
| Le stock est tenu comme un compteur mutable | VRAIE (c'est ce que la demande veut quitter) | 0 ci-dessus |
| Immuabilité de la vente validée, correction par écriture inverse | NON RESPECTÉE aujourd'hui (annulation par mutation, suppression par cascade) | 2.4 |
| Unité minimale, coefficient, deux prix | N'EXISTE PAS | schema.prisma:419-450 |

### 8.2 Ce qui existe déjà sous une autre forme

- Vente transactionnelle, numérotation sérialisée par pharmacie et année, idempotence 24 h, annulation du jour, audit, reçu imprimable (back vente.service.ts ; front recu/page.tsx).
- Quantité en stock "unité de stock non qualifiée" (équivalent grossier de l'unité minimale, mais sans définition).
- Prix de vente par pharmacie sur `StockMedicament.prixUnitaire` (équivalent du "prix boîte" ou "prix unité" selon l'usage actuel, ambigu).
- Date d'expiration unique par ligne de stock ; contrôle de péremption à la vente (refus des périmés).
- Alertes stock bas / rupture (notification et contrat `alertes`), alerte péremption approximative côté front seulement.
- Import Excel en mode `inventaire` (écrasement) et `livraison` (incrément) : équivalent grossier de réception et d'inventaire, sans historique.
- RBAC fin par permission avec sync au démarrage et filtre par type de structure ; permissions pharmacie `stock:*`, `catalogue:*`, `vente:*`.
- Audit transversal `AuditLog` (utilisable pour les anomalies ou traces en attendant des tables dédiées).
- Panier persisté localement (localStorage) et clé d'idempotence côté client : embryon de "rejeu sûr" pour la vente.
- Base locale chiffrée par compte côté mobile (fondation technique seule).

### 8.3 Ce qui ENTRE EN CONFLIT avec la demande

1. **Stock négatif impossible**, vente bloquée si stock insuffisant (409 `STOCK_INSUFFISANT`, vente.service.ts:380-424) alors que la demande veut "une vente ne se bloque jamais" avec allocation provisoire. Inverse du comportement actuel, y compris dans `rechercherDisponibilite` (filtre `quantite > 0`).
2. **Annulation par mutation** (statut, motif sur la ligne `Vente`) et **annulation limitée au jour même** : incompatible avec écriture inverse rattachée à la journée courante et pointant l'origine. Il faudra décider du sort de l'endpoint existant (conserver comme façade d'une écriture inverse ou le remplacer, ce qui change un contrat que le front consomme déjà).
3. **Suppressions physiques en cascade** : `Structure` delete cascade sur `Vente`, `StockMedicament` ; `Medicament` delete cascade sur `StockMedicament` ; `DELETE stock/:stockId` ; contraire à la traçabilité et à la reconstruction depuis les mouvements (pas de soft delete sur ces tables ; le soft-delete du projet ne couvre que les données de santé, schema.prisma:275-347).
4. **Écritures de stock non tracées** (`upsertStock`, `updateStockQuantite`, import, delete) : aucune trace, alors que tout doit devenir mouvement.
5. **Prix** : un seul prix par ligne de stock par pharmacie, copié tel quel sur la ligne de vente ; la demande exige deux prix et une ligne ramenée à l'unité minimale. Le `prixUnitaire` des lignes de vente historiques est "par unité de stock" non qualifiée : ne pourra pas être interprété rétroactivement en prix par unité minimale sans décision du titulaire.
6. **Chemin nominal de vente** : la sélection actuelle est "une ligne de stock = un produit". Ajouter la sélection de lot FEFO, le reliquat et les allocations ajoute du travail dans la transaction de vente, qui est aujourd'hui SÉRIALISÉE par pharmacie par le verrou sur `CompteurVente` (vente.service.ts:266). Le débit en ligne restera donc à une vente à la fois par pharmacie ; sans la numérotation par plage de postes les ventes concurrentes de plusieurs postes se bloquent entre elles. Pas un conflit de logique mais un compromis de performance à signaler (budget 20 s par vente dépendant surtout du client).
7. **Numérotation** : `V-AAAA-NNNNNN` est un compteur serveur par pharmacie et année. La demande veut des plages de numéros par poste attribuées au serveur et consommées localement. Format et collisions à redéfinir ; l'unicité `[structureId, numero]` impose un nouveau schéma de numéro (poste + plage ?) ou une table de plages.
8. **Hors ligne vente** : toutes les routes exigent le réseau, aucune file locale. La clé `Idempotency-Key` est facultative et sur 24 h seulement : un journal de synchronisation hors ligne peut dépasser 24 h (coupure prolongée) et une même vente rejouée au-delà pourrait être dupliquée. À étendre à une identité d'événement permanente.
9. **Périmètre d'accès incohérent** (`checkPharmacieAccess` sur l'enum vs `verifierPharmacie` sur l'appartenance), à unifier avant d'ajouter de nouveaux rôles (vendeur, titulaire).
10. **Mobile limité aux patients** : une caisse sur Flutter contredit une décision explicite du porteur.
11. **Décision déjà validée contraire** : SPEC-VENTES-PHARMACIE.md dit "Pas de gestion de caisse" pour les lots 7 et 8 (cela fixe un périmètre, pas une interdiction, la nouvelle demande le prolonge) et classe "vente hors connexion" en "Plus tard" (l.97).
12. **Pas de FK `LigneVente.stockMedicamentId`** (D109) : choix volontaire pour que le reçu reste lisible. Compatible avec l'exigence "valeurs recopiées, pas référencées", mais obligera à donner un sens aux anciennes lignes (pas d'allocation, pas de lot) conformément à la demande.

### 8.4 Ce qui MANQUE complètement

Unité minimale et coefficient de conversion ; deux prix indépendants ; déconditionnable ; tolérance d'inventaire ; lots (numéro, péremption, coût figé, fournisseur, réception) ; journal de mouvements de stock ; état de conditionnement ouvert (reliquat) ; allocations de lot et coût d'acquisition ; FEFO et priorité du reliquat ; alertes de péremption par lot et horizons paramétrables, valorisation au coût ; inventaire et anomalies ; fournisseurs ; coût d'achat ; identifiant de point de vente et poste ; sessions et comptages de caisse, mouvements de caisse, modes de paiement et paiements multiples, théorique par mode ; clôture journalière et verrouillage ; écritures inverses ; permission de marge et séparation du serveur des données de coût ; plages de tickets par poste ; journal d'événements synchronisé (séquence par poste, identifiant client stable) ; stock négatif toléré et allocations provisoires ; file d'anomalies pour le titulaire ; fonctionnement hors ligne du web (IndexedDB, service worker de cache, file) ; rôle "vendeur" distinct du titulaire (aujourd'hui "Pharmacien" et "Administrateur de structure" seulement) ; tests de migration.

### 8.5 Risques de migration

1. **Volumes inconnus** : aucune donnée de production consultée (lecture seule du code uniquement). `StockMedicament` est une ligne par (produit, pharmacie), donc la création d'un lot technique et d'un mouvement par ligne est du même ordre que le nombre de lignes de stock ; `Vente` et `LigneVente` sont récentes (migration du 2026-10-22) donc petites. Le risque de table "à fort volume" invoqué dans la demande concerne surtout les futurs mouvements et lignes de vente, pas l'existant.
2. **Point de vente non nullable** : aucune entité à remplir. Déterminable pour tout (`Structure` unique par pharmacie) SAUF les ventes dont la structure a été supprimée (impossible, cascade) ; les lignes de stock/vente sont toutes rattachées à `structureId`, donc le remplissage est faisable, mais il faut CRÉER d'abord un point de vente par pharmacie existante (migration de données). Les structures hôpital et clinique n'ont pas de stock ni de ventes (permissions retirées), pas de ligne à remplir.
3. **Compteur vers mouvements** : la divergence existante n'est pas détectable, puisque la quantité courante n'a pas d'historique. Le mouvement initial est forcément égal à la quantité courante ; le test "stock calculé = compteur" ne prouve rien sur l'exactitude du compteur lui-même. Les ventes historiques décrémentent déjà le compteur et n'auront pas de mouvement : seul le solde est fidèle.
4. **Nullabilité et défauts** : `prixUnitaire` nullable, `dateExpiration` nullable, `quantite` Int. Le "dernier coût connu" n'existe pas : tous les lots techniques auront un coût nul, donc toute la marge de l'existant est non valorisable jusqu'à la première réception réelle (attendu par la demande, mais impact visible côté titulaire).
5. **Une seule date d'expiration par ligne** : le lot technique porte la date existante ? La demande dit "péremption nulle" ; on PERD la date d'expiration actuelle si on suit à la lettre. Risque à trancher : reprendre `dateExpiration` dans le lot technique (meilleure option) ou la perdre, avec effet sur les alertes de péremption front actuelles et sur le refus des périmés à la vente.
6. **Contrainte d'unicité `[medicamentId, structureId]`** : si on introduit les lots, il faut décider ce que devient cette unicité (ligne de stock agrégée vs table de lots) et le comportement des appels existants (POST stock qui écrase, import Excel, PATCH quantite) qui, sans refonte, créeraient des divergences entre compteur et mouvements. Pendant la phase "une version en lecture seule" de l'ancienne colonne, tous ces endpoints doivent écrire des mouvements, sinon le stock calculé diverge.
7. **Prix en base** : la ligne de vente historique stocke `prixUnitaire` par "unité de stock" ; avec coefficient 1 par défaut c'est numériquement exact, mais dès que le titulaire renseigne un coefficient de 20, les anciennes lignes (quantité en boîtes ou en unités ?) deviennent ambiguës. Les ventes historiques ne seront donc pas réinterprétées (conforme à la demande), mais les rapports devront utiliser une date de début de fiabilité.
8. **Données démo et seeds** : `src/demo/demo.donnees.ts` (`STOCKS_DEMO`, l.631-700+, Pharmacie de Kaloum et Pharmacie du Niger, avec rupture et stock faible volontaires, ventes démo, notifications STOCK_ALERTE l.1957-1966) et `prisma/seed_medicaments.ts` (stock aléatoire sur 70 % des médicaments, upsert direct de `stockMedicament`) écrivent directement dans `StockMedicament`. À adapter pour créer lots et mouvements ; le seeder démo supprime les structures démo par `deleteMany` (cascade). `prisma/seed_complete.ts` crée des pharmacies sans stock.
9. **Tests** : 100 tests back couvrent l'existant ; aucun test n'est à la hauteur de la migration (pas de base chargée). Les tests `vente.service.spec.ts` (33) supposent le décrément direct de `StockMedicament` et seront à réécrire.
10. **Risque de dérive de l'API publique** : `GET /pharmacie/rechercher` (public) lit `quantite` et `disponible` de `StockMedicament` ; si la colonne devient gelée, la recherche patient montrera des stocks périmés. À brancher sur le stock calculé ou un agrégat de lecture.
11. **Concurrence** : le verrou de ligne `FOR UPDATE` et le décrément conditionnel actuels garantissent l'atomicité sur le compteur ; avec un journal et un calcul par somme, l'atomicité de la vente sur plusieurs lots devient plus délicate (verrouillage des lots, ordre stable) et le coût de calcul par somme doit être couvert par un agrégat de lecture reconstructible, ce que la demande prévoit déjà.
12. **Données non vérifiables** : je n'ai pas lu les migrations init ni sync_schema_complet en détail (forme finale lue dans schema.prisma) et je n'ai exécuté aucune requête ; les volumes réels de production sont inconnus.

### 8.6 Questions à poser au porteur (relevées pendant l'inventaire)

1. Faut-il lever la décision "mobile réservé aux patients" pour une caisse mobile, ou la caisse reste-t-elle sur le web avec un hors ligne web (service worker et IndexedDB) ?
2. Le lot technique reprend-il la `dateExpiration` actuelle ou la met-il à nulle comme écrit ?
3. Que devient l'annulation existante (jour même, mutation d'état) : façade d'écriture inverse, ou suppression de l'endpoint ?
4. Un seul point de vente par pharmacie la première année : table `PointDeVente` créée par migration (un par pharmacie), ou simple identifiant dérivé de la structure ?
5. La permission "voir la marge" est-elle réservée à l'administrateur de structure, ou crée-t-on un rôle "Titulaire" distinct de "Administrateur de structure" ?

## 9. Fichiers lus (références)

Back : prisma/schema.prisma, prisma/migrations/20261022120000_ventes_pharmacie/migration.sql, src/pharmacie/{pharmacie.controller,pharmacie.service,vente.controller,vente.service}.ts, src/pharmacie/dto/{pharmacie,vente}.dto.ts, src/common/rbac/{permissions.constants,permissions-type-structure,permissions.guard,permissions.service,roles.service}.ts, prisma/seed_medicaments.ts, seed_complete.ts, src/demo/demo.donnees.ts, décisions des runs lot7, lot7b, lot8, CLAUDE.md.
Front : src/lib/{api_pharmacie,api_ventes,apercu_pharmacie,navigation_tableau_de_bord}.ts, src/app/dashboard/{stock,vente,ventes}/, src/app/offline/page.tsx, public/sw.js, src/app/sw.ts, src/components/ServiceWorkerRegistration.tsx, next.config.ts.
Mobile : CLAUDE.md, docs/PLAN-APPLICATION-MOBILE.md, pubspec.yaml, lib/core/storage/*, lib/app/router/routes.dart, lib/core/session/app_user.dart.
Racine : SPEC-VENTES-PHARMACIE.md, BACKLOG-PRIORISE.md, DEMANDE.md.
