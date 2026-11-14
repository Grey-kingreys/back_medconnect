# PF05 - Clôture journalière : préparation, clôture, clôture forcée, export

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire en fin de journée, ou le lendemain matin)
Visuel: oui (nouvelle page composée des éléments existants)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Douzième sous-fiche (D685). Page « Clôture de caisse » réservée à `cloture:gerer` : pour un jour choisi (aujourd'hui par défaut), la préparation du serveur (caisses du jour, caisses encore ouvertes, postes attendus nommés avec leur message, totaux par mode attendus et comptés), la clôture, la clôture forcée avec motif quand le serveur la permet, l'export CSV d'une journée clôturée, la liste des clôtures du mois, et les sommes arrivées après la clôture ou la fermeture d'une caisse (anomalies `REMONTEE_APRES_CLOTURE`) que les totaux ne comptent pas. **Le front ne recalcule rien** : il affiche la préparation.

Décisions applicables : D686, D687, D693, D698, D702, D704.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- Aucune page de clôture. PF01a : `api_caisse.ts`, `classes.ts`, `ErreurAvecReessai`, `erreurs_api.ts`. `src/lib/api_auth.ts` : `authDownload(endpoint)` (jeton, rafraîchissement, `{ blob, filename }` tiré de `Content-Disposition`) ; modèle de téléchargement d'un `Blob` : `ImportStockModal.tsx`, fonction `telechargerModele` (lignes 204 à 230 : `URL.createObjectURL`, lien temporaire, `revokeObjectURL`). `src/app/dashboard/ventes/affichage.ts` : `formaterJour`, `formaterDateHeure`, `jourConakry`.
- Contrats (back `CLAUDE.md`, puces PB17a, PB17b, PB17c, PB18, « Exploitation » ; types `back_medconnect/src/pharmacie/caisse/clotures.service.ts` lignes 92 à 133 et `cloture-regles.ts` lignes 24 à 38 et 146 à 153) :
  - `GET /pharmacie/:structureId/caisse/clotures/:jour/preparation` (`cloture:gerer`) : `data { jour, cloture: ClotureReponse | null, sessions: SessionResume[], sessionsOuvertes: SessionResume[], postesAttendus: [{ posteId, posteCode, libelle, type, raison, sessionId, utilisateurNom, dernierContactLe, message }], totaux: [{ mode, libelle, theorique, compte | null, ecart | null, sessionsNonRapprochees }], peutCloturer, peutForcer }` ; `SessionResume { id, posteId, posteCode, posteLibelle, posteType, utilisateurId, utilisateurNom, statut, ouverteLe, fermeeLe }` ; 400 `JOUR_AVANT_DEBUT_CAISSE`, 400 `VALIDATION` (`jourFutur`).
  - `POST /pharmacie/:structureId/caisse/clotures` `{ jour, forcer?, motifForcage? (3 à 500) }` : clôture (`ClotureReponse { id, jour, clotureeLe, clotureParId, clotureParNom, forcee, motifForcage, postesManquants, nombreSessions, totaux }`) ; 409 `CLOTURE_INCOMPLETE` et 409 `CAISSES_A_FERMER` (message global qui nomme les postes, `details[].message` poste par poste), 400 `MOTIF_REQUIS`, 409 `JOURNEE_DEJA_CLOTUREE` (recharger la préparation).
  - `GET .../caisse/clotures?mois=AAAA-MM` : clôtures du mois (même forme).
  - `GET .../caisse/clotures/:jour/export` : CSV `cloture-AAAA-MM-JJ.csv` (point-virgule, UTF-8 avec BOM, apostrophes de neutralisation) ; 409 `JOURNEE_NON_CLOTUREE`, 400 `VALIDATION` (`jourFutur`, `dateValide`), 400 `JOUR_AVANT_DEBUT_CAISSE`. **Ne jamais réécrire ni recoder le fichier** (D702).
  - Forcer : permis seulement si tous les postes attendus sont des postes desktop (`peutForcer`) ; une caisse web ouverte se ferme d'abord avec son comptage (`CAISSES_A_FERMER`). Un compté `null` = « non rapproché » (un relevé Mobile Money manque), jamais 0, pas d'écart.
  - `GET /pharmacie/:structureId/anomalies?type=REMONTEE_APRES_CLOTURE&statut=OUVERTE` (`anomalie:gerer`, D704) : éléments `{ id, libelle, creeLe, details: { message, ... }, ... }` (puce PB15a) ; argent d'une régularisation hors clôture et paiement arrivé après la fermeture d'une caisse du jour, non comptés par les totaux (puce « Exploitation »).
- Jeu démo (PB19a-chef.md) : Kaloum, J-2 clôturée (espèces attendu 213 000, compté 211 000, écart -2 000 ; Orange Money 87 000 ; MTN MoMo 47 000), export de 6 pièces, 7 paiements et un prélèvement de 100 000 ; J-1 clôturée de force, poste D1 « Comptoir principal » manquant, avec motif ; aujourd'hui à clôturer, caisses web ouvertes (Ousmane Keita et le titulaire) ; anomalie `REMONTEE_APRES_CLOTURE` ouverte.

### 1. `src/lib/api_caisse.ts` (ajouts)

Types `SessionResume`, `PosteAttendu`, `TotalCloture`, `Cloture`, `PreparationCloture` ; `getPreparationCloture(structureId, jour)`, `cloturerJournee(structureId, corps: { jour: string; forcer?: true; motifForcage?: string })`, `listerClotures(structureId, mois: string)`, `exporterCloture(structureId, jour)` = `authDownload(...)` renvoyant `{ blob, filename: filename ?? "cloture-<jour>.csv" }`.

### 2. Navigation

Entrée après `caisse` : `{ id: "clotures", href: "/dashboard/clotures", icone: CalendarCheck, libelle: { defaut: "Clôture de caisse" }, acces: perm(["cloture:gerer"], { typesStructure: P }), rolesRepli: [] }`. Test ajouté (visible avec `cloture:gerer`, refusée au rôle « Pharmacien »).

### 3. Page `src/app/dashboard/clotures/page.tsx`

- En-tête : « Clôture de caisse », sous-titre « Vérifiez les caisses de la journée, puis clôturez-la. Une journée clôturée ne change plus. ».
- Choix du jour : champ date (défaut `jourConakry(new Date())`, `max` aujourd'hui) et lien « Aujourd'hui » ; titre de la journée `formaterJour(jour)`.
- Préparation chargée à chaque changement de jour ; chargement « Chargement de la journée... » ; erreurs `JOUR_AVANT_DEBUT_CAISSE` et `VALIDATION` : message du serveur (pas de bouton) ; réseau : `ErreurAvecReessai`.

**Journée déjà clôturée** (`cloture` non nul) : `ALERTE_SUCCES` « Journée clôturée le <formaterDateHeure(clotureeLe)> par <clotureParNom ou « un administrateur »>. » ; si `forcee` : `ALERTE_ATTENTION` « Clôture forcée. Motif : <motifForcage> » et la liste des `postesManquants` (« <libelle> (<posteCode>) ») ; tableau des totaux de la clôture (voir plus bas) ; bouton `BOUTON_PRIMAIRE` « Télécharger le fichier Excel (CSV) ». Aucun bouton de clôture.

**Journée à clôturer** :
- Bloc « Caisses de la journée » (`CARTE`) : une ligne par `sessions` : « <posteLibelle> (<posteCode>), <utilisateurNom> », « ouverte à <heure> », statut « Ouverte » / « Fermée à <heure> » / « Incluse dans une clôture » ; aucune : « Aucune caisse ce jour-là. La journée peut être clôturée à vide. ».
- Bloc « À régler avant de clôturer » (si `postesAttendus` non vide) : une ligne par poste avec son `message` tel quel (texte du serveur), en `ALERTE_ATTENTION` ; pour un poste web : aide « Le vendeur doit fermer sa caisse depuis « Ma caisse », avec le comptage. ».
- Bloc « Totaux par mode » : tableau « Mode », « Attendu », « Compté », « Écart » ; compté `null` : « non rapproché » et écart vide, avec sous-texte « <sessionsNonRapprochees> caisse(s) sans relevé » ; écart signé (« +2 000 GNF », « -2 000 GNF », « aucun »), négatif en `text-rose-700 dark:text-rose-300`.
- Bloc « Sommes arrivées après une clôture » : chargé par la liste des anomalies `REMONTEE_APRES_CLOTURE` ouvertes, si l'utilisateur a `anomalie:gerer` ; une ligne par anomalie avec `details.message` tel quel ; aide « Ces sommes ne sont pas dans les totaux ci-dessus. Recomptez le tiroir concerné, puis traitez l'anomalie dans « Anomalies ». » et lien vers `/dashboard/anomalies` (page de PF06a) ; aucune : bloc absent ; erreur de cette lecture : ligne « Les sommes arrivées après une clôture n'ont pas pu être vérifiées. » sans bloquer la page.
- Actions : bouton `BOUTON_PRIMAIRE` « Clôturer la journée » actif si `peutCloturer` ; sinon désactivé avec « Réglez les points ci-dessus pour pouvoir clôturer. ». Si `peutForcer` : bouton `BOUTON_SECONDAIRE` « Clôturer quand même (poste hors connexion) ».
- Confirmation de clôture (gabarit `ConfirmationVente.tsx`) : « Clôturer la journée du <formaterJour(jour)> ? », texte « Après la clôture, plus aucune vente ni correction ne peut être ajoutée à cette journée : une correction se fera par une annulation, comptée le jour où elle est faite. », boutons « Confirmer la clôture » et « Revenir ».
- Clôture forcée (gabarit `AnnulationVente.tsx`) : titre « Clôturer sans le poste hors connexion ? », liste des postes attendus, texte « Les ventes de ce poste remontées plus tard seront comptées le jour de leur arrivée et signalées. », « Motif » obligatoire (3 à 500, aide « Par exemple : poste en panne, coupure de courant »), boutons « Clôturer quand même » et « Revenir » ; envoi `{ jour, forcer: true, motifForcage }`.
- Succès : préparation rechargée (la journée apparaît clôturée), message du serveur en `ALERTE_SUCCES`.
- Erreurs : `CLOTURE_INCOMPLETE` et `CAISSES_A_FERMER` : message global en titre d'un `ALERTE_ERREUR`, puis `details[].message` en liste, préparation rechargée ; `JOURNEE_DEJA_CLOTUREE` : préparation rechargée sans message d'erreur (elle montre la clôture) ; `MOTIF_REQUIS` : message dans le dialogue ; 403 : message du serveur ; réseau : « La clôture n'a peut-être pas été enregistrée. Appuyez sur « Vérifier » pour recharger la journée. » avec le bouton « Vérifier » (recharge la préparation ; jamais de renvoi automatique de la clôture).

**Export** (D702) : `exporterCloture` puis téléchargement du `Blob` **tel quel** par un lien temporaire (`download` = `filename`), comme `telechargerModele` d'`ImportStockModal.tsx` ; jamais de `text()`, de reconstruction ni d'ouverture d'URL dans un onglet ; état « Préparation du fichier... » sur le bouton ; erreurs : message du serveur (`JOURNEE_NON_CLOTUREE`, `VALIDATION`, `JOUR_AVANT_DEBUT_CAISSE`, 403) ou « Le fichier n'a pas pu être téléchargé. Vérifiez votre connexion puis réessayez. ».

**Clôtures du mois** (bas de page, `CARTE`) : `listerClotures(structureId, mois du jour choisi)` ; une ligne par clôture : `formaterJour(jour)`, « forcée » le cas échéant, total attendu des espèces, lien « Voir » qui sélectionne ce jour ; aucune : « Aucune journée clôturée ce mois-ci. ».

### 4. Tests `src/app/dashboard/clotures/page.test.tsx` (9)

1. journée à clôturer : caisses listées, totaux, compté `null` affiché « non rapproché » sans écart ;
2. `peutCloturer` faux : bouton désactivé et message des postes attendus tel quel ;
3. clôture confirmée : `cloturerJournee(s1, { jour })` puis préparation rechargée ;
4. `peutForcer` : motif de 2 caractères refusé localement ; motif valide envoie `{ jour, forcer: true, motifForcage }` ;
5. 409 `CAISSES_A_FERMER` : message global et `details[].message` affichés ;
6. 409 `JOURNEE_DEJA_CLOTUREE` : préparation rechargée, pas de message d'erreur ;
7. journée clôturée forcée : motif et poste manquant affichés, bouton d'export présent, aucun bouton de clôture ;
8. export : `exporterCloture` appelé, le `Blob` reçu est passé tel quel à `URL.createObjectURL` (même objet), lien au nom `cloture-2026-10-30.csv` ;
9. anomalie `REMONTEE_APRES_CLOTURE` ouverte : son `details.message` affiché dans « Sommes arrivées après une clôture ».

## Contraintes

Faire uniquement ce qui est demandé ; aucun calcul de total, d'écart ni de poste attendu côté front (sauf le total attendu des espèces de la liste mensuelle, lu tel quel dans `totaux`). Audience non-dev : « caisse », « poste de caisse », « attendu », « compté », jamais « session », « théorique », « CSV » seul (dire « fichier Excel (CSV) ») ; termes interdits absents. Visuel : classes existantes, clair et sombre, AA. Montants : `formaterGNF`. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin. Next.js 16 : lire `node_modules/next/dist/docs/`.

Fichiers autorisés : `src/lib/api_caisse.ts`, `src/lib/api_caisse.test.ts`, `src/lib/navigation_tableau_de_bord.ts`, `src/lib/navigation_tableau_de_bord.pharmacie.test.ts`, `src/app/dashboard/clotures/page.tsx`, `src/app/dashboard/clotures/page.test.tsx`. Lecture des anomalies : fonction `listerRemonteesApresCloture(structureId)` dans `api_caisse.ts` (`authFetch` sur `/pharmacie/:id/anomalies?type=REMONTEE_APRES_CLOTURE&statut=OUVERTE`, renvoie `data.anomalies`) ; PF06a la fera reposer sur `listerAnomalies` de `api_pilotage.ts`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : « Clôture de caisse » : aujourd'hui non clôturable (caisses web ouvertes, messages par poste), J-1 clôturée de force (motif, D1 manquant), J-2 clôturée (écart -2 000) et export du fichier ouvert dans Excel (accents, montants négatifs intacts) ; sommes arrivées après une clôture (T9). Après fermeture des deux caisses web (PF03b), clôture d'aujourd'hui. **Ousmane Keita** : pas d'entrée « Clôture de caisse ». Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `clotures/page.test.tsx` (9), navigation (1 ajouté).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -n "\.text()\|new Blob" src/app/dashboard/clotures src/lib/api_caisse.ts` : aucune ligne.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
