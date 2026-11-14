# PF01b - Écran de vente : unité, reliquat, vente sans stock, paiements, nouvelles erreurs

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (vendeur au comptoir, pressé, souvent au clavier)
Visuel: oui (écran existant « Nouvelle vente » étendu, aucun nouveau système visuel)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Deuxième sous-fiche (D685), après PF01a (commitée). L'écran « Nouvelle vente » passe au contrat de PB11 : vente à la boîte ou à l'unité, reliquat de la boîte entamée affiché, vente possible sans stock (enregistrée en attente de stock, jamais refusée, O11 et D689), lot périmé choisi par le vendeur avec un motif quand il ne reste que du périmé, choix du paiement dans la confirmation existante (espèces par défaut, Orange Money, MTN MoMo, paiement partagé), état de la caisse visible, nouvelles erreurs avec le message du serveur. Une vente espèces d'une ligne se fait en **quatre interactions** au clavier ou à la souris (cinq au plus exigées par le plan).

Décisions applicables : D686 à D694, D697, D698.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/app/dashboard/vente/page.tsx` (697 lignes) : charge le stock par `getMyStock`, panier en `localStorage` (`cleStockagePanier`, `lirePanierStocke`, `enregistrerPanier`), recherche locale (`rechercherDansStock`), confirmation `ConfirmationVente`, envoi `creerVente(structureId, corpsVente(...), cle)` avec `Idempotency-Key`, `gererEchec` (lignes 207 à 263) qui traite `STOCK_INSUFFISANT`, `MEDICAMENT_EXPIRE`, `STOCK_INTROUVABLE`, `PRIX_MANQUANT`, `ORDONNANCE_NON_CONFIRMEE`, `VALIDATION` et l'échec réseau (bouton « Réessayer », même clé) ; écran de succès (lignes 305 à 351) avec « Voir et imprimer le reçu », « Nouvelle vente », « Voir les ventes du jour ».
- `src/app/dashboard/vente/panier.ts` : panier version 1 (`lignes: [{ stockId, quantite }]`), `raisonNonVendable` bloque `perime`, `rupture`, `sans-prix` ; `quantiteMaxLigne` plafonne au stock ; `corpsVente` ; `appliquerStockInsuffisant` (devenu inutile).
- `src/app/dashboard/vente/ConfirmationVente.tsx` : dialogue `useDialogA11y`, lignes, total, client, « Revenir au panier », « Confirmer la vente ».
- PF01a a créé : `src/lib/caisse/regles/prix.ts` (`calculerLigne`), `quantites.ts` (`formaterQuantite`, `LIBELLES_UNITE_MINIMALE`), `src/lib/caisse/source_en_ligne.ts` (`sourceEnLigne`), `src/lib/api_caisse.ts` (`Referentiels`, `ModePaiement`, `SessionCaisse`), `src/lib/erreurs_api.ts`, `src/components/pharmacie/classes.ts`, `ErreurAvecReessai.tsx`, types étendus de `api_ventes.ts` et `api_pharmacie.ts`.
- Contrat (back `CLAUDE.md`, puce PB11) : corps `{ lignes: [{ stockId, quantite, unite?, sortieManuelle? }], paiements?, clientNom?, clientTelephone?, ordonnanceVerifiee? }` ; une fiche au plus une fois par unité ; sans `paiements` : espèces du total ; somme des paiements = total (400 `PAIEMENTS_INCOHERENTS`) ; un paiement par mode, 5 au plus ; `reference` seulement si `referenceAutorisee` ; `montantRecu` seulement pour les espèces, `rendu` renvoyé ; 409 `SORTIE_MANUELLE_REQUISE` avec `details[].lots` ; refus dans l'ordre : 404, `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `PRIX_MANQUANT`, `MOTIF_REQUIS`, `ORDONNANCE_NON_CONFIRMEE`, total, paiements, poste, session, lot de sortie manuelle, `SORTIE_MANUELLE_REQUISE` ; tout refus n'enregistre rien.
- Jeu démo (PB19a-chef.md) : à Kaloum, Doliprane déconditionnable avec boîte entamée (6 comprimés sur `DL23K052`), Flagyl et Glucophage entamés, Amlor en stock bas, Ventoline à -1 ; périmé : lot `AG23C777` (Augmentin, trouvé à l'inventaire).

### 1. Panier version 2 (`panier.ts`)

- `LignePanier = { stockId: string; unite: UniteVente; nombre: number }` ; clé d'une ligne = `stockId` + `unite` (une fiche peut avoir une ligne boîte et une ligne unité).
- `lirePanierStocke` lit la version 2 et convertit la version 1 (`quantite` devient `nombre`, `unite: "BOITE"`) ; tout autre contenu donne `PANIER_VIDE` ; `enregistrerPanier` écrit `{ version: 2, ... }`.
- `uniteParDefaut(stock)` (D690) : `"UNITE"` si `deconditionnable === true` et `prixUnite` est un entier positif, sinon `"BOITE"`.
- `raisonNonVendable(stock, unite)` remplace l'ancienne : `"sans-prix"` si `calculerLigne` refuse pour `PRIX_MANQUANT` ou `PRIX_UNITE_MANQUANT`, `"unite-interdite"` pour `VENTE_UNITE_INTERDITE`, sinon `null` ; **ni la rupture ni la péremption ne bloquent plus** (D689). `LIBELLES_RAISON` : `"sans-prix": "Prix non renseigné"`, `"unite-interdite": "Se vend uniquement à la boîte"`.
- `avertissementStock(stock, unite, nombreDansPanier)` : `"attente-stock"` si la quantité demandée (convertie en unités minimales par `coefficientBoite`) dépasse `quantiteVendable` (à défaut `quantite`), `"perime-seulement"` si `quantite > 0` et `quantiteVendable === 0`, sinon `null`.
- `ajouterAuPanier(panier, stock, unite, nouvelleCle)` ; `changerNombre(panier, cleLigne, delta)` borné de 1 à `QUANTITE_MAX_LIGNE` (10 000, plus de plafond au stock) ; `changerUnite(panier, cleLigne)` bascule BOITE et UNITE si l'autre unité est vendable (sinon panier inchangé ; si une ligne de l'autre unité existe déjà, les deux fusionnent en additionnant `nombre`) ; `retirerDuPanier(panier, cleLigne)`.
- `totalPanier(panier, stocks)` = somme des `montantLigne` de `calculerLigne` (estimation, le serveur fait foi).
- `reconcilierPanier(panier, stocks)` : ligne dont la fiche a disparu ou n'est plus vendable dans son unité : retirée avec correction (« (retiré) ») ; plus aucun plafond au stock.
- `corpsVente(panier, surOrdonnance, paiements)` : `lignes: [{ stockId, quantite: nombre, unite }]`, plus `sortieManuelle` si la ligne en porte une (champ facultatif `sortieManuelle?: { lotId, motif }` de `LignePanier`, jamais enregistré en `localStorage`) ; `paiements` ajouté **seulement** s'il n'est pas « espèces du total sans montant reçu » (D691 : le serveur applique alors lui-même espèces du total, aucun écart d'arrondi possible).
- Supprimer `appliquerStockInsuffisant` et `quantiteMaxLigne`.

### 2. Écran (`page.tsx`)

- Importer `CARTE`, `CHAMP`, `FOCUS`, `BOUTON_PRIMAIRE`, `BOUTON_ICONE`, `POLICE_TITRE` de `src/components/pharmacie/classes.ts` au lieu des constantes locales (valeurs identiques, D693). Charger stock, référentiels et état de caisse par `sourceEnLigne` (`chargerStock`, `chargerReferentiels`, `etatCaisse`) en parallèle ; un échec des référentiels ou de l'état de caisse ne bloque pas la vente (espèces seulement, badge masqué).
- **Recherche** : `Entrée` dans le champ de recherche ajoute le premier résultat vendable dans son unité par défaut et vide le champ (le focus reste dans le champ). Chaque résultat montre le nom, le prix de la boîte (`formaterGNF`), le prix à l'unité s'il existe (« 600 GNF le comprimé », libellé de `LIBELLES_UNITE_MINIMALE`), le stock (`formaterQuantite`) et, s'il y a lieu, l'avertissement ci-dessous.
- **Avertissements non bloquants** (texte `text-amber-700 dark:text-amber-300`, jamais rouge) : `attente-stock` : « Stock insuffisant : la vente sera enregistrée en attente de livraison. » ; `perime-seulement` : « Il ne reste que des boîtes périmées : vous devrez choisir le lot à sortir. ».
- **Ligne du panier** : nom, sélecteur d'unité à deux boutons (« Boîte » / libellé pluriel de l'unité, par exemple « Comprimés »), `aria-pressed` sur le bouton actif, désactivé si l'autre unité n'est pas vendable ; nombre avec `-` et `+` (`BOUTON_ICONE`) ; montant de la ligne. Raccourci **F2** : bascule l'unité de la dernière ligne ajoutée (`changerUnite`), `preventDefault`, écouteur posé au montage et retiré au démontage ; aide visible sous le panier : « F2 : passer de la boîte à l'unité pour la dernière ligne ».
- **Reliquat** (produit sélectionné = dernière ligne ajoutée) : si `reliquat` non vide, ligne permanente sous le panier : « Boîte entamée : 6 comprimés restants » (somme des `unitesRestantes`, libellé de l'unité) ; sinon rien.
- **Badge de caisse** dans l'en-tête, à droite du titre (pastille texte, pas d'icône seule) : session ouverte du vendeur : « Caisse ouverte depuis 08:15 » (`formaterHeure` de `src/app/dashboard/ventes/affichage.ts`) ; si `session.jourMetier` diffère de `jourConakry(new Date())` : « Caisse ouverte, ventes comptées pour le <formaterJour(jourMetier)> » ; aucune session : « Caisse fermée : elle s'ouvrira à la première vente » ; classes : `px-3 py-1 rounded-full text-xs font-semibold` + `bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300` (ouverte) ou `bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300` (fermée), même forme que les pastilles de statut de `src/app/dashboard/ventes/page.tsx` ligne 255. Lien « Ma caisse » à côté seulement si la route `/dashboard/caisse` est autorisée (`estRouteAutorisee`, elle n'existe qu'après PF03a ; en attendant elle est inconnue donc autorisée : **ne pas afficher ce lien avant PF03a**, ajouté par PF03a).
- **Bandeau en ligne seulement** (D694, révisable) sous l'en-tête, `ALERTE_INFO` : « Cette page a besoin d'internet : sans connexion, aucune vente n'est enregistrée. ».

### 3. Confirmation et paiement (`ConfirmationVente.tsx`)

Props ajoutées : `modes: ModePaiement[]` (référentiel, triés par `ordre` ; liste vide : espèces seules), `onConfirmer(paiements: PaiementDemande[] | null)` (null = espèces du total sans montant reçu). Lignes affichées : « 2 × Boîte de Doliprane 500 mg » ou « 6 × comprimé de Doliprane » (nombre, unité, nom), montant de la ligne.

- Choix du mode en boutons radio (`role="radiogroup"`, libellé « Mode de paiement ») : un bouton par mode du référentiel (libellé du serveur : « Espèces », « Orange Money », « MTN MoMo ») et « Paiement partagé » ; « Espèces » sélectionné à l'ouverture et le bouton « Confirmer la vente » reçoit le focus (une vente espèces se confirme par Entrée).
- Espèces : champ facultatif « Montant reçu (facultatif) » (`inputMode="numeric"`) ; s'il est rempli et supérieur ou égal au total : « Monnaie à rendre : <formaterGNF> » ; inférieur : « Le montant reçu est inférieur au total. » et confirmation désactivée.
- Orange Money ou MTN MoMo (mode `referenceAutorisee`) : champ facultatif « Référence de la transaction (facultatif) », 60 caractères au plus.
- Paiement partagé : un montant par mode (champs entiers, vides par défaut), ligne « Reste à répartir : <formaterGNF> » ; confirmation active seulement quand la somme égale le total (sinon « La somme des montants doit être égale au total. ») ; montant reçu possible pour les espèces, référence pour les modes qui l'autorisent ; un mode à 0 ou vide n'est pas envoyé.
- Montants : entiers GNF, saisie avec chiffres seuls, affichage `formaterGNF`.

### 4. Erreurs (`gererEchec`)

Clé d'idempotence (D688) : après un refus du serveur (400, 403, 404, 409) rien n'est enregistré, la clé du panier est **renouvelée** au prochain envoi (`cleIdempotence: null`) ; après un échec réseau (`estErreurReseau`) la **même** clé est gardée et « Réessayer » rejoue (comportement actuel conservé). Jamais de réessai automatique.

| Code | Action |
|---|---|
| `SORTIE_MANUELLE_REQUISE` | ouvre le dialogue « Sortie d'un lot périmé » (5) pour la première ligne citée par `details` |
| `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `PRIX_MANQUANT`, `FICHE_MODIFIEE`, `STOCK_INTROUVABLE` | bandeau = message du serveur, stock rechargé, panier réconcilié (lignes retirées citées par `messageCorrections`) |
| `PAIEMENTS_INCOHERENTS`, `MODE_PAIEMENT_INCONNU` | bandeau = message du serveur suivi de « Le total a été recalculé : vérifiez le paiement puis validez à nouveau. », stock et référentiels rechargés |
| `ORDONNANCE_NON_CONFIRMEE` | comportement actuel |
| `MOTIF_REQUIS`, `STOCK_LOT_NEGATIF` | message du serveur dans le dialogue de sortie, qui reste ouvert |
| `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `JOURNEE_CLOTUREE` | bandeau = message du serveur, état de caisse rechargé, aucun bouton « Réessayer » |
| 403 | bandeau = message du serveur |
| `VALIDATION` | comportement actuel |
| réseau | comportement actuel |
| autre | `messageErreurPour(err, "Un problème est survenu, réessayez dans un instant.")` |

Supprimer les branches `STOCK_INSUFFISANT` et `MEDICAMENT_EXPIRE`, et retirer ces deux codes de `CODES_ERREUR_VENTE` (`api_ventes.ts`, `ANNULATION_HORS_DELAI` reste jusqu'à PF04).

### 5. Dialogue « Sortie d'un lot périmé » et choix de lot

`src/components/pharmacie/ChoixLot.tsx` (nouveau, réutilisé par PF07b) : `ChoixLot({ lots, valeur, onChange, legende }: { lots: { id: string; numeroLot: string | null; dateExpiration: string | null; quantite: number }[]; valeur: string | null; onChange(id: string): void; legende: string; coefficient: number; unite: UniteMinimale })` : `fieldset` + `legend`, un bouton radio par lot (`input type="radio"` natif, flèches du clavier) au libellé « Lot DL23K052, périmé le 01/10/2026, 6 comprimés » (numéro absent : « Lot sans numéro » ; date absente : « sans date de péremption » ; « périmé le » si la date est passée, sinon « expire le » ; quantité par `formaterQuantite`).

`src/app/dashboard/vente/SortieLotPerime.tsx` (nouveau) : dialogue au même gabarit que `src/app/dashboard/ventes/AnnulationVente.tsx` (`useDialogA11y`, icône dans un carré `bg-amber-50 dark:bg-amber-500/15`), titre « Sortie d'un lot périmé », texte « Il ne reste que des boîtes périmées de <nom>. Choisissez le lot à sortir et indiquez pourquoi vous le vendez. », `ChoixLot` (légende « Lot à sortir »), champ « Motif » (3 à 300 caractères, aide « Par exemple : demande du médecin, aucun autre lot disponible »), boutons « Revenir au panier » et « Vendre ce lot ». Validation : lot choisi et motif valide (`motifValide` de `ventes/affichage.ts`), sinon message « Choisissez un lot et indiquez un motif de 3 caractères au moins. ». Confirmer ajoute `sortieManuelle` à la ligne puis renvoie la vente (nouvelle clé).

### 6. Écran de succès

Afficher en plus : « Numéro : <numero> » (existant), paiements (« Espèces : 10 000 GNF », « Orange Money : 5 000 GNF, référence OM-778 »), « Monnaie à rendre : <rendu> » si un paiement espèces porte `rendu > 0`, et si `provisoire` : « Une partie de cette vente attend une livraison : le stock sera rattaché à la prochaine réception. » (`ALERTE_ATTENTION`) ; si `jourMetier` diffère d'aujourd'hui : « Vente comptée pour le <formaterJour(jourMetier)> (journée d'aujourd'hui déjà clôturée). ». L'état de caisse est rechargé après chaque vente réussie (badge à jour).

### 7. Tests

`src/app/dashboard/vente/panier.test.ts` : réécrire les tests qui portent sur la version 1, en gardant leur intention ; au moins ces 10 tests :
1. lecture d'un panier version 1 : `quantite: 3` devient `{ unite: "BOITE", nombre: 3 }` ;
2. version inconnue ou JSON illisible : `PANIER_VIDE` ;
3. `uniteParDefaut` : déconditionnable avec prix unité donne `UNITE` ; sans prix unité ou non déconditionnable donne `BOITE` ;
4. une fiche en rupture (`quantite: -1`) s'ajoute au panier (D689) ;
5. une fiche sans prix de boîte ne s'ajoute pas en `BOITE` ;
6. `changerUnite` fusionne avec la ligne de l'autre unité existante ;
7. `changerUnite` refuse l'unité sur une fiche non déconditionnable ;
8. `totalPanier` : 6 comprimés à 600 plus 2 boîtes à 3 500 = 10 600 ;
9. `corpsVente` sans paiement explicite n'a pas de clé `paiements` ; avec un partage espèces 5 000 et Orange Money 5 600 (référence `OM-1`), les porte tels quels ;
10. `avertissementStock` : `attente-stock` au-delà de `quantiteVendable`, `perime-seulement` si `quantite` 12 et `quantiteVendable` 0.

Champs facultatifs de PF01a (D705) : dans `api_ventes.ts`, les clés de la caisse de `Vente`, `VenteResume` et `LigneVente` sont encore facultatives (`?`) pour que les anciennes fixtures compilent ; le serveur les renvoie toujours. PF01b ne retire pas ces `?` (les fixtures de `ventes/[venteId]/recu/page.test.tsx` et des résumés sont hors de ses fichiers ; PF04 les rend obligatoires), mais la fixture `VENTE` de `vente/page.test.tsx` doit porter **toutes** les clés de la réponse réelle, comme si elles étaient déjà obligatoires : `typePiece: "VENTE"`, `numeroTicket` (entier, par exemple `12` ; le numéro lisible affiché reste `numero`, chaîne `T1-0000012`), `jourMetier`, `provisoire`, `poste { id, code }`, `session { id, ouverteAutomatiquement }`, `paiements`, `annulation: null`, `venteOrigine: null`, `motif: null`, et sur chaque ligne `uniteAffichee`, `nombreAffiche`, `coefficientApplique`, `allocations`. Le code de l'écran lit ces clés sans repli sur une valeur inventée (pas de `?? 0` sur un montant ni de `?? "VENTE"`) : une clé absente se traite comme une réponse illisible (rien d'affiché pour ce bloc). `numeroTicket` n'est jamais affiché par PF01b.

`src/app/dashboard/vente/page.test.tsx` : adapter les tests existants (mock de `@/lib/caisse/source_en_ligne` au lieu de `getMyStock` et `creerVente`), et ajouter :
1. « vente espèces d'une ligne en quatre interactions » : compteur incrémenté par un enrobage de `fireEvent` ; `change` du champ de recherche (« doli »), `keyDown` Entrée dans le champ, clic sur « Valider la vente », clic sur « Confirmer la vente » ; `creerVente` appelée une fois avec `lignes: [{ stockId, quantite: 1, unite: "UNITE" }]` et sans `paiements` ; compteur égal à 4 (au plus 5) ;
2. « reliquat affiché » : « Boîte entamée : 6 comprimés restants » après ajout du Doliprane ;
3. « F2 bascule l'unité de la dernière ligne » ;
4. « vente sans stock possible » : fiche à `quantite: -1` ajoutée, avertissement « Stock insuffisant : la vente sera enregistrée en attente de livraison. » visible, envoi effectué ;
5. « sortie d'un lot périmé » : premier envoi rejeté par `ApiError` 409 `SORTIE_MANUELLE_REQUISE` (avec `details[].lots`), choix du lot, motif « Demande du médecin », « Vendre ce lot » : second envoi porte `sortieManuelle { lotId, motif }` et une clé différente de la première ;
6. « paiement partagé » : la confirmation reste désactivée tant que la somme diffère du total, puis envoie deux paiements ;
7. « refus métier : message du serveur et nouvelle clé » : `PAIEMENTS_INCOHERENTS` affiche le message reçu ; le renvoi utilise une autre clé ;
8. « échec réseau : même clé » : `ApiError` 0 puis « Réessayer » : deux appels avec la même clé ;
9. « badge de caisse » : session ouverte à 08:15 affiche « Caisse ouverte depuis 08:15 » ; `etatCaisse` en échec : pas de badge, la vente reste possible ;
10. « succès : monnaie à rendre et vente en attente de livraison » sur une réponse `provisoire: true` avec un paiement espèces `rendu: 5000`.

`src/components/pharmacie/ChoixLot.test.tsx` (2) : libellés exacts d'un lot périmé numéroté et d'un lot sans numéro ni date ; clic sur un lot appelle `onChange` avec son `id`.

## Contraintes

Faire uniquement ce qui est demandé ; pas de refactor non demandé hors des constantes remplacées par l'import de `classes.ts`. Audience non-dev : termes interdits de `docs/ORCHESTRATOR.md` du front (token, API, ID, requête, serveur, session...) absents des chaînes visibles ajoutées (« caisse » remplace « session » partout à l'écran). Visuel : uniquement les classes existantes citées, clair et sombre, contraste AA, focus visible (`FOCUS`), chaque bouton icône a un `aria-label`. Montants : `formaterGNF` exclusivement. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin. Next.js 16 : lire `node_modules/next/dist/docs/` avant de modifier une page.

Fichiers autorisés : `src/app/dashboard/vente/page.tsx`, `src/app/dashboard/vente/page.test.tsx`, `src/app/dashboard/vente/panier.ts`, `src/app/dashboard/vente/panier.test.ts`, `src/app/dashboard/vente/ConfirmationVente.tsx`, `src/app/dashboard/vente/SortieLotPerime.tsx`, `src/components/pharmacie/ChoixLot.tsx`, `src/components/pharmacie/ChoixLot.test.tsx`, `src/lib/api_ventes.ts`.

## Test à la main

Après remise à zéro de la démo par le porteur (procédure du `CLAUDE.md` du back, « Mode démo »), front `http://localhost:3100`, page de connexion, « Comptes de démonstration » : **Ousmane Keita** (vendeur, rôle Pharmacien, Pharmacie de Kaloum). « Nouvelle vente » : Doliprane à l'unité (reliquat 6 comprimés), F2 vers la boîte, Ventoline (stock -1) vendue en attente de livraison, paiement partagé Espèces + Orange Money, badge « Caisse ouverte depuis ... » (caisse web ouverte du jour). Augmentin : seul le lot `AG23C777` est périmé si les autres lots sont épuisés ; sinon tester la sortie de lot par le test automatique. Captures en thème clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `panier.test.ts` (10 au moins), `page.test.tsx` de la vente (10 ajoutés), `ChoixLot.test.tsx` (2).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés.
6. `grep -n "STOCK_INSUFFISANT\|MEDICAMENT_EXPIRE\|appliquerStockInsuffisant" src/app/dashboard/vente src/lib/api_ventes.ts` : aucune ligne.
7. Termes interdits absents des chaînes ajoutées (grep du vérificateur) ; aucun U+2014 ni U+2013 ajouté.
8. Captures clair et sombre de la recherche, du panier avec reliquat, de la confirmation en paiement partagé et du dialogue de sortie (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | spécifié (codeur Sonnet, vérificateur Sonnet) | PASS avec réserves | panier modifiable sous la même clé après un échec réseau (perte de vente possible), dialogue de sortie non réinitialisé entre deux fiches, repli `?? 0` sur le prix (rapports/PF01b-verification.md) ; écart déclaré accepté : une ligne de `src/lib/api_ventes.test.ts` (hors liste) passée de `STOCK_INSUFFISANT` à `SORTIE_MANUELLE_REQUISE`, imposée par le retrait du code de `CODES_ERREUR_VENTE`
2026-11-01 | chef Opus | corrigé et validé | saisie verrouillée pendant l'envoi et après un échec réseau, « Réessayer » (même clé, même corps) et « Modifier la saisie » (nouvelle clé, avertissement) seuls proposés (D688, D706) ; `key` du dialogue de sortie par fiche ; prix de la ligne affiché seulement s'il est un nombre ; 2 tests ajoutés, 1 renforcé

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
`docker compose exec -T frontend npx tsc --noEmit` | 0 erreur | front 646edfd
`docker compose exec -T frontend npx eslint` (vente, ChoixLot, api_ventes) | 0 erreur | front 646edfd
`docker compose exec -T frontend npx vitest run` | 60 fichiers, 503 tests verts (479 avant PF01b) | front 646edfd
`npm run build` (local) | réussi | front 646edfd
