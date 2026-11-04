# PD02b - Cœur hors ligne : vente, caisse, journal, plages

Tier: dur (codeur Sonnet, vérificateur Sonnet ; fiche détaillée)
Audience: dev pour le code ; les messages d'erreur sont lus par le vendeur (non-dev)
Visuel: n/a
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD02a validé

## Spec

### Objectif

Le cœur enregistre ventes, ouvertures, comptages, mouvements et fermetures sur le poste, chacun en une transaction avec son événement du journal. Tout est testé sans Electron ni réseau. Le corps de chaque événement respecte exactement les DTO du back.

Décisions : D424, D427, D428, D651, D652, D654, D655, D713.2, D719, D723, D737, D739, D741. Puce PB18 de `back_medconnect/CLAUDE.md`. CA19, CA23, CA24 du plan.

### 1. Méthodes de `CoeurCaisse`

Toutes reçoivent `utilisateur: { id: string; nom: string; superviseur: boolean }`. Un refus lève `RefusCaisse { status, code, message, details? }` (`desktop/coeur/refus.ts`), rien n'est écrit. Les identifiants clients sont rejouables : même `id` déjà enregistré, on renvoie l'existant sans nouvel événement.

| Méthode | Événement | Contrat de réponse (forme du front) |
|---|---|---|
| `sessionOuverte()` | aucun | `SessionCaisse | null` de `api_caisse.ts` |
| `ouvrirSession({ id, comptage? }, u)` | `SESSION_OUVERTE`, puis `COMPTAGE_SAISI` si comptage | `SessionCaisseOuverte` |
| `saisirComptage(sessionId, { id, moment, coupures, releves? }, u)` | `COMPTAGE_SAISI` | `ComptageCaisse` |
| `enregistrerMouvement(sessionId, { id, type, montant, motif, mode? }, u)` | `MOUVEMENT_CAISSE` | `MouvementCaisse` |
| `bilan(sessionId, u)` | aucun | `BilanCaisse` |
| `fermerSession(sessionId, { comptageFermeture, commentaire? }, u)` | `SESSION_FERMEE` | `BilanCaisse` figé |
| `enregistrerVente(corps, cle, u)` | `SESSION_OUVERTE` si besoin, puis `VENTE` | `Vente` |
| `lireVente(id)` | aucun | `Vente | null` |
| `listerVentes(jour)` | aucun | `VentesDuJour` du poste |
| `etatLocal()` | aucun | `{ fileEnAttente, rejetes, plageRestante, plageEpuisee, sessionOuverte }` |
| `enregistrerAnnulationServeur(reponse)` | aucun | voir section 6 |

### 2. Corps exacts des événements

Enveloppe : `{ evenementId, sequence, type, horodatageLocal (ISO), utilisateurId, corps }`. `sequence = prochaineSequence`, puis +1. `evenementId` et tous les identifiants : `crypto.randomUUID()` injecté par `genererId` (le back accepte tout UUID, D739 ; le plan disait v7). `corps` est stocké en texte JSON et renvoyé tel quel (empreinte, D638).

```text
SESSION_OUVERTE   { sessionId }
COMPTAGE_SAISI    { comptageId, sessionId, moment, coupures: [{ valeurFaciale, nombre }], releves?: [{ mode, montant }] }
MOUVEMENT_CAISSE  { mouvementId, sessionId, type, montant, motif, mode? }
SESSION_FERMEE    { sessionId, comptageFermeture?: { comptageId, coupures, releves? }, commentaire? }
VENTE             { venteId, sessionId, numeroTicket | numeroSecours (un seul),
                    lignes: [{ stockId, unite, nombre, prixUnitaire, quantiteProvisoireLocale?, ouvertureConditionnement?, sortieManuelle? }],
                    paiements: [{ mode, montant, reference?, montantRecu? }], total, clientNom?, clientTelephone?, ordonnanceVerifiee }
```

`prixUnitaire` d'une ligne d'événement = prix de la **boîte** en `BOITE`, prix de l'**unité** en `UNITE` (pas le prix par unité minimale de la réponse). Clés facultatives **absentes** quand elles sont vides, jamais `null` : le back rejette une clé inconnue, et `quantiteProvisoireLocale` n'apparaît que positive, `ouvertureConditionnement` que vraie.

Test de contrat `corps_evenements.test.ts` : copie dans `desktop/coeur/fixtures/` la liste des clés permises par classe de DTO (`back_medconnect/src/pharmacie/dto/synchro.dto.ts`) et vérifie que chaque corps produit n'en a pas d'autres et a toutes les obligatoires, bornes comprises.

### 3. `enregistrerVente`, dans l'ordre

Reprend `calculerLigne` et les codes de `CODES_ERREUR_VENTE`.

1. Clé déjà vue (`ventes.id = cle`, `venteId = cle`, D739) : renvoie la vente avec `rejeu: true`.
2. Fiche inconnue : 404 `STOCK_INTROUVABLE`. 1 à 50 lignes, `nombre` 1 à 10 000, sinon `VALIDATION`.
3. Par ligne : `calculerLigne` : `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `PRIX_MANQUANT` (400 ou 409 comme le back, message repris du back).
4. `motif` de sortie manuelle 3 à 300 caractères, sinon 400 `MOTIF_REQUIS`.
5. Ordonnance : un médicament `ordonnanceRequise` sans `ordonnanceVerifiee` : `ORDONNANCE_NON_CONFIRMEE`, comme le web (case existante, règle du porteur).
6. Paiements : `preparerPaiements` : `PAIEMENTS_INCOHERENTS`, `MODE_PAIEMENT_INCONNU`.
7. Session : caisse ouverte d'un autre utilisateur : 409 `SESSION_AUTRE_UTILISATEUR` avec le message du back ; aucune caisse : ouverte automatiquement dans la même transaction (CA19, D428), `session.ouverteAutomatiquement: true`.
8. **Périmé seul (D737)** : une fiche dont `quantiteVendable` est 0 et qui a des lots périmés, sans `sortieManuelle` : 409 `SORTIE_MANUELLE_REQUISE`, `details: [{ stockId, nom, lots: [{ lotId, numeroLot, dateExpiration, quantite }] }]` (forme de `LigneErreurVente`) : c'est le parcours existant de l'écran, un choix et non un refus de stock. CA13 : jamais de périmé pris seul.
9. **Stock : aucun refus** (D713.2). Sélection `selectionnerLots` avec le jour du poste, sur les soldes déjà diminués des lignes précédentes de la même vente. Le reste non couvert est provisoire : sortie `lotId` nul, `quantiteProvisoireLocale`, allocation `statut: "PROVISOIRE"`, `provisoire: true` sur la vente. `sortieManuelle` : sortie sur ce lot, allocation `sortieManuelle: true`.
10. `ouvertureConditionnement` : ligne `UNITE` qui prend un lot dont le reliquat était 0 avant la ligne et non nul après (D654).
11. Numéro : plage entamée à la plus petite borne ayant un numéro libre : `numeroTicket`, `numero = formaterNumeroTicket(ordre, n)`. Aucun : `numeroSecours = prochainSecours`, `numero = numeroSecours(ordre, code, n)`, jamais de blocage (D424).
12. Écrit dans **une seule transaction** : session si besoin, `ventes`, `sorties_stock`, `paiements_locaux`, plage ou secours, événement(s). Un échec n'écrit rien, aucun numéro consommé.

Réponse : forme `Vente` complète, coûts absents, `typePiece: "VENTE"`, `statut: "VALIDEE"`, `annulation: null`, `venteOrigine: null`, `jourMetier` de la session, `poste { id, code }`, `pharmacie` de la photographie, `vendeur { id, nom }`, lignes en unités minimales comme le back (`quantite`, `prixUnitaire` par unité minimale, `sousTotal` qui fait foi, `uniteAffichee`, `nombreAffiche`, `coefficientApplique`, `allocations`, `nomMedicament`, `medicamentId`, `id` de ligne = `venteId:index`), `paiements` avec `libelle`, `rendu`.

### 4. Caisse

- Une seule caisse ouverte sur le poste. `ouvrirSession` sur une caisse déjà ouverte par le même vendeur la renvoie (`ouverteMaintenant: false`) ; par un autre : 409 `SESSION_AUTRE_UTILISATEUR`.
- `jourMetier` = `jour()` à l'ouverture (D435, jour d'ouverture).
- Comptage : coupures du référentiel seulement (`VALIDATION` sinon), `nombre` 0 à 10 000, doublon refusé ; déjà saisi : 409 `COMPTAGE_DEJA_SAISI` (sauf même `id`). Relevés seulement à la fermeture, jamais pour les espèces.
- Mouvement : motif 3 à 300, montant 1 à 100 000 000, mode par défaut espèces, `MODE_PAIEMENT_INCONNU`.
- Accès : un vendeur ne touche que sa caisse ; `utilisateur.superviseur` ouvre l'accès aux autres, sinon 403 avec le message du back.
- Bilan : théorique par `calculerTheorique`, sur **tous** les modes du référentiel local ; fond = comptage d'ouverture ; `activite` depuis `paiements_locaux` et `ventes` ; `compte`, `ecarts`, `ecartEspeces`, `seuilEcartCaisse`, `commentaireRequis`, `fige` ; écart jamais corrigé.
- Fermeture : comme le web : sans comptage de fermeture : 409 `COMPTAGE_FERMETURE_REQUIS` (CA18) ; écart au-delà du seuil sans commentaire : 400 `COMMENTAIRE_ECART_REQUIS`. Le back ne les exigera pas au rejeu (D649), le poste les exige à l'écran. Caisse fermée : bilan figé rejoué. Une vente suivante ouvrira une autre caisse.

### 5. Tests `desktop/coeur/` (`:memory:`, horloge et identifiants fixes)

1. CA19 : vente sans caisse : `SESSION_OUVERTE` en séquence n, `VENTE` en n+1, même transaction ; session marquée automatique ;
2. CA5 et CA7 : plaquette de 20, 6 unités : reliquat 14 ; ensuite 16 unités : reliquat d'abord, puis FEFO ;
3. **CA24** : stock 0, vente de 2 boîtes : acceptée, `provisoire`, `quantiteProvisoireLocale`, `lireStock` : `quantite` 0, `quantiteARegulariser` 2 boîtes en unités ; **aucune valeur négative** dans le stock ni dans la réponse ;
4. fiche `PLAQUETTE`, coefficient 10 : vente d'une plaquette : stock 1 boîte et 9 plaquettes (`formaterQuantite`) ; vente sans stock : `formaterARegulariser` « 1 plaquette à régulariser » ;
5. deux prix : boîte 10 000, unité 600 : événement `prixUnitaire` 10 000 ou 600, total exact, CA1 et CA2 ;
6. plage : 3 numéros consécutifs, passage à la plage suivante ; plage épuisée : numéro de secours `S1-D1-1`, puis `S1-D1-2`, `etatLocal().plageEpuisee`, jamais de refus ;
7. périmé seul : `SORTIE_MANUELLE_REQUISE`, puis accepté avec lot et motif, `sortieManuelle` dans l'événement ;
8. ordonnance, paiements mixtes moitié espèces moitié Orange Money (CA16), référence, rendu ;
9. rejeu : même clé : `rejeu: true`, un seul événement, stock décompté une fois ;
10. CA15 complet : 200 000 de fond + 400 000 de ventes - 100 000 de prélèvement, compté 490 000 : bilan -10 000 ; commentaire exigé au-delà du seuil ; fermeture sans comptage refusée ;
11. atomicité : un `Stockage` qui échoue à la dernière écriture : aucune ligne, séquence et numéro intacts ;
12. vendeur différent : 409, superviseur : permis ;
13. deux cœurs, deux bases, mêmes plages différentes : numéros sans collision (CA23, côté poste) ;
14. `corps_evenements.test.ts` de la section 2.

### 6. Annulation venue du serveur (D745)

`enregistrerAnnulationServeur(reponse: Vente)`, appelée par PD04c après une annulation en ligne : la réponse porte `annulation`, `session`, `poste`, `jourMetier`, `paiements` de l'origine. En une transaction, sans événement :
- si `session.id` n'existe pas localement : l'**adopte** (ligne `sessions`, `statut` OUVERTE, `adoptee` 1, `jourMetier` de la réponse) : le serveur a ouvert cette caisse pour ce poste, ouvrir une autre caisse ici ferait fermer la sienne d'office au rejeu (D647) ;
- ajoute à `paiements_locaux` les montants opposés sur cette session, pour que le théorique local reste juste ;
- marque la vente locale annulée dans son document (`statut: "ANNULEE"`, `annulation`), si elle est connue.

Le stock revient par la photographie suivante. Test : théorique diminué, session adoptée, aucun événement créé.

## Fichiers autorisés

`desktop/coeur/**`. Rien sous `src/` : un manque dans les règles se signale au chef.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée.
- Pas de tiret cadratin ni demi-cadratin, français : messages repris du back à la lettre quand le code existe (`codes-erreur.ts`, services de vente et de caisse).
- Jamais de quantité négative dans une réponse du cœur (D713, D719).
- Aucun coût dans une réponse ni un événement.
- Rien sur la base de dev du porteur : aucun appel réseau.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

Dans `desktop/` : `npm run types`, `npm test`. À la racine du front : `docker compose exec -T frontend npx tsc --noEmit` reste vert (dossier exclu).

## Done when

- [ ] Vente en une transaction, sans aucun refus de stock
- [ ] 0 et « N à régulariser », unité plaquette comprise
- [ ] Plages, numéros de secours, CA23 côté poste
- [ ] Caisse complète, CA15 et CA18
- [ ] Corps conformes aux DTO du back, test de contrat vert

## Return

Fichiers touchés, sorties des gates, messages repris du back et leur source, tout écart à la fiche.

## Historique

## Validation
