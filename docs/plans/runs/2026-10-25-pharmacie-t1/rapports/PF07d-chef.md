# PF07d : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur à faire par l'orchestrateur principal. Front `orch/pharmacie-t1-front` d16c1f2.

## `peutImporter`

Faux par défaut dans `ApercuPharmacie`. Les trois appelants le reçoivent de la même valeur, calculée dans `dashboard/page.tsx` (`reception:write` ou `inventaire:write`) : `ApercuPharmacie` direct, `PilotagePharmacie` et `ComptoirPharmacie` par leurs `droits`. Aucun n'a perdu le lien à tort.

- Titulaire : garde le lien.
- Pharmacien par défaut : le perd, à juste titre : il n'a aucun des deux droits et la route lui répondait 403.

La page du stock et l'entrée de navigation suivent la même règle. Limite, non corrigée : la route exige aussi `stock:read` et `stock:write`. Un rôle personnalisé qui aurait `reception:write` sans `stock:write` verrait le lien et recevrait un 403 lisible. Aucun rôle par défaut n'est dans ce cas.

## Résultat d'inventaire après enregistrement

- Back : `rapportInventaire` écrête `quantiteTheorique` et donne `quantiteARegulariser` (PB20) ; `ecart` reste signé (D717).
- Front : `EcartsInventaire` affiche attendu, mention à régulariser, compté et écart seulement à l'étape « terminé », lignes acceptées seulement. L'aperçu n'a ni attendu, ni écart, ni mention (D729).

## Correction du chef

Colonnes de l'inventaire sans unité : le fichier compte des boîtes, le serveur renvoie des unités. 20 boîtes de 30 s'affichaient « Compté 600 », sans explication. Les titres deviennent « Compté (en unités) », et de même « Attendu » et « Écart » au résultat. À l'aperçu, le repli sur `quantite` (des boîtes) sous ce titre devient « - ». Écart assumé avec les titres de la fiche. Tests adaptés.

## Reste

- Limite connue, D729 : l'attendu reste dans la réponse réseau de l'aperçu, à `inventaire:write`.
- « Stock avant → après » de la livraison reste en unités sans le dire (colonne « Unités reçues » juste avant) ; laissé.

## Preuves

- Après la correction du chef : `vitest` 68 fichiers verts, `eslint` sans erreur sur les 2 fichiers touchés, crochet pre-commit (`tsc`, `eslint`) passé.
- Rendues par le vérificateur et le codeur, non rejouées : route, modèle, coût masqué, pas de double envoi, aperçu sans écriture.
- Correction du chef non revue par un agent. Aucun test navigateur.
