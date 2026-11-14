# PD04b - Rester connecté hors ligne

Tier: dur (codeur Sonnet, vérificateur Sonnet ; fiche détaillée)
Audience: non-dev (vendeur qui démarre son poste sans réseau)
Visuel: un message sur la page de connexion
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD04a validé

## Spec

### Objectif

Démarrer l'application sans réseau garde le dernier utilisateur connecté, avec ses permissions, et le jeton d'accès arrive au processus principal à chaque changement. **Le web garde son comportement exact, même là où il déconnecte.**

Décisions : D442, D743, D755, D756. Plan 4.4. Question Q06.

**Fiche corrigée après PD04a** : l'identité vient du serveur, jamais du rendu. `definirUtilisateur` et `profil.enregistrer` n'existent pas et ne doivent pas être créés. Le rendu pousse le jeton (`definirJeton`), lit le profil, et appelle `deconnexion()` selon le tableau de la section 3.

### Contexte vérifié : le code actuel déconnecte hors ligne

Trois endroits purgent la session sur une panne réseau :

| Endroit | Effet sans réseau |
|---|---|
| `hooks/useAuth.tsx`, `checkAuth` (lignes ~205 à 235) | `verifyToken` échoue, `refreshAccessToken` échoue : `access_token`, `user` et cookie témoin effacés |
| `hooks/useAuth.tsx`, `refreshProfile` (lignes ~103 à 142) | une `ApiError` 0 passe au `catch`, le refresh échoue : tout effacé |
| `lib/api_auth.ts`, `authFetch` (lignes ~292 à 300) | 401 puis refresh en échec réseau : tout effacé |

Et `lireContexteAcces(user, profile)` (`lib/acces.ts`) calcule menu et droits depuis `profile` : sans `/auth/me`, plus de permissions.

### 1. `src/lib/connexion_desktop.ts` (nouveau)

```ts
/** Vrai si l'application desktop tourne et que l'erreur est une panne de réseau, pas un refus du serveur. */
export function panneReseauDesktop(err: unknown): boolean; // pont présent, ApiError status 0, 502, 503, 504, ou TypeError de fetch
export function pousserJeton(jeton: string | null): void;  // no-op sans pont, jamais d'exception
```

Tests : sans pont : `panneReseauDesktop` toujours faux, `pousserJeton` sans effet. Avec pont : 0, 502, 503, 504 : vrai ; 401, 403, 404 : faux.

### 2. Contrat et cœur

`PontDesktop` gagne `profil: { lire(): Promise<UserProfile | null> }`, lecture seule, gestionnaire `profil:lire` protégé par `expediteurAutorise`. Aucune écriture du profil par le rendu.

`Passerelle.confirmerIdentite` n'enregistre aujourd'hui que `id`, `nom`, `structureId`, `permissions` : il doit garder le `data` complet de `/auth/me`, que `lireContexteAcces` et le menu lisent (`structureType`, rôle, etc.), sans aucune clé de jeton (test : `access_token`, `refresh_token`, `refreshToken` retirés même s'ils sont fournis). `identiteDepuisProfil` relit déjà ce format. Aucun autre chemin d'écriture de `profil_local`.

### 3. `hooks/useAuth.tsx`

Sans pont, chaque chemin reste **exactement** celui d'aujourd'hui.

Quel appel, quand (D756) :

| Situation | Appel au pont | Effet au processus principal |
|---|---|---|
| Jeton écrit ou renouvelé | `definirJeton(jeton)` | identité confirmée par `/auth/me` ; jeton d'un autre compte : l'ancienne identité tombe aussitôt |
| Jeton retiré ou expiré, **panne réseau** | `definirJeton(null)`, sans purge | identité gardée, vente hors ligne possible |
| `logout` volontaire | `deconnexion()` | identité et profil local effacés, en ligne comme hors ligne |
| Session refusée par le serveur (refresh en 401, motifs forcés, purge de `authFetch`) | `deconnexion()` | idem : **toute purge réelle** du rendu l'appelle, sinon le poste continuerait à vendre au redémarrage |

Dans le processus principal, un 401 simple garde l'identité (jeton expiré) et demande un jeton ; le refus définitif vient de l'étape du refresh ci-dessus, ou d'un 401 à code reçu par `/auth/me`.

- `refreshProfile`, `catch` : si `panneReseauDesktop(err)` : `chargerProfilLocal()` et retour, sans refresh, sans purge.
- `refreshProfile`, second `catch` (refresh échoué), et `checkAuth`, les deux `catch` : si `panneReseauDesktop` : garder `user`, `chargerProfilLocal()`, ne rien purger.
- `chargerProfilLocal()` : lit le profil du pont ; s'il correspond à `user.id` : `setProfile`. Sinon ou s'il est absent (déconnexion ou session retirée) : pas de reprise, retour à la connexion.
- `checkAuth` : sans jeton mais avec `user` en mémoire et un profil local en desktop : session conservée hors ligne (le jeton a expiré ou a été retiré), pas de purge tant qu'aucun refus du serveur n'est reçu.
- `logout` volontaire : `deconnexion()`. Le profil local est effacé, **jamais le journal ni les ventes**. Hors ligne, se déconnecter empêche de se reconnecter : dialogue « Sans connexion, vous ne pourrez pas vous reconnecter tant qu'internet n'est pas revenu. Les ventes de ce poste restent enregistrées. » avec « Rester connecté » et « Se déconnecter ». Réutiliser le composant de confirmation existant du tableau de bord.

`pousserJeton` après chaque écriture de `access_token` : `api_auth.ts:283` et `useAuth.tsx` lignes ~115, ~149, ~224, ~259 ; `pousserJeton(null)` après chaque retrait.

`surDemandeJeton` : dans `AuthProvider`, en desktop : `refreshAccessToken()` puis `localStorage` et `pousserJeton`. Panne réseau : ne rien faire, le moteur réessaiera.

### 4. `lib/api_auth.ts`, `authFetch`

Dans le `catch` du refresh (lignes ~287 à 300) : `if (panneReseauDesktop(errRafraichissement)) throw errRafraichissement;` **avant** la purge. Pas de boucle : le jeton reste, l'appel échoue en erreur réseau normale.

Les motifs forcés (`SESSION_REVOQUEE`, `COMPTE_DESACTIVE`) gardent leur effet : ils viennent du serveur. Une session révoquée déconnecte le poste, le journal reste, et la synchro attend la prochaine connexion (`CONNEXION_A_REFAIRE`).

### 5. Page de connexion

Sur `auth/login`, en desktop, si `etat().enLigne` est faux : au-dessus du formulaire, avec le style d'alerte existant : « Pas de connexion internet. Pour vendre sur ce poste, le dernier utilisateur connecté doit rester connecté ; changer d'utilisateur demande internet. ». Échec de connexion réseau : message existant inchangé.

### 6. Tests vitest, racine du front

Nouveau `hooks/useAuth.desktop.test.tsx`, pont simulé :
1. `checkAuth` avec réseau coupé : `user` gardé, `profile` lu du pont, cookie et stockage intacts, permissions lisibles par `lireContexteAcces` ;
2. réseau coupé sans profil local : `user` gardé, `profile` nul, aucune purge ;
3. 401 `SESSION_REVOQUEE` en desktop : purge et motif, comme le web ;
4. 401 simple et refresh en 401 : purge, comme le web ;
5. `authFetch` : 401 puis refresh en panne réseau : erreur réseau, jeton gardé ;
6. chaque renouvellement pousse le jeton ; `logout` appelle `deconnexion()` ; refresh refusé par le serveur (401) : `deconnexion()` ; panne réseau : jamais `deconnexion()` ;
7. `surDemandeJeton` : refresh puis jeton poussé ;
8. **vendeur suivant, hors ligne** : A se déconnecte sans réseau, relance de l'application : page de connexion, `chargerStock` et `creerVente` du pont en 401, aucune vente possible au nom de A. Scénario joué aussi dans Electron par la sonde, sans réseau.

**Non-régression web** : les tests existants `api_auth.*.test.ts`, `deconnexion_forcee.test.ts`, `layout.test.tsx` verts sans modification ; un test sans pont vérifie qu'une panne réseau à `checkAuth` purge encore comme aujourd'hui. Ce comportement du web est gardé tel quel ; il sera signalé au porteur (D743).

## Fichiers autorisés

`src/hooks/useAuth.tsx`, `src/hooks/useAuth.desktop.test.tsx`, `src/lib/api_auth.ts`, `src/lib/connexion_desktop.ts`, `src/lib/connexion_desktop.test.ts`, `src/lib/caisse/contrat_desktop.ts`, `src/app/auth/login/page.tsx`, `desktop/electron/ipc.ts`, `desktop/electron/preload.ts`, `desktop/coeur/**`.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée. Aucun jeton dans le profil local, les journaux ni `console.log` (les `console.log` existants de `useAuth` ne citent pas de jeton : n'en ajouter aucun).
- Pas de tiret cadratin ni demi-cadratin, français.
- `npm run build` du front en local, jamais dans le conteneur.
- Réutiliser le design existant.
- Le web reste en ligne et ne change pas de comportement : chaque branche nouvelle derrière le pont.
- Rien sur la base de dev du porteur : tests simulés.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

`docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés ; dans `desktop/` : `npm run types`, `npm test`.

## Test à la main

Connecter, couper le réseau, redémarrer l'application : même utilisateur, menu complet, page de vente accessible (les écrans sont finis en PD04c).

## Done when

- [ ] Redémarrage sans réseau : utilisateur et permissions gardés
- [ ] Refus du serveur : déconnexion comme le web
- [ ] Jeton poussé à chaque changement, en mémoire seulement
- [ ] Web inchangé, prouvé par ses tests et par un test sans pont

## Return

Fichiers touchés, lignes modifiées de `useAuth` et `api_auth`, sorties des gates, tout écart à la fiche.

## Historique

## Validation
