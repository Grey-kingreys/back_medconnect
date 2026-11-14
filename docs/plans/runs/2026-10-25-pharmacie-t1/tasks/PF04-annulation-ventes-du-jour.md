# PF04 - Annulation sans délai, pièces d'annulation dans « Ventes du jour » et sur le reçu

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire qui annule ; vendeur qui consulte et réimprime)
Visuel: oui (écrans existants « Ventes du jour », dialogue d'annulation, reçu)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Onzième sous-fiche (D685). L'annulation suit PB12 : plus de limite au jour même, elle crée une **pièce d'annulation** (numéro `A-<numéro>`, total négatif) rattachée à la caisse et à la journée de l'auteur. « Ventes du jour » liste ces pièces avec leur total négatif et le statut dérivé, le total du jour est signé, le reçu montre l'annulation (pièce, motif, auteur) et les paiements, et l'accueil « pilotage » compte juste. Les codes morts disparaissent (D703).

Décisions applicables : D686, D687, D688, D693, D697, D703.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/app/dashboard/ventes/page.tsx` (359 lignes) : `listerVentes(structureId, { date, page })`, liste avec numéro, heure, vendeur, client, articles, total, pastille de statut (`CLASSES_STATUT`, `LIBELLES_STATUT` de `affichage.ts`), réimpression, bouton « Annuler » seulement si `peutAnnuler && v.statut === "VALIDEE" && date === aujourdhui` (ligne 266) ; `confirmerAnnulation` traite `VENTE_DEJA_ANNULEE` et `ANNULATION_HORS_DELAI` (lignes 118 à 145).
- `src/app/dashboard/ventes/AnnulationVente.tsx` : dialogue, motif 3 à 300 (`motifValide`), texte « Les quantités seront remises dans votre stock. La vente restera visible dans la liste, marquée « Annulée ». », constantes `CHAMP` et `FOCUS` locales (lignes 8 à 11).
- `src/app/dashboard/ventes/[venteId]/recu/page.tsx` : reçu imprimable (58, 80 mm, A4), mention « ANNULÉE » et « Annulée le ... » (lignes 229 à 234), « Reçu n° <numero> », lignes `quantite x nomMedicament`, prix unitaire.
- `src/lib/ventes_tableau_de_bord.ts` : `resumerVentesDuJour` (compte `annulees` sur `statut === "ANNULEE"`), `resumerMesVentes` (total des ventes validées du vendeur) ; utilisés par `PilotagePharmacie.tsx` et `ComptoirPharmacie.tsx`.
- PF01a : types `Vente`, `VenteResume` étendus (`typePiece`, `numeroTicket`, `jourMetier`, `venteOrigine`, `annulation`, `paiements`, `motif`), `classes.ts`, `erreurs_api.ts`, `formaterQuantite`.
- Contrats (back `CLAUDE.md`, puces PB11, PB12, PB17c ; `vente.service.ts` lignes 888 à 960) : `GET /pharmacie/:structureId/ventes?date=&page=` filtre sur `jourMetier`, liste ventes **et** pièces d'annulation et de régularisation, `totalJour` = somme signée ; chaque élément `{ id, numero, createdAt, statut, total, nombreArticles (unités), vendeur, clientNom, typePiece, numeroTicket, jourMetier, venteOrigine, annulation: { id, numero } | null }`. `POST .../ventes/:venteId/annuler` `{ motif (3 à 300), posteId? }` (jamais `posteId` depuis le web, D692) : réponse = vente d'origine avec `statut: "ANNULEE"`, `annulation { id, numero, motif, le, par { id, nom } }`, message « Vente <numero> annulée (<pièce>). Les quantités ont été remises en stock et le remboursement est enregistré dans votre caisse. » ; 409 `VENTE_DEJA_ANNULEE`, 409 `PIECE_NON_ANNULABLE` (annulation, régularisation, vente d'avant la caisse ou d'avant une qualification), 409 `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `JOURNEE_CLOTUREE` ; `ANNULATION_HORS_DELAI` n'existe plus. Après une clôture, la vente d'origine reste « Annulée » dans son jour clôturé et la pièce d'annulation apparaît dans la journée en cours. Une ligne de vente porte `uniteAffichee`, `nombreAffiche`, `prixUnitaire` (par unité minimale) et `sousTotal`.
- Jeu démo : Kaloum, W3 (Amoxicilline) annulée par le titulaire (`A-<numero>`) ; J-1 : vente T9 remontée en régularisation dans la journée en cours.

### 1. `src/lib/api_ventes.ts`

Retirer `"ANNULATION_HORS_DELAI"` de `CODES_ERREUR_VENTE`. `annulerVente` inchangé.

Champs redevenus obligatoires (D705) : retirer le `?` et le commentaire « Facultatifs pour que les fixtures existantes compilent » de toutes les clés de la caisse ajoutées par PF01a :
- `Vente` : `typePiece`, `numeroTicket` (`number | null`), `jourMetier`, `provisoire`, `poste`, `session`, `paiements`, `annulation`, `venteOrigine`, `motif` ;
- `VenteResume` : `typePiece`, `numeroTicket` (`number | null`), `jourMetier`, `venteOrigine`, `annulation` ;
- `LigneVente` : `uniteAffichee`, `nombreAffiche`, `coefficientApplique`, `allocations`.
`rejeu` reste facultatif (absent hors rejeu). Compléter dans le même commit les fixtures qui construisent ces types : `ventes/page.test.tsx` (`resume`), `ventes/[venteId]/recu/page.test.tsx` (`VENTE`), `ventes_tableau_de_bord.test.ts`, `PilotagePharmacie.test.tsx` et `ComptoirPharmacie.test.tsx` (fabriques `vente`), avec des valeurs conformes au serveur (`numeroTicket` entier ou `null` pour une pièce d'annulation, jamais une chaîne). La fixture `VENTE` de `vente/page.test.tsx` est déjà complète depuis PF01b ; si `tsc` la signale quand même, la compléter (fichier ajouté aux fichiers autorisés pour ce seul motif). Le numéro affiché d'une pièce est toujours `numero` (chaîne `T1-0000012`, `A-T1-0000012`) ; `numeroTicket` n'est affiché nulle part.

### 2. `affichage.ts`

`LIBELLES_TYPE_PIECE: Record<TypePiece, string>` = « Vente », « Annulation », « Régularisation » ; `libelleLigneVente(ligne)` : « 6 comprimés de <nom> » (unité, à partir de `uniteAffichee`, `nombreAffiche` ; libellé de l'unité inconnu côté reçu : « unités ») ou « 2 boîtes de <nom> » ; prix affiché de la ligne = `sousTotal` (fait foi) et prix d'une boîte ou d'une unité = `Math.round(sousTotal / nombreAffiche)`. Tests ajoutés à `affichage.test.ts` (3) : libellé boîte, libellé unité, prix unitaire affiché = `sousTotal / nombreAffiche` arrondi.

### 3. « Ventes du jour » (`page.tsx`)

- Pièce d'annulation ou de régularisation : même ligne que la vente, numéro de la pièce, pastille du type (« Annulation » : classes de la pastille « Annulée » ; « Régularisation » : `bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300`), total négatif (`formaterGNF`, le signe moins est affiché), texte « Annule la vente <venteOrigine.numero> » ou « Vente remontée d'un poste de caisse » sous le numéro ; pas de bouton « Annuler » ; réimpression possible.
- Vente annulée : pastille « Annulée » et texte « Annulée par <annulation.numero> » sous le numéro.
- Bouton « Annuler » : `peutAnnuler && v.typePiece === "VENTE" && v.statut === "VALIDEE"`, **quel que soit le jour** (D703).
- Total du jour : « Total du jour (annulations déduites) : <formaterGNF(totalJour)> ».
- `confirmerAnnulation` : succès : message du serveur en bandeau de succès, liste rechargée ; `VENTE_DEJA_ANNULEE` : comportement actuel (liste rechargée) ; `PIECE_NON_ANNULABLE`, `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `JOURNEE_CLOTUREE`, 403 : message du serveur dans le dialogue, **aucun réessai** ; échec réseau : « L'annulation n'a peut-être pas été enregistrée. Fermez cette fenêtre et vérifiez la liste avant de recommencer. » et liste rechargée à la fermeture (route non rejouable par identifiant ; une seconde tentative serait refusée par `VENTE_DEJA_ANNULEE` si la première avait abouti) ; branche `ANNULATION_HORS_DELAI` supprimée.
- Une journée passée affiche sous le titre : « Une annulation faite aujourd'hui apparaît dans la journée d'aujourd'hui, pas dans celle-ci. ».

### 4. Dialogue d'annulation (`AnnulationVente.tsx`)

Importer `CHAMP` et `FOCUS` de `src/components/pharmacie/classes.ts` (valeurs identiques, D693). Texte remplacé par : « Les quantités seront remises dans votre stock et le remboursement sera enregistré dans votre caisse. Une pièce d'annulation est créée ; la vente reste visible, marquée « Annulée ». ».

### 5. Reçu (`[venteId]/recu/page.tsx`)

- Numéro : « Reçu n° <numero> » ; pièce d'annulation : titre « Pièce d'annulation n° <numero> », « Annule la vente n° <venteOrigine.numero> », « Motif : <motif> » ; pièce de régularisation : « Régularisation n° <numero> ».
- Vente annulée : mention « ANNULÉE » conservée, plus « Annulée le <formaterDateHeure(annulation.le)> par <annulation.par.nom> (pièce <annulation.numero>) », « Motif : <annulation.motif> ».
- Lignes : `libelleLigneVente` et `sousTotal`.
- Paiements sous le total : une ligne par paiement (« Orange Money : 5 000 GNF », référence si présente, « Reçu : <montantRecu> », « Rendu : <rendu> » pour les espèces) ; aucune ligne si `paiements` est vide.
- Si `jourMetier` diffère du jour de `createdAt` : « Comptée pour le <formaterJour(jourMetier)> ».
- Aucun coût, aucune allocation, aucun numéro de lot sur le reçu.

### 6. Accueil (`src/lib/ventes_tableau_de_bord.ts`)

`resumerVentesDuJour` : `annulees` = nombre de pièces `typePiece === "ANNULATION"` de la page lue (au lieu des ventes au statut annulé, qui peuvent dater d'un autre jour) ; `nombre` reste celui du serveur (pièces comprises) mais la carte « Ventes enregistrées » de `PilotagePharmacie.tsx` garde son sous-texte. `resumerMesVentes` : `total` = somme des `total` signés des pièces du vendeur (`vente.vendeur.id === utilisateurId`), `nombre` = ses pièces `VENTE`, `annulees` = ses pièces `ANNULATION`. Mettre à jour `ventes_tableau_de_bord.test.ts` (attentes et 2 tests ajoutés : une annulation du jour d'une vente d'hier est comptée ; le total du vendeur déduit ses annulations) et, si un texte change, `PilotagePharmacie.test.tsx` et `ComptoirPharmacie.test.tsx` (seulement les attentes touchées). Sous-texte de la carte « Encaissé aujourd'hui » de `PilotagePharmacie.tsx` : « Ventes du jour, annulations déduites ».

### 7. Tests

`src/app/dashboard/ventes/page.test.tsx` (adapter les tests existants ; ajouter 6) :
1. pièce d'annulation : total négatif, pastille « Annulation », « Annule la vente T1-0000012 », pas de bouton « Annuler » ;
2. vente annulée : « Annulée par A-T1-0000012 » ;
3. bouton « Annuler » présent sur une vente validée d'un jour passé ;
4. succès d'annulation : message du serveur affiché, liste rechargée ;
5. 409 `PIECE_NON_ANNULABLE` : message du serveur dans le dialogue, pas de réessai ;
6. échec réseau : message de vérification exact, liste rechargée à la fermeture.

`src/app/dashboard/ventes/[venteId]/recu/page.test.tsx` (3 ajoutés) : pièce d'annulation (titre, vente d'origine, motif) ; vente annulée (auteur et pièce) ; paiements avec monnaie rendue ; aucun numéro de lot affiché.

## Contraintes

Faire uniquement ce qui est demandé. Audience non-dev : termes interdits absents. Visuel : classes existantes, clair et sombre, AA ; le style d'impression du reçu (`@media print`) n'est pas modifié. Montants : `formaterGNF`. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_ventes.ts`, `src/app/dashboard/ventes/page.tsx`, `src/app/dashboard/ventes/page.test.tsx`, `src/app/dashboard/ventes/AnnulationVente.tsx`, `src/app/dashboard/ventes/affichage.ts`, `src/app/dashboard/ventes/affichage.test.ts`, `src/app/dashboard/ventes/[venteId]/recu/page.tsx`, `src/app/dashboard/ventes/[venteId]/recu/page.test.tsx`, `src/lib/ventes_tableau_de_bord.ts`, `src/lib/ventes_tableau_de_bord.test.ts`, `src/components/dashboard/PilotagePharmacie.tsx`, `src/components/dashboard/PilotagePharmacie.test.tsx`, `src/components/dashboard/ComptoirPharmacie.test.tsx`, `src/app/dashboard/vente/page.test.tsx` (fixture `VENTE` seulement, D705).

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : « Ventes du jour » : W3 « Annulée par A-... », la pièce d'annulation au total négatif, la régularisation de T9 ; annuler W1 ; reçu de la pièce d'annulation et reçu de W2 (Orange Money) ; journée J-2 : annulation possible d'une vente (la pièce apparaît aujourd'hui). **Ousmane Keita** (vendeur) : pas de bouton « Annuler ». Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont ventes du jour (6 ajoutés), reçu (3 ajoutés), `affichage.test.ts` (3 ajoutés), `ventes_tableau_de_bord.test.ts` (2 ajoutés).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -rn "ANNULATION_HORS_DELAI\|date === aujourdhui" src` : aucune ligne.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
