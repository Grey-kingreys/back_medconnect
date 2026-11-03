# PF06b : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur et build à faire par l'orchestrateur principal. Front `orch/pharmacie-t1-front` 0bdcbde. Dernière fiche du front ; bilan : rapports/front-t1-chef.md.

## Contrôlé dans le code

- Étanchéité sans `marge:read` : `MargePeriode` n'est pas monté, aucun appel, test à l'appui. Alertes : le coût ne s'affiche que si la clé `valeurCout` est présente, et le back la retire par `masquerCouts` (étanchéité prouvée côté back par PB16b). Le coût par lot n'est pas affiché.
- Coût inconnu jamais à 0 : `valeurCout` et `valeurVente` nuls donnent « inconnu » et « inconnue ». Le seul `?? 0` porte sur un nombre de lots, lu seulement quand le coût est transmis. Marge sans vente au coût connu : « inconnue ».
- Taux : `marge / chiffreAffairesValorise`, sur les seules ventes au coût connu, une décimale, « inconnu » si ce total n'est pas positif.
- Période : `jours + 1 > 92`, jours inclus, comme `joursEntre(du, au) + 1` du back, même message. 92 jours passent, le test le joue.
- Quantités : `quantiteBoites` et `unitesEnPlus` du serveur, aucun calcul.

## Correction du chef

`margeConnue` valait « total au coût connu supérieur à 0 » : une période qui ne compte qu'une annulation (total négatif, pièces comptées par leur signe) affichait « inconnue » et « Aucune vente au coût connu », alors que la marge est connue. La marge s'affiche avec son signe, le taux reste « inconnu » comme le veut la fiche. Test ajouté, écrit avec la correction. Si ventes et annulations se compensent exactement, le total vaut 0 et la marge reste « inconnue ».

## À noter

- Question au porteur : le mot « unités » reste générique dans les alertes (« 2 boîtes et 3 unités »), le contrat ne donne pas l'unité du lot. Même question que le reçu de PF04.
- Entorse du codeur, qu'il a signalée : un `sed -i` sur une date de test. Fichier relu seulement par les gates, résultat vert.
- « Ventes à régulariser » remplace « en attente de livraison » de la fiche (vocabulaire de D713), corrigé par le vérificateur.
- Les champs de date peuvent différer du rapport affiché tant que « Afficher » n'est pas pressé. Un refus local laisse aussi le rapport précédent sous le message.

## Preuves

- `tsc --noEmit` sans erreur ; `vitest` 79 fichiers et 805 verts ; `eslint` sans erreur sur les fichiers touchés ; crochet pre-commit passé.

## Non vérifié

- Aucun test navigateur ni capture ; `npm run build` à la charge de l'orchestrateur principal.
- Jeu démo et routes réelles non joués par le chef : contrats relus dans le back, tests du front sur appels simulés.
- Correction du chef non revue par un agent.
