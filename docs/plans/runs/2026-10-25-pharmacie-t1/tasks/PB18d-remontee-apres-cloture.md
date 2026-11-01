# PB18d - Synchro desktop (4/4) : vente remontée après une clôture ou une fermeture (CA21 seconde moitié)

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; anomalies lues par les vendeurs et le titulaire, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Dernière des quatre sous-fiches de PB18 (D630), après PB18a, PB18b, PB18c (validées et commitées). Autonome, gate verte, commitée seule.

Une vente faite sur le poste desktop dont la caisse appartient à une journée déjà clôturée (clôture forcée sans ce poste) ou dont la caisse a été fermée entre-temps devient une pièce de **régularisation** (D659, révise D625 point 3) :

- pièce `REGULARISATION` sur la caisse d'origine (là où est l'argent, paiements compris), rattachée à la journée en cours (`jourMetier` = jour de rattachement de D615), `jourMetierOrigine` = jour de la caisse, `venteOrigineId` nul, numéro du ticket (D655) ;
- anomalie `REMONTEE_APRES_CLOTURE` nominative, attribuée au vendeur de la caisse ;
- la journée clôturée ne bouge pas : ses pièces, ses caisses incluses, ses totaux et son export restent identiques (CA21 seconde moitié, DEMANDE : « sans toucher la journée verrouillée »).

Ce cas répondait `A_RENVOYER` `REGULARISATION_INDISPONIBLE` en PB18c (D658) : PB18d le remplace.

Réalité du terrain : un soir de coupure, le titulaire clôture sans le poste du comptoir ; le lendemain le poste revient avec les ventes de la veille. Rien n'est perdu, la veille reste telle qu'elle a été clôturée, la journée en cours porte les ventes remontées, et le titulaire est prévenu nommément.

**Aucune migration, aucun changement de `prisma/schema.prisma`.**

Décisions applicables : D435, D519, D520, D545, D550, D551, D613 à D622, D625, D630, D639, D655 à D660.

### Contexte vérifié (ne pas re-découvrir)

- `SynchroService.appliquerVente` (PB18c), étape 2 : `if (s.statut !== 'OUVERTE' || await estJourCloture(...)) throw new ARenvoyerSynchro('REGULARISATION_INDISPONIBLE')`.
- `ecrirePieceVente` accepte `typePiece: 'REGULARISATION'` et `jourMetierOrigine` ; trigger `vente_verifier_rattachement` : la caisse doit être du même poste et du même point de vente (la caisse d'origine l'est), aucun contrôle du statut ni du jour de la caisse ; CHECK `Vente_venteOrigine_check` : une REGULARISATION peut avoir `venteOrigineId` nul.
- `jourDeRattachement(tx, pointDeVenteId, maintenant)` (`journee.ts`) renvoie `{ jour, jourReel }` ; `ClotureJournaliere { id, pointDeVenteId, jourMetier, forcee, postesManquants Json [{ posteId, posteCode, libelle, type, raison, sessionId, utilisateurNom, dernierContactLe }] }`.
- Annulation : une pièce `REGULARISATION` répond 409 `PIECE_NON_ANNULABLE` (D545, existant).
- Liste des ventes par jour métier, `totalJour` signé (D551) ; bilan de caisse : `nombreVentes` compte VENTE et REGULARISATION (D531).
- Export de clôture (`export-cloture.ts`) : une ligne par pièce du jour métier puis ses paiements ; colonne « Caisse incluse dans la clôture » = `Oui` ou `Non` selon la caisse de la pièce ; libellé de type de pièce pour la régularisation déjà prévu.
- Clôture : sessions FERMEE du jour métier passées INCLUSES ; une caisse d'un jour clôturé fermée par le rejeu reste FERMEE (PB18b, D649).
- Test 14 de `test/db/synchro-ventes.db-spec.ts` (PB18c) attend `A_RENVOYER` `REGULARISATION_INDISPONIBLE` ; test 14 de `test/db/synchro-caisse.db-spec.ts` (réécrit en PB18c) aussi.

### 1. `SynchroService.appliquerVente`

Remplacer l'étape 2 :

```ts
const jourCaisse = dateVersJour(s.jourMetier);
const clos = await estJourCloture(tx, s.pointDeVenteId, jourCaisse);
const regularisation = s.statut !== 'OUVERTE' || clos;
let jourMetier = s.jourMetier;
let jourMetierOrigine: Date | null = null;
if (regularisation) {
  const { jour } = await jourDeRattachement(tx, s.pointDeVenteId, new Date()); // sous le verrou de journée partagé (D613)
  jourMetier = jourVersDate(jour);
  jourMetierOrigine = s.jourMetier;
}
```

Puis, sans autre changement des étapes 3 à 11 : `ecrirePieceVente` reçoit `typePiece: regularisation ? 'REGULARISATION' : 'VENTE'`, `jourMetier`, `jourMetierOrigine`, `sessionId: s.id` (la caisse d'origine, même FERMEE ou INCLUSE) ; les paiements vont dans cette caisse. Le `jourMetier` des anomalies d'application et de `STOCK_NEGATIF` est celui de la pièce.

Après les anomalies d'application, si `regularisation` :

- `raison` = `clos ? 'JOURNEE_CLOTUREE' : 'CAISSE_FERMEE'` ;
- `cloture` = `clos ? tx.clotureJournaliere.findUnique({ where: { pointDeVenteId_jourMetier: { pointDeVenteId, jourMetier: s.jourMetier } } }) : null` ;
- `posteManquantDeLaCloture` = vrai si un élément de `cloture.postesManquants` a `sessionId === s.id` (faux sans clôture) ;
- anomalie `REMONTEE_APRES_CLOTURE`, `attribueeAId` = `s.utilisateurId ?? structure.adminId` (vendeur de la caisse), pièce `VENTE`, `pieceId` = `venteId`, `details { raison, clotureId (ou null), jourOrigine: jourCaisse, jourRattachement, posteManquantDeLaCloture, numero, total, posteCode, sessionId: s.id, utilisateurId (vendeur de l'événement), utilisateurNom, horodatageLocal (ISO), message }` ;
- messages : `JOURNEE_CLOTUREE` : « La vente <numero> du <jourLisible(jourCaisse)> est arrivée après la clôture de cette journée : elle est enregistrée sur la journée du <jourLisible(jourRattachement)> (régularisation). La journée clôturée n'a pas changé. » ; `CAISSE_FERMEE` : « La vente <numero> est arrivée après la fermeture de sa caisse (caisse de <s.utilisateurNom>) : elle est enregistrée sur la journée du <jourLisible(jourRattachement)> (régularisation). Vérifiez l'argent de cette caisse. »

Résultat : `piece { type: regularisation ? 'REGULARISATION' : 'VENTE', id, numero }` ; audit `metadata` gagne `typePiece`. Le code `REGULARISATION_INDISPONIBLE` reste dans `CodeARenvoyer` et `MESSAGES_REJET` mais n'est plus levé (code stable, précédent D542).

### 2. Tests existants à adapter (seuls changements de ces fichiers)

- `test/db/synchro-ventes.db-spec.ts`, test 14 : renommé « vente sur une caisse fermée : régularisation » ; la vente sur S1 fermée est `APPLIQUE`, `piece.type` `REGULARISATION`, pièce `jourMetier` aujourd'hui, `jourMetierOrigine` = jour de S1, `sessionCaisseId` S1, anomalie `REMONTEE_APRES_CLOTURE` raison `CAISSE_FERMEE` attribuée à VENDEUR.
- `test/db/synchro-caisse.db-spec.ts`, test 14 : renommé « vente sur une caisse fermée : régularisée, jamais renvoyée » ; la caisse fermée n'arrête plus l'examen de la vente, et ce fichier n'a aucune fiche : la vente est `REJETE` `STOCK_INTROUVABLE` (ligne REJETE stockée, séquence avancée) ; le mouvement sur S1 fermée est `REJETE` `SESSION_FERMEE` ; aucun `A_RENVOYER`, `dernierEtat.fileVide` vrai.

### 3. `test/db/synchro-remontee.db-spec.ts` (nouveau, 7 tests, dans l'ordre)

Préparation calquée sur `synchro-ventes.db-spec.ts` (services, `ClotureService`, `VenteService` pour l'annulation et la liste, `SessionsCaisseService`) ; `debutCaisse` reculé de 30 jours ; poste desktop D (`desktop-pb18d`) avec une plage ; fiche F (coefficient 1, prix 1 000) à 50 boîtes ; `hier = jour(-1)`, horodatages locaux `hier` 18:00, 18:05, 20:00, 21:30, 22:00 (UTC, Conakry à UTC+0). Aide `etatJour(j)` = `{ pieces: ids des Vente du point de vente de jourMetier j triés, sessions: (id, statut, clotureJournaliereId) des sessions de jourMetier j triées, cloture: ligne ClotureJournaliere de j (id, forcee, postesManquants), totaux: lignes TotalClotureMode de cette clôture triées, export: texte de clotures.exporter(j).contenu }` (`export` seulement si j est clôturé).

1. « avant la clôture, la caisse du poste compte pour sa journée » : D envoie séq. 1 `SESSION_OUVERTE` S (hier 18:00) et séq. 2 `VENTE` de 2 boîtes (hier 18:05) : S a `jourMetier` hier ; pièce `VENTE` de `jourMetier` hier ; `dernierEtat.fileVide` vrai.
2. « clôture forcée de la veille sans le poste » : `clotures.preparer(hier)` cite D (raison `SESSION_OUVERTE`) ; `cloturer({ jour: hier, forcer: true, motifForcage: 'Coupure de réseau au comptoir' })` : `forcee`, `postesManquants[0].sessionId` = S ; `avant = etatJour(hier)`.
3. « CA21 : la remontée régularise sur la journée en cours sans toucher la veille » : D envoie séq. 3 `VENTE` 1 boîte (hier 20:00), séq. 4 `VENTE` 3 boîtes (hier 21:30), séq. 5 `COMPTAGE_SAISI` FERMETURE, séq. 6 `SESSION_FERMEE` : quatre `APPLIQUE` ; séq. 3 et 4 : type `REGULARISATION`, `jourMetier` aujourd'hui, `jourMetierOrigine` hier, `sessionCaisseId` S, `venteOrigineId` nul, numéros de la plage de D ; deux `REMONTEE_APRES_CLOTURE` attribuées à VENDEUR, raison `JOURNEE_CLOTUREE`, `clotureId` de la veille, `posteManquantDeLaCloture` vrai, message cité tel quel ; paiements dans S ; stock de F diminué de 4 de plus (mouvements `synchro:` présents) ; S FERMEE, `clotureJournaliereId` nul ; anomalie `REMONTEE_APRES_CLOTURE` raison `CAISSE_FERMEE_APRES_CLOTURE` au titulaire avec `montantEncaisse` 6 000 (les trois ventes de S) ; `etatJour(hier)` strictement égal à `avant` (export compris, au caractère près).
4. « la journée en cours montre les régularisations » : `service.listerVentes(PHARMACIE, RESPONSABLE, { date: aujourd'hui })` liste les deux pièces `REGULARISATION` (total positif) et `totalJour` les compte ; `service.annulerVente` d'une régularisation : 409 `PIECE_NON_ANNULABLE` ; `listerVentes` d'hier : inchangée (une seule pièce, celle de la séq. 2).
5. « vente arrivée après la fermeture de sa caisse » : D ouvre S2 par événement (aujourd'hui) ; RESPONSABLE ferme S2 par la route web (`sessions.fermer` avec comptage) ; D envoie une `VENTE` sur S2 puis `SESSION_FERMEE` de S2 : la vente est `REGULARISATION`, `jourMetier` aujourd'hui, `jourMetierOrigine` aujourd'hui, `sessionCaisseId` S2, anomalie raison `CAISSE_FERMEE` attribuée à VENDEUR (`clotureId` nul, `posteManquantDeLaCloture` faux) ; la fermeture est `APPLIQUE` code `SESSION_DEJA_FERMEE`.
6. « caisse ouverte hors ligne sur une journée déjà clôturée » : D envoie `SESSION_OUVERTE` S3 (hier 22:00) puis une `VENTE` sur S3 : S3 `jourMetier` aujourd'hui, `jourMetierOrigine` hier ; la vente est une pièce `VENTE` ordinaire de `jourMetier` aujourd'hui (aucune `REMONTEE_APRES_CLOTURE`) ; puis `SESSION_FERMEE` de S3 avec comptage.
7. « clôture de la journée en cours et export » : `clotures.preparer(aujourd'hui)` ne cite pas D (file vide, contact du jour) ; `cloturer({ jour: aujourd'hui })` réussit sans forcer ; l'export du jour contient les régularisations (type « Régularisation ») et leurs paiements avec « Non » dans la colonne « Caisse incluse dans la clôture », et les pièces de S3 avec « Oui » ; `verifierStock(base.client)` sans anomalie.

### 4. CLAUDE.md du back (compléter la puce PB18)

« Vente remontée sur une caisse d'un jour clôturé ou déjà fermée : pièce `REGULARISATION` sur la caisse d'origine (paiements compris), `jourMetier` = journée en cours (jour de rattachement), `jourMetierOrigine` = jour de la caisse, anomalie `REMONTEE_APRES_CLOTURE` nominative au vendeur de la caisse (raison `JOURNEE_CLOTUREE` ou `CAISSE_FERMEE`, clôture retrouvée par le jour, `posteManquantDeLaCloture`) ; la journée clôturée (pièces, caisses incluses, totaux, export) ne change jamais ; l'export de la journée en cours montre la régularisation avec une caisse non incluse ; une régularisation n'est pas annulable (D659). »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/pharmacie/synchro/synchro.service.ts`, `test/db/synchro-remontee.db-spec.ts`, `test/db/synchro-ventes.db-spec.ts` (test 14 seulement), `test/db/synchro-caisse.db-spec.ts` (test 14 seulement), `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/synchro/synchro.service.ts test/db/synchro-remontee.db-spec.ts test/db/synchro-ventes.db-spec.ts test/db/synchro-caisse.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `synchro-remontee` (7), `synchro-ventes` (15), `synchro-caisse` (17), `journee-cloturee` (11), `clotures`, `export-cloture`, `etancheite-couts`.
5. `git status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes src/pharmacie/caisse` vide.
6. `grep -n "REGULARISATION_INDISPONIBLE" src/pharmacie/synchro/synchro.service.ts` : aucune occurrence.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
