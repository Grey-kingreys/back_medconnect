# T01 - Spécification F4 : envoi d'ordonnance vers une pharmacie

Tier: dur (agent implementeur-dur)
Audience: n/a (document de conception lu par le porteur et les devs ; les textes d'écran proposés suivent le régime non-dev)
Visuel: n/a
Background-safe: oui

Worktree de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/back-p3-fond` (branche `orch/p3-fond`). Ne travaille que là. Ne commite pas : l'orchestrateur commite.

## Spec

**Spécification uniquement : aucun code, aucune migration, aucun fichier hors du document ci-dessous.**

Créer `docs/specs/F4-ordonnance-vers-pharmacie.md` (relatif au worktree back). Contexte : backlog racine `D:/souleymane/perso-archive-20260923/perso/medconnecte/BACKLOG-PRIORISE.md`, point F4 (lien médecin et pharmacie pour l'achat des médicaments ; rien n'existe : ni commande, ni paiement, ni livraison). Dépendance : F2 (médicaments de l'ordonnance liés au catalogue, identifiant du médicament conservé dans le JSON `medicaments` de l'ordonnance, texte libre gardé pour un médicament hors catalogue, sans migration), en cours dans un autre niveau : la spec doit en tenir compte sans le supposer livré (prévoir le cas d'une ligne sans identifiant catalogue).

Avant d'écrire, lire l'existant pour s'y ancrer (citer les chemins dans la spec) :
- `prisma/schema.prisma` : modèles `Ordonnance`, `User`, `Structure` (type PHARMACIE ?), modèles de stock et de catalogue de médicaments, `AutorisationStructure`, `Notification`, `StoredFile`, `AuditLog` éventuel.
- `src/pharmacie/` (catalogue, stock, recherche), `src/carnet-sante/` (création et lecture d'ordonnance, `checkAccess`), `src/notifications/`, `src/queue/` (SMS, emails), `src/common/rbac/` (permissions par rôle), `src/storage/` (ordonnance scannée `scanFileId`).

Contenu attendu, en français, sections numérotées :
1. Objectif et périmètre de la première étape : le patient envoie son ordonnance à la pharmacie de son choix ; la pharmacie confirme disponibilité et prix (ligne par ligne, avec alternative ou rupture) ; le patient accepte ou refuse ; paiement au retrait en pharmacie (aucun paiement en ligne) ; retrait sur place (aucune livraison). Hors périmètre explicite.
2. Parcours par rôle (patient, pharmacien, médecin, administrateur de l'établissement, agent d'accueil si concerné) : étapes, écrans proposés, textes visibles en vocabulaire utilisateur (section 14 de docs/ORCHESTRATOR.md, pas de termes interdits), états vides, erreurs actionnables.
3. Cycle de vie de la demande : états (libellés techniques et libellés humains), transitions autorisées, qui déclenche, expirations (demande sans réponse, réservation non retirée), annulation.
4. Modèle de données proposé (Prisma, en bloc de code dans la spec, non appliqué) : demande, lignes, réponse de la pharmacie, horodatages, `deletedAt` (soft-delete comme le reste des données de santé), références à l'ordonnance et au catalogue, chiffrement éventuel des champs sensibles via `EncryptionService`. Justifier chaque choix en une phrase.
5. Endpoints proposés (méthode, chemin, rôle et permission, DTO résumé, réponses d'erreur avec message affichable), cohérents avec les conventions du module `carnet-sante` et `PermissionsGuard`.
6. Consentement et confidentialité : la pharmacie ne voit que l'ordonnance envoyée (pas le carnet), durée de l'accès, révocation, audit des consultations par la pharmacie, minimisation (nom, médicaments, posologie ; pas de diagnostic).
7. Notifications : événements, canal (in-app, SMS, email via la file existante), destinataires, textes proposés.
8. Découpage en tâches d'implémentation (back puis front), avec effort S, M ou L et dépendances (dont F2).
9. Questions ouvertes pour le porteur : paiement mobile (Orange Money, MTN MoMo) pour une étape ultérieure, livraison, réglementation guinéenne à vérifier (dispensation sur ordonnance, médicaments soumis à prescription, conservation des ordonnances, éventuel encadrement des prix), choix de la pharmacie (proximité, carte), ordonnance papier scannée sans médecin MedConnecte, délais d'expiration, qui peut annuler.

Ne rien affirmer sur la réglementation guinéenne : la poser en question à vérifier.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Règles typographiques et de langue : docs/ORCHESTRATOR.md (aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell.

## Done when

- `docs/specs/F4-ordonnance-vers-pharmacie.md` existe, contient les 9 sections, cite au moins les chemins réels du schéma et des modules lus.
- `git status --porcelain` du worktree ne montre que ce fichier (hors docs/plans/ tenu par l'orchestrateur).
- `node .claude/hooks/orchestrator-guard.mjs` n'est pas requis ; mais `grep -nP "[\x{2013}\x{2014}]" docs/specs/F4-ordonnance-vers-pharmacie.md` ne renvoie rien.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-06 | dur | réussi | écart : une retouche faite par sed -i au lieu d'Edit (tirets revérifiés)

## Validation

grep "^## " | sections 0 à 9 présentes, 428 lignes | voir commit
LC_ALL=C.UTF-8 grep -cP tirets | 0 | voir commit
