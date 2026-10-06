# T<NN> - <titre>

Tier: <dur | spécifié | mécanique> (agent <implementeur-dur | implementeur-specifie | mecanique>)
Audience: <dev | non-dev | n/a>
Visuel: <n/a | préventif | curatif>
Background-safe: <oui | non, car <outil>>

## Spec

<spec complète, tout en un tour, rien au compte-gouttes>

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

## Done when

<condition exacte et vérifiable que le validateur testera>

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
