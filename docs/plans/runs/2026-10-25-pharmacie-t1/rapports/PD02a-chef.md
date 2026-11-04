# PD02a : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-desktop`, commit 9b4fc6c. Vérificateur Sonnet : PASS avec réserves, corrigées par le codeur (photographie sans rattachement refusée, photographie d'un autre poste refusée, relecture du WAL).

## Rejoué par le chef

- `tsc` vert dans le conteneur ; `vitest` 862 tests verts, 1 sauté dans le conteneur (comparaison au fichier du back, absent du conteneur) ; `src/lib/caisse/regles` en local, 78 verts, ce test compris.
- `desktop/` : `tsc` vert, 23 tests verts, performance de `lireStock` comprise. Le chiffre mesuré n'a pas été relevé par le chef.
- Vecteurs : `cmp` identique au fichier du back.
- Crochet pre-commit passé.

## Relu dans le code

- `calculerStockLocal` : formules de la fiche (D738) : agrégat de départ, `max(0, ...)` en sortie, vendable hors lots périmés.
- `appliquerPhotographie` : une transaction ; `sequenceAppliquee` écrite ici seulement ; plage locale entamée conservée.
- `ouvrirStockage` : WAL exigé sur disque, `synchronous=FULL`.
- `migrer` : `user_version`, base plus récente refusée sans écriture.
- Aucun écran touché, `quantites.ts` : `exigerEntier` exporté et `reliquatLot` ajouté, sans autre changement.
- `prixUnitaire` nul devient 0 : sans effet à l'écran, `vente/page.tsx:663` traite 0 comme un prix absent et `calculerLigne` répond `PRIX_MANQUANT`.

Identité des règles avec le back : selon le vérificateur et les vecteurs ; `paiements.ts`, `caisse.ts` et `selection_lots.ts` n'ont pas été comparés ligne à ligne par le chef.

## Fiches modifiées

- **PD02b, section 7 (D752, risque L2)** : base en retard détectée par `sequenceMaxRecue >= prochaineSequence`, y compris sur une copie restaurée. Deux plages ouvertes au serveur : seule la plus récente sert, elle est intacte (D632). Une seule : abandonnée, plage neuve réclamée. `prochainSecours` porté à `sequenceMaxRecue + 1`. Aucun changement du back.
- **PD04a, section 5 (D740)** : présente mais insuffisante, et complétée. Un fichier abîmé fait lever `ouvrirStockage` avant `quick_check` : traité comme illisible. Base plus récente et WAL refusé exclus. `-wal` et `-shm` renommés, rien écrasé. Sept preuves exigées, dont un vrai fichier abîmé et la boîte de dialogue dans Electron, ou dite non jouée.
- **PD04a, écart trouvé** : la fiche promettait de reprendre après `sequenceMaxRecue`, mais `appareilId` vit dans la base : une base vide aurait créé un second poste. Ajout de `userData/appareil.json` et `fixerAppareilId` (D752).
- **PD03** : test 13 étendu.

## Non traité, à connaître

Une plage neuve peut être abandonnée à tort si elle est seule dans la réponse : perte de ses numéros, sans autre effet. Les ventes d'une base perdue et jamais remontées restent inconnues : leurs numéros peuvent revenir, et le serveur les renumérote `N...`.

## Non prouvé

Rien n'a tourné sous Electron dans cette fiche : le cœur est testé sous Node seulement. Aucune vente, aucun appel réseau, aucune écriture sur la base de dev.
