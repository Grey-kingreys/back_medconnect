# PB09 - Tables de caisse et pièces de vente, migrations M5 et M6

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: dev (aucune route nouvelle ; un message d'erreur 409 pour le super administrateur, en français)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Troisième pas du jalon J2 (PB07 à PB13, indissociables, D445). Cette tâche :

1. crée par la migration M5 `20261026130000_pharmacie_t1_caisse` et son retour arrière les tables de caisse, de réception, d'inventaire et de synchronisation (`SessionCaisse`, `ComptageCaisse`, `LigneComptage`, `ReleveModePaiement`, `MouvementCaisse`, `Paiement`, `ResultatSessionMode`, `ClotureJournaliere`, `TotalClotureMode`, `Reception`, `Inventaire`, `LigneInventaire`, `EvenementSynchro`), la clé étrangère `LotStock.receptionId` (D495), leurs CHECK, leurs triggers d'immuabilité et une session technique de reprise par point de vente ;
2. ajoute par la migration M6 `20261026140000_pharmacie_t1_ventes_pieces` et son retour arrière les colonnes de pièce sur `Vente` et `LigneVente`, la table `AllocationLot`, les clés étrangères Restrict (`Vente` vers `Structure`, `LigneVente` vers `Vente`), les triggers d'immuabilité de `Vente`, `LigneVente`, `AllocationLot`, et rattache chaque vente historique au point de vente, au poste `REPRISE` et à la session technique (CA26) ;
3. refuse la suppression d'une structure qui a des pièces (409 `STRUCTURE_AVEC_PIECES`) et adapte la purge démo ;
4. ajoute à `stock:verifier` l'invariant des allocations (D501, D525) ;
5. garde le code compilable : `creerVente` est seulement adapté au nouveau type (D524), son recâblage est PB11.

**Aucune route, aucune lecture ni aucun contrat de réponse n'est modifié.** `presenterVente` choisit ses champs : les instantanés PB02 de `listerVentes` et `detailVente` doivent rester identiques sans toucher à `test/db/non-regression-lectures.db-spec.ts` ni à `test/db/instantanes/` (« ventes historiques lisibles »). Entre PB09 et PB11/PB12, la vente et l'annulation échouent sur une base migrée (déjà vrai depuis M4, D505, D524) : ne rien contourner.

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D419, D421, D422, D427, D430, D431, D432, D445, D448, D454, D456, D457, D458, D462, D466, D478, D479, D480, D484, D495, D496, D501, D503, D505, D514 à D525. CORRECTIONS-PORTEUR.md prime sur tout : le comptage de caisse se fait par coupure seulement, **aucun champ ni aucune ligne « pièces et autres »** (point 1) ; les coupures restent celles de M2 (20 000 à 500 GNF, rien n'est inséré par cette tâche).

### Contexte vérifié (ne pas re-découvrir)

- `prisma/schema.prisma` : conserver ses fins de ligne. Préversion `partialIndexes` active (précédent `ConditionnementOuvert`). Le texte du schéma de la section 1, de M5, de M6 et des deux retours arrière ci-dessous a été **exécuté par le chef** sur des bases jetables (toutes les migrations jusqu'à M4 puis un jeu de trois pharmacies, un hôpital, des ventes validées et annulées, dont une à 23 h 30) : haut, scénario complet sur chaque trigger et chaque CHECK (refus et acceptations), retour de M5 refusé tant que M6 est en place, retour de M6 après activité (annulations reportées), retour de M5 après activité, haut de nouveau, retour de M4 après les deux, haut de M4, M5, M6, arrêts de M5 (point de vente sans poste REPRISE) et de M6 (vente sans point de vente, puis sans session technique), rejeu du bloc de reprise de M5 sans doublon, puis `prisma migrate diff --from-config-datasource --to-schema <schéma de la section 1> --exit-code` : aucune dérive ; après les deux retours arrière, aucune dérive avec le schéma d'avant PB09. `prisma format` et `prisma validate` passent sur le schéma de la section 1.
- Prisma 7 n'applique pas un fichier de migration en transaction (D456) : `BEGIN;`/`COMMIT;` explicites, test statique obligatoire. Aucun `ALTER TYPE ... ADD VALUE` dans ces migrations (D457 sans objet : seuls des `CREATE TYPE`).
- Harnais (`test/db/harnais.ts`) : `creerBaseVide`, `supprimerBaseDeTest`, `appliquerMigrations(client, { apres?, jusqua? })`, `appliquerRetourArriere(client, nom)`, `appliquerSql(client, sql)` (fait `ROLLBACK` après un échec), `creerPrismaDeTest`, `fermerPrismaDeTest`, `masquerUrls`, `DOSSIER_MIGRATIONS`, `DOSSIER_RETOURS_ARRIERE`, `DERNIERE_MIGRATION_FORMAT_ACTUEL`. Modèles de specs à imiter : `test/db/m4-lots-mouvements.db-spec.ts` (fonction `lignesSql`, test statique, extraction du bloc `-- REPRISE:`, écouteur `notice`, sous-`describe` d'arrêts avec sa propre base), `test/db/points-de-vente.db-spec.ts` (Prisma de test, `SuperAdminService`, fonction `refus`), `test/db/commandes-stock.db-spec.ts` (`verifierStock`, purge). Les erreurs `pg` portent `constraint` (nom de la contrainte) et `code` ; les tests vérifient `rejects.toMatchObject({ constraint: '...' })` ou `rejects.toThrow(/.../)`.
- Jeu `chargerFormatActuel` : pharmacies `str-pharma-1` (ventes `vte-p1-1` à `vte-p1-4`, créées à J+8 h, 9 h, 10 h, 11 h ; `vte-p1-3` ANNULEE par `usr-admin-p1`, motif « Erreur de saisie » ; `vte-p1-4` porte la clé `harnais-cle-0001`), `str-pharma-2` (`vte-p2-1` à J-1 15 h, `vte-p2-2` ANNULEE à J-1 16 h, motif « Client parti sans payer »), `str-pharma-3` (aucune vente), hôpital `str-hopital-1` ; 7 lignes de vente (`lv-01`, `lv-02` sur `vte-p1-1`) ; vendeurs `usr-pharm-p1`, `usr-admin-p1`, `usr-pharm-p2`, `usr-admin-p2` (tous avec `structureId` de leur pharmacie) ; `resume.aujourdhui` = minuit UTC du jour (J). M2 a créé par pharmacie un point de vente d'ordre 1 et un poste `REPRISE` (TECHNIQUE, inactif) ; M2 a inséré les modes `ESPECES`, `ORANGE_MONEY`, `MTN_MOMO` et six coupures BILLET 20 000, 10 000, 5 000, 2 000, 1 000, 500. M4 a créé un lot technique par fiche à quantité positive (`stk-03` = 9, `stk-06` = 240 dans `str-pharma-1` ; `stk-26` dans `str-pharma-2`).
- `vente.service.ts` : `enregistrerVente` crée la vente par `tx.vente.create({ data: { structureId, numero, ..., lignes: { create: lignes } }, include: { lignes: true } })` (vers la ligne 335) ; `Prisma` y est importé en type seulement (`import type { Prisma } from 'generated/prisma/client'`). Après M6, `pointDeVenteId`, `posteId`, `sessionCaisseId`, `jourMetier` et `LigneVente.nombreAffiche` sont obligatoires : sans la section 13, `tsc` échoue.
- `src/super-admin/super-admin.controller.ts` a des erreurs ESLint préexistantes (prettier, `any`) : **ne pas le modifier**. `super-admin.service.ts`, `point-de-vente.ts`, `vente.service.ts`, `commandes-stock.ts`, `purge-stock.ts`, `demo.seeder.ts` et leurs specs sont propres à l'ESLint aujourd'hui.
- `supprimerConfigurationPharmacies` (D479) et `purgerStockPharmacies` (D503) existent ; `DemoSeeder.purger` les appelle dans cet ordre avant `structure.deleteMany`. `src/demo/demo.seeder.spec.ts` : doublure Prisma par `Proxy` (tout modèle et toute méthode sont créés à la demande, `deleteMany` résout `{ id: 'id-deleteMany' }`), `$queryRaw` est un `jest.fn`.
- `src/pharmacie/stock/commandes-stock.ts` n'importe que `import type { Client } from 'pg'` (règle D501, conservée) ; `verifierStock` fait ses lectures en `REPEATABLE READ READ ONLY`.
- Mise en forme : si `eslint` signale `prettier/prettier` sur un fichier de cette tâche, lancer `docker compose exec -T backend npx prettier --write <fichier>` (le contenu ne change pas, seulement la mise en forme). Ne jamais lancer Prettier sur `super-admin.controller.ts` ni sur un fichier hors de la liste fermée.

### 1. Schéma Prisma (`prisma/schema.prisma`)

Dix remplacements exacts (chaque texte « avant » est unique dans le fichier).

1.1 Dans `model StockMedicament`, remplacer

```prisma
  conditionnementsOuverts ConditionnementOuvert[]

  @@unique([medicamentId, structureId])
```

par

```prisma
  conditionnementsOuverts ConditionnementOuvert[]

  // Inventaires (PB09, M5)
  lignesInventaire LigneInventaire[]

  @@unique([medicamentId, structureId])
```

1.2 Remplacer les modèles `Vente` et `LigneVente` en entier, commentaire d'en-tête compris (du commentaire `// Vente au comptoir d'une pharmacie (lot 7). Jamais supprimée, seulement annulée.` jusqu'à l'accolade fermante de `model LigneVente`), par :

```prisma
// Nature d'une pièce de vente (PB09, M6) : vente, annulation (O5) ou régularisation après clôture.
enum TypePieceVente {
  VENTE
  ANNULATION
  REGULARISATION
}

// Unité saisie sur une ligne de vente (PB09, M6).
enum UniteVente {
  BOITE
  UNITE
}

// Vente au comptoir d'une pharmacie (lot 7) : pièce comptable immuable depuis M6 (trigger, D431).
// Une annulation est une pièce ANNULATION qui pointe l'origine (O5, D419) ; statut, annuleeLe,
// annuleeParId et motifAnnulation de l'origine sont gelés et dérivés en lecture (PB12).
// vendeurId, annuleeParId et les identifiants des lignes sont sans clé étrangère (D109).
model Vente {
  id                 String         @id @default(uuid())
  structureId        String
  structure          Structure      @relation(fields: [structureId], references: [id], onDelete: Restrict)
  pointDeVenteId     String
  pointDeVente       PointDeVente   @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  posteId            String // ventes historiques : poste technique REPRISE (D421)
  poste              Poste          @relation(fields: [posteId], references: [id], onDelete: Restrict)
  sessionCaisseId    String // ventes historiques : session technique de reprise (D421)
  sessionCaisse      SessionCaisse  @relation(fields: [sessionCaisseId], references: [id], onDelete: Restrict)
  typePiece          TypePieceVente @default(VENTE)
  venteOrigineId     String?        @unique // l'unicité interdit une seconde pièce sur la même origine
  venteOrigine       Vente?         @relation("PieceLiee", fields: [venteOrigineId], references: [id], onDelete: Restrict)
  pieceLiee          Vente?         @relation("PieceLiee")
  numero             String // V-AAAA-NNNNNN (historique), T<ordre>-NNNNNNN, S<ordre>-<poste>-<n>, A-<numero>
  numeroTicket       Int? // numéro pris dans le compteur ou la plage du point de vente
  jourMetier         DateTime       @db.Date // jour de rattachement (Conakry, O10) ; historique : jour de createdAt
  jourMetierOrigine  DateTime?      @db.Date // jour réel si la pièce est rattachée à un autre jour
  horodatageLocal    DateTime?
  sequencePoste      Int?
  vendeurId          String
  vendeurNom         String // copie « Prénom Nom » au moment de la vente
  clientNom          String?
  clientTelephone    String?
  ordonnanceVerifiee Boolean        @default(false)
  total              Int // GNF, entier ; négatif pour une annulation
  statut             StatutVente    @default(VALIDEE) // gelé : plus écrit après M6
  annuleeLe          DateTime? // gelé
  annuleeParId       String? // gelé
  motifAnnulation    String? // gelé sur l'origine ; motif de l'annulation sur une pièce ANNULATION
  cleIdempotence     String? // jamais renvoyée au client
  lignes             LigneVente[]
  paiements          Paiement[]
  createdAt          DateTime       @default(now())

  @@unique([structureId, numero])
  @@unique([structureId, cleIdempotence])
  @@unique([pointDeVenteId, numeroTicket])
  @@index([structureId, createdAt])
  @@index([pointDeVenteId, jourMetier])
  @@index([sessionCaisseId])
}

// Ligne de vente, immuable depuis M6. quantite en UM, toujours égale à nombreAffiche x
// coefficientApplique (CHECK) ; sousTotal = montant de ligne, seule référence des totaux (D409, D470).
model LigneVente {
  id                  String          @id @default(uuid())
  venteId             String
  vente               Vente           @relation(fields: [venteId], references: [id], onDelete: Restrict)
  medicamentId        String
  stockMedicamentId   String
  nomMedicament       String // copie du nom au moment de la vente
  prixUnitaire        Int // prix appliqué par UM, GNF (affichage et contrôle)
  quantite            Int // en UM
  sousTotal           Int // montant de la ligne
  uniteAffichee       UniteVente      @default(BOITE)
  nombreAffiche       Int // nombre de boîtes ou d'UM saisi ; historique = quantite
  coefficientApplique Int             @default(1) // coefficient de la fiche pour BOITE, 1 pour UNITE
  allocations         AllocationLot[]

  @@index([venteId])
}
```

1.3 Dans `model PointDeVente`, remplacer

```prisma
  agregatsProduit         AgregatStockProduit[]
  conditionnementsOuverts ConditionnementOuvert[]

  @@unique([structureId, ordre])
```

par

```prisma
  agregatsProduit         AgregatStockProduit[]
  conditionnementsOuverts ConditionnementOuvert[]

  // Caisse, pièces, réceptions et inventaires (PB09, M5 et M6)
  sessionsCaisse   SessionCaisse[]
  mouvementsCaisse MouvementCaisse[]
  clotures         ClotureJournaliere[]
  receptions       Reception[]
  inventaires      Inventaire[]
  ventes           Vente[]

  @@unique([structureId, ordre])
```

1.4 Dans `model Poste`, remplacer

```prisma
  plagesTicket    PlageTicket[]
  mouvementsStock MouvementStock[]

  @@unique([pointDeVenteId, code])
```

par

```prisma
  plagesTicket    PlageTicket[]
  mouvementsStock MouvementStock[]

  // Caisse et synchronisation (PB09, M5 et M6)
  sessionsCaisse    SessionCaisse[]
  ventes            Vente[]
  evenementsSynchro EvenementSynchro[]

  @@unique([pointDeVenteId, code])
```

1.5 Dans `model ModePaiement`, remplacer

```prisma
  ordre              Int
  actif              Boolean @default(true)
}
```

par

```prisma
  ordre              Int
  actif              Boolean @default(true)

  // Caisse (PB09, M5)
  paiements        Paiement[]
  relevesComptage  ReleveModePaiement[]
  mouvementsCaisse MouvementCaisse[]
  resultatsSession ResultatSessionMode[]
  totauxCloture    TotalClotureMode[]
}
```

1.6 Dans `model Fournisseur`, remplacer

```prisma
  lots LotStock[]

  @@unique([structureId, nom])
```

par

```prisma
  lots       LotStock[]
  receptions Reception[]

  @@unique([structureId, nom])
```

1.7 Dans `model Anomalie`, remplacer

```prisma
  commentaireTraitement String?

  @@index([pointDeVenteId, statut, creeLe])
```

par

```prisma
  commentaireTraitement String?

  lignesInventaire LigneInventaire[]

  @@index([pointDeVenteId, statut, creeLe])
```

1.8 Dans `model LotStock`, remplacer la ligne

```prisma
  receptionId          String? // clé étrangère vers Reception posée par M5 (PB09)
```

par

```prisma
  receptionId          String?
  reception            Reception?      @relation(fields: [receptionId], references: [id], onDelete: Restrict)
```

1.9 Dans `model LotStock`, remplacer

```prisma
  mouvements       MouvementStock[]
  agregat          AgregatStockLot?
  conditionnements ConditionnementOuvert[]
```

par

```prisma
  mouvements       MouvementStock[]
  agregat          AgregatStockLot?
  conditionnements ConditionnementOuvert[]
  lignesInventaire LigneInventaire[]
```

1.10 Juste après l'accolade fermante de `model ConditionnementOuvert` (et avant `// ====== SECURITE ET ACCES ======`), remplacer

```prisma
  @@unique([stockMedicamentId, lotId, pointDeVenteId], where: raw("\"fermeLe\" IS NULL"))
  @@index([lotId])
}
```

par

```prisma
  @@unique([stockMedicamentId, lotId, pointDeVenteId], where: raw("\"fermeLe\" IS NULL"))
  @@index([lotId])
}

// ====== Tranche pharmacie 1 : caisse, réceptions, inventaires et synchronisation (PB09, M5) ======

enum StatutSession {
  OUVERTE
  FERMEE
  INCLUSE_DANS_CLOTURE
}

enum MomentComptage {
  OUVERTURE
  FERMETURE
}

enum TypeMouvementCaisse {
  PRELEVEMENT
  APPORT
  REMBOURSEMENT
}

enum StatutEvenementSynchro {
  APPLIQUE
  EN_ATTENTE
  REJETE
}

// Session de caisse d'un poste : une seule OUVERTE par poste (index partiel). Transitions permises
// par trigger : OUVERTE vers FERMEE, FERMEE vers INCLUSE_DANS_CLOTURE. La session technique de
// reprise (une par point de vente, poste REPRISE, D421) porte les ventes historiques et ne change
// jamais. Le fond de caisse est dérivé du comptage d'ouverture, jamais stocké.
model SessionCaisse {
  id                   String              @id @default(uuid()) // UUID client accepté (D427)
  pointDeVenteId       String
  pointDeVente         PointDeVente        @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  posteId              String
  poste                Poste               @relation(fields: [posteId], references: [id], onDelete: Restrict)
  utilisateurId        String? // sans clé étrangère (D109) ; nul seulement pour la session technique
  utilisateurNom       String // copie « Prénom Nom » à l'ouverture
  statut               StatutSession       @default(OUVERTE)
  technique            Boolean             @default(false)
  jourMetier           DateTime            @db.Date // jour d'ouverture (Conakry), jour de toutes ses ventes (D435)
  jourMetierOrigine    DateTime?           @db.Date
  ouverteLe            DateTime            @default(now())
  ouverteLeLocal       DateTime?
  fermeeLe             DateTime?
  fermeeLeLocal        DateTime?
  evenementOuvertureId String              @unique
  evenementFermetureId String?             @unique
  commentaireEcart     String?
  commentaireParId     String? // sans clé étrangère
  clotureJournaliereId String?
  clotureJournaliere   ClotureJournaliere? @relation(fields: [clotureJournaliereId], references: [id], onDelete: Restrict)

  comptages        ComptageCaisse[]
  mouvementsCaisse MouvementCaisse[]
  paiements        Paiement[]
  resultats        ResultatSessionMode[]
  ventes           Vente[]

  @@unique([posteId], map: "SessionCaisse_posteId_ouverte_key", where: raw("\"statut\" = 'OUVERTE'"))
  @@index([pointDeVenteId, jourMetier])
  @@index([clotureJournaliereId])
}

// Comptage des espèces à l'ouverture ou à la fermeture d'une session, immuable. Par coupure
// seulement (LigneComptage), aucun champ « pièces et autres » (CORRECTIONS-PORTEUR.md, point 1).
model ComptageCaisse {
  id              String         @id @default(uuid()) // UUID client accepté (D427)
  sessionCaisseId String
  sessionCaisse   SessionCaisse  @relation(fields: [sessionCaisseId], references: [id], onDelete: Restrict)
  moment          MomentComptage
  totalEspeces    Int // somme des lignes (valeurFaciale x nombre), calculée et vérifiée par le service
  auteurId        String // sans clé étrangère (D109)
  evenementId     String         @unique
  horodatageLocal DateTime?
  createdAt       DateTime       @default(now())

  lignes  LigneComptage[]
  releves ReleveModePaiement[]

  @@unique([sessionCaisseId, moment])
}

// Ligne d'un comptage : nombre de billets d'une coupure (copie de la valeur faciale), immuable.
model LigneComptage {
  id            String         @id @default(uuid())
  comptageId    String
  comptage      ComptageCaisse @relation(fields: [comptageId], references: [id], onDelete: Restrict)
  valeurFaciale Int
  nombre        Int

  @@unique([comptageId, valeurFaciale])
}

// Total d'un mode de paiement mobile relevé sur le compte marchand à la fermeture, immuable.
model ReleveModePaiement {
  id             String         @id @default(uuid())
  comptageId     String
  comptage       ComptageCaisse @relation(fields: [comptageId], references: [id], onDelete: Restrict)
  modePaiementId String
  modePaiement   ModePaiement   @relation(fields: [modePaiementId], references: [id], onDelete: Restrict)
  montantDeclare Int

  @@unique([comptageId, modePaiementId])
}

// Prélèvement, apport ou remboursement dans une session, motivé et attribué, immuable.
model MouvementCaisse {
  id                String              @id @default(uuid()) // UUID client accepté (D427)
  sessionCaisseId   String
  sessionCaisse     SessionCaisse       @relation(fields: [sessionCaisseId], references: [id], onDelete: Restrict)
  pointDeVenteId    String
  pointDeVente      PointDeVente        @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  type              TypeMouvementCaisse
  modePaiementId    String
  modePaiement      ModePaiement        @relation(fields: [modePaiementId], references: [id], onDelete: Restrict)
  montant           Int // GNF, strictement positif
  motif             String
  auteurId          String // sans clé étrangère (D109)
  horodatageServeur DateTime            @default(now())
  horodatageLocal   DateTime?
  evenementId       String              @unique

  @@index([sessionCaisseId])
}

// Paiement d'une pièce de vente, immuable ; montant signé (négatif pour une annulation).
// Invariant tenu par le service : somme des paiements d'une vente = Vente.total.
model Paiement {
  id               String        @id @default(uuid())
  venteId          String
  vente            Vente         @relation(fields: [venteId], references: [id], onDelete: Restrict)
  sessionCaisseId  String
  sessionCaisse    SessionCaisse @relation(fields: [sessionCaisseId], references: [id], onDelete: Restrict)
  modePaiementId   String
  modePaiement     ModePaiement  @relation(fields: [modePaiementId], references: [id], onDelete: Restrict)
  montant          Int
  referenceExterne String?
  montantRecu      Int? // espèces remises par le client, pour le rendu du ticket
  createdAt        DateTime      @default(now())

  @@index([venteId])
  @@index([sessionCaisseId, modePaiementId])
}

// Photographie du théorique, du compté et de l'écart d'un mode à la fermeture d'une session, immuable.
model ResultatSessionMode {
  id              String        @id @default(uuid())
  sessionCaisseId String
  sessionCaisse   SessionCaisse @relation(fields: [sessionCaisseId], references: [id], onDelete: Restrict)
  modePaiementId  String
  modePaiement    ModePaiement  @relation(fields: [modePaiementId], references: [id], onDelete: Restrict)
  theorique       Int
  compte          Int? // nul : non rapproché
  ecart           Int? // compte - theorique, signé, jamais corrigé
  createdAt       DateTime      @default(now())

  @@unique([sessionCaisseId, modePaiementId])
}

// Clôture d'une journée métier d'un point de vente : son existence est le verrou, immuable.
model ClotureJournaliere {
  id              String       @id @default(uuid())
  pointDeVenteId  String
  pointDeVente    PointDeVente @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  jourMetier      DateTime     @db.Date
  clotureParId    String // sans clé étrangère (D109)
  clotureeLe      DateTime     @default(now())
  forcee          Boolean      @default(false)
  motifForcage    String?
  postesManquants Json         @default("[]") // [{ posteId, code, libelle }]

  sessions SessionCaisse[]
  totaux   TotalClotureMode[]

  @@unique([pointDeVenteId, jourMetier])
}

// Totaux par mode d'une clôture, immuables.
model TotalClotureMode {
  id             String             @id @default(uuid())
  clotureId      String
  cloture        ClotureJournaliere @relation(fields: [clotureId], references: [id], onDelete: Restrict)
  modePaiementId String
  modePaiement   ModePaiement       @relation(fields: [modePaiementId], references: [id], onDelete: Restrict)
  theorique      Int
  compte         Int?
  ecart          Int?

  @@unique([clotureId, modePaiementId])
}

// Réception d'une livraison, immuable ; ses lignes sont les lots créés (LotStock.receptionId).
model Reception {
  id             String       @id @default(uuid())
  pointDeVenteId String
  pointDeVente   PointDeVente @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  fournisseurId  String?
  fournisseur    Fournisseur? @relation(fields: [fournisseurId], references: [id], onDelete: Restrict)
  reference      String? // bon de livraison
  recueLe        DateTime
  auteurId       String // sans clé étrangère (D109)
  createdAt      DateTime     @default(now())

  lots LotStock[]

  @@index([pointDeVenteId, recueLe])
}

// Inventaire d'un point de vente, immuable avec ses lignes.
model Inventaire {
  id             String       @id @default(uuid())
  pointDeVenteId String
  pointDeVente   PointDeVente @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  auteurId       String // sans clé étrangère (D109)
  commentaire    String?
  createdAt      DateTime     @default(now())

  lignes LigneInventaire[]

  @@index([pointDeVenteId, createdAt])
}

// Ligne d'inventaire par lot, immuable ; ecart = quantiteComptee - quantiteTheorique (CHECK).
model LigneInventaire {
  id                String          @id @default(uuid())
  inventaireId      String
  inventaire        Inventaire      @relation(fields: [inventaireId], references: [id], onDelete: Restrict)
  stockMedicamentId String
  stockMedicament   StockMedicament @relation(fields: [stockMedicamentId], references: [id], onDelete: Restrict)
  lotId             String? // nul seulement pour une fiche sans lot (PB15)
  lot               LotStock?       @relation(fields: [lotId], references: [id], onDelete: Restrict)
  quantiteTheorique Int
  quantiteComptee   Int
  ecart             Int
  sousTolerance     Boolean
  anomalieId        String?
  anomalie          Anomalie?       @relation(fields: [anomalieId], references: [id], onDelete: Restrict)

  @@index([inventaireId])
  @@index([lotId])
}

// Événement de synchronisation reçu d'un poste desktop. Seule transition permise (trigger) :
// EN_ATTENTE vers APPLIQUE ou REJETE (avec son résultat).
model EvenementSynchro {
  id              String                 @id @default(uuid())
  evenementId     String                 @unique // UUID client
  posteId         String
  poste           Poste                  @relation(fields: [posteId], references: [id], onDelete: Restrict)
  sequence        Int
  type            String
  utilisateurId   String? // nul seulement pour un événement illisible (PB18)
  horodatageLocal DateTime?
  recuLe          DateTime               @default(now())
  statut          StatutEvenementSynchro
  empreinte       String // sha256 du corps canonique
  corps           Json
  resultat        Json?

  @@unique([posteId, sequence])
  @@index([posteId, statut])
}

// ====== Tranche pharmacie 1 : allocations de lots des lignes de vente (PB09, M6) ======

enum StatutAllocation {
  DEFINITIVE
  PROVISOIRE
  REMPLACEE
}

// Allocation d'une ligne de vente à un lot (copie du lot, sans clé étrangère). Seule mise à jour
// permise (trigger) : PROVISOIRE vers REMPLACEE. Lot présent si et seulement si DEFINITIVE.
model AllocationLot {
  id                  String           @id @default(uuid())
  ligneVenteId        String
  ligneVente          LigneVente       @relation(fields: [ligneVenteId], references: [id], onDelete: Restrict)
  lotId               String? // copie sans clé étrangère ; nul pour une allocation provisoire
  numeroLot           String?
  dateExpiration      DateTime?        @db.Date
  quantite            Int // UM, signée (négative pour une annulation)
  coutUnitaire        Int // copie du coût du lot à la sortie, GNF par UM
  lotTechnique        Boolean          @default(false)
  statut              StatutAllocation
  remplaceeParPieceId String?
  sortieManuelle      Boolean          @default(false)
  motif               String?
  auteurId            String? // nul = système, sans clé étrangère (D109)
  createdAt           DateTime         @default(now())

  @@index([ligneVenteId])
  @@index([lotId])
}
```

Puis `docker compose exec -T backend npx prisma generate` et `docker compose exec -T backend npx prisma validate`.

### 2. Migration M5 : `prisma/migrations/20261026130000_pharmacie_t1_caisse/migration.sql` (nouveau)

Texte imposé, à recopier à l'identique :

```sql
-- Tranche pharmacie 1, caisse, réceptions, inventaires et synchronisation (PB09, M5, D421, D431, D514 à D521).
-- DDL généré par prisma migrate diff (schéma de PB08 vers schéma de PB09, partie M5) ; contrôles,
-- CHECK, fonctions, triggers et reprise écrits à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
BEGIN;

-- Arrêt (plan, section 2) : chaque point de vente a son poste technique REPRISE (M2, D484).
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "PointDeVente" pv
  WHERE NOT EXISTS (
    SELECT 1 FROM "Poste" p WHERE p."pointDeVenteId" = pv."id" AND p."code" = 'REPRISE' AND p."type" = 'TECHNIQUE'
  );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT pv."id"
      FROM "PointDeVente" pv
      WHERE NOT EXISTS (
        SELECT 1 FROM "Poste" p WHERE p."pointDeVenteId" = pv."id" AND p."code" = 'REPRISE' AND p."type" = 'TECHNIQUE'
      )
      ORDER BY pv."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M5 arrêtée : % point(s) de vente sans poste technique REPRISE. Points de vente en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "StatutSession" AS ENUM ('OUVERTE', 'FERMEE', 'INCLUSE_DANS_CLOTURE');

-- CreateEnum
CREATE TYPE "MomentComptage" AS ENUM ('OUVERTURE', 'FERMETURE');

-- CreateEnum
CREATE TYPE "TypeMouvementCaisse" AS ENUM ('PRELEVEMENT', 'APPORT', 'REMBOURSEMENT');

-- CreateEnum
CREATE TYPE "StatutEvenementSynchro" AS ENUM ('APPLIQUE', 'EN_ATTENTE', 'REJETE');

-- CreateTable
CREATE TABLE "SessionCaisse" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "posteId" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "utilisateurNom" TEXT NOT NULL,
    "statut" "StatutSession" NOT NULL DEFAULT 'OUVERTE',
    "technique" BOOLEAN NOT NULL DEFAULT false,
    "jourMetier" DATE NOT NULL,
    "jourMetierOrigine" DATE,
    "ouverteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ouverteLeLocal" TIMESTAMP(3),
    "fermeeLe" TIMESTAMP(3),
    "fermeeLeLocal" TIMESTAMP(3),
    "evenementOuvertureId" TEXT NOT NULL,
    "evenementFermetureId" TEXT,
    "commentaireEcart" TEXT,
    "commentaireParId" TEXT,
    "clotureJournaliereId" TEXT,

    CONSTRAINT "SessionCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComptageCaisse" (
    "id" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "moment" "MomentComptage" NOT NULL,
    "totalEspeces" INTEGER NOT NULL,
    "auteurId" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "horodatageLocal" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComptageCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneComptage" (
    "id" TEXT NOT NULL,
    "comptageId" TEXT NOT NULL,
    "valeurFaciale" INTEGER NOT NULL,
    "nombre" INTEGER NOT NULL,

    CONSTRAINT "LigneComptage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleveModePaiement" (
    "id" TEXT NOT NULL,
    "comptageId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "montantDeclare" INTEGER NOT NULL,

    CONSTRAINT "ReleveModePaiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementCaisse" (
    "id" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "type" "TypeMouvementCaisse" NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "motif" TEXT NOT NULL,
    "auteurId" TEXT NOT NULL,
    "horodatageServeur" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horodatageLocal" TIMESTAMP(3),
    "evenementId" TEXT NOT NULL,

    CONSTRAINT "MouvementCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paiement" (
    "id" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "referenceExterne" TEXT,
    "montantRecu" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultatSessionMode" (
    "id" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "theorique" INTEGER NOT NULL,
    "compte" INTEGER,
    "ecart" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultatSessionMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClotureJournaliere" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "jourMetier" DATE NOT NULL,
    "clotureParId" TEXT NOT NULL,
    "clotureeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forcee" BOOLEAN NOT NULL DEFAULT false,
    "motifForcage" TEXT,
    "postesManquants" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ClotureJournaliere_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotalClotureMode" (
    "id" TEXT NOT NULL,
    "clotureId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "theorique" INTEGER NOT NULL,
    "compte" INTEGER,
    "ecart" INTEGER,

    CONSTRAINT "TotalClotureMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reception" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "reference" TEXT,
    "recueLe" TIMESTAMP(3) NOT NULL,
    "auteurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventaire" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "auteurId" TEXT NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneInventaire" (
    "id" TEXT NOT NULL,
    "inventaireId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantiteTheorique" INTEGER NOT NULL,
    "quantiteComptee" INTEGER NOT NULL,
    "ecart" INTEGER NOT NULL,
    "sousTolerance" BOOLEAN NOT NULL,
    "anomalieId" TEXT,

    CONSTRAINT "LigneInventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvenementSynchro" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "posteId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "horodatageLocal" TIMESTAMP(3),
    "recuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" "StatutEvenementSynchro" NOT NULL,
    "empreinte" TEXT NOT NULL,
    "corps" JSONB NOT NULL,
    "resultat" JSONB,

    CONSTRAINT "EvenementSynchro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_evenementOuvertureId_key" ON "SessionCaisse"("evenementOuvertureId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_evenementFermetureId_key" ON "SessionCaisse"("evenementFermetureId");

-- CreateIndex
CREATE INDEX "SessionCaisse_pointDeVenteId_jourMetier_idx" ON "SessionCaisse"("pointDeVenteId", "jourMetier");

-- CreateIndex
CREATE INDEX "SessionCaisse_clotureJournaliereId_idx" ON "SessionCaisse"("clotureJournaliereId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_posteId_ouverte_key" ON "SessionCaisse"("posteId") WHERE ("statut" = 'OUVERTE');

-- CreateIndex
CREATE UNIQUE INDEX "ComptageCaisse_evenementId_key" ON "ComptageCaisse"("evenementId");

-- CreateIndex
CREATE UNIQUE INDEX "ComptageCaisse_sessionCaisseId_moment_key" ON "ComptageCaisse"("sessionCaisseId", "moment");

-- CreateIndex
CREATE UNIQUE INDEX "LigneComptage_comptageId_valeurFaciale_key" ON "LigneComptage"("comptageId", "valeurFaciale");

-- CreateIndex
CREATE UNIQUE INDEX "ReleveModePaiement_comptageId_modePaiementId_key" ON "ReleveModePaiement"("comptageId", "modePaiementId");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementCaisse_evenementId_key" ON "MouvementCaisse"("evenementId");

-- CreateIndex
CREATE INDEX "MouvementCaisse_sessionCaisseId_idx" ON "MouvementCaisse"("sessionCaisseId");

-- CreateIndex
CREATE INDEX "Paiement_venteId_idx" ON "Paiement"("venteId");

-- CreateIndex
CREATE INDEX "Paiement_sessionCaisseId_modePaiementId_idx" ON "Paiement"("sessionCaisseId", "modePaiementId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultatSessionMode_sessionCaisseId_modePaiementId_key" ON "ResultatSessionMode"("sessionCaisseId", "modePaiementId");

-- CreateIndex
CREATE UNIQUE INDEX "ClotureJournaliere_pointDeVenteId_jourMetier_key" ON "ClotureJournaliere"("pointDeVenteId", "jourMetier");

-- CreateIndex
CREATE UNIQUE INDEX "TotalClotureMode_clotureId_modePaiementId_key" ON "TotalClotureMode"("clotureId", "modePaiementId");

-- CreateIndex
CREATE INDEX "Reception_pointDeVenteId_recueLe_idx" ON "Reception"("pointDeVenteId", "recueLe");

-- CreateIndex
CREATE INDEX "Inventaire_pointDeVenteId_createdAt_idx" ON "Inventaire"("pointDeVenteId", "createdAt");

-- CreateIndex
CREATE INDEX "LigneInventaire_inventaireId_idx" ON "LigneInventaire"("inventaireId");

-- CreateIndex
CREATE INDEX "LigneInventaire_lotId_idx" ON "LigneInventaire"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "EvenementSynchro_evenementId_key" ON "EvenementSynchro"("evenementId");

-- CreateIndex
CREATE INDEX "EvenementSynchro_posteId_statut_idx" ON "EvenementSynchro"("posteId", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "EvenementSynchro_posteId_sequence_key" ON "EvenementSynchro"("posteId", "sequence");

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_receptionId_fkey" FOREIGN KEY ("receptionId") REFERENCES "Reception"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_clotureJournaliereId_fkey" FOREIGN KEY ("clotureJournaliereId") REFERENCES "ClotureJournaliere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComptageCaisse" ADD CONSTRAINT "ComptageCaisse_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneComptage" ADD CONSTRAINT "LigneComptage_comptageId_fkey" FOREIGN KEY ("comptageId") REFERENCES "ComptageCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleveModePaiement" ADD CONSTRAINT "ReleveModePaiement_comptageId_fkey" FOREIGN KEY ("comptageId") REFERENCES "ComptageCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleveModePaiement" ADD CONSTRAINT "ReleveModePaiement_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatSessionMode" ADD CONSTRAINT "ResultatSessionMode_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatSessionMode" ADD CONSTRAINT "ResultatSessionMode_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClotureJournaliere" ADD CONSTRAINT "ClotureJournaliere_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotalClotureMode" ADD CONSTRAINT "TotalClotureMode_clotureId_fkey" FOREIGN KEY ("clotureId") REFERENCES "ClotureJournaliere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotalClotureMode" ADD CONSTRAINT "TotalClotureMode_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_inventaireId_fkey" FOREIGN KEY ("inventaireId") REFERENCES "Inventaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_anomalieId_fkey" FOREIGN KEY ("anomalieId") REFERENCES "Anomalie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementSynchro" ADD CONSTRAINT "EvenementSynchro_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes (plan 1.5 et 1.6, D516)
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_utilisateur_check" CHECK ("technique" OR "utilisateurId" IS NOT NULL);
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_fermeture_check" CHECK (("statut" = 'OUVERTE') = ("fermeeLe" IS NULL));
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_cloture_check" CHECK (("statut" = 'INCLUSE_DANS_CLOTURE') = ("clotureJournaliereId" IS NOT NULL));
ALTER TABLE "ComptageCaisse" ADD CONSTRAINT "ComptageCaisse_totalEspeces_check" CHECK ("totalEspeces" >= 0);
ALTER TABLE "LigneComptage" ADD CONSTRAINT "LigneComptage_valeurFaciale_check" CHECK ("valeurFaciale" > 0);
ALTER TABLE "LigneComptage" ADD CONSTRAINT "LigneComptage_nombre_check" CHECK ("nombre" >= 0);
ALTER TABLE "ReleveModePaiement" ADD CONSTRAINT "ReleveModePaiement_montantDeclare_check" CHECK ("montantDeclare" >= 0);
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_montant_check" CHECK ("montant" > 0);
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_motif_check" CHECK (btrim("motif") <> '');
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_montant_check" CHECK ("montant" <> 0);
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_montantRecu_check" CHECK ("montantRecu" IS NULL OR "montantRecu" >= 0);
ALTER TABLE "ResultatSessionMode" ADD CONSTRAINT "ResultatSessionMode_ecart_check" CHECK (("compte" IS NULL AND "ecart" IS NULL) OR ("compte" IS NOT NULL AND "ecart" IS NOT NULL AND "ecart" = "compte" - "theorique"));
ALTER TABLE "ClotureJournaliere" ADD CONSTRAINT "ClotureJournaliere_forcage_check" CHECK (NOT "forcee" OR ("motifForcage" IS NOT NULL AND btrim("motifForcage") <> ''));
ALTER TABLE "TotalClotureMode" ADD CONSTRAINT "TotalClotureMode_ecart_check" CHECK (("compte" IS NULL AND "ecart" IS NULL) OR ("compte" IS NOT NULL AND "ecart" IS NOT NULL AND "ecart" = "compte" - "theorique"));
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_quantiteComptee_check" CHECK ("quantiteComptee" >= 0);
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_ecart_check" CHECK ("ecart" = "quantiteComptee" - "quantiteTheorique");
ALTER TABLE "EvenementSynchro" ADD CONSTRAINT "EvenementSynchro_sequence_check" CHECK ("sequence" >= 1);

-- Pièces immuables (D431, D496) : ni modification, ni suppression, ni troncature, sauf suppression
-- et troncature sous le contournement de purge. Fonction journal_refuser_modification de M4.
CREATE TRIGGER "comptage_caisse_immuable" BEFORE UPDATE OR DELETE ON "ComptageCaisse" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "comptage_caisse_sans_troncature" BEFORE TRUNCATE ON "ComptageCaisse" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_comptage_immuable" BEFORE UPDATE OR DELETE ON "LigneComptage" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_comptage_sans_troncature" BEFORE TRUNCATE ON "LigneComptage" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "releve_mode_paiement_immuable" BEFORE UPDATE OR DELETE ON "ReleveModePaiement" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "releve_mode_paiement_sans_troncature" BEFORE TRUNCATE ON "ReleveModePaiement" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "mouvement_caisse_immuable" BEFORE UPDATE OR DELETE ON "MouvementCaisse" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "mouvement_caisse_sans_troncature" BEFORE TRUNCATE ON "MouvementCaisse" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "paiement_immuable" BEFORE UPDATE OR DELETE ON "Paiement" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "paiement_sans_troncature" BEFORE TRUNCATE ON "Paiement" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "resultat_session_mode_immuable" BEFORE UPDATE OR DELETE ON "ResultatSessionMode" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "resultat_session_mode_sans_troncature" BEFORE TRUNCATE ON "ResultatSessionMode" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "cloture_journaliere_immuable" BEFORE UPDATE OR DELETE ON "ClotureJournaliere" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "cloture_journaliere_sans_troncature" BEFORE TRUNCATE ON "ClotureJournaliere" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "total_cloture_mode_immuable" BEFORE UPDATE OR DELETE ON "TotalClotureMode" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "total_cloture_mode_sans_troncature" BEFORE TRUNCATE ON "TotalClotureMode" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "reception_immuable" BEFORE UPDATE OR DELETE ON "Reception" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "reception_sans_troncature" BEFORE TRUNCATE ON "Reception" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "inventaire_immuable" BEFORE UPDATE OR DELETE ON "Inventaire" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "inventaire_sans_troncature" BEFORE TRUNCATE ON "Inventaire" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_inventaire_immuable" BEFORE UPDATE OR DELETE ON "LigneInventaire" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_inventaire_sans_troncature" BEFORE TRUNCATE ON "LigneInventaire" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Session de caisse (D431, D515) : poste du même point de vente, technique si et seulement si le poste
-- l'est ; transitions OUVERTE vers FERMEE et FERMEE vers INCLUSE_DANS_CLOTURE seulement ; session
-- technique jamais modifiée ; suppression d'une session technique permise (suppression d'une pharmacie
-- sans pièce, les ventes historiques la protègent par leur clé étrangère), des autres sous contournement.
CREATE FUNCTION "session_caisse_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."technique" OR current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'La session de caisse % ne peut pas être supprimée : une session est conservée définitivement.', OLD."id";
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM "Poste" p
    WHERE p."id" = NEW."posteId"
      AND p."pointDeVenteId" = NEW."pointDeVenteId"
      AND (p."type" = 'TECHNIQUE') = NEW."technique";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session refusée : le poste % n''appartient pas au point de vente %, ou son type ne correspond pas (une session technique va sur le poste technique, et seulement elle).', NEW."posteId", NEW."pointDeVenteId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  IF OLD."technique" THEN
    RAISE EXCEPTION 'La session technique % ne se modifie pas.', OLD."id";
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."pointDeVenteId" IS DISTINCT FROM OLD."pointDeVenteId"
    OR NEW."posteId" IS DISTINCT FROM OLD."posteId"
    OR NEW."utilisateurId" IS DISTINCT FROM OLD."utilisateurId"
    OR NEW."utilisateurNom" IS DISTINCT FROM OLD."utilisateurNom"
    OR NEW."technique" IS DISTINCT FROM OLD."technique"
    OR NEW."jourMetier" IS DISTINCT FROM OLD."jourMetier"
    OR NEW."jourMetierOrigine" IS DISTINCT FROM OLD."jourMetierOrigine"
    OR NEW."ouverteLe" IS DISTINCT FROM OLD."ouverteLe"
    OR NEW."ouverteLeLocal" IS DISTINCT FROM OLD."ouverteLeLocal"
    OR NEW."evenementOuvertureId" IS DISTINCT FROM OLD."evenementOuvertureId" THEN
    RAISE EXCEPTION 'La session de caisse % ne peut pas être modifiée : seules sa fermeture et son inclusion dans une clôture s''enregistrent.', OLD."id";
  END IF;
  IF OLD."statut" = 'OUVERTE' AND NEW."statut" = 'FERMEE' THEN
    RETURN NEW;
  END IF;
  IF OLD."statut" = 'FERMEE' AND NEW."statut" = 'INCLUSE_DANS_CLOTURE'
    AND NEW."fermeeLe" IS NOT DISTINCT FROM OLD."fermeeLe"
    AND NEW."fermeeLeLocal" IS NOT DISTINCT FROM OLD."fermeeLeLocal"
    AND NEW."evenementFermetureId" IS NOT DISTINCT FROM OLD."evenementFermetureId"
    AND NEW."commentaireEcart" IS NOT DISTINCT FROM OLD."commentaireEcart"
    AND NEW."commentaireParId" IS NOT DISTINCT FROM OLD."commentaireParId" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Session de caisse % : modification refusée (statut % vers %). Seules les transitions OUVERTE vers FERMEE et FERMEE vers INCLUSE_DANS_CLOTURE sont permises.', OLD."id", OLD."statut", NEW."statut";
END
$$;

CREATE TRIGGER "session_caisse_proteger"
BEFORE INSERT OR UPDATE OR DELETE ON "SessionCaisse"
FOR EACH ROW EXECUTE FUNCTION "session_caisse_proteger"();

CREATE TRIGGER "session_caisse_sans_troncature"
BEFORE TRUNCATE ON "SessionCaisse"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Événement de synchronisation (D431) : seule la sortie de EN_ATTENTE vers APPLIQUE ou REJETE,
-- avec son résultat ; suppression sous contournement seulement.
CREATE FUNCTION "evenement_synchro_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'L''événement de synchronisation % ne peut pas être supprimé.', OLD."evenementId";
  END IF;
  IF OLD."statut" = 'EN_ATTENTE'
    AND NEW."statut" IN ('APPLIQUE', 'REJETE')
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."evenementId" IS NOT DISTINCT FROM OLD."evenementId"
    AND NEW."posteId" IS NOT DISTINCT FROM OLD."posteId"
    AND NEW."sequence" IS NOT DISTINCT FROM OLD."sequence"
    AND NEW."type" IS NOT DISTINCT FROM OLD."type"
    AND NEW."utilisateurId" IS NOT DISTINCT FROM OLD."utilisateurId"
    AND NEW."horodatageLocal" IS NOT DISTINCT FROM OLD."horodatageLocal"
    AND NEW."recuLe" IS NOT DISTINCT FROM OLD."recuLe"
    AND NEW."empreinte" IS NOT DISTINCT FROM OLD."empreinte"
    AND NEW."corps" IS NOT DISTINCT FROM OLD."corps" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Événement de synchronisation % : seule la sortie de EN_ATTENTE vers APPLIQUE ou REJETE, avec son résultat, est permise.', OLD."evenementId";
END
$$;

CREATE TRIGGER "evenement_synchro_proteger"
BEFORE UPDATE OR DELETE ON "EvenementSynchro"
FOR EACH ROW EXECUTE FUNCTION "evenement_synchro_proteger"();

CREATE TRIGGER "evenement_synchro_sans_troncature"
BEFORE TRUNCATE ON "EvenementSynchro"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- REPRISE: DEBUT (rejouable sans doublon, D421, D517)
-- Une session technique fermée par point de vente, sur son poste REPRISE, ouverte à la première vente
-- de la pharmacie (sinon à la migration), jour métier = jour UTC de l'ouverture (Conakry, UTC+0).
INSERT INTO "SessionCaisse" ("id", "pointDeVenteId", "posteId", "utilisateurId", "utilisateurNom", "statut", "technique", "jourMetier", "ouverteLe", "fermeeLe", "evenementOuvertureId")
SELECT gen_random_uuid()::text, pv."id", p."id", NULL, 'Reprise historique', 'FERMEE', true, o."ouverteLe"::date, o."ouverteLe", (now() AT TIME ZONE 'UTC')::timestamp(3), 'reprise:' || pv."id"
FROM "PointDeVente" pv
JOIN "Poste" p ON p."pointDeVenteId" = pv."id" AND p."code" = 'REPRISE' AND p."type" = 'TECHNIQUE'
CROSS JOIN LATERAL (
  SELECT COALESCE(min(v."createdAt"), (now() AT TIME ZONE 'UTC')::timestamp(3)) AS "ouverteLe"
  FROM "Vente" v
  WHERE v."structureId" = pv."structureId"
) o
WHERE NOT EXISTS (
  SELECT 1 FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique"
)
ON CONFLICT ("evenementOuvertureId") DO NOTHING;
-- REPRISE: FIN

-- Contrôle final : une session technique et une seule par point de vente.
DO $$
DECLARE
  nombre INTEGER;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "PointDeVente" pv
  WHERE (SELECT count(*) FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique") <> 1;
  IF nombre > 0 THEN
    RAISE EXCEPTION 'Migration M5 arrêtée : % point(s) de vente sans session technique de reprise unique.', nombre;
  END IF;
END $$;

COMMIT;
```

### 3. Migration M6 : `prisma/migrations/20261026140000_pharmacie_t1_ventes_pieces/migration.sql` (nouveau)

Texte imposé, à recopier à l'identique :

```sql
-- Tranche pharmacie 1, pièces de vente et allocations de lots (PB09, M6, D419, D421, D422, D430, D431, D514 à D521).
-- DDL généré par prisma migrate diff (schéma de PB08 vers schéma de PB09, partie M6) ; colonnes non
-- nulles ajoutées nullables puis remplies puis contraintes ; contrôles, CHECK, fonctions et triggers
-- écrits à la main. Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
BEGIN;

-- Arrêt (plan, section 2) : toute vente se rattache au point de vente d'ordre 1 de sa pharmacie et à
-- la session technique de ce point de vente (M5).
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "Vente" v
  WHERE NOT EXISTS (
    SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = v."structureId" AND pv."ordre" = 1
  );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT v."id"
      FROM "Vente" v
      WHERE NOT EXISTS (
        SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = v."structureId" AND pv."ordre" = 1
      )
      ORDER BY v."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M6 arrêtée : % vente(s) appartiennent à une structure sans point de vente. Ventes en cause (50 au plus) : %', nombre, en_cause;
  END IF;

  SELECT count(*)::int INTO nombre
  FROM "Vente" v
  JOIN "PointDeVente" pv ON pv."structureId" = v."structureId" AND pv."ordre" = 1
  WHERE NOT EXISTS (
    SELECT 1 FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique"
  );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT v."id"
      FROM "Vente" v
      JOIN "PointDeVente" pv ON pv."structureId" = v."structureId" AND pv."ordre" = 1
      WHERE NOT EXISTS (
        SELECT 1 FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique"
      )
      ORDER BY v."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M6 arrêtée : % vente(s) dont le point de vente n''a pas de session technique de reprise (rejouer le bloc de reprise de M5). Ventes en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TypePieceVente" AS ENUM ('VENTE', 'ANNULATION', 'REGULARISATION');

-- CreateEnum
CREATE TYPE "UniteVente" AS ENUM ('BOITE', 'UNITE');

-- CreateEnum
CREATE TYPE "StatutAllocation" AS ENUM ('DEFINITIVE', 'PROVISOIRE', 'REMPLACEE');

-- DropForeignKey
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_structureId_fkey";

-- DropForeignKey
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_venteId_fkey";

-- AlterTable (colonnes non nulles remplies ci-dessous avant SET NOT NULL)
ALTER TABLE "Vente" ADD COLUMN     "horodatageLocal" TIMESTAMP(3),
ADD COLUMN     "jourMetier" DATE,
ADD COLUMN     "jourMetierOrigine" DATE,
ADD COLUMN     "numeroTicket" INTEGER,
ADD COLUMN     "pointDeVenteId" TEXT,
ADD COLUMN     "posteId" TEXT,
ADD COLUMN     "sequencePoste" INTEGER,
ADD COLUMN     "sessionCaisseId" TEXT,
ADD COLUMN     "typePiece" "TypePieceVente" NOT NULL DEFAULT 'VENTE',
ADD COLUMN     "venteOrigineId" TEXT;

-- AlterTable
ALTER TABLE "LigneVente" ADD COLUMN     "coefficientApplique" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nombreAffiche" INTEGER,
ADD COLUMN     "uniteAffichee" "UniteVente" NOT NULL DEFAULT 'BOITE';

-- Reprise (D421, D422, D518) : ventes historiques rattachées au point de vente d'ordre 1, au poste
-- REPRISE et à la session technique ; jour métier = date de createdAt (horodatage UTC sans fuseau,
-- Conakry est à UTC+0) ; lignes : nombre affiché = quantité, coefficient 1, unité BOITE (défauts).
UPDATE "Vente" v
SET "pointDeVenteId" = pv."id",
    "posteId" = s."posteId",
    "sessionCaisseId" = s."id",
    "jourMetier" = v."createdAt"::date
FROM "PointDeVente" pv
JOIN "SessionCaisse" s ON s."pointDeVenteId" = pv."id" AND s."technique"
WHERE pv."structureId" = v."structureId" AND pv."ordre" = 1;

UPDATE "LigneVente" SET "nombreAffiche" = "quantite";

ALTER TABLE "Vente" ALTER COLUMN "jourMetier" SET NOT NULL,
ALTER COLUMN "pointDeVenteId" SET NOT NULL,
ALTER COLUMN "posteId" SET NOT NULL,
ALTER COLUMN "sessionCaisseId" SET NOT NULL;

ALTER TABLE "LigneVente" ALTER COLUMN "nombreAffiche" SET NOT NULL;

-- CreateTable
CREATE TABLE "AllocationLot" (
    "id" TEXT NOT NULL,
    "ligneVenteId" TEXT NOT NULL,
    "lotId" TEXT,
    "numeroLot" TEXT,
    "dateExpiration" DATE,
    "quantite" INTEGER NOT NULL,
    "coutUnitaire" INTEGER NOT NULL,
    "lotTechnique" BOOLEAN NOT NULL DEFAULT false,
    "statut" "StatutAllocation" NOT NULL,
    "remplaceeParPieceId" TEXT,
    "sortieManuelle" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,
    "auteurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllocationLot_ligneVenteId_idx" ON "AllocationLot"("ligneVenteId");

-- CreateIndex
CREATE INDEX "AllocationLot_lotId_idx" ON "AllocationLot"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_venteOrigineId_key" ON "Vente"("venteOrigineId");

-- CreateIndex
CREATE INDEX "Vente_pointDeVenteId_jourMetier_idx" ON "Vente"("pointDeVenteId", "jourMetier");

-- CreateIndex
CREATE INDEX "Vente_sessionCaisseId_idx" ON "Vente"("sessionCaisseId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_pointDeVenteId_numeroTicket_key" ON "Vente"("pointDeVenteId", "numeroTicket");

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_venteOrigineId_fkey" FOREIGN KEY ("venteOrigineId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_ligneVenteId_fkey" FOREIGN KEY ("ligneVenteId") REFERENCES "LigneVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes (plan 1.4, D470, D519)
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_venteOrigine_check" CHECK (("typePiece" <> 'ANNULATION' OR "venteOrigineId" IS NOT NULL) AND ("typePiece" <> 'VENTE' OR "venteOrigineId" IS NULL));
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_motifAnnulation_check" CHECK ("typePiece" <> 'ANNULATION' OR ("motifAnnulation" IS NOT NULL AND btrim("motifAnnulation") <> ''));
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_coefficientApplique_check" CHECK ("coefficientApplique" >= 1);
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_quantite_check" CHECK ("quantite" = "nombreAffiche" * "coefficientApplique");
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_uniteAffichee_check" CHECK ("uniteAffichee" <> 'UNITE' OR "coefficientApplique" = 1);
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_quantite_check" CHECK ("quantite" <> 0);
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_coutUnitaire_check" CHECK ("coutUnitaire" >= 0);
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_lot_check" CHECK (("statut" = 'DEFINITIVE') = ("lotId" IS NOT NULL));
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_remplacee_check" CHECK (("statut" = 'REMPLACEE') = ("remplaceeParPieceId" IS NOT NULL));
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_motif_check" CHECK (NOT "sortieManuelle" OR ("motif" IS NOT NULL AND btrim("motif") <> ''));

-- Rattachement d'une nouvelle pièce (D520) : point de vente de sa pharmacie, session de ce point de
-- vente et de ce poste, pièce d'origine du même point de vente.
CREATE FUNCTION "vente_verifier_rattachement"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "PointDeVente" pv
  JOIN "SessionCaisse" s ON s."pointDeVenteId" = pv."id"
  WHERE pv."id" = NEW."pointDeVenteId"
    AND pv."structureId" = NEW."structureId"
    AND s."id" = NEW."sessionCaisseId"
    AND s."posteId" = NEW."posteId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente refusée : le point de vente %, le poste % et la session % ne se rattachent pas à la pharmacie %.', NEW."pointDeVenteId", NEW."posteId", NEW."sessionCaisseId", NEW."structureId";
  END IF;
  IF NEW."venteOrigineId" IS NOT NULL THEN
    PERFORM 1 FROM "Vente" o WHERE o."id" = NEW."venteOrigineId" AND o."pointDeVenteId" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vente refusée : la pièce d''origine % n''appartient pas au point de vente %.', NEW."venteOrigineId", NEW."pointDeVenteId";
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "vente_verifier_rattachement"
BEFORE INSERT ON "Vente"
FOR EACH ROW EXECUTE FUNCTION "vente_verifier_rattachement"();

-- Pièces immuables (D431, D496) : vente et lignes, sauf suppression sous contournement de purge.
CREATE TRIGGER "vente_immuable" BEFORE UPDATE OR DELETE ON "Vente" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "vente_sans_troncature" BEFORE TRUNCATE ON "Vente" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_vente_immuable" BEFORE UPDATE OR DELETE ON "LigneVente" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_vente_sans_troncature" BEFORE TRUNCATE ON "LigneVente" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Allocation (D431) : seule mise à jour permise, PROVISOIRE vers REMPLACEE avec la pièce de résolution ;
-- suppression sous contournement seulement.
CREATE FUNCTION "allocation_lot_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'L''allocation % ne peut pas être supprimée : une allocation est conservée définitivement.', OLD."id";
  END IF;
  IF OLD."statut" = 'PROVISOIRE'
    AND NEW."statut" = 'REMPLACEE'
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."ligneVenteId" IS NOT DISTINCT FROM OLD."ligneVenteId"
    AND NEW."lotId" IS NOT DISTINCT FROM OLD."lotId"
    AND NEW."numeroLot" IS NOT DISTINCT FROM OLD."numeroLot"
    AND NEW."dateExpiration" IS NOT DISTINCT FROM OLD."dateExpiration"
    AND NEW."quantite" IS NOT DISTINCT FROM OLD."quantite"
    AND NEW."coutUnitaire" IS NOT DISTINCT FROM OLD."coutUnitaire"
    AND NEW."lotTechnique" IS NOT DISTINCT FROM OLD."lotTechnique"
    AND NEW."sortieManuelle" IS NOT DISTINCT FROM OLD."sortieManuelle"
    AND NEW."motif" IS NOT DISTINCT FROM OLD."motif"
    AND NEW."auteurId" IS NOT DISTINCT FROM OLD."auteurId"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'L''allocation % ne peut pas être modifiée : seule une allocation PROVISOIRE passe à REMPLACEE, avec sa pièce de résolution.', OLD."id";
END
$$;

CREATE TRIGGER "allocation_lot_proteger"
BEFORE UPDATE OR DELETE ON "AllocationLot"
FOR EACH ROW EXECUTE FUNCTION "allocation_lot_proteger"();

CREATE TRIGGER "allocation_lot_sans_troncature"
BEFORE TRUNCATE ON "AllocationLot"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

COMMIT;
```

### 4. Retour arrière de M6 : `prisma/retours-arriere/20261026140000_pharmacie_t1_ventes_pieces.down.sql` (nouveau)

Texte imposé (D521) :

```sql
-- Retour arrière de 20261026140000_pharmacie_t1_ventes_pieces (PB09, M6).
-- Chaque pièce d'annulation est reportée sur sa vente d'origine (statut ANNULEE, annuleeLe = date de la
-- pièce, annuleeParId = son auteur, motifAnnulation = son motif), puis supprimée avec ses lignes et ses
-- paiements. Les pièces de régularisation et les ventes T- restent des ventes (ce sont des ventes réelles).
-- Les mouvements de stock des annulations restent dans le journal : le retour de M4 en tient compte.
-- Pertes : allocations de lots, unité affichée, rattachement des ventes au point de vente, au poste et à
-- la session, jour métier. Clés étrangères de Vente vers Structure et de LigneVente vers Vente remises
-- en Cascade. À appliquer avant le retour de M5, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

-- Contournement de purge (local à la transaction) : suppression des paiements des annulations.
SELECT set_config('medconnecte.purge_autorisee', 'on', true);

DROP TRIGGER "vente_immuable" ON "Vente";
DROP TRIGGER "vente_sans_troncature" ON "Vente";
DROP TRIGGER "vente_verifier_rattachement" ON "Vente";
DROP TRIGGER "ligne_vente_immuable" ON "LigneVente";
DROP TRIGGER "ligne_vente_sans_troncature" ON "LigneVente";

DO $$
DECLARE
  nombre INTEGER;
BEGIN
  SELECT count(*)::int INTO nombre FROM "Vente" WHERE "typePiece" = 'ANNULATION';
  IF nombre > 0 THEN
    RAISE NOTICE 'Retour arrière de M6 : % pièce(s) d''annulation reportées sur leur vente d''origine puis supprimées.', nombre;
  END IF;
END $$;

UPDATE "Vente" o
SET "statut" = 'ANNULEE',
    "annuleeLe" = a."createdAt",
    "annuleeParId" = a."vendeurId",
    "motifAnnulation" = a."motifAnnulation"
FROM "Vente" a
WHERE a."typePiece" = 'ANNULATION' AND a."venteOrigineId" = o."id";

DELETE FROM "Paiement" p
USING "Vente" a
WHERE p."venteId" = a."id" AND a."typePiece" = 'ANNULATION';

DROP TABLE "AllocationLot";

DELETE FROM "LigneVente" l
USING "Vente" a
WHERE l."venteId" = a."id" AND a."typePiece" = 'ANNULATION';

ALTER TABLE "Vente" DROP CONSTRAINT "Vente_venteOrigineId_fkey";

DELETE FROM "Vente" WHERE "typePiece" = 'ANNULATION';

ALTER TABLE "Vente" DROP CONSTRAINT "Vente_structureId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_pointDeVenteId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_posteId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_sessionCaisseId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_venteOrigine_check";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_motifAnnulation_check";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_venteId_fkey";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_coefficientApplique_check";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_quantite_check";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_uniteAffichee_check";

DROP INDEX "Vente_venteOrigineId_key";
DROP INDEX "Vente_pointDeVenteId_jourMetier_idx";
DROP INDEX "Vente_sessionCaisseId_idx";
DROP INDEX "Vente_pointDeVenteId_numeroTicket_key";

ALTER TABLE "Vente" DROP COLUMN "horodatageLocal",
DROP COLUMN "jourMetier",
DROP COLUMN "jourMetierOrigine",
DROP COLUMN "numeroTicket",
DROP COLUMN "pointDeVenteId",
DROP COLUMN "posteId",
DROP COLUMN "sequencePoste",
DROP COLUMN "sessionCaisseId",
DROP COLUMN "typePiece",
DROP COLUMN "venteOrigineId";

ALTER TABLE "LigneVente" DROP COLUMN "coefficientApplique",
DROP COLUMN "nombreAffiche",
DROP COLUMN "uniteAffichee";

ALTER TABLE "Vente" ADD CONSTRAINT "Vente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP FUNCTION "allocation_lot_proteger"();
DROP FUNCTION "vente_verifier_rattachement"();

DROP TYPE "StatutAllocation";
DROP TYPE "UniteVente";
DROP TYPE "TypePieceVente";

SELECT set_config('medconnecte.purge_autorisee', 'off', true);

COMMIT;
```

### 5. Retour arrière de M5 : `prisma/retours-arriere/20261026130000_pharmacie_t1_caisse.down.sql` (nouveau)

Texte imposé (D521) :

```sql
-- Retour arrière de 20261026130000_pharmacie_t1_caisse (PB09, M5).
-- Refusé tant que M6 est en place (les ventes référencent les sessions) : appliquer d'abord le retour
-- de M6. Valable ensuite même après activité réelle ; pertes, comptées par un NOTICE : sessions de
-- caisse, comptages, relevés, mouvements de caisse, paiements, résultats, clôtures, réceptions
-- (LotStock.receptionId remis à nul, le trigger de protection du lot suspendu le temps de l'écriture),
-- inventaires et événements de synchronisation. À appliquer avant le retour de M4, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DO $$
DECLARE
  sessions INTEGER;
  paiements INTEGER;
  clotures INTEGER;
  receptions INTEGER;
  inventaires INTEGER;
  evenements INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Vente' AND column_name = 'sessionCaisseId'
  ) THEN
    RAISE EXCEPTION 'Retour arrière de M5 refusé : appliquer d''abord le retour arrière de M6 (20261026140000_pharmacie_t1_ventes_pieces.down.sql).';
  END IF;
  SELECT count(*)::int INTO sessions FROM "SessionCaisse" WHERE NOT "technique";
  SELECT count(*)::int INTO paiements FROM "Paiement";
  SELECT count(*)::int INTO clotures FROM "ClotureJournaliere";
  SELECT count(*)::int INTO receptions FROM "Reception";
  SELECT count(*)::int INTO inventaires FROM "Inventaire";
  SELECT count(*)::int INTO evenements FROM "EvenementSynchro";
  IF sessions + paiements + clotures + receptions + inventaires + evenements > 0 THEN
    RAISE NOTICE 'Retour arrière de M5 : supprimés % session(s) de caisse, % paiement(s), % clôture(s), % réception(s), % inventaire(s), % événement(s) de synchronisation.', sessions, paiements, clotures, receptions, inventaires, evenements;
  END IF;
END $$;

ALTER TABLE "LotStock" DROP CONSTRAINT "LotStock_receptionId_fkey";

ALTER TABLE "LotStock" DISABLE TRIGGER "lot_stock_proteger";
UPDATE "LotStock" SET "receptionId" = NULL WHERE "receptionId" IS NOT NULL;
ALTER TABLE "LotStock" ENABLE TRIGGER "lot_stock_proteger";

DROP TABLE "TotalClotureMode";
DROP TABLE "ResultatSessionMode";
DROP TABLE "Paiement";
DROP TABLE "MouvementCaisse";
DROP TABLE "ReleveModePaiement";
DROP TABLE "LigneComptage";
DROP TABLE "ComptageCaisse";
DROP TABLE "SessionCaisse";
DROP TABLE "ClotureJournaliere";
DROP TABLE "LigneInventaire";
DROP TABLE "Inventaire";
DROP TABLE "Reception";
DROP TABLE "EvenementSynchro";

DROP FUNCTION "session_caisse_proteger"();
DROP FUNCTION "evenement_synchro_proteger"();

DROP TYPE "StatutEvenementSynchro";
DROP TYPE "TypeMouvementCaisse";
DROP TYPE "MomentComptage";
DROP TYPE "StatutSession";

COMMIT;
```

### 6. `prisma/retours-arriere/README.md` (modifié)

Juste avant la ligne `## Vérification`, insérer :

```markdown
## Ordre

Défaire de la plus récente à la plus ancienne : M6 (`20261026140000_pharmacie_t1_ventes_pieces`),
puis M5 (`20261026130000_pharmacie_t1_caisse`, refusé tant que M6 est en place), puis M4, M3, M2,
M1. Chaque fichier liste en tête ce qu'il perd.

```

### 7. Code d'erreur (`src/common/filters/codes-erreur.ts`)

Ajouter à la fin du tableau `CODES_ERREUR`, après `'MEDICAMENT_UTILISE',` :

```ts
  // Structure qui a des ventes, un journal de stock ou de caisse : suppression refusée, la désactiver (409).
  'STRUCTURE_AVEC_PIECES',
```

Pas d'ajout à `CODES_AVEC_DETAILS` (aucun `details`).

### 8. `src/pharmacie/point-de-vente.ts` (modifié)

8.1 Remplacer le commentaire et le corps de `supprimerConfigurationPharmacies` par :

```ts
/**
 * Supprime la configuration de caisse des structures données, dans l'ordre des
 * clés étrangères (toutes en Restrict) ; à appeler juste avant de supprimer ces
 * structures (D479). La session technique de reprise (D517) part avec elle : sa
 * suppression est permise sans contournement, les ventes historiques la protègent
 * par leur clé étrangère (D522). Liste vide : aucune requête.
 */
export async function supprimerConfigurationPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parPointDeVente = {
    pointDeVente: { structureId: { in: structureIds } },
  };
  const parStructure = { structureId: { in: structureIds } };
  await tx.anomalie.deleteMany({ where: parPointDeVente });
  await tx.plageTicket.deleteMany({ where: parPointDeVente });
  await tx.sessionCaisse.deleteMany({
    where: { technique: true, ...parPointDeVente },
  });
  await tx.poste.deleteMany({ where: parPointDeVente });
  await tx.compteurTicket.deleteMany({ where: parPointDeVente });
  await tx.pointDeVente.deleteMany({ where: parStructure });
  await tx.parametresPharmacie.deleteMany({ where: parStructure });
  await tx.fournisseur.deleteMany({ where: parStructure });
}
```

8.2 Ajouter à la fin du fichier :

```ts
/**
 * Vrai si la structure porte une pièce ou un journal : vente, lot, mouvement de
 * stock, session de caisse non technique, clôture, réception, inventaire ou
 * événement de synchronisation (D522). Une telle structure ne se supprime pas
 * (409 STRUCTURE_AVEC_PIECES) : elle se désactive.
 */
export async function structureAPieces(
  tx: Prisma.TransactionClient,
  structureId: string,
): Promise<boolean> {
  const [ligne] = await tx.$queryRaw<{ aDesPieces: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = ${structureId})
      OR EXISTS (SELECT 1 FROM "LotStock" l JOIN "PointDeVente" pv ON pv."id" = l."pointDeVenteId" WHERE pv."structureId" = ${structureId})
      OR EXISTS (SELECT 1 FROM "MouvementStock" m JOIN "PointDeVente" pv ON pv."id" = m."pointDeVenteId" WHERE pv."structureId" = ${structureId})
      OR EXISTS (SELECT 1 FROM "SessionCaisse" s JOIN "PointDeVente" pv ON pv."id" = s."pointDeVenteId" WHERE pv."structureId" = ${structureId} AND NOT s."technique")
      OR EXISTS (SELECT 1 FROM "ClotureJournaliere" c JOIN "PointDeVente" pv ON pv."id" = c."pointDeVenteId" WHERE pv."structureId" = ${structureId})
      OR EXISTS (SELECT 1 FROM "Reception" r JOIN "PointDeVente" pv ON pv."id" = r."pointDeVenteId" WHERE pv."structureId" = ${structureId})
      OR EXISTS (SELECT 1 FROM "Inventaire" i JOIN "PointDeVente" pv ON pv."id" = i."pointDeVenteId" WHERE pv."structureId" = ${structureId})
      OR EXISTS (SELECT 1 FROM "EvenementSynchro" e JOIN "Poste" p ON p."id" = e."posteId" JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE pv."structureId" = ${structureId})
    ) AS "aDesPieces"`;
  return ligne?.aDesPieces === true;
}
```

(Requête exécutée par le chef : vraie pour une pharmacie avec ventes ou lots, fausse pour un hôpital et pour une pharmacie dont seule la session technique existe.)

### 9. `src/super-admin/super-admin.service.ts` (modifié ; le contrôleur n'est pas touché)

9.1 Import : remplacer

```ts
import {
  assurerPointDeVente,
  supprimerConfigurationPharmacies,
} from 'src/pharmacie/point-de-vente';
```

par

```ts
import {
  assurerPointDeVente,
  structureAPieces,
  supprimerConfigurationPharmacies,
} from 'src/pharmacie/point-de-vente';
```

9.2 Dans `deleteStructure`, remplacer

```ts
    await this.prisma.$transaction(async (tx) => {
      // 1. Supprimer tous les membres de la structure
```

par

```ts
    await this.prisma.$transaction(async (tx) => {
      // Une structure qui a des ventes, un journal de stock ou de caisse ne se supprime pas (O12, D430, D522).
      if (await structureAPieces(tx, structureId)) {
        throw new ConflictException({
          message:
            'Cette structure a des ventes ou des mouvements de stock : désactivez-la.',
          code: 'STRUCTURE_AVEC_PIECES',
        });
      }

      // 1. Supprimer tous les membres de la structure
```

`ConflictException` est déjà importé. Le 404 « Structure non trouvée » reste avant la transaction, inchangé.

### 10. `src/pharmacie/caisse/purge-pieces.ts` (nouveau, dossier nouveau)

```ts
import type { Prisma } from 'generated/prisma/client';

/**
 * Supprime les pièces de caisse et de vente des structures données (D523) :
 * allocations, paiements, lignes et pièces de vente (pièces liées à une origine
 * d'abord), mouvements de caisse, résultats, relevés, lignes de comptage, comptages,
 * sessions (techniques comprises), totaux et clôtures, lignes d'inventaire et
 * inventaires, événements de synchronisation. Réservé à la purge du jeu démo et au
 * harnais : le contournement `medconnecte.purge_autorisee` (local à la transaction,
 * D496) n'autorise que les suppressions, et il est retiré à la fin. À appeler avant
 * `purgerStockPharmacies` (les lignes d'inventaire référencent les lots). Jamais pour
 * la suppression d'une vraie pharmacie. Liste vide : aucune requête.
 */
export async function purgerPiecesPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parStructure = { structureId: { in: structureIds } };
  const parPointDeVente = { pointDeVente: parStructure };
  const parSession = { sessionCaisse: parPointDeVente };
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'on', true)`;
  await tx.allocationLot.deleteMany({
    where: { ligneVente: { vente: parStructure } },
  });
  await tx.paiement.deleteMany({ where: { vente: parStructure } });
  await tx.ligneVente.deleteMany({ where: { vente: parStructure } });
  await tx.vente.deleteMany({
    where: { ...parStructure, venteOrigineId: { not: null } },
  });
  await tx.vente.deleteMany({ where: parStructure });
  await tx.mouvementCaisse.deleteMany({ where: parPointDeVente });
  await tx.resultatSessionMode.deleteMany({ where: parSession });
  await tx.releveModePaiement.deleteMany({ where: { comptage: parSession } });
  await tx.ligneComptage.deleteMany({ where: { comptage: parSession } });
  await tx.comptageCaisse.deleteMany({ where: parSession });
  await tx.sessionCaisse.deleteMany({ where: parPointDeVente });
  await tx.totalClotureMode.deleteMany({
    where: { cloture: parPointDeVente },
  });
  await tx.clotureJournaliere.deleteMany({ where: parPointDeVente });
  await tx.ligneInventaire.deleteMany({
    where: { inventaire: parPointDeVente },
  });
  await tx.inventaire.deleteMany({ where: parPointDeVente });
  await tx.evenementSynchro.deleteMany({ where: { poste: parPointDeVente } });
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'off', true)`;
}
```

### 11. `src/pharmacie/stock/purge-stock.ts` (modifié)

11.1 Dans le commentaire, remplacer `agrégats, mouvements et lots de leurs points de vente (D503).` par `agrégats, mouvements, lots et réceptions de leurs points de vente (D503, D523).` et remplacer `À appeler avant \`supprimerConfigurationPharmacies\` (les lots référencent les points` + ligne suivante `de vente).` par `À appeler après \`purgerPiecesPharmacies\` et avant \`supprimerConfigurationPharmacies\`` + ligne suivante `(les lots référencent les réceptions et les points de vente).` (adapter la coupure des lignes du commentaire, sans changer d'autre mot).

11.2 Après `await tx.lotStock.deleteMany({ where: parPointDeVente });`, ajouter `await tx.reception.deleteMany({ where: parPointDeVente });` (avant le second `$queryRaw`).

### 12. `src/demo/demo.seeder.ts` (modifié)

12.1 Import : après `import { purgerStockPharmacies } from 'src/pharmacie/stock/purge-stock';`, ajouter `import { purgerPiecesPharmacies } from 'src/pharmacie/caisse/purge-pieces';`.

12.2 Dans `purger`, juste avant le commentaire `// Journal de stock des pharmacies démo (lots en Restrict vers les points de vente, D503).`, insérer :

```ts
    // Pièces de caisse et de vente des pharmacies démo (immuables, clés étrangères en Restrict, D523).
    await purgerPiecesPharmacies(
      tx,
      structuresDemo.map((s) => s.id),
    );
```

12.3 Dans le commentaire de `purger`, remplacer les deux lignes

```
   * étrangère est en SET NULL), de même que le journal de stock (lots, mouvements,
   * agrégats, conditionnements, D503) et la configuration de caisse des
```

par

```
   * étrangère est en SET NULL), de même que les pièces de caisse et de vente (D523),
   * le journal de stock (lots, mouvements, agrégats, conditionnements, réceptions,
   * D503) et la configuration de caisse des
```

### 13. `src/pharmacie/vente.service.ts` (modifié, compilation seulement, D524)

13.1 Dans `enregistrerVente`, dans l'objet renvoyé par `dto.lignes.map((l) => { ... return { ... } })`, ajouter `nombreAffiche: l.quantite,` juste après `quantite: l.quantite,`.

13.2 Remplacer

```ts
    // La vente est créée avant les retraits : un rejeu simultané de la même clé échoue ici.
    const vente = await tx.vente.create({
      data: {
        structureId,
        numero: formaterNumero(annee, dernierNumero),
        vendeurId: user.id,
        vendeurNom: `${user.prenom} ${user.nom}`.trim(),
        clientNom: dto.clientNom?.trim() || null,
        clientTelephone: dto.clientTelephone?.trim() || null,
        ordonnanceVerifiee: dto.ordonnanceVerifiee === true,
        total,
        cleIdempotence: cle,
        lignes: { create: lignes },
      },
      include: { lignes: true },
    });
```

par

```ts
    // La vente est créée avant les retraits : un rejeu simultané de la même clé échoue ici.
    // Entre PB09 et PB11, ni point de vente, ni poste, ni session, ni jour métier : l'insertion
    // échoue en base (colonnes non nulles), comme le compteur gelé depuis M4 (D505, D524).
    const donneesVente: Omit<
      Prisma.VenteUncheckedCreateInput,
      'pointDeVenteId' | 'posteId' | 'sessionCaisseId' | 'jourMetier'
    > = {
      structureId,
      numero: formaterNumero(annee, dernierNumero),
      vendeurId: user.id,
      vendeurNom: `${user.prenom} ${user.nom}`.trim(),
      clientNom: dto.clientNom?.trim() || null,
      clientTelephone: dto.clientTelephone?.trim() || null,
      ordonnanceVerifiee: dto.ordonnanceVerifiee === true,
      total,
      cleIdempotence: cle,
      lignes: { create: lignes },
    };
    const vente = await tx.vente.create({
      data: donneesVente as Prisma.VenteUncheckedCreateInput,
      include: { lignes: true },
    });
```

Rien d'autre dans ce fichier (ni `annulerVente`, ni lectures). `src/pharmacie/vente.service.spec.ts` (doublure en mémoire) doit rester vert sans modification.

### 14. Invariant des allocations dans `stock:verifier` (D501, D525)

14.1 `src/pharmacie/stock/commandes-stock.ts` :

- Dans `interface RapportVerification`, juste avant `totalAnomalies`, ajouter
```ts
  allocations: Echantillon<{
    ligneVenteId: string;
    quantite: number;
    alloue: number;
  }>;
```
  et remplacer le commentaire de `totalAnomalies` par `// somme des six \`nombre\``.
- Après la constante `SQL_VERIFIER_PLAGES`, ajouter :
```ts
const SQL_VERIFIER_TABLE_ALLOCATIONS = `SELECT to_regclass('"AllocationLot"') IS NOT NULL AS "present"`;

const SQL_VERIFIER_ALLOCATIONS = `
SELECT l."id" AS "ligneVenteId", l."quantite" AS "quantite", COALESCE(sum(a."quantite") FILTER (WHERE a."statut" = 'DEFINITIVE'), 0)::int AS "alloue"
FROM "LigneVente" l
JOIN "AllocationLot" a ON a."ligneVenteId" = l."id"
GROUP BY l."id", l."quantite"
HAVING count(*) FILTER (WHERE a."statut" = 'PROVISOIRE') = 0
   AND COALESCE(sum(a."quantite") FILTER (WHERE a."statut" = 'DEFINITIVE'), 0) <> l."quantite"
ORDER BY l."id"`;
```
  (requête exécutée par le chef : une ligne sans allocation est ignorée, une ligne qui porte une allocation PROVISOIRE est ignorée, une ligne dont les définitives ne font pas la quantité est rendue.)
- Dans `verifierStock`, après la lecture des plages :
```ts
    const tableAllocations = await client.query<{ present: boolean }>(
      SQL_VERIFIER_TABLE_ALLOCATIONS,
    );
    const allocations = tableAllocations.rows[0].present
      ? (
          await client.query<{
            ligneVenteId: string;
            quantite: number;
            alloue: number;
          }>(SQL_VERIFIER_ALLOCATIONS)
        ).rows
      : [];
```
  ajouter `allocations: echantillon(allocations),` dans l'objet `rapport` (après `plagesSuperposees`) et `+ rapport.allocations.nombre` à la somme de `totalAnomalies`.

14.2 `scripts/stock-verifier.ts` : dans le commentaire d'en-tête, remplacer `conditionnements ouverts contre reliquat, plages de tickets superposées.` par `conditionnements ouverts contre reliquat, plages de tickets superposées, allocations des lignes de vente.` ; après l'affichage des plages, ajouter :
```ts
    console.log(
      `Lignes de vente dont les allocations définitives diffèrent de la quantité : ${rapport.allocations.nombre}`,
    );
    afficher(
      rapport.allocations,
      (e) => `${e.ligneVenteId} | quantité ${e.quantite} | allouée ${e.alloue}`,
    );
```
  et dans le message de résultat en anomalie, remplacer `lots négatifs et plages : analyse requise.` par `lots négatifs, plages et allocations : analyse requise.`.

### 15. `CLAUDE.md` (back, modifié)

Juste après la puce `- **Journal de stock (tranche pharmacie 1, PB07)** : ...` (une seule ligne), ajouter la puce :

```markdown
- **Caisse et pièces de vente (tranche pharmacie 1, PB09)** : migrations `20261026130000_pharmacie_t1_caisse` (M5) et `20261026140000_pharmacie_t1_ventes_pieces` (M6), retours arrière dans `prisma/retours-arriere/` (M6 d'abord : chaque pièce d'annulation est reportée sur son origine ; M5 refusé tant que M6 est en place). Tables `SessionCaisse` (une seule OUVERTE par poste, transitions OUVERTE vers FERMEE puis INCLUSE_DANS_CLOTURE par trigger `session_caisse_proteger`), `ComptageCaisse` et `LigneComptage` (par coupure seulement, aucune ligne « pièces et autres »), `ReleveModePaiement`, `MouvementCaisse`, `Paiement` (montant signé), `ResultatSessionMode`, `ClotureJournaliere`, `TotalClotureMode`, `Reception`, `Inventaire`, `LigneInventaire`, `EvenementSynchro` (seule sortie de EN_ATTENTE), `AllocationLot` (lot si et seulement si DEFINITIVE, seule mise à jour PROVISOIRE vers REMPLACEE) : toutes immuables par trigger, clés étrangères en Restrict. `Vente` porte `pointDeVenteId`, `posteId`, `sessionCaisseId`, `jourMetier` (non nuls), `typePiece` (VENTE, ANNULATION, REGULARISATION), `venteOrigineId` (unique), `numeroTicket` ; `LigneVente` porte `uniteAffichee`, `nombreAffiche`, `coefficientApplique` (`quantite = nombreAffiche x coefficientApplique`, CHECK) ; ventes et lignes ne se modifient ni ne se suppriment plus (trigger), `Vente` vers `Structure` et `LigneVente` vers `Vente` sont en Restrict. Les ventes historiques sont rattachées au poste `REPRISE` et à une session technique fermée par point de vente (`technique`, `evenementOuvertureId` `reprise:<pointDeVenteId>`), à exclure de toute caisse et de toute clôture. Suppression d'une structure qui a des pièces : 409 `STRUCTURE_AVEC_PIECES` (`structureAPieces`) ; purge démo : `purgerPiecesPharmacies`, puis `purgerStockPharmacies`, puis `supprimerConfigurationPharmacies`. `stock:verifier` contrôle aussi la somme des allocations définitives des lignes de vente.
```

### 16. Tests

#### 16.1 `src/pharmacie/caisse/purge-pieces.spec.ts` (nouveau, `npm test`)

Doublure : `tx` avec `$queryRaw: jest.fn().mockResolvedValue([])` et, pour chacun des modèles `allocationLot`, `paiement`, `ligneVente`, `vente`, `mouvementCaisse`, `resultatSessionMode`, `releveModePaiement`, `ligneComptage`, `comptageCaisse`, `sessionCaisse`, `totalClotureMode`, `clotureJournaliere`, `ligneInventaire`, `inventaire`, `evenementSynchro`, un objet `{ deleteMany: jest.fn().mockResolvedValue({ count: 0 }) }` ; passé par `as never`.

- `liste vide : aucune requête` : `purgerPiecesPharmacies(tx, [])` ; ni `$queryRaw` ni aucun `deleteMany` appelé.
- `pose le contournement, supprime dans l ordre des dépendances, puis le retire` : avec `['s1', 's2']`, `F = { structureId: { in: ['s1', 's2'] } }`, `P = { pointDeVente: F }`, `S = { sessionCaisse: P }` : `allocationLot` appelé avec `{ where: { ligneVente: { vente: F } } }` ; `paiement` et `ligneVente` avec `{ where: { vente: F } }` ; `vente` appelé deux fois, d'abord `{ where: { ...F, venteOrigineId: { not: null } } }` puis `{ where: F }` ; `mouvementCaisse`, `sessionCaisse`, `clotureJournaliere`, `inventaire` avec `{ where: P }` ; `resultatSessionMode` et `comptageCaisse` avec `{ where: S }` ; `releveModePaiement` et `ligneComptage` avec `{ where: { comptage: S } }` ; `totalClotureMode` avec `{ where: { cloture: P } }` ; `ligneInventaire` avec `{ where: { inventaire: P } }` ; `evenementSynchro` avec `{ where: { poste: P } }` ; `$queryRaw` appelé deux fois, texte joint du premier appel contenant `set_config('medconnecte.purge_autorisee', 'on', true)`, du second `'off'` ; `invocationCallOrder` strictement croissant dans cet ordre : `$queryRaw[0]`, `allocationLot`, `paiement`, `ligneVente`, `vente[0]`, `vente[1]`, `mouvementCaisse`, `resultatSessionMode`, `releveModePaiement`, `ligneComptage`, `comptageCaisse`, `sessionCaisse`, `totalClotureMode`, `clotureJournaliere`, `ligneInventaire`, `inventaire`, `evenementSynchro`, `$queryRaw[1]`.

#### 16.2 `src/pharmacie/stock/purge-stock.spec.ts` (modifié)

Ajouter `reception: modele()` à `creerTx` ; dans `liste vide`, `expect(tx.reception.deleteMany).not.toHaveBeenCalled()` ; dans le second test, ajouter `tx.reception` à la boucle des modèles appelés une fois avec le filtre, et insérer `tx.reception.deleteMany.mock.invocationCallOrder[0]` dans `ordre` entre `lotStock` et `$queryRaw[1]`.

#### 16.3 `src/pharmacie/point-de-vente.spec.ts` (modifié)

- `MODELES_SUPPRESSION` : insérer `'sessionCaisse'` entre `'plageTicket'` et `'poste'` ; `creerTx` : ajouter `sessionCaisse: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) }` et `$queryRaw: jest.fn()`.
- Test 3 : ajouter `expect(tx.sessionCaisse.deleteMany).toHaveBeenCalledWith({ where: { technique: true, pointDeVente: { structureId: { in: ['s1', 's2'] } } } });`.
- Nouveau test `5. structureAPieces : lit le booléen de la requête, faux sans ligne` : importer `structureAPieces` ; `tx.$queryRaw.mockResolvedValueOnce([{ aDesPieces: true }])` puis `structureAPieces(comme(tx), 'str-1')` vaut `true` ; `[{ aDesPieces: false }]` vaut `false` ; `[]` vaut `false` ; pour le premier appel, `(appel[0] as string[]).join('')` contient `"Vente"`, `"LotStock"`, `"MouvementStock"`, `NOT s."technique"`, `"ClotureJournaliere"`, `"Reception"`, `"Inventaire"`, `"EvenementSynchro"`, et `appel.slice(1)` vaut huit fois `'str-1'`.

#### 16.4 `src/demo/demo.seeder.spec.ts` (modifié)

Nouveau test dans le même `describe` que « purge : la configuration de caisse des structures démo part avant les structures », même préparation (`DEMO_MODE` vrai, `structure.findMany` résout `[{ id: 's-pharma' }]`, `user.deleteMany` et `structure.deleteMany` résolvent `{ count: 0 }`) : `purge : pièces de caisse et de vente avant le journal de stock, réceptions après les lots` : après `reinitialiserJeuDeDonnees()`, `prisma.vente.deleteMany` appelé avec `{ where: { structureId: { in: ['s-pharma'] }, venteOrigineId: { not: null } } }` et avec `{ where: { structureId: { in: ['s-pharma'] } } }` ; `invocationCallOrder[0]` de `prisma.vente.deleteMany` < celui de `prisma.sessionCaisse.deleteMany` < celui de `prisma.lotStock.deleteMany` < celui de `prisma.reception.deleteMany` < celui de `prisma.pointDeVente.deleteMany`.

#### 16.5 `test/db/m5-caisse.db-spec.ts` (nouveau, `npm run test:db`)

Constantes `M1` à `M4` (noms existants) et `M5 = '20261026130000_pharmacie_t1_caisse'`. `lignesSql` copiée de la spec M4. `beforeAll` : base, migrations `jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL`, `resume = await chargerFormatActuel(base.client)`, `appliquees = await appliquerMigrations(base.client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M5 })` avec le commentaire « Jamais au-delà de M5 : le retour arrière de M5 doit rester applicable. ». `afterAll` : `supprimerBaseDeTest`. Aides (requêtes paramétrées) : `pv(structureId)`, `posteReprise(pvId)`, `sessionTechnique(pvId)` (id), `mode(code)` (id du mode de paiement), `lotTechnique(stockId)`, `jourIso(date)`. Tests dans cet ordre (état partagé) :

1. `M5 et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)` : comme la spec M4 ; le fichier de migration contient exactement une ligne `-- REPRISE: DEBUT (rejouable sans doublon, D421, D517)` et une ligne `-- REPRISE: FIN`.
2. `reprise : une session technique fermée par point de vente, sur le poste REPRISE` : `appliquees` vaut `[M1, M2, M3, M4, M5]` ; 3 sessions, toutes `technique` ; pour chaque pharmacie : `statut` `FERMEE`, `utilisateurId` nul, `utilisateurNom` « Reprise historique », `posteId` = `posteReprise(pv)`, `evenementOuvertureId` = `'reprise:' + pv`, `fermeeLe` non nul, `evenementFermetureId` et `clotureJournaliereId` nuls, `"jourMetier" = "ouverteLe"::date` ; `str-pharma-1` : `to_char("ouverteLe", 'YYYY-MM-DD HH24:MI:SS')` = `jourIso(J) + ' 08:00:00'` ; `str-pharma-2` : `jourIso(J - 1 jour) + ' 15:00:00'` ; `str-pharma-3` : `"ouverteLe" >= $1` avec `J`.
3. `reprise rejouable sans doublon` : extraire le bloc entre les marqueurs (inclus) ; photographie `SELECT * FROM "SessionCaisse" ORDER BY "id"` ; `appliquerSql` du bloc ; photographie identique.
4. `aucune ligne pièces et autres : comptage par coupure seulement (CORRECTIONS-PORTEUR point 1)` : colonnes (`information_schema.columns`, triées) de `ComptageCaisse` = `['auteurId', 'createdAt', 'evenementId', 'horodatageLocal', 'id', 'moment', 'sessionCaisseId', 'totalEspeces']`, de `LigneComptage` = `['comptageId', 'id', 'nombre', 'valeurFaciale']` ; `SELECT "valeurFaciale", "type" FROM "CoupureMonnaie" WHERE "actif" ORDER BY "ordre"` = les six billets `20000, 10000, 5000, 2000, 1000, 500`, tous `BILLET`.
5. `session : poste du même point de vente, technique seulement sur le poste technique, utilisateur obligatoire` : insérer les postes WEB `poste-p1-w1` (PV de `str-pharma-1`, code `W1`, appareil `harnais-p1-w1`) et `poste-p2-w1` (PV de `str-pharma-2`, code `W1`, appareil `harnais-p2-w1`). Aide `session(id, posteId, pvId, { technique?, utilisateurId? })` : `INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","technique","jourMetier","evenementOuvertureId") VALUES ($1,$2,$3,$4,'Mamadou Diallo',$5,$6::date,$7)` avec `utilisateurId` par défaut `usr-pharm-p1`, `technique` faux, jour `jourIso(J)`, événement `'ouv-' + id`. Refus (`rejects.toThrow(/Session refusée/)`) : technique sur `poste-p1-w1` ; non technique sur le poste REPRISE de `str-pharma-1` ; `poste-p2-w1` avec le PV de `str-pharma-1`. `utilisateurId` nul : `{ constraint: 'SessionCaisse_utilisateur_check' }`. `s-p1-1` sur `poste-p1-w1` : réussit. Seconde session ouverte `s-p1-2` sur `poste-p1-w1` : `{ constraint: 'SessionCaisse_posteId_ouverte_key' }`.
6. `session : transitions OUVERTE vers FERMEE puis FERMEE vers INCLUSE_DANS_CLOTURE seulement` (sur `s-p1-1`) : `utilisateurNom` = 'Autre' rejette `/ne peut pas être modifiée/` ; `utilisateurNom` = 'Mamadou Diallo' a `rowCount` 1 ; `statut` = 'INCLUSE_DANS_CLOTURE' rejette `/OUVERTE vers INCLUSE_DANS_CLOTURE/` ; `statut` = 'FERMEE' seul : `{ constraint: 'SessionCaisse_fermeture_check' }` ; `statut` 'FERMEE', `fermeeLe` now(), `evenementFermetureId` 'ferm-s-p1-1', `commentaireEcart` 'Écart de 500 GNF', `commentaireParId` 'usr-pharm-p1' : `rowCount` 1 ; `commentaireEcart` = 'Autre' rejette `/FERMEE vers FERMEE/` ; `statut` 'OUVERTE', `fermeeLe` NULL rejette `/FERMEE vers OUVERTE/` ; insérer la clôture `clo-p1-j` (PV de `str-pharma-1`, `jourIso(J)`, `clotureParId` 'usr-admin-p1') ; `statut` = 'INCLUSE_DANS_CLOTURE' sans clôture : `{ constraint: 'SessionCaisse_cloture_check' }` ; avec `clotureJournaliereId` 'clo-p1-j' : `rowCount` 1 ; retour à 'FERMEE' avec clôture nulle rejette `/INCLUSE_DANS_CLOTURE vers FERMEE/` ; session technique de `str-pharma-1` : `utilisateurNom` = 'x' rejette `/La session technique .* ne se modifie pas/` ; `DELETE` de `s-p1-1` rejette `/ne peut pas être supprimée/` ; dans `BEGIN`, contournement (`SELECT set_config('medconnecte.purge_autorisee', 'on', true)`), `DELETE` de `s-p1-1` a `rowCount` 1, `ROLLBACK` ; dans `BEGIN`, `DELETE` de la session technique de `str-pharma-3` sans contournement a `rowCount` 1, `ROLLBACK` ; `TRUNCATE "SessionCaisse" CASCADE` rejette `/ne se modifient ni ne se suppriment jamais/`.
7. `pièces immuables : ni modification, ni suppression, ni troncature ; la purge ne fait que supprimer` : insérer `cpt-1` (`ComptageCaisse` : `s-p1-1`, OUVERTURE, 200000, 'usr-pharm-p1', 'evt-cpt-1'), `lc-1` (`LigneComptage` : `cpt-1`, 20000, 10), `rel-1` (`ReleveModePaiement` : `cpt-1`, `mode('ORANGE_MONEY')`, 50000), `mvc-1` (`MouvementCaisse` : `s-p1-1`, PV de `str-pharma-1`, PRELEVEMENT, `mode('ESPECES')`, 100000, 'Dépôt à la banque', 'usr-pharm-p1', 'evt-mvc-1'), `pai-1` (`Paiement` : `vte-p1-1`, `s-p1-1`, `mode('ESPECES')`, 15000, `montantRecu` 20000), `res-1` (`ResultatSessionMode` : `s-p1-1`, `mode('ESPECES')`, 500000, 490000, -10000), `tot-1` (`TotalClotureMode` : `clo-p1-j`, `mode('ESPECES')`, 500000, 490000, -10000), `rec-1` (`Reception` : PV de `str-pharma-1`, `recueLe` now(), 'usr-admin-p1'), `inv-1` (`Inventaire` : PV de `str-pharma-1`, 'usr-admin-p1'), `li-1` (`LigneInventaire` : `inv-1`, `stk-03`, `lotTechnique('stk-03')`, 9, 8, -1, faux). Pour chaque couple (table, id) parmi `ComptageCaisse cpt-1`, `LigneComptage lc-1`, `ReleveModePaiement rel-1`, `MouvementCaisse mvc-1`, `Paiement pai-1`, `ResultatSessionMode res-1`, `ClotureJournaliere clo-p1-j`, `TotalClotureMode tot-1`, `Reception rec-1`, `Inventaire inv-1`, `LigneInventaire li-1` : `UPDATE "<table>" SET "id" = "id" WHERE "id" = $1` et `DELETE FROM "<table>" WHERE "id" = $1` rejettent avec un message contenant `Écriture refusée sur la table <table>` ; `TRUNCATE "<table>" CASCADE` rejette `/ne se modifient ni ne se suppriment jamais/`. Puis dans `BEGIN` + contournement, `UPDATE "Paiement" SET "montant" = 1 WHERE "id" = 'pai-1'` rejette ; `ROLLBACK` ; dans `BEGIN` + contournement, `DELETE` de `lc-1` puis de `pai-1` ont chacun `rowCount` 1 ; `ROLLBACK` ; `lc-1` et `pai-1` existent toujours.
8. `contraintes nommées des pièces de caisse (D516)` : chaque insertion rejette avec `{ constraint }` : `LigneComptage` nombre -1 (`cpt-1`, 10000) `LigneComptage_nombre_check` ; valeurFaciale 0 `LigneComptage_valeurFaciale_check` ; (`cpt-1`, 20000) de nouveau `LigneComptage_comptageId_valeurFaciale_key` ; second comptage OUVERTURE de `s-p1-1` `ComptageCaisse_sessionCaisseId_moment_key` ; comptage FERMETURE à -1 `ComptageCaisse_totalEspeces_check` ; relevé (`cpt-1`, `MTN_MOMO`) à -1 `ReleveModePaiement_montantDeclare_check` ; mouvement de caisse à 0 `MouvementCaisse_montant_check`, motif '   ' `MouvementCaisse_motif_check` ; paiement à 0 `Paiement_montant_check`, `montantRecu` -1 `Paiement_montantRecu_check` ; résultat (`s-p1-1`, `ORANGE_MONEY`) 500000 / 490000 / 10000 `ResultatSessionMode_ecart_check`, et compte nul avec écart 5 `ResultatSessionMode_ecart_check` ; total (`clo-p1-j`, `ORANGE_MONEY`) 500000 / 490000 / 10000 `TotalClotureMode_ecart_check` ; clôture forcée sans motif (PV de `str-pharma-1`, `jourIso(J - 1 jour)`) `ClotureJournaliere_forcage_check` ; seconde clôture du même PV à `jourIso(J)` `ClotureJournaliere_pointDeVenteId_jourMetier_key` ; ligne d'inventaire comptée -1 `LigneInventaire_quantiteComptee_check`, théorique 9 comptée 8 écart 2 `LigneInventaire_ecart_check` ; événement de synchronisation séquence 0 `EvenementSynchro_sequence_check` ; lot (`stk-03`, PV de `str-pharma-1`, 10 reçus, coût 0, coefficient 1, `dateReception` now()) avec `receptionId` 'rec-inconnue' `LotStock_receptionId_fkey` ; le même lot `lot-rec-1` avec `receptionId` 'rec-1' réussit.
9. `événement de synchronisation : seule la sortie de EN_ATTENTE vers APPLIQUE ou REJETE` : insérer `evs-1` (`evt-sync-1`, `poste-p1-w1`, séquence 1, type 'VENTE', 'usr-pharm-p1', EN_ATTENTE, empreinte 'abc', corps `'{"a":1}'`) ; `evs-x` (autre `evenementId`, même poste, séquence 1) `{ constraint: 'EvenementSynchro_posteId_sequence_key' }` ; `corps` changé avec `statut` APPLIQUE rejette `/seule la sortie de EN_ATTENTE/` ; `statut` APPLIQUE et `resultat` `'{"ok":true}'` : `rowCount` 1 ; `statut` REJETE ensuite rejette ; `DELETE` rejette `/ne peut pas être supprimé/` ; `DELETE` dans `BEGIN` + contournement a `rowCount` 1, `ROLLBACK` ; insérer `evs-2` (séquence 2, `utilisateurId` et `horodatageLocal` nuls, statut REJETE : événement illisible) réussit.
10. `retour arrière après activité : tables, fonctions et types de M5 retirés, réceptions des lots remises à nul` : écouteur `notice` (retiré à la fin) ; `appliquerRetourArriere(client, M5)` ; un NOTICE contient `supprimés 1 session(s) de caisse, 1 paiement(s), 1 clôture(s), 1 réception(s), 1 inventaire(s), 2 événement(s) de synchronisation` ; les 13 tables de M5 absentes (`to_regclass`) ; fonctions `session_caisse_proteger` et `evenement_synchro_proteger` absentes, `journal_refuser_modification` présente (`pg_proc`) ; types `StatutSession`, `MomentComptage`, `TypeMouvementCaisse`, `StatutEvenementSynchro` absents ; `LotStock.receptionId` de `lot-rec-1` nul ; contrainte `LotStock_receptionId_fkey` absente (`pg_constraint`) ; trigger `lot_stock_proteger` toujours actif (`SELECT "tgenabled" FROM pg_trigger WHERE "tgname" = 'lot_stock_proteger'` vaut `O`).
11. `retour arrière puis haut de nouveau` : `appliquerMigrations(client, { apres: M4, jusqua: M5 })` vaut `[M5]` ; 3 sessions techniques ; `LotStock_receptionId_fkey` présente.

Sous-`describe` `arrêt de M5` avec sa propre base (`beforeAll` : migrations jusqu'à FORMAT, jeu, migrations `apres: FORMAT, jusqua: M4` ; `afterAll` : suppression) :

12. `arrêt : point de vente sans poste REPRISE listé, rien est créé, puis M5 passe une fois corrigé` : `DELETE FROM "Poste" WHERE "code" = 'REPRISE' AND "pointDeVenteId" = <PV de str-pharma-3>` ; `appliquerMigrations(..., { apres: M4, jusqua: M5 })` rejette, message contenant `La migration ${M5} a échoué`, `1 point(s) de vente sans poste technique REPRISE` et `Points de vente en cause (50 au plus) : <PV de str-pharma-3>` ; `to_regclass('"SessionCaisse"')` nul ; aucun type `StatutSession` ; réinsérer le poste (`poste-reprise-p3`, code `REPRISE`, libellé `Reprise des ventes historiques`, type `TECHNIQUE`, `actif` faux) ; la migration vaut `[M5]`.

#### 16.6 `test/db/m6-ventes-pieces.db-spec.ts` (nouveau, `npm run test:db`)

Constantes `M1` à `M5`, `M6 = '20261026140000_pharmacie_t1_ventes_pieces'`. `beforeAll` : base, migrations jusqu'à FORMAT, jeu, `appliquees = await appliquerMigrations(base.client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M6 })`. Aides de la spec M5 plus `piece({ id, structureId, sessionId, posteId?, numero, numeroTicket?, total, typePiece?, venteOrigineId?, motif? })` : lit `pointDeVenteId` et `posteId` de la session (le `posteId` fourni remplace celui de la session), puis `INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece","venteOrigineId","motifAnnulation") VALUES ($1,$2,$3,$4,$5,$6,$7,'usr-pharm-p1','Mamadou Diallo',$8,$9::date,$10::"TypePieceVente",$11,$12)` (jour `jourIso(J)`, type par défaut `VENTE`) ; `ligne({ id, venteId, stockId, prix, quantite, sousTotal, unite, nombre, coefficient })` (`medicamentId` lu de la fiche, `nomMedicament` 'Harnais'). Tests dans cet ordre :

1. `M6 et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)`.
2. `toutes les ventes historiques ont un point de vente, un poste et une session (CA26)` : `appliquees` vaut `[M1, ..., M6]` ; `is_nullable` vaut `NO` pour `Vente.pointDeVenteId`, `Vente.posteId`, `Vente.sessionCaisseId`, `Vente.jourMetier`, `LigneVente.nombreAffiche` ; pour les 6 ventes : `pointDeVenteId` = `pv(structure)`, `posteId` = `posteReprise`, `sessionCaisseId` = `sessionTechnique`, `typePiece` VENTE, `venteOrigineId`, `numeroTicket`, `jourMetierOrigine`, `horodatageLocal`, `sequencePoste` nuls ; `to_char("jourMetier", 'YYYY-MM-DD')` = `jourIso(J)` pour `vte-p1-*`, `jourIso(J - 1 jour)` pour `vte-p2-*`.
3. `ventes historiques inchangées : statut, annulation, montants, lignes` : `vte-p1-3` ANNULEE, `annuleeParId` 'usr-admin-p1', motif 'Erreur de saisie', `annuleeLe` non nul ; `vte-p2-2` ANNULEE, motif 'Client parti sans payer' ; 7 lignes, chacune `nombreAffiche` = `quantite`, `coefficientApplique` 1, `uniteAffichee` BOITE, `sousTotal` = `prixUnitaire` x `quantite` ; `AllocationLot` et `Paiement` vides.
4. `ventes et lignes immuables, suppression sous contournement seulement` : `UPDATE "Vente" SET "statut" = 'ANNULEE' WHERE "id" = 'vte-p1-1'` et `UPDATE "Vente" SET "cleIdempotence" = NULL WHERE "id" = 'vte-p1-4'` et `DELETE FROM "Vente" WHERE "id" = 'vte-p1-1'` rejettent `/Écriture refusée sur la table Vente/` ; `UPDATE "LigneVente" SET "quantite" = 5 WHERE "id" = 'lv-01'` et son `DELETE` rejettent `/Écriture refusée sur la table LigneVente/` ; `TRUNCATE "Vente" CASCADE` rejette ; dans `BEGIN` + contournement, l'UPDATE rejette toujours, `ROLLBACK` ; dans `BEGIN` + contournement, `DELETE` des lignes de `vte-p1-4` puis de `vte-p1-4` ont `rowCount` 1 ; `ROLLBACK` ; `vte-p1-4` existe.
5. `clés étrangères des pièces en Restrict (O12, D430)` : `SELECT c."conname", c."confdeltype" FROM pg_constraint c JOIN pg_class t ON t."oid" = c."conrelid" WHERE c."contype" = 'f' AND t."relname" = ANY($1::text[])` avec les 16 tables `Vente`, `LigneVente`, `AllocationLot`, `SessionCaisse`, `ComptageCaisse`, `LigneComptage`, `ReleveModePaiement`, `MouvementCaisse`, `Paiement`, `ResultatSessionMode`, `ClotureJournaliere`, `TotalClotureMode`, `Reception`, `Inventaire`, `LigneInventaire`, `EvenementSynchro` : 33 lignes, toutes `confdeltype` = `r`, dont `Vente_structureId_fkey` et `LigneVente_venteId_fkey` ; `LotStock_receptionId_fkey` : `r` ; `DELETE FROM "Structure" WHERE "id" = 'str-pharma-2'` rejette avec `{ code: '23503' }`.
6. `nouvelle pièce : rattachement à la pharmacie, au poste et à la session (D520)` : postes et session comme la spec M5 (`poste-p1-w1`, `s-p1-1` OUVERTE) ; `piece` avec `structureId` 'str-pharma-2' sur `s-p1-1` rejette `/Vente refusée : le point de vente/` ; `piece` sur `s-p1-1` avec `posteId` = poste REPRISE de `str-pharma-1` rejette `/Vente refusée/` ; `vte-t1-1` (`str-pharma-1`, `s-p1-1`, 'T1-0000001', ticket 1, 3000) réussit ; `vte-t1-2` avec le ticket 1 : `{ constraint: 'Vente_pointDeVenteId_numeroTicket_key' }` ; lignes sur `vte-t1-1` : `stk-06`, prix 150, quantité 20, sous-total 3000, BOITE, nombre 2, coefficient 8 : `LigneVente_quantite_check` ; UNITE, nombre 2, coefficient 10, quantité 20 : `LigneVente_uniteAffichee_check` ; BOITE, nombre 0, coefficient 0, quantité 0 : `LigneVente_coefficientApplique_check` ; `lv-t1-1` BOITE, nombre 2, coefficient 10, quantité 20, sous-total 3000 : réussit.
7. `pièce d annulation : origine obligatoire, motif obligatoire, une seule par vente, même point de vente (D519)` : ANNULATION sans origine (motif 'Erreur') `Vente_venteOrigine_check` ; VENTE avec `venteOrigineId` 'vte-p1-1' `Vente_venteOrigine_check` ; ANNULATION de `vte-t1-1` sans motif puis avec motif '   ' `Vente_motifAnnulation_check` ; ANNULATION de `vte-p2-1` (autre point de vente) rejette `/pièce d'origine vte-p2-1 n'appartient pas/` ; `vte-a-1` (ANNULATION de `vte-t1-1`, 'A-T1-0000001', -3000, motif 'Client parti') réussit, avec la ligne `lv-a-1` (`stk-06`, 150, -20, -3000, BOITE, -2, 10) et le paiement `pai-a-1` (-3000, `ESPECES`, `s-p1-1`) ; seconde annulation de `vte-t1-1` : `{ constraint: 'Vente_venteOrigineId_key' }` ; `vte-a-2` (ANNULATION de `vte-p1-1`, 'A-V-2026-000001', -15000, motif 'Retour client') réussit ; `vte-r-1` (REGULARISATION sans origine, 'S1-W1-1', 1500) réussit.
8. `allocations : lot si et seulement si définitive, remplacement d une provisoire seulement (D519)` sur `lv-t1-1` : DEFINITIVE sans lot et PROVISOIRE avec lot `AllocationLot_lot_check` ; quantité 0 `AllocationLot_quantite_check` ; coût -1 `AllocationLot_coutUnitaire_check` ; sortie manuelle sans motif `AllocationLot_motif_check` ; REMPLACEE sans pièce `AllocationLot_remplacee_check` ; `al-1` (DEFINITIVE, `lotTechnique('stk-06')`, 12, coût 0, `lotTechnique` vrai) et `al-2` (PROVISOIRE, sans lot, 8) réussissent ; `al-1` quantité 11 rejette `/ne peut pas être modifiée/` ; `al-2` passée à REMPLACEE seule : `AllocationLot_remplacee_check` ; avec `remplaceeParPieceId` 'resolution-1' : `rowCount` 1 ; retour à PROVISOIRE rejette ; `DELETE` de `al-1` rejette `/ne peut pas être supprimée/` ; `TRUNCATE "AllocationLot"` rejette ; `DELETE` de `al-1` dans `BEGIN` + contournement a `rowCount` 1, `ROLLBACK`.
9. `retour arrière de M5 refusé tant que M6 est en place` : `appliquerRetourArriere(client, M5)` rejette, message contenant `appliquer d'abord le retour arrière de M6` ; `to_regclass('"SessionCaisse"')` non nul.
10. `retour arrière de M6 après activité : annulations reportées sur l origine, régularisation et ventes T conservées` : relever `createdAt` de `vte-a-1` et de `vte-a-2` ; écouteur `notice` ; `appliquerRetourArriere(client, M6)` ; un NOTICE contient `2 pièce(s) d'annulation` ; `vte-t1-1` : `statut` ANNULEE, `annuleeParId` 'usr-pharm-p1', `motifAnnulation` 'Client parti', `annuleeLe` = `createdAt` relevé de `vte-a-1` ; `vte-p1-1` : ANNULEE, motif 'Retour client', `annuleeLe` = `createdAt` de `vte-a-2` ; `vte-a-1`, `vte-a-2`, `lv-a-1`, `pai-a-1` absents ; `vte-r-1` présent (VALIDEE) ; table `AllocationLot` absente ; aucune des 10 colonnes ajoutées à `Vente` ni des 3 colonnes ajoutées à `LigneVente` (`information_schema.columns`) ; `confdeltype` = `c` pour `Vente_structureId_fkey` et `LigneVente_venteId_fkey` ; types `TypePieceVente`, `UniteVente`, `StatutAllocation` et fonctions `vente_verifier_rattachement`, `allocation_lot_proteger` absents ; dans `BEGIN`/`ROLLBACK`, `UPDATE "Vente" SET "clientNom" = 'x' WHERE "id" = 'vte-p1-2'` a `rowCount` 1.
11. `retour arrière de M5 puis haut de nouveau M5 et M6` : `appliquerRetourArriere(client, M5)` réussit ; `appliquerMigrations(client, { apres: M4, jusqua: M6 })` vaut `[M5, M6]` ; 3 sessions techniques, `s-p1-1` absente ; toutes les ventes ont point de vente, poste et session non nuls ; `vte-t1-1` et `vte-r-1` sont rattachées à la session technique de `str-pharma-1` (D521).

Sous-`describe` `arrêts de M6` avec sa propre base (`beforeAll` : FORMAT, jeu, `apres: FORMAT, jusqua: M5`) :

12. `arrêt : vente sans point de vente puis sans session technique listée, M6 passe une fois corrigée` : insérer la structure `str-pharma-sans-pv` (PHARMACIE, colonnes de la spec M4) et la vente `vte-sans-pv` (`numero` 'V-2026-000001', `vendeurId` 'usr-x', `vendeurNom` 'X', `total` 100) ; `appliquerMigrations(..., { apres: M5, jusqua: M6 })` rejette, message contenant `La migration ${M6} a échoué`, `1 vente(s) appartiennent à une structure sans point de vente` et `Ventes en cause (50 au plus) : vte-sans-pv` ; `to_regclass('"AllocationLot"')` nul et colonne `Vente.jourMetier` absente ; insérer `pv-sans-pv` (ordre 1, nom 'Sans PV') et le poste `poste-reprise-sans-pv` (REPRISE, TECHNIQUE, inactif) ; la migration rejette, message contenant `n'a pas de session technique de reprise` et `vte-sans-pv` ; appliquer par `appliquerSql` le bloc de reprise extrait de M5 ; la migration vaut `[M6]` ; `vte-sans-pv` a pour session la session technique de `pv-sans-pv`.

#### 16.7 `test/db/caisse-pieces.db-spec.ts` (nouveau, `npm run test:db`)

`beforeAll` : base, FORMAT, jeu, toutes les migrations, `prisma = creerPrismaDeTest(base)` ; `afterAll` : `fermerPrismaDeTest` puis `supprimerBaseDeTest` (modèle `points-de-vente.db-spec.ts`, fonction `refus` copiée). Tests dans cet ordre :

1. `structureAPieces : vrai pour une pharmacie qui a des ventes ou un journal, faux sinon` : insérer `str-pharma-4` et `str-pharma-5` (PHARMACIE, colonnes de la spec PB05) puis `prisma.$transaction((tx) => assurerPointDeVente(tx, { id, nom }))` pour chacune ; insérer pour `str-pharma-4` une session technique (`sess-tech-p4`, poste REPRISE, `technique` vrai, `statut` FERMEE, `fermeeLe` now(), `utilisateurNom` 'Reprise historique', `jourMetier` `jourIso(J)`, `evenementOuvertureId` 'reprise:' + PV) ; pour `str-pharma-5`, un poste WEB `poste-p5-w1` et une session OUVERTE `sess-p5` ; `structureAPieces` (dans `prisma.$transaction`) : `str-pharma-1` vrai, `str-pharma-3` vrai (lots de reprise, aucune vente), `str-hopital-1` faux, `str-pharma-4` faux, `str-pharma-5` vrai.
2. `suppression par le super administrateur : 409 STRUCTURE_AVEC_PIECES, rien n est supprimé` : `const superAdmin = new SuperAdminService(prisma, {} as never, {} as never)` ; compter les comptes de `str-pharma-1` ; `refus(superAdmin.deleteStructure('str-pharma-1'))` : statut 409, corps `toMatchObject({ code: 'STRUCTURE_AVEC_PIECES', message: 'Cette structure a des ventes ou des mouvements de stock : désactivez-la.' })` ; la structure existe, ses comptes sont toujours là (même nombre) ; même refus pour `str-pharma-5`.
3. `suppression d une pharmacie sans pièce : sa session technique part avec sa configuration` : `superAdmin.deleteStructure('str-pharma-4')` renvoie `success: true` ; zéro ligne pour `Structure` `str-pharma-4`, son `PointDeVente`, ses `Poste`, `SessionCaisse` (par l'id du PV relevé avant), `CompteurTicket`, `ParametresPharmacie`.
4. `stock:verifier contrôle les allocations des lignes de vente (D525)` : poste `poste-p1-w1` et session OUVERTE `sess-alloc` sur `str-pharma-1` ; vente `vte-alloc` ('T1-0009001', ticket 9001, total 4350) ; lignes `lv-alloc-a` (`stk-06`, 150, 20, 3000, UNITE, 20, 1), `lv-alloc-b` (`stk-03`, 150, 5, 750, UNITE, 5, 1), `lv-alloc-c` (`stk-06`, 150, 4, 600, UNITE, 4, 1) ; allocations : `lv-alloc-a` DEFINITIVE 12 (lot 'lot-copie-1') et DEFINITIVE 8 (lot 'lot-copie-2') ; `lv-alloc-b` DEFINITIVE 3 (lot 'lot-copie-1') ; `lv-alloc-c` DEFINITIVE 1 (lot 'lot-copie-1') et PROVISOIRE 3 (sans lot) ; `verifierStock(base.client)` : `allocations` vaut `{ nombre: 1, exemples: [{ ligneVenteId: 'lv-alloc-b', quantite: 5, alloue: 3 }] }`, `totalAnomalies` 1. Aucun paiement dans ce test.
5. `purge démo : pièces de caisse et de vente, journal de stock et configuration des seules structures données` : sur `str-pharma-2` : poste `poste-p2-w1`, session `s-p2-1` OUVERTE ; comptage `cpt-p2` (OUVERTURE, 50000) avec la ligne (20000, 2) et (10000, 1), relevé `ORANGE_MONEY` 0 ; mouvement de caisse APPORT 10000 motif 'Fond complémentaire' ; vente `vte-p2-t1` ('T1-0000001', ticket 1, 6000) avec ligne (`stk-26`, 1500, 4, 6000, BOITE, 4, 1), allocation DEFINITIVE (`lotTechnique('stk-26')`, 4) et paiement ESPECES 6000 ; annulation `vte-p2-a1` de `vte-p2-t1` (-6000, motif 'Erreur') avec ligne (`stk-26`, 1500, -4, -6000, BOITE, -4, 1) et paiement -6000 ; fermer `s-p2-1` (FERMEE, `fermeeLe` now(), `evenementFermetureId` 'ferm-s-p2-1') ; résultat ESPECES (60000, 60000, 0) ; clôture `clo-p2` (`jourIso(J)`) et total ESPECES (60000, 60000, 0) ; inclure `s-p2-1` dans `clo-p2` ; réception `rec-p2`, lot `lot-rec-p2` (`stk-26`, 10 reçus, coût 100, coefficient 1, date `jourIso(J + 400 jours)`, `receptionId` 'rec-p2') et mouvement `evt-rec-p2` RECEPTION pièce RECEPTION +10 sur ce lot ; anomalie `anom-p2` (PV de `str-pharma-2`, ECART_INVENTAIRE, `pieceType` 'INVENTAIRE', `details` `'{}'`) ; inventaire `inv-p2` et ligne (`stk-26`, `lot-rec-p2`, 10, 10, 0, vrai, `anomalieId` 'anom-p2') ; événement de synchronisation `evs-p2` (`poste-p2-w1`, séquence 1, APPLIQUE). Relever `avant1` = nombres de `Vente`, `LigneVente`, `AllocationLot` (par ligne de vente de `str-pharma-1`), `SessionCaisse`, `LotStock`, `MouvementStock`, `PointDeVente` de `str-pharma-1`. Puis `prisma.$transaction(async (tx) => { await purgerPiecesPharmacies(tx, ['str-pharma-2']); await purgerStockPharmacies(tx, ['str-pharma-2']); await supprimerConfigurationPharmacies(tx, ['str-pharma-2']); lire current_setting('medconnecte.purge_autorisee', true) par $queryRaw et l'attendre à 'off'; await tx.user.deleteMany({ where: { structureId: 'str-pharma-2' } }); await tx.structure.delete({ where: { id: 'str-pharma-2' } }); })` réussit (délai de transaction 30 s) ; ensuite : `Structure` `str-pharma-2` absente, aucune `Vente` de `str-pharma-2`, et zéro ligne dans `ComptageCaisse`, `LigneComptage`, `ReleveModePaiement`, `MouvementCaisse`, `Paiement`, `ResultatSessionMode`, `ClotureJournaliere`, `TotalClotureMode`, `Reception`, `Inventaire`, `LigneInventaire`, `EvenementSynchro`, `Anomalie` ; `avant1` inchangé pour `str-pharma-1`.
6. `purge démo : le contournement est retiré à la fin, une suppression de pièce suivante échoue et annule tout` : `prisma.$transaction(async (tx) => { await purgerPiecesPharmacies(tx, ['str-pharma-3']); await tx.vente.deleteMany({ where: { structureId: 'str-pharma-1' } }); })` rejette ; le nombre de ventes de `str-pharma-1` est inchangé et la session technique de `str-pharma-3` existe toujours.

#### 16.8 Tests existants

Aucune spec en base existante n'est modifiée. `non-regression-lectures.db-spec.ts` (instantanés `lister-ventes` et `detail-vente` sur les ventes historiques après M6), `schema-derive.db-spec.ts` (schéma de la section 1 contre toutes les migrations), `harnais.db-spec.ts`, `points-de-vente.db-spec.ts` (suppression d'une pharmacie sans pièce), `commandes-stock.db-spec.ts`, `mouvements-stock.db-spec.ts` doivent passer tels quels. `src/pharmacie/vente.service.spec.ts` passe tel quel.

### Cas limites (à couvrir tels quels, déjà dans le texte imposé)

- Vente historique à 23 h 30 UTC : jour métier = ce jour-là (`"createdAt"::date`, D518), jamais le lendemain.
- Pharmacie sans vente : session technique ouverte à l'instant de la migration ; la suppression de cette pharmacie reste possible.
- Annulation d'une annulation : impossible par l'unicité de `venteOrigineId` pour la même origine ; le refus métier `PIECE_NON_ANNULABLE` est de PB12.
- Pièce de régularisation : sans origine obligatoire ; conservée par le retour arrière de M6.
- Ligne d'annulation : quantité et nombre affiché négatifs, coefficient positif (CHECK de cohérence).
- Allocation provisoire : sans lot ; seule transition vers REMPLACEE avec la pièce de résolution.
- Retour de M5 sur une base avec réceptions : `LotStock.receptionId` remis à nul, sinon la remontée de M5 échouerait sur la clé étrangère (constat du chef).
- Après un retour arrière puis une remontée, les ventes faites entre-temps deviennent historiques (session technique), D521.
- `structureAPieces` ignore la session technique ; une session ouverte sans vente bloque la suppression.

### Liste fermée des fichiers

Créés : `prisma/migrations/20261026130000_pharmacie_t1_caisse/migration.sql`, `prisma/migrations/20261026140000_pharmacie_t1_ventes_pieces/migration.sql`, `prisma/retours-arriere/20261026130000_pharmacie_t1_caisse.down.sql`, `prisma/retours-arriere/20261026140000_pharmacie_t1_ventes_pieces.down.sql`, `src/pharmacie/caisse/purge-pieces.ts`, `src/pharmacie/caisse/purge-pieces.spec.ts`, `test/db/m5-caisse.db-spec.ts`, `test/db/m6-ventes-pieces.db-spec.ts`, `test/db/caisse-pieces.db-spec.ts`.
Modifiés : `prisma/schema.prisma`, `prisma/retours-arriere/README.md`, `src/common/filters/codes-erreur.ts`, `src/pharmacie/point-de-vente.ts`, `src/pharmacie/point-de-vente.spec.ts`, `src/super-admin/super-admin.service.ts`, `src/pharmacie/stock/purge-stock.ts`, `src/pharmacie/stock/purge-stock.spec.ts`, `src/demo/demo.seeder.ts`, `src/demo/demo.seeder.spec.ts`, `src/pharmacie/vente.service.ts`, `src/pharmacie/stock/commandes-stock.ts`, `scripts/stock-verifier.ts`, `CLAUDE.md`.
Rien d'autre : ni `super-admin.controller.ts`, ni `pharmacie.service.ts`, ni `test/db/instantanes/`, ni `test/db/non-regression-lectures.db-spec.ts`, ni les autres specs en base, ni `docs/plans/`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (français partout, aucun tiret cadratin ni demi-cadratin, aucun caractère points de suspension). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Textes du schéma (section 1) et SQL (sections 2 à 5) recopiés à l'identique. Jamais `prisma migrate dev`, `migrate reset` ni `db push` ; ne pas appliquer M5 ni M6 sur la base de développement (le chef s'en charge à la validation). Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env` (D454). Lint sur les seuls fichiers touchés. Si un point de cette fiche est impossible tel quel, s'arrêter en BLOCKED en citant la section.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx prisma generate` puis `docker compose exec -T backend npx prisma validate` : succès.
2. `docker compose exec -T backend npx tsc --noEmit` : code 0.
3. `docker compose exec -T backend npx eslint src/common/filters/codes-erreur.ts src/pharmacie/point-de-vente.ts src/pharmacie/point-de-vente.spec.ts src/super-admin/super-admin.service.ts src/pharmacie/caisse/purge-pieces.ts src/pharmacie/caisse/purge-pieces.spec.ts src/pharmacie/stock/purge-stock.ts src/pharmacie/stock/purge-stock.spec.ts src/demo/demo.seeder.ts src/demo/demo.seeder.spec.ts src/pharmacie/vente.service.ts src/pharmacie/stock/commandes-stock.ts scripts/stock-verifier.ts test/db/m5-caisse.db-spec.ts test/db/m6-ventes-pieces.db-spec.ts test/db/caisse-pieces.db-spec.ts` : code 0, aucun avertissement.
4. `docker compose exec -T backend npm test` : tout vert (suites existantes, dont `vente.service.spec.ts` inchangée, plus `purge-pieces.spec.ts` et les tests ajoutés).
5. `docker compose exec -T backend npm run test:db` : tout vert, dont `m5-caisse.db-spec.ts` (12 tests), `m6-ventes-pieces.db-spec.ts` (12 tests), `caisse-pieces.db-spec.ts` (6 tests), et, inchangés, `non-regression-lectures.db-spec.ts`, `schema-derive.db-spec.ts`, `points-de-vente.db-spec.ts`, `commandes-stock.db-spec.ts`, `m4-lots-mouvements.db-spec.ts`.
6. `git -C back_medconnect status --short test/db/instantanes test/db/non-regression-lectures.db-spec.ts` : vide.
7. Aucune base `mc_test_` restante : `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE '"'"'mc_test_%'"'"'"'` affiche 0.
8. Aucun tiret cadratin ni demi-cadratin ni points de suspension typographiques dans les fichiers créés ou modifiés (`git -C back_medconnect diff` et fichiers non suivis).

## Return

Chemin de chaque fichier créé ou modifié + preuve (commande lancée, résultat en une ligne, pour chaque point de « Done when »). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
