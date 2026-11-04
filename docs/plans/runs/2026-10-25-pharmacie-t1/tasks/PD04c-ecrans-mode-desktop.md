# PD04c - Écrans en mode desktop

Tier: dur (codeur Sonnet, vérificateur Sonnet ; fiche détaillée)
Audience: non-dev (vendeur au comptoir, sans réseau)
Visuel: oui (bandeau d'état, messages ; aucune refonte)
Background-safe: non pour le scénario réseau coupé
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD04a, PD04b et PF03 validés

## Spec

### Objectif

Vente, Ma caisse et ventes du poste fonctionnent sans réseau, le bandeau dit l'état, les pages réservées au réseau le disent aussi. Jamais de quantité négative : 0 et « N à régulariser ». Sur le web, aucun écran ne bouge.

Décisions : D694, D713, D719, D722, D723, D737, D744, D745. Plan 4.5. Réserve D719 sur PD04. CA24.

### 1. Caisse et ventes par la source

Remplacer les appels directs par `sourceCaisse()`, sans changer le rendu :

| Fichier | Appels remplacés |
|---|---|
| `caisse/page.tsx:10-22, 85-86, 98, 145-147, 183, 194` | `assurerPosteWeb`, `getSessionCourante` (par `etatCaisse`), `getBilan`, `getReferentiels`, `saisirComptage`, `ouvrirSession` |
| `caisse/FermetureCaisse.tsx:159` | `fermerSession` |
| `caisse/MouvementCaisse.tsx:102` | `enregistrerMouvement` |
| `ventes/page.tsx:110, 173` | `listerVentes`, `annulerVente` (nouvelle méthode de `SourceCaisse`, section 5) |
| `ventes/[venteId]/recu/page.tsx:68` | `getVente` |

`Poste` côté desktop a `type: "DESKTOP"`. Tests des écrans : verts sans modification (ils simulent `api_caisse`, `sourceEnLigne` y délègue). Le logo du reçu passe déjà par `ImageWithFallback` : hors ligne, le repli s'affiche.

### 2. `src/components/caisse/BandeauPoste.tsx` (nouveau, desktop seulement)

Rendu en haut du contenu du tableau de bord (`dashboard/layout.tsx`, après la `Sidebar`, `print:hidden`) si pont. Lit `pont.etat()` puis `surEtat`. Mêmes classes que les bandeaux existants (alerte ambre de `vente/page.tsx`).

| État | Texte |
|---|---|
| En ligne, file vide | « En ligne » (discret) |
| En ligne, file non vide | « En ligne : N vente(s) en cours d'envoi. » |
| Hors ligne | « Hors connexion : les ventes sont enregistrées sur ce poste (N en attente d'envoi). » |
| `connexionARefaire` | « Reconnectez-vous pour envoyer les ventes de ce poste. Elles restent enregistrées (N en attente). » |
| `!catalogueDisponible` | « Connectez ce poste à internet une première fois pour charger le catalogue. » |
| `autrePharmacie` | « Ce poste est rattaché à une autre pharmacie. » |

Pastille d'alerte en plus : `plageEpuisee` « Numéros de tickets épuisés : les ventes continuent, avec un numéro de secours. » ; `rejetes > 0` « N opération(s) refusée(s) par le serveur : le titulaire les voit dans ses anomalies. » ; `heureFausse` « L'heure de cet ordinateur semble fausse : vérifiez-la, elle sert aux péremptions. » ; `posteDesactive` « Ce poste a été désactivé : les ventes sont encore envoyées, mais le catalogue n'est plus mis à jour. Contactez le titulaire. ».

Le bandeau web D694 (« Cette page a besoin d'internet... », `vente/page.tsx`, `caisse/page.tsx`) : masqué si `!sourceCaisse().enLigneSeulement`, inchangé sur le web.

### 3. Écran de vente

`app/dashboard/vente/panier.ts` : `plafondVente(stock, sansPlafond = false)`, et tous ses appelants (`raisonListe`, `peutPlus`, ajout, avertissement) reçoivent `sansPlafond` en dernier paramètre, défaut `false`. Le web ne le passe jamais.

Dans `vente/page.tsx`, `sansPlafond = pont présent && !etat.enLigne` (D737) :
- **En ligne sur le poste** : le plafond D722 s'applique comme sur le web, avec les mêmes messages. Le poste n'envoie pas sa vente à la route web : c'est le plafond de l'écran qui porte D713.1, sur le stock local à jour.
- **Hors ligne** : aucun plafond. Un médicament à 0 s'ajoute, le « + » continue. Sous la ligne : « Stock connu sur ce poste : 0. La vente sera à régulariser. », reprendre l'emplacement de l'avertissement existant. La validation n'est jamais bloquée par le stock.
- Périmé seul : `SORTIE_MANUELLE_REQUISE` ouvre `SortieLotPerime` existant, sans changement (D737).
- Liste et ligne : `formaterQuantite` et `formaterARegulariser` (déjà en filet négatif, D713) : « 0 boîte », « 1 boîte à régulariser », « 1 plaquette à régulariser ». Vérifier la phrase à chaque endroit de la liste avec `PLAQUETTE`.
- Succès : le stock local est relu (`chargerStock`), la liste montre la quantité diminuée. Une vente provisoire ajoute au message de succès : « Vente enregistrée. Une partie est à régulariser par le titulaire. ». Rien de plus.

Tests dans `vente/page.test.tsx`, pont simulé : hors ligne : ajout d'un médicament à 0, vente envoyée, aucun signe moins dans le rendu ; en ligne sur le poste : plafond actif ; sans pont : `panier.test.ts` existant vert sans modification. Plaquette : « 1 plaquette à régulariser ».

### 4. Pages réservées au réseau

`src/lib/caisse/routes_hors_ligne.ts` : autorisées hors ligne : `/dashboard/vente`, `/dashboard/caisse`, `/dashboard/ventes` et sous-pages, `/dashboard/poste`, `/dashboard/profil`.

`dashboard/layout.tsx`, si pont et hors ligne, sur une autre route : contenu remplacé par `<ActionEnLigne />` : icône et style de l'empty state existant, « Cette action demande une connexion. », « Réception, inventaire, clôture, rapports, fiches et prix se font avec internet. Les ventes et la caisse continuent sur ce poste. », lien « Aller à la vente ». `/dashboard` hors ligne : redirection vers `/dashboard/vente`.

Écart au plan 4.5 : « dernière version connue des alertes avec sa date » n'est pas livrée en T1 ; le message ci-dessus la remplace (D744).

### 5. Ventes du poste et annulation (D745)

`ventes/page.tsx`, en desktop :
- **Hors ligne** : ventes locales du jour, bouton d'annulation désactivé avec « L'annulation demande une connexion. ». Jour passé : ventes locales de ce jour, avec « Seules les ventes de ce poste sont visibles sans connexion. ».
- **En ligne** : liste de l'API, plus les ventes locales pas encore connues du serveur en tête (dédoublonnées par `id`) marquées « En cours d'envoi ». `totalJour` de la page : additionné. Le reçu : `getVente` local d'abord, sinon l'API.

`annulerVente` en desktop, dans `source_desktop` :
1. file non vide : 409 sans appel, « Envoi des ventes en cours : réessayez dans un instant. » (annuler une vente que le serveur n'a pas encore serait un 404, et une caisse inconnue de lui en créerait une autre) ;
2. `POST .../annuler` avec `{ motif, posteId }` du poste desktop. `api_ventes.annulerVente` gagne `posteId?` facultatif, le web ne le passe jamais. Sans cela l'annulation irait sur la caisse web par défaut du vendeur, et le remboursement sortirait du mauvais tiroir ;
3. `enregistrerAnnulationServeur(réponse)`, puis cycle de synchro forcé (photographie, retour du stock).

### 6. Scénario de preuve (réseau réellement coupé)

Sur l'API de dev, **écrit sur la base de dev du porteur**, Pharmacie de Kaloum seulement : le chef le dit avant. Couper le réseau par `docker compose stop backend` (le plus simple) ; la vraie coupure Wi-Fi est faite par le porteur.

1. En ligne : ouvrir l'application, catalogue et plage chargés ; noter le stock de deux fiches, une déconditionnable et une plaquette.
2. Arrêter le back. Bandeau « Hors connexion », `N` à 0.
3. Redémarrer l'application : toujours connecté, menu complet, `/dashboard` mène à la vente.
4. Ouvrir la caisse en un geste, fond compté. Vendre : 1 boîte ; 3 unités ; une plaquette ; un médicament à 0 : 0 et « à régulariser », jamais de négatif. `N` à 4. Paiements espèces et Orange Money.
5. Mouvement de caisse (prélèvement motivé). Reçu d'une vente, sans réseau. Page « Réception » : « Cette action demande une connexion. ».
6. Fermer la caisse : comptage, écart, commentaire. Bilan affiché.
7. Relancer le back : `N` tombe à 0 sans geste. **Au serveur** : ventes présentes avec le même numéro, session fermée, anomalie `STOCK_NEGATIF` de la vente à 0, stock de la page web égal au stock du poste, 0 et « à régulariser » sur les deux.
8. Rejouer l'envoi en remettant un événement à `A_ENVOYER` par la sonde : `DEJA_APPLIQUE`, aucun doublon (CA25).
9. `npm run stock:verifier` dans le conteneur backend : propre, ou seulement ce qui existait avant ; à relever avant l'étape 1.

Mis au rapport : captures clair et sombre du bandeau, liste de vente, reçu, page réservée.

## Fichiers autorisés

`src/app/dashboard/vente/**`, `src/app/dashboard/caisse/**`, `src/app/dashboard/ventes/**`, `src/app/dashboard/layout.tsx`, `src/components/caisse/BandeauPoste.tsx` et son test, `src/components/caisse/ActionEnLigne.tsx`, `src/lib/caisse/**`, `src/lib/api_ventes.ts`, `desktop/**`.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée.
- Pas de tiret cadratin ni demi-cadratin, français, vocabulaire du pharmacien : jamais « synchro », « événement », « file », « photographie » à l'écran.
- `npm run build` du front en local, jamais dans le conteneur.
- Réutiliser le design existant, logos et tokens, thèmes clair et sombre, WCAG AA.
- Le web reste en ligne et ne change pas de comportement.
- Rien sur la base de dev du porteur sans le dire.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

`docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés, `npm run build` local ; dans `desktop/` : `npm run types`, `npm test`.

## Done when

- [ ] Scénario complet joué, chaque étape au rapport
- [ ] Jamais de négatif à l'écran, plaquette comprise
- [ ] Hors ligne, aucune vente refusée pour le stock
- [ ] Annulation en ligne sur le bon tiroir
- [ ] Pages réservées qui le disent
- [ ] Web inchangé, tests existants intacts

## Return

Fichiers touchés, sorties des gates, résultat de chaque étape du scénario, sorties du contrôle de stock, captures, tout écart à la fiche.

## Historique

## Validation
