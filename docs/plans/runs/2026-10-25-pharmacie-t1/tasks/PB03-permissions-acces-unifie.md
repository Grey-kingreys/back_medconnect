# PB03 - Permissions T1, contrôle d'accès unifié, `masquerCouts`, migration M1

Tier: spécifié (agent implementeur-specifie : codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: dev (API) ; deux messages d'erreur 403/404 affichés aux pharmaciens (non-dev, textes imposés ci-dessous)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Jalon J1 : aucun changement de comportement visible hors les effets voulus listés ici. Cette tâche :

1. ajoute 7 permissions (`caisse:utiliser`, `caisse:superviser`, `cloture:gerer`, `inventaire:write`, `reception:write`, `marge:read`, `anomalie:gerer`) : constantes, catalogue, liste blanche pharmacie, permissions réservées aux pharmacies, rôles par défaut, complément au démarrage du titulaire, migration M1 et son retour arrière ;
2. remplace `checkPharmacieAccess` (`pharmacie.service.ts`) et `verifierPharmacie` (`vente.service.ts`) par un service unique `AccesPharmacieService` ;
3. écrit la fonction pure `masquerCouts` et ses tests (elle n'est branchée sur aucune route dans cette tâche).

Aucune route, aucun DTO, aucune garde de contrôleur n'est modifié : aucune route n'exige encore les nouvelles permissions (elles serviront à partir de PB05 et PB11).

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D406, D407, D408, D432, D456, D457, D461, D462, D464 à D468.

### Contexte vérifié (ne pas re-découvrir)

- `src/common/rbac/permissions.constants.ts` : objet `PERMISSIONS`, tableau `PERMISSION_CATALOG` (seedé au démarrage par `RolesService.syncCatalog`, qui met aussi à jour `libelle` et `categorie`), `ALL_PERMISSION_CODES`, `DELEGABLE_PERMISSION_CODES`, `DEFAULT_STRUCTURE_ROLES.PHARMACIE` (rôles « Pharmacien » et « Administrateur de structure »), `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` (5 codes aujourd'hui).
- `src/common/rbac/permissions-type-structure.ts` : `PERMISSIONS_AUTORISEES_PHARMACIE` (liste blanche, doit rester dans l'ordre du catalogue : le test 1 de la spec compare à `filtrerPermissionsSelonTypeStructure(ALL_PERMISSION_CODES, 'PHARMACIE')`), `PERMISSIONS_RESERVEES_PHARMACIE` (les 3 `vente:*`).
- `RolesService.completerRolesAdminPharmacie` (`src/common/rbac/roles.service.ts`) ajoute au démarrage `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` au seul rôle « Administrateur de structure » des pharmacies : l'étendre à 12 codes suffit, la méthode n'est pas modifiée. Le rôle « Pharmacien » n'est **pas** complété au démarrage (D408).
- `checkPharmacieAccess` (`pharmacie.service.ts`, vers la ligne 1077) exige l'enum `role` `STRUCTURE_ADMIN` ou `PHARMACIEN` et `user.structureId === structureId` ; ses 7 appels (`upsertStock`, `updateStockQuantite`, `getStockPharmacie`, `removeStockItem`, `getModeleImportStock`, `apercuImportStock`, `importerStock`) ignorent la valeur renvoyée. `verifierPharmacie` (`vente.service.ts`, vers la ligne 75) accepte membre ou `adminId`, renvoie `{ user, structure }` utilisés par `creerVente` (nom du vendeur, reçu) et par les autres appels (lignes 174, 501, 559, 579).
- `Structure.isActive` (Boolean, défaut vrai) existe ; ni l'un ni l'autre contrôle ne le lit aujourd'hui.
- Tables : `Permission(id TEXT, code UNIQUE, libelle, categorie, createdAt DEFAULT CURRENT_TIMESTAMP)`, `RolePermission(appRoleId, permissionId)` clé primaire composée, `AppRole(id, nom, structureId, ...)`. Précédent SQL : `prisma/migrations/20261022120000_ventes_pharmacie/migration.sql` (fin du fichier).
- Harnais PB01 : `test/db/harnais.ts` (`creerBaseVide`, `appliquerMigrations`, `appliquerSql`, `appliquerRetourArriere`, `supprimerBaseDeTest`, `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `DOSSIER_MIGRATIONS`, `DOSSIER_RETOURS_ARRIERE`), jeu `test/db/fixtures/format-actuel.ts` (`chargerFormatActuel`). Le jeu contient les rôles `rol-p1-admin`, `rol-p2-admin`, `rol-p3-admin` (10 permissions chacun), `rol-p1-pharmacien`, `rol-p2-pharmacien`, `rol-p3-pharmacien` (8 chacun), `rol-h1-admin`, `rol-h1-medecin` (hôpital `str-hopital-1`) ; aucune des 7 permissions T1. Prisma n'applique pas un fichier de migration en transaction (D456) : `BEGIN;`/`COMMIT;` obligatoires.
- Specs qui construisent les services directement : `src/pharmacie/vente.service.spec.ts` (ligne 491, faux Prisma `BaseFausse` dont `findUnique` ignore `select` et renvoie l'objet entier), `src/pharmacie/pharmacie.stock-quantite.spec.ts` (ligne 47), `src/pharmacie/pharmacie.import.spec.ts` (ligne 130), `test/db/non-regression-lectures.db-spec.ts` (lignes 127-128). Les specs HTTP (`vente.http.spec.ts`, `pharmacie-import-mode.http.spec.ts`) simulent les services : ne pas les toucher.

### 1. Constantes et catalogue (`src/common/rbac/permissions.constants.ts`)

Dans `PERMISSIONS`, juste après `VENTE_ANNULER`, ajouter (commentaire de section conservé tel quel) :

```ts
  CAISSE_UTILISER: 'caisse:utiliser', // encaisser, ouvrir et fermer sa caisse
  CAISSE_SUPERVISER: 'caisse:superviser', // sessions et comptages de tous les vendeurs
  CLOTURE_GERER: 'cloture:gerer', // clôture journalière
  INVENTAIRE_WRITE: 'inventaire:write',
  RECEPTION_WRITE: 'reception:write',
  MARGE_READ: 'marge:read', // coûts d'achat et marges
  ANOMALIE_GERER: 'anomalie:gerer',
```

Dans `PERMISSION_CATALOG`, juste après l'entrée `VENTE_ANNULER` et avant `STRUCTURE_READ`, ajouter dans cet ordre (catégorie `'Pharmacie'` pour les 7, apostrophe typographique `’` comme le reste du fichier) :

| code | libelle |
|---|---|
| `PERMISSIONS.CAISSE_UTILISER` | `Encaisser les ventes au comptoir (ouvrir et fermer sa caisse)` |
| `PERMISSIONS.CAISSE_SUPERVISER` | `Superviser les caisses de tous les vendeurs` |
| `PERMISSIONS.CLOTURE_GERER` | `Clôturer la journée de la pharmacie` |
| `PERMISSIONS.INVENTAIRE_WRITE` | `Faire un inventaire du stock` |
| `PERMISSIONS.RECEPTION_WRITE` | `Enregistrer une réception de marchandises` |
| `PERMISSIONS.MARGE_READ` | `Voir les coûts d’achat et les marges` |
| `PERMISSIONS.ANOMALIE_GERER` | `Traiter les anomalies de caisse et de stock` |

Ces libellés sont repris **à l'octet près** dans M1 (le test de M1 les compare au catalogue).

`DEFAULT_STRUCTURE_ROLES.PHARMACIE` :
- rôle « Pharmacien » : insérer `PERMISSIONS.CAISSE_UTILISER` juste après `PERMISSIONS.VENTE_WRITE` (9 permissions) ;
- rôle « Administrateur de structure » : insérer les 7 constantes, dans l'ordre du catalogue, juste après `PERMISSIONS.VENTE_ANNULER` (17 permissions).

`PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` : ajouter les 7 constantes après `PERMISSIONS.VENTE_ANNULER` (12 codes). Mettre à jour son commentaire : « Permissions toujours garanties au rôle « Administrateur de structure » d'une pharmacie (stock, ventes, caisse, clôture, inventaire, réception, marge, anomalies), y compris pour les pharmacies existantes (complétées au démarrage par RolesService). »

Ne rien changer à `HOPITAL`, `CLINIQUE`, `SYSTEM_ROLES`, `NON_DELEGABLE_PERMISSIONS` (les 7 sont délégables).

### 2. Liste blanche et réserve (`src/common/rbac/permissions-type-structure.ts`)

- `PERMISSIONS_AUTORISEES_PHARMACIE` : insérer les 7 constantes, dans l'ordre du catalogue, juste après `PERMISSIONS.VENTE_ANNULER`.
- `PERMISSIONS_RESERVEES_PHARMACIE` : ajouter les 7 constantes après les 3 `vente:*` (D465). Mettre à jour le commentaire d'en-tête du fichier : « Inversement, les permissions de vente et de caisse (ventes, caisse, clôture, inventaire, réception, marge, anomalies) sont retirées à tout autre type de structure. »

### 3. Migration M1

Créer `prisma/migrations/20261026090000_pharmacie_t1_permissions/migration.sql`, contenu exact :

```sql
-- Tranche pharmacie 1, permissions (PB03, M1, D408) : catalogue puis rôles existants des pharmacies.
-- Écrit à la main. Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- Rejouable : ON CONFLICT DO NOTHING. Libellés identiques à PERMISSION_CATALOG.
BEGIN;

INSERT INTO "Permission" ("id", "code", "libelle", "categorie")
VALUES
  (gen_random_uuid()::text, 'caisse:utiliser', 'Encaisser les ventes au comptoir (ouvrir et fermer sa caisse)', 'Pharmacie'),
  (gen_random_uuid()::text, 'caisse:superviser', 'Superviser les caisses de tous les vendeurs', 'Pharmacie'),
  (gen_random_uuid()::text, 'cloture:gerer', 'Clôturer la journée de la pharmacie', 'Pharmacie'),
  (gen_random_uuid()::text, 'inventaire:write', 'Faire un inventaire du stock', 'Pharmacie'),
  (gen_random_uuid()::text, 'reception:write', 'Enregistrer une réception de marchandises', 'Pharmacie'),
  (gen_random_uuid()::text, 'marge:read', 'Voir les coûts d’achat et les marges', 'Pharmacie'),
  (gen_random_uuid()::text, 'anomalie:gerer', 'Traiter les anomalies de caisse et de stock', 'Pharmacie')
ON CONFLICT ("code") DO NOTHING;

-- Titulaire (« Administrateur de structure ») : les 7 ; vendeur (« Pharmacien ») : caisse:utiliser.
INSERT INTO "RolePermission" ("appRoleId", "permissionId")
SELECT r."id", p."id"
FROM "AppRole" r
JOIN "Structure" s ON s."id" = r."structureId" AND s."type" = 'PHARMACIE'
JOIN "Permission" p ON (
  (r."nom" = 'Administrateur de structure' AND p."code" IN ('caisse:utiliser', 'caisse:superviser', 'cloture:gerer', 'inventaire:write', 'reception:write', 'marge:read', 'anomalie:gerer'))
  OR (r."nom" = 'Pharmacien' AND p."code" = 'caisse:utiliser')
)
ON CONFLICT DO NOTHING;

COMMIT;
```

Créer `prisma/retours-arriere/20261026090000_pharmacie_t1_permissions.down.sql`, contenu exact :

```sql
-- Retour arrière de 20261026090000_pharmacie_t1_permissions (PB03, M1, D467).
-- Retire les 7 permissions de TOUS les rôles (personnalisés et Super Administrateur compris),
-- puis du catalogue. À suivre du redéploiement du code précédent : sinon le démarrage les recrée.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission"
  WHERE "code" IN ('caisse:utiliser', 'caisse:superviser', 'cloture:gerer', 'inventaire:write', 'reception:write', 'marge:read', 'anomalie:gerer')
);

DELETE FROM "Permission"
WHERE "code" IN ('caisse:utiliser', 'caisse:superviser', 'cloture:gerer', 'inventaire:write', 'reception:write', 'marge:read', 'anomalie:gerer');

COMMIT;
```

`prisma/schema.prisma` n'est **pas** modifié (aucun `prisma generate` à lancer). Ne pas lancer `prisma migrate dev` (il réécrirait le fichier) ; la migration s'applique au prochain démarrage du conteneur ou par le harnais.

### 4. `AccesPharmacieService` (créer `src/pharmacie/acces-pharmacie.service.ts`)

Contenu attendu (signatures, sélections et messages exacts) :

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StructureType } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';

export const MESSAGE_PHARMACIE_INTROUVABLE = 'Cette pharmacie est introuvable.';
export const MESSAGE_ACCES_PHARMACIE_REFUSE =
  "Vous n'avez pas accès à cette pharmacie.";
export const MESSAGE_PHARMACIE_DESACTIVEE =
  'Cette pharmacie est désactivée. Contactez l’administrateur de la plateforme.';

export interface UtilisateurPharmacie {
  id: string;
  nom: string;
  prenom: string;
  structureId: string | null;
}

export interface StructurePharmacie {
  id: string;
  type: StructureType;
  adminId: string | null;
  isActive: boolean;
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  logoFile: { key: string } | null;
}

export interface AccesPharmacie {
  user: UtilisateurPharmacie;
  structure: StructurePharmacie;
}

/**
 * Contrôle d'accès unique aux routes d'une pharmacie (D406, D464) : membre
 * (`structureId`) ou administrateur (`adminId`), structure de type PHARMACIE,
 * active. La permission est vérifiée par PermissionsGuard, l'enum `role` n'est pas lu.
 */
@Injectable()
export class AccesPharmacieService {
  constructor(private readonly prisma: PrismaService) {}

  async verifier(structureId: string, userId: string): Promise<AccesPharmacie> { ... }
}
```

Corps de `verifier`, dans cet ordre :
1. `Promise.all` de `this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nom: true, prenom: true, structureId: true } })` et `this.prisma.structure.findUnique({ where: { id: structureId }, select: { id: true, type: true, adminId: true, isActive: true, nom: true, adresse: true, ville: true, telephone: true, logoFile: { select: { key: true } } } })` (sélections exactes : le test les vérifie).
2. Structure absente : `throw new NotFoundException(MESSAGE_PHARMACIE_INTROUVABLE)`.
3. `!user || (user.structureId !== structureId && structure.adminId !== userId) || structure.type !== 'PHARMACIE'` : `throw new ForbiddenException(MESSAGE_ACCES_PHARMACIE_REFUSE)`.
4. `!structure.isActive` : `throw new ForbiddenException(MESSAGE_PHARMACIE_DESACTIVEE)` (après le contrôle 3 : un non-membre n'apprend pas que la pharmacie est désactivée).
5. Retourner `{ user, structure }`.

Si le type renvoyé par Prisma ne s'affecte pas directement aux interfaces (types `generated/prisma`), garder les interfaces et retourner l'objet sans conversion de valeur ; ne pas utiliser `any` ni `as unknown as`.

`src/pharmacie/pharmacie.module.ts` : ajouter `AccesPharmacieService` aux `providers` (import relatif `./acces-pharmacie.service`). Pas d'`exports`.

### 5. Recâblage des deux services

`src/pharmacie/pharmacie.service.ts` :
- constructeur : ajouter en **dernier** paramètre `private readonly accesPharmacie: AccesPharmacieService` (import `./acces-pharmacie.service`) ;
- remplacer chacun des 7 `await this.checkPharmacieAccess(structureId, adminUserId);` par `await this.accesPharmacie.verifier(structureId, adminUserId);` (rien d'autre dans ces méthodes) ;
- supprimer la méthode privée `checkPharmacieAccess` ;
- retirer de l'import `@nestjs/common` `ForbiddenException` et `BadRequestException` s'ils ne servent plus (vérifié au moment de la fiche : ils n'étaient utilisés que dans `checkPharmacieAccess` ; tsc et eslint font foi).

`src/pharmacie/vente.service.ts` :
- constructeur : ajouter en **dernier** paramètre `private readonly accesPharmacie: AccesPharmacieService` ;
- remplacer chaque `this.verifierPharmacie(` par `this.accesPharmacie.verifier(` (4 appels, mêmes arguments, même déstructuration) ;
- supprimer la méthode privée `verifierPharmacie` ;
- retirer `ForbiddenException` de l'import s'il ne sert plus ;
- la documentation Swagger de `vente.controller.ts` n'est pas touchée.

`pharmacieRecu(structure)` reçoit désormais un `StructurePharmacie` : compatible, ne pas le modifier.

### 6. `masquerCouts` (créer `src/pharmacie/masquer-couts.ts`)

```ts
/**
 * Masquage des coûts côté serveur (D407, D466). Toute clé qui contient « cout »
 * ou « marge » (sans tenir compte de la casse) est une donnée de coût : aucune
 * autre clé ne doit contenir ces mots.
 */
export const MOTIF_CLE_COUT = /cout|marge/i;

/** Sans `marge:read`, retire toute clé de coût à toute profondeur ; ne mute pas l'entrée. */
export function masquerCouts<T>(donnees: T, peutVoirMarge: boolean): T;

/** Chemins des clés de coût présentes (`lots[0].coutUnitaire`), pour les tests. */
export function cheminsCout(donnees: unknown): string[];
```

Règles :
- `peutVoirMarge === true` : retourne `donnees` (même référence, aucune copie).
- Sinon, parcours récursif : un tableau donne un nouveau tableau de ses éléments masqués ; un **objet simple** (`Object.getPrototypeOf(v) === Object.prototype` ou `null`) donne un nouvel objet sans les clés qui satisfont `MOTIF_CLE_COUT.test(cle)` (la valeur de la clé retirée n'est pas parcourue), les autres valeurs masquées récursivement ; toute autre valeur (primitive, `null`, `undefined`, `Date`, instance de classe, `Buffer`) est retournée telle quelle (même référence).
- Pas de détection de cycle (les réponses de service sont des arbres).
- Le type de retour reste `T` (contrat de compilation ; le masquage retire des clés optionnelles côté consommateur).
- `cheminsCout` : même parcours, sans rien retirer ; chemin = clés jointes par `.`, indices de tableau en `[i]` collés à la clé précédente (`lots[0].coutUnitaire`, `[1].marge` pour un tableau racine) ; ordre = ordre de parcours (profondeur d'abord, ordre d'insertion des clés) ; une clé de coût dont la valeur est un objet est listée une fois, sans descendre dedans.
- Utiliser `RegExp.prototype.test` sur une regex sans drapeau `g` (pas d'état `lastIndex`).

### 7. Documentation (`CLAUDE.md` du dépôt back)

Six remplacements exacts avec Edit (chaînes actuelles vérifiées, chacune unique dans le fichier), rien d'autre dans `CLAUDE.md`. Chaque bloc « avant » est à remplacer par le bloc « après » qui le suit.

1. Liste blanche (puce B10). Avant :
```
`vente:annuler`, `structure:read`, `structure:write`, `membre:read`, `membre:manage`, `role:manage`, `chat:structure` ;
```
Après :
```
`vente:annuler`, `caisse:utiliser`, `caisse:superviser`, `cloture:gerer`, `inventaire:write`, `reception:write`, `marge:read`, `anomalie:gerer`, `structure:read`, `structure:write`, `membre:read`, `membre:manage`, `role:manage`, `chat:structure` ;
```
2. Réserve (puce B10). Avant :
```
sauf que les trois `vente:*` leur sont retirées (réservées aux pharmacies, même par un rôle personnalisé).
```
Après :
```
sauf que les permissions de vente et de caisse (les trois `vente:*` et les sept de la tranche pharmacie 1 : `caisse:utiliser`, `caisse:superviser`, `cloture:gerer`, `inventaire:write`, `reception:write`, `marge:read`, `anomalie:gerer`) leur sont retirées (réservées aux pharmacies, même par un rôle personnalisé).
```
3. Accès (puce Ventes). Avant :
```
accès réservé aux membres de la pharmacie (ou à son administrateur) et aux structures de type PHARMACIE (403 sinon)
```
Après :
```
accès contrôlé par `AccesPharmacieService` (`src/pharmacie/acces-pharmacie.service.ts`, commun au stock et aux ventes) : membre de la pharmacie ou son administrateur quel que soit l'enum `role`, structure de type PHARMACIE (403 « Vous n'avez pas accès à cette pharmacie. » sinon) et active (403 « Cette pharmacie est désactivée. Contactez l’administrateur de la plateforme. »)
```
4. Message 403 (puce Ventes). Avant :
```
(« Vous n'avez pas accès aux ventes de cette pharmacie. »)
```
Après :
```
(« Vous n'avez pas accès à cette pharmacie. »)
```
5. Rôles (puce Ventes). Avant :
```
rôle « Pharmacien » : `stock:read`, `stock:write`, `vente:read`, `vente:write` ; rôle « Administrateur de structure » : `stock:read`, `stock:write`, `vente:read`, `vente:write`, `vente:annuler` (plus
```
Après :
```
rôle « Pharmacien » : `stock:read`, `stock:write`, `vente:read`, `vente:write`, `caisse:utiliser` ; rôle « Administrateur de structure » : `stock:read`, `stock:write`, `vente:read`, `vente:write`, `vente:annuler` et les sept permissions de la tranche pharmacie 1 (plus
```
6. Complément au démarrage. Avant :
```
ajoute au démarrage les 5 permissions de
```
Après :
```
ajoute au démarrage les 12 permissions de
```

### 8. Tests

Noms exacts ; « T1 » ci-dessous = les 7 codes dans l'ordre du catalogue.

**a. `src/common/rbac/permissions-type-structure.spec.ts`** (modifier)
- Test 1 : liste attendue = l'actuelle avec les 7 codes insérés après `'vente:annuler'` (20 codes).
- Ajouter après 2d : `it('2e. hôpital, clinique et sans structure : les 7 permissions T1 sont retirées', ...)` : pour chaque type de `['HOPITAL', 'CLINIQUE', null]`, `filtrerPermissionsSelonTypeStructure([...T1, 'carnet:read'], type)` vaut `['carnet:read']`.
- Ajouter : `it('2f. pharmacie : les 7 permissions T1 sont conservées', ...)` : `filtrerPermissionsSelonTypeStructure([...T1], 'PHARMACIE')` vaut `T1`.
- Test 3 inchangé (il couvre désormais les rôles étendus).

**b. `src/common/rbac/roles.service.spec.ts`** (modifier)
- Test 1 : titre `'1. définitions : l’admin d’une pharmacie a stock, ventes et les 7 permissions T1'`, `toHaveLength(12)`, boucle inchangée.
- Test 2 : ajouter les 7 codes T1 à `interdits`.
- Test 3 : `expect(appel.data).toHaveLength(12)`.
- Ajouter `it('7. définitions : le pharmacien a caisse:utiliser et aucune autre permission T1', ...)` : rôle `legacyRole === 'PHARMACIEN'` de `DEFAULT_STRUCTURE_ROLES.PHARMACIE` contient `'caisse:utiliser'` et aucun des 6 autres codes T1 ; `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` contient les 7 codes T1.
- Ajouter `it('8. catalogue : les 7 permissions T1 existent, catégorie Pharmacie, délégables', ...)` : pour chaque code T1, une entrée de `PERMISSION_CATALOG` avec `categorie === 'Pharmacie'` et un `libelle` non vide ; chaque code est dans `DELEGABLE_PERMISSION_CODES` ; `ALL_PERMISSION_CODES.indexOf('caisse:utiliser') === ALL_PERMISSION_CODES.indexOf('vente:annuler') + 1`.

**c. `src/pharmacie/acces-pharmacie.service.spec.ts`** (créer) : faux Prisma `{ user: { findUnique: jest.fn() }, structure: { findUnique: jest.fn() } }`, service construit par `new AccesPharmacieService(prisma as unknown as PrismaService)`. Pharmacie par défaut `{ id: 's1', type: 'PHARMACIE', adminId: 'u-admin', isActive: true, nom: 'Pharmacie de Kaloum', adresse: null, ville: 'Conakry', telephone: null, logoFile: null }`. Tests (`describe('AccesPharmacieService')`) :
1. `'1. membre pharmacien : accès, utilisateur et structure renvoyés'` : utilisateur `{ id: 'u1', nom, prenom, structureId: 's1' }` ; `resolves.toEqual({ user, structure })`.
2. `'2. administrateur non rattaché (structureId nul) : accès'` : `userId 'u-admin'`, `structureId: null`.
3. `'3. compte ACCUEIL membre : accès, l enum role n est plus lu'` : l'utilisateur simulé porte en plus `role: 'ACCUEIL'` ; accès accordé.
4. `'4. pharmacie introuvable : 404'` : statut 404, message `MESSAGE_PHARMACIE_INTROUVABLE` (valeur littérale `'Cette pharmacie est introuvable.'` vérifiée une fois).
5. `'5. membre d une autre pharmacie : 403'` : `structureId: 's2'` ; 403, message `"Vous n'avez pas accès à cette pharmacie."`.
6. `'6. utilisateur inconnu : 403'`.
7. `'7. structure de type HOPITAL, utilisateur membre : 403 même message'`.
8. `'8. pharmacie désactivée, membre : 403 désactivée'` : message exact `'Cette pharmacie est désactivée. Contactez l’administrateur de la plateforme.'`.
9. `'9. pharmacie désactivée, non membre : 403 générique'` : message `MESSAGE_ACCES_PHARMACIE_REFUSE`.
10. `'10. sélections exactes : aucun autre champ lu'` : `findUnique` appelés avec les objets `{ where, select }` exacts de la section 4 (`toHaveBeenCalledWith`).

**d. `src/pharmacie/masquer-couts.spec.ts`** (créer), `describe('masquerCouts')` :
1. `'1. avec marge:read : même référence, rien retiré'` : `expect(masquerCouts(obj, true)).toBe(obj)`.
2. `'2. sans marge:read : clés de coût retirées à la racine'` : `{ id: 'a', coutUnitaire: 10, coutAchatBoite: 120, valeurCout: 5, margeBrute: 3, tauxMarge: 0.2, prixUnitaire: 150 }` donne `{ id: 'a', prixUnitaire: 150 }`.
3. `'3. casse ignorée'` : `{ CoutTotal: 1, MARGE: 2, nom: 'x' }` donne `{ nom: 'x' }`.
4. `'4. objets imbriqués et tableaux, y compris tableaux de tableaux'` : `{ lots: [{ id: 'l1', coutUnitaire: 4, quantite: 3 }], groupes: [[{ marge: 1, n: 2 }]], resume: { valeurCout: 9, total: 9 } }` donne `{ lots: [{ id: 'l1', quantite: 3 }], groupes: [[{ n: 2 }]], resume: { total: 9 } }`.
5. `'5. une clé de coût dont la valeur est un objet est retirée entière'` : `{ marge: { total: 1, detail: [1] }, a: 1 }` donne `{ a: 1 }`.
6. `'6. l entrée n est pas modifiée'` : `JSON.stringify` de l'entrée identique avant et après l'appel ; le résultat n'est pas la même référence (`not.toBe`).
7. `'7. valeurs conservées telles quelles : Date, null, undefined, primitives, chaînes qui contiennent cout'` : `const d = new Date()` ; `masquerCouts({ le: d, n: null, u: undefined, x: 0, nom: 'coût du transport' }, false)` : `resultat.le` `toBe(d)`, `'u' in resultat` vrai, `nom` conservé.
8. `'8. entrée primitive, null ou tableau racine'` : `masquerCouts(5, false) === 5`, `masquerCouts(null, false) === null`, `masquerCouts([{ coutUnitaire: 1, a: 1 }], false)` vaut `[{ a: 1 }]`.
9. `'9. cheminsCout liste les clés de coût, vide après masquage'` : sur l'entrée du test 4 : `['lots[0].coutUnitaire', 'groupes[0][0].marge', 'resume.valeurCout']` ; `cheminsCout(masquerCouts(entree, false))` vaut `[]` ; `cheminsCout([{ marge: { cout: 1 } }])` vaut `['[0].marge']`.
10. `'10. MOTIF_CLE_COUT correspond au motif du test transversal (D407)'` : `MOTIF_CLE_COUT.source === 'cout|marge'`, `MOTIF_CLE_COUT.flags === 'i'`.

**e. Specs existantes des services** (modifier, rien d'autre) :
- `src/pharmacie/vente.service.spec.ts` : construire `new VenteService(base.prisma() as unknown as PrismaService, notifications as unknown as NotificationsService, stockage as unknown as StorageService, new AccesPharmacieService(base.prisma() as unknown as PrismaService))` ; ajouter `isActive: true` aux structures simulées `S1`, `'s2'` et `'h1'` du `beforeEach` (et à toute autre structure ajoutée par `base.structures.set` dans le fichier, s'il y en a) ; test « utilisateur d une autre pharmacie : 403 » : message attendu `"Vous n'avez pas accès à cette pharmacie."`. Si `BaseFausse.prisma()` crée un nouvel objet à chaque appel, appeler `base.prisma()` une fois dans une constante et la passer aux deux constructeurs.
- `src/pharmacie/pharmacie.stock-quantite.spec.ts` et `src/pharmacie/pharmacie.import.spec.ts` : ajouter `isActive: true` (et `adminId: null`) à la structure renvoyée par `structure.findUnique` ; construire `new PharmacieService(prisma as unknown as PrismaService, notifications as unknown as NotificationsService, new AccesPharmacieService(prisma as unknown as PrismaService))`.
- `src/pharmacie/pharmacie.stock-quantite.spec.ts` : ajouter un test `'un compte ACCUEIL membre de la pharmacie peut ajuster la quantité (enum role non lu)'` : `prisma.user.findUnique` renvoie une fois (`mockResolvedValueOnce`) `{ id: USER_ID, nom: 'Bah', prenom: 'Mariama', role: 'ACCUEIL', structureId: STRUCTURE_ID }`, même scénario que le test 1 (même `queryRaw`), l'appel réussit (`success` vrai).
- `test/db/non-regression-lectures.db-spec.ts` (D462, D468) : ajouter la ligne `import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';` parmi les imports, et dans le bloc « Construction des services » seulement : `const acces = new AccesPharmacieService(prisma);`, `pharmacie = new PharmacieService(prisma, notifications, acces);`, `ventes = new VenteService(prisma, notifications, stockageFactice, acces);`. Aucun autre changement (appels, assertions, instantanés intouchés ; ne jamais lancer `MAJ_INSTANTANES=1`).

**f. `test/db/m1-permissions.db-spec.ts`** (créer), `describe('Migration M1, permissions de la tranche pharmacie 1 (PB03)')` :

Constantes : `const M1 = '20261026090000_pharmacie_t1_permissions';`, `const T1 = [7 codes];`. Fonctions locales :
- `lignesSql(fichier: string): string[]` : contenu lu en UTF-8, découpé par ligne, chaque ligne `trim()`, sans les lignes vides ni celles qui commencent par `--` ;
- `codesDuRole(client, roleId): Promise<string[]>` : `SELECT p."code" FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" WHERE rp."appRoleId" = $1 ORDER BY p."code"` ;
- `etatRbac(client)` : `{ permissions: number, roles: Record<string, string[]> }` (nombre total de `Permission`, et `codesDuRole` pour les 8 rôles du jeu cités dans le contexte) ;
- `lierT1HorsPharmacie(client): Promise<number>` : `SELECT count(*)::int AS n FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" JOIN "AppRole" r ON r."id" = rp."appRoleId" LEFT JOIN "Structure" s ON s."id" = r."structureId" WHERE p."code" = ANY($1) AND (s."type" IS NULL OR s."type" <> 'PHARMACIE')`.

`beforeAll` : `creerBaseVide()`, `appliquerMigrations(client, { jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL })`, `chargerFormatActuel(client)`, `etatAvant = await etatRbac(client)`, `appliquees = await appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL })`. `afterAll` : `supprimerBaseDeTest` dans un `finally` (modèle de `harnais.db-spec.ts`). Aucun client Prisma n'est nécessaire.

Tests, dans cet ordre :
1. `'la migration et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)'` : pour `path.join(DOSSIER_MIGRATIONS, M1, 'migration.sql')` et `path.join(DOSSIER_RETOURS_ARRIERE, `${M1}.down.sql`)` : `lignesSql(f)[0] === 'BEGIN;'` et `lignesSql(f).at(-1) === 'COMMIT;'`.
2. `'M1 haut : les 7 permissions existent avec les libellés et la catégorie du catalogue'` : `appliquees[0] === M1` ; `SELECT "code", "libelle", "categorie" FROM "Permission" WHERE "code" = ANY($1) ORDER BY "code"` renvoie 7 lignes ; pour chacune, l'entrée de `PERMISSION_CATALOG` de même code a le même `libelle` et la même `categorie`.
3. `'M1 haut : titulaires avec les 7, pharmaciens avec caisse:utiliser seulement, rien d autre ne change'` : pour `rol-p1-admin`, `rol-p2-admin`, `rol-p3-admin` : codes = tri de `[...etatAvant.roles[id], ...T1]` ; pour les trois `rol-pN-pharmacien` : codes = tri de `[...etatAvant.roles[id], 'caisse:utiliser']` ; `rol-h1-admin` et `rol-h1-medecin` : codes identiques à `etatAvant`.
4. `'M1 haut : aucun rôle hors pharmacie ne reçoit ces permissions'` : `lierT1HorsPharmacie(client) === 0`.
5. `'M1 rejouée sur elle-même : aucune erreur ni doublon'` : `etatApres = await etatRbac(client)` ; `appliquerSql(client, contenu de migration.sql)` résout ; `etatRbac(client)` égal à `etatApres` (`toEqual`).
6. `'retour arrière : haut, bas, haut sur la base chargée'` : `etatHaut = await etatRbac(client)` ; `appliquerRetourArriere(client, M1)` ; `etatRbac(client)` `toEqual(etatAvant)` et `SELECT count(*)` des `Permission` dont `code = ANY(T1)` vaut 0 ; puis `appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M1 })` `toEqual([M1])` ; `etatRbac(client)` `toEqual(etatHaut)`.

Ne jamais afficher d'URL ni de valeur de `.env` (D454) : aucun `console.log`, aucune assertion sur une URL.

### Cas limites (déjà tranchés, ne pas rediscuter)

- Un compte d'enum `ACCUEIL` ou `MEDECIN` rattaché à une pharmacie et porteur d'un rôle personnalisé avec `stock:read` et `stock:write` accède désormais au stock (effet voulu du plan, section 3).
- Super-administrateur non membre : refusé comme avant (403).
- Structure non PHARMACIE sur les routes de stock : 403 au lieu de 400 (D464).
- Le rôle « Pharmacien » d'une pharmacie existante reçoit `caisse:utiliser` par M1 seulement ; s'il lui est retiré à la main, il ne revient pas au démarrage (D408). Le titulaire, lui, récupère au démarrage toute permission de `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` retirée à la main (comportement B14 inchangé).
- Pharmacie créée après le déploiement : rôles par défaut étendus (section 1), rien d'autre à faire.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifiques : français partout (commentaires, noms de tests, messages) ; aucun tiret cadratin ni demi-cadratin ; aucun `eslint-disable`, aucun `any`, aucun `console.log` ; ne pas toucher `package.json`, `package-lock.json`, `prisma/schema.prisma`, le harnais (`test/db/harnais.ts`, `test/db/fixtures/`), les instantanés (`test/db/instantanes/`), les contrôleurs et DTO ; aucun commit (le chef commite) ; ne jamais afficher ni écrire d'URL de base, de mot de passe ou de valeur de `.env`.

Fichiers touchés (liste fermée) :
- créés : `src/pharmacie/acces-pharmacie.service.ts`, `src/pharmacie/acces-pharmacie.service.spec.ts`, `src/pharmacie/masquer-couts.ts`, `src/pharmacie/masquer-couts.spec.ts`, `prisma/migrations/20261026090000_pharmacie_t1_permissions/migration.sql`, `prisma/retours-arriere/20261026090000_pharmacie_t1_permissions.down.sql`, `test/db/m1-permissions.db-spec.ts` ;
- modifiés : `src/common/rbac/permissions.constants.ts`, `src/common/rbac/permissions-type-structure.ts`, `src/common/rbac/permissions-type-structure.spec.ts`, `src/common/rbac/roles.service.spec.ts`, `src/pharmacie/pharmacie.module.ts`, `src/pharmacie/pharmacie.service.ts`, `src/pharmacie/vente.service.ts`, `src/pharmacie/vente.service.spec.ts`, `src/pharmacie/pharmacie.stock-quantite.spec.ts`, `src/pharmacie/pharmacie.import.spec.ts`, `test/db/non-regression-lectures.db-spec.ts`, `CLAUDE.md`.

## Done when

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré), chacune avec un code de sortie 0 :

1. `docker compose exec -T backend npx tsc --noEmit`
2. `docker compose exec -T backend npx eslint src/common/rbac/permissions.constants.ts src/common/rbac/permissions-type-structure.ts src/common/rbac/permissions-type-structure.spec.ts src/common/rbac/roles.service.spec.ts src/pharmacie/acces-pharmacie.service.ts src/pharmacie/acces-pharmacie.service.spec.ts src/pharmacie/masquer-couts.ts src/pharmacie/masquer-couts.spec.ts src/pharmacie/pharmacie.module.ts src/pharmacie/pharmacie.service.ts src/pharmacie/vente.service.ts src/pharmacie/vente.service.spec.ts src/pharmacie/pharmacie.stock-quantite.spec.ts src/pharmacie/pharmacie.import.spec.ts test/db/m1-permissions.db-spec.ts test/db/non-regression-lectures.db-spec.ts` (aucune erreur ni avertissement ; si un fichier existant portait déjà des erreurs hors des lignes touchées, le signaler dans le retour avec la sortie avant modification, sans les corriger)
3. `docker compose exec -T backend npm test` : toutes les suites passent ; nombre de tests réussis = 715 + tests ajoutés (au moins 25 de plus) ; aucun test supprimé ni ignoré en plus des 3 actuels.
4. `docker compose exec -T backend npm run test:db` : 3 suites vertes (harnais 11, PB02 9, M1 6) ; instantanés PB02 inchangés (`git status --short test/db/instantanes` vide, depuis `back_medconnect`).
5. Aucune base `mc_test_` restante : `docker compose exec -T backend node -e "const {Client}=require('pg');const u=new URL(process.env.DATABASE_URL);u.pathname='/postgres';const c=new Client({connectionString:u.toString()});c.connect().then(()=>c.query(\"select count(*)::int n from pg_database where datname like 'mc_test_%'\")).then(r=>{console.log(r.rows[0].n);return c.end()})"` affiche `0`.
6. `grep -rn "checkPharmacieAccess\|verifierPharmacie" src test` (depuis `back_medconnect`) ne renvoie rien.
7. `LC_ALL=C.UTF-8 grep -rnP "\x{2013}|\x{2014}" <fichiers touchés>` ne renvoie rien.
8. `git status --short` (depuis `back_medconnect`) ne liste que les fichiers de la liste fermée (plus `docs/plans/`, tenu par l'orchestrateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-25 | spécifié (codeur Sonnet, vérificateur Sonnet) | validé | vérification PASS, contrôle du chef PASS

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
npm test ; npm run test:db | 740 réussis, 3 ignorés ; 3 suites et 26 tests verts | voir git log (PB03)
