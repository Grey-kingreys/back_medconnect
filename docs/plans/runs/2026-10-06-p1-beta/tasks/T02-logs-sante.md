# T02 - Point 9 : retirer les données de santé des logs

Tier: spécifié (agent implementeur-specifie)
Audience: dev (logs)
Visuel: n/a
Background-safe: oui

## Spec

Constat (vérifié) : des données de santé ou personnelles sont écrites en clair dans les logs applicatifs (le `redact` de Pino dans `src/app.module.ts` ne couvre que les corps de requêtes HTTP, pas les messages de log) :
- `src/common/services/ai.service.ts:23` : les 50 premiers caractères des symptômes ;
- `src/common/services/ai.service.ts:43` : les 50 premiers caractères de la question d'urgence ;
- `src/carnet-sante/carnet-sante.service.ts:904` : la question d'urgence complète ;
- `src/common/services/sms.service.ts:53` et `:58` : le numéro de téléphone du destinataire (et, ligne 58, le corps brut de la réponse du fournisseur, qui peut renvoyer le numéro).

À faire :
1. Remplacer ces messages par des logs sans contenu sensible : garder l'événement et une métadonnée non identifiante (exemple : `Appel IA Diagnostic (longueur des symptômes : 123 caractères)`, `Demande d'instructions de secours IA reçue`).
2. Pour les SMS : masquer le numéro en ne gardant que les 2 derniers chiffres (exemple `***45`), via une petite fonction privée locale à `SmsService`. Ligne 58 : ne plus inclure `errorDetail` complet ; garder seulement le statut HTTP et le message d'erreur du fournisseur (`error.response?.status`, `errorMessage`).
3. Balayer le reste de `src/` (grep `logger.` et `console.` sur les mots symptôme, question, téléphone, telephone, phone, motif, diagnostic, latitude, longitude, allergies) ; si un autre log écrit une donnée de santé ou un numéro en clair, appliquer le même traitement et le lister dans le Return. Ne pas toucher aux logs qui n'écrivent qu'un identifiant technique.
4. Ne modifier aucune autre logique (valeurs de retour, appels HTTP, gestion d'erreur inchangées).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Règles typographiques et de langue : docs/ORCHESTRATOR.md (logs et commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter : l'orchestrateur commite.

## Done when

- Grep `symptomes.substring\|dto.question}\|question.substring\|à \${cleanNumber}\|à \${to}` dans `src/` : 0 résultat.
- `npx --no-install tsc --noEmit` : 0 erreur ; `npx --no-install eslint <fichiers touchés>` : 0 erreur, en appliquant la procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md` (dette préexistante sur ces fichiers, `carnet-sante.service.ts` en tête ; si T03 est déjà mergé, le fichier est déjà propre) ; `npm test` : vert.

## Return

Liste des fichiers modifiés + preuve (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
