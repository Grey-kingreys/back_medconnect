# PD04c : contrôle du chef d'orchestration

Verdict : validé, avec une correction du chef sur le contact léger (D758). Front `orch/pharmacie-t1-desktop`, commit 1547c38. Vérificateur Sonnet : PASS par lecture, défaut corrigé par le codeur (état `DEMARRAGE`, `horsLigne`). Parcours réel, joué par le codeur dans Electron à travers un relais coupé : étapes 1 à 8 ter OK, aucun « undefined », « NaN » ni négatif dans le DOM, file vidée en 9 s, stock web et poste concordants, cookie retiré ; `stock:verifier` propre avant et après. Non rejoué par le chef. Écritures annoncées au porteur.

## 1. Contact `GET /app/version` (D758)

Le codeur l'avait mis à 10 s partout, soit 8 640 requêtes par 24 h. Corrigé : **60 s en ligne, 10 s hors ligne** (`delaiContactMs`).

| Rythme | Requêtes, 12 h | Requêtes, 24 h | Volume, 12 h | Volume, 24 h |
|---|---|---|---|---|
| 10 s partout (avant) | 4 320 | 8 640 | environ 26 Mo | environ 52 Mo |
| 60 s en ligne (après) | 720 | 1 440 | environ 4 Mo | environ 9 Mo |

Volume : réponse **mesurée** à 1 007 octets en dev (en-têtes compris, HTTP) ; environ 6 Ko par contact est une **estimation** (requête, plus TCP et TLS refaits, la connexion étant fermée au repos). Mesure réelle exigée en PD06 (section 6 ter). À cela s'ajoutent le battement de 5 min et la photographie de 15 min (D742), non recomptés ici.

Détection : une coupure au repos se voit en 60 s au plus, et aussitôt qu'une vente tente de partir ; le retour du réseau en 10 s. Pendant cette minute, le poste plafonne encore comme en ligne (D737) : un vendeur peut voir « Rupture » jusqu'à 60 s après une coupure ; la tentative d'envoi suivante, elle, bascule l'état.

Autre défaut corrigé : un 502 comptait comme un contact réussi, l'état oscillait toutes les 10 s derrière un proxy. Un 5xx est un échec, comme dans le moteur. Deux tests ajoutés.

## 2. Non joués, reportés à PD05 section 7 bis

Annulation en ligne sur le bon tiroir (D745, D753, défaut de PD02b jamais joué réellement) et plaquette (aucune fiche dans le stock de démo). Sept étapes pour l'annulation, avec contrôle au serveur de `posteId` et `sessionCaisseId` et adoption d'une caisse. **Tant que ce n'est pas joué, l'annulation depuis le poste n'est prouvée que par des tests à réponses simulées.**

## 3. `sed -i` du codeur

Écart à la consigne d'écriture. Le fichier n'est pas nommé : j'ai relu les deux seuls tests suivis et modifiés. `service_synchro.test.ts` : une ligne ajoutée (`sonderAuDemarrage: false`), à sa place dans les options, sans effet sur les assertions. `passerelle.test.ts` : 72 lignes ajoutées, aucune retirée. Les cinq tests nouveaux n'ont pas d'historique à comparer : aucun `.only`, `.skip` ni `xit`, fins de ligne cohérentes. Aucune assertion affaiblie trouvée. Rappel à faire au codeur.

## Relu aussi

`annulerVente` de `source_desktop.ts` et `api_ventes.ts` : `posteId` envoyé seulement par le poste, corps web inchangé (`{ motif }`). `AnnulationPiece` alignée, champs facultatifs ; `ReponseAnnulation` les exige. Un refus après annulation dit « L'annulation est faite, ne la refaites pas. ».

## Rejoué par le chef, après ces corrections

Desktop : `tsc` vert, 157 tests verts, construction réussie. Front : `tsc` vert, `vitest` 924 verts, 1 sauté dans le conteneur. `npm run build` web : selon le codeur, avant ma correction (limitée à `desktop/`). **Parcours Electron non rejoué après le changement de rythme** : il attendait la bascule à 10 s, le passage à 60 s peut allonger ses attentes. À relancer avec PD05.

## Non prouvé

- Annulation réelle et plaquette (ci-dessus).
- Coupure Wi-Fi réelle : le relais coupe l'API, pas la carte réseau.
- Volume réel sur `https` (PD06).
