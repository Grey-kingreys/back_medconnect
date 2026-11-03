# PF05 : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur à faire par l'orchestrateur principal. Front `orch/pharmacie-t1-front` b1f2a69.

## Contrôlé dans le code

- Forçage : le bouton n'existe que si `peutForcer` du serveur (`forcageAutorise`) ; le serveur refuse lui-même un forçage sur une caisse web (`CAISSES_A_FERMER`) et sans motif.
- Double envoi : garde `envoi` et boutons désactivés pendant l'envoi et la relecture, Échap et le fond bloqués. Test ajouté.
- Échec réseau : aucun renvoi automatique, un seul appel de clôture, bouton « Vérifier ».
- Journée clôturée : le bloc n'a que l'export, les dialogues de clôture n'y sont pas montés. Le fichier est passé tel quel (`Blob` reçu, aucune relecture ni recodage).
- Droits : entrée de navigation réservée à `cloture:gerer` en pharmacie.

## Corrections du chef

1. Après une coupure, « Clôturer la journée » et « Clôturer quand même » restaient actifs tant que « Vérifier » n'était pas pressé. Ils sont désactivés pendant ce temps.
2. « Vérifier » hors connexion effaçait le message et laissait la journée « à clôturer » d'avant, sans aucune erreur visible (`erreurActuelle` n'est lue que sans préparation). La préparation est vidée avant la relecture : chargement, puis erreur avec réessai.
3. Même cas après une clôture réussie dont la relecture échoue, ou après `JOURNEE_DEJA_CLOTUREE` : l'ancien état n'est plus proposé. Le serveur aurait refusé un second envoi, mais l'écran était faux.

Tests ajoutés : boutons bloqués et vérification hors connexion, relecture impossible après succès, double clic, pas de forçage sans `peutForcer`. Écrits avec les corrections, non vus en échec avant.

## À noter

- Le lien vers `/dashboard/anomalies` donne un 404 jusqu'à PF06a, la fiche suivante.
- Bloc « Sommes arrivées après une clôture » : titre et aide diffèrent de la fiche, le vérificateur a fait préciser « toutes journées », car ces anomalies ne sont pas filtrées par jour. Non modifié.
- `TableauTotaux` ne colore que l'écart négatif, comme le demande la fiche.

## Preuves

- `tsc --noEmit` sans erreur ; `vitest` 74 fichiers et 756 verts ; `eslint` sans erreur sur les fichiers touchés ; crochet pre-commit passé.

## Non vérifié

- Aucun test navigateur, aucune capture clair et sombre par le chef, export non ouvert dans Excel ; `npm run build` non relancé.
- Contrats du back relus (préparation, forçage, liste du mois), pas rejoués sur une base. `details[].message`, l'export et les droits reposent sur la vérification Sonnet.
- Correction du chef non revue par un agent.
