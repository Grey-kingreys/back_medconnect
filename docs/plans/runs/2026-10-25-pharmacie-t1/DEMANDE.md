# Module pharmacie MedConnecte, première tranche fonctionnelle

## Contexte du dépôt

Tu travailles dans le dépôt MedConnecte, plateforme santé guinéenne à trois volets (patients, hôpitaux et cliniques, pharmacies). Le backend est en NestJS avec PostgreSQL et un RBAC à six rôles déjà en place. Le front web est en Next.js. L'application mobile est en Flutter et sa gestion hors ligne est déjà implémentée, donc il existe déjà une mécanique de persistance locale et de synchronisation sur laquelle il faut s'appuyer plutôt que d'en inventer une seconde.

Côté pharmacie, quatre choses existent déjà. La géolocalisation des pharmacies, la mise en ligne du catalogue de médicaments, les alertes de stock, et un point de vente récemment ajouté qui décrémente le stock à la validation d'une vente. Il n'y a aucune gestion de caisse aujourd'hui.

L'objectif commercial immédiat est de vendre le volet pharmacie comme produit autonome aux officines de Conakry. Cette tranche doit donc rendre le module crédible en officine réelle, pas l'enrichir en surface.

La devise est le franc guinéen. Aucun montant n'a de décimale, tous les montants sont des entiers, et l'arrondi à l'entier le plus proche s'applique au montant de ligne et jamais aux prix unitaires stockés.

## Étape 0, lecture avant toute proposition

Avant d'écrire une seule ligne de code ou de proposer quoi que ce soit, lis le code existant et rends compte de ce que tu as trouvé. Explore en particulier le module pharmacie du backend, le module point de vente, les entités et migrations liées au stock et au catalogue, le code des alertes de stock, la couche RBAC et la façon dont les permissions sont déclarées et vérifiées, enfin la couche hors ligne et synchronisation du client Flutter.

Produis d'abord un inventaire factuel qui nomme les fichiers, les entités, les tables, les endpoints et les règles métier déjà codées. Dis explicitement ce qui, dans ma demande ci-dessous, existe déjà sous une autre forme, ce qui entre en conflit avec l'existant, et ce qui manque complètement. Si une hypothèse de ma demande est fausse au regard du code, dis-le au lieu de la contourner.

Signale en particulier comment le stock est tenu aujourd'hui, compteur mutable sur le produit ou journal de mouvements, parce que toute la migration en dépend.

## Étape 1, plan avant implémentation

Après l'inventaire, propose un plan d'implémentation et arrête-toi. Tu attends ma validation explicite avant d'écrire du code applicatif ou des migrations.

Le plan doit contenir le modèle de données retenu confronté à l'existant, la liste ordonnée des migrations avec leur stratégie de réversibilité, le découpage en lots de commits livrables indépendamment, les endpoints créés ou modifiés avec leur contrat, les points où tu as dû trancher entre deux options et la raison du choix, et la liste des questions ouvertes que tu ne peux pas résoudre seul.

Je veux un plan critiquable, pas un plan d'accord. Si une partie de ma demande est une mauvaise idée au regard du code existant ou du terrain, écris-le dans le plan.

## Chantier 1, déconditionnement et vente à l'unité

C'est le fondement, les deux autres chantiers en dépendent. À Conakry le client achète six comprimés, pas une boîte de vingt. Un module qui ne sait vendre que la boîte est inutilisable au comptoir.

Le stock doit être tenu dans une unité minimale indivisible propre au produit, le comprimé, le millilitre ou le sachet selon la forme galénique. La boîte cesse d'être l'unité de stock et devient une unité d'affichage, d'achat et de commande, reliée à l'unité minimale par un coefficient de conversion porté par le produit. Toute quantité persistée en base est exprimée en unité minimale, sans exception, y compris dans les lignes de vente, les mouvements d'inventaire et les réceptions d'achat. La conversion vers la boîte est un affichage, calculé en lecture.

Deux prix distincts coexistent, le prix de vente de la boîte entière et le prix de vente de l'unité. Ils sont saisis séparément par le titulaire et aucun des deux n'est jamais calculé depuis l'autre. Le prix unité multiplié par le coefficient n'a pas à égaler le prix boîte, c'est voulu, le déconditionnement se paie. Ne mets donc aucune validation qui force la cohérence arithmétique entre les deux, mets au plus un avertissement non bloquant quand l'écart dépasse un seuil paramétrable.

Le prix stocké sur la ligne de vente est toujours ramené à l'unité minimale. Une boîte de coefficient vingt vendue dix mille produit une ligne de quantité vingt, un prix unitaire appliqué de cinq cents et un montant de ligne de dix mille. Le montant de ligne est la seule valeur de référence pour les totaux, le prix unitaire appliqué sert à l'affichage et au contrôle, et l'arrondi éventuel de la division est porté par le montant de ligne et jamais répercuté sur le prix stocké.

Un produit peut être déclaré non déconditionnable, et dans ce cas la vente à l'unité est refusée au comptoir avec un message clair, le prix unité restant vide.

À l'inventaire, une tolérance d'écart paramétrable par produit absorbe les pertes normales de plaquettes entamées. Un mouvement d'inventaire est écrit dans tous les cas, y compris sous la tolérance, sinon le stock calculé reste durablement divergent du comptage physique. Ce que la tolérance change est la qualification, pas l'écriture. En dessous de la tolérance l'écart est enregistré sans ouvrir d'anomalie, au dessus il ouvre une anomalie attribuée à l'utilisateur qui a saisi le comptage.

Au comptoir, l'écran de vente affiche en permanence le reliquat du conditionnement entamé en cours pour le produit sélectionné, c'est à dire le nombre d'unités restantes dans la plaquette déjà ouverte. Le vendeur doit voir qu'il reste quatre comprimés sur la plaquette ouverte avant d'en ouvrir une nouvelle.

Un invariant conditionne cet affichage. Au plus un conditionnement est ouvert à la fois par produit, par lot et par point de vente. Sans cet invariant le reliquat n'est pas dérivable d'un solde en unités minimales et le chiffre affiché devient faux. Une ouverture de conditionnement alors qu'un autre est déjà ouvert sur le même triplet est refusée côté serveur.

## Chantier 2, stock par lot

Un même produit arrive en lots distincts, achetés à des coûts différents et périmant à des dates différentes. Tenir un stock global par produit interdit à la fois le rappel de lot et le calcul de marge réelle, donc le stock est tenu par lot.

Chaque lot porte son produit, son point de vente, son numéro de lot fournisseur, sa date de péremption, sa quantité reçue en unité minimale, son coût d'acquisition unitaire réel en unité minimale, son fournisseur, sa date de réception, et un indicateur de lot technique issu de la migration. Le coût d'acquisition est figé à la réception et ne change jamais ensuite.

La sélection du lot au moment de la vente suit deux règles, dans cet ordre strict. La première est le reliquat, si un conditionnement est déjà ouvert pour ce produit à ce point de vente, la sortie se fait sur le lot de ce conditionnement jusqu'à épuisement du reliquat, sans motif, sans confirmation et sans écran supplémentaire. La seconde est le FEFO, qui ne départage que l'ouverture d'un nouveau conditionnement, le lot dont la péremption est la plus proche sortant en premier, à égalité de péremption le lot reçu le plus tôt sortant en premier.

Cet ordre est volontaire et il prime sur le FEFO strict. Abandonner une plaquette entamée pour respecter le FEFO revient à jeter le reliquat, ce qui coûte plus cher que les quelques jours de péremption gagnés. Le FEFO reprend la main dès que le reliquat est épuisé.

Le tri FEFO est explicite sur les valeurs nulles, un lot sans date de péremption sort avant un lot daté. Sans cette précision le tri PostgreSQL par défaut placerait le stock issu de la migration en dernier et il ne sortirait jamais.

Une vente peut se répartir sur plusieurs lots quand le premier lot ne couvre pas la quantité demandée, et dans ce cas la ligne de vente se décompose en plusieurs allocations de lot. Chaque allocation enregistre le lot sorti, la quantité sortie en unité minimale et le coût d'acquisition unitaire réel de ce lot au moment de la sortie. Ces valeurs sont recopiées, pas référencées, pour que l'historique reste vrai si le lot est modifié ou supprimé plus tard.

Un lot périmé est exclu de la sélection FEFO automatique. La sortie manuelle d'un lot périmé, ou la sortie d'un lot choisi par le vendeur contre l'ordre ci dessus, reste possible mais exige un motif et trace l'utilisateur, parce que le terrain impose parfois cette entorse. Cette exigence de motif ne s'applique jamais au chemin nominal décrit plus haut.

Les alertes de péremption fonctionnent à plusieurs horizons paramétrables par la pharmacie, par exemple quatre vingt dix jours, trente jours et sept jours, plus l'état déjà périmé. Elles sont calculées par lot et non par produit, et elles valorisent la quantité menacée au coût d'acquisition pour que le titulaire voie l'argent en jeu et pas seulement un nombre de boîtes.

Les alertes de stock existantes doivent être recâblées sur le stock calculé par lot sans changer leur contrat côté client si c'est possible.

## Chantier 3, caisse, session et clôture

La caisse est un objet distinct du point de vente, et cette séparation est structurante. Le point de vente répond à la question de ce qui a été vendu. La caisse répond à la question de l'argent présent dans le tiroir et de qui en répond. Ne fusionne pas les deux et ne dérive pas l'un de l'autre.

Une session de caisse appartient à un utilisateur et à un poste de caisse. Elle s'ouvre avec un comptage d'ouverture saisi par coupure, qui est la source unique du fond de caisse et dont le fond déclaré est dérivé. Elle agrège les ventes encaissées sur sa période et elle se ferme par un comptage physique saisi par coupure monétaire, c'est à dire le nombre de billets et de pièces par valeur faciale. Le système calcule alors le théorique attendu et l'écart contre le compté.

Toute vente est rattachée à une session ouverte, et le rattachement est obligatoire. Pour que cette règle n'entre pas en conflit avec la garantie de ne jamais bloquer une vente, l'ouverture de session doit être possible hors ligne en un seul geste depuis l'écran de vente, le comptage d'ouverture pouvant être saisi après coup dans la session déjà ouverte. Une vente sans session n'existe jamais en base.

L'écart est affiché brut, signé, et n'est jamais corrigé automatiquement ni absorbé dans un compte de régularisation. Une session ne peut pas se fermer sans comptage de fermeture saisi. Un écart au dessus d'un seuil paramétrable exige un commentaire du responsable, mais la fermeture reste possible, parce qu'un logiciel qui empêche de fermer la caisse est un logiciel qu'on contourne.

La fermeture de session vise moins d'une minute pour le vendeur, saisie du comptage comprise. La saisie par coupure est pré remplie avec les valeurs faciales du franc guinéen et se renseigne au clavier numérique sans navigation. À la fermeture, le vendeur voit d'abord sa propre activité de la session, nombre de ventes et montant encaissé, et ensuite l'écart. Cette vue de performance destinée au vendeur fait partie du périmètre, elle est ce qui rend la fonction acceptable par la personne qui l'utilise tous les jours.

Les mouvements hors vente sont des objets de première classe, motivés et attribués, et ils couvrent au minimum le prélèvement vers le coffre ou le titulaire, l'apport de monnaie ou de fond complémentaire, et le remboursement client. Chacun porte son montant, son motif, son auteur, son horodatage et sa session.

Les modes de paiement sont distincts et le théorique de caisse est calculé par mode. Les espèces, Orange Money et MTN MoMo au minimum. Les modes vivent dans une table de référence alimentée en données et non dans un type énuméré PostgreSQL, parce qu'ajouter une valeur à un énuméré est une migration. Seules les espèces entrent dans le comptage physique du tiroir, les paiements mobiles se rapprochent de leur propre total et ont leur propre écart. Une vente peut être réglée en plusieurs paiements de modes différents, donc le paiement est une ligne rattachée à la vente et pas un champ de la vente.

La clôture journalière est un niveau au dessus de la fermeture de session. Elle verrouille la journée de la pharmacie une fois toutes les sessions du jour connues du serveur et fermées. Une session fermée sur un poste encore déconnecté empêche la clôture, et l'écran de clôture nomme explicitement les postes dont la remontée est attendue. Le titulaire peut forcer la clôture sans un poste manquant, auquel cas la remontée ultérieure de ce poste ne modifie pas la journée verrouillée, elle produit une écriture inverse rattachée à la journée courante et une anomalie nominative.

Une journée clôturée n'est plus modifiable. Elle reste corrigeable, uniquement par écriture inverse tracée, datée, motivée et attribuée, et rattachée à la journée ouverte au moment de la correction tout en pointant la pièce d'origine.

La marge réelle, calculée depuis les coûts d'acquisition portés par les allocations de lot, est derrière un droit de rôle. Le titulaire la voit, le vendeur ne la voit pas par défaut, et ce droit est déclaré dans le RBAC existant et vérifié côté serveur, pas masqué côté client.

La marge n'est jamais affichée sur un coût inventé. Une allocation portant un coût nul, ou portant un lot technique issu de la migration, est exclue du calcul et la vente concernée est marquée comme non valorisable. Les rapports de marge affichent le volume non valorisable à côté du résultat plutôt que d'agréger des zéros.

## Contraintes transverses

### Hors ligne

La vente, la consultation du catalogue et la session de caisse doivent fonctionner entièrement hors ligne, parce que la connexion n'est pas acquise en officine à Conakry. L'achat et la réception de lots, l'inventaire et le reporting restent des opérations en ligne, et le client doit le dire clairement à l'utilisateur plutôt que de faire semblant.

Chaque poste reçoit une plage de numéros de ticket réservée, attribuée au serveur et consommée localement, ce qui supprime les collisions sans coordination. Prévois le rechargement de la plage avant épuisement et le comportement quand elle est épuisée hors ligne.

Le stock négatif temporaire est accepté. Une vente ne se bloque jamais parce que le stock local dit zéro, l'anomalie est signalée à la synchronisation et remonte dans une file d'anomalies à traiter par le titulaire. Refuser la vente coûte plus cher que corriger l'écart après.

> Note du 2026-11-03 : révisé par le porteur, voir D713 dans decisions.md. En ligne, la vente au-delà du stock vendable est refusée ; hors ligne, elle reste acceptée ; l'écran n'affiche jamais de quantité négative (« 0 » et « N à régulariser »).

L'allocation de lot est différée dans ce cas précis. Quand aucun lot local ne peut recevoir la sortie, la ligne de vente est enregistrée avec une allocation marquée provisoire, portant le dernier lot connu pour ce produit ou aucun lot, et un coût d'acquisition nul. À la synchronisation, le serveur produit l'allocation définitive selon les règles du chantier 2 et ouvre une anomalie. L'invariant d'égalité entre la somme des allocations et la quantité de la ligne ne s'applique qu'aux lignes dont l'allocation est résolue, et une ligne provisoire est exclue du calcul de marge jusqu'à sa résolution.

La synchronisation est un journal d'événements rejoué dans l'ordre, pas une comparaison d'états. Chaque événement porte un identifiant client stable, un horodatage local, un numéro de séquence par poste et l'identifiant du poste. Le rejeu est idempotent. L'ordre de rejeu est l'ordre de séquence par poste, et les conflits inter postes sont résolus par règle métier explicite et non par le dernier écrivain gagnant.

### Multi point de vente

Même si le multi officine ne sera vendu à personne la première année, l'identifiant de point de vente est posé dès maintenant, non nullable, sur chaque mouvement de stock, chaque session de caisse, chaque vente et chaque lot, parce que l'ajouter après coup est une migration pénible sur des tables à fort volume.

### Vitesse au comptoir

La vente doit se saisir en moins de temps que le cahier papier utilisé aujourd'hui. C'est le critère numéro un, devant toute richesse fonctionnelle. Les cibles chiffrées sont une recherche produit qui répond en local en moins de cent cinquante millisecondes sans aller au réseau, un encaissement espèces d'une vente à une ligne en au plus cinq interactions depuis l'écran de vente, et une vente complète saisie en moins de vingt secondes. Aucune des règles ci dessus ne doit ajouter un écran ou une confirmation sur le chemin nominal. Quand une règle ralentit le chemin nominal, signale le compromis dans le plan au lieu de l'implémenter en silence.

### Immuabilité

Une vente validée, une délivrance et une session clôturée ne se modifient pas. Elles se corrigent par écriture inverse tracée et attribuée, qui pointe la pièce d'origine. Aucun endpoint ne doit permettre la mise à jour ou la suppression de ces objets, et les éventuels endpoints existants qui le permettent doivent être signalés dans l'inventaire.

## Modèle de données proposé

Ce qui suit est une proposition à confronter à l'existant, pas une spécification à appliquer telle quelle. Si le dépôt a déjà une entité qui couvre un de ces rôles, étends la au lieu d'en créer une parallèle, et dis le dans le plan.

```
Product
  unite_minimale (enum comprime, ml, sachet, gramme, unite)
  coefficient_boite (entier, unites minimales par boite)
  prix_boite, prix_unite (entiers GNF, saisis separement, independants)
  deconditionnable (booleen)
  tolerance_ecart_inventaire (pourcentage ou valeur absolue, nullable)

StockLot
  product_id, point_de_vente_id (non nul), numero_lot, date_peremption (nullable)
  quantite_recue (unite minimale), cout_acquisition_unitaire (unite minimale)
  fournisseur_id, date_reception
  lot_technique (booleen, issu de la migration, exclu du calcul de marge)
  cout_acquisition fige a la reception

StockMovement
  product_id, stock_lot_id, point_de_vente_id (non nul)
  type (reception, vente, retour, inventaire, perte, peremption, transfert, correction)
  quantite_signee (unite minimale), piece_origine_id, piece_origine_type
  auteur_id, horodatage_serveur, horodatage_local, poste_id, sequence_poste
  event_id client stable, immuable apres insertion

Sale
  point_de_vente_id (non nul), poste_id, numero_ticket (issu de la plage reservee)
  session_caisse_id (non nul), statut, auteur_id, totaux
  immuable apres validation

SaleLine
  sale_id, product_id, quantite (unite minimale), unite_affichee (boite ou unite)
  prix_unitaire_applique (GNF par unite minimale), montant_ligne (GNF, reference)

SaleLineLotAllocation
  sale_line_id, stock_lot_id (nullable si provisoire), quantite (unite minimale)
  cout_acquisition_unitaire_copie (recopie, pas reference)
  provisoire (booleen, resolu a la synchronisation)

Payment
  sale_id, mode_paiement_id (table de reference), montant, reference_externe

ModePaiement
  code, libelle, entre_dans_comptage_physique (booleen), actif

CashSession
  point_de_vente_id (non nul), poste_id, utilisateur_id
  ouverte_le, fermee_le
  statut (ouverte, fermee, incluse_dans_cloture)
  fond_de_caisse derive du CashCount d ouverture

CashCount
  cash_session_id, moment (ouverture, fermeture)
  lignes par coupure (valeur_faciale, nombre), total_compte

CashMovement
  cash_session_id, type (prelevement, apport, remboursement)
  montant, motif, auteur_id, horodatage

DailyClosure
  point_de_vente_id, date, totaux par mode de paiement
  ecart_par_mode, cloture_par_id, cloturee_le, verrouillee (booleen)
  postes_manquants_au_forcage

OpenCartonState
  product_id, point_de_vente_id, stock_lot_id, unites_restantes
  derive des mouvements, pas une source de verite independante
  au plus une ligne ouverte par product_id + stock_lot_id + point_de_vente_id
```

Invariants à respecter. Le stock disponible est calculé depuis les mouvements et n'est jamais stocké comme un compteur mutable incrémenté et décrémenté. Si la performance l'exige, utilise un agrégat de lecture reconstructible et clairement nommé comme tel, avec une commande de reconstruction complète depuis les mouvements, et un test qui vérifie que l'agrégat égale le recalcul. Le théorique de caisse est de la même façon calculé depuis les paiements et les mouvements de caisse de la session. La somme des allocations de lot d'une ligne de vente égale toujours la quantité de la ligne, sauf pour une ligne dont l'allocation est encore provisoire. Toute quantité en base est en unité minimale. Tout montant en base est un entier en francs guinéens.

## Migration

L'existant ne doit pas être cassé, et la migration la plus risquée est le passage du compteur de stock au stock calculé depuis les mouvements. Elle se fait dans cet ordre.

Les produits actuels sont migrés vers l'unité minimale avec un coefficient par défaut de un, ce qui laisse les stocks numériquement inchangés, et le prix unité est initialisé à vide avec le produit marqué non déconditionnable. Le titulaire renseigne ensuite le coefficient réel et le prix unité produit par produit, et l'interface doit rendre ce travail de qualification visible et faisable progressivement.

Le stock existant par produit est migré vers un lot technique unique par produit et par point de vente, sans numéro de lot fournisseur, avec une péremption nulle, un coût d'acquisition repris du dernier coût connu ou nul s'il n'existe pas, et l'indicateur de lot technique à vrai.

Chaque compteur de stock existant génère un mouvement d'entrée initial de type reception sur ce lot technique, daté de la migration et attribué à un auteur système. Sans ces mouvements, le stock calculé vaut zéro au lendemain du déploiement sur toute la base existante. C'est le point de la migration à tester en premier.

L'ancienne colonne de stock n'est pas supprimée dans le déploiement qui arrête de l'utiliser. Elle est conservée une version, en lecture seule, et une commande compare le stock calculé au compteur figé pour détecter toute divergence avant suppression.

Les lignes déjà en base qui reçoivent une colonne de point de vente non nullable sont remplies avec le point de vente unique de la pharmacie concernée, déterminé depuis la pharmacie propriétaire de la donnée. Si une ligne ne permet pas de le déterminer, la migration s'arrête et liste les lignes en cause au lieu de poser une valeur par défaut arbitraire.

Les ventes historiques ne sont pas réécrites et n'ont pas d'allocation de lot. Les rapports de marge indiquent la date de début de fiabilité au lieu d'agréger des zéros.

Chaque migration a sa procédure de retour en arrière.

## Hors périmètre

Tu n'implémentes pas de comptabilité générale, ni plan comptable, ni écritures en partie double, ni liasse fiscale. La caisse s'arrête à la session, à la clôture journalière et à l'export.

Tu n'implémentes pas le crédit client ni le carnet de dettes. C'est la tranche suivante et elle a son propre modèle de compte client.

Tu n'implémentes pas de moteur d'interactions médicamenteuses ni de contrôle de posologie.

Tu n'implémentes pas de catalogue grand public ni de recherche de médicaments côté patient.

Tu n'implémentes pas les conventions entreprises et assurances, ni le réapprovisionnement assisté, ni le rapport quotidien au titulaire.

Tu ne refais pas le front. Tu touches au front uniquement pour les écrans strictement nécessaires, l'affichage du reliquat de plaquette au comptoir, la saisie des deux prix, l'ouverture et la fermeture de session avec comptage par coupure. Pas de refonte de composants, pas de changement de librairie, pas de redesign.

Les ordonnances en ligne, les antécédents et les allergies arrivent par le volet hôpitaux et cliniques et ne sont pas dans ce périmètre. N'ajoute aucun champ ni endpoint les concernant.

## Critères d'acceptation

Chaque scénario doit être vérifiable par un test automatisé.

- Un produit de coefficient vingt, prix boîte dix mille et prix unité six cents, vendu six unités, décrémente le stock de six unités minimales et encaisse trois mille six cents, sans que le prix boîte intervienne dans le calcul.
- Le même produit vendu par boîte entière produit une ligne de quantité vingt, un prix unitaire appliqué de cinq cents et un montant de ligne de dix mille, pas de deux cents mille.
- Modifier le prix boîte d'un produit ne modifie pas son prix unité, et réciproquement.
- Un produit marqué non déconditionnable refuse la vente à l'unité avec un message explicite et accepte la vente par boîte.
- Après ouverture d'une plaquette de vingt et vente de six unités, le comptoir affiche quatorze unités restantes sur la plaquette en cours pour ce produit et ce lot.
- Une seconde ouverture de conditionnement sur un produit, un lot et un point de vente où un conditionnement est déjà ouvert est refusée par le serveur.
- Un lot B porte une plaquette ouverte et un lot A intact périme plus tôt. Les ventes à l'unité continuent de sortir sur le lot B jusqu'à épuisement du reliquat, sans motif demandé ni écran supplémentaire, et le lot A ne prend la main qu'à l'ouverture du conditionnement suivant.
- Un inventaire écrit un mouvement de type inventaire dans tous les cas. Sous la tolérance aucune anomalie n'est ouverte, au dessus une anomalie est ouverte et attribuée à l'auteur du comptage.
- Deux lots du même produit, aucun conditionnement ouvert, l'un périmant dans trente jours et l'autre dans quatre vingt dix, vendus pour une quantité supérieure au premier lot, produisent deux allocations, le lot à trente jours vidé d'abord.
- Un lot sans date de péremption sort avant un lot daté dans la sélection FEFO automatique.
- Chaque allocation porte le coût d'acquisition du lot concerné, et la marge de la vente est la somme des montants de ligne moins la somme des coûts alloués, pas une moyenne produit.
- Une vente dont une allocation porte un lot technique ou un coût nul est marquée non valorisable et exclue du calcul de marge, et le rapport affiche ce volume séparément.
- Un lot périmé n'est jamais sélectionné par le FEFO automatique, et sa sortie manuelle exige un motif enregistré.
- Les alertes de péremption remontent par lot aux horizons configurés et valorisent la quantité menacée au coût d'acquisition.
- Une session ouverte avec un comptage d'ouverture de deux cents mille, trois ventes espèces totalisant quatre cents mille, un prélèvement de cent mille et un comptage de fermeture de quatre cents quatre vingt dix mille affiche un théorique de cinq cents mille et un écart de moins dix mille, affiché tel quel.
- Une vente réglée moitié espèces moitié Orange Money crée deux paiements, n'alimente le théorique espèces que pour sa part espèces, et le rapprochement Orange Money a son propre écart.
- Un mode de paiement nouveau s'ajoute par insertion dans la table de référence, sans migration de schéma.
- Une session ne peut pas être fermée sans comptage de fermeture saisi, et un écart au dessus du seuil exige un commentaire.
- Aucune vente ne peut exister sans session de caisse, et l'ouverture de session hors ligne depuis l'écran de vente tient en une interaction.
- Une journée clôturée refuse toute écriture directe, et une correction produit une écriture inverse rattachée à la journée courante qui pointe la pièce d'origine.
- Une clôture forcée malgré un poste non synchronisé enregistre le poste manquant, et la remontée ultérieure de ce poste produit une écriture inverse sur la journée courante plus une anomalie, sans toucher la journée verrouillée.
- Un vendeur sans le droit de marge reçoit une réponse serveur sans aucune donnée de coût ni de marge, vérifié au niveau de l'endpoint et pas seulement de l'affichage.
- Hors ligne, deux postes vendent simultanément, les numéros de ticket ne collisionnent pas, et la synchronisation rejoue les deux journaux sans doublon ni perte.
- Hors ligne, une vente qui amène le stock local en négatif est acceptée avec une allocation provisoire, et la synchronisation produit l'allocation définitive plus une anomalie exploitable.
  > Note du 2026-11-03 (CA24) : critère maintenu hors ligne ; l'écran montre 0 et « N à régulariser », jamais un négatif. Voir D713 dans decisions.md.
- Rejouer deux fois le même journal de synchronisation ne crée aucun mouvement en double.
- Chaque mouvement de stock, chaque session de caisse, chaque vente et chaque lot porte un identifiant de point de vente non nul.

## Tests attendus

Des tests unitaires sur la conversion boîte vers unité minimale dans les deux sens avec les arrondis explicites en entiers de francs guinéens, sur l'indépendance des deux prix, sur la priorité du reliquat devant le FEFO, sur la sélection FEFO y compris la péremption nulle, l'égalité de péremption et la répartition multi lot, sur le calcul du théorique de caisse par mode de paiement, et sur le calcul de marge depuis les allocations avec exclusion des allocations non valorisables.

Des tests d'intégration sur le cycle complet de vente depuis la sélection produit jusqu'au mouvement de stock et aux allocations, sur le cycle d'ouverture et de fermeture de session avec comptage et écart, sur la clôture journalière, le refus d'écriture sur journée verrouillée, la clôture forcée avec poste manquant, et sur la correction par écriture inverse.

Des tests d'idempotence et d'ordre sur le rejeu du journal de synchronisation, avec un cas de doublon, un cas d'ordre inversé, un cas de stock négatif temporaire et un cas de résolution d'allocation provisoire.

Des tests de permission qui vérifient qu'un rôle vendeur n'obtient jamais de donnée de coût ou de marge par aucun endpoint.

Des tests de migration qui partent d'une base chargée avec des produits et des stocks au format actuel, appliquent les migrations, et vérifient que le stock calculé depuis les mouvements est égal au compteur d'origine produit par produit, que les ventes historiques restent lisibles, que les colonnes de point de vente sont remplies, et que le retour en arrière fonctionne.

Un test de non régression sur les alertes de stock existantes, qui doivent continuer à produire le même résultat après le passage au stock par lot.
