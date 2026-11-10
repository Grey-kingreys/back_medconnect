# PD06 : rapport du chef (installateur, mises à jour, fusibles, bytecode)

Code : front `809561c` sur `orch/pharmacie-t1-desktop`. Installateur : `desktop/sortie/MedConnecte Caisse Setup 0.1.0.exe`, API visée `http://127.0.0.1:3101`.

## Incident « base vide » (enquête du 2026-11-10)

Symptôme : après fermeture et redémarrage, poste installé ouvert une fois avec une base vide et un nouvel `appareilId` ; données intactes dans `caisse.sqlite`, retrouvées en retirant le `-wal`.

Enquête (agent Sonnet, une tentative bornée, dossier temporaire, `better-sqlite3` sous Node, rien installé, `%APPDATA%\MedConnecte Caisse` lu seulement) :
- 45 cycles d'arrêt brutal (`taskkill /F`) d'un écrivain réglé comme `ouvrirStockage`, avec lecture `readonly` comme `examinerFichier` (après l'arrêt, pendant l'écriture, deux écrivains) : aucune perte, `quick_check` ok, `-wal` jamais supprimé, toujours rejoué correctement. Arrêt brutal et lecture seule écartés.
- Effet reproduit : vraie base intacte plus le `-wal` d'une base neuve migrée : `quick_check` ok, base vue vide, et la fermeture suivante reporte ce `-wal` dans le fichier principal (perte réelle). Le `-wal` ne porte aucune identité de la base. Cela colle au symptôme.
- Cause d'origine non reproduite : aucun chemin du code ne dépose un `-wal` étranger (`traiterBaseIllisible` renomme les trois fichiers ensemble avec retour arrière, `fichiersReels` refuse d'écraser). `requestSingleInstanceLock` est lié au dossier `userData`, partagé par les lancements de dev, `win-unpacked` et le poste installé. Le nouvel `appareilId` reste inexpliqué par le code : `appareil.json` valide aurait dû gagner ou lever `PosteIncoherent` ; or sa date (2026-11-05 08:38:51 UTC, après l'installation à 08:23) montre qu'il a été réécrit, donc absent ou illisible à ce moment. Reste un geste ou un outil extérieur (copie ou restauration d'un `-wal`, sauvegarde, antivirus, autre dossier).
- Aucune modification du code, aucun test ajouté : rien de prouvé à corriger.

Mesure défensive proposée au porteur (non codée) : au démarrage, avant l'ouverture, journaliser dans `journal.log` taille et date de `caisse.sqlite`, `-wal`, `-shm`, `appareil.json` (présent, valide, identifiant), l'identifiant de la base et le nombre de ventes ; éventuellement refuser d'ouvrir, sans rien renommer, une base lue vide dont le fichier principal est gros et qui a un `-wal`. Constat annexe : aucun `journal.log` dans le dossier du poste installé, à vérifier.

## Restes bloquants avant une officine

Incident ci-dessus, preuve `https`, mesure sur un PC de 4 Go (D750), signature et hébergement des mises à jour.

## Suite (2026-11-10, accord du porteur)

Mesure défensive codée (D760), front `88a9e73` : journal de démarrage et refus d'ouvrir une base vue vide avec un `-wal` quand `appareil.json` existe. Test réel : vraie base de 300 ventes plus `-wal` d'une base neuve tuée ; refus, empreintes de `caisse.sqlite` et du `-wal` inchangées, 300 ventes relues sans le `-wal`. Cause de l'absence de `journal.log` : rien n'y était écrit lors d'un démarrage sain ; corrigé par le journal de démarrage. Contrôle : tsc OK, 192 tests desktop (16 fichiers).
