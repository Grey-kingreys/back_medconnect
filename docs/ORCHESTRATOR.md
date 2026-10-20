# Protocole orchestrateur - MedConnecte (back_medconnect)

Généré par le skill `bootstrap-orchestrateur` v2. Relancer le skill réécrit ce fichier, **sauf** la section « Spécificités du projet » en fin de fichier : c'est là que vont les ajustements propres au projet.

Audience: mixte par surface ; API REST, WebSocket et Swagger = dev (consommés par front_medconnect) ; messages d'erreur renvoyés au front et affichés, emails, SMS et notifications = non-dev (patients, médecins, pharmaciens, agents d'accueil, administrateurs de structure)
Maturité: avancé (anti-slop préventif + passe curative disponible)
Langues: interface, messages d'erreur, emails, SMS et logs en français ; commentaires de code en français, identifiants existants conservés tels quels (pas de renommage) ; docs, plans et commits en français

---

## 1. Principe fondateur - Audience du produit (règle contraignante, prioritaire sur tout le reste)

> **Le piège :** concevoir pour des non-développeurs avec un regard de développeur. C'est la *malédiction de la connaissance* : le dev tolère la complexité, comprend le flow implicitement, sait quoi faire quand ça plante, et projette ce modèle mental sur un utilisateur qui ne l'a pas.

Avant d'écrire ou de valider toute interface, tout texte visible, tout message d'erreur ou tout flow utilisateur, appliquer le régime de l'audience enregistrée ci-dessus. Ne pas la redéduire à chaque tâche : la lire.

**Comment elle a été déduite** (pour la réviser si le produit change) : d'après le type de surface.
- API / CLI / SDK / outil d'intégration / dashboard technique → audience développeur.
- App mobile grand public, PWA marchande, portail patient ou client, outil métier non technique → audience non-développeur.
- Les deux → mixte : segmenter par surface (l'API est dev, le back-office marchand ne l'est pas).

*Calibrage : une API transactionnelle → dev, la perspective dev est un atout. Une marketplace hyperlocale ou un portail santé grand public → non-dev, danger maximal.*

### Régime « audience développeur »

La perspective dev est un atout, **ne pas infantiliser** :
- densité assumée, vocabulaire technique juste, pas de sur-simplification ;
- messages d'erreur précis : code d'erreur, cause, lien vers la doc ;
- conventions cohérentes (REST, naming, versioning), exemples copy-paste qui marchent ;
- la doc technique fait partie du produit, pas un extra.

### Régime « audience non-développeur » (garde-fous anti-malédiction)

Chaque item est une **done-condition** de toute tâche UX ou copy pour cette audience :
- **Vocabulaire de l'utilisateur, pas du dev.** Aucun terme technique visible à l'écran. Nommer les choses comme l'utilisateur les nomme.
- **Messages d'erreur actionnables, en langage humain.** Jamais de stack trace, de code brut ou de message technique à l'écran. Dire quoi faire, pas ce qui a planté.
- **Empty states qui guident.** Un écran vide explique la prochaine action.
- **Divulgation progressive.** Le happy path d'abord, pas toutes les options d'un coup.
- **Le chemin principal marche sans lire de doc.**
- **Actions destructives confirmées, erreurs tolérées** (valeurs par défaut sûres, annulation possible).

### Preuves exigées pour une tâche UI non-dev

« Ça compile » ne suffit pas. Le validateur exige :
1. **Termes interdits** : 0 occurrence dans les chaînes visibles, vérifié par grep (liste ci-dessous, à compléter dans « Spécificités du projet »).
2. **Empty states** : chaque liste ou écran vide a un message et une action.
3. **Erreurs** : chaque appel réseau a un message humain et une action (réessayer, contacter, revenir).
4. **Parcours** : happy path parcouru dans le navigateur ou l'émulateur, captures jointes.
5. **Relecture « utilisateur novice »** : un subagent reçoit uniquement les captures et décrit ce qu'il comprend et ce qu'il ferait sur chaque écran. Chaque hésitation est un bug de conception, pas un bug d'utilisateur.

Termes interdits de base : token, payload, endpoint, API, null, undefined, NaN, ID, UUID, exception, stack, erreur 500, timeout, requête, backend, serveur, cache, session.

---

## 2. Discipline de code - modularité et réutilisation (règle contraignante)

**Ordre de priorité, à respecter tel quel :**

> **1. Réutiliser l'existant**, toujours. **2. Placer au bon endroit ce qu'on crée**, toujours. **3. Extraire une nouvelle abstraction partagée**, seulement à la règle de trois ou si c'est demandé.

Modulariser n'autorise **jamais** un subagent à refactorer du code non demandé ni à inventer des abstractions « au cas où ».

1. **Réutiliser avant de construire.** Avant de créer un composant, un hook, un service, un util ou un type, chercher s'il existe (grep sur le nom **et** sur la fonction). S'il existe : le réutiliser ou l'étendre. Un même besoin = un seul endroit dans le code.
2. **Où vivent les choses.** Réutilisable ou transversal (utilisé par au moins 2 features) → dossier partagé dédié (Next.js : `components/ui`, `lib`, `hooks` ; NestJS : modules `common` ou `shared` ; Flutter : `widgets/`, `core/` ; Angular : `SharedModule`). Spécifique à une feature → reste **dans** la feature, avec son état, ses styles et ses tests.
3. **Composants dynamiques, pas des variantes copiées.** Pilotés par props ou config, jamais par duplication. Interdit : `ButtonRed`, `ButtonLarge`, `CardCompte`, `CardVendeur` copiés. Attendu : un `Button` avec `variant` et `size`, une `Card` composable. Préférer la composition à l'empilement de flags booléens. UI répétitive pilotée par données : rendu config-driven.
4. **Zéro logique métier dans l'UI réutilisable.** Les composants partagés sont présentationnels. La logique métier vit dans les hooks, services ou use-cases.
5. **Contrats typés aux frontières.** Interfaces et props typées explicites. Types de domaine et DTO dans un **seul endroit de vérité**, jamais redéclarés côté front et côté back.
6. **Règle de trois.** Pas d'abstraction partagée avant environ 3 usages de **même** forme et de **même** raison de changer. En cas de doute : dupliquer maintenant, extraire quand la répétition est prouvée.

**En validation :** une tâche de code n'est « done » que si (a) elle n'a pas dupliqué un existant réutilisable, (b) ce qu'elle crée est au bon endroit, (c) elle n'a extrait aucune abstraction non justifiée.

---

## 3. Qualité visuelle - anti-slop (règle contraignante)

Le « slop » visuel : pills pâles où fond, texte et bordure ont presque la même couleur ; bordures ton sur ton ; grands rayons identiques partout ; ombres diffuses, halos, glows ; fonds teintés pâles répétés ; « boîte dans une boîte » (bordure, fond et ombre cumulés) ; surfaces qui sentent le template SaaS générique.

### Régime préventif (défaut)

Done-conditions de toute UI créée :
- Travailler au niveau des **tokens** : couleurs, rayons, ombres, opacités, espacements viennent d'un petit set nommé (source unique de vérité).
- Une **échelle d'ombres** restreinte (none, sm, md). Un **rayon par rôle** de composant. Une **échelle d'opacité de fond** définie.
- Pills, badges, boutons : contraste réel entre fond, texte et bordure. Délimiter par bordure OU fond OU ombre, jamais les trois.
- **Plancher WCAG AA** (contrainte dure) sur le texte et les éléments interactifs.
- Rendu vérifié sur **tous les thèmes** (light, dark).

### Régime curatif (projet avancé, passe « de-slop » déclenchée)

Passe orchestrée dédiée (fan-out). Objectif : **la même interface, reconnaissable, plus maîtrisée. Un nettoyage subtil, pas un redesign.**

Contraintes dures :
- Conserver : couleurs de marque, identité, hiérarchie de l'information, structure des pages, composants, icônes, textes, contenus, fonctionnalités, logique métier, parcours. Ne rien supprimer, remplacer ou déplacer. Pas de migration de design system.
- Intervenir uniquement sur : contraste, bordures, ombres, rayons, opacité des fonds, espacements fins, états hover, focus, active, selected.
- Palette existante exclusivement (ajuster opacité, luminosité ou contraste d'une couleur déjà présente).
- Ce qui est distinctif de la marque reste. Ne corriger que les motifs clairement génériques.

Exécution :
1. **Systématiser avant de retoucher** : dériver d'abord les conventions (ombres, rayons, opacités), ensuite les appliquer uniformément.
2. **Corriger au token, pas à l'instance.** Zéro override éparpillé.
3. **Preuves** : journal fichier, élément, valeur avant → après, tell corrigé. Captures avant et après par surface.
4. **WCAG AA** maintenu.
5. **Une surface = un commit** réversible.
6. **Tous les thèmes vérifiés.**

---

## 4. Convention typographique (règle contraignante)

Jamais de tiret cadratin (U+2014) ni de demi-cadratin (U+2013) dans quoi que ce soit de généré : prose, docs, commentaires, chaînes, commits, logs, noms. Seuls le trait d'union (-) et l'underscore (_, réservé au technique) sont autorisés. Raison : ces tirets ne sont pas au clavier et signent un texte comme généré par IA.

Dans la prose : virgules ou parenthèses (incise), deux-points ou restructuration (mise en relief), deux phrases (rupture), guillemets « » (dialogue).

Aucun risque de casse côté code : CSS, kebab-case, custom properties et flags CLI utilisent déjà le trait d'union ASCII.

Seule exception : une chaîne d'affichage (contenu produit) qui l'exige vraiment. Ne pas en ajouter par réflexe, ne pas supprimer un caractère déjà présent volontairement dans du contenu.

**Appliqué par hook** : `.claude/hooks/orchestrator-guard.mjs` signale les tirets interdits **sur les lignes ajoutées ou modifiées** uniquement (par rapport au dernier commit, ou au texte écrit si le fichier n'est pas suivi par git), ce qui laisse intact un caractère déjà présent dans le contenu existant. Dossiers de traduction et archives exclus.

**Écritures uniquement par Write et Edit** : le hook ne voit pas les fichiers produits par Bash (`cat > f`, `tee`, `python -c`), donc on n'écrit jamais de fichier par redirection shell. Filet de sécurité : le hook git `pre-commit` refait le contrôle des tirets sur les lignes ajoutées de l'index, quel que soit l'auteur.

---

## 5. Langues

interface, messages d'erreur, emails, SMS et logs en français ; commentaires de code en français, identifiants existants conservés tels quels (pas de renommage) ; docs, plans et commits en français

Les commentaires de code sont rédigés en français, comme le reste du projet. Les identifiants et noms de fichiers existants restent tels quels : aucun renommage pour des raisons de langue.

---

## 6. Quand activer l'orchestration (et quand ne pas)

Elle paie sur du travail **massivement parallélisable avec done-condition claire** : migrations, audits par fichier, sweeps, gros refactors multi-fichiers, features indépendantes en lot.

Pour une tâche unique, petite ou exploratoire, **l'orchestration est une taxe** : travailler directement. Les règles 1 à 5 s'appliquent **toujours**.

---

## 7. Rôles

| Rôle | Agent | Modèle | Effort indicatif | Fait quoi |
|------|-------|--------|------------------|-----------|
| **Orchestrateur** | session principale | le plus capable disponible | high | Planifie, route, valide, adjuge, tient l'état. **Pendant un run, n'écrit aucun code feature.** |
| **Implémenteur dur** | `implementeur-dur` | `opus` | high / xhigh | Architecture, logique délicate, debug, raisonnement multi-fichiers |
| **Implémenteur spécifié** | `implementeur-specifie` | `sonnet` | low / medium | Tâches bien spécifiées, features simples, tests contre une spec claire |
| **Mécanique** | `mecanique` | `haiku` | low | Renames, formatting, boilerplate, find/replace en masse |

- Toujours les alias `opus`, `sonnet`, `haiku`, jamais d'identifiant versionné : les alias suivent la dernière version.
- L'effort est indicatif : l'appliquer si le harness permet de le régler par subagent.
- Tier indisponible → tier immédiatement au-dessus. Ne jamais bloquer un run pour ça.
- **Routage** : commencer au tier le moins cher plausible. Promouvoir uniquement après échec de validation, raison notée dans le fichier de la tâche.
- **Modèle par subagent, jamais dans la boucle principale** : changer le modèle de la session principale invalide le cache de l'orchestrateur.
- Seul l'orchestrateur écrit dans `docs/plans/`. Les subagents n'y touchent jamais.

---

## 8. Subagents en arrière-plan

Un subagent en arrière-plan n'a pas accès à tous les outils, et la liste change selon la version de Claude Code. S'il retourne une erreur d'outil indisponible : le relancer au premier plan ou découper la tâche. Ne jamais se fier à une liste figée.

Tâches indépendantes qui touchent les mêmes fichiers : les isoler en worktree (`isolation: "worktree"`).

---

## 9. État du plan (ACTIVE.md et fichiers de run)

`ACTIVE.md` est un **index**, pas un journal. Tout le détail vit dans des fichiers à part, ouverts seulement au besoin.

```
docs/plans/
  ACTIVE.md                        index du run en cours, 150 lignes max
  _templates/                      ACTIVE.md, task.md, decisions.md
  runs/<AAAA-MM-JJ>-<nom>/
    tasks/T04-<slug>.md            spec, done-condition, tentatives, preuves
    decisions.md                   D01, D02... une ligne chacune, append-only
    done.md                        tâches finies au-delà des 20 dernières
  archive/<AAAA-MM-JJ>-<nom>/      run terminé, déplacé en entier
```

Règles :
1. **Jamais dans ACTIVE.md** : specs, sorties de tests, diffs, discussions, raisonnements. Une ligne par tâche, par question, par décision.
2. **Le fichier de tâche est le prompt de dispatch.** On le crée depuis `_templates/task.md` et on passe son chemin au subagent.
3. **Preuves courtes** : dans le fichier de tâche, commande relancée, résultat en une ligne, hash du commit. Jamais la sortie complète collée : le commit permet de la retrouver.
4. **Statuts fixes** : `à faire`, `dispatché`, `validé`, `échoué`, `parqué`. Mis à jour **au moment** du changement, pas en fin de run. Le statut et le compteur de tentatives ne vivent **que** dans ACTIVE.md (source unique) ; le fichier de tâche garde seulement l'historique des tentatives.
5. **Compaction à chaque checkpoint** : une tâche validée sort du tableau et devient une ligne « Faites ». Au-delà de 20 lignes « Faites », les plus anciennes passent dans `done.md`. Au-delà de 5 décisions affichées, les plus anciennes ne restent que dans `decisions.md`.
6. **Plafond de 150 lignes appliqué par hook** : au-delà, `orchestrator-guard.mjs` bloque et demande de compacter immédiatement.
7. **Un run = un dossier.** Deux runs ne se mélangent jamais. En fin de run, le dossier part dans `archive/` et `ACTIVE.md` est réinitialisé depuis `_templates/ACTIVE.md`.
8. **Reprise légère** : lire `ACTIVE.md`, puis seulement le fichier de la prochaine tâche. `decisions.md` se consulte par grep, avant de poser une question, pour vérifier qu'elle n'a pas déjà été tranchée.

---

## 10. Boucle d'exécution

**Démarrage d'un run** : créer `docs/plans/runs/<AAAA-MM-JJ>-<nom>/` (avec `tasks/` et `decisions.md`), créer la branche `orch/<nom>`, remplir l'en-tête de `ACTIVE.md`.

**Prérequis avant le premier dispatch en worktree** : `.githooks/`, `.claude/hooks/`, `.claude/settings.json`, `.claude/agents/` et `docs/ORCHESTRATOR.md` sont committés (`git status --porcelain` ne les liste pas), et `git config core.hooksPath` renvoie un chemin absolu. Un worktree ne contient que ce qui est committé : sinon il tourne sans hooks, sans agents et sans protocole. Si ce n'est pas le cas, le signaler et me demander avant de continuer.

1. **Plan** : un fichier de tâche par tâche, indépendantes et checkpointées, chacune avec sa done-condition **vérifiable** (et, pour l'UI, le régime d'audience et le régime visuel).
2. **Dispatch** : subagents en arrière-plan ; tâches indépendantes en parallèle, dans la limite de `Parallélisme:` (5 par défaut). **Sur l'arbre de travail principal, un seul implémenteur qui modifie du code à la fois** ; les autres tournent en worktree (`isolation: "worktree"`). La branche d'un worktree se nomme `task/<ID>-<slug>` (exemple `task/T04-migration-auth`), sinon la garde du `pre-commit` refuse ses commits ; si le worktree a été créé par Claude Code avec un autre nom, la renommer avant le premier commit : `git branch -m task/<ID>-<slug>`. Sinon les commits et le gate `pre-commit` d'une tâche embarquent le travail inachevé des autres.
3. **Validation** : **des preuves, pas des affirmations**. Sorties de tests réelles, diffs, commandes réellement exécutées. En cas de doute, relancer le gate soi-même. Pass → statut `validé`, commit. Fail → voir tentatives.
4. **Rythme** : vérifier le statut des tâches d'arrière-plan ; ne pas supposer un réveil automatique. Pour l'état externe (CI, deploy), relancer explicitement la commande de statut.
5. **Répéter** jusqu'à ce que **chaque** done-condition soit vérifiée.

**Garde-fous :**
- **Tentatives** : 1er échec → re-dispatch au même tier avec l'échec en contexte. 2e échec → tier supérieur. Échec au tier dur → tâche `parqué`, question pour moi.
- **Secrets** : jamais de valeur de secret dans un fichier de tâche, un plan, un log ou un commit. Seulement le nom de la variable (`STRIPE_KEY`).
- **Tout l'état vit sur disque**, jamais seulement en contexte. Une compaction ou une reprise repart exactement de l'index.

**Fin de run** : toutes les tâches `validé` → dossier du run vers `archive/`, `ACTIVE.md` réinitialisé, résumé du run en 5 lignes.

---

## 11. Commits et branches

- **Pendant un run** : chaque tâche validée = un commit atomique sur `orch/<nom>`, incluant `ACTIVE.md` et le fichier de la tâche. Jamais sur la branche principale.
- **Staging ciblé** : `git add` uniquement les fichiers de la tâche (liste du Return), jamais `git add -A` ni `git add .`.
- **Tâche en worktree** : sa branche se nomme `task/<ID>-<slug>` (renommer avec `git branch -m task/<ID>-<slug>` avant le premier commit si Claude Code l'a nommée autrement). L'orchestrateur valide dans le worktree, puis merge sa branche dans `orch/<nom>`. Conflit → re-dispatch de la tâche avec le conflit en contexte.
- **Garde appliquée par hook** : pendant un run, le hook `pre-commit` lit le champ `Run:` de `ACTIVE.md` et n'autorise que les branches `orch/*` et `task/*`. Tout le reste est refusé, y compris une branche principale nommée autrement que `main` ou `master`. Contournement volontaire (correctif urgent) : `git commit --no-verify`.
- **Merge** vers la branche principale : uniquement sur ma demande.
- **Hors run** : pas de commit sans que je le demande.

---

## 12. Questions pendant un long run

Les subagents **ne demandent jamais et ne stallent jamais**. Si bloqué, un agent retourne :

```
BLOCKED: <ce qui manque>
Options: <A, B, ...> - recommande <X> parce que <pourquoi>
Défaut si sans réponse: <ce que je ferai au checkpoint>
```

Triage par l'orchestrateur, dans cet ordre :
1. **Répondable depuis le plan, le code, la convention ou decisions.md ?** → répondre, écrire la décision, re-dispatcher.
2. **Réversible et dans le scope ?** → prendre le défaut de l'agent, le noter « révisable » dans decisions.md, continuer.
3. **Vraiment réservé à l'utilisateur** (irréversible, changement de scope, credential externe, choix de goût) → parquer **cette tâche seulement**, le reste continue.

Les questions parquées sont **groupées** en un seul point de question au prochain checkpoint. Chaque réponse est écrite dans decisions.md pour ne jamais re-demander.

---

## 13. Gate avant commit

- Tests : `npm test` (tout vert)
- Analyse : `npx --no-install tsc --noEmit` puis `npx --no-install eslint "{src,apps,libs,test}/**/*.ts"` (silencieux)
- UI non-dev touchée : preuves de la section 1 fournies.
- Discipline de code satisfaite (section 2).
- UI touchée : anti-slop respecté (section 3) ; en passe curative, journal fourni.
- Aucun tiret interdit (hook).

Côté git : la garde de branche, le filet de sécurité (tirets et plafond de ACTIVE.md sur l'index) et l'analyse sont appliqués par `pre-commit`, les tests par `pre-push`. Cela ne dispense pas l'orchestrateur : il relance lui-même les tests à la validation de chaque tâche, avant son commit.

Le filet du `pre-commit` contrôle les tirets des lignes ajoutées de l'index, quel que soit l'auteur, et le plafond de ACTIVE.md **lorsque le commit y ajoute des lignes** : un commit qui ne le touche pas, ou qui ne fait qu'en retirer, n'est jamais bloqué par le plafond.

---

## 14. Spécificités du projet

<!-- specifique:start -->
Ajustements propres au projet (termes interdits supplémentaires, vocabulaire utilisateur, exceptions). Cette section est conservée quand le skill est relancé.

### Périmètre de l'audience non-dev dans ce dépôt

Ce dépôt n'a pas d'écran : la surface non-dev, ce sont les **textes produits par le backend et vus par un utilisateur final** :
- le champ `message` des exceptions HTTP (`BadRequestException`, `UnauthorizedException`, `NotFoundException`, `ForbiddenException`...) et des erreurs de validation, affichés tels quels par front_medconnect ;
- les emails (`src/common/services/email.service.ts`), SMS (`sms`), notifications et messages socket (`src/notifications/`, `src/chat/`), y compris ceux envoyés par la file (`src/queue/`).

Restent en régime dev : Swagger, noms de routes et de champs JSON, logs, commentaires, docs techniques. Un message destiné au seul développeur du front (ex. champ technique manquant) peut rester technique, mais tout message susceptible d'être affiché à un patient ou à un soignant suit le régime non-dev.

Pour les preuves de la section 1 côté backend : le point 4 (parcours) se fait par appel réel de l'API (Swagger ou curl) en montrant la réponse affichée, ou via le front si la tâche le touche ; les points 2 et 5 ne s'appliquent qu'aux textes d'emails, SMS et notifications.

### Termes interdits supplémentaires (textes vus par l'utilisateur final)

Prisma, DTO, JWT, refresh_token, access_token, bucket, R2, S3, URL présignée, presign, BullMQ, job, file d'attente, socket, WebSocket, guard, RBAC, rôle système, userId, structureId, ownerId, enum brut (`PATIENT`, `MEDECIN`, `PHARMACIEN`, `STRUCTURE_ADMIN`, `ADMIN`, `SUPER_ADMIN`, `ACCUEIL`), Forbidden, Unauthorized, Bad Request, Not Found, chiffrement, déchiffrement, « Donnée illisible », pending, confirmed.

### Vocabulaire utilisateur à employer

| Terme technique | Dire plutôt |
|---|---|
| token, session expirée, JWT, Unauthorized | « Votre connexion a expiré, reconnectez-vous » |
| Forbidden, RBAC, guard | « Vous n'avez pas accès à cette information » |
| Not Found, ID inconnu | « Ce dossier, ce rendez-vous (etc.) est introuvable » |
| fichier, objet, bucket, upload | document, envoyer un document |
| structure | établissement de santé (hôpital, clinique, centre de santé) |
| STRUCTURE_ADMIN | administrateur de l'établissement |
| ACCUEIL | agent d'accueil |
| PHARMACIEN, MEDECIN, PATIENT | pharmacien, médecin, patient |
| carnet-sante, profil médical | carnet de santé |
| urgence, job SOS | alerte SOS |
| consentement, AutorisationStructure | autorisation d'accès à votre carnet |
| erreur 500, timeout, serveur | « Le service est momentanément indisponible, réessayez dans quelques instants » |

### Gate git via Docker (à conserver si le skill est relancé)

Les hooks `.githooks/pre-commit` et `.githooks/pre-push` sourcent `.githooks/gate-lib.sh` et
lancent chaque commande par `run_gate` : dans le conteneur `backend` (`docker compose exec -T`,
depuis la racine du monorepo) s'il tourne et si le commit vient de l'arbre principal, sinon en
local avec `node_modules`. En relançant le skill, remplacer les lignes de gate générées par ce
câblage plutôt que par des commandes nues. Dans un worktree, le gate est local : le client
Prisma (`generated/`) doit y être généré une fois (`npx prisma generate`).
<!-- specifique:end -->
