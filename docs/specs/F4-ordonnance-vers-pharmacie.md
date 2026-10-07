# F4 - Envoi d'une ordonnance vers une pharmacie (spécification, première étape)

Statut : proposition à valider par le porteur. Aucun code ni migration n'est appliqué par ce document.
Source : `BACKLOG-PRIORISE.md` (racine du monorepo), point F4. Dépendance : F2.

## 0. Existant sur lequel la spec s'appuie

Chemins relatifs au dépôt `back_medconnect` :

| Élément | Où | Ce qu'on en retient |
|---|---|---|
| `Ordonnance` | `prisma/schema.prisma` (modèle `Ordonnance`) | `medicaments` est un JSON **chiffré** (`[{nom, dosage, duree, instructions}]`), `notes` chiffré, `dateExpiration` optionnelle, `scanFileId` (document privé), `medecinId` nullable, `deletedAt` (soft-delete). |
| Création et lecture d'ordonnance | `src/carnet-sante/carnet-sante.service.ts` (`createOrdonnance`, `getOrdonnances`, `decryptOrdonnance`, `checkAccess`) et `src/carnet-sante/carnet-sante.controller.ts` (`POST /carnet-sante/ordonnances` sous `@RequirePermissions(PERMISSIONS.ORDONNANCE_WRITE)`) | Le chiffrement passe par `EncryptionService.encrypt(JSON.stringify(...))`. `checkAccess` couvre médecin traitant et `AutorisationStructure` : il ne doit **pas** être réutilisé pour la pharmacie (il ouvrirait le carnet entier). |
| DTO ligne d'ordonnance | `src/carnet-sante/dto/carnet-sante.dto.ts` (`MedicamentOrdonnanceDto`, `CreateOrdonnanceDto`) | Pas encore d'identifiant catalogue : F2 l'ajoutera dans le JSON, sans migration. |
| `User`, `Structure`, `StructureType` | `prisma/schema.prisma` | `StructureType.PHARMACIE` existe ; une structure a `isActive`, `isConfigured`, `latitude`/`longitude`, `horaires`, `estDeGarde`. Les pharmaciens sont des `User` avec `structureId`. |
| Catalogue et stock | `prisma/schema.prisma` (`Medicament`, `StockMedicament`, prix `prixUnitaire Float?` en GNF), `src/pharmacie/pharmacie.service.ts` (`rechercherDisponibilite`, `checkPharmacieAccess`, `calculateDistance`) | La recherche de disponibilité par pharmacie et par distance existe déjà : elle sert au choix de la pharmacie et au pré-remplissage de la réponse. |
| Permissions | `src/common/rbac/permissions.constants.ts`, `permissions.guard.ts`, `require-permissions.decorator.ts`, `permissions.service.ts` | Rôle par défaut « Pharmacien » : `STOCK_READ`, `STOCK_WRITE`, `CATALOGUE_WRITE`, `CHAT_STRUCTURE`, `STRUCTURE_READ`, `MEMBRE_READ`. Pas de `CARNET_READ`, ce qui est voulu. Le rôle système « Patient » a une liste vide : le libre-service patient se contrôle par propriété, pas par permission. |
| Consentement | `prisma/schema.prisma` (`AutorisationStructure`), `src/consent/consent.service.ts` | `AutorisationStructure` donne l'accès au carnet : trop large pour une pharmacie, à ne pas utiliser ici. |
| Audit | `prisma/schema.prisma` (`AuditLog`), `src/common/interceptors/audit.interceptor.ts`, `src/storage/file-access.service.ts` (`enregistrerAcces`) | Table d'audit générique existante ; l'intercepteur mappe des segments de route vers des entités. |
| Notifications | `prisma/schema.prisma` (`Notification`, `NotificationType`), `src/notifications/notifications.service.ts` (`createNotification`, `createManyNotifications`) | Notifications in-app avec `lien`. |
| File asynchrone | `src/queue/queue.service.ts` (`enqueueSms`, `enqueueSos`, `enqueueWelcomeEmail`, `enqueueEmergencyEmail`), `src/queue/notifications.processor.ts` | SMS disponible via la file ; pas de job d'email générique ; pas de `@nestjs/schedule` dans le projet (la purge de `src/storage/storage.service.ts` utilise un `setInterval`). |
| Documents | `prisma/schema.prisma` (`StoredFile`), `src/storage/storage.service.ts` (`claimPrivateForPatient`), `src/storage/file-access.service.ts` (`canReadPrivate`) | La lecture d'un document privé exige aujourd'hui `CARNET_READ` + équipe de soin : un pharmacien ne peut pas lire le scan d'ordonnance. |

## 1. Objectif et périmètre de la première étape

**Objectif.** Créer le lien entre l'ordonnance prescrite et la pharmacie qui délivre : le patient choisit une pharmacie, lui envoie son ordonnance, la pharmacie indique ce qu'elle peut fournir et à quel prix, le patient décide, puis passe retirer et payer sur place.

**Dans le périmètre :**
1. Le patient envoie **une** ordonnance de son carnet à **une** pharmacie de son choix.
2. La pharmacie répond **ligne par ligne** : disponible (avec prix), alternative proposée (autre médicament ou autre forme, avec prix), ou indisponible.
3. Le patient accepte (tout ou partie des lignes) ou refuse la proposition.
4. Acceptation = **réservation** : la pharmacie met les produits de côté jusqu'à une date limite de retrait.
5. **Paiement au retrait**, en pharmacie, hors application. L'application affiche un montant indicatif, elle n'encaisse rien.
6. **Retrait sur place** : le pharmacien marque la demande « retirée » à la remise, à l'aide d'un code de retrait présenté par le patient.
7. Expiration automatique des demandes sans réponse et des réservations non retirées.
8. Accès de la pharmacie limité à l'ordonnance envoyée, pour une durée limitée, tracé dans l'audit.

**Hors périmètre explicite (première étape) :**
- paiement en ligne ou mobile (Orange Money, MTN MoMo) ;
- livraison à domicile ;
- envoi simultané à plusieurs pharmacies, mise en concurrence, devis comparés ;
- décrément automatique du stock (`StockMedicament.quantite`) à la réservation ou au retrait ;
- envoi d'une ordonnance par le médecin directement à une pharmacie ;
- ordonnance papier saisie par le patient lui-même (voir question 9.5) ;
- messagerie libre entre patient et pharmacie (le chat de structure existe, il n'est pas branché ici) ;
- facturation, reçu, tiers payant, assurance ;
- application mobile native (le parcours est conçu pour la web app).

## 2. Parcours par rôle

Les textes entre guillemets sont des propositions de textes visibles. Ils suivent le régime non-dev de `docs/ORCHESTRATOR.md` (section 1 et section 14) : aucun terme interdit, erreurs actionnables, états vides qui guident.

### 2.1 Patient

**Étape 1 : depuis une ordonnance.** Sur la fiche d'une ordonnance (carnet de santé, onglet Ordonnances), un bouton « Envoyer à une pharmacie ».
- Bouton masqué si l'ordonnance est expirée ; à la place : « Cette ordonnance a expiré le 12/09/2026. Demandez une nouvelle ordonnance à votre médecin. »
- Si une demande est déjà en cours pour cette ordonnance : « Cette ordonnance est déjà envoyée à la pharmacie Centrale de Kaloum. Voir la demande. »

**Étape 2 : choisir la pharmacie.** Liste des pharmacies (proximité si la position est partagée, sinon par ville), avec pour chacune : nom, quartier, distance, « Ouverte » / « Fermée » / « De garde », et un indicateur « 3 médicaments sur 4 annoncés en stock » quand les lignes portent un identifiant catalogue (F2). L'indicateur est présenté comme indicatif : « Disponibilité indicative, la pharmacie confirmera. »
- État vide : « Aucune pharmacie inscrite près de vous pour le moment. Élargissez la recherche à toute la ville ou réessayez plus tard. » avec bouton « Chercher dans toute la ville ».

**Étape 3 : vérifier ce qui sera partagé.** Écran récapitulatif avant envoi :
- « La pharmacie verra uniquement : votre nom, votre numéro de téléphone, les médicaments de cette ordonnance avec leur posologie, et le document scanné s'il y en a un. Elle ne verra pas le reste de votre carnet de santé. »
- Case optionnelle par ligne « Je ne veux pas ce médicament » (le patient peut déjà avoir un produit chez lui).
- Champ libre optionnel : « Un message pour la pharmacie (facultatif) ».
- Bouton « Envoyer la demande ».
- Confirmation : « Demande envoyée à la pharmacie Centrale de Kaloum. Vous recevrez un SMS dès qu'elle aura répondu. »

**Étape 4 : suivre et décider.** Page « Mes demandes en pharmacie » (accessible aussi depuis la notification).
- Proposition reçue : tableau par ligne (« Disponible, 15 000 GNF », « Remplacé par Paracétamol 500 mg, 5 000 GNF », « Indisponible »), total indicatif, date limite pour répondre.
- Le patient coche les lignes qu'il prend (toutes cochées par défaut, sauf les indisponibles), puis « Réserver ces médicaments » ou « Refuser la proposition ».
- Avant de réserver : « Vous paierez à la pharmacie au moment du retrait. Montant estimé : 20 000 GNF. »
- Après réservation : code de retrait affiché en grand (6 caractères, alphabet sans ambiguïté, comme dans `src/consent/consent.service.ts`) et rappel « À retirer avant le 08/10/2026 à 18 h. Présentez ce code au pharmacien. »
- État vide de la page : « Vous n'avez encore envoyé aucune ordonnance à une pharmacie. Ouvrez une ordonnance de votre carnet pour l'envoyer. » avec bouton « Voir mes ordonnances ».

**Annulation.** « Annuler la demande » possible tant que la demande n'est pas retirée. Confirmation : « Annuler cette demande ? La pharmacie sera prévenue et ne pourra plus voir votre ordonnance. » Boutons « Annuler la demande » / « Garder ».

**Erreurs affichables (exemples) :**
- « Cette pharmacie n'accepte pas de demandes pour le moment. Choisissez-en une autre. »
- « Cette ordonnance est introuvable. Elle a peut-être été retirée de votre carnet. »
- « La pharmacie a déjà répondu entre-temps. Actualisez la page pour voir sa proposition. »
- « Ce délai est dépassé : la proposition n'est plus valable. Vous pouvez envoyer à nouveau votre ordonnance. »
- « Le service est momentanément indisponible, réessayez dans quelques instants. »

### 2.2 Pharmacien

**Étape 1 : recevoir.** Nouvel onglet « Ordonnances reçues » dans l'espace pharmacie, avec un compteur. Notification in-app à chaque nouvelle demande.
- Filtres : « À traiter », « En attente du patient », « À retirer », « Terminées ».
- État vide « À traiter » : « Aucune ordonnance reçue pour le moment. Les demandes des patients apparaîtront ici. »

**Étape 2 : consulter.** Fiche de la demande : nom et prénom du patient, téléphone, date de l'ordonnance, nom du prescripteur, lignes (médicament, posologie, durée, instructions), message du patient, document scanné s'il existe (bouton « Voir l'ordonnance scannée »), délai de réponse restant. Chaque ouverture est tracée (section 6).

**Étape 3 : répondre.** Pour chaque ligne, trois choix : « Disponible », « Je propose autre chose », « Indisponible ».
- « Disponible » : prix unitaire et quantité, pré-remplis depuis le stock de l'officine quand la ligne porte un identifiant catalogue et qu'un `StockMedicament` existe ; modifiables.
- « Je propose autre chose » : recherche dans le catalogue (ou saisie libre), prix, quantité, et un commentaire (« Même molécule, autre marque »).
- « Indisponible » : rien à saisir.
- Date limite de retrait proposée (par défaut : fin du jour ouvré suivant, modifiable).
- Message optionnel au patient.
- Bouton « Envoyer la proposition au patient ». Bloqué tant qu'une ligne n'a pas de choix : « Indiquez pour chaque médicament s'il est disponible, remplacé ou indisponible. »
- Bouton secondaire « Je ne peux pas traiter cette demande » avec motif obligatoire (liste : « Officine fermée », « Aucun médicament disponible », « Ordonnance illisible ou incomplète », « Autre ») ; confirmation avant envoi.

**Étape 4 : remettre.** Quand le patient a réservé, la demande passe dans « À retirer » avec les lignes retenues et le total. Au comptoir : « Saisir le code de retrait » puis « Confirmer la remise ». Code faux : « Ce code ne correspond pas à cette demande. Vérifiez-le avec le patient. »

**Erreurs affichables (exemples) :**
- « Cette demande a été annulée par le patient. »
- « Le délai de réponse est dépassé : cette demande n'est plus modifiable. »
- « Vous n'avez pas accès à cette information. » (pharmacien d'une autre officine)

### 2.3 Médecin

Première étape : **aucune action nouvelle.** Le médecin prescrit comme aujourd'hui (`POST /carnet-sante/ordonnances`). Avec F2, ses lignes portent un identifiant catalogue, ce qui améliore la disponibilité indicative et le pré-remplissage côté pharmacie.
Option à trancher (question 9.8) : afficher au médecin prescripteur, sur l'ordonnance, un simple statut « Délivrée le 08/10/2026 » sans nom de pharmacie ni prix, utile au suivi du traitement. Par défaut : non affiché dans la première étape.

### 2.4 Administrateur de l'établissement (pharmacie)

Le rôle par défaut « Administrateur de structure » d'une pharmacie n'a pas d'accès clinique (`DEFAULT_STRUCTURE_ROLES.PHARMACIE` dans `src/common/rbac/permissions.constants.ts`). Proposition :
- il **ne lit pas** les demandes (contenu médical) ;
- il voit un tableau de bord chiffré : « 12 ordonnances reçues cette semaine, 9 traitées, 2 expirées sans réponse » ;
- il peut accorder la nouvelle permission de traitement (section 5) à un rôle de son officine, via l'écran de rôles existant.

État vide : « Aucune ordonnance reçue cette semaine. »

### 2.5 Agent d'accueil

Non concerné. Le rôle « Accueil » n'existe par défaut que dans les hôpitaux et cliniques, et n'a pas accès aux ordonnances. Aucune évolution dans cette étape.

## 3. Cycle de vie de la demande

### 3.1 États

| Libellé technique | Libellé côté patient | Libellé côté pharmacie | Terminal |
|---|---|---|---|
| `ENVOYEE` | « Envoyée, en attente de la pharmacie » | « À traiter » | non |
| `PROPOSITION_RECUE` | « Réponse de la pharmacie reçue » | « En attente du patient » | non |
| `RESERVEE` | « Réservée, à retirer avant le ... » | « À retirer » | non |
| `RETIREE` | « Retirée le ... » | « Remise le ... » | oui |
| `REFUSEE_PATIENT` | « Vous avez refusé la proposition » | « Refusée par le patient » | oui |
| `DECLINEE_PHARMACIE` | « La pharmacie ne peut pas traiter votre demande » | « Déclinée » | oui |
| `ANNULEE` | « Annulée » | « Annulée par le patient » | oui |
| `EXPIREE` | « Sans réponse dans les délais » | « Délai de réponse dépassé » | oui |
| `NON_RETIREE` | « Réservation expirée, non retirée » | « Non retirée » | oui |

### 3.2 Transitions autorisées

| De | Vers | Déclencheur | Condition |
|---|---|---|---|
| (aucun) | `ENVOYEE` | patient | ordonnance du patient, non supprimée, non expirée ; pharmacie active et configurée ; aucune autre demande non terminale sur cette ordonnance |
| `ENVOYEE` | `PROPOSITION_RECUE` | pharmacien | toutes les lignes ont un statut ; délai de réponse non dépassé |
| `ENVOYEE` | `DECLINEE_PHARMACIE` | pharmacien | motif obligatoire |
| `ENVOYEE` | `ANNULEE` | patient | aucune |
| `ENVOYEE` | `EXPIREE` | système | délai de réponse pharmacie dépassé |
| `PROPOSITION_RECUE` | `RESERVEE` | patient | au moins une ligne disponible ou remplacée retenue ; délai de décision non dépassé |
| `PROPOSITION_RECUE` | `REFUSEE_PATIENT` | patient | aucune |
| `PROPOSITION_RECUE` | `ANNULEE` | patient | aucune |
| `PROPOSITION_RECUE` | `EXPIREE` | système | délai de décision patient dépassé |
| `RESERVEE` | `RETIREE` | pharmacien | code de retrait correct |
| `RESERVEE` | `ANNULEE` | patient | aucune (la pharmacie est prévenue) |
| `RESERVEE` | `NON_RETIREE` | système | date limite de retrait dépassée |

Toute autre transition est refusée avec un message affichable (exemple : « Cette demande n'est plus modifiable. »). La transition se fait par un `updateMany` conditionné sur le statut attendu (`where: { id, statut: <attendu> }`) : si zéro ligne est modifiée, quelqu'un est passé avant, et le message « La demande a changé entre-temps. Actualisez la page. » est renvoyé. Cela évite les courses entre une réponse de la pharmacie et une annulation du patient.

Après un état terminal, le patient peut envoyer une nouvelle demande pour la même ordonnance (à la même ou à une autre pharmacie), tant que l'ordonnance n'est pas expirée.

### 3.3 Expirations (valeurs par défaut, révisables : question 9.6)

| Délai | Valeur proposée | Effet |
|---|---|---|
| Réponse de la pharmacie | 24 h après l'envoi | `ENVOYEE` vers `EXPIREE` |
| Décision du patient | 48 h après la proposition | `PROPOSITION_RECUE` vers `EXPIREE` |
| Retrait | date limite fixée par la pharmacie, 72 h maximum après la réservation | `RESERVEE` vers `NON_RETIREE` |
| Accès de la pharmacie au contenu | 30 jours après l'état terminal | lecture du détail refusée ensuite, seule la ligne de liste reste (date, statut, montant) |

Mécanisme : un job BullMQ **différé** par échéance (`delay` = échéance moins maintenant), ajouté dans la file existante (`src/queue/queue.service.ts`), dont le traitement applique la transition conditionnelle de 3.2. Filet de sécurité : la lecture d'une demande dont l'échéance est passée applique aussi la transition (expiration paresseuse), ce qui couvre un job perdu. Pas d'ajout de `@nestjs/schedule`.

### 3.4 Annulation

- **Patient** : à tout moment avant `RETIREE`.
- **Pharmacie** : « décliner » avant sa réponse. Après réservation, la pharmacie ne peut pas annuler seule dans cette étape ; elle appelle le patient (téléphone visible sur la fiche). Question 9.7.
- **Suppression de l'ordonnance** par le patient (`deleteOrdonnance`, soft-delete) : toute demande non terminale liée passe en `ANNULEE`, la pharmacie est prévenue.

## 4. Modèle de données proposé (non appliqué)

```prisma
// ====== ORDONNANCE VERS PHARMACIE (F4) ======

enum DemandePharmacieStatut {
  ENVOYEE
  PROPOSITION_RECUE
  RESERVEE
  RETIREE
  REFUSEE_PATIENT
  DECLINEE_PHARMACIE
  ANNULEE
  EXPIREE
  NON_RETIREE
}

enum LigneDemandeStatut {
  EN_ATTENTE    // pas encore traitée par la pharmacie
  DISPONIBLE
  ALTERNATIVE   // autre médicament ou autre forme proposé
  INDISPONIBLE
  EXCLUE        // le patient ne la demande pas (case « Je ne veux pas ce médicament »)
}

model DemandePharmacie {
  id            String   @id @default(uuid())

  patientId     String
  patient       User       @relation("PatientDemandesPharmacie", fields: [patientId], references: [id], onDelete: Restrict)
  structureId   String
  structure     Structure  @relation("StructureDemandesPharmacie", fields: [structureId], references: [id], onDelete: Restrict)
  ordonnanceId  String
  ordonnance    Ordonnance @relation(fields: [ordonnanceId], references: [id], onDelete: Restrict)

  statut        DemandePharmacieStatut @default(ENVOYEE)

  messagePatient   String?  // chiffré (EncryptionService)
  messagePharmacie String?  // chiffré
  motifDeclin      String?  // valeur de liste fermée, non sensible

  montantTotal  Int?       // GNF, entier, calculé à la réponse puis à la réservation
  codeRetraitHash String?  // hash du code de retrait, sert à la vérification au comptoir
  codeRetrait     String?  // chiffré, pour réafficher le code au patient tant que la demande est RESERVEE

  traiteParId   String?    // pharmacien qui a répondu
  traitePar     User?      @relation("PharmacienDemandesTraitees", fields: [traiteParId], references: [id], onDelete: SetNull)
  remisParId    String?    // pharmacien qui a remis les produits
  remisPar      User?      @relation("PharmacienDemandesRemises", fields: [remisParId], references: [id], onDelete: SetNull)

  // Horodatages du cycle de vie
  envoyeeAt     DateTime  @default(now())
  reponduAt     DateTime?
  reserveeAt    DateTime?
  retireeAt     DateTime?
  clotureeAt    DateTime? // date d'entrée dans un état terminal
  echeanceAt    DateTime  // prochaine échéance (réponse, décision ou retrait selon le statut)
  accesFinAt    DateTime? // fin de l'accès de la pharmacie au contenu (clotureeAt + 30 j)

  lignes        LigneDemandePharmacie[]

  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([structureId, statut, envoyeeAt])
  @@index([patientId, statut])
  @@index([ordonnanceId, statut])
  @@index([statut, echeanceAt])
}

model LigneDemandePharmacie {
  id            String   @id @default(uuid())
  demandeId     String
  demande       DemandePharmacie @relation(fields: [demandeId], references: [id], onDelete: Cascade)

  ordre         Int      // position de la ligne dans le JSON `medicaments` de l'ordonnance

  // Copie de la prescription au moment de l'envoi (chiffrée)
  libellePrescrit String   // chiffré : nom saisi par le médecin
  posologie       String   // chiffré : JSON {dosage, duree, instructions}
  medicamentId    String?  // identifiant catalogue issu de F2 ; null si hors catalogue ou ordonnance antérieure à F2
  medicament      Medicament? @relation("LignesDemandePrescrit", fields: [medicamentId], references: [id], onDelete: SetNull)

  // Réponse de la pharmacie
  statut          LigneDemandeStatut @default(EN_ATTENTE)
  quantite        Int?     // nombre de boîtes ou unités proposées
  prixUnitaire    Int?     // GNF, entier
  alternativeMedicamentId String?
  alternativeMedicament   Medicament? @relation("LignesDemandeAlternative", fields: [alternativeMedicamentId], references: [id], onDelete: SetNull)
  alternativeLibelle      String?  // saisie libre si l'alternative n'est pas au catalogue
  commentairePharmacie    String?  // chiffré

  // Décision du patient
  retenue         Boolean? // null tant que le patient n'a pas décidé

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([demandeId, ordre])
}
```

Relations inverses à ajouter : `User.demandesPharmacie`, `User.demandesPharmacieTraitees`, `User.demandesPharmacieRemises`, `Structure.demandesPharmacie`, `Ordonnance.demandesPharmacie`, `Medicament.lignesDemandePrescrit`, `Medicament.lignesDemandeAlternative`. Ajout d'une valeur `DEMANDE_PHARMACIE` à l'enum `NotificationType`.

**Justification des choix :**
- **Deux modèles (demande + lignes)** : la réponse se fait ligne par ligne, un JSON ne permettrait ni contrôle de cohérence ni index sur l'identifiant catalogue.
- **Réponse de la pharmacie portée par les lignes et la demande, pas de modèle séparé** : une seule réponse par demande dans cette étape, un modèle de plus n'apporterait qu'une jointure.
- **Copie de la prescription dans les lignes** : la pharmacie lit la copie, jamais l'`Ordonnance` elle-même, ce qui borne techniquement ce qu'elle voit et fige ce qui a été envoyé même si l'ordonnance change ensuite.
- **`medicamentId` nullable** : F2 n'est pas supposé livré ; une ligne sans identifiant (hors catalogue ou ancienne ordonnance) reste traitée en saisie libre, seule la disponibilité indicative et le pré-remplissage du prix disparaissent.
- **`ordre`** : relie chaque ligne à sa position dans le JSON `medicaments`, qui n'a pas d'identifiant de ligne.
- **Chiffrement de `libellePrescrit`, `posologie`, messages et commentaire** : mêmes données que `Ordonnance.medicaments` et `notes`, déjà chiffrées par `EncryptionService` ; le statut, les prix et les dates restent en clair pour filtrer et compter.
- **Prix en `Int` (GNF)** : le franc guinéen n'a pas de subdivision en usage, un entier évite les erreurs d'arrondi (`StockMedicament.prixUnitaire` est un `Float?` existant, converti à la lecture).
- **`montantTotal` stocké** : le total affiché au patient au moment de réserver doit rester celui qu'il a vu, même si le stock change.
- **`codeRetraitHash` et `codeRetrait` chiffré** : la vérification au comptoir se fait sur le hash, la valeur chiffrée sert seulement au réaffichage pour le patient ; aucun code n'est lisible en clair en base.
- **`traiteParId` et `remisParId`** : savoir quel pharmacien a répondu et remis, en plus de l'`AuditLog`.
- **Horodatages par étape plus `echeanceAt`** : chaque étape est datée pour l'historique, et `echeanceAt` indexé permet l'expiration paresseuse et un rattrapage par lot.
- **`accesFinAt`** : matérialise la fin de l'accès de la pharmacie au contenu (section 6).
- **`deletedAt`** : soft-delete, comme `Ordonnance`, `Consultation` et les autres données de santé.
- **`onDelete: Restrict` sur patient, pharmacie et ordonnance** : une demande est une trace de dispensation, elle ne doit pas disparaître en cascade ; l'ordonnance étant en soft-delete, la contrainte ne gêne pas le parcours normal.
- **Pas d'unicité « une demande active par ordonnance » en base** : Prisma ne gère pas l'index unique partiel ; la règle est vérifiée dans le service, dans une transaction.
- **Une seule valeur de `NotificationType`** : le titre et le message portent la nuance, ce qui limite les migrations d'enum.

## 5. Endpoints proposés

Nouveau module `src/demande-pharmacie/` (controller, service, dto, module), `imports: [AuthModule]`, contrôleur sous `@UseGuards(AuthGuard, PermissionsGuard)` comme `src/carnet-sante/carnet-sante.controller.ts`. Réponses au format existant `{ data, message, success }`.

Nouvelle permission dans `src/common/rbac/permissions.constants.ts` :
- `ORDONNANCE_PHARMACIE_TRAITER: 'ordonnance-pharmacie:traiter'`, libellé « Recevoir et traiter les ordonnances envoyées à l'officine », catégorie « Pharmacie », ajoutée au rôle par défaut « Pharmacien » de `DEFAULT_STRUCTURE_ROLES.PHARMACIE`, délégable. Seed et rôles existants à mettre à jour.

Contrôle de périmètre côté pharmacie (en plus de la permission) : l'utilisateur doit appartenir en base à `demande.structureId` (revérification de `User.structureId`, comme `checkAccess` et `estDansEquipeDeSoin` le font contre un JWT figé), la structure doit être de type `PHARMACIE`, et `accesFinAt` ne doit pas être dépassé pour lire le contenu.

### 5.1 Patient (libre-service, contrôle par propriété, pas de permission)

| Méthode et chemin | DTO résumé | Effet | Erreurs (message affichable) |
|---|---|---|---|
| `GET /demandes-pharmacie/pharmacies?ordonnanceId=&lat=&lng=&ville=` | paramètres | Pharmacies actives et configurées, distance, ouverture, couverture indicative des lignes (réutilise la logique de `rechercherDisponibilite`) | 404 « Cette ordonnance est introuvable. » |
| `POST /demandes-pharmacie` | `{ ordonnanceId: UUID, structureId: UUID, lignesExclues?: int[], messagePatient?: string (500 max) }` | Crée la demande `ENVOYEE` et ses lignes (copie chiffrée), planifie l'échéance, notifie la pharmacie | 404 « Cette ordonnance est introuvable. » ; 400 « Cette ordonnance a expiré. Demandez une nouvelle ordonnance à votre médecin. » ; 400 « Cette pharmacie n'accepte pas de demandes pour le moment. Choisissez-en une autre. » ; 409 « Cette ordonnance est déjà envoyée à une pharmacie. Annulez d'abord cette demande pour en choisir une autre. » ; 400 « Cette ordonnance ne contient aucun médicament à envoyer. » |
| `GET /demandes-pharmacie/mes-demandes?statut=` | paramètres | Liste des demandes du patient | aucune |
| `GET /demandes-pharmacie/:id` | aucun | Détail (lignes déchiffrées, proposition, code de retrait si `RESERVEE`) | 404 « Cette demande est introuvable. » |
| `POST /demandes-pharmacie/:id/reserver` | `{ lignesRetenues: int[] }` (valeurs de `ordre`) | `PROPOSITION_RECUE` vers `RESERVEE`, calcule le total, génère le code de retrait (renvoyé une fois, stocké haché) | 400 « Choisissez au moins un médicament disponible à réserver. » ; 409 « Cette demande n'est plus modifiable. » ; 410 « Ce délai est dépassé : la proposition n'est plus valable. Vous pouvez envoyer à nouveau votre ordonnance. » |
| `POST /demandes-pharmacie/:id/refuser` | aucun | vers `REFUSEE_PATIENT` | 409 « Cette demande n'est plus modifiable. » |
| `POST /demandes-pharmacie/:id/annuler` | aucun | vers `ANNULEE`, notifie la pharmacie | 409 « Cette demande est déjà terminée. » |

Le code de retrait est affiché dans le détail tant que la demande est `RESERVEE` : il est donc conservé chiffré (`codeRetrait`) en plus du hash (`codeRetraitHash`), pour que le patient le retrouve sans action ; les deux sont vidés au passage dans un état terminal.

### 5.2 Pharmacie (`@RequirePermissions(PERMISSIONS.ORDONNANCE_PHARMACIE_TRAITER)` + périmètre)

| Méthode et chemin | DTO résumé | Effet | Erreurs (message affichable) |
|---|---|---|---|
| `GET /demandes-pharmacie/officine?statut=` | paramètres | Demandes de l'officine de l'utilisateur, sans contenu médical (patient, date, statut, nombre de lignes, échéance) | 403 « Vous n'avez pas accès à cette information. » |
| `GET /demandes-pharmacie/officine/:id` | aucun | Détail avec lignes déchiffrées et prix de stock suggérés ; trace `read` dans l'audit | 404 « Cette demande est introuvable. » ; 403 « Cette demande n'est plus consultable. » (après `accesFinAt`) |
| `GET /demandes-pharmacie/officine/:id/ordonnance-scannee` | aucun | Lien de lecture court du scan, via `StorageService.getSignedReadUrl` ; trace dans l'audit | 404 « Aucun document scanné pour cette ordonnance. » |
| `POST /demandes-pharmacie/officine/:id/repondre` | `{ lignes: [{ ordre, statut: DISPONIBLE\|ALTERNATIVE\|INDISPONIBLE, quantite?, prixUnitaire?, alternativeMedicamentId?, alternativeLibelle?, commentaire? }], retraitAvant?: date, messagePharmacie? }` | `ENVOYEE` vers `PROPOSITION_RECUE`, notifie le patient | 400 « Indiquez pour chaque médicament s'il est disponible, remplacé ou indisponible. » ; 400 « Indiquez un prix pour chaque médicament disponible ou remplacé. » ; 409 « Cette demande a été annulée par le patient. » ; 410 « Le délai de réponse est dépassé : cette demande n'est plus modifiable. » |
| `POST /demandes-pharmacie/officine/:id/decliner` | `{ motif: enum, precision?: string }` | vers `DECLINEE_PHARMACIE`, notifie le patient | 409 « Cette demande n'est plus modifiable. » |
| `POST /demandes-pharmacie/officine/:id/remettre` | `{ codeRetrait: string(6) }` | `RESERVEE` vers `RETIREE`, notifie le patient | 400 « Ce code ne correspond pas à cette demande. Vérifiez-le avec le patient. » (avec limite de tentatives, puis « Trop d'essais. Réessayez dans quelques minutes. ») ; 410 « La réservation a expiré. » |

### 5.3 Administrateur de l'établissement

| Méthode et chemin | Permission | Effet |
|---|---|---|
| `GET /demandes-pharmacie/officine/statistiques?periode=` | `STRUCTURE_READ` + périmètre | Compteurs par statut, sans aucun contenu médical |

Validation : DTO `class-validator` (le `ValidationPipe` global refuse les champs non déclarés), `@IsUUID()` sur les identifiants, `@ValidateNested` sur les lignes, prix `@IsInt() @Min(0)`. Les messages de validation renvoyés au front pour ces DTO sont rédigés en français utilisateur (option `message` des décorateurs).

## 6. Consentement et confidentialité

- **Consentement explicite par envoi** : l'envoi lui-même est l'acte de consentement, précédé de l'écran récapitulatif (2.1, étape 3). Aucune `AutorisationStructure` n'est créée : elle ouvrirait le carnet entier.
- **Minimisation** : la pharmacie voit nom, prénom, téléphone du patient, date de l'ordonnance, nom du prescripteur, lignes (médicament, posologie, durée, instructions), message du patient, et le scan s'il existe. Elle ne voit **pas** : `notes` de l'ordonnance (peuvent contenir un diagnostic), consultation liée, diagnostic, allergies, pathologies, autres ordonnances, date de naissance. Les lignes exclues par le patient ne sont pas transmises du tout.
- **Point d'attention sur le scan** : un scan peut contenir plus que les médicaments (diagnostic manuscrit, autres mentions). L'écran récapitulatif le dit au patient : « Le document scanné sera visible en entier par la pharmacie. » Avec une case « Ne pas joindre le document scanné » (par défaut : joint, car la pharmacie peut en avoir besoin pour délivrer). À valider (question 9.9).
- **Accès au scan** : `FileAccessService.canReadPrivate` (`src/storage/file-access.service.ts`) exige `CARNET_READ`, que le pharmacien n'a pas. Plutôt que d'élargir cette règle, l'endpoint `officine/:id/ordonnance-scannee` vérifie la demande (périmètre, statut non terminal ou `accesFinAt` non dépassé) puis délivre directement le lien de lecture court ; l'audit est écrit avec `entityType: 'StoredFile'` comme dans `enregistrerAcces`.
- **Durée de l'accès** : pleine tant que la demande n'est pas terminale, puis 30 jours après la clôture (litige, rappel de lot). Ensuite, la pharmacie ne voit plus que la ligne de liste (date, statut, montant). Durée de conservation réglementaire à vérifier (question 9.3).
- **Révocation** : l'annulation par le patient coupe immédiatement l'accès au contenu (`accesFinAt = maintenant`). Après un retrait, le patient ne peut pas effacer la trace de dispensation chez la pharmacie (obligation probable de conservation, à vérifier).
- **Audit** : chaque lecture du détail, lecture du scan, réponse, déclin, remise, réservation, annulation et expiration crée une entrée `AuditLog` (`entityType: 'DemandePharmacie'`, `entityId`, `userId`, `ip`, `metadata` sans donnée médicale : statut avant et après). Les lectures de liste ne sont pas journalisées, comme pour le carnet (`src/common/interceptors/audit.interceptor.ts`). Implémentation : ajout du segment `demandes-pharmacie` à la table `ENTITES` de l'intercepteur si la résolution de cible convient, sinon écriture explicite dans le service, en best-effort (une erreur d'audit ne fait pas échouer la requête).
- **Visibilité pour le patient** : le détail de la demande affiche « Consultée par la pharmacie le 07/10/2026 à 10 h 12 » (première lecture), tiré de l'audit.
- **Logs** : aucune donnée de ligne ni message en clair dans les logs applicatifs ; seuls l'identifiant de demande et les statuts.

## 7. Notifications

Canaux : in-app via `NotificationsService.createNotification` / `createManyNotifications` (type `DEMANDE_PHARMACIE`, `lien` vers l'écran concerné) ; SMS via `QueueService.enqueueSms` (déjà en file, avec reprises). Pas d'email dans cette étape : la file n'a pas de job d'email générique, et le SMS est le canal le plus fiable pour les patients visés (question 9.10). Aucun SMS ne contient de nom de médicament.

| Événement | Destinataires | Canal | Titre in-app | Message (in-app ; SMS identique sauf mention) |
|---|---|---|---|---|
| Demande envoyée | pharmaciens actifs de l'officine ayant la permission | in-app | « Nouvelle ordonnance reçue » | « Un patient vous a envoyé une ordonnance. Répondez avant demain 10 h. » |
| Proposition envoyée | patient | in-app + SMS | « Réponse de la pharmacie » | « La pharmacie Centrale de Kaloum a répondu à votre demande. Consultez sa proposition sur MedConnecte avant le 09/10 à 10 h. » |
| Demande déclinée | patient | in-app + SMS | « Demande non traitée » | « La pharmacie Centrale de Kaloum ne peut pas traiter votre demande. Vous pouvez envoyer votre ordonnance à une autre pharmacie sur MedConnecte. » |
| Réservation | pharmaciens de l'officine | in-app | « Médicaments à préparer » | « Un patient a réservé ses médicaments. Retrait prévu avant le 08/10 à 18 h. » |
| Réservation (confirmation) | patient | in-app + SMS | « Réservation confirmée » | « Vos médicaments sont réservés à la pharmacie Centrale de Kaloum jusqu'au 08/10 à 18 h. Code de retrait : K7M4QP. Paiement sur place. » |
| Rappel de retrait (6 h avant l'échéance) | patient | SMS | (aucun) | « Rappel : vos médicaments vous attendent à la pharmacie Centrale de Kaloum jusqu'à 18 h aujourd'hui. Code : K7M4QP. » |
| Retrait | patient | in-app | « Médicaments retirés » | « Vous avez retiré vos médicaments à la pharmacie Centrale de Kaloum. » |
| Annulation par le patient | pharmaciens de l'officine | in-app | « Demande annulée » | « Le patient a annulé sa demande. Vous n'avez plus rien à préparer. » |
| Expiration sans réponse | patient | in-app + SMS | « Pas de réponse de la pharmacie » | « La pharmacie Centrale de Kaloum n'a pas répondu à temps. Vous pouvez envoyer votre ordonnance à une autre pharmacie sur MedConnecte. » |
| Expiration sans réponse | pharmaciens de l'officine | in-app | « Demande expirée » | « Une ordonnance reçue hier est restée sans réponse et a expiré. » |
| Expiration sans décision du patient | patient | in-app | « Proposition expirée » | « Vous n'avez pas répondu à la proposition de la pharmacie à temps. Vous pouvez envoyer à nouveau votre ordonnance. » |
| Réservation non retirée | patient et pharmaciens | in-app | « Réservation expirée » | patient : « Votre réservation à la pharmacie Centrale de Kaloum a expiré. » ; pharmacie : « Une réservation n'a pas été retirée. Vous pouvez remettre les produits en rayon. » |

Le code de retrait dans un SMS est un compromis (lisible par quiconque voit le téléphone) : il ne donne accès qu'à la remise de médicaments payés sur place. À valider (question 9.11).

## 8. Découpage en tâches d'implémentation

Back d'abord, front ensuite. Effort : S (moins d'une demi-journée), M (environ une journée), L (plusieurs jours).

| # | Tâche | Dépôt | Effort | Dépend de |
|---|---|---|---|---|
| B1 | Migration Prisma : enums, `DemandePharmacie`, `LigneDemandePharmacie`, relations inverses, valeur `DEMANDE_PHARMACIE` de `NotificationType` | back | M | validation de cette spec |
| B2 | Permission `ORDONNANCE_PHARMACIE_TRAITER` : catalogue, rôle par défaut « Pharmacien », mise à jour du seed et des rôles existants des pharmacies | back | S | B1 |
| B3 | Module `src/demande-pharmacie/` : création de demande par le patient (copie chiffrée des lignes, lecture de `medicamentId` s'il existe, règle « une demande active par ordonnance »), liste et détail patient, annulation, refus | back | L | B1 ; F2 recommandé mais non bloquant |
| B4 | Côté pharmacie : liste, détail (périmètre revérifié en base, `accesFinAt`), réponse ligne par ligne avec prix suggérés depuis `StockMedicament`, déclin | back | L | B2, B3 |
| B5 | Réservation, code de retrait (hash + valeur chiffrée), remise avec limite de tentatives | back | M | B4 |
| B6 | Échéances : jobs différés dans `src/queue/` (expiration, rappel de retrait), expiration paresseuse à la lecture, rattrapage par lot | back | M | B3 |
| B7 | Notifications in-app et SMS de la section 7 | back | M | B3, B4, B5, B6 |
| B8 | Audit et accès au scan (lecture tracée, lien court via `StorageService`) ; passage des demandes en `ANNULEE` à la suppression d'une ordonnance | back | M | B4 |
| B9 | Choix de pharmacie : endpoint `pharmacies` avec distance, ouverture et couverture indicative | back | S | B3 ; couverture pleine avec F2 |
| B10 | Statistiques pour l'administrateur de l'établissement | back | S | B4 |
| B11 | Tests : transitions (toutes autorisées et refusées), courses réponse contre annulation, périmètre (autre officine, autre patient), minimisation (aucun diagnostic ni `notes` dans le détail pharmacie), expirations | back | M | B3 à B8 |
| F1 | Patient : bouton « Envoyer à une pharmacie » sur l'ordonnance, choix de pharmacie, récapitulatif de partage, envoi | front | M | B3, B9 |
| F2' | Patient : page « Mes demandes en pharmacie », décision ligne par ligne, réservation, code de retrait, annulation, états vides | front | M | B5 |
| F3' | Pharmacien : onglet « Ordonnances reçues », fiche, formulaire de réponse, déclin, remise par code, états vides | front | L | B4, B5 |
| F4' | Notifications : affichage du type `DEMANDE_PHARMACIE` et liens | front | S | B7 |
| F5' | Administrateur de l'établissement : compteurs | front | S | B10 |
| F6' | Preuves non-dev (section 1 de `docs/ORCHESTRATOR.md`) : termes interdits, états vides, erreurs, parcours capturés, relecture novice | front | M | F1 à F5' |

(Les tâches front sont notées F2', F3' etc. pour ne pas les confondre avec les points F2, F3 du backlog.)

Dépendance F2 : B3, B4 et B9 fonctionnent sans F2 (lignes en saisie libre, sans disponibilité indicative ni prix pré-rempli). Une fois F2 livré, la lecture de l'identifiant catalogue dans le JSON `medicaments` active ces deux aides sans autre changement. Le nom exact du champ ajouté par F2 dans le JSON est à reprendre de sa livraison.

## 9. Questions ouvertes pour le porteur

1. **Paiement mobile** (Orange Money, MTN MoMo) : à prévoir pour une étape ultérieure ? Si oui, paiement à la réservation (qui engage la pharmacie) ou au retrait (simple facilité de caisse) ? Le modèle actuel laisse la place à un champ de paiement sans le créer.
2. **Livraison** : envisagée plus tard ? Par qui (pharmacie, coursier, partenaire) ? Elle exigerait une adresse et un suivi, hors de cette étape.
3. **Réglementation guinéenne, à vérifier avant toute mise en service** (aucune affirmation n'est faite ici) :
   - conditions de dispensation sur ordonnance, et valeur d'une ordonnance électronique ou scannée par rapport à l'original papier ;
   - liste des médicaments soumis à prescription et éventuelles catégories à exclure de ce flux (stupéfiants, psychotropes) ; faut-il exploiter `Medicament.ordonnanceRequise` ?
   - obligation et durée de conservation des ordonnances et des traces de dispensation par la pharmacie (conditionne la durée d'accès de 30 jours de la section 6) ;
   - substitution par une alternative (générique, autre marque) : la pharmacie peut-elle la proposer sans accord du prescripteur ?
   - éventuel encadrement ou affichage obligatoire des prix des médicaments ;
   - cadre applicable aux données de santé et à leur hébergement.
4. **Choix de la pharmacie** : liste triée par distance suffit-elle, ou faut-il la carte (Mapbox est déjà utilisé côté front) dès cette étape ? Faut-il exclure les pharmacies fermées, ou les montrer avec un avertissement ?
5. **Ordonnance papier sans médecin MedConnecte** : aujourd'hui, `POST /carnet-sante/ordonnances` exige `ORDONNANCE_WRITE`, que le rôle Patient n'a pas ; un patient ne peut donc pas ajouter lui-même une ordonnance papier scannée. Faut-il l'ouvrir (patient qui photographie l'ordonnance d'un médecin hors plateforme), avec quelles garanties ?
6. **Délais d'expiration** : 24 h pour la réponse de la pharmacie, 48 h pour la décision du patient, 72 h maximum pour le retrait, 30 jours d'accès après clôture : ces valeurs conviennent-elles ? Faut-il tenir compte des horaires d'ouverture (une demande envoyée le samedi soir) ?
7. **Qui peut annuler** : le patient à tout moment avant retrait (proposé). La pharmacie doit-elle pouvoir annuler une réservation (rupture découverte au moment de préparer), et avec quel message au patient ?
8. **Visibilité médecin** : le médecin prescripteur doit-il voir que l'ordonnance a été délivrée (date seule, sans pharmacie ni prix) ? Le patient doit-il pouvoir s'y opposer ?
9. **Scan joint par défaut** : joindre le document scanné par défaut, ou le laisser au choix explicite du patient ?
10. **Email** : utile pour les pharmacies (récapitulatif quotidien) ou les patients, ou le SMS et l'in-app suffisent-ils dans cette étape ?
11. **Code de retrait par SMS** : acceptable, ou le garder uniquement dans l'application ?
12. **Plusieurs pharmacies** : interdire une seconde demande tant qu'une première est en cours (proposé) ; faut-il plus tard permettre l'envoi à plusieurs pharmacies et garder la première qui répond ?
13. **Quantités** : la pharmacie propose-t-elle des boîtes (unité de vente) ou des unités de prise ? La posologie et la durée ne disent pas toujours combien de boîtes délivrer.
14. **Stock** : faut-il, dans une étape suivante, décrémenter `StockMedicament.quantite` à la remise ?
