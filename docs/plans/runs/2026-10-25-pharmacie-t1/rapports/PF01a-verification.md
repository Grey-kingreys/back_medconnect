# PF01a - Vérification indépendante

Verdict : FAIL (un défaut bloquant de contrat : `numeroTicket` typé chaîne alors que le back renvoie un entier ; le reste est conforme, la gate est verte).

## Commandes lancées

| Commande | Résultat |
|---|---|
| `docker compose exec -T frontend npx tsc --noEmit` (racine) | aucune erreur |
| `npx eslint` sur les fichiers autorisés (local, front) | 0 erreur, 0 avertissement |
| `docker compose exec -T frontend npx vitest run` | 59 fichiers, 479 tests passés (annoncé 479 ; référence 454) |
| `npm run build` (local, front_medconnect) | réussi (exit 0) |
| `git status --porcelain` (front) | fichiers autorisés seulement, plus `docs/plans/ACTIVE.md` (voir remarque 3) |
| `git diff --stat -- src/app` | vide |
| `fetch(` dans `src/lib/caisse`, `api_caisse.ts`, `erreurs_api.ts` | aucune ligne |
| U+2014 et U+2013 (script Python sur tous les fichiers touchés ou nouveaux) | 0 |
| `api_ventes.test.ts` | uniquement des ajouts (2 tests), aucun test existant modifié |

Aucune valeur de `.env` lue, aucun commit, aucun code modifié.

## Problème bloquant

1. `src/lib/api_ventes.ts` (champs `numeroTicket` de `Vente` et de `VenteResume`, ajoutés dans ce diff) : typé `string | null`, conforme à la fiche mais faux contre le back. `back_medconnect/prisma/schema.prisma:525` déclare `numeroTicket Int?`, et `vente.service.ts:255` (`presenterVente`) et `:949` (liste) le renvoient tel quel : c'est un nombre (ou null pour une annulation). Le numéro lisible `T<ordre>-NNNNNNN` est `numero` (chaîne). Correction : `numeroTicket: number | null` dans les deux interfaces, et corriger la fiche (ligne 78 et 79). Aucun usage en aval pour l'instant, donc correction sans effet de bord.

## Conformité au contrat réel du back

Conformes (code du back lu) :
- Permissions : les 7 chaînes de `acces.ts` sont identiques à `permissions.constants.ts:32-38`.
- Routes de `api_caisse.ts` : `GET /pharmacie/:id/referentiels` (`points-de-vente.controller.ts:41`), `POST /pharmacie/:id/postes` (200, DTO `{ type, appareilId, libelle? }`, appareilId 8 à 128 caractères `[A-Za-z0-9._:-]`, `web-defaut:<userId>` valide), `GET .../caisse/sessions/courante?posteId=` (`data` nul sans caisse ouverte). Poste web par défaut : `PREFIXE_APPAREIL_WEB_DEFAUT = 'web-defaut:'` + `user.id` (`vente.service.ts:69,798`), identique à D692. Aucun `posteId` envoyé par la vente.
- Formes : `Referentiels` et `ParametresPharmacie` (`debutCaisse` est une `Date` sérialisée, donc chaîne), `Poste`, `ComptageCaisse`, `SessionCaisse` (champ par champ identique à `SessionReponse` et `ComptageReponse`).
- `Vente` : `typePiece`, `jourMetier`, `provisoire`, `poste {id,code}`, `session {id,ouverteAutomatiquement}`, `paiements` (`reference`, `montantRecu`, `rendu`, `libelle`), `annulation {id,numero,motif,le,par}`, `venteOrigine`, `motif`, lignes (`uniteAffichee`, `nombreAffiche`, `coefficientApplique`), allocations (`lotId`, `numeroLot`, `dateExpiration`, `quantite`, `statut`, `sortieManuelle`, `motif`, `lotTechnique`, `coutUnitaire`) : tous identiques à `presenterVente` (`vente.service.ts:228-305`). `VenteResume` identique à la liste (`:940-960`). `AnnulationPiece.motif` est `string | null` côté front alors que le back renvoie toujours une chaîne : plus large, sans risque.
- `StockMedicament` : champs de fiche (`uniteMinimale`, `coefficientBoite`, `prixUnite`, `deconditionnable`, `toleranceInventaire`, `qualifie`) présents dans le schéma Prisma ; `reliquat`, `quantiteVendable`, `lots` conformes à `avecStock` et `LotExpose` ; enum `UniteMinimale` identique (7 valeurs) ; `coutUnitaire` facultatif (masqué sans `marge:read`).
- Erreurs : `details[].lots` du 409 `SORTIE_MANUELLE_REQUISE` (`lotId`, `numeroLot`, `dateExpiration`, `quantite`) conforme à `LotPerimeDisponible`, avec `stockId`, `nom`, `disponible`, `demande` ; `lignesErreurVente` ignore les lots invalides ; les 12 nouveaux codes figurent dans `CLAUDE.md` du back (PB11, PB12), les 3 codes retirés sont signalés par commentaire.
- `erreurs_api.ts` : lit `ApiError.details.code/details/champs`, réseau = 0, 502, 503, 504 uniquement, 403 distinct, aucune exception ; cohérent avec D687 (le message du serveur reste celui de l'`ApiError`, aucun réessai automatique ajouté).
- Règles pures : `umVersBoites` et `boitesVersUm` identiques au back (troncature vers zéro, jamais -0). `calculerLigne` identique au back (même ordre : unité interdite, prix unité manquant, prix boîte manquant ; arrondi GNF demi éloigné de zéro) ; `exigerEntier` devenu refus silencieux `PRIX_MANQUANT` comme demandé. `formaterQuantite` conforme aux exemples de la fiche.
- Visuel : `classes.ts` reprend caractère pour caractère les constantes lignes 46 à 51 de `vente/page.tsx` (comparées une à une), `BOUTON_SECONDAIRE` identique à la ligne 335, `ALERTE_ERREUR` identique à la ligne 366, variantes amber, primary, emerald par simple substitution. `ErreurAvecReessai` : même structure que les lignes 362 à 374 (`CARTE` > `role="alert"` > `AlertCircle` `aria-hidden` > message, bouton `BOUTON_PRIMAIRE mt-4` « Réessayer » seulement avec `onReessayer`). Le `role="alert"` est sur l'alerte seule, ce qui est correct ; pas de focus déplacé (le bouton est atteignable au clavier, comme la page d'origine).
- `source.ts` et `source_en_ligne.ts` : conformes, aucun `catch`, retournent `res.data.stocks`, `res.data`, `{ poste, session }`.

## Écart déclaré : champs facultatifs sur `Vente`, `VenteResume`, `LigneVente`

Jugement : acceptable pour PF01a (le serveur les renvoie toujours, mais les fixtures de tests existantes ne les ont pas et la fiche interdit de les modifier ; un champ obligatoire casserait `tsc`). Risque : chaque consommateur devra gérer `undefined` et masquera une absence réelle. À rendre obligatoires dans la sous-fiche qui toucherait les fixtures : PF01b (écran de vente : `LigneVente.uniteAffichee`, `nombreAffiche`, `coefficientApplique`, `allocations`, `Vente.paiements`, `numeroTicket`, `poste`, `session`, `provisoire`, `typePiece`) et PF04 (ventes du jour et annulation : `VenteResume.typePiece`, `jourMetier`, `venteOrigine`, `annulation`, `Vente.annulation`, `venteOrigine`, `motif`), en mettant à jour les fixtures de `api_ventes.test.ts`, `ventes_tableau_de_bord.test.ts`, `compteurs_tableau_de_bord.test.ts` et des tests de pages concernés en même temps. Le commentaire « toujours présents dans la réponse du serveur » est exact.

## Remarques mineures (non bloquantes)

1. `src/lib/api_ventes.ts` : le commentaire JSDoc « Ligne citée par une erreur de vente... » est resté au-dessus de `LotErreurVente` au lieu de `LigneErreurVente` (la nouvelle interface a été insérée entre les deux). À remettre sur `LigneErreurVente`.
2. `formaterQuantite` (`quantites.ts`) : avec un coefficient supérieur à 1 et une quantité non entière, `umVersBoites` lève une `RangeError` (comme le back). La fiche dit « jamais d'exception dans l'interface » pour `prix.ts` seulement ; à garder en tête pour PF02a (stock affiché).
3. `docs/plans/ACTIVE.md` du front est modifié (50 lignes) alors que la fiche interdit de toucher `docs/plans/` : à confirmer comme travail de l'orchestrateur et à ne pas inclure dans le commit du codeur si ce n'est pas le cas.
4. Avertissements de fins de ligne LF/CRLF de git sur quatre fichiers : sans conséquence (pas d'erreur de lint ni de build).
