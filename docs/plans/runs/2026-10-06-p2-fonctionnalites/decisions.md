# Décisions - run 2026-10-06-p2-fonctionnalites

Append-only. Une ligne par décision. Consulter par grep avant toute question.

Format : `D<NN> | AAAA-MM-JJ | <décision> | <pourquoi> | tranché par : plan, convention, défaut (révisable) ou user | tâches : T..`

D01 | 2026-10-06 | Délai SOS expiré sans arrivée : le patient peut relancer lui-même, aucune rediffusion automatique vers d'autres structures | consigne de l'orchestrateur de tête, question ouverte du backlog | défaut (révisable) | T02, T06
D02 | 2026-10-06 | Alerte « lancée » non prise en charge : nouvelle alerte refusée pendant 5 minutes après la précédente (constante unique) | éviter les doublons rapprochés | défaut (révisable) | T02
D03 | 2026-10-06 | Délai annoncé borné entre 1 et 240 minutes | bornes raisonnables pour une arrivée de secours | défaut (révisable) | T02, T06
D04 | 2026-10-06 | Une nouvelle alerte autorisée ne modifie pas l'ancienne (statut inchangé) | ne rien inventer sur le cycle de vie, à revoir avec le porteur | défaut (révisable) | T02
D05 | 2026-10-06 | Prise en charge diffusée au patient, aux membres des 5 structures notifiées (recalculées) et à la structure qui prend en charge | « soignants concernés » sans stocker la liste des structures notifiées (pas de migration supplémentaire) | défaut (révisable) | T02
D06 | 2026-10-06 | Ordonnance : `medicaments` validé en profondeur (`ValidateNested`), `medicamentId` optionnel (UUID existant au catalogue) | sans ValidateNested, aucun champ de ligne n'était validé | défaut (révisable) | T01
D07 | 2026-10-06 | Import Excel : cible stock pharmacie ; la quantité importée remplace la quantité en stock (même sémantique que l'ajout unitaire) ; correspondance par nom ou nom générique, sans accents ni casse | consigne de tête + cohérence avec upsertStock | défaut (révisable) | T04, T10
D08 | 2026-10-06 | Import Excel : 2 Mo et 1000 lignes max, .xlsx uniquement ; aperçu puis validation par nouvel envoi du même fichier (sans état serveur) | simplicité et sécurité | défaut (révisable) | T04, T10
D09 | 2026-10-06 | Déchiffrement : la valeur de repli « [Donnée illisible] » est conservée telle quelle (seule la journalisation change) | le backlog ne demande que l'alerte ; changer le texte affiché est hors tâche | défaut (révisable) | T03
