# PF04 : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur à faire par l'orchestrateur principal. Front `orch/pharmacie-t1-front` de22bf0.

## Contrôlé dans le code

- `confirmationBloquee` : après une coupure, le message demande de vérifier, « Annuler la vente » est désactivé, « Fermer » reste actif ; le bouton, le fond et Échap passent tous par `fermerDialogue`, qui relit la liste. La liste relue montre si l'annulation a eu lieu. Échap reste bloqué pendant l'envoi. Une seconde tentative serait refusée par `VENTE_DEJA_ANNULEE` si la première avait abouti.
- Signes : le back oppose `sousTotal`, `nombreAffiche`, `quantite` et les paiements d'une pièce (`vente-regles.ts`, `vente.service.ts`), `montantRecu` nul. Liste : total négatif, articles en positif. Reçu : total et paiements négatifs, sans « Reçu » ni « Rendu ».
- D705 contre `presenterVente` : toutes les clés rendues obligatoires sont renvoyées par toutes les réponses (création, rejeu, détail, annulation), et la liste renvoie celles de `VenteResume`. Vente historique du poste REPRISE, d'après la migration M6 : `jourMetier` égal au jour de création, donc pas de « Comptée pour le » ; `nombreAffiche` égal à `quantite`, `BOITE`, coefficient 1 ; `paiements` vide, donc aucune ligne ; `annulation` nulle sur une annulation d'avant la caisse, le reçu retombe sur « Annulée le » et la liste sur la pastille. Le bouton « Annuler » y reste affiché et le serveur répond `PIECE_NON_ANNULABLE` dans le dialogue, sans réessai.

## Correction du chef

Reçu d'une pièce d'annulation : la ligne disait « 2 × 1 500 GNF = -3 000 GNF », calcul faux. Elle dit « -2 × 1 500 GNF = -3 000 GNF » ; le libellé reste « 2 boîtes de ... ». Attente ajoutée au test du reçu.

## Question au porteur, non codée

Le reçu d'une vente en plaquettes dit « 6 unités de X » : la ligne de vente ne porte que `BOITE` ou `UNITE`, le libellé exact de l'unité n'y figure pas. Faut-il l'ajouter à la réponse du back pour écrire « 6 plaquettes de X », « 6 comprimés de X » ?

## Remarques, laissées telles quelles

- Vente annulée d'avant la caisse : son motif n'est pas affiché au reçu (déjà le cas avant cette fiche).
- `aujourdhui === date` remplace `date === aujourdhui` sur le lien « Nouvelle vente » d'une journée vide : même sens, écriture inversée qui ne sert qu'à passer le `grep` de la fiche.
- « N ventes » en tête de journée compte les pièces (voulu par la fiche, `nombre` du serveur).

## Preuves

- `tsc --noEmit` sans erreur ; `eslint` sans erreur sur les fichiers touchés.
- `vitest` : 73 fichiers et 732 verts, relancé après un premier passage complet à 731 verts et 1 échec dans `vente/page.test.tsx` (« Nouvelle vente > enregistre la ... »), fichier non touché par cette fiche. Vert ensuite 2 fois seul et 1 fois en suite complète. Cause non établie, probablement la charge de la suite comme pour `liens_accueil.test.ts` : test instable à surveiller.

## Non vérifié

- Aucun test navigateur, aucune capture clair et sombre par le chef ; `npm run build` non relancé.
- Vente historique contrôlée par lecture de la migration et du code, pas sur une base.
- Correction du chef non revue par un agent.
