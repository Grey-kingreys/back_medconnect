# T13 - Point 14 (services IA) : seuil depuis la config et secret partagé

Tier: spécifié (agent implementeur-specifie)
Dépôts: `D:/souleymane/perso-archive-20260923/perso/medconnecte/medconnect-ai` et `D:/souleymane/perso-archive-20260923/perso/medconnecte/medconnect-urgence` (dépôts git séparés, l'orchestrateur a déjà basculé chacun sur la branche `orch/p1-beta`)
Audience: dev (API interne) ; textes de réponse affichés au patient : régime non-dev
Visuel: n/a
Background-safe: oui

## Spec

Constats (vérifiés) :
- `medconnect-ai/app.py:15` : `SEUIL_CONFIANCE = 0.3` en dur, alors que `config.json` contient `"seuil_confiance": 0.5` (déjà chargé dans la variable `config` plus bas dans le fichier). Le modèle couvre 47 maladies dont des pathologies graves : un seuil bas rend le diagnostic trop affirmatif.
- `medconnect-urgence/app.py:14` : `SEUIL = 0.3` (similarité cosinus, pas une probabilité ; pas de `config.json` dans ce dépôt).
- Les deux API sont publiques, sans authentification.

À faire :
1. `medconnect-ai/app.py` : supprimer l'usage de la constante en dur au profit de `config.get("seuil_confiance", 0.5)`, lu **après** le chargement de `config` (garder le nom `SEUIL_CONFIANCE` comme variable, simplement assignée depuis la config ; commentaire en français). Exposer la valeur dans la réponse de `GET /` (clé `seuil_confiance`).
2. `medconnect-urgence/app.py` : rendre le seuil configurable par variable d'environnement `SEUIL_SIMILARITE` (défaut 0.3 conservé, décision D06), conversion en `float` avec repli sur 0.3 et message console si la valeur est invalide.
3. Secret partagé (décision D05), dans les deux services : lire `AI_SHARED_SECRET` (variable d'environnement). Si elle est définie et non vide, les routes `POST /predire` (ai) et `POST /urgence` (urgence) exigent l'en-tête `X-MedConnecte-Secret` égal au secret, comparé avec `hmac.compare_digest` ; sinon réponse 401 avec `detail` en français (« Accès refusé. ») sans autre information. Si la variable est absente : aucun contrôle (comportement actuel inchangé), et un message console au démarrage l'indique. `GET /` et `GET /health` restent publics. Implémentation FastAPI idiomatique : une dépendance (`Depends`) avec `Header(None, alias="X-MedConnecte-Secret")`. Ne jamais afficher la valeur du secret.
4. README de chaque dépôt : courte section en français listant les variables (`AI_SHARED_SECRET`, et `SEUIL_SIMILARITE` pour urgence) et le rôle de l'en-tête.
5. Ne rien changer d'autre (modèle, tokenizer, textes de réponse, Dockerfile, port).

## Contraintes

Faire uniquement ce qui est demandé. Commentaires en français, aucun tiret cadratin ni demi-cadratin. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter, **ne jamais pousser** (remote Hugging Face). Ne pas installer de paquets.

## Done when

- `python -m py_compile app.py` dans chacun des deux dépôts : succès.
- Test de la logique d'authentification sans charger les modèles : si `fastapi` est importable localement (`python -c "import fastapi"`), écrire un petit script temporaire (dossier temporaire du système, supprimé ensuite) qui recopie uniquement la dépendance de vérification et l'exerce avec `fastapi.testclient.TestClient` sur une mini-app (secret absent : 200 ; secret défini et en-tête faux : 401 ; bon en-tête : 200). Sinon, le signaler et fournir une vérification par lecture (grep des lignes clés).
- Grep : plus de `0.3` en dur comme seuil dans `medconnect-ai/app.py` ; `compare_digest` présent dans les deux `app.py`.

## Return

Fichiers modifiés par dépôt + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-07 | orchestrateur (reprise, D08) | succès | dépendance testée en l'extrayant telle quelle de chaque app.py (ast), sans charger les modèles ; rien poussé

## Validation

py_compile des deux app.py ; TestClient sur la dépendance réelle ; grep | OK ; secret absent 200, en-tête faux 401 « Accès refusé. », en-tête absent 401, bon en-tête 200 (les deux services) ; plus de 0.3 dans medconnect-ai/app.py, compare_digest présent dans les deux ; SEUIL_SIMILARITE=abc retombe sur 0.3 | medconnect-ai d1ff2ba, medconnect-urgence 7982a2d
