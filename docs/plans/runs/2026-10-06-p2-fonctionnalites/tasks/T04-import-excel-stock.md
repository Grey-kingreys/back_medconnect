# T04 - Import Excel du stock d'une pharmacie (F1, côté back)

Tier: dur (agent implementeur-dur)
Audience: non-dev pour les messages d'erreur et le contenu du modèle Excel ; dev pour l'API
Visuel: n/a
Background-safe: oui

## Spec

Contexte : `src/pharmacie/pharmacie.controller.ts` (section « Gestion Stock », gardes `AuthGuard, PermissionsGuard` + `@RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)`), `src/pharmacie/pharmacie.service.ts` (`upsertStock`, `checkPharmacieAccess`, `getMedicaments`), `src/pharmacie/dto/pharmacie.dto.ts`, modèles `Medicament` et `StockMedicament` (`@@unique([medicamentId, structureId])`). `exceljs` est déjà dans les dépendances (inutilisé). Pas de `@types/multer` : ne pas ajouter de dépendance, typer le fichier reçu avec une petite interface locale (`{ buffer: Buffer; size: number; mimetype: string; originalname: string }`). Décisions D07 et D08 dans `docs/plans/runs/2026-10-06-p2-fonctionnalites/decisions.md`.

Trois routes, mêmes gardes et permissions que les routes de stock, toutes avec `checkPharmacieAccess(structureId, userId)` :

1. `GET /pharmacie/stock/:structureId/import/modele` : renvoie un fichier `.xlsx` (`StreamableFile`, `Content-Type` xlsx, `Content-Disposition: attachment; filename="modele-import-stock.xlsx"`). Une feuille « Stock » avec en-têtes en ligne 1 : `Médicament`, `Quantité`, `Prix unitaire (GNF)`, `Date d'expiration (AAAA-MM-JJ)`, `Notes` ; une ligne d'exemple (un vrai nom tiré du catalogue si disponible, sinon « Paracétamol 500 mg ») ; une seconde feuille « Mode d'emploi » avec 4 ou 5 lignes en français simple (une ligne par médicament, nom tel qu'il apparaît dans le catalogue, quantité en nombre entier, la quantité remplace celle en stock, colonnes facultatives).
2. `POST /pharmacie/stock/:structureId/import/apercu` (multipart, champ `fichier`) : analyse sans rien écrire, renvoie le rapport.
3. `POST /pharmacie/stock/:structureId/import` (multipart, champ `fichier`) : refait exactement la même analyse, puis écrit les lignes acceptées en une transaction Prisma (`upsert` sur `medicamentId_structureId`, mêmes champs et même sémantique que `upsertStock` : `quantite` remplacée, `disponible = quantite > 0`), renvoie le rapport + `importees`. Notifications : une seule notification groupée « Stock critique » aux pharmaciens et administrateurs de la structure si au moins une ligne importée a une quantité < 10 (texte humain avec le nombre de médicaments concernés), pas une par ligne.

Analyse (méthode de service unique réutilisée par 2 et 3) :
- Fichier : `FileInterceptor('fichier', { limits: { fileSize: 10 Mo } })` (plafond mémoire) puis contrôles manuels avec messages humains en `BadRequestException` : fichier absent (« Choisissez un fichier Excel à importer. ») ; taille > 2 Mo ; extension autre que `.xlsx` ou type MIME incohérent (« Le fichier doit être un classeur Excel (.xlsx). Téléchargez le modèle pour partir d'un fichier valide. ») ; classeur illisible (try/catch autour de `workbook.xlsx.load`) ; colonnes obligatoires `Médicament` et `Quantité` absentes de la ligne 1 (comparaison sans accents ni casse, espaces ignorés ; message qui nomme les colonnes manquantes) ; plus de 1000 lignes de données ; aucune ligne de données.
- Lignes vides ignorées. Pour chaque ligne : nom requis ; quantité entier >= 0 requise ; prix nombre >= 0 facultatif ; date facultative (cellule date Excel ou texte AAAA-MM-JJ valide) ; notes facultatives (texte, tronqué à 500 caractères).
- Correspondance catalogue : charger le catalogue une fois, normaliser (minuscules, sans accents via `normalize('NFD')`, espaces multiples réduits, trim), correspondance exacte sur `nom` puis sur `nomGenerique`. 0 correspondance : rejet « Médicament absent du catalogue » ; plusieurs : rejet « Plusieurs médicaments du catalogue portent ce nom, ajoutez-le à la main depuis la liste ». Doublon dans le fichier (même médicament) : la deuxième occurrence est rejetée « Médicament déjà présent à la ligne N ».
- Rapport (DTO de réponse ou interface exportée dans `dto/pharmacie.dto.ts`) : `{ totalLignes, acceptees, rejetees, lignes: [{ ligne (numéro Excel), nom, statut: 'acceptee' | 'rejetee', raison?, medicamentId?, medicamentNom?, quantite?, prixUnitaire?, dateExpiration? (ISO), notes? }] }`, réponse enveloppée `{ success, data, message }` comme le reste du module. Message humain : « 12 lignes prêtes à être importées, 2 lignes à corriger. ».
- Tous les messages (raisons de rejet comprises) en français pour un pharmacien, sans terme technique (pas de « ID », « UUID », « null », « parse »...).

Tests : nouveau fichier `src/pharmacie/pharmacie.import.spec.ts` : construire un classeur en mémoire avec `exceljs` (`writeBuffer`), service instancié avec un `prisma` simulé. Couvrir : ligne valide acceptée avec le bon `medicamentId` (correspondance sans accents ni casse) ; médicament inconnu rejeté ; quantité négative ou non numérique rejetée ; doublon rejeté ; colonne `Quantité` manquante refusée ; fichier non xlsx refusé ; `import` appelle la transaction avec uniquement les lignes acceptées.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés ; réutiliser `checkPharmacieAccess` et les conventions du module. Règles d'audience, typographiques et de langue : docs/ORCHESTRATOR.md (sections 1, 2, 4, 14). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas modifier `package.json` ni `package-lock.json`. Aucun tiret cadratin ou demi-cadratin dans les lignes ajoutées. Aucun commit.

## Done when

- `npx --no-install tsc --noEmit` sans erreur ; `npm test` vert avec le nouveau spec ; eslint des fichiers touchés sans erreur introduite (signaler à part les erreurs préexistantes des fichiers touchés).
- Le contrat des 3 routes ci-dessus est respecté à l'identique (le front sera écrit contre lui).

## Return

Fichiers modifiés et créés + preuves (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

- Tentative 1 (implementeur-dur, worktree `back-p2-T04`) : travail laissé non commité. Repris le 2026-10-07 : formatage prettier (`eslint --fix`), deux imports inutilisés préexistants retirés (`IsEnum`, `ApiResponse`), en-têtes de dette (D10).

## Validation

- `npx --no-install tsc --noEmit` : 0 erreur ; eslint des 4 fichiers : 0 erreur, 7 avertissements.
- `npm test` (worktree de tâche) : 4 suites, 42 tests ; après merge dans `orch/p2-fonctionnalites` : 7 suites, 60 tests verts (dont `pharmacie.import.spec.ts`, 8 cas).
- Contrat des 3 routes conforme (modèle, aperçu, import ; champ multipart `fichier`).
- Limite : CORS n'expose pas `Content-Disposition` (`main.ts`), le front nomme donc le modèle lui-même.
- Commit eb53eb9 sur `task/T04-import-excel-stock`, mergé dans `orch/p2-fonctionnalites`.
