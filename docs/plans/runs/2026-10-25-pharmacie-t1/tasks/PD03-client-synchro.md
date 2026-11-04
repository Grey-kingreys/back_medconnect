# PD03 - Client de synchronisation

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: dev ; les messages de rejet viennent du serveur et s'affichent tels quels (D660)
Visuel: n/a
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD02b validé

## Spec

### Objectif

Dans le cœur, un moteur qui enregistre le poste, tient le catalogue à jour, envoie le journal et recharge les plages, sans jamais perdre ni bloquer une vente. HTTP injecté, testé contre un faux serveur fidèle au contrat réel. Le branchement réel (minuterie, jeton, `fetch`) est en PD04a.

Décisions : D632 à D634, D637, D640 à D646, D662 à D664, D742. Puce PB18 de `back_medconnect/CLAUDE.md`.

### 1. `desktop/coeur/synchro.ts`

```ts
export interface ReponseHttp { status: number; entetes: Record<string, string>; corps: string }
export interface ClientHttp {
  requete(methode: "GET" | "POST", chemin: string, options?: { entetes?: Record<string, string>; corps?: string; gzip?: boolean }): Promise<ReponseHttp>;
}
export type EtatMoteur = "EN_LIGNE" | "HORS_LIGNE" | "CONNEXION_A_REFAIRE" | "NON_ENREGISTRE";
export class MoteurSynchro {
  constructor(coeur: CoeurCaisse, http: ClientHttp, options: { versionApp: string; libellePoste: string; horloge: () => Date; genererId: () => string });
  async cycle(motif: "minuterie" | "apres-vente" | "demarrage"): Promise<BilanCycle>;
  etat(): EtatSynchro;      // état, dernier contact, échecs consécutifs, prochain délai
  prochainDelaiMs(): number;
}
```

Une erreur réseau (exception de `requete`), un 5xx, un 429 : `HORS_LIGNE`, échec compté. Jamais d'exception hors de `cycle`.

Routes, préfixe `/pharmacie/:structureId`, réponses `{ data, message, success }` :

| Étape | Requête | Traitement |
|---|---|---|
| Poste | `POST /postes` `{ type: "DESKTOP", appareilId, libelle }` (200) | seulement si pas de `posteId` ; `enregistrerPoste` |
| Envoi | `POST /synchro/evenements`, gzip | section 2 |
| Photographie | `GET /synchro/catalogue?posteId=`, `If-None-Match` si `etag`, `Accept-Encoding: br, gzip` | section 3 |
| Plage | `POST /postes/:posteId/plages` `{ id }` | section 4 |

Ordre d'un cycle : poste, envoi, plage si besoin, photographie si due.

### 2. Envoi

- Lot : événements `A_ENVOYER` par séquence croissante, **200 au plus et 1,5 Mo de JSON au plus** avant compression. La limite du serveur (2 Mo) porte sur la taille décompressée, et un 413 répété bloquerait le poste à vie (D663).
- Corps : `{ posteId, etat: { fileVide, sessionOuverte, versionApp }, evenements }`. `corps` de chaque événement parsé depuis le texte stocké, sans autre transformation. `fileVide` : aucun événement restant après ce lot.
- `Content-Encoding: gzip` (`gzip` demandé au client HTTP).
- Boucle tant qu'il reste des événements et que le lot précédent a tout accusé.
- Résultat par `evenementId` :

| Statut | Local |
|---|---|
| `APPLIQUE`, `DEJA_APPLIQUE` | `ENVOYE` |
| `EN_ATTENTE` | `EN_ATTENTE`, ne se renvoie pas ; l'état reste « en attente » tant que le serveur en compte |
| `REJETE` | `REJETE`, `code` et `message` gardés, compteur de rejets ; **la vente reste sur le poste et le lot continue** |
| `A_RENVOYER` | reste `A_ENVOYER`, cycle arrêté, compté comme un échec |
| résultat `differe: true` pour une séquence plus ancienne | met à jour sa ligne (`EN_ATTENTE` vers `ENVOYE` ou `REJETE`) |

- `sequenceAppliquee` de la réponse : gardée dans l'état du moteur pour information. **Ne pas écrire `etat_poste.sequenceAppliquee` ici**, seule `appliquerPhotographie` l'écrit (D437 : un accusé sans nouvelle photographie ferait disparaître la vente du calcul avant que le catalogue la compte). Test dédié.
- HTTP : 401 : `CONNEXION_A_REFAIRE`, le moteur s'arrête jusqu'au prochain jeton ; 403 : état d'erreur, message gardé ; 409 `POSTE_INCONNU` : drapeau `posteDesactive`, envois poursuivis au cycle suivant (D645) ; 413 : taille de lot divisée par deux pour ce cycle ; 400 : compté comme un échec, journalisé sans corps.

### 3. Photographie et rythme (D742)

Due si : démarrage ; après un cycle qui a envoyé des événements et vidé la file ; 15 minutes depuis la dernière ; `force`. Sur 200 : `appliquerPhotographie(photo, etag, Date)`. Sur 304 : met à jour `photographieLe` et l'écart d'heure seulement. L'en-tête `Date` donne `heureServeurEcartMs` ; au-delà de 5 minutes, drapeau `heureFausse` (non bloquant).

Rythme, porté par `prochainDelaiMs()` :
- échecs : 5 s, 10 s, 20 s, jusqu'à 5 min, sans dépasser ;
- file non vide et réseau bon : 30 s ;
- file vide : **battement à vide toutes les 5 min**, au lieu de 30 s : la connexion est payée au mégaoctet. Le plan 4.4 disait 30 s ;
- une vente demande un cycle tout de suite (`apres-vente`).

Un cycle en cours : un second appel attend le même cycle, pas d'envois croisés.

### 4. Plages

Besoin : numéros restants, toutes plages locales confondues, sous `seuilRechargementPlagePct` % de `taillePlageTickets` (paramètres de la photographie), ou aucune plage. Requête `{ id: genererId() }`. La réponse liste les plages en cours : les ajouter. 409 `PLAGES_SUFFISANTES` : pas une erreur, se contente de ce qu'il y a. Un `id` de plage déjà envoyé dont la réponse s'est perdue : `id` conservé dans `etat_poste` et rejoué au cycle suivant (D632).

### 5. Tests, `desktop/coeur/synchro.test.ts`

`fixtures/faux_serveur.ts` applique les vraies règles : séquence stricte, `EN_ATTENTE` sur trou, idempotence par `evenementId`, ETag, compteur de plages. Il **valide chaque corps** avec les listes de clés de PD02b.

1. premier démarrage : poste, plage, photographie, dans cet ordre ;
2. ordre : 3 ventes, séquences 1 à 3 dans l'ordre, tout `ENVOYE` ;
3. **doublon** : réponse perdue (exception après traitement du serveur), renvoi : `DEJA_APPLIQUE`, un seul effet au serveur, CA25 côté poste ;
4. **rejet non bloquant** : 2e événement `REJETE` : 1 et 3 passent, message gardé, compteur à 1 ;
5. **pas de double décompte** : stock 10, vente de 2 : 8 ; accusé sans photographie : 8 ; photographie à `sequenceAppliquee` à jour, serveur à 8 : 8 ; nouvelle vente de 1 avant l'accusé : 7 ;
6. 304 : catalogue inchangé, `If-None-Match` envoyé ;
7. découpage : 450 événements : 200, 200, 50 ; événements volumineux : aucun lot au-dessus de 1,5 Mo ; 413 simulé : lot réduit, tout finit par passer ;
8. `A_RENVOYER` : arrêt, reprise au cycle suivant sans perte ;
9. 401 : `CONNEXION_A_REFAIRE`, file intacte, aucun jeton dans les données ;
10. reprise : réseau coupé 10 cycles : 5 s, 10 s, 20 s, plafond 5 min, retour à 30 s au succès ;
11. rechargement : sous 20 % : plage demandée ; 409 `PLAGES_SUFFISANTES` : sans erreur ;
12. `EN_ATTENTE` puis `differe` : ligne mise à jour, `fileVide` faux entre-temps ;
13. poste réinstallé : `sequenceMaxRecue` 40 : prochain événement en 41 ; le faux serveur garde une plage entamée ouverte : après le cycle (plage demandée, puis photographie à deux plages), seule la neuve sert (D752), aucun numéro déjà servi ;
14. D719 : photographie `quantite` 0, `quantiteARegulariser` 1 + vente provisoire locale : 0 et 2.

### 6. Vérification contre le vrai contrat

`desktop/coeur/fixtures/` recopie les formes depuis `back_medconnect/src/pharmacie/synchro/synchro.service.ts:85-104` et `catalogue-synchro.service.ts`. Toute différence constatée à la lecture se signale au chef, sans adaptation silencieuse. Le jeu réel contre l'API est en PD04c.

## Fichiers autorisés

`desktop/coeur/**`.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée, aucun jeton dans une table, un journal ni un message d'erreur.
- Pas de tiret cadratin ni demi-cadratin, français.
- Le moteur n'importe ni `electron` ni `node:zlib` (compression dans le client HTTP de PD04a).
- Rien sur la base de dev du porteur : faux serveur seulement.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

Dans `desktop/` : `npm run types`, `npm test`.

## Done when

- [ ] Doublon, rejet non bloquant, ordre, découpage prouvés
- [ ] Pas de double décompte entre accusé et photographie
- [ ] ETag, plages, reprise, 401 prouvés
- [ ] Faux serveur fidèle : tout corps envoyé validé

## Return

Fichiers touchés, sorties des gates, différences constatées avec le back, tout écart à la fiche.

## Historique

## Validation
