# Bilan du front, tranche pharmacie 1

Branche `orch/pharmacie-t1-front`. Dernier passage : `tsc`, `eslint` et `vitest` verts (79 fichiers, 805 tests, appels simulés). Détails : rapports/<fiche>-chef.md.

## Fiches livrées

- Vente : PF01a 3bd8abe, PF01b 646edfd, PF08 1cb3fee, PF09 8a2a159. Stock : PF02a 63bb9ad, PF02b 9faa963, correctifs porteur 1 4f54bb3, D731 2e9fdd2.
- Réception et inventaire : PF07a 1d2197f, PF07b 23a558c, PF07c 896206d, PF07d d16c1f2.
- Caisse : PF03a add367c, PF03b dc60497, PF04 de22bf0, PF05 b1f2a69. Pilotage : PF06a eca3842, PF06b 0bdcbde.

## Décisions depuis D713 (decisions.md fait foi)

- Porteur : D713 vente en ligne refusée au-delà du stock, jamais de négatif à l'écran ; D723 unité plaquette ; D731 fenêtre d'ajout au stock.
- Orchestrateur principal, révisables : D727 message du refus de stock ; D729 inventaire importé à l'aveugle ; D730 bandeau de caisse d'un jour passé.
- À valider par le porteur : D718 sortie, correction et inventaire permis sur une fiche à régulariser ; D724 changement d'unité refusé sur une fiche qui a du stock.
- Défauts révisables : D714 à D717, D719 à D722, D725, D726, D728.

## Questions ouvertes pour le porteur

1. Fermeture : attendu et écart visibles pendant le comptage, donc ajustables. Recommandation de l'orchestrateur : les masquer jusqu'à la confirmation (DEMANDE.md ligne 77). Comportement inchangé.
2. « Unités » reste générique sur le reçu (« 6 unités de X » pour des plaquettes) et dans les alertes : ajouter le libellé d'unité aux réponses du back ?
3. D718 et D724, ci-dessus.
4. Déjà parquées dans l'ACTIVE du back : outil de rejeu, argent des régularisations hors clôture, paiement arrivé après une fermeture, fond visible par un autre vendeur (D528), décisions D601 à D682, Q01 à Q17 du plan.

## Non prouvé

- Navigateur : seuls PF08 et PF09 sont notés joués dans l'ACTIVE. D'après les rapports, tout le reste n'a jamais été vu dans un navigateur, ni au clavier réel, ni en captures clair et sombre : en priorité la fermeture de caisse, l'annulation, la clôture et l'import Excel réel.
- `npm run build` : non lancé sur PF03b à PF06b, dont le `Suspense` de `/dashboard/anomalies`. Prévu en local par l'orchestrateur principal.
- Base : ces six fiches n'ont été jouées contre aucune base. Leurs contrats sont relus dans le back ; PF07a et PF07b seuls ont envoyé leurs corps à l'API de dev. Le CSV de clôture n'a pas été ouvert dans Excel.
- Corrections des chefs non revues par un agent. `vente/page.test.tsx` a échoué une fois en suite complète, cause non établie.
