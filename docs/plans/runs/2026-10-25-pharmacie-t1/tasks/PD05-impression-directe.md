# PD05 - Impression directe

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (vendeur, titulaire qui règle son poste)
Visuel: oui (page de réglages du poste, sobre, composants existants)
Background-safe: non (imprimante)
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD04c validé

## Spec

### Objectif

Le ticket sort sans dialogue, en ligne comme hors ligne, depuis la vente locale, en 58 ou 80 mm ou A4. L'imprimante se choisit une fois. Sur le web, le bouton « Imprimer » reste `window.print()`.

Décisions : D746. Plan 4.6.

### Contexte vérifié

- `ventes/[venteId]/recu/page.tsx` rend le reçu, avec `lireFormatRecu`, `enregistrerFormatRecu` (`ventes/affichage.ts`), trois formats, `@media print`, `window.print()` ligne 229. Depuis PD04c, il lit la vente par `sourceCaisse().getVente`.
- `webContents.print` avec `silent: true` exige `deviceName`. Une imprimante qui échoue se voit dans le rappel `(succes, raison)`.
- « Microsoft Print to PDF » demande toujours un nom de fichier, même en silencieux : c'est son pilote.

### 1. `desktop/electron/impression.ts`

- `listerImprimantes()` : `webContents.getPrintersAsync()`, renvoie `{ name, displayName, isDefault }`.
- `imprimerVente(venteId, format)` : fenêtre cachée (`show: false`, mêmes `webPreferences` et préchargement), `loadURL` de `/dashboard/ventes/<id>/recu?impression=1&format=<f>`. Attend le signal `impression:prete` du rendu, 10 s au plus. Lit la hauteur par `executeJavaScript("document.body.scrollHeight")`, en pixels CSS vers microns (1 px = 264,58 µm). Appelle :

```ts
webContents.print({
  silent: true, printBackground: false, deviceName,
  margins: { marginType: format === "A4" ? "default" : "none" },
  pageSize: format === "A4" ? "A4" : { width: largeurMicrons(format), height: hauteurMicrons },
}, rappel);
```

Largeur : 58 000 ou 80 000 µm. La fenêtre est détruite après le rappel, y compris en échec. Une seule impression à la fois (file simple en mémoire).

- Pas d'imprimante choisie : renvoie `{ ok: false, code: "IMPRIMANTE_NON_CHOISIE" }` sans ouvrir de dialogue.
- Échec : `{ ok: false, code: "IMPRESSION_ECHOUEE", message: "Le ticket n'a pas pu être imprimé. Vérifiez que l'imprimante est allumée et réessayez. La vente est bien enregistrée." }`.

Réglages en SQLite, table `reglages` (`cle`, `valeur`), migration `user_version` 2 : `imprimante`, `formatRecu`, `impressionAutomatique`. Défaut d'impression automatique : **actif dès qu'une imprimante est choisie** (D746 : le comptoir veut du geste en moins).

### 2. Pont

`PontDesktop.impression` : `listerImprimantes()`, `lireReglages()`, `enregistrerReglages(r)`, `imprimerVente(venteId)`, `signalerPret()`. Gestionnaires validés comme en PD04a. `venteId` : UUID.

### 3. Reçu

`recu/page.tsx`, si `?impression=1` et pont : format lu de la requête, aucun bouton ni entête d'écran, classes `print:hidden` existantes réutilisées ; `signalerPret()` quand la vente est rendue et que le logo a fini (chargé ou replié, 3 s au plus : hors ligne, l'image ne viendra pas). Erreur de chargement : `signalerPret()` n'est pas appelé, le délai renvoie l'échec.

Bouton « Imprimer » : en desktop, `pont.impression.imprimerVente` ; `IMPRIMANTE_NON_CHOISIE` : lien « Choisir l'imprimante » vers `/dashboard/poste` et repli sur `window.print()`. Sur le web : inchangé.

### 4. Après la vente

`vente/page.tsx`, à l'arrivée du succès, si pont et `impressionAutomatique` : `imprimerVente(vente.id)` sans attendre. Échec : message sous le succès, avec « Réimprimer ». Bouton « Réimprimer » dans « Ventes du jour » : passe par le reçu, comme aujourd'hui, et par `imprimerVente` en desktop. La vente ne dépend jamais de l'impression.

### 5. `src/app/dashboard/poste/page.tsx` (nouveau, desktop seulement)

Sans pont : `notFound()`. Page simple, carte et champs des écrans existants : « Réglages de ce poste » : imprimante (liste), format du ticket (58 mm, 80 mm, A4), case « Imprimer le ticket après chaque vente », bouton « Imprimer un ticket d'essai » (dernière vente locale ; sans vente : désactivé, « Faites d'abord une vente. »), code et nom du poste, version de l'application, dernier envoi. Entrée de menu « Ce poste » en desktop seulement, dans `lib/acces.ts` ou `Sidebar` selon le mécanisme des entrées existant, sans impact web (test).

Permission : tout utilisateur connecté à ce poste.

### 6. Tests

- `desktop/coeur` : migration version 2, lecture et écriture des réglages.
- `recu/page.test.tsx` : `?impression=1` sans boutons et `signalerPret` appelé ; sans pont : comportement actuel.
- `vente/page.test.tsx` : impression automatique appelée une fois, échec sans effet sur la vente ; sans pont, jamais appelée.
- `poste/page.test.tsx` : liste, enregistrement, sans pont `notFound`.

### 7. Preuve

Sans imprimante thermique ici :
1. `sonde.ts` : `webContents.printToPDF` du reçu en 58 et 80 mm : PDF joints au rapport, largeur de page contrôlée (58 et 80 mm), texte intact, accents justes, plaquette et « à régulariser » présents sur un ticket provisoire ;
2. `imprimerVente` vers « Microsoft Print to PDF » : le rappel renvoie succès après la saisie du nom de fichier par le porteur, ou par le chef ; la boîte qui s'ouvre vient du pilote, le noter. Aucune autre boîte de dialogue ;
3. réseau coupé : ticket réimprimé depuis la base locale ;
4. A4 : une page.

### 7 bis. Non joué en PD04c, à jouer ici dans Electron (D745, D753, D723)

Sur l'API de dev, **écrit sur la base du porteur**, Pharmacie de Kaloum seulement : le chef le dit avant.

**Annulation en ligne, bon tiroir** (défaut corrigé en PD02b, jamais joué réellement) :
1. poste en ligne, file vide, caisse ouverte S sur le poste ; relever le théorique espèces ;
2. annuler depuis « Ventes du jour » une vente faite sur le poste, puis une vente faite sur une caisse web ;
3. au serveur : la pièce d'annulation porte `posteId` du poste et `sessionCaisseId` = S, **pas** la caisse web du vendeur ni celle de la vente d'origine ;
4. sur le poste : théorique diminué du montant, stock rendu après la photographie, vente marquée annulée, pièce listée à son jour ; une vente suivante reste sur S, sans `SESSION_INCONNUE` ;
5. caisse locale fermée, nouvelle annulation : caisse ouverte par le serveur adoptée à son `jourMetier`, vente suivante sur cette caisse, envoyée sans rejet ;
6. file non vide : message d'attente, aucun appel ;
7. contrôle : `stock:verifier` propre, aucune anomalie `SEQUENCE_MANQUANTE` ni `EVENEMENT_REJETE` nouvelle.

**Plaquette** : créer ou prendre une fiche `PLAQUETTE`, 10 par boîte, avec prix de la plaquette, dans le jeu de la Pharmacie de Kaloum, par les écrans ou la réception, jamais par SQL. Réseau coupé : vendre 1 plaquette (« 1 boîte et 9 plaquettes », « Boîte entamée : il reste 9 plaquettes », « 3 000 GNF la plaquette »), vendre au-delà du stock (0 et « N plaquettes à régulariser », aucun négatif) ; réseau revenu : au serveur, mêmes quantités, reçu d'une plaquette imprimé en 58 mm.

**Non prouvé ici** : une vraie imprimante thermique. À faire sur le terrain, marque et modèle au rapport du porteur.

## Fichiers autorisés

`desktop/**`, `src/app/dashboard/ventes/[venteId]/recu/**`, `src/app/dashboard/vente/page.tsx` et test, `src/app/dashboard/ventes/page.tsx`, `src/app/dashboard/poste/**`, `src/lib/caisse/contrat_desktop.ts`, le fichier des entrées de menu.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée.
- Pas de tiret cadratin ni demi-cadratin, français.
- `npm run build` du front en local, jamais dans le conteneur.
- Réutiliser le design existant, thèmes clair et sombre.
- Le web reste en ligne et ne change pas de comportement.
- ESC/POS hors tranche.
- Rien sur la base de dev du porteur sans le dire : la preuve peut rester sur la base locale.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

`docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés, `npm run build` local ; dans `desktop/` : `npm run types`, `npm test`.

## Done when

- [ ] Aucun dialogue de l'application sur le chemin nominal
- [ ] 58, 80 mm et A4 corrects, PDF joints
- [ ] Imprimante choisie une fois, gardée au redémarrage
- [ ] Impression sans réseau, réimpression
- [ ] Échec d'impression sans effet sur la vente
- [ ] Annulation en ligne jouée sur le bon tiroir, plaquette jouée (7 bis)
- [ ] Web inchangé

## Return

Fichiers touchés, sorties des gates, chemins des PDF, résultat du rappel d'impression, tout écart à la fiche.

## Historique

## Validation
