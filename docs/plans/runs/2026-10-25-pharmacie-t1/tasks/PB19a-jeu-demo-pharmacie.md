# PB19a - Seeds, démo et documentation (1/2) : messages d'anomalies, catalogue, jeu démo pharmacie et purge testée

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'anomalies lus par le titulaire et les vendeurs, non-dev ; jeu démo vu par les testeurs du front)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Première des deux sous-fiches de PB19 (D668), après PB18d (validé, commit c563eae). Autonome, gate verte, commitée seule. PB19b (documentation) suit.

1. Ajouter un `message` lisible aux `details` des quatre anomalies qui n'en ont pas (D675), réserve de PB18c.
2. Réduire `prisma/seed_medicaments.ts` au seul catalogue global (D669).
3. Remplacer le stock démo « lot technique » (D504) par un vrai scénario de pharmacie joué par les services de la tranche (D670 à D674) : fiches qualifiées à deux prix, réceptions avec lots, péremptions et coûts réels, un lot sans coût, lots proches de la péremption, inventaire avec écart et lot périmé trouvé, poste desktop enregistré avec plage, deux journées de caisse rejouées par le poste (une clôturée normalement et exportable, une clôturée de force avec une vente remontée en régularisation), ventes web du jour avec plaquette ouverte, vente sans stock, annulation, anomalie traitée.
4. Prouver la purge démo complète sur toutes les tables de la tranche (D676) et la recréation.

Réalité du terrain : un testeur du front (PF01 à PF06) ouvre la Pharmacie de Kaloum en démo et trouve d'emblée une caisse ouverte, une boîte entamée, des alertes de péremption à 7, 30 et 90 jours, une journée clôturée à exporter, une clôture forcée et sa régularisation, une file d'anomalies et une marge avec une vente non valorisable ; la Pharmacie du Niger montre une fiche reprise à qualifier.

**Aucune migration, aucun changement de `prisma/schema.prisma`.** Le mode démo reste inactif par défaut (`DEMO_MODE` absent ou `false` : rien n'est créé, rien n'est joué).

Décisions applicables : D430, D431, D478, D479, D496, D503, D504 (révisée), D522, D523, D604, D609 (révisée), D613 à D618, D649, D652, D657, D659, D667, D668 à D676.

### Contexte vérifié (ne pas re-découvrir)

- `DemoSeeder` (`src/demo/demo.seeder.ts`) : `onApplicationBootstrap` appelle `creerJeuDeDonnees()` (rend `true` s'il a créé) ou `reinitialiserJeuDeDonnees()` (rend le bilan, `null` si mode inactif), puis `rattacherRoles()` ; une transaction unique `inserer(tx, ...)` ; section « 4. Catalogue... » crée les fiches à quantité nulle puis, par fiche non vide, un lot technique et un mouvement `RECEPTION` (D504) ; `purger(tx)` (privée) : audits des comptes démo, comptes, puis `purgerPiecesPharmacies`, `purgerStockPharmacies`, `supprimerConfigurationPharmacies`, structures.
- Les 28 modèles reliés à `Structure` par des clés `Restrict` (calculé depuis `schema.prisma`) : `PointDeVente`, `Poste`, `CompteurTicket`, `PlageTicket`, `ParametresPharmacie`, `Fournisseur`, `Anomalie`, `LotStock`, `MouvementStock`, `AgregatStockLot`, `AgregatStockProduit`, `ConditionnementOuvert`, `SessionCaisse`, `ComptageCaisse`, `LigneComptage`, `ReleveModePaiement`, `MouvementCaisse`, `Paiement`, `ResultatSessionMode`, `ClotureJournaliere`, `TotalClotureMode`, `Reception`, `Inventaire`, `LigneInventaire`, `EvenementSynchro`, `AllocationLot`, `Vente`, `LigneVente`. Les trois fonctions de purge les couvrent toutes, dans un ordre compatible ; aucune table de caisse n'a de clé étrangère vers `User` (les comptes partent en premier sans blocage).
- `ParametresPharmacie.debutCaisse` et `debutFiabiliteMarge` valent `now()` à la création : une journée antérieure n'est clôturable que si `debutCaisse` est reculé.
- Une journée passée ne s'écrit que par le rejeu d'un poste desktop : `SESSION_OUVERTE` prend le jour de `horodatageLocal` (`horodatageBorne` ne borne que le futur) ; la vente web prend toujours le jour courant.
- Services réutilisables tels quels (méthodes publiques des routes, chacune dans sa transaction, contrôle d'accès par appartenance seulement, aucune permission vérifiée dans le service sauf le masquage des coûts) : `ReceptionsService.creerFournisseur` et `.enregistrer` (`recueLe` ISO, jamais futur, lignes `{ stockId, numeroLot, dateExpiration, nombreBoites, coutAchatBoite }`), `InventairesService.enregistrer` (ciblage par `numeroLot`, nouveau lot daté accepté même à date passée), `PointsDeVenteService.enregistrerPoste` et `.attribuerPlage`, `SynchroService.recevoir`, `ClotureService.cloturer`, `VenteService.creerVente` et `.annulerVente`, `AnomaliesService.lister` et `.traiter`, `MouvementsStockService.creerLot` (dans la transaction de l'appelant).
- Construction des services dans un test en base : modèle de `test/db/synchro-remontee.db-spec.ts` (`AccesPharmacieService`, `PermissionsService`, `StorageService` et `NotificationsService` simulés).
- Anomalies sans `message` aujourd'hui : `STOCK_NEGATIF` (`ecriture-vente.ts`, partagé web et rejeu, D657), `FOND_NON_COMPTE` et `ECART_CAISSE` (`sessions-caisse.service.ts`, cœur de fermeture partagé avec le rejeu, D650), `ECART_INVENTAIRE` (`inventaires.service.ts`, seul `anomalie.create` de ce type). Toutes les anomalies de la synchro en ont déjà un. `AnomaliesService` renvoie `details` tel quel.
- `src/pharmacie/etancheite-couts.spec.ts`, test « hors src/pharmacie, aucun fichier ne lit un coût » : attend aujourd'hui `['src/demo/demo.seeder.ts']`.
- `prisma/seed_medicaments.ts` : écrit `StockMedicament.quantite` (refusé par le trigger de gel depuis PB07, D505) dans 5 pharmacies quelconques au hasard ; aucun script npm ne le lance.

### 1. Messages des anomalies (D675)

Clé `message` ajoutée en dernier dans `details` (après toute clé étendue), `jourLisible` de `src/pharmacie/jour-metier.ts`, `formaterGnf` de `src/pharmacie/caisse/bilan-caisse.ts`, écart signé écrit `+N` s'il est positif.

- `STOCK_NEGATIF` (`ecrirePieceVente`), si `resteProvisoire > 0` : « `<nom>` : `<quantiteProvisoire>` unité(s) vendue(s) sans stock disponible (vente `<numero>`, poste `<posteCode>`, `<utilisateurNom>`). Le stock de ce médicament est à `<soldeProduit>` unité(s) : enregistrez la réception ou l'inventaire qui rattachera ces unités à un lot. » ; sinon (rejeu, `anomalieMemeSansProvisoire`) : « `<nom>` : le poste `<posteCode>` a vendu `<quantiteProvisoireLocale>` unité(s) sans stock (vente `<numero>`, `<utilisateurNom>`) ; le serveur a trouvé du stock pour cette vente. Vérifiez le stock de ce médicament sur le poste. » (`quantiteProvisoireLocale` lue dans `detailsAnomalie`, 0 si absente).
- `FOND_NON_COMPTE` : « La caisse de `<utilisateurNom>` (poste `<posteCode>`, journée du `<jourLisible(jourMetier)>`) a été fermée sans comptage du fond d'ouverture : l'écart des espèces ne peut pas être vérifié. »
- `ECART_CAISSE` : « La caisse de `<utilisateurNom>` (poste `<posteCode>`, journée du `<jourLisible(jourMetier)>`) a un écart de `<formaterGnf(ecart) signé>` GNF en espèces (théorique `<formaterGnf(theorique)>` GNF, compté `<formaterGnf(compte)>` GNF), au-delà du seuil de `<formaterGnf(seuilEcartCaisse)>` GNF. »
- `ECART_INVENTAIRE` : « Inventaire de `<nom>` par `<utilisateurNom>` : écart de `<ecart signé>` unité(s), au-delà de la tolérance de `<tolerance>` unité(s). Vérifiez le comptage avant de traiter cette anomalie. »

Aucune autre clé changée, aucun autre type touché.

### 2. `prisma/seed_medicaments.ts` (D669)

Réécrit : catalogue global seulement. Pour chacun des 12 médicaments de `MEDICAMENTS_DEMO` (même nom, générique, catégorie, description, ordonnance, formes ; liste recopiée dans le script, pas d'import de `src/`), `findFirst({ where: { nom } })` puis `create` s'il manque, jamais de mise à jour ni de suppression ; aucune écriture de `StockMedicament`, de lot ou de structure. Journal en français sans émoji : « Catalogue : N médicament(s) ajouté(s), M déjà présent(s). ». Connexion comme aujourd'hui (`DATABASE_URL`, adaptateur `pg`), `process.exitCode = 1` en cas d'erreur, aucune URL affichée. Script npm ajouté : `"seed:medicaments": "ts-node --transpile-only prisma/seed_medicaments.ts"` (seule ligne changée de `package.json`, lock inchangé).

### 3. Phase 1 du jeu démo (`DemoSeeder.inserer`, transaction unique inchangée)

- `demo.donnees.ts`, `StockDemo` : retirer `quantite` et `expirationJours` ; ajouter `uniteMinimale`, `coefficientBoite`, `prixUnite` (`number | null`), `deconditionnable`, `toleranceInventaire`, `qualifie`. `STOCKS_DEMO` devient exactement le tableau de D673 (16 fiches : 10 à Kaloum, 6 au Niger), `notes` de Ventoline conservée (« Livraison attendue la semaine prochaine »), commentaire d'en-tête mis à jour (rupture Ventoline, stock bas Amlor ; Niger : rupture Gaviscon, stock bas Coartem, Spasfon à qualifier). Aucune donnée de coût dans ce fichier.
- Après `assurerPointDeVente` de chaque pharmacie : `tx.parametresPharmacie.update` avec `debutCaisse` et `debutFiabiliteMarge` = minuit UTC du jour `jourConakry(maintenant)` moins 30 jours. (Livré par la fonction `reculerDebutsCaisseDemo` de `src/pharmacie/demo/scenario-demo-pharmacie.service.ts`, appelée par le seeder : le balayage d'étanchéité interdit de nommer `debutFiabiliteMarge` hors `src/pharmacie/`, D681.)
- Fiches : `createMany` avec les champs de D673, `quantite` absente (0), `dateExpiration` nulle (les lots portent la date), `prixUnitaire` = prix de la boîte.
- Supprimer entièrement le bloc « Stock initial (D504) » (lots techniques et mouvements) : `demo.seeder.ts` ne mentionne plus aucun lot, mouvement, allocation ni coût.
- Rien d'autre ne change dans la phase 1 (comptes, carnets, messagerie, SOS, notifications identiques).

### 4. Phase 2 : `ScenarioDemoPharmacieService` (D670, D671, D672)

Nouveaux fichiers sous `src/pharmacie/demo/` : `scenario-demo-pharmacie.service.ts` (classe `@Injectable` `ScenarioDemoPharmacieService`), `scenario-demo-pharmacie.donnees.ts` (constantes du scénario : fournisseurs, réceptions, inventaire, événements du poste, ventes web, textes). `PharmacieModule` le déclare dans `providers` et l'ajoute à `exports` (seul export) ; `DemoModule` importe `PharmacieModule`. Dépendances injectées : `PrismaService`, `ReceptionsService`, `InventairesService`, `PointsDeVenteService`, `SynchroService`, `ClotureService`, `VenteService`, `AnomaliesService`, `MouvementsStockService`.

Signature : `jouer(contexte: ContexteScenarioPharmacie): Promise<BilanScenarioPharmacie>` avec `ContexteScenarioPharmacie = { kaloum: PharmacieDemo; niger: PharmacieDemo }`, `PharmacieDemo = { structureId: string; titulaireId: string; vendeurId: string }`, `BilanScenarioPharmacie = { receptions: number; lotsRepris: number; inventaires: number; evenementsAppliques: number; clotures: number; ventesWeb: number; annulations: number; anomaliesTraitees: number }`. Toute erreur d'un service est relancée ; tout résultat de synchro différent de `APPLIQUE` lève `Error('Scénario pharmacie de démonstration : opération <sequence> <type> non appliquée (<code>).')`. Fiches retrouvées par `stockMedicament.findFirst({ where: { structureId, medicament: { nom } } })`. Identifiants clients (réceptions, poste, plage, sessions, comptages, mouvements, ventes, événements) : `randomUUID()` à chaque exécution. `ip` : `null`.

Conventions de date : `J` = `jourConakry(new Date())` ; `jour(n)` = `J` décalé de `n` jours (`AAAA-MM-JJ`) ; `heure(n, 'HH:MM')` = `` `${jour(n)}T${HH:MM}:00.000Z` `` (Conakry à UTC+0). Dates de péremption = `jour(n)`.

Étapes, dans cet ordre (le bilan attendu est `{ receptions: 3, lotsRepris: 1, inventaires: 1, evenementsAppliques: 16, clotures: 2, ventesWeb: 3, annulations: 1, anomaliesTraitees: 1 }`) :

1. **Fournisseurs** (`creerFournisseur`, par le titulaire) : Kaloum « Comptoir Pharmaceutique de Matam » (`+224 622 10 20 30`) et « Grossiste Médical de Bonfi » (`+224 664 40 50 60`) ; Niger « Dépôt Pharmaceutique de Kankan » (`+224 655 70 80 90`) (D674).
2. **Réceptions** (`enregistrer`, par le titulaire, quantités en boîtes) :
   - R1 Kaloum, Matam, référence `BL-MAT-0412`, `recueLe` = `heure(-20, '10:00')` : Doliprane 30 boîtes lot `DL24A118` péremption `jour(540)` coût 11 500 ; Doliprane 4 boîtes `DL23K052` `jour(25)` 11 000 ; Augmentin 12 `AG24B031` `jour(300)` 68 000 ; Coartem 15 `CT24C207` `jour(420)` 34 000 ; Coartem 3 `CT23H990` `jour(6)` 33 000 ; Amlor 6 `AM24A015` `jour(200)` 27 000 ; Glucophage 12 `GL24D300` `jour(480)` 19 000 ; SRO 150 `SRO2409` `jour(700)` 2 000 ; Flagyl 14 `FG24E118` `jour(80)` 14 500 ; Amoxicilline 15 `AX24F044` `jour(310)` 16 000 ; Ibuprofène 14 `IB24G210` `jour(450)` **sans coût** (`coutAchatBoite` absent).
   - R2 Kaloum, Bonfi, `BL-BON-0087`, `heure(-3, '09:00')` : Doliprane 10 boîtes `DL24A240` `jour(600)` 11 800.
   - R3 Niger, Kankan, `BL-KAN-0153`, `heure(-15, '11:00')` : Doliprane 20 `DL24A131` `jour(500)` 11 600 ; Coartem 2 `CT24C311` `jour(330)` 35 000 ; Amoxicilline 12 `AX24F102` `jour(310)` 16 500 ; Ibuprofène 12 `IB24G305` `jour(450)` 8 000. Aucune réception de Ventoline (Kaloum) ni de Gaviscon (Niger) : ruptures.
3. **Stock repris à qualifier (Niger, Spasfon)** : dans `prisma.$transaction`, `mouvementsStock.creerLot(tx, { stockMedicamentId: <Spasfon>, pointDeVenteId: <PV Niger>, numeroLot: null, dateExpiration: jourVersDate(jour(400)), quantite: 60, coutUnitaire: 0, coutAchatBoite: null, coefficientReception: 1, fournisseurId: null, receptionId: null, lotTechnique: true, auteurId: null, pieceOrigineType: 'RECEPTION', pieceOrigineId: null, motif: 'Stock repris de l\'ancien logiciel (démonstration)' })` : lot technique comme une reprise (D418), jamais de pièce `MIGRATION` (D504).
4. **Poste desktop Kaloum** (par le titulaire) : `enregistrerPoste({ type: 'DESKTOP', appareilId: 'demo-kaloum-comptoir-1', libelle: 'Comptoir principal' })` puis `attribuerPlage(..., posteId, { id: randomUUID() })` ; `debut` de la plage noté `P`. Ticket `Tk` (k de 1 à 9) = numéro `P + k - 1`.
5. **Lot A du poste** : `synchro.recevoir(kaloum, vendeurId, { posteId, etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' }, evenements })`, `utilisateurId` = vendeur (Ousmane Keita), séquences 1 à 14 :

   | Séq. | Type | Horodatage | Corps |
   |---|---|---|---|
   | 1 | SESSION_OUVERTE | `heure(-2,'07:55')` | caisse S2 |
   | 2 | COMPTAGE_SAISI | `heure(-2,'07:58')` | S2, OUVERTURE, fond 200 000 : 20 000 x 5, 10 000 x 6, 5 000 x 4, 2 000 x 5, 1 000 x 10 |
   | 3 | VENTE | `heure(-2,'09:12')` | T1 : Coartem 1 BOITE à 45 000, SRO 2 BOITE à 3 000 ; espèces 51 000 (`montantRecu` 60 000) ; ordonnance vérifiée |
   | 4 | VENTE | `heure(-2,'10:40')` | T2 : Amoxicilline 1 BOITE à 22 000 ; Orange Money 22 000 réf. `OM-7781203` ; ordonnance vérifiée |
   | 5 | VENTE | `heure(-2,'12:05')` | T3 : Flagyl 10 UNITE à 1 200, `ouvertureConditionnement: true` ; MTN MoMo 12 000 réf. `MM-55120934` ; ordonnance vérifiée |
   | 6 | VENTE | `heure(-2,'15:30')` | T4 : Augmentin 1 BOITE à 85 000, Doliprane 2 BOITE à 15 000 ; espèces 50 000 et Orange Money 65 000 réf. `OM-7790544` ; ordonnance vérifiée |
   | 7 | MOUVEMENT_CAISSE | `heure(-2,'16:00')` | S2, PRELEVEMENT 100 000, motif « Versement à la banque » |
   | 8 | VENTE | `heure(-2,'18:10')` | T5 : Ibuprofène 1 BOITE à 12 000 ; espèces 12 000 ; sans ordonnance |
   | 9 | VENTE | `heure(-2,'19:45')` | T6 : Amlor 1 BOITE à 35 000 ; MTN MoMo 35 000 réf. `MM-55127781` ; ordonnance vérifiée |
   | 10 | SESSION_FERMEE | `heure(-2,'21:00')` | S2, `comptageFermeture` : 20 000 x 6, 10 000 x 6, 5 000 x 4, 2 000 x 4, 1 000 x 3 (211 000) ; relevés Orange Money 87 000, MTN MoMo 47 000 |
   | 11 | SESSION_OUVERTE | `heure(-1,'08:02')` | caisse S1 |
   | 12 | COMPTAGE_SAISI | `heure(-1,'08:05')` | S1, OUVERTURE, même fond de 200 000 |
   | 13 | VENTE | `heure(-1,'09:30')` | T7 : Doliprane 6 UNITE à 2 000, `ouvertureConditionnement: true` ; espèces 12 000 ; sans ordonnance |
   | 14 | VENTE | `heure(-1,'11:15')` | T8 : Coartem 1 BOITE à 45 000 ; Orange Money 45 000 réf. `OM-7802216` ; ordonnance vérifiée |

   Ventes sans nom ni téléphone de client. Attendu de S2 : théorique espèces 213 000, compté 211 000, écart -2 000 (sous le seuil, ni commentaire ni `ECART_CAISSE`) ; Orange Money 87 000 ; MTN MoMo 47 000.
6. **Clôtures** (par le titulaire) : `cloturer({ jour: jour(-2) })` (normale) ; puis `cloturer({ jour: jour(-1), forcer: true, motifForcage: 'Le poste du comptoir n\'a plus de réseau depuis midi : ses ventes de l\'après-midi remonteront à son retour.' })` (S1 ouverte, poste desktop manquant).
7. **Lot B du poste** (retour du réseau) : `etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' }`, séquences 15 et 16 :
   - 15 VENTE `heure(-1,'16:20')` : T9 : SRO 4 BOITE à 3 000 ; espèces 12 000 (`montantRecu` 20 000) ; sans ordonnance. Attendu : pièce `REGULARISATION` sur S1, `jourMetier` J, `jourMetierOrigine` J-1, anomalie `REMONTEE_APRES_CLOTURE` raison `JOURNEE_CLOTUREE` au vendeur.
   - 16 SESSION_FERMEE `heure(-1,'21:05')` : S1, `comptageFermeture` 20 000 x 7, 10 000 x 6, 5 000 x 4, 2 000 x 2 (224 000), relevé Orange Money 45 000. Attendu : S1 FERMEE, jamais incluse, anomalie `REMONTEE_APRES_CLOTURE` raison `CAISSE_FERMEE_APRES_CLOTURE` au titulaire.
8. **Inventaire Kaloum** (par le titulaire, commentaire « Inventaire tournant : antidiabétiques et antibiotiques ») : Glucophage lot `GL24D300` compté 11 boîtes et 25 unités (355 au lieu de 360, écart -5 au-delà de la tolérance 3) ; Augmentin nouveau lot `AG23C777` péremption `jour(-12)` compté 2 boîtes (lot périmé trouvé au rayon, coût inconnu, écart +16 au-delà de la tolérance 0). Deux `ECART_INVENTAIRE` attribuées au titulaire.
9. **Ventes web du jour** (`creerVente` par le vendeur, sans `posteId` : poste web par défaut et caisse ouverte automatiquement) : W1 Doliprane 4 `unite: 'UNITE'` (8 000, espèces par défaut) ; W2 Ventoline 1 boîte, paiement Orange Money 60 000 réf. `OM-7815530`, ordonnance vérifiée (aucun stock : allocation provisoire et `STOCK_NEGATIF` au titulaire) ; W3 Amoxicilline 1 boîte (22 000, espèces), ordonnance vérifiée.
10. **Annulation** : `annulerVente(kaloum, W3, titulaireId, { motif: 'Le client avait besoin d\'un autre dosage.' })` (caisse web du titulaire ouverte automatiquement, D428).
11. **Traitement** : `AnomaliesService.lister` (Kaloum, titulaire, type `REMONTEE_APRES_CLOTURE`) puis `traiter` de celle dont `details.raison` vaut `CAISSE_FERMEE_APRES_CLOTURE`, commentaire « Tiroir du comptoir recompté avec Ousmane Keita : 224 000 GNF en espèces, conforme. ». Toutes les autres anomalies restent `OUVERTE`.

État final attendu (unités minimales, agrégat produit) : Kaloum Doliprane 326, Augmentin 104, Coartem 384, Ventoline -1, Amlor 150, Glucophage 355, SRO 144, Flagyl 270, Amoxicilline 168, Ibuprofène 260 ; Niger Doliprane 160, Coartem 48, Amoxicilline 144, Ibuprofène 240, Spasfon 60, Gaviscon 0 (aucune ligne). Lot `DL23K052` solde 6, `CT23H990` solde 24. Conditionnements ouverts : exactement trois (Doliprane `DL23K052`, Flagyl `FG24E118`, et Glucophage `GL24D300` : l'inventaire compte 355 unités, soit 11 boîtes de 30 et une boîte entamée à 25 ; correction du chef, D672). Stock bas : Amlor (Kaloum), Coartem (Niger) ; ruptures : Ventoline, Gaviscon.

### 5. `DemoSeeder` (orchestration)

- Constructeur : dernier paramètre `private readonly scenarioPharmacie: ScenarioDemoPharmacieService`.
- `purger(tx)` devient publique (nom inchangé, D676) ; son contenu et l'ordre de purge ne changent pas, sauf si le test 9 révèle une table manquante : l'ajouter alors dans la fonction de purge qui convient (`purgerPiecesPharmacies`, `purgerStockPharmacies` ou `supprimerConfigurationPharmacies`, fichier autorisé) et le signaler au rapport.
- Nouvelle méthode publique `jouerScenarioPharmacie(): Promise<BilanScenarioPharmacie>` : construit le contexte par email (structure `pharmaKaloum` et `pharmaNiger` de `STRUCTURES_DEMO` ; titulaire = `Structure.adminId` ; vendeur = comptes `pharmaKeita` et `pharmaKourouma` de `COMPTES_DEMO`), `Error` explicite si l'un manque, puis `scenarioPharmacie.jouer(contexte)` (erreurs relancées).
- `onApplicationBootstrap` : comme aujourd'hui jusqu'à `rattacherRoles()` (même `try`, même journal `demo.seed_echoue`), en retenant `cree` (`true` si `creerJeuDeDonnees` a créé, ou si `reinitialiserJeuDeDonnees` a rendu un bilan). Puis, seulement si `cree`, dans un second `try` : `jouerScenarioPharmacie()` ; succès journalisé « Scénario pharmacie de démonstration joué : 3 réceptions, 16 opérations du poste, 2 clôtures, 3 ventes web. » (valeurs du bilan) ; échec : `logger.error({ evenement: 'demo.scenario_pharmacie_echoue', message: 'Scénario pharmacie de démonstration incomplet : relancez avec DEMO_RESET=true.', raison })`, jamais relancé. Données déjà présentes au démarrage : rien n'est joué. Si `rattacherRoles` échoue après une création réussie, le scénario n'est pas joué et, après `demo.seed_echoue`, un avertissement `demo.scenario_pharmacie_saute` le dit (ajout du chef, D682).

### 6. Tests

**`src/pharmacie/etancheite-couts.spec.ts`** : seul changement, l'attendu du test « hors src/pharmacie, aucun fichier ne lit un coût » devient `[]` (D671).

**`src/demo/demo.seeder.spec.ts`** (simulations existantes, scénario simulé `{ jouer: jest.fn().mockResolvedValue(bilan) }`) : retirer les attentes sur `lotStock.createMany` et `mouvementStock.createMany` et sur `quantite` des stocks ; remplacer le test « un lot technique et un mouvement RECEPTION... » par « création : fiches qualifiées à quantité nulle, aucun lot ni mouvement » (champs de D673 présents, `lotStock.createMany` et `mouvementStock.createMany` jamais appelés) ; ajouter, un par un :
1. « création : debutCaisse et debutFiabiliteMarge reculés de 30 jours pour chaque pharmacie » ;
2. « le scénario pharmacie est joué après la création et après rattacherRoles » ;
3. « le scénario pharmacie est joué après une remise à zéro » ;
4. « données déjà présentes : le scénario n'est pas joué » ;
5. « mode inactif : rien n'est créé ni joué » ;
6. « un échec du scénario est journalisé sans empêcher le démarrage » (événement `demo.scenario_pharmacie_echoue`) ;
7. « rôles non rattachés après une création : le saut du scénario est journalisé » (ajout du chef, D682).
Les tests de purge existants restent verts sans changement de leurs attentes.

**`src/pharmacie/demo/scenario-demo-pharmacie.spec.ts`** (nouveau, données seules, importe aussi `src/demo/demo.donnees.ts`), un par un :
1. « chaque vente du poste et du web a un total égal à la somme de ses lignes et de ses paiements » ;
2. « les prix des tickets sont ceux des fiches (boîte ou unité) et l'unité n'est vendue que sur une fiche déconditionnable » ;
3. « les comptages n'utilisent que les coupures du référentiel et valent 200 000, 211 000 et 224 000 GNF » ;
4. « tout médicament du scénario a une fiche dans la pharmacie concernée » ;
5. « toute ligne d'un médicament sur ordonnance a l'ordonnance vérifiée » ;
6. « les réceptions comptent un lot à 7 jours au plus, un à 30, un à 90, et un lot sans coût ; aucune péremption passée » ;
7. « les séquences du poste vont de 1 à 16 sans trou, dans l'ordre des horodatages ».

**Tests en base existants** (une assertion ajoutée dans un test existant, aucun test ajouté) : `test/db/vente.db-spec.ts` (`details.message` de la `STOCK_NEGATIF` déjà vérifiée), `test/db/sessions-caisse.db-spec.ts` (`message` de `FOND_NON_COMPTE` et de `ECART_CAISSE`), `test/db/inventaire.db-spec.ts` (`message` de `ECART_INVENTAIRE`), `test/db/synchro-ventes.db-spec.ts` (`message` d'une `STOCK_NEGATIF` du rejeu sans reste provisoire). Un autre test qui échouerait seulement par la nouvelle clé : ajouter la clé à son attendu, le signaler.

**`test/db/demo.db-spec.ts`** (nouveau, 10 tests, dans l'ordre, une seule base jetable migrée sans jeu « format actuel ») : `DEMO_MODE` mis à `true` dans `beforeAll` et restauré dans `afterAll` ; `DemoSeeder` réel (Prisma de test, `EncryptionService` sur `{ get: (k) => process.env[k] }`, `RolesService` simulé `{ resolveAssignableRoleId: async () => null, seedStructureDefaultRoles: async () => undefined }`, `PermissionsService` simulé avec toutes les permissions de pharmacie et `invalidateUser`), `ScenarioDemoPharmacieService` construit avec les vrais services comme `synchro-remontee.db-spec.ts`.
1. « base vide : le jeu démo se crée et le scénario pharmacie se joue » : `creerJeuDeDonnees()` vrai, `rattacherRoles()`, `jouerScenarioPharmacie()` rend exactement le bilan de la section 4.
2. « stock calculé non nul et cohérent » : `verifierStock(base.client).totalAnomalies` vaut 0 ; agrégats produit égaux à l'état final de la section 4 ; lots `DL23K052` 6 et `CT23H990` 24 ; trois conditionnements ouverts (Doliprane, Flagyl, Glucophage), aucun autre.
3. « journée J-2 clôturée normalement et exportable » : clôture non forcée, aucun poste manquant ; S2 `INCLUSE_DANS_CLOTURE` ; `TotalClotureMode` : espèces théorique 213 000 et compté 211 000, Orange Money 87 000 et 87 000, MTN MoMo 47 000 et 47 000 ; `clotures.exporter(jour(-2))` : 6 lignes de pièce, 7 lignes de paiement, 1 ligne de mouvement de caisse à -100 000, « Oui » dans la colonne « Caisse incluse dans la clôture » pour toutes.
4. « journée J-1 clôturée de force, la vente remontée est régularisée » : `forcee`, `postesManquants[0]` = poste D (code et `sessionId` S1) ; T9 `REGULARISATION`, `jourMetier` J, `jourMetierOrigine` J-1, caisse S1 ; S1 FERMEE, `clotureJournaliereId` nul ; `REMONTEE_APRES_CLOTURE` `JOURNEE_CLOTUREE` au vendeur, `OUVERTE` ; `REMONTEE_APRES_CLOTURE` `CAISSE_FERMEE_APRES_CLOTURE` au titulaire, `TRAITEE` avec le commentaire de l'étape 11.
5. « aujourd'hui : plaquette ouverte, vente sans stock et annulation » : W1 et W3 sur la caisse web du vendeur `OUVERTE` du jour ; W2 `provisoire` avec une `STOCK_NEGATIF` au titulaire dont `details.message` est le texte de la section 1 ; W3 annulée par une pièce `ANNULATION` (`A-<numero>`) sur la caisse web du titulaire, `OUVERTE`.
6. « inventaire, alertes de péremption et marge » : deux `ECART_INVENTAIRE` au titulaire (Glucophage écart -5, Augmentin écart +16) avec `message` ; `RapportsService.alertesPeremption(kaloum, titulaire)` : `CT23H990` à l'horizon 7, `DL23K052` à 30, `FG24E118` à 90, `AG23C777` dans les périmés ; rapport de marge de `jour(-2)` à J : la vente T5 (lot sans coût) comptée non valorisable, W2 comptée à part comme provisoire, chiffre d'affaires valorisé positif (noms de champs lus dans `RapportsService`, `RapportsService` construit comme dans `rapports-pharmacie.db-spec.ts`).
7. « Niger : réception et fiche reprise à qualifier » : Spasfon `qualifie` faux, coefficient 1, un lot technique de 60 au coût 0 ; les cinq autres fiches qualifiées ; aucune pièce de caisse au Niger.
8. « poste desktop : plage et état » : poste D `DESKTOP` actif, code `D1`, libellé « Comptoir principal », une plage de 1 000 numéros, `derniereSequenceAppliquee` 16, `dernierEtat.fileVide` vrai ; 16 `EvenementSynchro` `APPLIQUE`.
9. « purge complète : toutes les tables de la tranche » : l'ensemble des modèles atteints depuis `Structure` par des relations `onDelete: Restrict` (point fixe calculé en lisant `prisma/schema.prisma` : un modèle entre dès qu'il a une relation `Restrict` vers un modèle déjà dans l'ensemble) est exactement la liste des 28 modèles du contexte ; chacun a au moins une ligne ; dans une `prisma.$transaction`, `seeder.purger(tx)` puis, par `tx.$queryRawUnsafe` sur la liste fixe, chaque modèle compte 0 ligne, ainsi que `StockMedicament`, les comptes et structures en `@demo.medconnecte.gn` et les `AuditLog` de ces comptes, et `Medicament` garde son nombre ; puis une erreur sentinelle annule la transaction ; après coup, les comptes sont ceux d'avant (la purge n'a rien laissé).
10. « purge puis recréation » : comptes par modèle de la liste notés avant ; `reinitialiserJeuDeDonnees()` rend `{ comptes: 20, structures: 5 }` ; aucun identifiant de structure démo d'avant ne subsiste ; `jouerScenarioPharmacie()` rend le même bilan ; `verifierStock` sans anomalie ; mêmes comptes par modèle qu'avant ; agrégats produit égaux à l'état final.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Le scénario passe par les méthodes publiques des services (aucune écriture directe en base de pièce, de session, de paiement, de clôture, d'anomalie ou de mouvement, sauf le lot technique de l'étape 3 par `MouvementsStockService.creerLot`). Données fictives seulement, aucune donnée de santé réelle, aucun nom ni téléphone de client. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh` ni au `CLAUDE.md` (PB19b). Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/pharmacie/ecriture-vente.ts`, `src/pharmacie/caisse/sessions-caisse.service.ts`, `src/pharmacie/inventaires/inventaires.service.ts`, `src/pharmacie/demo/scenario-demo-pharmacie.service.ts`, `src/pharmacie/demo/scenario-demo-pharmacie.donnees.ts`, `src/pharmacie/demo/scenario-demo-pharmacie.spec.ts`, `src/pharmacie/pharmacie.module.ts`, `src/pharmacie/etancheite-couts.spec.ts` (attendu du balayage seulement), `src/demo/demo.seeder.ts`, `src/demo/demo.donnees.ts`, `src/demo/demo.module.ts`, `src/demo/demo.seeder.spec.ts`, `prisma/seed_medicaments.ts`, `package.json` (script `seed:medicaments` seulement), `test/db/demo.db-spec.ts`, `test/db/vente.db-spec.ts`, `test/db/sessions-caisse.db-spec.ts`, `test/db/inventaire.db-spec.ts`, `test/db/synchro-ventes.db-spec.ts` (assertions de `message` seulement), et, seulement si le test 9 l'exige, `src/pharmacie/caisse/purge-pieces.ts`, `src/pharmacie/stock/purge-stock.ts`, `src/pharmacie/point-de-vente.ts`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint` sur chaque fichier modifié ou créé : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `demo.seeder.spec`, `scenario-demo-pharmacie.spec`, `etancheite-couts.spec`.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `demo` (10), `vente`, `sessions-caisse`, `inventaire`, `synchro-ventes`, `synchro-remontee` (7), `journee-cloturee` (11), `etancheite-couts`.
5. `git status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma/schema.prisma prisma/migrations test/db/instantanes` vide.
6. `grep -rnE "lotStock|mouvementStock|coutUnitaire|LotStock" src/demo --include=*.ts --exclude=*.spec.ts` : aucune occurrence.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | spécifié (codeur Sonnet, vérificateur Sonnet) | PASS du vérificateur, validé par le chef après corrections | écarts (a) trois conditionnements ouverts (fiche et D672 corrigées) et (b) `reculerDebutsCaisseDemo` dans `src/pharmacie/demo/` (D681) acceptés ; chef : assertion `message` du rejeu en `toBe`, saut de la phase 2 journalisé (D682) et testé

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit ; npx eslint (18 fichiers .ts) ; npm test ; npm run test:db | 0 erreur ; 0 erreur ; 100 suites, 1107 réussis, 3 ignorés ; 35 suites, 409 réussis | commit « feat(pharmacie): jeu démo de la tranche pharmacie, seed et purge (PB19a) » (hash : git log de orch/pharmacie-t1-back, non inscrit ici pour éviter un amend)
