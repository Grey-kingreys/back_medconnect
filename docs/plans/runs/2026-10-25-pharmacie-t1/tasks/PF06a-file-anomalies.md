# PF06a - File d'anomalies : liste, filtres, traitement avec commentaire, badge sur l'accueil

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire)
Visuel: oui (nouvelle page et une carte sur l'accueil « pilotage » existant)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Treizième sous-fiche (D685). Page « Anomalies » (`anomalie:gerer`) : file paginée des anomalies ouvertes ou traitées, filtre par type, message lisible du serveur, état du rattachement des ventes faites sans stock (une `STOCK_NEGATIF` reste ouverte après rattachement : le montrer pour éviter un double traitement, D577), traitement une seule fois avec commentaire. Sur l'accueil « pilotage », une carte « Anomalies à traiter » avec le compteur `ouvertes`.

Décisions applicables : D686, D687, D693, D704.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- Aucune page d'anomalies. `src/components/dashboard/PilotagePharmacie.tsx` : cartes (`Carte`, `Valeur`, `Chargement` d'`ApercuPharmacie.tsx`), états `chargement / pret / erreur / masque` (403 donne `masque`), `DroitsPilotage`, liens `liensPilotage`. `src/app/dashboard/page.tsx` lignes 217 à 236 : construction de `droitsPilotage` depuis le contexte d'accès. PF05 : `listerRemonteesApresCloture` dans `api_caisse.ts`. PF01a : `classes.ts`, `ErreurAvecReessai`, `erreurs_api.ts`. Gabarit de liste paginée : `src/app/dashboard/ventes/page.tsx` ; de dialogue à commentaire : `AnnulationVente.tsx`.
- Contrats (back `CLAUDE.md`, puce PB15a ; DTO `anomalies.dto.ts` ; service `anomalies/anomalies.service.ts` lignes 34 à 47, `domaine/anomalies.ts` lignes 15 à 32) : `GET /pharmacie/:structureId/anomalies?statut=OUVERTE|TRAITEE&type=&page=` (`anomalie:gerer`, `OUVERTE` par défaut, 20 par page) : `data { anomalies: [{ id, type, libelle, statut, creeLe, pieceType, pieceId, details (dont details.message, texte à afficher tel quel), attribueeA: { id, nom } | null, traiteeLe, traiteePar, commentaireTraitement, rattachement: { etat: "EN_ATTENTE" | "PARTIELLE" | "RATTACHEE" | "VENTE_ANNULEE", quantiteInitiale, quantiteEnAttente, message } | null }], page, parPage, total, ouvertes }` (`ouvertes` indépendant du filtre) ; types : `STOCK_NEGATIF`, `ECART_INVENTAIRE`, `CONDITIONNEMENT_CONCURRENT`, `REMONTEE_APRES_CLOTURE`, `ECART_CAISSE`, `FOND_NON_COMPTE`, `PLAGE_EPUISEE`, `PRIX_DIVERGENT`, `ORDONNANCE_NON_CONFIRMEE`, `VENTE_UNITE_INTERDITE`, `PRODUIT_ARCHIVE`, `EVENEMENT_REJETE`, `SEQUENCE_MANQUANTE` (libellés lisibles fournis par `libelle`). `PATCH .../anomalies/:anomalieId` `{ commentaire (3 à 500) }` : élément relu ; 409 `ANOMALIE_DEJA_TRAITEE` (un autre l'a traitée), 400 `VALIDATION`.
- Jeu démo (PB19a-chef.md) : Kaloum, ouvertes : `STOCK_NEGATIF` (W2), deux `ECART_INVENTAIRE` (Glucophage -5, Augmentin +16), `REMONTEE_APRES_CLOTURE` (`JOURNEE_CLOTUREE`, au vendeur) ; traitée : une `REMONTEE_APRES_CLOTURE` avec son commentaire.

### 1. `src/lib/api_pilotage.ts` (nouveau, D686)

Commentaire de tête : « Pilotage d'une pharmacie : anomalies, alertes de péremption, marge. Contrat aligné sur back_medconnect (orch/pharmacie-t1-back, CLAUDE.md puces PB15a et PB16a). » Types `TypeAnomalie`, `Rattachement`, `Anomalie`, `PageAnomalies` ; `listerAnomalies(structureId, options: { statut?: "OUVERTE" | "TRAITEE"; type?: TypeAnomalie; page?: number } = {})` (paramètres absents non envoyés), `traiterAnomalie(structureId, anomalieId, commentaire)`. `src/lib/api_caisse.ts` : `listerRemonteesApresCloture` devient un appel à `listerAnomalies(structureId, { type: "REMONTEE_APRES_CLOTURE", statut: "OUVERTE" })` renvoyant `data.anomalies` (signature inchangée).

Tests `src/lib/api_pilotage.test.ts` (2) : URL avec `statut=TRAITEE&type=ECART_CAISSE&page=2` ; `traiterAnomalie` envoie `PATCH` `{ commentaire }`.

### 2. Navigation

Entrée après `clotures` : `{ id: "anomalies", href: "/dashboard/anomalies", icone: AlertTriangle, libelle: { defaut: "Anomalies" }, acces: perm(["anomalie:gerer"], { typesStructure: P }), rolesRepli: [] }`. Test ajouté.

### 3. Page `src/app/dashboard/anomalies/page.tsx`

- En-tête : « Anomalies », sous-titre « Ce qui demande votre attention : écarts de caisse et d'inventaire, ventes sans stock, ventes remontées après une clôture. ».
- Onglets « À traiter (<ouvertes>) » et « Traitées » (`role="tablist"`, `aria-selected`, flèches gauche et droite) ; liste déroulante « Type » (« Tous les types » puis les 13 types avec libellés : « Vente sans stock », « Écart d'inventaire », « Boîte entamée en double », « Vente remontée après clôture », « Écart de caisse », « Fond de caisse non compté », « Numéros de ticket épuisés », « Prix différent au poste », « Ordonnance non confirmée », « Vente à l'unité refusée », « Produit archivé vendu », « Opération de caisse rejetée », « Opération de caisse manquante ») ; changer d'onglet ou de type revient à la page 1.
- Une carte par anomalie (`CARTE`, sans boîte imbriquée) : `libelle` en titre, `formaterDateHeure(creeLe)`, « Pour : <attribueeA.nom> » si présent, `details.message` tel quel (si absent : « Pas de détail. ») ; si `rattachement` : son `message` tel quel, et si `etat === "RATTACHEE"` ou `"VENTE_ANNULEE"` : `ALERTE_SUCCES` « Le stock est déjà régularisé : il reste seulement à confirmer que c'est vérifié. » ; anomalie traitée : « Traitée le <date> par <traiteePar.nom> : <commentaireTraitement> ».
- Bouton `BOUTON_PRIMAIRE` « Marquer comme traitée » sur une anomalie ouverte : dialogue (gabarit `AnnulationVente.tsx`, icône `CheckCircle2`) titre « Marquer comme traitée », rappel du libellé et du message, champ « Ce que vous avez vérifié ou fait » (3 à 500, obligatoire), boutons « Enregistrer » et « Annuler » ; refus local « Indiquez ce que vous avez vérifié ou fait (3 caractères au moins). ».
- Succès : liste et compteur rechargés, message du serveur en `ALERTE_SUCCES`. 409 `ANOMALIE_DEJA_TRAITEE` : message du serveur dans le dialogue, liste rechargée à la fermeture ; 400, 403 : message du serveur ; réseau : « Le traitement n'a peut-être pas été enregistré. Fermez cette fenêtre et vérifiez la liste. » (pas de réessai : un second envoi serait refusé par `ANOMALIE_DEJA_TRAITEE` si le premier avait abouti).
- Vide : onglet « À traiter » : « Aucune anomalie à traiter. Tout est en ordre. » ; « Traitées » : « Aucune anomalie traitée pour ce filtre. ». Erreur de chargement : `ErreurAvecReessai`. Pagination comme `ventes/page.tsx`.

### 4. Accueil « pilotage »

- `DroitsPilotage` gagne `peutVoirAnomalies: boolean` (route `/dashboard/anomalies` autorisée), calculé dans `src/app/dashboard/page.tsx` comme les autres droits.
- `PilotagePharmacie.tsx` : si `peutVoirAnomalies`, chargement de `listerAnomalies(structureId)` (une page, statut par défaut) et carte `Carte` « Anomalies à traiter » (icône `AlertTriangle`, couleur `text-amber-600 dark:text-amber-400`) avec `Valeur` = `ouvertes`, sous-texte « Ouvrez la file pour les traiter » et la carte entière cliquable vers `/dashboard/anomalies` (lien englobant, focus visible) ; 0 : sous-texte « Tout est en ordre » ; états `chargement`, `erreur` (« Indisponible » + « Réessayer », comme la carte de l'équipe), `masque` sur 403. Lien « Anomalies » ajouté à `liensPilotage` après « Ventes du jour ».

### 5. Tests

`src/app/dashboard/anomalies/page.test.tsx` (7) : 1. onglet « À traiter (4) » avec le compteur `ouvertes` ; 2. `details.message` affiché tel quel ; 3. `STOCK_NEGATIF` rattachée : message de rattachement et texte « Le stock est déjà régularisé... » ; 4. traitement : commentaire envoyé, liste rechargée ; 5. commentaire de 2 caractères : aucun envoi ; 6. 409 `ANOMALIE_DEJA_TRAITEE` : message du serveur ; 7. filtre « Écart de caisse » : appel avec `type=ECART_CAISSE` et `page` 1.

`src/components/dashboard/PilotagePharmacie.test.tsx` (2 ajoutés) : carte « Anomalies à traiter » avec 4 et lien vers `/dashboard/anomalies` ; absente sans `peutVoirAnomalies`. Adapter `src/app/dashboard/page.test.tsx` si la construction des droits y est vérifiée.

## Contraintes

Faire uniquement ce qui est demandé. Audience non-dev : termes interdits absents ; les codes de type ne s'affichent jamais (libellés seulement). Visuel : classes existantes, clair et sombre, AA. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pilotage.ts`, `src/lib/api_pilotage.test.ts`, `src/lib/api_caisse.ts`, `src/lib/navigation_tableau_de_bord.ts`, `src/lib/navigation_tableau_de_bord.pharmacie.test.ts`, `src/app/dashboard/anomalies/page.tsx`, `src/app/dashboard/anomalies/page.test.tsx`, `src/components/dashboard/PilotagePharmacie.tsx`, `src/components/dashboard/PilotagePharmacie.test.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/page.test.tsx`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : accueil, carte « Anomalies à traiter » (4) ; file : vente sans stock W2 (avec rattachement si une réception a eu lieu en PF07a), deux écarts d'inventaire, vente remontée après clôture ; traiter un écart d'inventaire ; onglet « Traitées ». **Ousmane Keita** : ni carte ni entrée. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur nouvelle.
3. `npm test` : tout vert, dont `anomalies/page.test.tsx` (7), `api_pilotage.test.ts` (2), `PilotagePharmacie.test.tsx` (2 ajoutés), navigation (1 ajouté), `clotures/page.test.tsx` inchangé et vert.
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
