# Plan d'implémentation, tranche pharmacie 1 (Étape 1)

Chef d'orchestration (Opus), 2026-10-25. Aucun code, aucune migration, aucun commit à ce stade.
Entrées : `DEMANDE.md`, `rapports/inventaire-consolide.md`, `SPEC-VENTES-PHARMACIE.md`, protocoles orchestrateur back et front, code lu sur `orch/pharmacie-t1-back` et `orch/pharmacie-t1-front`, décisions O1 à O14 de l'orchestrateur principal, documentation Next.js 16 locale (`output: 'standalone'`, exports statiques).
Décisions détaillées : `decisions.md` (D401 et suivantes). Ce plan est volontairement critiquable : les désaccords sont en section 6.3.

Conventions du plan : « fiche » = `StockMedicament` étendu (le « Product » de la demande, propre à l'officine) ; « PV » = point de vente ; « UM » = unité minimale ; « titulaire » = rôle « Administrateur de structure » ; « vendeur » = rôle « Pharmacien » (O6). Tout montant est un `Int` en GNF, toute quantité persistée est un `Int` en UM.

---

## 0. Ce que le plan change en une page

1. Le stock cesse d'être un compteur : il devient un **journal append-only** `MouvementStock`, avec deux **agrégats de lecture reconstructibles** (`AgregatStockLot`, `AgregatStockProduit`) tenus par trigger dans la même transaction, une commande de reconstruction et une commande de vérification.
2. `StockMedicament` reste la fiche produit de l'officine (O2), étendue (UM, coefficient, prix unité, déconditionnable, tolérance, qualification, archivage). `quantite` et `disponible` sont **gelées une version** (trigger qui refuse leur modification), `Medicament` global n'est pas touché.
3. Le stock est tenu **par lot** (`LotStock`), la reprise crée un lot technique par fiche non nulle (péremption reprise, O4, coût 0) et un mouvement initial `RECEPTION`.
4. La vente garde sa route et son contrat (compatibilité : `stockId`, `quantite` = nombre de boîtes si l'unité n'est pas précisée), gagne l'unité (boîte ou UM), les deux prix, les allocations de lot (reliquat puis FEFO, provisoire si stock absent), les paiements multiples, la session obligatoire **ouverte automatiquement** à la première vente, et ne bloque jamais sur le stock (O11).
5. La caisse est un objet distinct : `Poste`, `SessionCaisse`, `ComptageCaisse` par coupure, `MouvementCaisse`, `Paiement`, `ModePaiement` et `CoupureMonnaie` en tables de référence, `ClotureJournaliere` qui verrouille la journée.
6. L'annulation devient une **pièce d'annulation** (O5) ; plus aucune mutation de pièce comptable (triggers d'immuabilité).
7. Le hors ligne vit dans une **application Electron** (`front_medconnect/desktop/`) qui embarque la sortie `standalone` du front (pas d'export statique possible : `proxy.ts`, `headers()` et routes dynamiques), avec un **cœur hors ligne TypeScript indépendant** (`desktop/coeur/`), SQLite dans le processus principal, impression directe et synchronisation par journal d'événements.
8. Ordre : back (19 tâches), puis écrans web (6 tâches), puis desktop (6 tâches). Harnais de base de test et test de non-régression des alertes **avant** tout recâblage.

---

## 1. Modèle de données retenu, confronté à l'existant

Légende : **étendu** (modèle existant modifié), **créé**, **gelé** (conservé, plus écrit), **conservé** (inchangé).
Toutes les nouvelles clés étrangères comptables sont en `onDelete: Restrict` (O12). Identifiants `String @id @default(uuid())` sauf mention ; les entités créées hors ligne (session, vente, comptage, mouvement de caisse) reçoivent un UUID généré par le client, accepté tel quel par le serveur (D427).

### 1.1 Référentiels et organisation

**`PointDeVente`** (créé, O3)
| Champ | Type | Contrainte |
|---|---|---|
| `id` | uuid | PK |
| `structureId` | String | FK `Structure` Restrict |
| `ordre` | Int | numéro d'ordre dans la structure (1 pour le PV unique), sert au format du ticket |
| `nom` | String | copie du nom de la pharmacie à la création |
| `actif` | Boolean @default(true) | |
| `createdAt` | DateTime @default(now()) | |
Index : `@@unique([structureId, ordre])`, `@@index([structureId])`. Rempli par la migration : un PV par `Structure` de type PHARMACIE. Créé aussi à la création d'une pharmacie (`structure.service`) et complété au démarrage pour toute pharmacie sans PV (même mécanisme que D304, idempotent).

**`Poste`** (créé, O3) : poste de caisse.
| Champ | Type | Contrainte |
|---|---|---|
| `pointDeVenteId` | String | FK Restrict |
| `code` | String | court, unique par PV (`W3`, `D1`, `REPRISE`) |
| `libelle` | String | « Comptoir principal », « Navigateur de Mariama » |
| `type` | enum `TypePoste { WEB DESKTOP TECHNIQUE }` | |
| `appareilId` | String? | identifiant d'installation (desktop) ou de navigateur et d'utilisateur (web) |
| `actif` | Boolean @default(true) | |
| `derniereSequenceAppliquee` | Int @default(0) | dernière séquence d'événement rejouée |
| `dernierContactLe` | DateTime? | dernière synchro |
| `dernierEtat` | Json? | `{ fileVide, sessionOuverte, versionApp }` déclaré à la dernière synchro |
| `enregistreParId` | String? | sans FK (D109) |
| `createdAt` | DateTime | |
Index : `@@unique([pointDeVenteId, code])`, `@@unique([pointDeVenteId, appareilId])`. La migration crée un poste `TECHNIQUE` code `REPRISE` par PV, porteur des ventes historiques.

**`CompteurTicket`** (créé) : `pointDeVenteId` PK FK Restrict, `prochainNumero Int @default(1)`. Seule source des numéros de ticket du PV : une vente web en ligne prend le suivant (verrou de ligne, comme `CompteurVente` aujourd'hui), une plage desktop avance le compteur de sa taille.

**`PlageTicket`** (créé) : `posteId` FK Restrict, `pointDeVenteId` FK Restrict, `debut Int`, `fin Int` (inclus), `attribueeLe`, `attribueeParId`. `CHECK (fin >= debut)`, `@@index([posteId])`. Pas de contrainte d'exclusion (évite l'extension `btree_gist`) : la non-superposition est garantie par `CompteurTicket` verrouillé ; la commande de vérification la contrôle.

**`ParametresPharmacie`** (créé, O9) : `structureId` PK FK Restrict.
| Champ | Défaut |
|---|---|
| `horizonsPeremptionJours Int[]` | `{90,30,7}` |
| `seuilEcartCaisse Int` | 5000 |
| `seuilAvertissementPrixPct Int` | 25 |
| `seuilStockBas Int` | 10 (en UM, documenté) |
| `taillePlageTickets Int` | 1000 |
| `seuilRechargementPlagePct Int` | 20 |
| `debutFiabiliteMarge DateTime` | date de la migration |
| `debutCaisse DateTime` | date de la migration (jours antérieurs non clôturables) |
Créé par la migration pour chaque pharmacie, puis paresseusement avec les défauts.

**`ModePaiement`** (créé, O7) : `code String @unique` (`ESPECES`, `ORANGE_MONEY`, `MTN_MOMO`), `libelle`, `comptagePhysique Boolean`, `referenceAutorisee Boolean`, `ordre Int`, `actif Boolean`. Global (pas par pharmacie), rempli par la migration ; un nouveau mode = un `INSERT`, aucun changement de schéma (critère d'acceptation testé par insertion en base de test).

**`CoupureMonnaie`** (créé, O8) : `devise String @default("GNF")`, `valeurFaciale Int`, `type` enum `TypeCoupure { BILLET PIECE }`, `ordre Int`, `actif`. `@@unique([devise, valeurFaciale])`. Rempli : billets 20 000, 10 000, 5 000, 2 000, 1 000, 500 (correction du porteur : rien sous 500 GNF, pas de ligne « pièces et autres », voir CORRECTIONS-PORTEUR.md).

**`Fournisseur`** (créé) : `structureId` FK Restrict, `nom`, `telephone?`, `actif`, `createdAt`. `@@unique([structureId, nom])`. Minimal (la demande exige `fournisseur_id` sur le lot, rien de plus).

**`Anomalie`** (créé) : file d'anomalies du titulaire.
| Champ | Type |
|---|---|
| `pointDeVenteId` | FK Restrict |
| `type` | enum `TypeAnomalie { STOCK_NEGATIF ECART_INVENTAIRE CONDITIONNEMENT_CONCURRENT REMONTEE_APRES_CLOTURE ECART_CAISSE FOND_NON_COMPTE PLAGE_EPUISEE PRIX_DIVERGENT ORDONNANCE_NON_CONFIRMEE VENTE_UNITE_INTERDITE PRODUIT_ARCHIVE EVENEMENT_REJETE SEQUENCE_MANQUANTE }` |
| `statut` | enum `{ OUVERTE TRAITEE }` |
| `attribueeAId` | String? (sans FK, nominatif) |
| `pieceType`, `pieceId` | String, String? |
| `details` | Json (liste blanche de champs, jamais de donnée de santé) |
| `creeLe`, `traiteeLe?`, `traiteeParId?`, `commentaireTraitement?` | |
Index `@@index([pointDeVenteId, statut, creeLe])`. Seul objet du domaine dont le statut se met à jour (c'est un flux de travail, pas une pièce).

### 1.2 Fiche produit de l'officine

**`StockMedicament`** (étendu, O2). Identifiants existants conservés (règle du projet) : `prixUnitaire` **reste le nom de la colonne et devient le prix de la boîte** (D409).
| Champ | Statut | Type, défaut | Remarque |
|---|---|---|---|
| `quantite` | **gelé** | Int | plus écrit ; trigger `BEFORE UPDATE` qui refuse tout changement après la migration ; supprimé à la version suivante après `stock:comparer-compteur` propre |
| `disponible` | **gelé** | Boolean | plus écrit ; la disponibilité est dérivée de l'agrégat |
| `dateExpiration` | **gelé** | DateTime? | reprise par le lot technique ; la réponse API renvoie la date calculée (1.6) |
| `prixUnitaire` | conservé | Int? | prix de vente de la boîte |
| `uniteMinimale` | créé | enum `UniteMinimale { COMPRIME GELULE ML SACHET GRAMME AMPOULE UNITE }` @default(UNITE) | liste de la demande plus GELULE et AMPOULE (D410) |
| `coefficientBoite` | créé | Int @default(1), `CHECK >= 1` | UM par boîte |
| `prixUnite` | créé | Int? | prix de vente d'une UM, saisi séparément, jamais calculé |
| `deconditionnable` | créé | Boolean @default(false) | faux : vente à l'unité refusée, `prixUnite` doit rester vide |
| `toleranceInventaire` | créé | Int? | écart absolu toléré en UM (D411) ; nul = 0 |
| `qualifie` | créé | Boolean @default(false) | vrai dès que le titulaire a confirmé UM et coefficient ; rend le travail de qualification visible |
| `archiveLe` | créé | DateTime? | remplace la suppression physique (O12) |
| `createdAt` | créé | DateTime @default(now()) | |
Contraintes : `CHECK (deconditionnable OR "prixUnite" IS NULL)`, `CHECK ("prixUnite" IS NULL OR "prixUnite" > 0)`. `@@unique([medicamentId, structureId])` conservé. `onDelete` vers `Medicament` et `Structure` conservés en Cascade : un lot (Restrict) bloque la cascade en base, et les services refusent avant (409) avec un message clair.

**`Medicament`** (conservé, aucun champ) : catalogue global multi formes, ne peut pas porter un coefficient.

### 1.3 Lots, mouvements, agrégats, conditionnement

**`LotStock`** (créé)
| Champ | Type | Contrainte |
|---|---|---|
| `stockMedicamentId` | String | FK fiche Restrict |
| `pointDeVenteId` | String | FK Restrict, **non nul** |
| `numeroLot` | String? | nul pour le lot technique |
| `dateExpiration` | DateTime? `@db.Date` | |
| `quantiteRecue` | Int | UM, `CHECK >= 0` |
| `coutUnitaire` | Int | GNF par UM, figé, `CHECK >= 0` ; 0 = inconnu, non valorisable |
| `coutAchatBoite` | Int? | valeur saisie à la réception, traçabilité |
| `coefficientReception` | Int | coefficient au moment de la réception, `CHECK >= 1` ; base du calcul du reliquat |
| `fournisseurId` | String? | FK Restrict |
| `receptionId` | String? | FK `Reception` Restrict |
| `dateReception` | DateTime | |
| `lotTechnique` | Boolean @default(false) | |
| `auteurId` | String? | nul = système |
| `createdAt` | DateTime | |
Index : `@@index([stockMedicamentId, pointDeVenteId, dateExpiration, dateReception])` (FEFO), `@@index([pointDeVenteId, dateExpiration])` (alertes). Champs figés après insertion par trigger, sauf `dateExpiration` (correction tracée en audit) et `coefficientReception` et `coutUnitaire` lors de la seule qualification d'un lot technique (1.7).

**`MouvementStock`** (créé) : journal, **immuable** (trigger `BEFORE UPDATE OR DELETE` qui lève une exception, sauf contournement de purge démo et de test, D431).
| Champ | Type | Contrainte |
|---|---|---|
| `evenementId` | String | **unique global**, stable : UUID client pour le hors ligne, UUID serveur sinon, `migration:<stockId>` pour la reprise |
| `pointDeVenteId` | String | FK Restrict, **non nul** |
| `stockMedicamentId` | String | FK Restrict |
| `lotId` | String? | FK `LotStock` Restrict ; nul seulement pour une sortie provisoire sans lot (stock négatif, O11) et sa contrepartie de résolution |
| `type` | enum `TypeMouvementStock { RECEPTION VENTE RETOUR INVENTAIRE PERTE PEREMPTION TRANSFERT CORRECTION }` | liste de la demande |
| `quantite` | Int | signée, UM ; `CHECK (quantite <> 0 OR type = 'INVENTAIRE')` (un inventaire sans écart est écrit, D417) |
| `pieceOrigineType` | enum `TypePiece { MIGRATION VENTE ANNULATION RECEPTION INVENTAIRE SORTIE_MANUELLE RESOLUTION QUALIFICATION AJUSTEMENT }` | |
| `pieceOrigineId` | String? | |
| `motif` | String? | obligatoire (service) pour sortie manuelle, contre l'ordre, périmé, ajustement |
| `auteurId` | String? | nul = système |
| `horodatageServeur` | DateTime @default(now()) | |
| `horodatageLocal` | DateTime? | |
| `posteId` | String? | FK Restrict |
| `sequencePoste` | Int? | |
Index : `@@index([stockMedicamentId, pointDeVenteId])`, `@@index([lotId])`, `@@index([pieceOrigineType, pieceOrigineId])`.

**`AgregatStockLot`** (créé, **agrégat de lecture reconstructible**, nommé comme tel dans le code et le schéma) : `lotId` PK FK Restrict, `stockMedicamentId`, `pointDeVenteId`, `quantite Int` avec **`CHECK (quantite >= 0)`** (un lot n'est jamais négatif : le négatif vit sur l'agrégat produit), `misAJourLe`.
**`AgregatStockProduit`** (créé, agrégat reconstructible) : PK `(stockMedicamentId, pointDeVenteId)`, `quantite Int` (peut être négative, O11), `misAJourLe`. Index `@@index([pointDeVenteId, quantite])`.
Tenue : trigger `AFTER INSERT ON "MouvementStock"` qui fait `INSERT ... ON CONFLICT DO UPDATE SET quantite = quantite + NEW.quantite` sur les deux (le lot seulement si `lotId` non nul), dans la transaction du mouvement. Aucun code applicatif n'écrit un agrégat.
Reconstruction : `npm run stock:reconstruire` (dev) ou `node dist/scripts/stock-reconstruire.js` (production, `docker compose run --rm --entrypoint ""`) : dans une transaction, `LOCK TABLE "MouvementStock" IN SHARE MODE`, `TRUNCATE` des deux agrégats, `INSERT ... SELECT SUM(quantite) GROUP BY`, puis réalignement de `ConditionnementOuvert` (ci-dessous). Vérification en lecture seule : `npm run stock:verifier` (agrégats contre recalcul, lots jamais négatifs, conditionnements contre reliquat dérivé, somme des allocations résolues contre quantité de ligne, plages non superposées). Test d'intégration : après un scénario mixte, agrégats = recalcul.

**`ConditionnementOuvert`** (créé, état dérivé matérialisé, OpenCartonState de la demande)
| Champ | Type |
|---|---|
| `stockMedicamentId`, `lotId`, `pointDeVenteId` | FK Restrict |
| `unitesParConditionnement` | Int (= `coefficientReception` du lot) |
| `ouvertLe`, `ouvertParId?`, `ouvertParPieceId?` | |
| `fermeLe` | DateTime? |
**Invariant en base** : index unique partiel `@@unique([stockMedicamentId, lotId, pointDeVenteId], where: raw("\"fermeLe\" IS NULL"))` (préversion `partialIndexes` déjà active, précédent TB17).
**Reliquat dérivé** (jamais stocké) : `reliquat(lot) = soldeLot mod coefficientReception` si `soldeLot > 0` et `coefficientReception > 1`, sinon 0. L'invariant « au plus un conditionnement ouvert par triplet » est exactement ce qui rend cette formule vraie (les autres boîtes du lot sont intactes). La ligne `ConditionnementOuvert` existe si et seulement si le reliquat est non nul : ouverte dans la transaction qui fait passer le reliquat de 0 à non nul (insertion, l'index refuse une seconde ouverture : 409 `CONDITIONNEMENT_DEJA_OUVERT` côté service), fermée quand il revient à 0. Les ventes, inventaires et sorties passent par le même service, qui maintient la ligne. Limite assumée (6.3) : hors ligne, deux postes peuvent ouvrir physiquement deux plaquettes du même lot ; le serveur ne refuse jamais la vente, il garde une seule ligne et ouvre une anomalie `CONDITIONNEMENT_CONCURRENT`.

### 1.4 Ventes

**`Vente`** (étendu). Jamais modifiée après insertion : trigger d'immuabilité (D431), la mutation de `cleIdempotence` au-delà de 24 h est supprimée (D425).
| Champ | Statut | Type | Remarque |
|---|---|---|---|
| `pointDeVenteId` | créé | String **non nul** | FK Restrict ; repris depuis la pharmacie |
| `posteId` | créé | String **non nul** | FK Restrict ; ventes historiques : poste `REPRISE` |
| `sessionCaisseId` | créé | String **non nul** | FK Restrict ; ventes historiques : session technique de reprise (D421) |
| `typePiece` | créé | enum `TypePieceVente { VENTE ANNULATION REGULARISATION }` @default(VENTE) | |
| `venteOrigineId` | créé | String? `@unique` | FK self Restrict ; pièce d'annulation ou de régularisation qui pointe l'origine ; l'unicité interdit une seconde annulation |
| `numeroTicket` | créé | Int? | numéro de plage ; `@@unique([pointDeVenteId, numeroTicket])` |
| `jourMetier` | créé | DateTime `@db.Date` non nul | jour de rattachement (Africa/Conakry, O10) ; historique : jour de `createdAt` |
| `jourMetierOrigine` | créé | DateTime? `@db.Date` | jour réel si rattachée à un autre jour (remontée après clôture) |
| `horodatageLocal` | créé | DateTime? | |
| `sequencePoste` | créé | Int? | |
| `numero` | conservé | String | nouveaux formats `T<ordrePV>-NNNNNNN` (plage), `S<ordrePV>-<codePoste>-<n>` (secours), `A-<numero origine>` (annulation) ; `@@unique([structureId, numero])` conservée, pas de collision avec `V-AAAA-NNNNNN` |
| `cleIdempotence` | conservé | String? | **devient permanente** : clé web `Idempotency-Key` et identifiant client stable des ventes desktop ; plus de fenêtre de 24 h ni de remise à nul |
| `total` | conservé | Int | somme des `sousTotal` ; négatif pour une annulation |
| `statut`, `annuleeLe`, `annuleeParId`, `motifAnnulation` | **gelés** | | plus écrits ; la réponse API les **dérive** de la pièce d'annulation (compatibilité front) ; les ventes déjà `ANNULEE` restent lisibles |
| `structureId` | conservé | | `onDelete` passe de Cascade à **Restrict** |
Index ajoutés : `@@index([pointDeVenteId, jourMetier])`, `@@index([sessionCaisseId])`.
« Non valorisable » n'est pas une colonne (une colonne mutable violerait l'immuabilité) : calculé en lecture depuis les allocations (D420).

**`LigneVente`** (étendu, immuable, `onDelete` vers `Vente` passe à Restrict)
| Champ | Statut | Remarque |
|---|---|---|
| `quantite` | conservé | **toujours en UM** (historique : coefficient 1, donc inchangé) |
| `prixUnitaire` | conservé | **prix unitaire appliqué par UM**, affichage et contrôle ; boîte : `round(prixBoite / coefficient)` |
| `sousTotal` | conservé | **montant de ligne, seule référence des totaux** (inversion de la règle actuelle `prix x quantité`) |
| `uniteAffichee` | créé | enum `UniteVente { BOITE UNITE }` @default(BOITE) |
| `nombreAffiche` | créé | Int : nombre de boîtes ou d'UM saisi ; historique = `quantite` |
| `coefficientApplique` | créé | Int @default(1) |
`stockMedicamentId`, `medicamentId`, `nomMedicament` conservés (copie, sans FK, D109). Une même fiche peut figurer deux fois si les unités diffèrent (`@@unique([venteId, stockMedicamentId, uniteAffichee])` côté service, D414).

**`AllocationLot`** (créé, SaleLineLotAllocation)
| Champ | Type | Remarque |
|---|---|---|
| `ligneVenteId` | FK Restrict | |
| `lotId` | String? | **copie sans FK** (demande : recopié, pas référencé) ; nul si provisoire sans lot connu |
| `numeroLot`, `dateExpiration` | copies | |
| `quantite` | Int | UM, signée (négative pour une annulation) |
| `coutUnitaire` | Int | copie du coût du lot au moment de la sortie |
| `lotTechnique` | Boolean | copie |
| `statut` | enum `StatutAllocation { DEFINITIVE PROVISOIRE REMPLACEE }` | |
| `remplaceeParPieceId` | String? | pièce de résolution |
| `sortieManuelle` | Boolean @default(false) | lot choisi contre l'ordre ou périmé |
| `motif` | String? | obligatoire si `sortieManuelle` |
| `auteurId` | String? | |
| `createdAt` | | |
Seule mise à jour permise (trigger) : `PROVISOIRE` vers `REMPLACEE`. Invariant vérifié par le service, la commande de vérification et un test : pour une ligne sans allocation `PROVISOIRE`, `SUM(quantite) des DEFINITIVE = LigneVente.quantite`. Ventes historiques : aucune allocation (D422).

**`CompteurVente`** (gelé) : plus utilisé, supprimé à la version suivante.

### 1.5 Caisse

**`SessionCaisse`** (créé)
| Champ | Type | Remarque |
|---|---|---|
| `id` | uuid (client possible) | |
| `pointDeVenteId`, `posteId` | FK Restrict non nuls | |
| `utilisateurId`, `utilisateurNom` | String, copie | sans FK (D109) |
| `statut` | enum `StatutSession { OUVERTE FERMEE INCLUSE_DANS_CLOTURE }` | |
| `technique` | Boolean @default(false) | session de reprise historique |
| `jourMetier` | `@db.Date` | jour d'ouverture ; toutes les ventes de la session y sont rattachées (D435) |
| `jourMetierOrigine` | `@db.Date`? | si rattachée à un autre jour |
| `ouverteLe`, `ouverteLeLocal?`, `fermeeLe?`, `fermeeLeLocal?` | | |
| `evenementOuvertureId`, `evenementFermetureId?` | String unique | rejeu |
| `commentaireEcart?`, `commentaireParId?` | | |
| `clotureJournaliereId` | String? FK Restrict | |
Index unique partiel : une seule session `OUVERTE` par poste (`where statut = 'OUVERTE'`). Transitions permises (trigger) : `OUVERTE` vers `FERMEE`, `FERMEE` vers `INCLUSE_DANS_CLOTURE` (avec `clotureJournaliereId`).
Fond de caisse : **dérivé** du comptage d'ouverture (jamais stocké).

**`ComptageCaisse`** (créé, immuable) : `sessionCaisseId` FK Restrict, `moment` enum `{ OUVERTURE FERMETURE }`, `totalEspeces Int` (somme des lignes, calculée par le service et vérifiée), `auteurId`, `evenementId @unique`, `createdAt`. `@@unique([sessionCaisseId, moment])`.
**`LigneComptage`** (créé) : `comptageId` FK Restrict, `valeurFaciale Int` (copie), `nombre Int CHECK >= 0`.
**`ReleveModePaiement`** (créé) : `comptageId`, `modePaiementId` FK Restrict, `montantDeclare Int` : total mobile relevé sur le compte marchand à la fermeture (facultatif : sans relevé, l'écart du mode est « non rapproché »).

**`MouvementCaisse`** (créé, immuable) : `sessionCaisseId`, `pointDeVenteId` FK Restrict, `type` enum `{ PRELEVEMENT APPORT REMBOURSEMENT }`, `modePaiementId` (défaut espèces), `montant Int CHECK > 0`, `motif` non vide, `auteurId`, `horodatageServeur`, `horodatageLocal?`, `evenementId @unique`.

**`Paiement`** (créé, immuable) : `venteId` FK Restrict, `sessionCaisseId` FK Restrict, `modePaiementId` FK Restrict, `montant Int` (signé : négatif pour une annulation), `referenceExterne String?`, `montantRecu Int?` (espèces, pour le rendu du ticket), `createdAt`. Index `@@index([sessionCaisseId, modePaiementId])`. Invariant service : `SUM(montant) = Vente.total`. Ventes historiques : aucun paiement (leur session technique n'a pas de théorique).

**Théorique** (calcul pur, jamais stocké avant fermeture) :
- espèces = fond (comptage d'ouverture) + paiements espèces + apports espèces - prélèvements espèces - remboursements espèces ;
- mode mobile = paiements du mode - remboursements du mode ;
- écart = compté - théorique, signé, jamais corrigé.

**`ResultatSessionMode`** (créé, immuable) : photographie à la fermeture, `sessionCaisseId`, `modePaiementId`, `theorique`, `compte?`, `ecart?`. Elle n'est pas la source (le recalcul l'est) mais fige ce que le vendeur a vu.

**`ClotureJournaliere`** (créé, immuable) : `pointDeVenteId` FK Restrict, `jourMetier @db.Date`, `clotureParId`, `clotureeLe`, `forcee Boolean`, `motifForcage String?`, `postesManquants Json` (`[{ posteId, code, libelle }]`). `@@unique([pointDeVenteId, jourMetier])`. Son existence **est** le verrou (le champ `verrouillee` de la demande serait toujours vrai).
**`TotalClotureMode`** (créé, immuable) : `clotureId`, `modePaiementId`, `theorique`, `compte?`, `ecart?`.

### 1.6 Réception, inventaire, synchronisation

**`Reception`** (créé, immuable) : `pointDeVenteId`, `fournisseurId?`, `reference?` (bon de livraison), `recueLe`, `auteurId`, `createdAt`. Ses lignes sont les lots créés (`LotStock.receptionId`).
**`Inventaire`** (créé) : `pointDeVenteId`, `auteurId`, `createdAt`, `commentaire?`. **`LigneInventaire`** (créé, immuable) : `inventaireId`, `stockMedicamentId`, `lotId`, `quantiteTheorique`, `quantiteComptee`, `ecart`, `sousTolerance Boolean`, `anomalieId?`.
**`EvenementSynchro`** (créé) : `evenementId @unique` (UUID client), `posteId` FK Restrict, `sequence Int`, `type String`, `utilisateurId`, `horodatageLocal`, `recuLe`, `statut` enum `{ APPLIQUE EN_ATTENTE REJETE }`, `empreinte String` (sha256 du corps canonique), `corps Json`, `resultat Json?`. `@@unique([posteId, sequence])`. Seule transition permise : `EN_ATTENTE` vers `APPLIQUE` ou `REJETE`.

### 1.7 Lecture du stock exposée au front (contrat conservé)

Pour chaque fiche, la réponse de `GET /pharmacie/stock/:structureId` garde `quantite`, `prixUnitaire`, `dateExpiration`, `disponible` avec ce sens :
- `quantite` = `AgregatStockProduit.quantite` (UM ; identique à aujourd'hui tant que coefficient = 1) ;
- `prixUnitaire` = prix de la boîte (inchangé) ;
- `dateExpiration` = date du lot que la vente prendrait en premier (lot du reliquat, sinon premier FEFO non périmé avec stock), sinon la plus ancienne date des lots restants (tous périmés), sinon `null` ; tant qu'il n'y a qu'un lot technique, c'est la date d'aujourd'hui (O4) ;
- `disponible` = `quantite > 0` et fiche non archivée.
Champs ajoutés : `uniteMinimale`, `coefficientBoite`, `prixUnite`, `deconditionnable`, `toleranceInventaire`, `qualifie`, `reliquat` (`[{ lotId, unitesRestantes }]`), `quantiteVendable` (lots non périmés), `lots` (`[{ id, numeroLot, dateExpiration, quantite, lotTechnique, coutUnitaire }]`, `coutUnitaire` présent seulement avec `marge:read`).

**Qualification d'une fiche** (manque de la demande, D412) : passer le coefficient de 1 à N sans convertir le stock ferait de 12 boîtes 12 comprimés. Tant que `qualifie = false`, changer le coefficient exige `conversionStock: "MULTIPLIER" | "CONSERVER"` si le stock n'est pas nul ; `MULTIPLIER` écrit, par lot technique, un mouvement `CORRECTION` (+quantité x (N - 1), pièce `QUALIFICATION`) et met à jour `coefficientReception` du lot technique. Après qualification, un changement de coefficient ne s'applique qu'aux réceptions futures et aux ventes par boîte.

---

## 2. Migrations ordonnées

Règles communes :
- Fichiers Prisma `prisma/migrations/<horodatage>_<nom>/migration.sql`, SQL relu à la main (précédent `20261022120000_ventes_pharmacie`). Horodatages croissants dans l'ordre des tâches.
- Chaque migration contient ses contrôles en `DO $$ ... RAISE EXCEPTION ... $$` qui **listent les lignes en cause** (au plus 50 identifiants dans le message) au lieu de poser une valeur arbitraire. La première tâche de migration vérifie que Prisma applique chaque fichier dans une transaction ; sinon, le fichier porte `BEGIN; ... COMMIT;` explicites (D432). Le harnais teste qu'une migration qui échoue ne laisse rien.
- Retour arrière : `prisma/retours-arriere/<nom>.down.sql`, appliqué par `psql -f` (ou `npx prisma db execute --file`), puis `npx prisma migrate resolve --rolled-back <nom>`, puis redéploiement de la version de code précédente. Le harnais applique haut, bas, haut sur une base chargée.
- Contrôle préalable en lecture seule avant déploiement : `npm run pharmacie:pre-migration` (dev) ou `node dist/scripts/pharmacie-pre-migration.js` (production) : volumes, stocks ou ventes rattachés à une structure qui n'est pas une PHARMACIE, quantités négatives ou nulles, prix nuls. Même mode d'emploi que `telephones:doublons`.

| # | Nom | Tâche | Contenu | Reprise de données | Arrêt sur ligne indéterminable | Retour arrière |
|---|---|---|---|---|---|---|
| M1 | `20261026090000_pharmacie_t1_permissions` | PB03 | `INSERT` des 7 permissions (`caisse:utiliser`, `caisse:superviser`, `cloture:gerer`, `inventaire:write`, `reception:write`, `marge:read`, `anomalie:gerer`) dans `Permission` | Rattachement aux rôles existants des pharmacies : toutes au rôle « Administrateur de structure », `caisse:utiliser` au rôle « Pharmacien » (`ON CONFLICT DO NOTHING`) | aucune | `DELETE` des `RolePermission` puis des `Permission` de ces 7 codes |
| M2 | `20261026100000_pharmacie_t1_points_de_vente` | PB05 | Tables `PointDeVente`, `Poste`, `CompteurTicket`, `PlageTicket`, `ParametresPharmacie`, `ModePaiement`, `CoupureMonnaie`, `Fournisseur`, `Anomalie` et leurs enums | Un PV (`ordre` 1) par PHARMACIE, un poste `REPRISE` (TECHNIQUE, inactif) par PV, un `CompteurTicket` à 1, des paramètres par défaut, 3 modes, 6 coupures | Lève une exception qui liste les structures **non PHARMACIE** porteuses de `StockMedicament` ou de `Vente` (pas de PV possible sans décision) | `DROP` des tables et enums (rien n'en dépend encore) |
| M3 | `20261026110000_pharmacie_t1_fiche_produit` | PB06 | Colonnes de 1.2 sur `StockMedicament`, enum `UniteMinimale`, CHECK | Valeurs par défaut : `UNITE`, coefficient 1, `prixUnite` nul, non déconditionnable, non qualifié | aucune | `DROP COLUMN`, `DROP TYPE` |
| M4 | `20261026120000_pharmacie_t1_lots_mouvements` | PB07 | `LotStock`, `MouvementStock`, `AgregatStockLot`, `AgregatStockProduit`, `ConditionnementOuvert` (index partiel), enums, triggers d'agrégat, d'immuabilité et de gel de `quantite`/`disponible` | Pour chaque fiche `quantite <> 0` : un lot technique (`numeroLot` nul, `dateExpiration` reprise, O4, `coutUnitaire` 0, `coefficientReception` 1, `quantiteRecue` = quantite, PV de la pharmacie) et un mouvement `RECEPTION` +quantite, pièce `MIGRATION`, auteur système (nul), `evenementId = 'migration:' || id` (rejouable sans doublon). Les agrégats sont remplis par le trigger. Contrôle final dans la migration : agrégat produit = `quantite` pour chaque fiche, sinon exception | Exception qui liste les fiches à quantité **négative**, les fiches dont la structure n'a pas de PV | Script qui **restaure le compteur depuis le stock calculé** (`quantite = GREATEST(agrégat, 0)`, `disponible = quantite > 0`, liste des fiches négatives écrêtées), puis supprime triggers et tables. Pertes documentées : lots, coûts, journal. Valable même après activité réelle |
| M5 | `20261026130000_pharmacie_t1_caisse` | PB09 | `SessionCaisse`, `ComptageCaisse`, `LigneComptage`, `ReleveModePaiement`, `MouvementCaisse`, `Paiement`, `ResultatSessionMode`, `ClotureJournaliere`, `TotalClotureMode`, `Reception`, `Inventaire`, `LigneInventaire`, `EvenementSynchro`, index partiel de session ouverte, triggers d'immuabilité | Une session technique par PV (`FERMEE`, `technique`, poste `REPRISE`, `utilisateurNom` « Reprise historique », `ouverteLe` = première vente ou date de migration) | aucune | `DROP` (refusé par le script s'il existe une session non technique : il faut d'abord le retour de M6) |
| M6 | `20261026140000_pharmacie_t1_ventes_pieces` | PB09 | Colonnes de 1.4 sur `Vente` et `LigneVente`, enums, `AllocationLot`, FK `Vente`→`Structure` et `LigneVente`→`Vente` en Restrict, triggers d'immuabilité de `Vente`, `LigneVente`, `AllocationLot` | `pointDeVenteId` depuis la pharmacie, `posteId` = `REPRISE`, `sessionCaisseId` = session technique, `jourMetier` = `(createdAt AT TIME ZONE 'UTC')::date`, `nombreAffiche` = `quantite`, `coefficientApplique` 1, puis `SET NOT NULL` | Exception qui liste les ventes dont la structure n'a pas de PV | Script : pour chaque pièce d'annulation, reporte `statut ANNULEE`, `annuleeLe`, `annuleeParId`, `motifAnnulation` sur l'origine (trigger désactivé le temps du script), supprime pièces d'annulation et de régularisation, paiements et allocations, puis colonnes, FK Cascade restaurées. Les ventes `T-` restent (numéro unique), sans allocation : le compteur restauré par M4 bas les reflète déjà |

**Colonne `quantite` gelée une version.** M4 pose un trigger `BEFORE UPDATE` sur `StockMedicament` qui refuse tout changement de `quantite` ou `disponible` (un ancien chemin oublié échoue bruyamment au lieu de diverger). Commande en lecture seule `npm run stock:comparer-compteur` (dev) ou `node dist/scripts/stock-comparer-compteur.js` (production) : pour chaque fiche, (1) compteur figé contre somme des mouvements `MIGRATION` (doit être égal : prouve la reprise), (2) agrégat contre recalcul depuis les mouvements (doit être égal : prouve l'agrégat), (3) compteur figé contre stock calculé actuel (écart informatif = activité nette depuis la migration, ventilée par type de pièce). Sortie : nombre de fiches en écart sur (1) et (2), code de sortie non nul s'il y en a. La suppression de la colonne (version suivante, hors tranche) exige (1) et (2) à zéro.

**Version suivante (hors tranche, noté pour mémoire)** : suppression de `quantite`, `disponible`, `dateExpiration` de `StockMedicament`, de `CompteurVente`, des colonnes gelées de `Vente`.

---

## 3. Contrats d'API

Toutes les routes sont sous `AuthGuard` + `PermissionsGuard`, réponses `{ success, message, data }`, erreurs `{ statusCode, message, error, code?, champs?, details? }` avec codes ajoutés au catalogue `codes-erreur.ts` et à `CODES_AVEC_DETAILS` quand ils portent des lignes. Le contrôle d'accès pharmacie est **unifié** (O6, D406) : `AccesPharmacieService.verifier(structureId, userId)` = membre (`structureId`) ou administrateur (`adminId`), structure de type PHARMACIE, active ; la permission est vérifiée par la garde. Il remplace `checkPharmacieAccess` (enum) et `verifierPharmacie`. Effet : un compte d'enum `ACCUEIL` porteur d'un rôle personnalisé avec `stock:read` voit désormais le stock.

**Masquage des coûts** (O6, D407) : une seule fonction `masquerCouts(donnees, peutVoirMarge)` appliquée à la sortie de chaque service qui manipule un coût (`coutUnitaire`, `coutAchatBoite`, `valeurCout`, `cout*`, `marge*`), avec liste explicite des chemins ; un test de permission parcourt la réponse JSON de **chaque** route listée ci-dessous avec un vendeur et échoue si une clé correspond à `/cout|marge/i`.

### 3.1 Routes existantes modifiées

| Route | Permission | Changement |
|---|---|---|
| `POST /pharmacie/:structureId/ventes` | `vente:write` + `caisse:utiliser` | Corps : `{ lignes: [{ stockId, quantite, unite?: "BOITE"\|"UNITE", sortieManuelle?: { lotId, motif } }], paiements?: [{ mode, montant, reference?, montantRecu? }], posteId?, clientNom?, clientTelephone?, ordonnanceVerifiee? }`. Sans `unite`, `quantite` = nombre de boîtes (compatibilité : coefficient 1 donc identique). Sans `paiements`, un paiement `ESPECES` du total. Sans `posteId`, poste web de l'utilisateur créé à la volée. Session **ouverte automatiquement** si aucune n'est ouverte pour ce poste (D428). Prix lus de la fiche (jamais du client). Allocation reliquat puis FEFO ; stock absent : allocation provisoire et anomalie, **jamais de refus de stock** (O11). Réponse : forme actuelle conservée plus `uniteAffichee`, `nombreAffiche`, `allocations` (sans coût sauf `marge:read`), `provisoire`, `paiements`, `session { id, ouverteAutomatiquement }`, `poste { id, code }`, `typePiece`, `annulation` |
| idem, codes d'erreur | | Supprimés : `STOCK_INSUFFISANT` (plus jamais renvoyé), `MEDICAMENT_EXPIRE` remplacé par `SORTIE_MANUELLE_REQUISE`. Conservés : `STOCK_INTROUVABLE` 404, `PRIX_MANQUANT` 400 (prix boîte absent pour une vente par boîte), `ORDONNANCE_NON_CONFIRMEE` 400, `VALIDATION` 400. Nouveaux : 400 `VENTE_UNITE_INTERDITE` (fiche non déconditionnable, message « Ce médicament se vend uniquement à la boîte. »), 400 `PRIX_UNITE_MANQUANT`, 409 `SORTIE_MANUELLE_REQUISE` (il ne reste que des lots périmés : `details [{ stockId, nom, lots: [{ lotId, numeroLot, dateExpiration, quantite }] }]`), 400 `MOTIF_REQUIS`, 400 `PAIEMENTS_INCOHERENTS` (somme différente du total), 400 `MODE_PAIEMENT_INCONNU`, 409 `POSTE_INCONNU`, 409 `SESSION_AUTRE_UTILISATEUR` (poste desktop occupé par un autre vendeur) |
| `GET /pharmacie/:structureId/ventes` | `vente:read` | Filtre par `jourMetier` (et non plus `createdAt`) ; liste aussi les pièces d'annulation (`typePiece`, `total` négatif, `venteOrigine { id, numero }`) ; `totalJour` = somme signée des pièces du jour ; `statut` dérivé (`ANNULEE` si une pièce d'annulation existe) |
| `GET /pharmacie/:structureId/ventes/:venteId` | `vente:read` | Champs ajoutés comme à la création ; `annuleeLe`, `annuleeParId`, `motifAnnulation` dérivés de la pièce d'annulation |
| `POST /pharmacie/:structureId/ventes/:venteId/annuler` | `vente:annuler` (+ `caisse:utiliser`) | Crée une **pièce d'annulation** (O5) : lignes, allocations et paiements opposés, mouvements de stock `CORRECTION` positifs sur les mêmes lots (pièce `ANNULATION`), rattachée à la session courante de l'auteur (ouverte automatiquement) et au jour courant. Plus de limite au jour même. Codes : 409 `VENTE_DEJA_ANNULEE` (pièce existante, y compris par course : unicité de `venteOrigineId`), 409 `PIECE_NON_ANNULABLE` (pièce d'annulation ou de régularisation) ; `ANNULATION_HORS_DELAI` supprimé. Réponse : la vente d'origine avec `annulation { id, numero, motif, le, par }` |
| `GET /pharmacie/stock/:structureId` | `stock:read` + `stock:write` (inchangé) | Contrat de 1.7 ; `alertes.stockBas` = `0 < quantite < seuilStockBas` (10 par défaut), `alertes.rupture` = `quantite <= 0` (négatif inclus, D416) ; formes des objets inchangées |
| `POST /pharmacie/stock/:structureId` (upsert) | idem | Crée ou met à jour la fiche (prix boîte, notes, et nouveaux champs). `quantite` : création = lot non technique sans coût (non valorisable) et mouvement `RECEPTION` ; mise à jour = mouvement `INVENTAIRE` vers la quantité saisie si la fiche a **un seul** lot non épuisé, sinon 409 `LOT_REQUIS` (« Ce médicament a plusieurs lots : faites un inventaire. ») ; `dateExpiration` corrige la date du lot unique (audit). Réponse avec `avertissements` (1.2) |
| `PATCH /pharmacie/stock/:structureId/:stockId/quantite` | idem | Corps `{ variation, lotId?, motif? }` : mouvement `CORRECTION` (pièce `AJUSTEMENT`) sur le lot donné ou l'unique lot ; 409 `LOT_REQUIS` ; résultat négatif d'un lot : 409 `STOCK_LOT_NEGATIF` (au lieu de l'écrêtage silencieux à 0) |
| `DELETE /pharmacie/stock/:structureId/:stockId` | idem | **Archivage** (`archiveLe`), jamais de suppression physique ; la fiche sort des listes, de la vente et de la recherche publique ; un upsert la désarchive |
| `POST /pharmacie/stock/:structureId/import` et `/import/apercu` | idem (+ `reception:write` pour `livraison`, `inventaire:write` pour `inventaire`) | `livraison` = une `Reception` (un lot par ligne ; colonnes facultatives ajoutées « Lot », « Coût d'achat » par boîte) ; `inventaire` = un `Inventaire` (un lot par fiche requis, sinon ligne rejetée avec message) ; rapports `quantiteAvant` et `quantiteApres` conservés |
| `DELETE /pharmacie/catalogue/:medicamentId` | `catalogue:manage` | 409 `MEDICAMENT_UTILISE` si une fiche de n'importe quelle pharmacie a un lot, un mouvement ou une ligne de vente ; sinon comportement actuel |
| `GET /pharmacie/catalogue/:medicamentId` et `GET /pharmacie/rechercher` (publics) | publique | Disponibilité et `quantite` lues de `quantiteVendable` (lots non périmés) et fiche non archivée, au lieu de `disponible`/`quantite` gelés ; `prixUnitaire` = prix boîte ; ajout `coefficientBoite`, `prixUnite` (D426) |
| `POST /super-admin/structures/:structureId/delete` | inchangée | 409 `STRUCTURE_AVEC_PIECES` (« Cette structure a des ventes ou des mouvements de stock : désactivez-la. ») si vente, lot, mouvement, session ou clôture (O12, D430) |

### 3.2 Routes créées (préfixe `/pharmacie/:structureId`)

| Méthode, chemin | Permission | Corps | Réponse | Erreurs |
|---|---|---|---|---|
| `PATCH /stock/:stockId/fiche` | `stock:write` | `{ prixUnitaire?, prixUnite?, coefficientBoite?, uniteMinimale?, deconditionnable?, toleranceInventaire?, qualifie?, conversionStock? }` | fiche + `avertissements: [{ code: "ECART_PRIX", ecartPct }]` (non bloquant, seuil `seuilAvertissementPrixPct`) | 400 `PRIX_UNITE_SANS_DECONDITIONNEMENT`, 400 `CONVERSION_REQUISE` |
| `GET /stock/:stockId/lots` | `stock:read` | | `[{ id, numeroLot, dateExpiration, quantite, reliquat, lotTechnique, coutUnitaire? }]` | 404 |
| `GET /referentiels` | `vente:read` ou `caisse:utiliser` | | `{ modesPaiement, coupures, parametres }` | |
| `POST /postes` | `caisse:utiliser` | `{ type: "WEB"\|"DESKTOP", appareilId, libelle? }` | poste (idempotent par `appareilId`) | |
| `GET /postes` | `caisse:superviser` | | postes avec `dernierContactLe`, `dernierEtat`, session ouverte | |
| `PATCH /postes/:posteId` | `structure:write` | `{ libelle?, actif? }` | | |
| `POST /caisse/sessions` | `caisse:utiliser` | `{ id?, posteId, comptage? }` | session | 409 `SESSION_DEJA_OUVERTE` (renvoie la session existante si même utilisateur : idempotent), 409 `SESSION_AUTRE_UTILISATEUR` |
| `GET /caisse/sessions/courante?posteId=` | `caisse:utiliser` | | session ou `null` | |
| `POST /caisse/sessions/:id/comptages` | `caisse:utiliser` (sa session) ou `caisse:superviser` | `{ id?, moment, coupures: [{ valeurFaciale, nombre }], releves?: [{ mode, montant }] }` | comptage + total | 409 `COMPTAGE_DEJA_SAISI`, 409 `SESSION_FERMEE` |
| `POST /caisse/sessions/:id/mouvements` | idem | `{ id?, type, montant, motif, mode? }` | mouvement | 400 `MOTIF_REQUIS`, 409 `SESSION_FERMEE` |
| `GET /caisse/sessions/:id/bilan` | idem | | `{ activite: { nombreVentes, montantEncaisse, parMode }, theorique: [{ mode, montant }], compte?, ecarts? }` : l'activité du vendeur d'abord | |
| `POST /caisse/sessions/:id/fermer` | idem | `{ comptageFermeture?, commentaire? }` (le comptage peut être envoyé ici en un seul appel) | bilan figé | 400 `COMPTAGE_FERMETURE_REQUIS`, 400 `COMMENTAIRE_ECART_REQUIS` (écart espèces en valeur absolue au-dessus de `seuilEcartCaisse`) ; fermeture sans comptage d'ouverture : fond = 0 et anomalie `FOND_NON_COMPTE` |
| `GET /caisse/sessions?jour=` | `caisse:superviser` | | sessions du jour | |
| `GET /caisse/clotures/:jour/preparation` | `cloture:gerer` | | `{ sessions, sessionsOuvertes, postesAttendus: [{ code, libelle, dernierContactLe }], totaux: [{ mode, theorique, compte, ecart }], peutCloturer }` | 400 `JOUR_AVANT_DEBUT_CAISSE` |
| `POST /caisse/clotures` | `cloture:gerer` | `{ jour, forcer?: boolean, motifForcage? }` | clôture | 409 `CLOTURE_INCOMPLETE` (`details`: postes attendus, sessions ouvertes) sauf `forcer` ; 400 `MOTIF_REQUIS` si forcée ; 409 `JOURNEE_DEJA_CLOTUREE` |
| `GET /caisse/clotures?mois=AAAA-MM` | `cloture:gerer` | | liste | |
| `GET /caisse/clotures/:jour/export` | `cloture:gerer` | | CSV (`text/csv`, UTF-8 avec BOM pour Excel) : une ligne par pièce et par paiement, sans coût | |
| `GET /fournisseurs`, `POST /fournisseurs` | `reception:write` | `{ nom, telephone? }` | | 409 `FOURNISSEUR_EXISTANT` |
| `POST /receptions` | `reception:write` | `{ fournisseurId?, reference?, recueLe?, lignes: [{ stockId, numeroLot?, dateExpiration?, nombreBoites?, quantiteUnites?, coutAchatBoite? }] }` | réception, lots, allocations provisoires résolues | 400 `VALIDATION` |
| `GET /receptions`, `GET /receptions/:id` | `reception:write` | | | |
| `PATCH /lots/:lotId` | `reception:write` | `{ dateExpiration, motif }` | lot (audit) | |
| `POST /stock/sorties` | `stock:write` | `{ stockId, lotId, quantite, type: "PERTE"\|"PEREMPTION", motif }` | mouvement | 400 `MOTIF_REQUIS`, 409 `STOCK_LOT_NEGATIF` |
| `POST /inventaires` | `inventaire:write` | `{ commentaire?, lignes: [{ stockId, lotId?, quantiteComptee }] }` | inventaire, lignes, anomalies ouvertes | 409 `LOT_REQUIS` |
| `GET /inventaires/:id` | `inventaire:write` | | | |
| `GET /anomalies?statut=` | `anomalie:gerer` | | file paginée | |
| `PATCH /anomalies/:id` | `anomalie:gerer` | `{ commentaire }` | anomalie traitée | 409 `ANOMALIE_DEJA_TRAITEE` |
| `GET /stock/alertes-peremption` | `stock:read` | | `{ horizons: [{ jours, lots: [{ lotId, stockId, nom, numeroLot, dateExpiration, quantite, quantiteBoites, valeurVente, valeurCout? }] }], perimes: [...] }`, `valeurCout` seulement avec `marge:read` | |
| `GET /rapports/marge?du=&au=` | `marge:read` | | `{ chiffreAffairesValorise, coutAlloue, marge, nonValorisable: { nombreVentes, chiffreAffaires }, provisoires: { nombreLignes, chiffreAffaires }, debutFiabilite }` | |
| `GET /parametres`, `PATCH /parametres` | `caisse:utiliser` / `structure:write` | champs de `ParametresPharmacie` modifiables | | |

### 3.3 API de synchronisation (desktop)

| Méthode, chemin | Permission | Contrat |
|---|---|---|
| `GET /synchro/catalogue?posteId=` | `caisse:utiliser` | Photographie complète avec `ETag` (304 si inchangée) : fiches non archivées (nom, formes, ordonnance requise, prix, coefficient, UM, déconditionnable), lots non épuisés avec solde, reliquats, paramètres, modes, coupures, et `sequenceAppliquee` du poste. Sans coût. Quelques milliers de fiches : environ 1 Mo compressé, suffisant pour T1 (pas de delta, D437) |
| `POST /postes/:posteId/plages` | `caisse:utiliser` | Réserve `taillePlageTickets` numéros sur `CompteurTicket` ; réponse `{ debut, fin }` ; un poste garde au plus 2 plages non épuisées (409 `PLAGES_SUFFISANTES`) |
| `POST /synchro/evenements` | `caisse:utiliser` | Corps `{ posteId, etat: { fileVide, sessionOuverte, versionApp }, evenements: [{ evenementId, sequence, type, horodatageLocal, utilisateurId, corps }] }`, 200 événements au plus, triés par séquence. Réponse `{ resultats: [{ evenementId, statut: "APPLIQUE"\|"DEJA_APPLIQUE"\|"EN_ATTENTE"\|"REJETE", code?, anomalies?: [{ type, id }], piece?: { type, id, numero } }], sequenceAppliquee }` |

Types d'événements : `SESSION_OUVERTE`, `COMPTAGE_SAISI`, `MOUVEMENT_CAISSE`, `VENTE`, `SESSION_FERMEE`. L'annulation, la réception, l'inventaire et la clôture restent en ligne (dit à l'utilisateur, 4.5).

Règles du rejeu (D433, D434) :
1. **Idempotence** : `evenementId` déjà connu avec la même empreinte : `DEJA_APPLIQUE` et le résultat stocké, rien n'est réappliqué. Même `evenementId`, empreinte différente : `REJETE` code `EVENEMENT_MODIFIE`. Même `(posteId, sequence)` avec un autre `evenementId` : `REJETE` code `SEQUENCE_DEJA_UTILISEE`.
2. **Ordre par poste** : un événement n'est appliqué que si `sequence = derniereSequenceAppliquee + 1`. Sinon il est stocké `EN_ATTENTE` et appliqué dès que le trou est comblé (cas « ordre inversé »). Un trou de plus de 24 h ouvre `SEQUENCE_MANQUANTE`.
3. **Une transaction par événement**, verrous consultatifs `pg_advisory_xact_lock` par fiche triés par `stockMedicamentId` (pas d'interblocage avec les ventes web ni avec un autre poste).
4. **Jamais de refus métier d'un événement passé** : la vente a eu lieu. Le serveur **réalloue lui-même** les lots selon son état (les allocations locales sont indicatives) ; stock serveur absent : allocation provisoire et `STOCK_NEGATIF` ; il ne reste que du périmé : provisoire et anomalie (jamais de prise automatique d'un périmé) ; ordonnance non confirmée, unité sur fiche non déconditionnable, fiche archivée : appliqué et anomalie ; prix différent du prix serveur : prix du ticket conservé et `PRIX_DIVERGENT`.
5. **Conflits inter postes, par règle métier** : stock (réallocation serveur, provisoire), plaquette ouverte en double (`CONDITIONNEMENT_CONCURRENT`), numéros (impossibles par construction : plages, et numéros de secours préfixés par le code du poste), journée déjà clôturée (pièce de `REGULARISATION` rattachée au jour courant, qui pointe l'événement et porte `jourMetierOrigine`, plus `REMONTEE_APRES_CLOTURE` attribuée au vendeur de la session).
6. **Événement illisible** (schéma invalide) : `REJETE` code `EVENEMENT_INVALIDE`, la séquence avance quand même et `EVENEMENT_REJETE` est ouverte avec le corps : un poste n'est jamais bloqué à vie.
7. **Attribution** : chaque événement porte son `utilisateurId` ; il doit être membre de la pharmacie avec `caisse:utiliser`. Le compte qui envoie le lot peut être un autre vendeur du même poste (D436).

### 3.4 Ce qui change pour le front existant

| Point | Changement |
|---|---|
| `stockId` | Inchangé : identifiant de la fiche (`StockMedicament.id`), toujours la clé du panier et des lignes de vente |
| Panier `localStorage` | Version 1 lue et convertie en version 2 : `lignes: [{ stockId, unite, nombre }]` (v1 `quantite` = `nombre` en `BOITE`) ; la clé d'idempotence reste par panier |
| Alertes | Objet `alertes` et champs `quantite`, `prixUnitaire`, `dateExpiration` de `stocks` conservés (1.7) ; `apercu_pharmacie.ts` corrigé pour la valeur au prix de vente (`quantite x prixBoite / coefficient`) ; rupture inclut le négatif |
| Erreurs de vente | `STOCK_INSUFFISANT` disparaît (le code de correction du panier reste toléré mais mort), `MEDICAMENT_EXPIRE` devient `SORTIE_MANUELLE_REQUISE` |
| Annulation | Plus de délai ; l'écran montre la pièce d'annulation ; « Ventes du jour » liste les pièces d'annulation |
| Recherche publique | Même forme ; quantité vendable |
| Web en ligne seulement | Bandeau sur « Nouvelle vente » et « Ma caisse » : « La vente sans connexion est disponible dans l'application MedConnecte Caisse pour Windows. » ; échec réseau : message clair, rien n'est enregistré |

---

## 4. Architecture desktop Electron

### 4.1 Emplacement et découpage

`front_medconnect/desktop/` (D438), avec son propre `package.json` (Electron et SQLite ne polluent pas le build web), exclu du `tsconfig`, de `vitest` et d'`eslint` racine du front, avec ses propres scripts `test`, `build`, `dist`.
```
desktop/
  coeur/        module hors ligne indépendant : TypeScript pur, aucune importation d'electron ni de next
  electron/     main.ts, preload.ts, serveur-next.ts, impression.ts, maj.ts, ipc.ts
  scripts/      construire-front.mjs (next build standalone puis copie public et .next/static)
  vecteurs/     copie des vecteurs de test JSON de la sélection de lots (source : back)
```
Les règles pures partagées avec l'écran de vente web (prix, conversion, reliquat, sélection reliquat puis FEFO, théorique de caisse) vivent dans `front_medconnect/src/lib/caisse/regles/` et sont importées par `desktop/coeur` (même dépôt, pas de paquet à publier). Le back a sa propre implémentation ; les deux sont testées contre les **mêmes vecteurs JSON** (`back_medconnect/test/vecteurs/selection-lots.json`, copiés dans le front par une tâche, D439).

### 4.2 Embarquement du front

- **Sortie `standalone`** (documentation Next.js 16 locale, `output.md`) activée seulement si `NEXT_OUTPUT=standalone` dans `next.config.ts` (le build web et Docker restent inchangés). L'**export statique est impossible** sans refonte : `src/proxy.ts`, `headers()` de `next.config.ts` et routes dynamiques sans `generateStaticParams` (`ventes/[venteId]`, `carnet/[patientId]`, `setup-structure/[token]`) ne sont pas supportés (`static-exports.md`, « Unsupported Features »).
- Le processus principal lance `server.js` du standalone par `utilityProcess.fork` (pas `ELECTRON_RUN_AS_NODE`, ce qui permet de couper le fusible `RunAsNode`), avec `HOSTNAME=127.0.0.1` et un **port fixe** `47613` (replis `47614`, `47615`) : l'origine doit être stable pour `localStorage`, le cookie témoin `mc_connecte` et le CORS de l'API (D440). Le back accepte ces origines par une variable `DESKTOP_ORIGINS` (liste) ajoutée à `enableCors` (aujourd'hui `FRONTEND_URL` seul).
- `NEXT_PUBLIC_API_URL` est inlinée au build desktop (URL de production). Même design, mêmes logos, mêmes pages : aucune refonte.
- Mémoire estimée : processus principal environ 80 Mo, serveur Next environ 120 Mo, rendu environ 150 Mo : 350 Mo environ sur un PC de 4 Go. Mesure exigée par PD01 ; si plus de 500 Mo, repli étudié (6.3, point 1).

### 4.3 Base locale et cœur hors ligne

- **SQLite** par `better-sqlite3` (synchrone, rapide, binaires précompilés Windows, reconstruit pour l'ABI Electron par `@electron/rebuild`), fichier dans `%APPDATA%/MedConnecte Caisse/caisse.sqlite`, journal WAL. Le cœur dépend d'une interface `Stockage` ; tests du cœur sur SQLite en mémoire, sans Electron (D441).
- Tables locales : `catalogue` (photographie serveur), `lots`, `reliquats`, `parametres`, `referentiels`, `plages`, `sessions`, `ventes` et `lignes` locales, `evenements` (journal : `sequence` locale croissante par poste, `evenementId` UUID v7, `statut` `A_ENVOYER`, `ENVOYE`, `REJETE`), `etat_poste` (`posteId`, `sequenceAppliquee`, `etag`).
- Stock local = photographie serveur moins les ventes locales dont la séquence dépasse `sequenceAppliquee` de la photographie (aucun double décompte entre l'accusé de réception et la nouvelle photographie).
- Le cœur expose : `rechercher(texte)` (en mémoire, moins de 150 ms visé, mesuré en test sur 5 000 fiches), `ouvrirSession()` en un geste, `saisirComptage()`, `enregistrerVente()` (numéro pris dans la plage, sélection locale reliquat puis FEFO, provisoire si rien), `mouvementCaisse()`, `fermerSession()`, `bilanSession()`, `etat()` (en ligne, file, plage restante).
- **Plage de tickets** : 1 000 par poste, rechargement demandé dès qu'il reste moins de 20 % (200) et que le poste est en ligne, deux plages au plus en réserve. Plage épuisée hors ligne : la vente continue avec un **numéro de secours** `S<ordrePV>-<codePoste>-<n>` unique par construction, imprimé sur le ticket, et `PLAGE_EPUISEE` est ouverte à la synchro. Jamais de blocage.

### 4.4 Synchronisation et authentification

- La synchro tourne dans le processus principal (minuterie de 30 s, immédiate après une vente si en ligne, reprise exponentielle de 5 s à 5 min), par lots de 200 événements, accusés un par un.
- **Jetons** : le jeton d'accès reste là où le front web le met (`localStorage` du rendu, design actuel) et est poussé au processus principal par IPC à chaque connexion ou rafraîchissement ; il n'est gardé qu'en mémoire du processus principal. Le refresh reste le cookie httpOnly de l'API dans la session Electron persistée (production : `SameSite=None; Secure`, déjà le cas, `sessions.service.ts:515`). Sur 401, le processus principal demande au rendu de rafraîchir (flux existant). Aucun jeton dans SQLite ni dans les journaux.
- **Hors ligne au redémarrage** : le dernier utilisateur connecté reste connecté (profil `/auth/me` mis en cache par le front en mode desktop seulement) ; changer de vendeur hors ligne est impossible et le message le dit (D442, question Q06).

### 4.5 Ce qui marche hors ligne, ce qui ne marche pas (dit à l'utilisateur)

| Hors ligne : oui | Hors ligne : non (message « Cette action demande une connexion. ») |
|---|---|
| Recherche dans le catalogue local, vente boîte ou unité, reliquat affiché | Réception de lots, inventaire, sortie de périmés |
| Paiements espèces, Orange Money, MTN MoMo (saisie manuelle) | Annulation d'une vente |
| Ouverture de session en un geste, comptages, mouvements de caisse, fermeture et bilan | Clôture journalière, anomalies, rapports, marge, alertes de péremption à jour (dernière version connue affichée avec sa date) |
| Impression du ticket, réimpression des ventes du poste | Fiches produit et prix, équipe, paramètres |
Bandeau permanent en desktop : « En ligne » ou « Hors connexion : les ventes sont enregistrées sur ce poste (N en attente d'envoi). » ; pastille d'alerte si la plage est épuisée ou si un événement a été rejeté.

### 4.6 Impression

Fenêtre cachée qui rend la page de reçu existante (58 mm, 80 mm, A4 déjà gérés par `@media print`) alimentée par la vente locale, puis `webContents.print({ silent: true, deviceName })`. Imprimante choisie une fois dans les réglages du poste (`getPrintersAsync`). ESC/POS brut hors tranche (les imprimantes thermiques ont un pilote Windows). Impression silencieuse : aucun dialogue sur le chemin nominal.

### 4.7 Mise à jour

`electron-builder` cible NSIS **par utilisateur** (pas de droits administrateur), `electron-updater` fournisseur générique (URL à fournir, Q05). Téléchargement en arrière-plan, installation **uniquement à la fermeture** ou sur demande, jamais pendant une session de caisse ouverte avec une file non vide. Version affichée dans les réglages.

### 4.8 Sécurité

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` ; préchargement qui expose par `contextBridge` une API typée minimale (`window.medconnecteDesktop`, contrat dans `src/lib/caisse/contrat_desktop.ts`) ; chaque gestionnaire IPC vérifie l'origine de l'émetteur (`http://127.0.0.1:<port>`) et valide ses arguments (Zod, déjà dépendance du front) ; navigation verrouillée (`will-navigate` et `setWindowOpenHandler` : liens externes https seulement, ouverts dans le navigateur) ; CSP existante conservée ; outils de développement fermés en production ; fusibles Electron : `RunAsNode` coupé, `EnableCookieEncryption` activé, `OnlyLoadAppFromAsar` et intégrité asar activés ; serveur Next lié à `127.0.0.1` seulement. Base SQLite non chiffrée en T1 (pas de dossier médical : ventes, éventuellement nom et téléphone du client), question Q12.

---

## 5. Tâches, dans l'ordre d'exécution

Identifiants : `PB` (back, `orch/pharmacie-t1-back`), `PF` (front, `orch/pharmacie-t1-front`), `PD` (desktop, même branche front). Tier : `dur` (opus), `spécifié` (sonnet). Chaque tâche : un commit après validation, gate du dépôt vert, tests listés écrits et verts. Jalons de déploiement : J1 = PB01 à PB06 (aucun changement de comportement visible) ; J2 = PB07 à PB13 (**indissociables** : à partir de PB07 le compteur est gelé, ils n'ont de sens qu'ensemble) ; J3 = PB14 à PB19 ; puis front ; puis desktop. La branche n'est fusionnée vers `dev` qu'à la fin (O14), donc aucun état intermédiaire n'est déployé.
Critères d'acceptation numérotés CA1 à CA26 dans l'ordre de la demande.

### Back

**PB01 Harnais de base de test** (dur, back). `test/db/` avec `jest-db.json`, script `npm run test:db`, hors `npm test` (pre-push inchangé). Crée une base jetable `mc_test_<aléa>` sur `TEST_DATABASE_URL` (Postgres du compose), applique les `migration.sql` dans l'ordre jusqu'à une migration donnée, applique un script `.down.sql`, charge un jeu « format actuel » (`test/db/fixtures/format-actuel.ts` : 3 pharmacies, 1 hôpital, 40 fiches dont quantités 0, 1, 9, 10, 11, 240, dates passées, du jour, futures, nulles, prix nuls ; ventes `VALIDEE` et `ANNULEE` ; compteurs), instancie `PrismaService` sur cette base, supprime la base à la fin. Tests : le harnais applique toutes les migrations existantes et lit le jeu ; une migration volontairement fautive ne laisse rien (vérifie la transaction, D432). Dépendances : aucune.

**PB02 Non-régression des alertes et des lectures, avant recâblage** (spécifié, back). Sur la base de PB01 au format actuel : appelle `getStockPharmacie`, `rechercherDisponibilite`, `getMedicament`, `listerVentes`, `detailVente` et fige leurs sorties en instantanés JSON (`test/db/instantanes/`), champs volatils normalisés. Le même test sera rejoué après migration (PB08, PB11) et doit produire le même résultat. Couvre : test de non-régression des alertes exigé. Dépendances : PB01.

**PB03 Permissions T1 et contrôle d'accès unifié** (spécifié, back). Constantes, catalogue, liste blanche pharmacie, rôles par défaut (titulaire : les 7 ; Pharmacien : `caisse:utiliser`), `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` étendue (complément au démarrage), migration M1 et son retour ; `AccesPharmacieService` qui remplace `checkPharmacieAccess` et `verifierPharmacie` ; `masquerCouts` (fonction seule, testée). Tests : specs RBAC mises à jour, hôpital sans ces permissions, ACCUEIL avec rôle personnalisé accède au stock, test harnais M1 haut, bas, haut. Dépendances : PB01.

**PB04 Règles pures du domaine et vecteurs de test** (dur, back). `src/pharmacie/domaine/` : conversion boîte et UM dans les deux sens avec arrondis entiers explicites, prix de ligne (boîte : montant = n x prixBoite, prix appliqué arrondi ; unité : n x prixUnite), avertissement d'écart de prix, reliquat dérivé, sélection reliquat puis FEFO (périmés exclus, nuls d'abord, égalité par réception puis id, multi lots, boîte sur boîtes intactes, reste provisoire), théorique de caisse par mode, marge depuis allocations avec exclusion des non valorisables. `test/vecteurs/selection-lots.json`. Tests unitaires exigés par la demande (CA1, CA2, CA3 au niveau calcul, CA7, CA9, CA10, CA11, CA12, CA15 calcul). Dépendances : aucune.

**PB05 Points de vente, postes et référentiels** (spécifié, back). Migration M2 et retour, modèles de 1.1, création du PV à la création d'une pharmacie et complément au démarrage, `GET /referentiels`, `GET`/`PATCH /parametres`, `POST`/`GET`/`PATCH /postes`. Purge démo : ordre de suppression étendu. Tests : harnais (PV unique par pharmacie, arrêt et liste sur stock d'un hôpital, retour arrière), insertion d'un mode de paiement sans migration (CA17), routes. Dépendances : PB03.

**PB06 Fiche produit étendue** (spécifié, back). Migration M3 et retour, champs de 1.2 dans les DTO (avec correction `UpsertStockDto.quantite` en `@IsInt`), `PATCH /stock/:stockId/fiche` sans conversion, avertissement non bloquant, refus `prixUnite` sur fiche non déconditionnable, champs ajoutés aux réponses de stock. Tests : modifier le prix boîte ne change pas le prix unité et réciproquement (CA3), avertissement au-delà de 25 %, harnais M3. Dépendances : PB05.

**PB07 Lots, journal, agrégats, reprise** (dur, back). Migration M4 et retour, modèles de 1.3, triggers (agrégats, immuabilité avec contournement de purge, gel de `quantite`/`disponible`), reprise, commandes `stock:reconstruire`, `stock:verifier`, `stock:comparer-compteur`, `pharmacie:pre-migration`. Purge démo adaptée (ordre, contournement). Tests harnais, **premier test écrit** : stock calculé = compteur d'origine fiche par fiche ; puis agrégat = recalcul, reprise rejouable sans doublon, arrêt et liste sur quantité négative, retour arrière qui restaure le compteur, mise à jour de `quantite` refusée, mouvement non modifiable, lot jamais négatif (CHECK), index partiel du conditionnement (CA6 en base), PV non nul sur lot et mouvement (CA26 partiel). Dépendances : PB06.

**PB08 Service de mouvements et lectures recâblées** (dur, back). `MouvementsStockService` (seul écrivain du journal : verrous consultatifs triés, maintien de `ConditionnementOuvert`, 409 `CONDITIONNEMENT_DEJA_OUVERT`), lectures sur agrégats (`getStockPharmacie` au contrat de 1.7, alertes avec seuil des paramètres, recherche publique et détail catalogue sur quantité vendable), chemins d'écriture hors vente recâblés (upsert, PATCH quantité, DELETE en archivage, refus de suppression d'un médicament utilisé). Tests : instantanés de PB02 identiques sur base migrée (alertes, stocks, recherche), seconde ouverture refusée (CA6 service), archivage, `LOT_REQUIS`. Dépendances : PB04, PB07.

**PB09 Tables de caisse et pièces de vente** (dur, back). Migrations M5 et M6 et leurs retours, modèles de 1.4 à 1.6, sessions techniques, FK Restrict, triggers, refus de suppression d'une structure avec pièces (super-admin) et purge démo adaptée. Tests harnais : ventes historiques lisibles par `detailVente` et `listerVentes` (instantanés PB02), PV, poste, session non nuls sur toutes les ventes (CA26), retour arrière M6 puis M5, pièce non modifiable, 409 `STRUCTURE_AVEC_PIECES`. Dépendances : PB08.

**PB10 Postes et sessions de caisse** (spécifié, back). Service et routes des sessions (ouvrir, courante, comptage par coupure, relevés mobiles, mouvements de caisse, bilan, fermer), théorique par mode depuis PB04, `ResultatSessionMode`, anomalies `FOND_NON_COMPTE` et `ECART_CAISSE`. Tests d'intégration : scénario 200 000 + 400 000 - 100 000, compté 490 000, théorique 500 000, écart -10 000 affiché tel quel (CA15) ; fermeture sans comptage refusée et commentaire exigé au-dessus du seuil (CA18) ; mouvements motivés et attribués ; session unique par poste. Dépendances : PB09.

**PB11 Vente recâblée** (dur, back). `creerVente` sur lots : unité ou boîte, deux prix, refus à l'unité sur fiche non déconditionnable, allocations reliquat puis FEFO, provisoire et `STOCK_NEGATIF` sans jamais bloquer, `SORTIE_MANUELLE_REQUISE` et sortie manuelle motivée, ordonnance toujours exigée, session ouverte automatiquement, paiements multiples (défaut espèces), numéro par `CompteurTicket`, clé d'idempotence permanente, réponse compatible plus nouveaux champs, coûts masqués, alerte de stock bas sur agrégat. Tests d'intégration (cycle complet sélection produit vers mouvements et allocations) : CA1, CA2, CA4, CA5, CA7, CA9, CA10, CA11, CA13, CA16, CA19 (aucune vente sans session), vente en négatif en ligne (O11), invariant somme des allocations, instantanés PB02 des ventes historiques inchangés. Dépendances : PB10.

**PB12 Annulation par écriture inverse et jour métier** (spécifié, back). Pièce d'annulation (O5), mouvements inverses sur les lots d'origine, paiements opposés dans la session courante, `jourMetier` des pièces, liste par jour métier, statut et champs d'annulation dérivés. Tests : double annulation refusée y compris en course, plus de limite de jour, pièce qui pointe l'origine, stock rendu au bon lot, théorique de la session courante diminué. Dépendances : PB11.

**PB13 Qualification d'une fiche** (spécifié, back). `conversionStock` dans `PATCH .../fiche` (1.7) : mouvements `CORRECTION` pièce `QUALIFICATION`, mise à jour du lot technique, `qualifie`. Tests : 12 boîtes de coefficient 1 qualifiées à 20 avec `MULTIPLIER` donnent 240 UM et un reliquat nul ; `CONSERVER` ne change rien ; conversion refusée après qualification. Dépendances : PB11.

**PB14 Réceptions, fournisseurs, lots et import livraison** (spécifié, back). Routes de 3.2 (réceptions, fournisseurs, lots, correction de date), coût figé et arrondi par UM, résolution des allocations provisoires à la réception (FEFO, pièce `RESOLUTION`, allocation `REMPLACEE` puis `DEFINITIVE`), import `livraison` vers réception avec colonnes facultatives Lot et Coût d'achat. Tests : coût figé, résolution d'une provisoire, import. Dépendances : PB11.

**PB15 Inventaire, sorties manuelles, anomalies et import inventaire** (spécifié, back). Inventaire par lot avec tolérance par fiche (mouvement écrit dans tous les cas, anomalie au-dessus attribuée à l'auteur), `POST /stock/sorties`, file d'anomalies (liste, traitement), import `inventaire` vers inventaire. Tests : CA8 (sous et au-dessus de la tolérance), sortie d'un périmé exige un motif (CA13 manuel), anomalie traitée une fois. Dépendances : PB14.

**PB16 Alertes de péremption, marge et étanchéité des coûts** (spécifié, back). Alertes par lot aux horizons des paramètres plus périmés, valorisation au coût (masquée sans `marge:read`) ; rapport de marge depuis les allocations (non valorisable à part, provisoires à part, date de fiabilité) ; test de permission transversal sur toutes les routes qui portent un coût. Tests : CA14, CA11 et CA12 de bout en bout, CA22 (vendeur sans aucune donnée de coût ni de marge, par endpoint). Dépendances : PB15.

**PB17 Clôture journalière** (dur, back). Préparation (sessions, postes attendus nommés selon D435), clôture, clôture forcée avec motif et postes manquants, `INCLUSE_DANS_CLOTURE`, refus de toute écriture directe sur un jour clôturé (`JOURNEE_CLOTUREE`), helper de rattachement au jour courant, export CSV. Tests d'intégration : CA20 (refus d'écriture, correction par annulation rattachée au jour courant qui pointe l'origine), clôture incomplète, clôture forcée qui enregistre le poste manquant (CA21 première moitié). Dépendances : PB12.

**PB18 Synchronisation desktop** (dur, back). Plages (`POST /postes/:id/plages`), photographie du catalogue avec ETag, `POST /synchro/evenements` selon 3.3 (idempotence, ordre par poste, attente, rejet non bloquant, réallocation serveur, règles inter postes, régularisation après clôture, numéros de secours), état du poste pour la clôture, `DESKTOP_ORIGINS` dans le CORS. Tests : doublon, ordre inversé, stock négatif temporaire, résolution d'allocation provisoire, deux postes simultanés sans collision ni perte (CA23), rejeu double sans mouvement en double (CA25), négatif hors ligne (CA24), remontée après clôture forcée : régularisation et anomalie sans toucher le jour verrouillé (CA21 seconde moitié). Dépendances : PB17, PB14.

**PB19 Seeds, démo et documentation** (spécifié, back). `seed_medicaments.ts` et `demo.seeder.ts` sur fiches qualifiées (coefficients réels, deux prix), réceptions avec lots et coûts réels, une session fermée avec ventes et paiements mixtes, une plaquette ouverte, une anomalie ; purge démo complète et testée ; `CLAUDE.md` back (contrats exacts), Swagger, `.env.example` et `compose.yml` (`DESKTOP_ORIGINS`, `TEST_DATABASE_URL`). Tests : seed démo sur base vide puis stock calculé non nul et cohérent (`stock:verifier` propre), purge puis recréation. Dépendances : PB18.

### Front web

**PF01 Vente : source de données, unité, reliquat, paiements** (spécifié, front). `src/lib/caisse/` : interface de source (en ligne seulement ici), contrat IPC typé (pour PD04), règles pures `regles/` avec les vecteurs JSON copiés ; types de `api_pharmacie.ts`/`api_ventes.ts` mis à jour ; panier version 2 (lecture v1) ; unité par défaut UNITE si la fiche est déconditionnable avec prix unité, sinon BOITE, bascule au clavier ; reliquat affiché en permanence pour le produit sélectionné ; mode de paiement dans la confirmation existante (espèces par défaut, Orange Money, MTN MoMo, paiement partagé, référence facultative) ; codes d'erreur nouveaux (`VENTE_UNITE_INTERDITE`, `SORTIE_MANUELLE_REQUISE` avec choix du lot et motif) ; badge « Caisse ouverte » ; bandeau « en ligne seulement ». Tests vitest : panier v1 vers v2, cinq interactions au plus pour une vente espèces d'une ligne (test qui compte les événements utilisateur), reliquat affiché, erreurs. Dépendances : PB11, PB12.

**PF02 Fiche produit : deux prix et qualification** (spécifié, front). `StockModal` : prix boîte, prix unité, UM, coefficient, déconditionnable, tolérance ; avertissement d'écart non bloquant ; filtre et compteur « à qualifier » sur la page stock ; choix de conversion à la première qualification ; `apercu_pharmacie.ts` corrigé (valeur, rupture négative). Tests vitest. Dépendances : PB13, PF01.

**PF03 Ma caisse : session, comptage, mouvements, fermeture** (spécifié, front). Ouverture en un geste depuis la vente ; comptage par coupure prérempli (référentiel), pavé numérique, Entrée passe à la coupure suivante sans navigation, total en direct, relevés mobiles facultatifs ; fermeture : activité du vendeur d'abord, puis écart signé, commentaire exigé au-delà du seuil ; dialogue prélèvement, apport, remboursement. Tests vitest dont fermeture complète au clavier. Dépendances : PB10, PF01.

**PF04 Annulation et ventes du jour** (spécifié, front). `AnnulationVente` sans délai, affichage des pièces d'annulation et du statut dérivé dans « Ventes du jour » et le reçu, numéros de ticket. Tests vitest mis à jour. Dépendances : PB12.

**PF05 Clôture journalière** (spécifié, front). Écran titulaire : préparation, postes attendus nommés, sessions ouvertes, totaux par mode, clôture, clôture forcée avec motif, export CSV. Tests vitest. Dépendances : PB17.

**PF06 Anomalies, alertes de péremption et marge (blocs minimaux)** (spécifié, front). Sur l'accueil « pilotage » existant : file d'anomalies (traiter avec commentaire), alertes par lot aux horizons (valeur au coût si reçue), bloc marge avec volume non valorisable et date de fiabilité. Réutilise les composants existants. Tests vitest. Dépendances : PB16, PF05.

### Desktop

**PD01 Squelette Electron et embarquement standalone** (dur, desktop). `desktop/` (package, `main`, `preload`, sécurité de 4.8), `NEXT_OUTPUT=standalone`, script de construction, serveur Next par `utilityProcess` sur port fixe, connexion en ligne contre l'API de dev avec refresh par cookie. Preuves : application lancée, connexion, navigation, mémoire mesurée (rapport), aucune régression du build web. Dépendances : PB18 (CORS), PF01.

**PD02 Cœur hors ligne** (dur, desktop). `desktop/coeur` : interface `Stockage`, adaptateur `better-sqlite3`, schéma local, journal à séquence, plages et numéros de secours, catalogue local et stock dérivé, sélection locale via `src/lib/caisse/regles`, sessions, comptages, mouvements, bilan. Tests vitest du cœur seul : vecteurs JSON, recherche sur 5 000 fiches en moins de 150 ms, plage épuisée, vente en négatif provisoire, ouverture en un geste. Dépendances : PF01. Réserve D713, D719 (2026-11-03) : le poste accepte toujours la vente hors ligne, mais PD02 et PD04 n'affichent jamais de négatif : 0 et « N à régulariser » ; la photographie fournit `quantite` écrêtée et `quantiteARegulariser`. Le refus 409 `STOCK_INSUFFISANT` ne vaut que pour la vente en ligne.

**PD03 Client de synchronisation** (spécifié, desktop). Dans le cœur : client HTTP injecté, photographie avec ETag, envoi par lots, accusés, rechargement de plage sous 20 %, reprise exponentielle, état. Tests contre un faux serveur : doublon, rejet non bloquant, ordre, pas de double décompte après photographie. Dépendances : PD02, PB18.

**PD04 Pont IPC et écrans en mode desktop** (dur, desktop). Gestionnaires IPC validés, `source_desktop.ts`, détection du pont, vente, Ma caisse et ventes du poste fonctionnant hors ligne, bandeau d'état, message sur les pages réservées au réseau, utilisateur conservé hors ligne, jeton d'accès poussé au processus principal. Preuves : scénario manuel réseau coupé (vente, fermeture de session, reprise et synchro), tests vitest de la source. Dépendances : PD03, PF03.

**PD05 Impression directe** (spécifié, desktop). Reçu depuis la vente locale, impression silencieuse, choix d'imprimante, 58 et 80 mm, réimpression. Preuve : impression vers une imprimante PDF Windows. Dépendances : PD04.

**PD06 Installation et mise à jour** (spécifié, desktop). `electron-builder` NSIS par utilisateur, fusibles, `electron-updater` générique, règle « pas d'installation pendant une session ouverte », notice d'installation pour l'officine (français, non-dev). Preuve : installation et mise à jour d'une version 0.1.0 vers 0.1.1 sur Windows. Dépendances : PD05.

### Couverture des critères d'acceptation

| CA | Tâches | CA | Tâches |
|---|---|---|---|
| CA1 6 UM à 600 = 3 600 | PB04, PB11 | CA15 session 500 000 / -10 000 | PB04, PB10 |
| CA2 boîte : 20, 500, 10 000 | PB04, PB11 | CA16 moitié espèces moitié OM | PB10, PB11 |
| CA3 prix indépendants | PB06 | CA17 mode par insertion | PB05 |
| CA4 non déconditionnable | PB11 | CA18 comptage requis, commentaire | PB10 |
| CA5 reliquat 14 | PB04, PB11 | CA19 aucune vente sans session, un geste | PB11, PF01, PD02 |
| CA6 seconde ouverture refusée | PB07, PB08 | CA20 jour clôturé, écriture inverse | PB12, PB17 |
| CA7 reliquat avant FEFO | PB04, PB11 | CA21 clôture forcée, remontée | PB17, PB18 |
| CA8 inventaire et tolérance | PB15 | CA22 vendeur sans coût | PB03, PB16 |
| CA9 deux allocations 30 puis 90 j | PB04, PB11 | CA23 deux postes hors ligne | PB18, PD02 |
| CA10 sans date avant daté | PB04, PB11 | CA24 négatif hors ligne | PB18, PD02 |
| CA11 coût par allocation | PB04, PB11, PB16 | CA25 rejeu double | PB18 |
| CA12 non valorisable | PB04, PB16 | CA26 PV non nul partout | PB07, PB09 |
| CA13 périmé jamais automatique | PB04, PB11, PB15 | Migration et retour | PB01, PB03, PB05, PB06, PB07, PB09 |
| CA14 péremption par lot valorisée | PB16 | Non-régression des alertes | PB02, PB08 |

Runs parqués : `2026-10-22-lot8` (back, B14) et `2026-10-22-lot9` (front, F14, F15) restent « à faire » ; le nouvel `ACTIVE.md` de chaque dépôt les note comme parqués (O14), non exécutés.

---

## 6. Points tranchés, compromis de vitesse, critiques

### 6.1 Points tranchés entre deux options

| Sujet | Options | Retenu | Raison |
|---|---|---|---|
| Agrégat de lecture | code applicatif / trigger SQL | trigger dans la transaction du mouvement | aucun chemin ne peut l'oublier ; reconstruction triviale (D403) |
| Négatif | lot négatif / produit négatif | lot jamais négatif (CHECK), négatif sur l'agrégat produit avec mouvement sans lot | garde la formule du reliquat vraie et le FEFO sain (D404) |
| Reliquat | compteur stocké / dérivé du solde | dérivé (`solde mod coefficientReception`), ligne d'état matérialisée seulement pour l'invariant | la demande l'exige (« dérivé des mouvements ») ; une seule source (D405) |
| Coefficient du lot | celui de la fiche / figé à la réception | figé sur le lot | changer la fiche ne doit pas fausser le reliquat des lots en stock (D405) |
| Coût | par boîte / par UM entier | par UM arrondi à l'entier, coût boîte saisi conservé | demande ; erreur d'arrondi de quelques GNF par boîte, négligeable (D413) |
| Annulation | mutation / pièce inverse | pièce inverse, unicité `venteOrigineId` | O5, immuabilité (D419) |
| Statut `ANNULEE` | supprimé / dérivé | dérivé dans les réponses | contrat front conservé sans muter la vente (D419) |
| Session des ventes historiques | colonne nullable / session technique | session et poste techniques de reprise | « une vente sans session n'existe jamais en base » strictement vrai (D421) |
| Ouverture de session | un geste / automatique | automatique à la première vente, bouton explicite disponible | vitesse (D428) |
| Poste web | partagé / par navigateur et utilisateur | par navigateur et utilisateur, enregistré à la volée | le web n'a pas de tiroir physique ; aucun conflit de session (D429) |
| Numéro de ticket | annuel / continu | continu par PV, format `T<ordrePV>-NNNNNNN` | une plage peut chevaucher deux années (D423) |
| Plage épuisée hors ligne | blocage / numéro de secours | numéro de secours préfixé par le poste et anomalie | ne jamais bloquer (D424) |
| Idempotence | 24 h / permanente | permanente, plus de mutation de la clé | immuabilité ; rejeu après longue coupure (D425) |
| Jour d'une vente | horodatage / jour de la session | jour d'ouverture de la session | officines de garde, clôture simple (D435) |
| Postes attendus à la clôture | tout desktop actif / état déclaré | session ouverte connue, ou dernier état « file non vide » ou « session ouverte », ou pas de synchro complète depuis le début du jour alors que le poste a vendu dans les 7 derniers jours | le serveur ne peut pas connaître une session ouverte hors ligne après le dernier contact : la remontée tardive est traitée par régularisation (D435) |
| Prix d'une vente hors ligne | prix serveur / prix du ticket | prix du ticket, anomalie si différent | le client a payé ce prix (D434) |
| Embarquement | export statique / standalone | standalone avec serveur local | export impossible sans refonte (`proxy.ts`, `headers()`, routes dynamiques) (D440) |
| SQLite | `node:sqlite` / `better-sqlite3` | `better-sqlite3` | stable et éprouvé sous Electron (D441) |
| Tolérance d'inventaire | pourcentage / absolue | absolue en UM | une plaquette entamée se perd en comprimés, pas en pourcentage (D411) |
| Catalogue desktop | delta / complet avec ETag | complet avec ETag | volume faible, robustesse (D437) |

### 6.2 Compromis de vitesse (critère numéro un)

1. **Chemin nominal web inchangé en nombre d'écrans** : recherche (1), ajout (2), quantité (3, au clavier), « Valider » (4), confirmation existante qui porte le mode de paiement espèces par défaut (5). Cinq interactions : la cible est atteinte **sans marge**. Retirer la confirmation existante (décision du porteur du 2026-10-22) ferait gagner une interaction ; non fait sans son accord (question Q15).
2. **Unité par défaut** : UNITE si la fiche est déconditionnable avec prix unité, sinon BOITE. Une vente « contre » le défaut coûte une interaction (bascule au clavier). Choisi car à Conakry la vente à l'unité domine.
3. **Session ouverte automatiquement** : zéro geste au lieu d'un ; le comptage d'ouverture se saisit après coup.
4. **Paiement mobile** : référence facultative (O7), aucune attente d'API.
5. **Transaction serveur** : allocation multi lots et verrous consultatifs ajoutent quelques dizaines de millisecondes ; le verrou `CompteurTicket` sérialise les ventes web d'un PV comme aujourd'hui `CompteurVente`. Le desktop ne dépend jamais du serveur pour vendre.
6. **Fermeture en moins d'une minute** : comptage prérempli, Entrée de coupure en coupure ; les relevés mobiles sont facultatifs (sinon « non rapproché »). Si le comptage d'ouverture manque, il est demandé en tête de la fermeture : 10 à 20 secondes de plus ce jour-là.
7. **Sortie manuelle motivée** : seulement quand il ne reste que du périmé ou si le vendeur choisit un lot ; jamais sur le chemin nominal.
8. **Ordonnance** : case existante conservée (règle du porteur) ; une interaction de plus pour un médicament à ordonnance, comme aujourd'hui.

### 6.3 Parties de la demande ou des décisions jugées mauvaises

1. **Electron (O1) est le choix le plus lourd possible pour le hors ligne.** La prémisse « Flutter hors ligne déjà implémenté » est fausse (inventaire). Embarquer Next.js en standalone impose un serveur Node local en plus d'Electron : environ 350 Mo sur un PC de 4 Go, un installateur, une signature de code, des mises à jour. Une PWA (service worker et IndexedDB) aurait réutilisé le web sans installation, au prix d'une impression moins directe et d'un stockage moins sûr. Appliqué (O1), mais PD01 mesure la mémoire et le plan garde le cœur indépendant de l'enveloppe pour permettre un repli.
2. **La comparaison avec la colonne gelée ne prouve que la reprise.** Dès la première vente, le stock calculé diffère légitimement du compteur figé. La commande compare donc le compteur à la somme des mouvements de migration, et l'agrégat au recalcul ; c'est la seconde comparaison qui protège réellement.
3. **La migration à coefficient 1 sans conversion est un piège.** Renseigner ensuite le vrai coefficient changerait 12 boîtes en 12 comprimés. La demande ne le dit pas : ajout de la qualification avec conversion explicite (PB13).
4. **L'invariant « un conditionnement ouvert » n'est pas garantissable hors ligne à plusieurs postes.** Le serveur le garde en base mais ne refuse jamais une vente passée : anomalie `CONDITIONNEMENT_CONCURRENT`, reliquat affiché momentanément faux jusqu'à l'inventaire.
5. **« Écriture inverse » pour une remontée après clôture forcée est un abus de mot.** Une vente arrivée en retard n'inverse rien : c'est une pièce de régularisation rattachée au jour courant qui pointe son origine. Implémentée ainsi, nommée honnêtement.
6. **Les plages de tickets sont superflues** si le numéro est préfixé par le code du poste (unicité sans coordination, sans rechargement, sans épuisement). Appliquées (exigence explicite), avec un numéro de secours préfixé qui prouve que le préfixe suffisait.
7. **Le périmètre front est trop étroit.** Sans écran de clôture ni file d'anomalies, la clôture et le traitement des anomalies sont inutilisables. PF05 et PF06 ajoutent le minimum en réutilisant l'existant ; la réception et l'inventaire passent par l'import Excel existant (pas d'écran dédié en T1).
8. **Le tri FEFO « sans date d'abord » récompense l'absence de saisie.** Avec O4 le stock repris garde sa date ; mais une réception saisie sans date sortira avant un lot qui périme demain. Proposition : date obligatoire à la réception sauf case « sans péremption » (question Q03). En attendant : date facultative avec avertissement.
9. **Le rôle vendeur (O6, « Pharmacien ») a déjà `stock:write`**, donc peut modifier les prix et le stock : la séparation titulaire et vendeur reste incomplète. Hors tranche de corriger sans le porteur (Q08).
10. **Seuil de stock bas à 10 UM (O9)** : 10 comprimés n'est plus « bas » pour une officine qui raisonne en boîtes, et 10 flacons de sirop en ml est absurde. Conservé comme demandé, documenté (Q04).
11. **Prix accepté depuis un poste desktop** : un poste compromis pourrait envoyer des prix arbitraires ; atténué par l'authentification, l'attribution et l'anomalie `PRIX_DIVERGENT`.
12. **« Toute vente non valorisable si une allocation l'est »** perd de l'information sur les ventes mixtes ; appliqué au niveau de la vente comme demandé, le rapport donne aussi le volume de lignes concernées.
13. **Vente bloquée sur périmé seul (O11)** : c'est le seul cas où une vente en ligne peut encore être refusée faute de stock vendable ; c'est voulu (santé), mais contredit la lettre « une vente ne se bloque jamais ».
14. **Le web reste en ligne alors que l'écran est identique au desktop** : un vendeur web sans réseau perd sa vente ; le bandeau le dit, c'est tout ce qu'on peut faire sans PWA.

---

## 7. Questions ouvertes (porteur), avec le défaut appliqué en attendant

| # | Question | Défaut appliqué |
|---|---|---|
| Q01 | Faut-il permettre de saisir un coût estimé pour le stock repris (lots techniques), sachant que la marge restera vide jusqu'aux premières réceptions ? | Non (« jamais de marge sur un coût inventé ») |
| Q02 | Le commentaire d'écart de caisse : par le vendeur qui ferme ou par le titulaire ? | Le vendeur qui ferme ; anomalie `ECART_CAISSE` attribuée au titulaire |
| Q03 | Date de péremption obligatoire à la réception (sauf case « sans péremption ») ? | Facultative avec avertissement |
| Q04 | Seuil de stock bas par fiche et en boîtes plutôt que 10 UM global ? | 10 UM, paramètre de la pharmacie |
| Q05 | Certificat de signature Windows et adresse de téléchargement des mises à jour ? | Non signé (avertissement SmartScreen documenté), URL en variable de build |
| Q06 | Changer de vendeur hors ligne sur un poste desktop (exigerait un mot de passe vérifiable localement) ? | Non : le dernier connecté reste, le changement demande le réseau |
| Q07 | Inventaire et réception accessibles au vendeur ? | Titulaire seulement par défaut, attribuables par rôle personnalisé |
| Q08 | Retirer `stock:write` (prix, quantités) au rôle « Pharmacien » ? | Inchangé |
| Q09 | Officines de garde : la journée métier suit-elle la session (ouverture) plutôt que minuit ? | Oui, jour d'ouverture de la session |
| Q10 | Coupure de 50 000 GNF ou autres valeurs à ajouter ? | Liste O8, ajout par insertion |
| Q11 | L'annulation exige une session ouverte de l'auteur (le remboursement sort de son tiroir) : acceptable pour le titulaire ? | Oui, session ouverte automatiquement |
| Q12 | Chiffrer la base locale du desktop ? | Non en T1 (ventes sans dossier médical, profil Windows) |
| Q13 | Vente hors ligne au prix local quand le prix a changé entre-temps : acceptée avec anomalie ? | Oui |
| Q14 | Format et destinataire de l'export de clôture (comptable externe, colonnes) ? | CSV par pièce et par paiement, sans coût |
| Q15 | Supprimer la confirmation avant validation de la vente (gagne une interaction) ? | Conservée |
| Q16 | Mise à jour forcée du desktop par `/app/version` (plateforme windows) ? | Non en T1 |
| Q17 | Recherche publique des patients : afficher la quantité en unités minimales ou en boîtes ? | Unités vendables, coefficient fourni au client |
