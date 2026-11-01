# PB18c - Synchro desktop (3/4) : rejeu des ventes

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; anomalies et messages lus par les vendeurs et le titulaire, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Troisième des quatre sous-fiches de PB18 (D630), après PB18a et PB18b (validées et commitées). Autonome, gate verte, commitée seule.

PB18c branche l'événement `VENTE` sur le moteur de PB18b :

- extraction de l'écriture d'une pièce de vente hors de `VenteService` (`ecrirePieceVente`, D657), partagée par la vente web (comportement inchangé) et le rejeu ;
- réallocation des lots par le serveur selon son état (D434, D652) : stock absent, provisoire et `STOCK_NEGATIF` ; il ne reste que du périmé, provisoire (jamais de périmé pris seul) ; ligne provisoire sur le poste mais stock présent au serveur, allocation définitive et anomalie ;
- anomalies d'application (`PRIX_DIVERGENT`, `VENTE_UNITE_INTERDITE`, `ORDONNANCE_NON_CONFIRMEE`, `PRODUIT_ARCHIVE`, `CONDITIONNEMENT_CONCURRENT`, D653, D654) ;
- numéros de ticket de plage, numéros de secours et numéro hors plage (D655) ;
- identifiants stables qui rendent tout double rejeu impossible (D656) ;
- tests : doublon, ordre inversé, stock négatif temporaire, résolution d'allocation provisoire, deux postes simultanés (CA23), rejeu double (CA25), négatif hors ligne (CA24).

Une vente sur une caisse d'un jour clôturé ou déjà fermée répond `A_RENVOYER` code `REGULARISATION_INDISPONIBLE` (rien d'écrit) : PB18d la régularise (D658).

Réalité du terrain : une vente faite hors ligne a eu lieu, le client est parti avec son médicament et son ticket. Le serveur n'en refuse jamais le fond ; il corrige les lots selon ce qu'il sait et signale au titulaire ce qui mérite un regard, sans jamais mettre de donnée du client dans une anomalie.

**Aucune migration, aucun changement de `prisma/schema.prisma`.** Constructeur de `SynchroService` inchangé.

Décisions applicables : D404, D409, D414, D423 à D425, D427, D434, D470, D473, D507, D519, D520, D535 à D541, D548, D560, D576, D577, D630, D639 à D641, D651 à D658, D660.

### Contexte vérifié (ne pas re-découvrir)

- `VenteService.enregistrerVente` (`src/pharmacie/vente.service.ts`, lignes 405 à 899) : étapes 13 (création `Vente` avec lignes et allocations DEFINITIVE puis PROVISOIRE, `auteurId` = vendeur), 14 (`paiement.createMany`), 15 (mouvements `VENTE` par allocation puis provisoire, `apresParFiche`), 16 (une anomalie `STOCK_NEGATIF` par ligne à reste provisoire, `details` `{ stockId, nom, quantiteProvisoire, soldeProduit, posteCode, utilisateurId, utilisateurNom, jourMetier }`, attribuée à `structure.adminId`), 17 (audit), 18 (stock bas), 19 (relecture).
- `allouerLignes(jour, lignes, lotsParFiche)` (`vente-regles.ts`) : lève `RangeError` si un lot de sortie manuelle est absent des candidats ; rend par ligne `allocations`, `resteProvisoire`, `lotsPerimesDisponibles`. `preparerPaiements(total, demandes, modes)` ; `formaterNumeroTicket(ordre, n)` ; `PaiementPrevu`.
- `lireLotsCandidats(tx, pointDeVenteId, ids)` (lots à solde positif, sous verrous) ; `MouvementsStockService.verrouillerFiches`, `ecrire(tx, { evenementId?, ..., horodatageLocal?, posteId?, sequencePoste? })`.
- `arrondiGnf`, `reliquatLot(solde, coefficientReception)` (`domaine/quantites.ts`) ; `estPerime(dateExpiration, jour)` (`domaine/selection-lots.ts`).
- `Vente` porte `horodatageLocal`, `sequencePoste`, `jourMetierOrigine`, `numeroTicket` (unique par point de vente) ; trigger `vente_verifier_rattachement` (session du même poste et du même point de vente). `LigneVente` CHECK `quantite = nombreAffiche x coefficientApplique`, UNITE implique coefficient 1.
- Résolution des provisoires (PB14b) : éligibles `VENTE` et `REGULARISATION` sans pièce liée.
- PB18b : `SynchroService.appliquer` (étape 4 : `VENTE` lève `ARenvoyerSynchro('SERVICE_INDISPONIBLE')`), `sessionDuPoste`, `validerCorps`, `RejetSynchro`, `ARenvoyerSynchro`, `MESSAGES_REJET`, `horodatageBorne`, contexte `{ structure, poste { id, code, libelle, pointDeVenteId, ordre }, ip, utilisateur(id) }`.
- PB18a : `PlageTicket`, `attribuerPlage`.
- `AnomaliesService.lister` calcule `rattachement` des `STOCK_NEGATIF` depuis `details.quantiteProvisoire` et les allocations PROVISOIRE restantes.
- `verifierStock(client)` (`src/pharmacie/stock/commandes-stock.ts`) renvoie un rapport avec `totalAnomalies`.

### 1. `src/pharmacie/ecriture-vente.ts` (nouveau, D657)

```ts
export interface LignePieceAEcrire {
  fiche: { id: string; medicamentId: string; nom: string };
  calcul: { prixAppliqueParUm: number; quantiteUm: number; montantLigne: number; uniteAffichee: 'BOITE' | 'UNITE'; nombreAffiche: number; coefficientApplique: number };
  allocation: LigneAllouee;
  /** Rejeu : clés ajoutées aux details de STOCK_NEGATIF. */
  detailsAnomalie?: Record<string, string | number | boolean | null>;
  /** Rejeu : STOCK_NEGATIF même sans reste provisoire (ligne provisoire sur le poste, D652). */
  anomalieMemeSansProvisoire?: boolean;
}
export interface PieceVenteAEcrire {
  id?: string; structureId: string; adminId: string | null; pointDeVenteId: string; posteId: string; posteCode: string; sessionId: string;
  typePiece: 'VENTE' | 'REGULARISATION'; numero: string; numeroTicket: number | null; jourMetier: Date; jourMetierOrigine?: Date | null;
  vendeur: { id: string; nom: string }; clientNom: string | null; clientTelephone: string | null; ordonnanceVerifiee: boolean; total: number;
  cleIdempotence: string | null; horodatageLocal?: Date | null; sequencePoste?: number | null;
  lignes: LignePieceAEcrire[]; paiements: PaiementPrevu[];
  /** Rejeu : evenementId stable de chaque mouvement (D656) ; sinon UUID serveur. */
  evenementIdMouvement?: (indexLigne: number, lotId: string | null) => string;
}
export async function ecrirePieceVente(tx: Prisma.TransactionClient, mouvementsStock: MouvementsStockService, p: PieceVenteAEcrire):
  Promise<{ venteId: string; apresParFiche: Map<string, number>; anomalies: { type: 'STOCK_NEGATIF'; id: string }[] }>
```

Corps = étapes 13 à 16 actuelles, à l'identique, plus : `id`, `typePiece`, `jourMetierOrigine`, `horodatageLocal`, `sequencePoste` sur la pièce ; `evenementId`, `horodatageLocal`, `sequencePoste` sur chaque mouvement ; anomalie aussi quand `anomalieMemeSansProvisoire` ; `details` = base actuelle puis `detailsAnomalie` ; `jourMetier` de l'anomalie = `dateVersJour(p.jourMetier)`. `enregistrerVente` remplace ses étapes 13 à 16 par un appel (`typePiece: 'VENTE'`, sans les options de rejeu) et garde les étapes 17 à 19. Aucun autre changement de `vente.service.ts` ; `vente.db-spec.ts`, `annulation.db-spec.ts`, `non-regression-lectures.db-spec.ts` et les instantanés restent verts sans modification.

### 2. DTO du corps de vente (`src/pharmacie/dto/synchro.dto.ts`, compléter)

```ts
export class SortieManuelleRejeuDto { @IsString() @IsNotEmpty() @MaxLength(64) lotId: string; @IsString() @Transform(rognerTexte) @Length(3, 300) motif: string; }
export class LigneVenteRejeuDto {
  @IsString() @IsNotEmpty() @MaxLength(64) stockId: string;
  @IsIn(['BOITE', 'UNITE']) unite: 'BOITE' | 'UNITE';
  @IsInt() @Min(1) @Max(10_000) nombre: number;
  @IsInt() @Min(0) @Max(2147483647) prixUnitaire: number;           // prix du ticket pour une boîte (BOITE) ou une unité (UNITE)
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) quantiteProvisoireLocale?: number; // unités non couvertes par un lot sur le poste
  @IsOptional() @IsBoolean() ouvertureConditionnement?: boolean;   // le poste a entamé une boîte pour cette ligne
  @IsOptional() @ValidateNested() @Type(() => SortieManuelleRejeuDto) sortieManuelle?: SortieManuelleRejeuDto;
}
export class PaiementRejeuDto {
  @IsString() @Matches(MOTIF_CODE_MODE) mode: string; @IsInt() @Min(1) @Max(2147483647) montant: number;
  @IsOptional() @IsString() @MaxLength(100) reference?: string; @IsOptional() @IsInt() @Min(0) @Max(2147483647) montantRecu?: number;
}
export class CorpsVenteDto {
  @IsUUID('all') venteId: string; @IsUUID('all') sessionId: string;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) numeroTicket?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) numeroSecours?: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => LigneVenteRejeuDto) lignes: LigneVenteRejeuDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PaiementRejeuDto) paiements: PaiementRejeuDto[];
  @IsInt() @Min(0) @Max(2147483647) total: number;
  @IsOptional() @IsString() @Transform(rognerTexte) @MaxLength(100) clientNom?: string;
  @IsOptional() @IsString() @Transform(rognerTexte) @MaxLength(30) clientTelephone?: string;
  @IsBoolean() ordonnanceVerifiee: boolean;
}
```

### 3. Règles pures (`src/pharmacie/synchro/rejeu-regles.ts`, compléter)

```ts
export function calculerLigneRejeu(e: { unite: 'BOITE' | 'UNITE'; nombre: number; prixTicket: number; coefficientBoite: number }):
  { prixAppliqueParUm; quantiteUm; montantLigne; uniteAffichee; nombreAffiche; coefficientApplique }
// BOITE : quantiteUm = nombre x coefficientBoite, coefficientApplique = coefficientBoite, prixAppliqueParUm = arrondiGnf(prixTicket / coefficientBoite)
// UNITE : quantiteUm = nombre, coefficientApplique = 1, prixAppliqueParUm = prixTicket ; montantLigne = nombre x prixTicket dans les deux cas
export function verifierCoherenceVente(c: CorpsVenteDto): { ok: true } | { ok: false; champs: string[] }
// exactement un de numeroTicket et numeroSecours, sinon ['numeroTicket'] ; total = somme nombre x prixUnitaire, sinon ['total']
export function numeroSecours(ordre: number, codePoste: string, n: number): string      // `S${ordre}-${codePoste}-${n}`
export function numeroHorsPlage(ordre: number, codePoste: string, sequence: number): string // `N${ordre}-${codePoste}-${sequence}`
export interface FicheRejeu { id: string; nom: string; prixUnitaire: number | null; prixUnite: number | null; deconditionnable: boolean; ordonnanceRequise: boolean; archive: boolean }
export function anomaliesApplication(lignes: { fiche: FicheRejeu; unite: 'BOITE' | 'UNITE'; prixTicket: number }[], ordonnanceVerifiee: boolean): {
  prixDivergents: { stockId; nom; unite; prixTicket; prixFiche: number | null }[];   // prix fiche de l'unité vendue (boîte : prixUnitaire, unité : prixUnite) nul ou différent ; jamais pour une ligne à l'unité interdite (D666)
  uniteInterdite: { stockId; nom }[];                                                  // UNITE sur fiche non déconditionnable
  ordonnance: { stockId; nom }[];                                                      // ordonnanceRequise et ordonnanceVerifiee faux
  archives: { stockId; nom }[];
}  // une entrée par fiche et par cause (dédoublonnée), dans l'ordre des lignes
```

### 4. Gestionnaire `VENTE` (`SynchroService`)

Dans `appliquer`, la ligne `VENTE` devient : `validerCorps(CorpsVenteDto, corps)` (échec : `EVENEMENT_INVALIDE` avec `champs`) puis `appliquerVente(tx, ctx, e, corps, utilisateur, local, borne)` :

1. `s = sessionDuPoste(tx, ctx, corps.sessionId)` (verrou de la caisse, après le poste : D639).
2. `jourCaisse = dateVersJour(s.jourMetier)` ; si `s.statut !== 'OUVERTE'` ou `estJourCloture(tx, pv, jourCaisse)` : `throw new ARenvoyerSynchro('REGULARISATION_INDISPONIBLE')` (remplacé en PB18d).
3. `tx.vente.findUnique({ where: { id: corps.venteId }, select: { id: true } })` présente : `RejetSynchro('IDENTIFIANT_DEJA_UTILISE')`.
4. `verifierCoherenceVente` en échec : `RejetSynchro('EVENEMENT_INVALIDE', { champs })`.
5. `prepares = preparerPaiements(corps.total, corps.paiements, await tx.modePaiement.findMany())` (tous les modes, actifs ou non) ; échec : `EVENEMENT_INVALIDE` champ `paiements`.
6. `ids` = fiches distinctes des lignes ; `await this.mouvementsStock.verrouillerFiches(tx, ids)` ; puis fiches `tx.stockMedicament.findMany({ where: { id: { in: ids }, structureId }, include: { medicament: { select: { id, nom, ordonnanceRequise } } } })` (archivées comprises, lues après les verrous : coefficient à jour, D560) ; une absente : `RejetSynchro('STOCK_INTROUVABLE')`.
7. `jourVente = jourConakry(borne)` ; `lotsParFiche = lireLotsCandidats(tx, pv, ids)`.
8. Lignes : `calcul = calculerLigneRejeu({ unite, nombre, prixTicket: prixUnitaire, coefficientBoite: fiche.coefficientBoite })` ; sortie manuelle gardée seulement si `lotId` figure parmi les candidats de la fiche (sinon ignorée : allocation automatique).
9. `CONDITIONNEMENT_CONCURRENT` (D654), avant l'allocation : lignes `UNITE` avec `ouvertureConditionnement` vrai dont un candidat non périmé au `jourVente` (`dateExpiration` nulle ou `!estPerime`) a `reliquatLot(solde, coefficientReception) > 0` ; liste `{ stockId, nom }` dédoublonnée.
10. `allouees = allouerLignes(jourVente, lignes, lotsParFiche)` (le reste non couvert est toujours provisoire, `lotsPerimesDisponibles` n'est qu'informatif).
11. Numéro (D655) :
    - `numeroTicket` n : plage `tx.plageTicket.findFirst({ where: { posteId, debut: { lte: n }, fin: { gte: n } } })` et pièce `tx.vente.findFirst({ where: { pointDeVenteId, numeroTicket: n }, select: { id } })` ; plage trouvée et numéro libre : `numero = formaterNumeroTicket(ordre, n)`, `numeroTicket = n` ; sinon `numero = numeroHorsPlage(ordre, posteCode, sequence)`, `numeroTicket = null`, `horsPlage = { numeroImprime: formaterNumeroTicket(ordre, n) }` ;
    - `numeroSecours` m : `numero = numeroSecours(ordre, posteCode, m)` ; déjà pris dans la pharmacie (`findFirst({ where: { structureId, numero } })`) : numéro hors plage comme ci-dessus avec `numeroImprime` = ce numéro de secours ; sinon `secours = true`.
12. `ecrirePieceVente(tx, this.mouvementsStock, { id: corps.venteId, structureId, adminId, pointDeVenteId: s.pointDeVenteId, posteId, posteCode, sessionId: s.id, typePiece: 'VENTE', numero, numeroTicket, jourMetier: s.jourMetier, jourMetierOrigine: null, vendeur: { id: utilisateurId, nom }, clientNom, clientTelephone, ordonnanceVerifiee, total, cleIdempotence: null, horodatageLocal: local, sequencePoste: sequence, lignes, paiements: prepares.paiements, evenementIdMouvement: (i, lotId) => `synchro:${evenementId}:${i}:${lotId ?? 'provisoire'}` })` avec, par ligne, `detailsAnomalie: { origine: 'SYNCHRO', quantiteProvisoireLocale: q ?? 0, perimesDisponibles: allouee.lotsPerimesDisponibles.length, evenementId }` et `anomalieMemeSansProvisoire: (q ?? 0) > 0` (D652).
13. Anomalies d'application (D653), au titulaire, pièce `VENTE`, `pieceId` = `venteId`, une par type non vide, `details` = `{ numero, posteCode, utilisateurId, utilisateurNom, jourMetier, horodatageLocal (ISO), lignes, message }` :
    - `PRIX_DIVERGENT` (lignes `prixDivergents`) : « La vente <numero> a été faite sur le poste à un prix différent du prix enregistré pour N médicament(s) : le prix du ticket a été gardé. Vérifiez les prix de ces fiches. »
    - `VENTE_UNITE_INTERDITE` : « La vente <numero> contient un médicament vendu à l'unité alors que sa fiche ne le permet pas. »
    - `ORDONNANCE_NON_CONFIRMEE` : « La vente <numero> contient un médicament sur ordonnance sans que l'ordonnance ait été confirmée. »
    - `PRODUIT_ARCHIVE` : « La vente <numero> contient un médicament retiré du stock (archivé) : vérifiez sa fiche. »
    - `CONDITIONNEMENT_CONCURRENT` : « Pour la vente <numero>, le poste a entamé une nouvelle boîte alors qu'une boîte entamée existait déjà : comptez les boîtes ouvertes de ce médicament. »
    - `PLAGE_EPUISEE` : numéro de secours : créée seulement si aucune `PLAGE_EPUISEE` OUVERTE n'existe avec `pieceType` `Poste` et `pieceId` = poste, `details { raison: 'PLAGE_EPUISEE', posteCode, numero, jourMetier, message }`, message « Le poste <libellé> n'avait plus de numéros de tickets réservés : il a utilisé des numéros de secours (<numero>). Connectez-le pour qu'il recharge ses numéros. » ; hors plage : toujours, pièce `VENTE`, `details { raison: 'NUMERO_HORS_PLAGE', posteCode, numeroImprime, numero, message }`, message « Le ticket <numeroImprime> du poste <libellé> porte un numéro qui ne lui était pas réservé : la vente est enregistrée sous le numéro <numero>. »
14. Audit `{ userId: utilisateurId, action: 'create', entityType: 'Vente', entityId: venteId, ip: ctx.ip ?? null, metadata: { numero, total, nombreLignes, provisoire, origine: 'synchro', posteCode, sequence } }`. Aucune notification de stock bas.
15. Résultat `{ piece: { type: 'VENTE', id: venteId, numero }, anomalies: [toutes celles créées, STOCK_NEGATIF compris] }`.

### 5. CLAUDE.md du back (compléter la puce PB18)

« Événement `VENTE` `{ venteId, sessionId, numeroTicket ou numeroSecours, lignes [{ stockId, unite, nombre, prixUnitaire, quantiteProvisoireLocale?, ouvertureConditionnement?, sortieManuelle? }], paiements, total, clientNom?, clientTelephone?, ordonnanceVerifiee }` : le serveur réalloue les lots au jour local de la vente (prix du ticket gardé, coefficient actuel pour une boîte, jamais de lot périmé pris automatiquement, reste provisoire avec `STOCK_NEGATIF`, aussi quand la ligne était provisoire sur le poste) ; anomalies `PRIX_DIVERGENT`, `VENTE_UNITE_INTERDITE`, `ORDONNANCE_NON_CONFIRMEE`, `PRODUIT_ARCHIVE`, `CONDITIONNEMENT_CONCURRENT`, `PLAGE_EPUISEE` au titulaire, jamais de refus de fond ; numéro de plage `T<ordre>-NNNNNNN`, de secours `S<ordre>-<poste>-<n>`, hors plage `N<ordre>-<poste>-<séquence>` ; `Vente.id` = `venteId`, mouvements `synchro:<evenementId>:<ligne>:<lot ou provisoire>` (aucun double rejeu possible) ; incohérence interne (total, paiements, numéros) : `EVENEMENT_INVALIDE` ; fiche inconnue : `STOCK_INTROUVABLE`. L'écriture d'une pièce est partagée avec la vente web (`ecrirePieceVente`, D657). »

### 6. Tests

`src/pharmacie/synchro/rejeu-regles.spec.ts` (compléter) :
1. `calculerLigneRejeu` : boîte de 10 à 1 200 : quantité 10, prix par unité 120, montant 1 200 ; 3 unités à 150 : quantité 3, coefficient 1, montant 450 ; boîte de 3 à 1 000 : prix par unité 333.
2. `verifierCoherenceVente` : deux numéros, aucun numéro, total faux, cas juste.
3. `numeroSecours`, `numeroHorsPlage` : formats.
4. `anomaliesApplication` : prix boîte différent, prix unité nul, unité interdite (sans prix divergent, D666 ; le prix reste contrôlé sur une ligne à la boîte de la même fiche), ordonnance, archivée, dédoublonnage d'une fiche sur deux lignes.

`test/db/synchro-ventes.db-spec.ts` (nouveau ; préparation calquée sur `synchro-caisse.db-spec.ts` plus `VenteService`, `ReceptionsService`, `SortiesStockService` si utile ; postes desktop `D1` (`desktop-pb18c-1`) et `D2` (`desktop-pb18c-2`) avec une plage chacun par `postes.attribuerPlage` ; fiches créées par `nouvelleFiche` et lots par réception : F (coefficient 1, prix 1 000, 10 boîtes), G (coefficient 10, déconditionnable, prix boîte 1 200, prix unité 150, 3 boîtes), O (sur ordonnance, prix 500, 10 boîtes) ; aides `ouvrir(poste, seq, sessionId, utilisateur)`, `vendre(seq, sessionId, lignes, { numeroTicket | numeroSecours, ordonnanceVerifiee = true, poste })` qui construit un corps cohérent (paiement espèces du total) et prend le numéro suivant de la plage du poste ; les tests s'exécutent dans l'ordre) :
1. « vente du poste rejouée » : D1 ouvre S1 (séq. 1), vend 2 boîtes de F (séq. 2) : `APPLIQUE` ; pièce d'id `venteId`, numéro `T1-<début de la plage>`, `numeroTicket`, type `VENTE`, `jourMetier` de S1, `horodatageLocal`, `sequencePoste` 2, `vendeurId` VENDEUR, `cleIdempotence` nulle ; ligne quantité 2, sous-total 2 000 ; une allocation DEFINITIVE de 2 sur le lot de F ; paiement 2 000 dans S1 ; mouvement `synchro:<evenementId>:0:<lot>` avec `posteId` et `sequencePoste` ; lot de F à 8 ; audit `origine: 'synchro'` ; aucune anomalie.
2. « doublon : le même journal rejoué ne crée rien » (CA25) : séquences 1 et 2 renvoyées : `DEJA_APPLIQUE` avec la même `piece` ; nombres de `Vente`, `LigneVente`, `AllocationLot`, `Paiement`, `MouvementStock` (pièce = cette vente) et `AuditLog` inchangés ; lot de F toujours 8.
3. « CA25 : deux envois simultanés du même journal » : séquences 3 et 4 (deux ventes de F d'une boîte) envoyées deux fois en `Promise.all` : pour chaque événement un `APPLIQUE` et un `DEJA_APPLIQUE` ; exactement un mouvement par vente ; lot de F à 6.
4. « ordre inversé » : séquences 7 puis 6 (ventes d'une boîte de F) : `EN_ATTENTE`, aucune pièce ; puis 5 (vente d'une boîte) : 5 `APPLIQUE`, 6 et 7 `APPLIQUE` `differe` ; trois pièces, numéros dans l'ordre des séquences ; lot de F à 3.
5. « stock négatif temporaire, puis rattachement par une réception » (CA24 côté serveur) : fiche H à 1 boîte ; D1 vend 3 boîtes avec `quantiteProvisoireLocale` 2 : allocation DEFINITIVE 1 et PROVISOIRE 2 ; mouvement du lot -1 et mouvement sans lot -2 ; agrégat produit de H à -2 ; anomalie `STOCK_NEGATIF` au titulaire avec `quantiteProvisoire` 2, `quantiteProvisoireLocale` 2, `origine` `SYNCHRO`, `posteCode` ; puis réception de 5 boîtes de H : l'allocation provisoire passe REMPLACEE, une DEFINITIVE de 2 sur le nouveau lot ; agrégat produit de H à 3 ; `AnomaliesService.lister` donne `rattachement.etat` `RATTACHEE` pour cette anomalie.
6. « résolution d'allocation provisoire à la synchro » : fiche K réceptionnée (5 boîtes) après la photographie du poste ; D1 vend 2 boîtes avec `quantiteProvisoireLocale` 2 : allocation DEFINITIVE 2, aucune PROVISOIRE ; anomalie `STOCK_NEGATIF` avec `quantiteProvisoire` 0 et `quantiteProvisoireLocale` 2 ; `rattachement.etat` `RATTACHEE`.
7. « il ne reste que du périmé » : fiche P dont l'unique lot (2 boîtes) a sa date corrigée à J-2 ; vente d'une boîte : PROVISOIRE 1, lot périmé inchangé, `STOCK_NEGATIF` avec `perimesDisponibles` 1 ; vente d'une boîte avec `sortieManuelle { lotId: lot périmé, motif: 'Dernière boîte, client prévenu' }` : DEFINITIVE sur le lot périmé, `sortieManuelle` vrai, motif copié sur l'allocation et le mouvement ; vente avec une sortie manuelle sur un lot inconnu : allocation automatique (provisoire), aucun refus.
8. « CA23 : deux postes hors ligne vendent en même temps » : fiche F2 à 10 boîtes ; D1 (VENDEUR) : ouverture et 4 ventes de 2 boîtes (numéros de sa plage) ; D2 (RESPONSABLE) : ouverture et 3 ventes de 2 boîtes (numéros de sa plage) ; une vente web d'une boîte de F3 par `service.creerVente` lancée dans le même `Promise.all` : tout aboutit ; 7 pièces de F2 aux numéros tous différents, chacun dans la plage de son poste ; numéro de la vente web hors de toute plage ; somme des quantités 14 ; agrégat produit de F2 à -4 ; lot à 0 ; somme des PROVISOIRE 4 ; somme des `quantiteProvisoire` des `STOCK_NEGATIF` de F2 égale à 4 ; `verifierStock(base.client)` sans anomalie.
9. « prix du ticket gardé et anomalies d'application » : F vendue à 900 au lieu de 1 000 : sous-total au prix du ticket, `PRIX_DIVERGENT` avec `lignes[0]` `{ prixTicket: 900, prixFiche: 1000 }` ; F vendue à l'unité (fiche non déconditionnable) : appliquée (coefficient 1), `VENTE_UNITE_INTERDITE` et aucune `PRIX_DIVERGENT` (D666) ; O avec `ordonnanceVerifiee` faux : `ORDONNANCE_NON_CONFIRMEE` ; fiche archivée après la vente sur le poste : appliquée, stock diminué, `PRODUIT_ARCHIVE` ; aucune anomalie ne contient `clientNom` ni `clientTelephone` (vente envoyée avec un nom et un téléphone de client).
10. « boîte au coefficient du serveur » : G vendue 1 boîte à 1 200 : quantité 10, prix par unité 120, coefficient 10 ; 3 unités à 150 : quantité 3.
11. « deux boîtes entamées » : après le test 10 (une boîte entamée de G au serveur), D2 vend 2 unités de G avec `ouvertureConditionnement` vrai : `CONDITIONNEMENT_CONCURRENT` ; un seul `ConditionnementOuvert` ouvert pour G.
12. « numéros de secours et hors plage » : `numeroSecours` 1 sur D1 : numéro `S1-<code de D1>-1`, `numeroTicket` nul, une `PLAGE_EPUISEE` OUVERTE pièce `Poste` ; `numeroSecours` 2 : aucune nouvelle `PLAGE_EPUISEE` ; D1 envoie un numéro de la plage de D2 : numéro `N1-<code de D1>-<séquence>`, `numeroTicket` nul, `PLAGE_EPUISEE` raison `NUMERO_HORS_PLAGE` avec `numeroImprime` ; un numéro déjà pris : même traitement.
13. « ventes mises de côté sans bloquer le poste » : fiche inconnue : `REJETE` `STOCK_INTROUVABLE`, ligne REJETE avec son corps, anomalie `EVENEMENT_REJETE` sans `clientNom` ni `clientTelephone` dans ses `details`, séquence avancée ; total faux : `EVENEMENT_INVALIDE` champ `total` ; paiements dont la somme diffère : `EVENEMENT_INVALIDE` champ `paiements` ; deux numéros : `EVENEMENT_INVALIDE` ; `venteId` d'une pièce existante : `IDENTIFIANT_DEJA_UTILISE` ; caisse inconnue : `SESSION_INCONNUE` ; la vente valide qui suit est `APPLIQUE`.
14. « caisse fermée : renvoyée plus tard » : D1 ferme S1 par événement, puis vend sur S1 : `A_RENVOYER` code `REGULARISATION_INDISPONIBLE`, aucune ligne de synchro ni pièce, séquence inchangée (PB18d remplacera ce test).
15. « vente web pendant le rejeu, sans interblocage » : trois fois de suite, `Promise.allSettled` d'un lot de D2 (une vente de F4) et d'une vente web de F4 : tout est `fulfilled`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin. Aucun journal ni aucune anomalie ne contient un nom ou un téléphone de client.

Fichiers autorisés (et seulement eux) : `src/pharmacie/ecriture-vente.ts`, `src/pharmacie/vente.service.ts`, `src/pharmacie/dto/synchro.dto.ts`, `src/pharmacie/synchro/rejeu-regles.ts`, `src/pharmacie/synchro/rejeu-regles.spec.ts`, `src/pharmacie/synchro/synchro.service.ts`, `test/db/synchro-ventes.db-spec.ts`, `test/db/synchro-caisse.db-spec.ts` (test 14 seulement), `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint` sur les fichiers `.ts` autorisés : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `synchro-ventes` (15), `synchro-caisse` (son test 14 est réécrit, seul changement du fichier : titre « vente sur une caisse fermée : renvoyée plus tard », lot `[VENTE sur S1 (fermée au test 2, corps conforme à `CorpsVenteDto` avec un `stockId` quelconque : la caisse est examinée avant les fiches), MOUVEMENT_CAISSE sur S1]`, deux `A_RENVOYER`, le premier avec le code `REGULARISATION_INDISPONIBLE`, le second `SERVICE_INDISPONIBLE`, aucune ligne de synchro, séquence inchangée, `dernierEtat.fileVide` faux), `vente`, `annulation`, `non-regression-lectures`, `journee-cloturee`, `etancheite-couts` verts et inchangés.
5. `git status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes test/db/vente.db-spec.ts test/db/annulation.db-spec.ts` vide.
6. `grep -n "clientNom\|clientTelephone" src/pharmacie/synchro/` : seulement dans le DTO, `resumeEvenement` (exclusion) et le passage à `ecrirePieceVente`.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | dur (codeur Sonnet, vérificateur Sonnet) | PASS, validé par le chef (rapports/PB18c-verification.md, rapports/PB18c-chef.md) | code conforme ; extraction `ecrirePieceVente` identique pour la vente web ; `sed -i` du codeur sur `vente.service.ts` relu, diff propre ; une seule anomalie pour une vente à l'unité interdite (D666)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | 0 erreur | voir commit
docker compose exec -T backend npx eslint (8 fichiers .ts touchés) | 0 erreur | voir commit
docker compose exec -T backend npm test | 99 suites, 1093 réussis, 3 ignorés, 0 échec | voir commit
docker compose exec -T backend npm run test:db | 33 suites, 392 réussis, 0 échec | voir commit
docker compose restart backend | « Nest application successfully started », 0 erreur de compilation | voir commit
