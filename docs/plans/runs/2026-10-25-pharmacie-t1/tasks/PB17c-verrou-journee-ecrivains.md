# PB17c - Journée clôturée : refus des écritures directes, rattachement, CA20, courses

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur lus par les vendeurs et le titulaire, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Dernière des trois sous-fiches de PB17 (D612), après PB17a et PB17b (validées et commitées). Autonome, gate verte, commitée seule.

PB17c branche la journée clôturée sur les écrivains :

- chaque écrivain de caisse prend le verrou de journée **partagé** en première instruction de sa transaction (D613) : vente, annulation, ouverture de caisse, comptage, mouvement de caisse, fermeture ;
- une caisse dont le jour métier est clôturé (seul cas : caisse desktop restée ouverte après une clôture forcée, D618) refuse toute écriture : 409 `JOURNEE_CLOTUREE` (D624) ;
- une caisse ouverte après la clôture du jour compte pour le lendemain (D615) : aucune vente n'est refusée pour ce motif ;
- une réception datée d'un jour antérieur clôturé est refusée (D614) ;
- tests d'intégration CA20 (refus d'écriture directe ; correction par annulation rattachée au jour en cours qui pointe l'origine), courses clôture contre écriture.

Inventaire des écritures, verdict (D614), à ne pas étendre :

| Écriture | Jour concerné | Effet de PB17c |
|---|---|---|
| Vente, annulation (pièces `Vente`) | jour métier de la caisse de l'auteur (D435, D547) | verrou partagé ; refus si la caisse existante est d'un jour clôturé ; nouvelle caisse rattachée au jour suivant si aujourd'hui est clôturé |
| Ouverture de caisse | jour de rattachement | idem |
| Comptage, mouvement de caisse, fermeture (et `ResultatSessionMode`) | jour métier de la caisse | verrou partagé ; refus si clôturé |
| Paiements | portés par la vente ou l'annulation | couverts par elles |
| Réception (`recueLe`) | jour de `recueLe` | refus seulement si `recueLe` tombe un jour **antérieur** à aujourd'hui et clôturé |
| Journal de stock (inventaire, sortie, correction de quantité, upsert et import, qualification, correction de date de lot, résolution des provisoires d'une vente d'un jour clôturé) | aucun : horodaté au moment présent, jamais antidaté | inchangé, jamais refusé |
| Traitement d'une anomalie, paramètres, postes | flux de travail, pas une pièce | inchangé |

**Aucune migration, aucun changement de `prisma/schema.prisma`.** Aucun constructeur ne change (les aides de `journee.ts` sont des fonctions). Ne modifier ni les règles ni les tests de PB17a et PB17b.

Décisions applicables : D435, D507, D527, D536, D545, D547, D554, D559, D567, D570, D572, D612 à D615, D618, D624, D625, D626.

### Contexte vérifié (ne pas re-découvrir)

- `src/pharmacie/caisse/journee.ts` (PB17a) : `verrouillerJourneesPartage(tx, structureId)`, `exigerJourOuvert(client, pointDeVenteId, jour, message?)` (409 `JOURNEE_CLOTUREE`), `jourDeRattachement(client, pointDeVenteId, maintenant)` (`{ jour, jourReel }`), `messageCaisseJourneeCloturee(jour)`, `messageReceptionJourneeCloturee(jour)`. `jourLisible`, `lendemain` dans `src/pharmacie/jour-metier.ts`. `ClotureService.cloturer` prend le verrou exclusif en tête.
- Les verrous consultatifs sont réentrants dans une transaction : reprendre le verrou partagé déjà tenu ne fait jamais attendre.
- `SessionsCaisseService` (`src/pharmacie/caisse/sessions-caisse.service.ts`) :
  - `ouvrir` appelle `prisma.$transaction((tx) => this.ouvrirDansTransaction(tx, ...))` ;
  - `ouvrirDansTransaction(tx, entree)` (lignes 541 à 642) : verrou du poste (`FOR UPDATE OF p`), puis session connue par `sessionId` ou session OUVERTE du poste (`existante`), comptage d'ouverture éventuel, sinon création avec `jourMetier: new Date(`${jourConakry(maintenant)}T00:00:00.000Z`)` ; renvoie `{ session, ouverteMaintenant }` ; réutilisée par la vente et l'annulation (`VenteService.ouvrirSessionVerrouillee`, lignes 926 à 964) ;
  - `saisirComptage` (277 à 298), `enregistrerMouvement` (300 à 368), `fermer` (388 à 506) : transaction qui commence par `verrouillerSession(tx, sessionId)`, puis contrôle du statut (`leverSessionFermee`, ou bilan rejoué « Cette session était déjà fermée. » pour `fermer`).
- `VenteService` (`src/pharmacie/vente.service.ts`) : `enregistrerVente(tx, entree)` (ligne 404, corps de la transaction de création, étape 1 = lecture des fiches) ; `annulerVente` : `prisma.$transaction(async (tx) => { // 1. Origine ...` (ligne 1122).
- `ReceptionsService.enregistrerDansTransaction` (`src/pharmacie/receptions/receptions.service.ts`, lignes 234 à 309) : 1. point de vente (`assurerPointDeVente` s'il manque), 2. rejeu par identifiant, 3. fournisseur, 4. refus d'une date dans le futur, 5. verrous de ligne des fiches. L'import de livraison passe `recueLe: new Date()`.
- Modèles de tests : `test/db/annulation.db-spec.ts` (préparation, `refus`, `sql`, `compter`, `nouvelleFiche`, `nouveauLot`, `vendre`, `annuler`, `soldeLot`, `prochainNumero`), `test/db/clotures.db-spec.ts` (PB17a : `ClotureService`, recul de `debutCaisse`), `test/db/qualification.db-spec.ts` (`attendreAttentes`, transaction de test qui tient un verrou jusqu'à libération), `test/db/sessions-caisse.db-spec.ts` (`coupures`).

### 1. `src/pharmacie/caisse/sessions-caisse.service.ts`

1. Importer `verrouillerJourneesPartage`, `exigerJourOuvert`, `jourDeRattachement`, `messageCaisseJourneeCloturee` de `./journee` et `jourLisible` de `../jour-metier`.
2. Message exporté : `export function messageOuvertureJourSuivant(jour: string): string` = `` `Caisse ouverte. La journée d'aujourd'hui est déjà clôturée : cette caisse compte pour le ${jourLisible(jour)}.` ``.
3. `ouvrirDansTransaction` :
   - première instruction : `await verrouillerJourneesPartage(tx, structureId);` (avant le verrou du poste) ;
   - dès que `existante` est connue (session rejouée par `sessionId` ou session OUVERTE du même utilisateur), avant tout comptage : `const jourExistante = jourConakry(existante.jourMetier); await exigerJourOuvert(tx, existante.pointDeVenteId, jourExistante, messageCaisseJourneeCloturee(jourExistante));` ; l'ordre des refus existants (`POSTE_INCONNU`, `SESSION_FERMEE`, `IDENTIFIANT_DEJA_UTILISE`, `SESSION_AUTRE_UTILISATEUR`) est inchangé et passe avant ;
   - création : `const { jour, jourReel } = await jourDeRattachement(tx, poste.pointDeVenteId, maintenant);` puis `jourMetier: new Date(`${jour}T00:00:00.000Z`)` et `jourMetierOrigine: jour !== jourReel ? new Date(`${jourReel}T00:00:00.000Z`) : null` ;
   - type de retour : `{ session; ouverteMaintenant; rattacheeAuJourSuivant: boolean }` (vrai seulement pour une session créée avec `jour !== jourReel`, faux pour une session existante). Les appelants qui déstructurent `session` et `ouverteMaintenant` ne changent pas.
4. `ouvrir` : message `rattacheeAuJourSuivant ? messageOuvertureJourSuivant(session.jourMetier) : (ouverteMaintenant ? 'Caisse ouverte.' : 'Votre caisse était déjà ouverte.')` ; `data` inchangé.
5. `saisirComptage`, `enregistrerMouvement`, `fermer` : première instruction de la transaction `await verrouillerJourneesPartage(tx, structureId);`, puis le code existant ; juste après le contrôle de statut existant (pour `fermer` : après le bloc qui rejoue le bilan d'une session non OUVERTE ; pour `enregistrerMouvement` : avant la recherche de rejeu par `dto.id`) : `const jourSession = jourConakry(s.jourMetier); await exigerJourOuvert(tx, s.pointDeVenteId, jourSession, messageCaisseJourneeCloturee(jourSession));`.
6. `bilan`, `courante`, `listerDuJour`, `calculerBilan` : inchangés (lectures).

### 2. `src/pharmacie/vente.service.ts`

1. Importer `verrouillerJourneesPartage` de `./caisse/journee`.
2. `enregistrerVente` : première instruction, avant « 1. Fiches » : `// 0. Verrou de journée partagé (D613) : aucune clôture ne s'intercale` puis `await verrouillerJourneesPartage(tx, structureId);`.
3. `annulerVente` : première instruction du rappel de `$transaction`, avant « 1. Origine » : même ligne, même commentaire.
4. Rien d'autre : le refus d'une caisse d'un jour clôturé et le rattachement au jour suivant passent par `ouvrirDansTransaction`, appelée par `ouvrirSessionVerrouillee`. `Vente.jourMetierOrigine` n'est pas écrit (reste nul ; PB18 l'écrira pour une régularisation, D625). L'ordre des verrous devient : journées (partagé), poste, session, puis `CompteurTicket` (vente) ou vente d'origine (annulation), puis fiches (précise D527, D545).

### 3. `src/pharmacie/receptions/receptions.service.ts`

Dans `enregistrerDansTransaction`, après « 4. Pas de réception datée dans le futur » :

```ts
// 4b. Réception datée d'un jour antérieur clôturé (D614) ; le jour même reste permis
const jourRecu = jourConakry(entree.recueLe);
if (jourRecu < jourConakry(new Date())) {
  await verrouillerJourneesPartage(tx, structureId);
  await exigerJourOuvert(tx, pointDeVenteId, jourRecu, messageReceptionJourneeCloturee(jourRecu));
}
```

Imports : `verrouillerJourneesPartage`, `exigerJourOuvert`, `messageReceptionJourneeCloturee` de `../caisse/journee`. Ce verrou n'est pas la première instruction (lecture du point de vente avant) : permis, aucune ligne de caisse ni de fiche n'est encore verrouillée (D613).

### 4. `test/db/journee-cloturee.db-spec.ts` (nouveau, 10 tests)

Préparation calquée sur `test/db/annulation.db-spec.ts` ; services à la main : `AccesPharmacieService`, `MouvementsStockService`, `SessionsCaisseService`, `VenteService`, `PointsDeVenteService`, `ReceptionsService(prisma, acces, mouvements, permissions)`, `ClotureService(prisma, acces)`. Permissions simulées : `RESPONSABLE` (`usr-admin-p1`, Fatoumata Camara) : `vente:write`, `vente:annuler`, `caisse:utiliser`, `caisse:superviser`, `cloture:gerer`, `reception:write`, `stock:read`, `stock:write`, `marge:read` ; `VENDEUR` (`usr-pharm-p1`) : `vente:write`, `caisse:utiliser`. Recopier `refus`, `sql`, `compter`, `nouvelleFiche`, `nouveauLot`, `soldeLot`, `prochainNumero` (d'`annulation.db-spec.ts`), `coupures`, `attendreAttentes`. `jour(n)` comme ailleurs ; `demain = lendemain(jour(0))` ; `ip = '127.0.0.1'`. L'aide `vendre` de ce fichier a la forme `vendre(utilisateur, stockId, quantite, posteId?)` = `service.creerVente(PHARMACIE, utilisateur, { lignes: [{ stockId, quantite }], ordonnanceVerifiee: true, ...(posteId ? { posteId } : {}) }, undefined, ip)` (quantité en boîtes, coefficient 1).

Aides propres :
- `etatDuJour()` : `{ pieces: count Vente WHERE "pointDeVenteId" = pv1 AND "jourMetier" = jour(0), sessions: liste (id, statut, clotureJournaliereId) des sessions de jour(0) triées par id, totaux: lignes TotalClotureMode de la clôture de jour(0) (mode, theorique, compte, ecart) triées, compteur: await prochainNumero() }`.
- `tenirJournees(mode: 'partage' | 'exclusif', apres?: (tx) => Promise<void>)` : transaction de test (`maxWait 5_000`, `timeout 30_000`) qui prend `verrouillerJourneesPartage` ou `verrouillerJourneesExclusif`, signale, attend la libération, exécute `apres(tx)` s'il est fourni, puis se termine ; renvoie `{ tenu, liberer, fin }` (modèle `tenirFiche`).

Fiche F : `F = (await nouvelleFiche()).stockId` (prix de la boîte 1 000, coefficient 1 ; préfixes d'identifiant `jc-` au lieu de `annul-`, catégorie `'Test PB17c'`) et `lotF = await nouveauLot(F, { quantite: 100 })` (péremption J+200). Les tests s'exécutent dans l'ordre du fichier.

1. « avant clôture : la caisse compte pour aujourd'hui » : `V1 = vendre(VENDEUR, F, 2)` (sans poste : poste web par défaut, caisse `SV` ouverte automatiquement) ; `data.jourMetier` = `jour(0)` ; en base `SV` : `jourMetier` = `jour(0)`, `jourMetierOrigine` nul.
2. « clôture forcée avec un poste desktop ouvert » : `sessions.fermer(PHARMACIE, VENDEUR, SV, { comptageFermeture: { coupures: coupures({ 1000: 2 }) } })` (écart nul) ; poste desktop `D` (`postes.enregistrerPoste(PHARMACIE, RESPONSABLE, { type: 'DESKTOP', appareilId: 'desktop-essai-pb17c' })`), `SD = sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: D })` ; `V2 = vendre(RESPONSABLE, F, 1, D)` ; `clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: jour(0) }, ip)` : 409 `CLOTURE_INCOMPLETE` ; avec `forcer: true, motifForcage: 'Poste D hors ligne'` : 200, `forcee` vrai, `postesManquants[0].sessionId` = `SD` ; `SV` `INCLUSE_DANS_CLOTURE`, `SD` `OUVERTE`. `avant = await etatDuJour()`.
3. « CA20 : la journée clôturée refuse toute écriture directe » : chacun rejette 409 `JOURNEE_CLOTUREE` avec `messageCaisseJourneeCloturee(jour(0))` :
   - `vendre(RESPONSABLE, F, 1, D)` ;
   - `sessions.saisirComptage(PHARMACIE, RESPONSABLE, SD, { moment: 'OUVERTURE', coupures: [] })` ;
   - `sessions.enregistrerMouvement(PHARMACIE, RESPONSABLE, SD, { type: 'APPORT', montant: 10000, motif: 'Monnaie' })` ;
   - `sessions.fermer(PHARMACIE, RESPONSABLE, SD, { comptageFermeture: { coupures: [] } })` ;
   - `sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: D })` ;
   - `service.annulerVente(PHARMACIE, V1, RESPONSABLE, { motif: 'Erreur de quantité', posteId: D }, ip)`.
   Puis `etatDuJour()` égal à `avant` ; `soldeLot(lotF)` inchangé ; aucun `ComptageCaisse` ni `MouvementCaisse` sur `SD`. Statut avant journée : `sessions.saisirComptage(PHARMACIE, VENDEUR, SV, { moment: 'OUVERTURE', coupures: [] })` rejette toujours 409 `SESSION_FERMEE` ; `sessions.fermer(PHARMACIE, VENDEUR, SV, {})` répond 200 « Cette session était déjà fermée. ».
4. « rattachement au lendemain après la clôture » : `V3 = vendre(VENDEUR, F, 1)` : `data.jourMetier` = `demain` ; la nouvelle caisse `SV2` (≠ `SV`) a `jourMetier` = `demain` et `jourMetierOrigine` = `jour(0)` en base ; `sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: <nouveau poste web> })` : `message` = `messageOuvertureJourSuivant(demain)`, `data.jourMetier` = `demain`, `data.ouverteMaintenant` vrai. `etatDuJour()` toujours égal à `avant` sauf `compteur` (+1, la vente V3).
5. « CA20 : correction par annulation rattachée à la journée en cours, qui pointe l'origine » : `A = service.annulerVente(PHARMACIE, V1, RESPONSABLE, { motif: 'Erreur de quantité' }, ip)` (poste web par défaut du responsable) : `A.data.statut` `ANNULEE`, `A.data.annulation.numero` = `A-<numero de V1>` ; en base la pièce `ANNULATION` a `venteOrigineId` = `V1`, `jourMetier` = `demain`, une session de `jourMetier` `demain` ; `etatDuJour()` : `pieces`, `sessions`, `totaux` égaux à `avant` (le jour clôturé n'est pas touché) ; `soldeLot(lotF)` + 2 par rapport au test 4 et un mouvement `CORRECTION` pièce `ANNULATION` sur `lotF` ; `listerVentes(PHARMACIE, RESPONSABLE, { date: jour(0) })` liste `V1` avec `statut` `ANNULEE` et ne liste pas la pièce `A` ; la même liste à `demain` liste la pièce `A` (total négatif).
6. « réception datée d'un jour clôturé » : `INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES ('clo-essai-hier', pv1, $1::date, 'usr-admin-p1')` avec `jour(-1)` ; `receptions.enregistrer(PHARMACIE, RESPONSABLE, { recueLe: `${jour(-1)}T10:00:00.000Z`, lignes: [{ stockId: F, nombreBoites: 1, dateExpiration: jour(200) }] }, ip)` : 409 `JOURNEE_CLOTUREE`, message `messageReceptionJourneeCloturee(jour(-1))`, aucune `Reception` de plus ; `recueLe` = maintenant moins 60 s (aujourd'hui, clôturé) : acceptée ; `recueLe` = `${jour(-2)}T10:00:00.000Z` (non clôturé) : acceptée. Une sortie manuelle et un inventaire ne sont pas testés ici (jamais concernés, D614).
7. « course : la clôture attend une écriture de caisse en cours » : `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = 'str-pharma-1'` ; `h = tenirJournees('partage')` ; `await h.tenu` ; `p = clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: jour(-3) }, ip)` avec un drapeau `resolue` posé à la résolution ; `attendreAttentes(1)` ; `resolue` faux ; `h.liberer()` ; `await h.fin` ; `await p` réussit (`forcee` faux).
8. « course réelle sans interblocage » : pour `k` de 4 à 6 : `Promise.allSettled([clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: jour(-k) }, ip), vendre(VENDEUR, F, 1)])` : les deux `fulfilled` ; la vente a `jourMetier` `demain`.
9. « une annulation et une vente qui attendent une clôture en cours » : `h = tenirJournees('exclusif')` ; `await h.tenu` ; `v = vendre(VENDEUR, F, 1)` et `a = service.annulerVente(PHARMACIE, V3, RESPONSABLE, { motif: 'Erreur de prix' }, ip)` lancées ; `attendreAttentes(2)` ; `h.liberer()` ; `await h.fin` ; `v` et `a` réussissent (aucune clôture n'a été écrite par le test : elles se poursuivent normalement).
10. « une vente qui attendait la clôture voit la journée clôturée » (dernier : la caisse du vendeur devient inutilisable) : `h = tenirJournees('exclusif', (tx) => tx.$executeRaw`INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES ('clo-essai-demain', ${pv1}, ${demain}::date, 'usr-admin-p1')`)` (simule la clôture du jour de `SV2` ; le service refuse un jour futur, d'où l'insertion directe, commentée) ; `await h.tenu` ; `compteurAvant = prochainNumero()` ; `v = vendre(VENDEUR, F, 1)` ; `attendreAttentes(1)` ; `h.liberer()` ; `await h.fin` ; `v` rejette 409 `JOURNEE_CLOTUREE` (`messageCaisseJourneeCloturee(demain)`) ; aucune `Vente` créée après la libération, `prochainNumero()` = `compteurAvant`.

### 5. `CLAUDE.md` du dépôt back

Ajouter une puce après celle de PB17a : « **Journée clôturée (tranche pharmacie 1, PB17c)** : vente, annulation, ouverture de caisse, comptage, mouvement de caisse et fermeture prennent en tête de transaction le verrou de journée partagé (`verrouillerJourneesPartage`), la clôture le prend en exclusif : aucune écriture ne s'intercale. Ordre des verrous : journées, poste, session, compteur de tickets ou vente d'origine, fiches. Une caisse dont le jour métier est clôturé (caisse desktop restée ouverte après une clôture forcée) refuse toute écriture : 409 `JOURNEE_CLOTUREE`. Une caisse ouverte après la clôture du jour compte pour le lendemain (`jourMetierOrigine` = jour réel) : aucune vente n'est refusée pour ce motif. Une correction se fait par écriture inverse rattachée à la journée en cours qui pointe l'origine (annulation, CA20). Une réception datée d'un jour antérieur clôturé est refusée ; le journal de stock (inventaire, sortie, corrections, résolution des provisoires) est horodaté au présent et n'est jamais refusé (D614). »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script : le hook de garde ne voit pas les écritures faites par Bash. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/pharmacie/caisse/sessions-caisse.service.ts`, `src/pharmacie/vente.service.ts`, `src/pharmacie/receptions/receptions.service.ts`, `test/db/journee-cloturee.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/caisse/sessions-caisse.service.ts src/pharmacie/vente.service.ts src/pharmacie/receptions/receptions.service.ts test/db/journee-cloturee.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, sans aucun test modifié.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/journee-cloturee.db-spec.ts` (10) ; tous les autres db-specs (dont `sessions-caisse`, `vente`, `annulation`, `qualification`, `receptions`, `clotures`, `export-cloture`, `etancheite-couts`) verts et inchangés.
5. `git status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes src/pharmacie/caisse/journee.ts src/pharmacie/caisse/clotures.service.ts` vide.
6. Verrou en tête : dans chacune des transactions de `enregistrerVente`, `annulerVente`, `ouvrirDansTransaction`, `saisirComptage`, `enregistrerMouvement`, `fermer`, la première instruction est `verrouillerJourneesPartage` (relecture du chef, `grep -n "verrouillerJourneesPartage" src/pharmacie` : 7 appels, dont celui de la réception).
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
