# PD03 : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-desktop`, commit 756cf04. Vérificateur Sonnet : FAIL, corrigé par le codeur : 400 d'envoi, 413 sur un événement seul et statut inconnu bloquaient tout en silence. Contrat, plages et absence de double décompte conformes selon le vérificateur.

## Contrôlé dans le code

- `bloquerEnvoi` : échec compté, `erreur` gardée, `arret` laissé nul : plage et photographie continuent. Événements gardés `A_ENVOYER`. Journal sans corps de vente. Le moteur reste `EN_LIGNE` : le serveur répond.
- Double décompte : le moteur n'écrit jamais `sequenceAppliquee`, seule la photographie l'écrit. Vente bloquée : sa séquence reste au-dessus, elle est décomptée une fois, stock du poste 8 sur 10 (test de `cycleBloque`, pour les trois causes).
- Serveur lu : `sauterTrouAncien` (`synchro.service.ts:1546`), 24 h comptées depuis la réception du plus ancien `EN_ATTENTE`.

## Corrigé par le chef, sans relecture d'un agent

1. Une photographie forcée n'était jamais consommée tant que l'envoi restait bloqué : une par cycle, jusqu'à toutes les 5 min, sur une connexion payée. Elle l'est dès que la photographie a répondu.
2. Un 400 sur un battement à vide laissait le message d'envoi bloqué jusqu'à la vente suivante, alors que rien n'était en attente. Un battement accepté le lève.

Deux tests ajoutés.

## Ce qui se passe réellement pour les ventes suivantes (D754)

L'envoi part toujours de la plus petite séquence.

- **400 ou 413** : aucune vente suivante ne part. Le poste vend, imprime et décompte, le serveur ne reçoit rien. Sans vente reçue après le blocage, pas d'`EN_ATTENTE` : **la règle de 24 h ne se déclenche jamais**. Le blocage dure jusqu'à une nouvelle version ou une intervention.
- Ces refus précèdent le service : `dernierContactLe` et `dernierEtat` ne sont pas écrits. Le poste n'est attendu à la clôture que par son dernier état, ou s'il a vendu dans les 7 jours sans synchro complète (D616). Sinon, la journée se clôture sans ces ventes, qui remonteront en régularisation.
- **Statut inconnu** : tout le lot part, seul l'événement concerné reste.
- **Si une sortie d'assistance envoyait la suite en laissant le trou** : ventes suivantes en `EN_ATTENTE` au serveur, sans effet sur son stock ; après 24 h, à l'appel suivant, anomalie `SEQUENCE_MANQUANTE` et saut ; la vente bloquée, si elle arrive, est appliquée hors ordre. Une fois sa séquence dépassée, le stock du poste ne la décompte plus, comme le serveur.

Question ajoutée au porteur : `ACTIVE.md`, PD06 section 8. Non traité, à décider avec elle : aucun signal au serveur pendant un blocage. Un battement à vide déclarant `fileVide: false` rendrait le poste attendu à la clôture.

## Fiches mises à jour

Le message n'avait aucun chemin vers l'écran : `EtatPosteDesktop` (PD04a) gagne `messageEnvoi`, le bandeau (PD04c) l'affiche sans jamais le masquer, test de rendu exigé.

## Rejoué par le chef

Desktop : `tsc` vert, 90 tests verts. Front : `tsc` vert. `vitest` du front non rejoué, aucun fichier de `src/` touché.

## Non prouvé

Faux serveur seulement : aucun appel à l'API réelle, ni gzip réel, ni brotli, ni minuterie. Première preuve en PD04a et PD04c. Le faux serveur valide les corps par les listes de clés copiées des DTO : une dérive du back ne se verrait pas ici.
