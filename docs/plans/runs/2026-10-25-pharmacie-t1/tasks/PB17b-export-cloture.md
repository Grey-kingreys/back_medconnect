# PB17b - Export CSV d'une journée clôturée

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; fichier ouvert dans Excel par le titulaire ou son comptable, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Deuxième des trois sous-fiches de PB17 (D612), après PB17a (validée et commitée) et avant PB17c. Autonome, gate verte, commitée seule.

PB17b livre `GET /pharmacie/:structureId/caisse/clotures/:jour/export` (`cloture:gerer`) : un fichier CSV d'une journée **clôturée**, une ligne par pièce, par paiement et par mouvement de caisse, sans coût, sans client, sans médicament (D622) ; la classe `TEXTE` de l'inventaire CA22 pour lire ce fichier en entier (D623).

**Aucune migration, aucun changement de `prisma/schema.prisma`.** Ne modifier ni `vente.service.ts`, ni `sessions-caisse.service.ts`, ni `receptions.service.ts`, ni les règles de PB17a (`cloture-regles.ts`, `journee.ts`), ni les tests de PB17a.

Décisions applicables : D466, D517, D550, D551, D612, D618, D620, D622, D623.

### Contexte vérifié (ne pas re-découvrir)

- PB17a a créé `ClotureService` (`src/pharmacie/caisse/clotures.service.ts`, constructeur `(prisma, accesPharmacie)`, méthodes privées `contexte(structure)` et `validerJour(jour, debutCaisse)`), `ClotureController` (`src/pharmacie/caisse/clotures.controller.ts`), `src/pharmacie/caisse/journee.ts` (`estJourCloture`), `jourLisible`, `instantLisible` (`src/pharmacie/jour-metier.ts`).
- `Vente` (pièce) : `numero`, `typePiece` (`VENTE`, `ANNULATION`, `REGULARISATION`), `venteOrigineId` (relation `venteOrigine` avec `numero`), `jourMetier`, `createdAt`, `posteId` (relation `poste` avec `code`), `sessionCaisseId` (relation `sessionCaisse` avec `technique`, `statut`, `clotureJournaliereId`), `vendeurNom`, `total` (signé), `motifAnnulation` (motif d'une pièce d'annulation, D519), `clientNom`, `clientTelephone` (à ne jamais exporter), relation `paiements` (`montant` signé, `referenceExterne?`, `createdAt`, relation `modePaiement` avec `code`, `libelle`, `ordre`).
- `MouvementCaisse` : `sessionCaisseId`, `type` (`PRELEVEMENT`, `APPORT`, `REMBOURSEMENT`), `montant` (> 0), `motif`, `horodatageServeur`, relation `modePaiement` ; la session porte `jourMetier`, `technique`, `statut`, `clotureJournaliereId`, `utilisateurNom`, relation `poste`.
- Les sessions techniques (ventes historiques, D517) sont exclues de l'export.
- `StreamableFile` : modèle `PharmacieController.getModeleImportStock` (`src/pharmacie/pharmacie.controller.ts`, lignes 340 à 368 : `new StreamableFile(contenu, { type, disposition })`, `@ApiProduces`).
- CA22 : `test/etancheite-couts/routes-pharmacie.ts` (type `ClasseRoute`, `ROUTES_PHARMACIE`), `test/db/etancheite-couts.db-spec.ts` (`APPELS`, boucle du test « CA22 : le vendeur ne reçoit aucune donnée de coût ni de marge » qui saute les routes `FICHIER` après contrôle du type de contenu, lignes 735 à 738), `JOUR_CLOTURE` et le recul de `debutCaisse` ajoutés par PB17a ; `MOTIF_CLE_COUT` (`src/pharmacie/masquer-couts.ts`).

### 1. `src/pharmacie/caisse/export-cloture.ts` (nouveau, règles pures)

Imports permis : `../jour-metier` (`instantLisible`). Aucune horloge, aucun Nest, aucun Prisma.

```ts
export interface PieceExport {
  numero: string;
  typePiece: 'VENTE' | 'ANNULATION' | 'REGULARISATION';
  numeroOrigine: string | null;
  createdAt: Date;
  posteCode: string;
  vendeurNom: string;
  total: number;
  motif: string | null;          // motifAnnulation d'une pièce d'annulation, sinon null
  caisseIncluse: boolean;
  paiements: { libelleMode: string; ordreMode: number; codeMode: string; reference: string | null; montant: number; createdAt: Date }[];
}
export interface MouvementExport {
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';
  horodatage: Date;
  posteCode: string;
  utilisateurNom: string;
  libelleMode: string;
  montant: number;               // positif en base
  motif: string;
  caisseIncluse: boolean;
}
export const ENTETES_EXPORT_CLOTURE: readonly string[];
export function champCsv(valeur: string | number | null, texte: boolean): string;
export function exporterCloture(jour: string, pieces: PieceExport[], mouvements: MouvementExport[]): string;
```

Règles exactes :

1. `ENTETES_EXPORT_CLOTURE` = `Jour`, `Ligne`, `Numéro`, `Type de pièce`, `Pièce d'origine`, `Date et heure`, `Poste`, `Vendeur`, `Mode de paiement`, `Référence`, `Montant (GNF)`, `Motif`, `Caisse incluse dans la clôture` (13 colonnes, dans cet ordre).
2. `champCsv(valeur, texte)` : `null` donne une chaîne vide ; un nombre donne `String(n)` (entier, signe moins compris, aucun séparateur de milliers) ; pour un texte (`texte` vrai) commençant par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot, préfixer d'une apostrophe `'` (neutralise une formule Excel) ; puis, si la chaîne contient `;`, `"`, `\r` ou `\n`, l'entourer de guillemets et doubler chaque guillemet intérieur.
3. Fichier = `'\uFEFF'` (BOM, pour Excel) + lignes jointes par `'\r\n'` + `'\r\n'` final ; séparateur `;`. Première ligne : les en-têtes (passés par `champCsv(..., true)`).
4. Libellés : type de pièce `Vente`, `Annulation`, `Régularisation` ; type de mouvement `Prélèvement`, `Apport`, `Remboursement` ; `Ligne` vaut `Pièce`, `Paiement` ou `Mouvement de caisse` ; `Caisse incluse dans la clôture` vaut `Oui` ou `Non` ; `Date et heure` = `instantLisible(...)`.
5. Pièces triées par `createdAt` puis `numero` ; pour chaque pièce, sa ligne puis ses paiements triés par `ordreMode` puis `codeMode` :
   - ligne pièce : `jour`, `Pièce`, `numero`, type, `numeroOrigine`, `instantLisible(createdAt)`, `posteCode`, `vendeurNom`, vide, vide, `total`, `motif`, inclusion ;
   - ligne paiement : `jour`, `Paiement`, `numero` de la pièce, type de la pièce, `numeroOrigine`, `instantLisible(paiement.createdAt)`, `posteCode`, `vendeurNom`, `libelleMode`, `reference`, `montant` (signé, tel qu'en base), vide, inclusion.
6. Puis les mouvements triés par `horodatage` : `jour`, `Mouvement de caisse`, vide, libellé du type, vide, `instantLisible(horodatage)`, `posteCode`, `utilisateurNom`, `libelleMode`, vide, montant **signé** (`APPORT` positif, `PRELEVEMENT` et `REMBOURSEMENT` négatifs), `motif`, inclusion.
7. Colonnes texte (passées avec `texte` vrai) : toutes sauf `Montant (GNF)`.

### 2. `src/pharmacie/caisse/clotures.service.ts` (ajout)

Message exporté : `export function messageJourneeNonCloturee(jour: string): string` = `` `La journée du ${jourLisible(jour)} n'est pas encore clôturée : clôturez-la avant de l'exporter.` ``.

Méthode `exporter(structureId: string, userId: string, jour: string): Promise<{ nomFichier: string; contenu: Buffer }>` :

1. `verifier` ; `contexte` ; `validerJour(jour, debutCaisse)` (mêmes refus que la préparation).
2. Clôture du jour lue (`findUnique` par `pointDeVenteId_jourMetier`) ; absente : `ConflictException({ message: messageJourneeNonCloturee(jour), code: 'JOURNEE_NON_CLOTUREE' })`.
3. Pièces : `vente.findMany({ where: { pointDeVenteId, jourMetier: jourVersDate(jour), sessionCaisse: { technique: false } }, select: { numero, typePiece, createdAt, vendeurNom, total, motifAnnulation, venteOrigine: { select: { numero: true } }, poste: { select: { code: true } }, sessionCaisse: { select: { clotureJournaliereId: true } }, paiements: { select: { montant, referenceExterne, createdAt, modePaiement: { select: { code, libelle, ordre } } } } } })` ; **ne jamais sélectionner `clientNom`, `clientTelephone` ni les lignes**. `caisseIncluse = sessionCaisse.clotureJournaliereId === cloture.id` ; `motif = typePiece === 'ANNULATION' ? motifAnnulation : null`.
4. Mouvements : `mouvementCaisse.findMany({ where: { sessionCaisse: { pointDeVenteId, jourMetier: jourVersDate(jour), technique: false } }, select: { type, montant, motif, horodatageServeur, modePaiement: { select: { libelle: true } }, sessionCaisse: { select: { utilisateurNom: true, clotureJournaliereId: true, poste: { select: { code: true } } } } } })`.
5. `contenu = Buffer.from(exporterCloture(jour, pieces, mouvements), 'utf8')` ; `nomFichier = `cloture-${jour}.csv``.

### 3. `src/pharmacie/caisse/clotures.controller.ts` (ajout)

`@Get(':structureId/caisse/clotures/:jour/export')`, `@RequirePermissions(PERMISSIONS.CLOTURE_GERER)`, `@ApiProduces('text/csv')`, retour `Promise<StreamableFile>` : `const { nomFichier, contenu } = await this.clotures.exporter(...)` ; `return new StreamableFile(contenu, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${nomFichier}"` })`. Swagger : « Export CSV (séparateur point-virgule, UTF-8 avec BOM pour Excel) d'une journée clôturée : une ligne par pièce, par paiement et par mouvement de caisse (montant signé), sans coût, sans client, sans médicament. 409 JOURNEE_NON_CLOTUREE, 400 VALIDATION, 400 JOUR_AVANT_DEBUT_CAISSE. »

Placer cette route **avant** aucune autre route `:jour` qui la masquerait (les chemins `.../:jour/preparation` et `.../:jour/export` sont distincts, l'ordre est indifférent ; le vérifier par le test HTTP 2).

### 4. Code d'erreur

`src/common/filters/codes-erreur.ts` : ajouter `'JOURNEE_NON_CLOTUREE'` en fin de liste, commentaire « Export d'une journée qui n'est pas encore clôturée (409). » Sans `details`.

### 5. Inventaire CA22 (D623)

- `test/etancheite-couts/routes-pharmacie.ts` : `ClasseRoute` devient `'JSON' | 'FICHIER' | 'PUBLIQUE' | 'TEXTE'`, constante `const T: ClasseRoute = 'TEXTE';`, commentaire de `classe` complété : « TEXTE : fichier texte de la pharmacie (CSV), lu en entier : aucun en-tête ni aucune valeur ne doit correspondre au motif des coûts ». Entrée `'GET /pharmacie/:structureId/caisse/clotures/:jour/export': { classe: T, porteCout: false, exigeMarge: false }`.
- `test/db/etancheite-couts.db-spec.ts` : entrée d'`APPELS` `GET /pharmacie/${S}/caisse/clotures/${JOUR_CLOTURE[c.profil]()}/export` (la clôture du même profil précède dans l'ordre de l'inventaire : la placer après `POST /pharmacie/:structureId/caisse/clotures`) ; dans la boucle du test CA22 vendeur, avant le cas `FICHIER` : `if (route.classe === 'TEXTE') { expect(String(r.headers['content-type'])).toContain('text/csv'); expect({ cle, coutDansTexte: MOTIF_CLE_COUT.test(r.text) }).toEqual({ cle, coutDansTexte: false }); continue; }` (import de `MOTIF_CLE_COUT` depuis `src/pharmacie/masquer-couts`). Rien d'autre ne change.
- `src/pharmacie/etancheite-couts.spec.ts` n'est pas modifié (il lit `classe` comme une chaîne).

### 6. Tests unitaires

`src/pharmacie/caisse/export-cloture.spec.ts` (nouveau, 7 tests ; jour `'2026-10-30'`) :
1. « fichier vide » : `exporterCloture(jour, [], [])` commence par `'\uFEFF'`, vaut BOM + les 13 en-têtes joints par `;` + `'\r\n'`.
2. « pièce et paiements » : vente `T1-0000012` à 14:05, total 25 000, paiements Orange Money (ordre 2, référence `OM-778`, 15 000) puis Espèces (ordre 1, 10 000) donnés dans le désordre : trois lignes, la pièce puis Espèces puis Orange Money ; ligne pièce exacte `2026-10-30;Pièce;T1-0000012;Vente;;30/10/2026 à 14:05;W1;Mamadou Diallo;;;25000;;Oui`.
3. « annulation » : pièce `A-T1-0000012`, `numeroOrigine` `T1-0000012`, total -25 000, motif `Erreur de quantité`, paiement espèces -25 000 : colonnes `Annulation`, `T1-0000012`, `-25000`, motif présent, montant du paiement `-25000`.
4. « mouvements signés » : apport 50 000, prélèvement 100 000, remboursement 5 000 : montants `50000`, `-100000`, `-5000`, libellés `Apport`, `Prélèvement`, `Remboursement`, triés par horodatage, après les pièces.
5. « échappement » : motif `Client "pressé"; rendu 500` donne `"Client ""pressé""; rendu 500"` ; motif multi-ligne entouré de guillemets.
6. « formules neutralisées » : motif `=SOMME(A1)` donne `'=SOMME(A1)` ; vendeur `-Fanta` donne `'-Fanta` ; un montant négatif n'est jamais préfixé.
7. « inclusion » : `caisseIncluse` faux donne `Non` sur la pièce et ses paiements.

`src/pharmacie/caisse/clotures.http.spec.ts` (2 tests ajoutés ; `exporter` ajouté au service simulé, renvoie `{ nomFichier: 'cloture-2026-10-30.csv', contenu: Buffer.from('\uFEFFJour;Ligne\r\n', 'utf8') }`) :
1. vendeur (`caisse:utiliser`, `caisse:superviser`) `GET /pharmacie/s1/caisse/clotures/2026-10-30/export` : 403, service non appelé.
2. titulaire : 200, `content-type` contient `text/csv`, `content-disposition` contient `cloture-2026-10-30.csv`, `exporter` appelé avec `('s1', 'titulaire', '2026-10-30')`, `preparer` non appelé.

### 7. `test/db/export-cloture.db-spec.ts` (nouveau, 4 tests)

Préparation et aides calquées sur `test/db/clotures.db-spec.ts` (PB17a) : mêmes services, même recul de `debutCaisse` à `now() - 30 jours`, mêmes `sessionSql`, `venteSql`, `paiementSql`, `venteEncaissee`, `ouvrirSession`, `coupures`, `nouveauPoste`. `lire(contenu: Buffer)` = `contenu.toString('utf8')` découpé en lignes par `'\r\n'` (dernière ligne vide retirée), chaque ligne découpée par `;` (aucune valeur du scénario ne contient `;`).

1. « journée non clôturée » : `exporter(PHARMACIE, RESPONSABLE, jour(-3))` : 409 `JOURNEE_NON_CLOTUREE`, message `messageJourneeNonCloturee(jour(-3))` ; `jour(1)` : 400 `VALIDATION` `jourFutur`.
2. « export d'une journée clôturée » : aujourd'hui, poste web, `ouvrirSession(poste, VENDEUR, { 20000: 5 })` (fond 100 000) ; `venteEncaissee(s, 200000)` (vente V1) ; vente V2 de 50 000 insérée par un `INSERT` direct (copie de `venteSql` avec en plus les colonnes `"clientNom"` = `'Aissatou Sow'` et `"clientTelephone"` = `'+224620000000'`) et deux paiements insérés directement : espèces 30 000, Orange Money 20 000 avec `"referenceExterne"` = `'OM-123'` ; `sessions.enregistrerMouvement(PHARMACIE, VENDEUR, s, { type: 'PRELEVEMENT', montant: 100000, motif: 'Dépôt au coffre' })` ; pièce d'annulation de V1 (`venteSql({ typePiece: 'ANNULATION', origine: V1, motif: 'Erreur de saisie', total: -200000 })`) et son paiement espèces -200 000 ; théorique espèces = 100 000 + 200 000 + 30 000 - 200 000 - 100 000 = 30 000 : fermeture `{ comptageFermeture: { coupures: coupures({ 20000: 1, 10000: 1 }), releves: [{ mode: 'ORANGE_MONEY', montant: 20000 }] } }`, puis `clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: jour(0) }, '127.0.0.1')`. Export (texte gardé dans une variable du fichier pour le test 3) : `nomFichier` `cloture-<jour(0)>.csv` ; le contenu commence par le BOM ; première ligne = `ENTETES_EXPORT_CLOTURE` ; 3 lignes `Pièce`, 4 lignes `Paiement`, 1 ligne `Mouvement de caisse` (montant `-100000`, motif `Dépôt au coffre`) ; la ligne de l'annulation porte `Annulation`, le numéro de V1 et le motif ; la référence `OM-123` figure sur la ligne Orange Money ; toutes les lignes portent `Oui` ; somme des montants des lignes `Paiement` = somme des `total` des lignes `Pièce` (50 000).
3. « rien de privé ni de coût » : sur le texte exporté au test 2 : ni `Aissatou`, ni `620000000`, et `MOTIF_CLE_COUT.test(texte)` est faux.
4. « caisse desktop restée ouverte et session technique » : poste desktop D, `sessionSql({ posteId: D, jourMetier: jour(-5), statut: 'OUVERTE' })` avec une vente SQL (total 7 000, paiement espèces), poste web avec session FERMEE et `resultatSql` et une vente de 9 000 ; clôture forcée de `jour(-5)` (motif) ; export : la pièce desktop porte `Non`, la pièce web `Oui` ; une vente historique de la fixture (session technique) dont le `jourMetier` tombe sur un jour clôturable n'apparaît jamais (si aucune ne tombe dans la fenêtre de 30 jours, assertion sautée et commentée).

### 8. `CLAUDE.md` du dépôt back

Ajouter à la fin de la puce PB17a : « Export : `GET .../caisse/clotures/:jour/export` (`cloture:gerer`, journée clôturée seulement, sinon 409 `JOURNEE_NON_CLOTUREE`) renvoie un CSV `cloture-AAAA-MM-JJ.csv` (point-virgule, UTF-8 avec BOM) : une ligne par pièce (vente, annulation, régularisation), par paiement (montant signé, référence) et par mouvement de caisse (apport positif, prélèvement et remboursement négatifs), colonne « Caisse incluse dans la clôture », sans coût, sans client, sans médicament ; formules Excel neutralisées (D622). »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script : le hook de garde ne voit pas les écritures faites par Bash. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/pharmacie/caisse/export-cloture.ts`, `src/pharmacie/caisse/export-cloture.spec.ts`, `src/pharmacie/caisse/clotures.service.ts`, `src/pharmacie/caisse/clotures.controller.ts`, `src/pharmacie/caisse/clotures.http.spec.ts`, `src/common/filters/codes-erreur.ts`, `test/etancheite-couts/routes-pharmacie.ts`, `test/db/etancheite-couts.db-spec.ts`, `test/db/export-cloture.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint` sur les fichiers autorisés `.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `export-cloture.spec.ts` (7), `clotures.http.spec.ts` (10), `etancheite-couts.spec.ts`.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/export-cloture.db-spec.ts` (4), `test/db/clotures.db-spec.ts` (13, inchangé) et `test/db/etancheite-couts.db-spec.ts` (avec la route TEXTE).
5. `git status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes test/db/clotures.db-spec.ts src/pharmacie/caisse/cloture-regles.ts src/pharmacie/caisse/journee.ts` vide.
6. Données privées : `grep -n "clientNom\|clientTelephone\|lignes\|cout" src/pharmacie/caisse/export-cloture.ts` et la méthode `exporter` de `clotures.service.ts` : aucune lecture de ces champs (relecture du chef).
7. Règles pures : `grep -n "new Date(\|Date.now\|@nestjs\|generated/prisma" src/pharmacie/caisse/export-cloture.ts` : aucune ligne.
8. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
