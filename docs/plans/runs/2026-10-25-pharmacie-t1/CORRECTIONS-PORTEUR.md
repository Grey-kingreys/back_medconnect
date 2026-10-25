# Corrections du porteur (priment sur PLAN.md et decisions.md)

1. (2026-10-25) Coupures de caisse : la plus petite coupure en circulation est 500 GNF. Retirer 100 GNF et tout ce qui est inférieur, et retirer la ligne « pièces et autres ». Coupures pré-remplies : 20 000, 10 000, 5 000, 2 000, 1 000, 500.

# Arbitrages de l'orchestrateur principal sur PLAN.md (2026-10-25, priment sur le plan)

A1. Plan validé dans son ensemble, y compris les critiques 6.3 (appliquées comme décrit).
A2. Exécution : TOUTES les tâches sont codées par un codeur Sonnet et vérifiées par un second Sonnet ; le chef Opus spécifie, contrôle et commite. La colonne « Tier » (dur, spécifié) indique seulement le niveau de détail attendu de la fiche de tâche : une tâche « dur » reçoit une fiche très détaillée (SQL, signatures, cas limites).
A3. Q03 tranchée : date de péremption OBLIGATOIRE à la réception, sauf case explicite « sans péremption » (un médicament a toujours une date ; sinon le FEFO « sans date d'abord » récompense l'oubli). Le stock repris garde sa date (O4).
A4. Q04 tranchée : le seuil de stock bas reste un paramètre de la pharmacie (défaut 10) mais s'exprime en BOÎTES : une fiche est en stock bas si 0 < quantite UM / coefficientBoite < seuil. Pour toutes les fiches reprises (coefficient 1) le résultat est identique à aujourd'hui, donc le test de non-régression des alertes reste valable. Rupture : quantite <= 0.
A5. Q15 : la confirmation avant validation de la vente est conservée (décision du porteur du 2026-10-22).
A6. Autres questions (Q01, Q02, Q05 à Q14, Q16, Q17) : défauts du plan appliqués ; elles seront remontées au porteur dans le rapport final.
A7. Coupures : voir point 1 ci-dessus (20 000 à 500, aucune ligne « pièces et autres »). La coupure de 50 000 (Q10) n'est pas ajoutée.
