# PD04a : contrôle du chef d'orchestration

Verdict : validé, avec une correction du chef sur l'identité (D756). Front `orch/pharmacie-t1-desktop`, commit 31c067c. Vérificateur Sonnet : FAIL, corrigé par le codeur : identité falsifiable par le rendu (D755), arrêt propre du cycle, 401 après déconnexion, `appareil.json`, `http://` limité au local. Conformes selon le vérificateur, non refaits par le chef : frontière IPC, origine de l'émetteur, jeton en mémoire, base illisible, web sans pont identique.

## Point tranché : qui peut encore vendre (D756)

Défauts trouvés dans le code livré :

1. `definirJeton(null)` n'effaçait rien, et aucun autre canal n'existait : après une déconnexion volontaire, l'identité restait, hors ligne comme au redémarrage.
2. `effacerIdentite` ne vidait que la mémoire : le profil local rétablissait l'identité au redémarrage, y compris pour une session révoquée ou un compte désactivé.
3. Tout 401 sur `/auth/me` effaçait l'identité. Or un jeton expiré au retour du réseau donne un 401 simple : une coupure juste après aurait laissé le vendeur connecté sans droit de vendre.
4. Après un `/auth/me` en panne, le jeton d'un nouveau vendeur laissait l'identité du précédent : ses ventes partaient au nom de l'autre. Et rien ne retentait la confirmation avant le renouvellement suivant (12 min).

| Situation | Identité | Hors ligne, redémarrage |
|---|---|---|
| `definirJeton(null)`, 401 simple, panne | gardée | vend, comme prévu |
| `deconnexion()` volontaire | effacée, profil compris | aucune vente, connexion en ligne exigée |
| 401 à code, 403 sur `/auth/me` | effacée, profil compris | aucune vente |
| Jeton d'un autre compte | effacée dès la réception | aucune vente avant confirmation |

Corrigé par le chef : canal `deconnexion` (`ipc.ts`, `preload.ts`, contrat), `service.deconnecter`, `coeur.effacerProfil`, lecture du code d'un 401, `utilisateurDuJeton` (lecture sans vérification, sert seulement à retirer), nouvel essai de `/auth/me` avant chaque cycle tant que le jeton courant n'est pas confirmé. Tests ajoutés dans `service_synchro.test.ts` et `passerelle.test.ts`. **Ces corrections n'ont pas été revues par un agent.**

**Limite gardée (D442, Q06)** : sans déconnexion, le poste reste au nom du dernier connecté, même si quelqu'un d'autre s'assoit. Aucun mot de passe n'est vérifiable localement.

## D755 relu dans le code

- Aucun canal d'identité venant du rendu. `enregistrerProfil` n'est appelé que par `confirmerIdentite`, elle-même appelée seulement depuis la réponse de `/auth/me` dans le processus principal.
- `Passerelle.controler` précède tout appel du cœur, lectures comprises : identité nulle : 401 ; poste non rattaché : 503. Aucune écriture avant identité confirmée, `rattacher` compris.
- `jeton !== pour` écarte une réponse arrivée après un changement de jeton ou une déconnexion.
- Seule autre porte vers le cœur : `sonde.ts`, exclue d'un paquet (`!app.isPackaged`).
- Reste ouvert : `enregistrerAnnulationServeur` croit la réponse que lui passe le rendu. Il ne déclare pas d'identité de vendeur (le contrôle reste celui de la passerelle), mais un rendu compromis pourrait fausser le théorique local. Le serveur recalcule à la fermeture ; accepté, à revoir si l'appel passe au processus principal.

## Fiche PD04b réécrite sur ces points

Elle demandait encore `definirUtilisateur` et `profil.enregistrer` par le rendu, contraires à D755. Désormais : `profil.lire` seul, `deconnexion()` au `logout` et à **toute purge réelle** du rendu, jamais sur panne réseau ; `/auth/me` complet gardé par le processus principal pour le menu (aujourd'hui, seulement `id`, `nom`, `structureId`, `permissions`) ; scénario « vendeur suivant, hors ligne » exigé.

## Rejoué par le chef

Desktop : `tsc` vert, 142 tests verts ; `npm run construire` avec l'adresse de dev. Front : `tsc` vert, `src/lib/caisse` vert (87, 1 sauté) ; suite complète du front non rejouée après mes corrections (un type de contrat seul touché sous `src/`), 868 selon le codeur avant elles.

## Non prouvé

- **Sonde non rejouée après les corrections du chef** : elle écrirait encore sur la base du porteur. `main.ts`, `ipc.ts` et `preload.ts` sont compilés, testés par la passerelle et le service, mais le canal `deconnexion` n'a jamais circulé dans Electron. Première preuve en PD04b.
- La sonde du codeur a laissé une vente réelle et une caisse ouverte sur la base du porteur, qui est prévenu.
- La boîte de dialogue de base illisible : voir le rapport du codeur ; non vue par le chef.
- `logout` ne fait encore rien de tout cela à l'écran : tant que PD04b n'est pas livrée, `useAuth` n'appelle pas le pont.
