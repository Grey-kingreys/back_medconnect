# PF03b - Ma caisse : mouvements, bilan et fermeture au clavier

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (vendeur en fin de service)
Visuel: oui (page « Ma caisse » de PF03a étendue)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Dixième sous-fiche (D685), après PF03a. Sur une caisse ouverte : dialogue de mouvement (prélèvement, apport, remboursement) avec motif ; bilan qui montre **d'abord l'activité du vendeur** (ventes, annulations, encaissé par mode), puis le théorique ; fermeture : comptage des espèces par coupure, relevés Orange Money et MTN MoMo facultatifs, écart signé affiché tel quel, commentaire exigé au-delà du seuil de la pharmacie. La fermeture complète se fait au clavier seul.

Décisions applicables : D686, D687, D688, D693, D698.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- PF03a : page `src/app/dashboard/caisse/page.tsx` (états caisse fermée / ouverte / autre vendeur, emplacement réservé aux actions), `ComptageCoupures.tsx`, `comptage.ts` (`totalComptage`, `lignesAEnvoyer`, `lignesDepuisReferentiel`), `api_caisse.ts` (`ouvrirSession`, `saisirComptage`, types). PF01a : `classes.ts`, `ErreurAvecReessai`, `erreurs_api.ts`, `nouvelleCleIdempotence`. Gabarit de dialogue : `src/app/dashboard/ventes/AnnulationVente.tsx`.
- Contrats (back `CLAUDE.md`, puce PB10 ; DTO `sessions-caisse.dto.ts` ; service `sessions-caisse.service.ts`, types `BilanSession` lignes 108 à 130, `MouvementCaisseReponse`) :
  - `POST .../caisse/sessions/:sessionId/mouvements` `{ id? (UUID), type: "PRELEVEMENT" | "APPORT" | "REMBOURSEMENT", montant (1 à 100 000 000), motif (300 au plus, obligatoire : 400 MOTIF_REQUIS), mode? (code, espèces par défaut) }` ; messages « Prélèvement enregistré. », « Apport enregistré. », « Remboursement enregistré. » ; 409 `SESSION_FERMEE`, 409 `JOURNEE_CLOTUREE`.
  - `GET .../caisse/sessions/:sessionId/bilan` : `data { activite: { nombreVentes, nombreAnnulations, montantEncaisse, parMode: [{ mode, libelle, montant, nombrePaiements }] }, session, fond: { montant, compte }, mouvements: [{ id, type, mode, montant, motif, auteurId, horodatageServeur }], theorique: [{ mode, libelle, montant }], compte: [{ mode, libelle, montant | null }], ecarts: [{ mode, libelle, ecart | null }], ecartEspeces: number | null, seuilEcartCaisse, commentaireRequis, fige }`.
  - `POST .../caisse/sessions/:sessionId/fermer` `{ comptageFermeture?: { id?, coupures, releves?: [{ mode, montant }] }, commentaire? (500) }` : réponse bilan figé (`fige: true`) ; 400 `COMPTAGE_FERMETURE_REQUIS`, 400 `COMMENTAIRE_ECART_REQUIS` (écart espèces en valeur absolue au-dessus de `seuilEcartCaisse`), 409 `SESSION_FERMEE`, 409 `JOURNEE_CLOTUREE` ; relevés seulement pour les modes sans comptage physique (`comptagePhysique === false` du référentiel) ; un relevé absent laisse le compté de ce mode à `null` (« non rapproché », jamais 0) ; écart jamais corrigé ; fermeture sans comptage d'ouverture : fond 0 et anomalie `FOND_NON_COMPTE` au titulaire.
- Jeu démo : Kaloum, caisse d'Ousmane Keita ouverte avec W1 (espèces), W2 (Orange Money, vente en attente de stock), W3 (annulée par le titulaire) ; seuil d'écart par défaut des paramètres.

### 1. `src/lib/api_caisse.ts` (ajouts)

Types `MouvementCaisse`, `BilanCaisse` (conformes au contrat) ; `enregistrerMouvement(structureId, sessionId, corps: { id: string; type; montant: number; motif: string; mode?: string })`, `getBilan(structureId, sessionId)`, `fermerSession(structureId, sessionId, corps: { comptageFermeture: { id: string; coupures: LigneComptage[]; releves?: { mode: string; montant: number }[] }; commentaire?: string })`.

### 2. Bilan sur la page (caisse ouverte de l'utilisateur)

Chargé par `getBilan` à l'affichage de la caisse ouverte et après chaque mouvement ; erreur : `ErreurAvecReessai` dans le bloc. Bloc « Votre activité » (`CARTE`), dans cet ordre : « Ventes : <nombreVentes> », « Annulations : <nombreAnnulations> », « Encaissé : <formaterGNF(montantEncaisse)> », puis une ligne par mode (« Orange Money : 87 000 GNF (3 paiements) »). Puis bloc « Mouvements de caisse » : liste (« Prélèvement de 100 000 GNF, Dépôt au coffre, à 14:05 ») ou « Aucun mouvement de caisse. ». Puis « Attendu dans la caisse » : une ligne par mode du `theorique`.

### 3. Dialogue « Mouvement de caisse » (`src/app/dashboard/caisse/MouvementCaisse.tsx`)

Bouton `BOUTON_SECONDAIRE` « Mouvement de caisse » sur la caisse ouverte. Dialogue (gabarit `AnnulationVente.tsx`, icône `ArrowLeftRight`) : type en boutons radio « Prélèvement (sortie d'argent) », « Apport (ajout d'argent) », « Remboursement d'un client » (aucun présélectionné) ; « Montant (GNF) » entier ; « Mode » : liste des modes du référentiel, « Espèces » par défaut (envoyé seulement s'il diffère des espèces) ; « Motif » obligatoire (3 à 300, aide « Par exemple : dépôt au coffre, monnaie apportée ») ; boutons « Enregistrer » et « Annuler ». Refus local : « Choisissez le type, indiquez un montant et un motif de 3 caractères au moins. ». Identifiant client et échec réseau : comme PF03a (« Réessayer », même `id`). Succès : message du serveur en `ALERTE_SUCCES` sur la page, bilan rechargé.

### 4. Fermeture (`src/app/dashboard/caisse/FermetureCaisse.tsx`)

Bouton `BOUTON_PRIMAIRE` « Fermer la caisse » sur la caisse ouverte ; il déplie (dans la page, pas de dialogue) le bloc de fermeture :
1. Rappel de l'activité (repris du bilan, déjà affiché au-dessus : le bloc commence par « Comptez l'argent de votre caisse. »).
2. `ComptageCoupures` (légende « Espèces dans le tiroir ») ; focus sur le premier billet à l'ouverture du bloc ; Entrée dans le dernier billet passe au premier relevé.
3. Pour chaque mode à `comptagePhysique === false` (Orange Money, MTN MoMo) : champ « Relevé <libellé> (facultatif) » (entier, aide « Montant reçu sur le téléphone de la pharmacie pendant votre service. ») ; Entrée passe au champ suivant ; vide = non envoyé.
4. Aperçu des écarts, recalculé en direct **par simple soustraction du théorique renvoyé par le serveur** (aucune autre règle) : espèces : « Écart espèces : <signe><formaterGNF(compté - théorique ESPECES)> » (« +2 000 GNF », « -10 000 GNF », « aucun écart » si 0 ; négatif en `text-rose-700 dark:text-rose-300`) ; mode Mobile Money sans relevé : « <libellé> : non rapproché » (jamais d'écart affiché), avec relevé : écart signé comme pour les espèces.
5. « Commentaire » : textarea (500) ; **obligatoire** si la valeur absolue de l'écart espèces dépasse `seuilEcartCaisse` du bilan (libellé « Commentaire (obligatoire : écart supérieur à <formaterGNF(seuil)>) »), sinon facultatif.
6. Bouton « Fermer ma caisse » ; Entrée dans le dernier relevé ou dans le commentaire (Ctrl+Entrée pour la zone de texte) y porte le focus ; activation : dialogue de confirmation (gabarit `ConfirmationVente.tsx`) « Fermer la caisse ? », texte « Espèces comptées : <formaterGNF>. Après la fermeture, plus aucune vente ne peut être ajoutée à cette caisse. », bouton « Confirmer la fermeture » focalisé à l'ouverture (Entrée confirme), « Revenir ».
7. Envoi : `fermerSession({ comptageFermeture: { id, coupures: lignesAEnvoyer(...), releves }, commentaire })`, un `id` de comptage créé à l'ouverture du bloc.
8. Succès : écran « Caisse fermée » (gabarit du succès de la vente) avec le bilan figé renvoyé : activité, puis par mode « Attendu », « Compté » (« non rapproché » si `null`), « Écart » (signé, rien si `null`), et le commentaire ; boutons « Retour à l'accueil » et « Ouvrir une nouvelle caisse » (recharge la page). Si `fond.compte === false` : « Le fond n'avait pas été compté : il est enregistré à 0 et signalé au titulaire. ».
9. Erreurs : `COMMENTAIRE_ECART_REQUIS` : message du serveur, focus sur le commentaire ; `COMPTAGE_FERMETURE_REQUIS`, `SESSION_FERMEE`, `JOURNEE_CLOTUREE`, `VALIDATION`, 403 : message du serveur, état rechargé ; réseau : « La fermeture n'a peut-être pas été enregistrée. Appuyez sur « Réessayer » : elle ne sera pas faite deux fois. », champs en lecture seule, « Réessayer » rejoue le même corps (même `id` de comptage) ; si la réponse du réessai est 409 `SESSION_FERMEE`, afficher « Votre caisse est déjà fermée. » et recharger (la première tentative avait abouti).

### 5. Tests

`src/app/dashboard/caisse/FermetureCaisse.test.tsx` (7) :
1. « fermeture complète au clavier » : uniquement `keyDown` Entrée et `change` des champs (aucun clic) depuis l'ouverture du bloc : billets saisis, Entrée de champ en champ, relevé Orange Money, Entrée vers « Fermer ma caisse », Entrée qui l'active, Entrée sur « Confirmer la fermeture » ; `fermerSession` appelée une fois avec les coupures non nulles, le relevé et un `id` UUID ;
2. aperçu : compté 490 000 pour un théorique espèces de 500 000 affiche « -10 000 GNF » (CA15) ;
3. Mobile Money sans relevé : « non rapproché » et aucun écart ;
4. écart au-delà du seuil : commentaire marqué obligatoire et fermeture refusée localement sans lui ;
5. 400 `COMMENTAIRE_ECART_REQUIS` : message du serveur, focus sur le commentaire ;
6. échec réseau, « Réessayer », puis 409 `SESSION_FERMEE` : « Votre caisse est déjà fermée. » ;
7. bilan figé : compté `null` affiché « non rapproché » ; `fond.compte` faux affiche le texte du fond non compté.

`src/app/dashboard/caisse/MouvementCaisse.test.tsx` (3) : 1. prélèvement de 100 000 avec motif envoie `{ id, type: "PRELEVEMENT", montant: 100000, motif }` sans `mode` ; 2. motif vide : aucun envoi, message exact ; 3. 409 `SESSION_FERMEE` : message du serveur.

`src/app/dashboard/caisse/page.test.tsx` (1 ajouté) : sur une caisse ouverte, l'activité (« Ventes : 3 ») s'affiche avant « Attendu dans la caisse ».

## Contraintes

Faire uniquement ce qui est demandé ; l'écart affiché à l'aperçu n'est qu'une soustraction, le bilan figé du serveur fait foi. Audience non-dev : « caisse », « attendu », « compté », jamais « session », « théorique » à l'écran ; termes interdits absents. Visuel : classes existantes, clair et sombre, AA ; un écart n'est jamais coloré en vert s'il n'est pas nul. Montants : `formaterGNF` (signe « + » ajouté à la main devant un écart positif). Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_caisse.ts`, `src/lib/api_caisse.test.ts`, `src/app/dashboard/caisse/page.tsx`, `src/app/dashboard/caisse/page.test.tsx`, `src/app/dashboard/caisse/MouvementCaisse.tsx`, `src/app/dashboard/caisse/MouvementCaisse.test.tsx`, `src/app/dashboard/caisse/FermetureCaisse.tsx`, `src/app/dashboard/caisse/FermetureCaisse.test.tsx`.

## Test à la main

Démo remise à zéro, **Ousmane Keita** (vendeur, Kaloum) : « Ma caisse », activité (W1, W2, W3), prélèvement de 100 000 « Dépôt au coffre », fermeture au clavier avec un relevé Orange Money, puis écart volontaire au-delà du seuil pour voir le commentaire exigé ; caisse fermée, puis ouverture d'une nouvelle (PF03a). Ensuite **Djénabou Baldé** voit l'écart dans la file d'anomalies (PF06a) et la caisse dans la préparation de clôture (PF05). Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `FermetureCaisse.test.tsx` (7), `MouvementCaisse.test.tsx` (3), page de caisse (1 ajouté).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
