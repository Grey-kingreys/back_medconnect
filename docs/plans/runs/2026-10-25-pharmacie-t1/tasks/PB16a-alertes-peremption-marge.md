# PB16a - Alertes de péremption par lot valorisées et rapport de marge

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages de succès et d'erreur lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Première des deux sous-fiches de PB16 (D601) : PB16a (cette fiche), puis PB16b (étanchéité transversale des coûts, CA22). Chacune est autonome et commitée seule.

PB16a livre :

- `GET /pharmacie/:structureId/stock/alertes-peremption` (`stock:read`) : lots menacés aux horizons des paramètres de la pharmacie, plus les périmés, valorisés au prix de vente (visible par tous) et au coût d'achat (retiré sans `marge:read`) (D602, D603) ;
- `GET /pharmacie/:structureId/rapports/marge?du=&au=` (`marge:read`) : marge réelle depuis les allocations, volume non valorisable et provisoires à part, date de début de fiabilité (D604, D605) ;
- les tests de bout en bout CA14, CA11 et CA12 sur base de test.

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`** : `ParametresPharmacie.horizonsPeremptionJours` et `debutFiabiliteMarge` (M2), `LotStock`, `AgregatStockLot` (M4), `Vente`, `LigneVente`, `AllocationLot` (M5, M6) existent. Ne pas toucher aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`, ni aux fichiers `test/db/*.db-spec.ts` existants. Jamais `prisma migrate dev`, `migrate reset` ni `db push`. Aucune écriture de stock (lecture seule partout dans les fichiers créés).

Décisions applicables (`decisions.md`) : D420, D422, D466, D469, D470, D473, D475, D483, D548, D589, et celles de cette fiche, D601 à D605.

### Contexte vérifié (ne pas re-découvrir)

- `calculerMarge(ventes: VenteMarge[]): ResultatMarge` (`src/pharmacie/domaine/marge.ts`, PB04, D475) est la seule règle de marge : allocations `REMPLACEE` ignorées ; ligne avec une allocation `PROVISOIRE` comptée dans `provisoires` ; vente non valorisable si une allocation restante a un coût 0 ou un lot technique, ou si une ligne n'a aucune allocation (ventes historiques) ; sinon valorisée. **La réutiliser telle quelle, ne pas la modifier.** Un lot à coût 0 (lot technique de reprise, lot trouvé à l'inventaire D589, réception ou upsert sans coût) donne donc une vente non valorisable, jamais une marge à 100 %.
- `AllocationLot` : `ligneVenteId`, `quantite` (UM, signée), `coutUnitaire` (copie du lot), `lotTechnique` (copie), `statut` (`DEFINITIVE`, `PROVISOIRE`, `REMPLACEE`). `LigneVente.sousTotal` = montant de ligne signé. `Vente` : `pointDeVenteId`, `jourMetier` (`@db.Date`), `typePiece` (`VENTE`, `ANNULATION`, `REGULARISATION`), `statut` (gelé depuis M6 : les nouvelles pièces sont toutes `VALIDEE`, seules des ventes historiques sont `ANNULEE`, sans pièce liée, D550). Index `(pointDeVenteId, jourMetier)`.
- `LotStock` : `stockMedicamentId`, `pointDeVenteId`, `numeroLot?`, `dateExpiration?` (`@db.Date`), `coefficientReception`, `coutUnitaire` (0 = inconnu), `lotTechnique`, relation `agregat` (`AgregatStockLot`, `quantite` >= 0) et `stockMedicament` (`prixUnitaire` Int? = prix de la boîte, `archiveLe`, relation `medicament` avec `nom`).
- `ParametresPharmacie` (clé `structureId`) : `horizonsPeremptionJours Int[]` (1 à 5 entiers distincts de 1 à 365 rangés en ordre décroissant, D483, défaut `{90,30,7}`), `debutFiabiliteMarge DateTime`.
- Point de vente de la pharmacie : `prisma.pointDeVente.findUnique({ where: { structureId_ordre: { structureId, ordre: 1 } } })` (modèle : `AnomaliesService.lister`, `src/pharmacie/anomalies/anomalies.service.ts`).
- `AccesPharmacieService.verifier(structureId, userId)` (404 pharmacie introuvable, 403 sinon). `PermissionsService.getUserPermissions(userId)` ; motif `peutVoirMarge` à recopier depuis `ReceptionsService` (`src/pharmacie/receptions/receptions.service.ts`, lignes 224 à 228). `masquerCouts`, `cheminsCout` (`src/pharmacie/masquer-couts.ts`).
- Outils : `jourConakry` (`src/pharmacie/jour-metier.ts`), `dateVersJour`, `jourVersDate` (`src/pharmacie/stock/lecture-stock.ts`), `arrondiGnf`, `umVersBoites`, `exigerEntier` (`src/pharmacie/domaine/quantites.ts`), `estPerime` (`src/pharmacie/domaine/selection-lots.ts`, valide le jour et la date, « périmé » si date < jour, le jour même reste vendable, D473), `jourValide` (`src/pharmacie/domaine/reception.ts`).
- Modèles à copier : `src/pharmacie/anomalies/anomalies.controller.ts` (gardes, Swagger), `src/pharmacie/receptions/receptions.http.spec.ts` (module de test HTTP, profils), `src/pharmacie/dto/sessions-caisse.dto.ts` (`ListerSessionsQueryDto`, `@Matches(/^\d{4}-\d{2}-\d{2}$/)`), `test/db/inventaire.db-spec.ts` (préparation, `sql`, `nouvelleFiche`, `recevoir`, `vendre`, `annuler`, `soldeLot`, `jour(n)`).
- Ne jamais importer `src/pharmacie/pharmacie.service.ts` depuis les fichiers créés ici.

### 1. `src/pharmacie/domaine/peremption.ts` (nouveau, règles pures, D469, D602, D603)

Aucun import de Nest, de Prisma ni de fichier hors `src/pharmacie/domaine/`. Aucune horloge (`new Date()` et `Date.now()` interdits ; `Date.UTC` permis).

```ts
import { arrondiGnf, exigerEntier, umVersBoites } from './quantites';
import { estPerime } from './selection-lots';

export interface LotAlerte {
  lotId: string;
  stockId: string;
  nom: string;
  numeroLot: string | null;
  /** AAAA-MM-JJ, nul = sans date de péremption. */
  dateExpiration: string | null;
  /** Solde du lot en UM ; un lot à solde <= 0 est ignoré. */
  quantite: number;
  coefficientReception: number;
  /** Prix de la boîte de la fiche ; nul ou 0 = prix inconnu. */
  prixBoite: number | null;
  /** GNF par UM ; 0 = coût inconnu. */
  coutUnitaire: number;
  lotTechnique: boolean;
  ficheArchivee: boolean;
}

export interface LotAlerteValorise {
  lotId: string;
  stockId: string;
  nom: string;
  numeroLot: string | null;
  dateExpiration: string;
  /** Jours entre le jour courant et la date (0 = périme aujourd'hui, négatif = périmé). */
  joursRestants: number;
  quantite: number;
  quantiteBoites: number;
  unitesEnPlus: number;
  lotTechnique: boolean;
  ficheArchivee: boolean;
  valeurVente: number | null;
  valeurCout: number | null;
  coutConnu: boolean;
}

export interface GroupeAlerte {
  nombreLots: number;
  valeurVente: number | null;
  nombreLotsSansPrix: number;
  valeurCout: number | null;
  nombreLotsCoutInconnu: number;
  lots: LotAlerteValorise[];
}

export interface ResultatAlertes {
  jour: string;
  horizons: (GroupeAlerte & { jours: number })[];
  perimes: GroupeAlerte;
  sansDate: { nombreLots: number };
}

/** Jours calendaires de `jour` à `date` (AAAA-MM-JJ tous deux, valeurs déjà validées). */
export function joursEntre(jour: string, date: string): number;

/** Classe les lots par horizon (D602) et les valorise (D603). */
export function classerAlertesPeremption(
  lots: LotAlerte[],
  horizons: number[],
  jour: string,
): ResultatAlertes;
```

Règles exactes :

1. `joursEntre` : `(Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / 86_400_000`, entier exact.
2. Validation (`RangeError` en français, D469) : `horizons` non vide, au plus 5 valeurs, chacune entier de 1 à 365 (`exigerEntier(h, 'horizon', 1)` puis contrôle `h <= 365`), sans doublon ; `estPerime` valide `jour` et chaque `dateExpiration` (appeler `estPerime(l.dateExpiration, jour)` pour chaque lot, même sans date) ; `exigerEntier(l.quantite, 'quantite', Number.MIN_SAFE_INTEGER)`, `exigerEntier(l.coefficientReception, 'coefficientReception', 1)`, `exigerEntier(l.coutUnitaire, 'coutUnitaire', 0)`, `prixBoite` nul ou `exigerEntier(prixBoite, 'prixBoite', 0)`.
3. Les lots à `quantite <= 0` sont ignorés (ni comptés ni listés).
4. Horizons rangés en ordre **décroissant** dans la réponse, quel que soit l'ordre reçu (`[7, 90, 30]` donne `[90, 30, 7]`).
5. Classement exclusif, chaque lot dans un seul groupe :
   - `dateExpiration` nulle : compté dans `sansDate.nombreLots`, non listé ;
   - `estPerime(date, jour)` (date < jour) : groupe `perimes` ;
   - sinon `j = joursEntre(jour, date)` (0 ou plus) : groupe du **plus petit** horizon `h` tel que `j <= h` ; si `j` dépasse le plus grand horizon, le lot n'est pas listé. Avec `[90, 30, 7]` : 0 à 7 jours dans `7`, 8 à 30 dans `30`, 31 à 90 dans `90`.
6. Valorisation d'un lot : `{ boites, unites } = umVersBoites(quantite, coefficientReception)` donnent `quantiteBoites` et `unitesEnPlus` ; `valeurVente = prixBoite ? arrondiGnf((quantite * prixBoite) / coefficientReception) : null` (prix nul ou 0 : `null`) ; `coutConnu = coutUnitaire > 0 && !lotTechnique` ; `valeurCout = coutConnu ? quantite * coutUnitaire : null`.
7. Totaux d'un groupe : `nombreLots` ; `nombreLotsSansPrix` = lots à `valeurVente` nulle ; `valeurVente` = somme des valeurs connues, mais `null` si le groupe a au moins un lot et qu'aucun n'a de valeur connue (0 pour un groupe vide) ; même règle pour `valeurCout` et `nombreLotsCoutInconnu`. Jamais de coût inconnu compté comme 0.
8. Tri des lots d'un groupe : `dateExpiration` croissante, puis `nom` (`localeCompare(b, 'fr')`), puis `lotId` (comparaison de chaînes `<`).

### 2. `src/pharmacie/dto/rapports.dto.ts` (nouveau)

```ts
export class RapportMargeQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Premier jour AAAA-MM-JJ (défaut : 1er du mois de au)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  du?: string;

  @ApiPropertyOptional({ example: '2026-10-27', description: 'Dernier jour AAAA-MM-JJ, inclus (défaut : aujourd hui)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  au?: string;
}
```

### 3. `src/pharmacie/rapports/rapports.service.ts` (nouveau)

`@Injectable() export class RapportsService`, constructeur `(prisma: PrismaService, accesPharmacie: AccesPharmacieService, permissions: PermissionsService)`. Méthode privée `peutVoirMarge(userId)` recopiée de `ReceptionsService`.

Constantes exportées :

```ts
export const PERIODE_MARGE_MAX_JOURS = 92;
export const HORIZONS_PAR_DEFAUT = [90, 30, 7];
export const MESSAGE_JOUR_INVALIDE = "Cette date n'existe pas. Utilisez le format AAAA-MM-JJ (exemple : 2026-10-01).";
export const MESSAGE_PERIODE_INVERSEE = 'La date de début doit être avant la date de fin.';
export const MESSAGE_PERIODE_TROP_LONGUE = 'La période ne peut pas dépasser 92 jours. Choisissez un mois ou un trimestre.';
```

#### 3.1 `alertesPeremption(structureId: string, userId: string)`

1. `await this.accesPharmacie.verifier(structureId, userId)` ; `peutVoirMarge` ; `jour = jourConakry(new Date())`.
2. `parametres = await prisma.parametresPharmacie.findUnique({ where: { structureId }, select: { horizonsPeremptionJours: true } })` ; `horizons = parametres?.horizonsPeremptionJours?.length ? parametres.horizonsPeremptionJours : HORIZONS_PAR_DEFAUT`. Aucune écriture (pas d'`assurerPointDeVente` sur une lecture).
3. Point de vente d'ordre 1 ; absent : `resultat = classerAlertesPeremption([], horizons, jour)`.
4. Sinon une seule requête : `limite = jourVersDate(jour)` plus `Math.max(...horizons)` jours (`new Date(limite.getTime() + max * 86_400_000)`) ;

```ts
prisma.lotStock.findMany({
  where: {
    pointDeVenteId,
    agregat: { is: { quantite: { gt: 0 } } },
    OR: [{ dateExpiration: null }, { dateExpiration: { lte: limite } }],
  },
  select: {
    id: true, stockMedicamentId: true, numeroLot: true, dateExpiration: true,
    coefficientReception: true, coutUnitaire: true, lotTechnique: true,
    agregat: { select: { quantite: true } },
    stockMedicament: { select: { prixUnitaire: true, archiveLe: true, medicament: { select: { nom: true } } } },
  },
})
```

   puis conversion en `LotAlerte` (`dateExpiration` par `dateVersJour`, `ficheArchivee = archiveLe !== null`, `prixBoite = prixUnitaire`, `quantite = agregat?.quantite ?? 0`) et `classerAlertesPeremption`. Les lots d'une fiche archivée sont gardés (de l'argent reste en rayon, D602).
5. Réponse : `{ data: masquerCouts(resultat, peutVoirMarge), message, success: true }`, `message` = `` `${n} lot(s) à surveiller.` `` où `n` = somme des `nombreLots` des horizons plus `perimes.nombreLots`.

Sans `marge:read`, `masquerCouts` retire `valeurCout`, `coutConnu` et `nombreLotsCoutInconnu` partout (D466) ; `valeurVente` reste (le prix de vente n'est pas un coût).

#### 3.2 `rapportMarge(structureId: string, userId: string, dto: RapportMargeQueryDto)`

1. `await this.accesPharmacie.verifier(structureId, userId)` ; `aujourdhui = jourConakry(new Date())`.
2. `au = dto.au ?? aujourdhui` ; `du = dto.du ?? au.slice(0, 8) + '01'`.
3. Contrôles dans cet ordre, chacun `BadRequestException({ message, code: 'VALIDATION', champs: [{ champ, contraintes: [c] }] })` :
   - `!jourValide(du)` : champ `du`, contrainte `jourInvalide`, `MESSAGE_JOUR_INVALIDE` ; puis de même pour `au` ;
   - `du > au` : champ `du`, contrainte `periodeInversee`, `MESSAGE_PERIODE_INVERSEE` ;
   - `joursEntre(du, au) + 1 > PERIODE_MARGE_MAX_JOURS` : champ `au`, contrainte `periodeMaximale`, `MESSAGE_PERIODE_TROP_LONGUE`.
4. `parametres = findUnique({ where: { structureId }, select: { debutFiabiliteMarge: true } })` ; `debutFiabilite = parametres ? dateVersJour(parametres.debutFiabiliteMarge) : null`.
5. Point de vente d'ordre 1 ; absent : aucune pièce.
6. Sinon :

```ts
prisma.vente.findMany({
  where: {
    pointDeVenteId,
    jourMetier: { gte: jourVersDate(du), lte: jourVersDate(au) },
    statut: 'VALIDEE',
  },
  select: {
    id: true,
    lignes: { select: { sousTotal: true, allocations: { select: { quantite: true, coutUnitaire: true, lotTechnique: true, statut: true } } } },
  },
})
```

   Toutes les natures de pièce entrent (une pièce d'annulation compte par son signe, D475) ; `statut: 'VALIDEE'` écarte seulement les ventes historiques annulées par l'ancien système, qui n'ont pas de pièce d'annulation (D604). Conversion en `VenteMarge` (`montantLigne = sousTotal`) puis `calculerMarge`.
7. Réponse `data` :

```ts
{
  du, au,
  debutFiabilite,                 // AAAA-MM-JJ ou null
  periodeAvantFiabilite,          // debutFiabilite !== null && du < debutFiabilite
  nombrePieces,                   // nombre de pièces lues
  chiffreAffairesTotal,           // somme des sousTotal de toutes les lignes lues
  chiffreAffairesValorise, coutAlloue, marge,
  nonValorisable: { nombreVentes, nombreLignes, chiffreAffaires },
  provisoires: { nombreLignes, chiffreAffaires },
}
```

   `message` : `` `Marge du ${du} au ${au}.` ``. Pas de `masquerCouts` : la garde exige `marge:read` (D605). `chiffreAffairesTotal` vaut `chiffreAffairesValorise + nonValorisable.chiffreAffaires + provisoires.chiffreAffaires` (vérifié par test). Aucun taux en pourcentage (le front le calcule).

### 4. `src/pharmacie/rapports/rapports.controller.ts` (nouveau)

Calqué sur `AnomaliesController` : `@ApiTags('Pharmacie : alertes et marge')`, `@ApiBearerAuth()`, `@Controller('pharmacie')`, `@UseGuards(AuthGuard, PermissionsGuard)`.

- `@Get(':structureId/stock/alertes-peremption')`, `@RequirePermissions(PERMISSIONS.STOCK_READ)`, `alertesPeremption(@Req() req, @Param('structureId') structureId)` qui appelle `this.rapports.alertesPeremption(structureId, req.user.userId)`. Swagger : « Lots à surveiller : horizons des paramètres (défaut 90, 30, 7 jours), chaque lot dans le plus petit horizon qui le contient, périmés à part, lots sans date comptés. valeurVente au prix de la boîte ; valeurCout, coutConnu et nombreLotsCoutInconnu seulement avec marge:read ; un lot à coût inconnu (reprise, trouvé à l'inventaire, reçu sans coût) n'est jamais compté pour 0. »
- `@Get(':structureId/rapports/marge')`, `@RequirePermissions(PERMISSIONS.MARGE_READ)`, `rapportMarge(@Req() req, @Param('structureId') structureId, @Query() dto: RapportMargeQueryDto)`. Swagger : « Marge réelle depuis les allocations de lot, pièces d'annulation comprises par leur signe. Une vente dont un lot a un coût inconnu ou est un lot technique est non valorisable (à part, jamais comptée à 100 %) ; une ligne vendue sans stock attend son rattachement (provisoires). Période de 92 jours au plus (400 VALIDATION). debutFiabilite : avant cette date, les ventes n'ont pas de coût. »

### 5. `src/pharmacie/pharmacie.module.ts`

Ajouter `RapportsController` à `controllers` (après `AnomaliesController`) et `RapportsService` à `providers` (après `AnomaliesService`). Rien d'autre.

### 6. Tests unitaires

`src/pharmacie/domaine/peremption.spec.ts` (7 tests, jour fixe `'2026-11-01'`, horizons `[90, 30, 7]`, prix 8 000, coefficient 10, sauf mention) :

1. « classement exclusif par le plus petit horizon » : dates J+0, J+7 dans `7` ; J+8, J+30 dans `30` ; J+31, J+90 dans `90` ; J+91 absent de partout ; J-1 dans `perimes` (`joursRestants` -1) ; date nulle : `sansDate.nombreLots` 1 et listé nulle part.
2. « horizons rangés en ordre décroissant » : `[7, 90, 30]` donne `horizons.map(h => h.jours)` = `[90, 30, 7]` ; `[60, 30]` : J+45 dans `60`, J+5 dans `30`.
3. « valorisation d'un lot » : quantité 25, coefficient 10, prix 8 000, coût 500 : `quantiteBoites` 2, `unitesEnPlus` 5, `valeurVente` 20 000, `valeurCout` 12 500, `coutConnu` vrai.
4. « coût inconnu jamais compté pour 0 » : coût 0 : `valeurCout` null, `coutConnu` faux ; lot technique à coût 300 : `valeurCout` null ; groupe de deux lots, l'un à coût 500 (quantité 10), l'autre à coût 0 : `valeurCout` 5 000, `nombreLotsCoutInconnu` 1 ; groupe dont tous les lots ont un coût inconnu : `valeurCout` null ; groupe vide : `valeurCout` 0, `valeurVente` 0, `nombreLots` 0.
5. « prix inconnu » : `prixBoite` null puis 0 : `valeurVente` null, `nombreLotsSansPrix` compté, groupe entièrement sans prix : `valeurVente` null.
6. « lots ignorés et tri » : solde 0 et -3 ignorés ; trois lots de même groupe : tri par date, puis nom (« Amoxicilline » avant « Paracétamol »), puis `lotId`.
7. « entrées refusées » : horizons `[]`, `[0]`, `[400]`, `[30, 30]`, six horizons, jour `'2026-13-01'` : `RangeError`.

`src/pharmacie/rapports/rapports.http.spec.ts` (5 tests, module de test calqué sur `receptions.http.spec.ts`, `RapportsService` simulé `{ alertesPeremption, rapportMarge }`) ; profils `titulaire` (`stock:read`, `marge:read`), `vendeur` (`stock:read`, `vente:write`, `caisse:utiliser`), `caissier` (`caisse:utiliser`) :

1. vendeur `GET /pharmacie/s1/stock/alertes-peremption` : 200, `alertesPeremption` appelé avec `('s1', 'vendeur')`.
2. caissier, même route : 403, service non appelé.
3. vendeur `GET /pharmacie/s1/rapports/marge` : 403, `rapportMarge` non appelé.
4. titulaire `GET /pharmacie/s1/rapports/marge?du=2026-10-01&au=2026-10-27` : 200, appelé avec `('s1', 'titulaire', { du: '2026-10-01', au: '2026-10-27' })`.
5. titulaire `?du=2026-1-1` : 400, `code` `VALIDATION`, `champs` contient `{ champ: 'du', contraintes: ['matches'] }`.

### 7. `test/db/rapports-pharmacie.db-spec.ts` (nouveau, 14 tests)

Préparation calquée sur `test/db/inventaire.db-spec.ts` (base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations après ; services construits à la main : `AccesPharmacieService`, `MouvementsStockService`, `SessionsCaisseService`, `VenteService`, `ReceptionsService`, `InventairesService`, `RapportsService`). Constantes `PHARMACIE = 'str-pharma-1'`, `VENDEUR = 'usr-pharm-p1'`, `RESPONSABLE = 'usr-admin-p1'`, `AUTRE = 'usr-admin-p2'`. Permissions simulées : `RESPONSABLE` : `vente:write`, `vente:annuler`, `caisse:utiliser`, `stock:read`, `stock:write`, `reception:write`, `inventaire:write`, `marge:read` ; tout autre : `vente:write`, `caisse:utiliser`, `stock:read`. Recopier `refus`, `sql`, `compter`, `pointDeVente`, `nouvelleFiche` (paramètres ajoutés `prix` défaut 8 000 et `coef` défaut 1, préfixe d'identifiant `rap-`, catégorie `'Test PB16a'`), `recevoir`, `jour(n)`, `soldeLot`. Ventes : `service.creerVente(PHARMACIE, utilisateur, { lignes, ordonnanceVerifiee: true }, undefined, '127.0.0.1')`. Rapport : `rapports.rapportMarge(PHARMACIE, RESPONSABLE, { du: jour(0), au: jour(0) })`. Les tests de marge comparent un rapport avant et après l'action (écarts), pour ne pas dépendre des autres tests. Les tests s'exécutent dans l'ordre du fichier (le test 1 doit rester le premier).

1. « ventes historiques non valorisables, annulées historiques écartées » (avant toute vente du fichier) : `bornes` = `SELECT min("jourMetier"), max("jourMetier") FROM "Vente" WHERE "pointDeVenteId" = $1` ; rapport sur ces bornes (`dateVersJour`) ; `nonValorisable.nombreVentes` = `SELECT count(*) ... "statut" = 'VALIDEE'` sur la même période ; `nonValorisable.chiffreAffaires` = somme des `sousTotal` de leurs lignes ; `chiffreAffairesValorise` 0, `coutAlloue` 0, `marge` 0 ; la fixture contient au moins une vente `ANNULEE` sur la période (assertion `> 0`) et `nombrePieces` = nombre de `VALIDEE` seulement.
2. « date de fiabilité » : `debutFiabilite` = `dateVersJour` de `"debutFiabiliteMarge"` lu en SQL ; `du = jour(-30), au = jour(0)` : `periodeAvantFiabilite` vrai ; `du = au = jour(0)` : faux.
3. « CA11 de bout en bout : coût par allocation » : fiche coefficient 10, prix 8 000 ; réception de deux lots : 2 boîtes à 5 000 la boîte, péremption J+30 ; 10 boîtes à 7 000, J+90 ; vente de 3 boîtes par `VENDEUR`. En base : deux allocations `DEFINITIVE`, 20 UM à 500 et 10 UM à 700. Écarts du rapport du jour : `chiffreAffairesValorise` +24 000, `coutAlloue` +17 000, `marge` +7 000, `nonValorisable` et `provisoires` inchangés.
4. « CA12 : lot technique de reprise » : lot technique de la fixture (requête : lot de `pv1`, `"lotTechnique"`, solde >= 2, fiche non archivée à prix > 0, seul lot de sa fiche, date nulle ou >= `CURRENT_DATE`) ; vente de 1 : `nonValorisable.nombreVentes` +1, `nonValorisable.chiffreAffaires` + total de la vente, `chiffreAffairesValorise`, `coutAlloue`, `marge` inchangés.
5. « CA12 : lot trouvé à l'inventaire, jamais une marge à 100 % » (réserve 2 de `rapports/PB15b-chef.md`) : fiche sans lot, prix 3 000 ; `inventaires.enregistrer(PHARMACIE, RESPONSABLE, { lignes: [{ stockId, quantiteComptee: 5, dateExpiration: jour(100) }] }, '127.0.0.1')` : nouveau lot à `coutUnitaire` 0 ; vente de 1 : `nonValorisable.nombreVentes` +1 et `chiffreAffaires` +3 000 ; `marge` et `chiffreAffairesValorise` inchangés.
6. « CA12 : lot reçu sans coût » : réception sans `coutAchatBoite` ; vente de 1 : non valorisable, `marge` inchangée.
7. « CA12 : vente mixte » : une vente de deux lignes, l'une sur la fiche du test 3 (1 boîte), l'autre sur le lot technique du test 4 (1) : `nonValorisable.nombreVentes` +1, `nonValorisable.nombreLignes` +1, `nonValorisable.chiffreAffaires` + total des deux lignes, `chiffreAffairesValorise` inchangé.
8. « provisoire puis rattachement » : fiche coefficient 1, prix 2 000, sans lot ; vente de 2 : `provisoires.nombreLignes` +1, `provisoires.chiffreAffaires` +4 000 ; réception de 5 à 1 200 (résolution PB14b) : par rapport au rapport d'avant la vente, `provisoires` revenu à l'identique, `chiffreAffairesValorise` +4 000, `coutAlloue` +2 400, `marge` +1 600.
9. « annulation : la pièce inverse annule la marge » : nouvelle vente valorisée de 1 boîte sur la fiche du test 3, puis `service.annulerVente(PHARMACIE, venteId, RESPONSABLE, { motif: 'Erreur de quantité' }, '127.0.0.1')` : rapport après annulation identique au rapport d'avant la vente sur `chiffreAffairesValorise`, `coutAlloue` et `marge` ; `nombrePieces` +2.
10. « cohérence des totaux » : rapport du jour : `chiffreAffairesTotal` = valorisé + non valorisable + provisoires.
11. « période refusée » : `du '2026-02-30'` : 400 `VALIDATION`, champ `du`, `jourInvalide` ; `du = jour(0), au = jour(-1)` : `periodeInversee` sur `du` ; `du = jour(-92), au = jour(0)` : `periodeMaximale` sur `au` ; `du = jour(-91), au = jour(0)` accepté ; sans `du` ni `au` : `au` = `jour(0)`, `du` = `jour(0).slice(0, 8) + '01'`.
12. « CA14 de bout en bout : alertes par lot valorisées au coût » : fiche coefficient 10, prix 8 000 ; réception : lot A 10 boîtes à 5 000, J+5 ; lot B 2 boîtes sans coût, J+20 ; lot C 3 boîtes à 7 000, J+60 ; lot D 1 boîte à 5 000, J+200 ; lot E 4 boîtes à 6 000, J+10, puis `UPDATE "LotStock" SET "dateExpiration" = CURRENT_DATE - 3 WHERE "id" = $1` (date seule modifiable, trigger PB07). `alertesPeremption(PHARMACIE, RESPONSABLE)`, lots de la fiche seulement (filtre par `stockId`) : `horizons.map(h => h.jours)` = `[90, 30, 7]` ; A dans `7` (`joursRestants` 5, `quantite` 100, `quantiteBoites` 10, `unitesEnPlus` 0, `valeurVente` 80 000, `valeurCout` 50 000, `coutConnu` vrai) ; B dans `30` (`valeurCout` null, `coutConnu` faux, `valeurVente` 16 000) ; C dans `90` (`valeurCout` 21 000) ; D absent ; E dans `perimes` (`joursRestants` -3, `valeurCout` 24 000) ; le groupe `30` a `nombreLotsCoutInconnu` >= 1.
13. « CA14 : le vendeur reçoit les mêmes lots sans aucune donnée de coût » : `alertesPeremption(PHARMACIE, VENDEUR)` : `cheminsCout(reponse.data)` = `[]` et `reponse.data` égal (`toEqual`) à `masquerCouts(reponseTitulaire.data, false)`.
14. « horizons des paramètres, lot sans date, fiche archivée, autre pharmacie » : `UPDATE "ParametresPharmacie" SET "horizonsPeremptionJours" = '{60,30}' WHERE "structureId" = $1` (restauré à `{90,30,7}` en fin de test, dans un `finally`) ; lot à J+45 dans `60` ; réception « sans péremption » sur une autre fiche : `sansDate.nombreLots` augmente de 1 par rapport à l'appel précédent ; fiche archivée (`UPDATE "StockMedicament" SET "archiveLe" = now()`) : son lot reste listé avec `ficheArchivee` vrai ; `AUTRE` sur `PHARMACIE` : 403.

### 8. `CLAUDE.md` du dépôt back

Ajouter une puce après celle de PB15c : « **Alertes de péremption et marge (tranche pharmacie 1, PB16a)** : `GET /pharmacie/:structureId/stock/alertes-peremption` (`stock:read`) classe chaque lot en stock dans le plus petit horizon des paramètres (défaut 90, 30, 7 jours), périmés à part, lots sans date comptés ; valeur au prix de la boîte pour tous, valeur au coût seulement avec `marge:read` (masquerCouts), un coût inconnu n'est jamais compté pour 0. `GET /pharmacie/:structureId/rapports/marge?du=&au=` (`marge:read`, 92 jours au plus) réutilise `calculerMarge` : un lot à coût 0 (reprise, trouvé à l'inventaire, reçu sans coût) rend la vente non valorisable, provisoires à part, `debutFiabilite` affiché (D602 à D605). »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script (ni `cat >`, ni `tee`, ni `sed -i`, ni `node -e`, ni `python`) : le hook de garde ne voit pas les écritures faites par Bash. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh` (fins de ligne seulement, jamais commité). Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/pharmacie/domaine/peremption.ts`, `src/pharmacie/domaine/peremption.spec.ts`, `src/pharmacie/dto/rapports.dto.ts`, `src/pharmacie/rapports/rapports.service.ts`, `src/pharmacie/rapports/rapports.controller.ts`, `src/pharmacie/rapports/rapports.http.spec.ts`, `src/pharmacie/pharmacie.module.ts`, `test/db/rapports-pharmacie.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/domaine/peremption.ts src/pharmacie/domaine/peremption.spec.ts src/pharmacie/dto/rapports.dto.ts src/pharmacie/rapports/rapports.service.ts src/pharmacie/rapports/rapports.controller.ts src/pharmacie/rapports/rapports.http.spec.ts src/pharmacie/pharmacie.module.ts test/db/rapports-pharmacie.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `peremption.spec.ts` (7) et `rapports.http.spec.ts` (5) ; `marge.spec.ts` vert et inchangé.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/rapports-pharmacie.db-spec.ts` (14 tests) ; les autres db-specs verts et inchangés.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes src/pharmacie/domaine/marge.ts` vide.
6. Lecture seule : `grep -rn "\.create\|\.update\|\.delete\|\$executeRaw" src/pharmacie/rapports src/pharmacie/domaine/peremption.ts` : aucune ligne.
7. Domaine pur : `grep -n "new Date(\|Date.now\|@nestjs\|generated/prisma" src/pharmacie/domaine/peremption.ts` : aucune ligne.
8. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-31 | spécifié (codeur Sonnet, vérificateur Sonnet) | PASS, validé par le chef (rapports/PB16a-verification.md, rapports/PB16a-chef.md) | écarts acceptés : RangeError par jourValide sur un jour inexistant, to_char dans les tests db 1 et 2, fabrique à J+3

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | 0 erreur | voir commit
docker compose exec -T backend npx eslint (8 fichiers de la fiche) | 0 erreur, 0 avertissement | voir commit
docker compose exec -T backend npm test | 90 suites, 996 réussis, 3 ignorés, 0 échec | voir commit
docker compose exec -T backend npm run test:db | 25 suites, 305 réussis, 0 échec | voir commit
