# PF03a - Ma caisse : état, ouverture en un geste, comptage du fond par coupure

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (vendeur au comptoir, au clavier, connexion lente)
Visuel: oui (nouvelle page composée des éléments existants)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Neuvième sous-fiche (D685). Page « Ma caisse » : le vendeur voit si sa caisse est ouverte (depuis quand, pour quel jour, fond compté ou non), l'ouvre en un geste avec ou sans comptage du fond, ou compte le fond d'une caisse ouverte automatiquement par une vente. Le comptage se fait par coupure (billets du référentiel), au pavé numérique : Entrée passe à la coupure suivante, total en direct. Les mouvements de caisse et la fermeture arrivent en PF03b.

Décisions applicables : D686, D687, D688, D692, D693.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- PF01a : `src/lib/api_caisse.ts` (`getReferentiels`, `assurerPosteWeb`, `getSessionCourante`, types `SessionCaisse`, `ComptageCaisse`, `Coupure`, `Referentiels`), `classes.ts`, `ErreurAvecReessai`, `erreurs_api.ts`, `nouvelleCleIdempotence`. PF01b : badge de caisse de la page de vente (lien « Ma caisse » réservé à cette fiche). `src/app/dashboard/ventes/affichage.ts` : `formaterHeure`, `formaterJour`, `jourConakry`.
- Contrats (back `CLAUDE.md`, puces PB10 et PB17c ; DTO `back_medconnect/src/pharmacie/dto/sessions-caisse.dto.ts` ; service `caisse/sessions-caisse.service.ts`) :
  - `POST /pharmacie/:structureId/caisse/sessions` (`caisse:utiliser`, 200) `{ id? (UUID), posteId (UUID), comptage?: { coupures: [{ valeurFaciale, nombre }] } }` : réponse `data` = session (`SessionCaisse`) avec `cree` et `ouverteMaintenant` ; ouvrir deux fois sur le même poste renvoie la caisse déjà ouverte du même vendeur ; 409 `SESSION_AUTRE_UTILISATEUR`, 409 `POSTE_INCONNU`, 409 `IDENTIFIANT_DEJA_UTILISE`, 409 `JOURNEE_CLOTUREE` ; après une clôture du jour, la caisse compte pour le lendemain et le **message** de la réponse le dit (« Caisse ouverte. La journée d'aujourd'hui est déjà clôturée : cette caisse compte pour le JJ/MM/AAAA. ») : à afficher tel quel.
  - `POST /pharmacie/:structureId/caisse/sessions/:sessionId/comptages` `{ id?, moment: "OUVERTURE" | "FERMETURE", coupures: [{ valeurFaciale, nombre (0 à 10 000) }] (20 au plus), releves? }` : réponse comptage avec `totalEspeces` ; 409 `COMPTAGE_DEJA_SAISI`, 409 `SESSION_FERMEE`, 400 `VALIDATION` (coupure hors référentiel). Coupures permises : celles du référentiel actif (20 000, 10 000, 5 000, 2 000, 1 000, 500 GNF), aucune ligne « pièces et autres » ; relevés Mobile Money seulement à la fermeture.
  - `GET .../caisse/sessions/courante?posteId=` : session ouverte du poste ou `null`.
- Poste web (D692) : `assurerPosteWeb(structureId, user.id)` renvoie le poste par défaut, le même que celui de la vente ; le front n'envoie jamais `posteId` à la vente.
- Jeu démo (PB19a-chef.md) : à Kaloum, caisse web d'Ousmane Keita ouverte aujourd'hui (ventes W1, W2, W3), caisse web du titulaire ouverte avec une annulation.

### 1. `src/lib/api_caisse.ts` (ajouts)

`LigneComptage = { valeurFaciale: number; nombre: number }` ; `ouvrirSession(structureId, corps: { id: string; posteId: string; comptage?: { coupures: LigneComptage[] } })` renvoie `ApiResponse<SessionCaisse & { cree: boolean; ouverteMaintenant: boolean }>` ; `saisirComptage(structureId, sessionId, corps: { id: string; moment: "OUVERTURE" | "FERMETURE"; coupures: LigneComptage[]; releves?: { mode: string; montant: number }[] })`.

### 2. Règle pure `src/app/dashboard/caisse/comptage.ts`

`totalComptage(lignes: LigneComptage[]): number` (somme `valeurFaciale x nombre`) ; `lignesDepuisReferentiel(coupures: Coupure[]): LigneComptage[]` (coupures triées par `ordre`, nombre 0) ; `lignesAEnvoyer(lignes)` (lignes à nombre positif seulement ; aucune ligne : tableau vide accepté par le serveur pour un fond nul). Tests `comptage.test.ts` (3) : total de 2 x 20 000 + 3 x 5 000 + 1 x 500 = 55 500 ; tri par `ordre` ; lignes à 0 retirées.

### 3. Composant `src/app/dashboard/caisse/ComptageCoupures.tsx` (réutilisé par PF03b)

Props : `{ coupures: Coupure[]; valeur: LigneComptage[]; onChange(lignes): void; onTermine(): void; desactive?: boolean; legende: string }`.
- `fieldset` + `legend` ; une ligne par coupure : libellé « Billets de 20 000 GNF » (`formaterGNF` sans la répétition « GNF GNF » : « Billets de » + `formaterGNF(valeurFaciale)`), champ nombre (`inputMode="numeric"`, chiffres seuls, entier 0 à 10 000, `aria-label="Nombre de billets de 20 000 GNF"`), sous-total à droite (`formaterGNF`).
- **Entrée** dans un champ passe au champ suivant (`preventDefault`, aucun envoi de formulaire) ; Entrée dans le dernier champ appelle `onTermine()`. Le premier champ reçoit le focus au montage. Un champ vide compte 0. Le contenu d'un champ est sélectionné à la prise de focus (retaper remplace).
- Total en direct sous la liste : « Total compté : <formaterGNF> » dans une zone `aria-live="polite"`.
- Classes : `CHAMP` pour les champs, pas de carte supplémentaire autour (pas de boîte dans une boîte : le composant est posé dans la carte de la page).

Tests `ComptageCoupures.test.tsx` (3) : 1. Entrée passe du champ « 20 000 » au champ « 10 000 », et du dernier appelle `onTermine` ; 2. total en direct « 55 500 GNF » (espace insécable acceptée) ; 3. une saisie de lettres est ignorée (valeur reste un entier).

### 4. Page `src/app/dashboard/caisse/page.tsx`

Chargement en parallèle : référentiels et état (`assurerPosteWeb` puis `getSessionCourante`) ; chargement : « Chargement de votre caisse... » (`role="status"`) ; erreur : `ErreurAvecReessai` « Votre caisse n'a pas pu être chargée. Vérifiez votre connexion puis réessayez. ».

En-tête : « Ma caisse », sous-titre « Ouvrez votre caisse, comptez le fond, puis fermez-la en fin de service. ». Bandeau `ALERTE_INFO` identique à celui de la vente (D694).

**Caisse fermée** (`session === null`) :
- Texte « Votre caisse est fermée. Elle s'ouvre aussi toute seule à votre première vente, sans fond compté. » ;
- `ComptageCoupures` (légende « Fond de caisse : billets dans le tiroir ») dans une `CARTE` ;
- bouton `BOUTON_PRIMAIRE` « Ouvrir la caisse avec ce fond » (Entrée dans le dernier champ y porte le focus) et bouton `BOUTON_SECONDAIRE` « Ouvrir sans compter » (aide : « Le fond sera compté à 0 et signalé au titulaire à la fermeture. ») ;
- envoi : `ouvrirSession({ id, posteId, comptage: { coupures: lignesAEnvoyer(...) } })` (sans `comptage` pour « Ouvrir sans compter ») ; succès : message du serveur affiché tel quel (`ALERTE_SUCCES`, il peut annoncer le lendemain), état rechargé.

**Caisse ouverte** (`session` de l'utilisateur) :
- `CARTE` « Caisse ouverte » : « Ouverte à <formaterHeure(ouverteLe)> », « Poste : <poste.libelle> (<poste.code>) », si `jourMetier` diffère de `jourConakry(new Date())` : « Ventes comptées pour le <formaterJour(jourMetier)> » ; « Fond de caisse : <formaterGNF(fondCaisse)> » si `fondCompte`, sinon « Fond de caisse : pas encore compté » ;
- si `comptageOuverture === null` : `ComptageCoupures` (légende « Comptez le fond de caisse ») et bouton « Enregistrer le fond » → `saisirComptage({ id, moment: "OUVERTURE", coupures })` ;
- liens `BOUTON_SECONDAIRE` « Nouvelle vente » (`/dashboard/vente`) et, si autorisé, « Ventes du jour » ;
- emplacement réservé aux actions de PF03b (« Mouvement de caisse », « Fermer la caisse ») : rien d'affiché dans cette fiche.

**Caisse ouverte par un autre vendeur** (`session.utilisateurId !== user.id`, cas d'un poste partagé) : « Ce poste est occupé par la caisse de <utilisateurNom>, ouverte à <heure>. » sans aucune action ni montant (le fond n'est pas affiché, D528).

Identifiant client (D688) : un `id` par saisie (ouverture, comptage) créé à l'affichage du formulaire ; échec réseau : « L'opération n'a peut-être pas été enregistrée. Appuyez sur « Réessayer » : elle ne sera pas comptée deux fois. », champs en lecture seule, bouton « Réessayer » (même `id`) ; refus du serveur : message du serveur tel quel (`SESSION_AUTRE_UTILISATEUR`, `POSTE_INCONNU`, `JOURNEE_CLOTUREE`, `COMPTAGE_DEJA_SAISI`, `SESSION_FERMEE`, `VALIDATION`, 403), état rechargé, **aucun réessai**.

### 5. Navigation et lien depuis la vente

- `src/lib/navigation_tableau_de_bord.ts` : entrée après `ventes` : `{ id: "caisse", href: "/dashboard/caisse", icone: Wallet, libelle: { defaut: "Ma caisse" }, acces: perm(["caisse:utiliser"], { typesStructure: P }), rolesRepli: [], raccourci: { description: { defaut: "Ouvrez, comptez et fermez votre caisse" }, degrade: "from-emerald-500 to-teal-500", rolesRepli: [] } }`. Test ajouté : visible pour le rôle « Pharmacien » (qui a `caisse:utiliser`).
- `src/app/dashboard/vente/page.tsx` : à côté du badge de caisse, lien « Ma caisse » (`text-primary-700 dark:text-primary-400 underline`, `FOCUS`) si `estRouteAutorisee("/dashboard/caisse", ...)`.

### 6. Tests `src/app/dashboard/caisse/page.test.tsx` (7)

1. caisse fermée : comptage puis « Ouvrir la caisse avec ce fond » envoie `ouvrirSession` avec `posteId` du poste web, un `id` UUID et les seules coupures non nulles ;
2. « Ouvrir sans compter » : corps sans `comptage` ;
3. message d'ouverture du lendemain affiché tel quel ;
4. caisse ouverte sans fond compté : « Fond de caisse : pas encore compté », « Enregistrer le fond » envoie `moment: "OUVERTURE"` ;
5. caisse d'un autre vendeur : nom affiché, aucun montant ni bouton ;
6. échec réseau puis « Réessayer » : même `id` ;
7. 409 `COMPTAGE_DEJA_SAISI` : message du serveur, état rechargé, pas de bouton « Réessayer ».

## Contraintes

Faire uniquement ce qui est demandé. Audience non-dev : « caisse », jamais « session » à l'écran ; termes interdits absents. Visuel : classes existantes, clair et sombre, AA, focus visible. Montants : `formaterGNF`. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin. Next.js 16 : lire `node_modules/next/dist/docs/` avant de créer la page.

Fichiers autorisés : `src/lib/api_caisse.ts`, `src/lib/api_caisse.test.ts`, `src/lib/navigation_tableau_de_bord.ts`, `src/lib/navigation_tableau_de_bord.pharmacie.test.ts`, `src/app/dashboard/caisse/page.tsx`, `src/app/dashboard/caisse/page.test.tsx`, `src/app/dashboard/caisse/comptage.ts`, `src/app/dashboard/caisse/comptage.test.ts`, `src/app/dashboard/caisse/ComptageCoupures.tsx`, `src/app/dashboard/caisse/ComptageCoupures.test.tsx`, `src/app/dashboard/vente/page.tsx`.

## Test à la main

Démo remise à zéro, **Ousmane Keita** (vendeur, Kaloum) : « Ma caisse » ouverte (ventes W1 à W3), fond compté ou non selon le jeu ; **Djénabou Baldé** : sa caisse web ouverte avec l'annulation. Pour tester l'ouverture : fermer d'abord la caisse (PF03b) ou utiliser **Kadiatou Kourouma** (vendeuse, Pharmacie du Niger) si elle figure dans les comptes de démonstration. Comptage au clavier seul. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `caisse/page.test.tsx` (7), `comptage.test.ts` (3), `ComptageCoupures.test.tsx` (3), navigation (1 ajouté).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -n "posteId" src/app/dashboard/vente/page.tsx` : aucune ligne.
6. Termes interdits absents (dont « session » dans les chaînes visibles) ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
