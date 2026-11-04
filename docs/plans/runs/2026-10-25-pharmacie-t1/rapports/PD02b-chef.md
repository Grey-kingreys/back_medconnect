# PD02b : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-desktop`, commit 0f590c8 ; back `orch/pharmacie-t1-back`, ce commit. **Le changement du back doit partir avant ou avec le desktop** : sans `annulation.jourMetier`, le poste refuse d'adopter la caisse.

Vérificateur Sonnet : FAIL, corrigé par le codeur : D745 adoptait la caisse d'origine et non celle de l'auteur (vente suivante perdue en `SESSION_INCONNUE`), identifiants UUID validés à l'entrée, pièce d'annulation listée à son jour avec total signé, test de migration v1 vers v2. Conformes selon le vérificateur, non refaits par le chef : contrat des événements, atomicité, théorique égal au serveur sur un cas chiffré, D752.

## Contrôlé dans le code

`enregistrerAnnulationServeur` (`desktop/coeur/vente_locale.ts`) :

| Situation sur le poste | Résultat |
|---|---|
| `annulation.posteId` différent du poste | 409 `ANNULATION_AUTRE_POSTE`, rien d'écrit |
| Caisse de l'annulation = caisse ouverte | imputée, jour de la caisse locale |
| Une autre caisse ouverte | 409 `ANNULATION_AUTRE_CAISSE`, rien d'écrit |
| Aucune ouverte, caisse connue (fermée) | 409 `ANNULATION_CAISSE_FERMEE`, rien d'écrit |
| Aucune ouverte, caisse inconnue | adoptée, sans événement |

Tout est dans une transaction, le rejeu n'écrit rien de plus. Un refus laisse le poste intact alors que le serveur a déjà annulé : PD04c doit le dire et ne pas proposer de réessayer.

## Tranché : jour de la caisse adoptée (D753)

Le codeur prenait `annulation.le.slice(0, 10)`. Faux dans deux cas : caisse rattachée au lendemain d'une clôture (`demain`, prouvé au test 5 de `journee-cloturee.db-spec.ts`), caisse déjà ouverte au serveur un jour passé. Conséquence : caisse, ventes suivantes et pièce listées au mauvais jour sur le poste.

Corrigé par le chef : `annulation.jourMetier` exposé par le back (`deriverAnnulation`, select de la pièce liée, Swagger, `CLAUDE.md`, sans migration) et utilisé à l'adoption ; une réponse sans ce champ est refusée sans écriture. Tests ajoutés : `vente-regles.spec.ts`, `annulation.db-spec.ts` (test 5), `journee-cloturee.db-spec.ts` (`jourMetier` = demain, `le` = aujourd'hui), `caisse.test.ts` (lendemain, jour passé, champ absent).

Ces corrections du chef n'ont pas été revues par un agent.

## Rejoué par le chef, après ces corrections

- Back : `tsc` vert ; `npm test` 1 151 verts, 3 sautés ; `npm run test:db` 38 suites, 438 verts, sur bases jetables, rien sur la base de dev.
- Desktop : `tsc` vert, 62 tests verts. Front : `tsc` vert ; `vitest` du front non rejoué, aucun fichier de `src/` touché par cette fiche.

## PD04c mise à jour

`AnnulationPiece` du front s'aligne sur `posteId`, `sessionCaisseId`, `jourMetier` ; refus du cœur affichés sans réessai ; ordre de déploiement rappelé.

## Limites

- Caisse adoptée déjà ouverte au serveur (base repartie à vide, D752) : le fond et les ventes précédentes sont inconnus du poste, le théorique local est faux jusqu'à la fermeture. Le serveur recalcule à la fermeture ; à relever si le cas se présente. `ouverteLe` local vaut `annulation.le`.
- Rejeu d'une annulation déjà enregistrée après fermeture locale : refus, sans écriture. Sans effet : PD04c n'appelle qu'une fois.
- Rien n'a tourné sous Electron ni contre l'API réelle : le cœur est testé sous Node, les réponses du serveur sont simulées. Première preuve réelle en PD04c.
