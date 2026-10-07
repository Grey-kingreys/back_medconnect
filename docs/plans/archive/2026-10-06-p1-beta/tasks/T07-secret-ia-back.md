# T07 - Point 14 (côté back) : en-tête secret vers les services IA

Tier: spécifié (agent implementeur-specifie)
Audience: dev
Visuel: n/a
Background-safe: oui

## Spec

Contexte : les deux services IA (`medconnect-ai`, `/predire` ; `medconnect-urgence`, `/urgence`) sont publics. La tâche T13 leur ajoute un contrôle optionnel d'un secret partagé dans l'en-tête `X-MedConnecte-Secret`, actif seulement si leur variable `AI_SHARED_SECRET` est définie (décision D05). Ici, le back envoie cet en-tête.

À faire :
1. `src/config/env.validation.ts` : ajouter la règle `AI_SHARED_SECRET`, `required: false`, sans défaut, avec une validation de longueur minimale de 32 caractères (même style de message que `JWT_SECRET`), commentaire en français : secret partagé avec les services IA, contrôle désactivé si absent.
2. `src/common/services/ai.service.ts` : lire `AI_SHARED_SECRET` via `ConfigService` dans le constructeur ; si défini, passer `{ headers: { 'X-MedConnecte-Secret': secret } }` en troisième argument des deux `httpService.post(...)` ; sinon, appel inchangé. Ne jamais logger la valeur.
3. `CLAUDE.md` de ce dépôt, section « Variables d'environnement », ligne « Autres » : mentionner `AI_SHARED_SECRET` (optionnelle, partagée avec les services IA, en-tête `X-MedConnecte-Secret`). Ne pas toucher à `.env.example` ni à `compose.yml` du dépôt parent (autre niveau de priorité) : l'orchestrateur le signalera.
4. Tests : `src/common/services/ai.service.spec.ts` avec `HttpService` et `ConfigService` simulés : en-tête présent si la variable est définie, absent sinon. Et un cas dans le spec de la validation d'env (existant ou `src/config/env.validation.spec.ts`) : secret de moins de 32 caractères rejeté, absent accepté.

## Contraintes

Faire uniquement ce qui est demandé. Règles typographiques et de langue : docs/ORCHESTRATOR.md (commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter : l'orchestrateur commite. Secrets : ne jamais lire ni afficher un fichier `.env*`.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur ; `npx --no-install eslint <fichiers touchés>` : 0 erreur (procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md`) ; `npm test` : vert, nouveaux cas inclus.
- Grep `X-MedConnecte-Secret` dans `src/common/services/ai.service.ts` : présent.

## Return

Liste des fichiers modifiés + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-07 | orchestrateur (reprise, D08) | succès | `.env.example` et `compose.yml` du parent non modifiés (D09)

## Validation

tsc --noEmit ; eslint ai.service(.spec).ts, env.validation(.spec).ts ; npm test ; grep X-MedConnecte-Secret | 0 erreur ; 0 erreur ; 9 suites, 65 tests verts (en-tête présent ou absent, secret court rejeté) ; présent | 2f9ed06, merge 081dc29
