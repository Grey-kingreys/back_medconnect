# PD01 : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-desktop`, commit 403bbf7. Deux passages : le vérificateur Sonnet a rendu FAIL, le codeur a corrigé (`npm ci` à froid, serveur étranger sur le port, garde de navigation, mesure mémoire inactive en paquet, `.next/cache` non copié).

## Rejoué par le chef

- `tsc` vert dans le conteneur ; `vitest` 80 fichiers, 807 tests verts, après les corrections ; `tsc` de `desktop/` vert, `desktop/` n'a encore aucun test ; crochet pre-commit passé.
- `.env*` : 0 fichier dans `desktop/dist-front` (2 318 fichiers, 39 Mo selon `du`). `dist`, `dist-front`, `node_modules`, `sonde-resultat.json` ignorés par git.
- `next.config.ts` : `output` et traçage seulement sous `NEXT_OUTPUT=standalone`.
- Limites de tas retirées (D750) : aucune occurrence dans `desktop/electron` ni `desktop/scripts`.

## `demarrerServeur`, joué sans fenêtre, sans API, sans base

Harnais jetable hors du dépôt, faux programme qui répond 200 sur le port.

| Cas | Résultat |
|---|---|
| Ports libres | 47613, notre serveur |
| 47613 pris sur 127.0.0.1 | 47614, notre serveur |
| 47613 pris sur 0.0.0.0 | 47613 : notre serveur répond sur la boucle locale, le programme étranger n'est pas atteint |
| Les trois pris | null en 25 ms, aucune adresse chargée |
| Course : programme qui prend 47613 juste après le test | 47614, notre serveur |

Le cas « trois pris » a fini par une erreur de segmentation d'Electron à la sortie du harnais (`app.exit` 25 ms après le démarrage). Le résultat était déjà écrit. Le vrai parcours passe par une boîte de dialogue avant de quitter : non joué, boîte non vue.

## Garde de navigation, lue dans `main.ts`

`will-navigate` et `will-redirect` : même origine ou écran d'attente exact, sinon refus, `https:` seul ouvert dans le navigateur du système. `setWindowOpenHandler` refuse toute fenêtre. Permissions : demande et contrôle refusés. Lue, pas jouée avec un lien réel. À revoir si une page a besoin d'une permission, par exemple le presse-papiers.

## Sonde (du codeur, avant les corrections, pas rejouée par le chef)

Electron 45.2.2, Node 24.22.2, `better-sqlite3` chargé sans compilation, serveur Next en processus `Utility`, connexion, cookie de refresh `httpOnly`, navigation vente, caisse, ventes, refresh après jeton invalidé, aucun message CORS ni CSP, pont visible, `require` et `process` absents.

## Tranché

- Chemins absolus du poste de build dans `required-server-files.json` et `server.js` : aucun secret, inutilisés à l'exécution. Non traités ici, neutralisés et contrôlés en PD06 (D751). Le chef a compté les fichiers, pas les chemins un par un.
- Mémoire : D750 du porteur. Mesure sur 4 Go ajoutée à PD06, section 6 bis.
- D736 parlait du port 3001 : c'est 3101 (D751).

## Non prouvé

- Cookie de production `SameSite=None; Secure` : PD06.
- Mémoire sur 4 Go, Windows 10 : PD06.
- Paquet installé, fusibles : PD06.
- Aucun test à la main du porteur dans la fenêtre.
- `npm run build` web sans `NEXT_OUTPUT` : rapporté par le codeur, non rejoué par le chef ; le pre-push le rejouera.
