# PB18b - Synchro desktop (2/4) : moteur de rejeu et événements de caisse

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages renvoyés au poste et anomalies lus par les vendeurs et le titulaire, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Deuxième des quatre sous-fiches de PB18 (D630), après PB18a (validée et commitée). Autonome, gate verte, commitée seule.

PB18b crée `POST /pharmacie/:structureId/synchro/evenements` et tout le moteur du plan 3.3 :

- enveloppe validée en deux temps (D637), empreinte canonique (D638) ;
- idempotence (`DEJA_APPLIQUE`, `EVENEMENT_MODIFIE`, `SEQUENCE_DEJA_UTILISEE`), ordre strict par poste avec `EN_ATTENTE` et application dès que le trou est comblé, saut après 24 h (D641, D642, D643) ;
- une transaction par événement, verrou de journée partagé en première instruction (D639, D625 point 1, D661) ;
- rejet non bloquant d'un événement illisible, attribution (D644), poste désactivé (D645), `A_RENVOYER` sur erreur imprévue (D640) ;
- `Poste.dernierContactLe` et `dernierEtat` (D646), lus par la clôture (D616) ;
- les quatre événements de caisse `SESSION_OUVERTE`, `COMPTAGE_SAISI`, `MOUVEMENT_CAISSE`, `SESSION_FERMEE`, y compris une caisse restée ouverte après une clôture forcée (D625 points 2, 4, 5 ; D647 à D649) ;
- limite de corps JSON 2 Mo et corps compressé gzip (D636).

Le type `VENTE` répond `A_RENVOYER` (rien d'écrit) jusqu'à PB18c.

Réalité du terrain : le poste a pu rester hors ligne une journée, il renvoie ses opérations par lots de 200 sur une connexion qui coupe. Rien ne doit être appliqué deux fois, rien ne doit bloquer le poste, et une opération mise de côté reste toujours consultable par le titulaire.

**Aucune migration, aucun changement de `prisma/schema.prisma`.**

Décisions applicables : D427, D431, D435, D436 (révisée par D644), D517, D527 à D533, D537, D613 à D616, D618, D624, D625, D629, D630, D636 à D650, D660, D661.

### Contexte vérifié (ne pas re-découvrir)

- `EvenementSynchro { id, evenementId (unique), posteId, sequence (unique avec posteId, CHECK >= 1), type, utilisateurId?, horodatageLocal?, recuLe, statut (APPLIQUE | EN_ATTENTE | REJETE), empreinte, corps Json, resultat Json? }`. Trigger `evenement_synchro_proteger` : seule mise à jour permise EN_ATTENTE vers APPLIQUE ou REJETE (`resultat` peut changer à ce moment seulement) ; une ligne APPLIQUE ou REJETE est donc écrite avec son `resultat` définitif dès l'insertion.
- `Poste.derniereSequenceAppliquee` (défaut 0), `dernierContactLe`, `dernierEtat` (aucun trigger sur `Poste`). `cloture-regles.ts` lit `lireFileVide(dernierEtat)`.
- `TypeAnomalie` contient `EVENEMENT_REJETE`, `SEQUENCE_MANQUANTE`, `REMONTEE_APRES_CLOTURE`, `ECART_CAISSE`, `FOND_NON_COMPTE` ; `Anomalie { pointDeVenteId, type, attribueeAId, pieceType, pieceId, details Json }` sans trigger.
- `SessionsCaisseService` (`src/pharmacie/caisse/sessions-caisse.service.ts`) : `fermer` (lignes 415 à 541 : verrou journées, `verrouillerSession`, bilan rejoué si non OUVERTE, `exigerJourOuvert`, puis le cœur : comptage du corps, `COMPTAGE_FERMETURE_REQUIS`, bilan, `COMMENTAIRE_ECART_REQUIS`, mise à jour FERMEE, `ResultatSessionMode`, anomalies `FOND_NON_COMPTE` et `ECART_CAISSE`, relecture) ; privés : `enregistrerComptage(tx, session, moment, dto, auteurId)` (lignes 763 à 888), `calculerBilan(client, session, structure)`, `verrouillerSession(tx, id)` (qui suppose la session existante), `relire` ; types locaux `includeSession`, `SessionChargee`, `EntreeComptage`.
- `journee.ts` : `verrouillerJourneesPartage`, `estJourCloture`, `jourDeRattachement` ; `jour-metier.ts` : `jourConakry`, `jourLisible`, `instantLisible` ; `lecture-stock.ts` : `jourVersDate`.
- DTO de caisse réutilisables (`dto/sessions-caisse.dto.ts`) : `LigneComptageDto`, `ReleveModeDto`, `ComptageOuvertureDto`, `MOMENTS_COMPTAGE`, `TYPES_MOUVEMENT_CAISSE`, `MOTIF_CODE_MODE`.
- `ModePaiement.code` est unique. `class-transformer` (`plainToInstance`) et `class-validator` (`validate`, `isISO8601`) sont déjà des dépendances.
- PB18a : `SynchroController`, `CatalogueSynchroService`, `src/pharmacie/dto/synchro.dto.ts`, `src/config/origines-cors.ts` (`LIMITE_CORPS_JSON`), `test/db/synchro-http.db-spec.ts`.
- Fixture : `str-pharma-1` (administrateur `usr-admin-p1`, vendeur `usr-pharm-p1`), `usr-pharm-p2` appartient à `str-pharma-2`.
- Test 11 de `test/db/journee-cloturee.db-spec.ts` (lignes 678 à 734) : six écrivains lancés pendant que `tenirJournees('exclusif')` tient le verrou, `attendreAttentes(6)` ; variable `D` = poste desktop du test 2 (`desktop-essai-pb17c`), aucune synchro encore sur ce poste.

### 1. `SessionsCaisseService` : extraction et visibilités (D650)

1. Exporter `includeSession`, `type SessionChargee`, `interface EntreeComptage` (mot `export` seulement).
2. `enregistrerComptage`, `calculerBilan`, `verrouillerSession` : `private` retiré. `enregistrerComptage` gagne un dernier paramètre facultatif `horodatageLocal?: Date | null` écrit dans `ComptageCaisse.horodatageLocal` (nul par défaut).
3. Nouvelle méthode publique, corps = les lignes actuelles de `fermer` depuis `if (dto.comptageFermeture)` jusqu'au calcul du bilan relu, paramétrées :

```ts
async fermerSessionVerrouillee(
  tx: Prisma.TransactionClient,
  s: SessionChargee,
  structure: { id: string; nom: string; adminId: string | null },
  options: {
    auteurId: string;
    comptageFermeture?: EntreeComptage;
    commentaire?: string;
    exigerComptage: boolean;      // web vrai : 400 COMPTAGE_FERMETURE_REQUIS
    exigerCommentaire: boolean;   // web vrai : 400 COMMENTAIRE_ECART_REQUIS
    fermeeLeLocal?: Date | null;
    evenementFermetureId: string;
    horodatageLocalComptage?: Date | null;
  },
): Promise<{ bilan: BilanSession; anomalies: { type: 'FOND_NON_COMPTE' | 'ECART_CAISSE'; id: string }[] }>
```

   Sans comptage de fermeture et `exigerComptage` faux : la fermeture continue (le bilan a alors un compté d'espèces nul, `ResultatSessionMode` nul ensemble avec l'écart). `commentaireParId` = `auteurId`. Les anomalies créées sont renvoyées (identifiants compris).
4. `fermer` : garde ses contrôles d'avant (verrou, bilan rejoué, `exigerJourOuvert`) puis appelle `fermerSessionVerrouillee(tx, s, structure, { auteurId: user.id, comptageFermeture: dto.comptageFermeture, commentaire: dto.commentaire, exigerComptage: true, exigerCommentaire: true, evenementFermetureId: `fermeture:${sessionId}` })` et renvoie `{ data: bilan, message: 'Caisse fermée.', success: true }`. Comportement web strictement inchangé : `sessions-caisse.db-spec.ts`, `clotures.db-spec.ts`, `journee-cloturee.db-spec.ts` (tests 1 à 10) et `sessions-caisse.http.spec.ts` restent verts sans modification.

### 2. Limite de corps (D636)

Révisé par le chef à la validation (D663) : `src/config/analyseurs-corps.ts` exporte `monterAnalyseursJson(app)`, appelé dans `src/main.ts` juste après `enableCors` : `app.use('/pharmacie/:structureId/synchro/evenements', json({ limit: LIMITE_CORPS_JSON }))` puis `app.useBodyParser('json', { limit: '100kb', inflate: false })`. 2 Mo et gzip pour la seule route de synchro ; 100 Ko et 415 sur un corps compressé partout ailleurs (`AllExceptionsFilter` traduit le 415). Le corps n'est lu qu'une fois.

### 3. DTO (`src/pharmacie/dto/synchro.dto.ts`, compléter)

```ts
const rognerTexte = ...  // même une ligne que dto/sessions-caisse.dto.ts
export const TYPES_EVENEMENT = ['SESSION_OUVERTE', 'COMPTAGE_SAISI', 'MOUVEMENT_CAISSE', 'SESSION_FERMEE', 'VENTE'] as const;

export class EtatPosteDto { @IsBoolean() fileVide: boolean; @IsBoolean() sessionOuverte: boolean; @IsString() @Length(1, 32) versionApp: string; }
export class EvenementRecuDto {
  @IsUUID('all') evenementId: string;
  @IsInt() @Min(1) @Max(2147483647) sequence: number;
  @Allow() type?: unknown; @Allow() horodatageLocal?: unknown; @Allow() utilisateurId?: unknown; @Allow() corps?: unknown;
}
export class RecevoirEvenementsDto {
  @IsString() @IsNotEmpty() @MaxLength(64) posteId: string;
  @ValidateNested() @Type(() => EtatPosteDto) etat: EtatPosteDto;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EvenementRecuDto) evenements: EvenementRecuDto[];
}
// Corps validés par le service (jamais par le ValidationPipe)
export class CorpsSessionOuverteDto { @IsUUID('all') sessionId: string; }
export class CorpsComptageSaisiDto extends ComptageOuvertureDto {
  @IsUUID('all') comptageId: string; @IsUUID('all') sessionId: string; @IsIn(MOMENTS_COMPTAGE) moment: 'OUVERTURE' | 'FERMETURE';
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ReleveModeDto) releves?: ReleveModeDto[];
}
export class CorpsMouvementCaisseDto {
  @IsUUID('all') mouvementId: string; @IsUUID('all') sessionId: string; @IsIn(TYPES_MOUVEMENT_CAISSE) type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';
  @IsInt() @Min(1) @Max(100_000_000) montant: number;
  @IsString() @Transform(rognerTexte) @Length(3, 300) motif: string;
  @IsOptional() @IsString() @Matches(MOTIF_CODE_MODE) mode?: string;
}
export class ComptageFermetureRejeuDto extends ComptageOuvertureDto {
  @IsUUID('all') comptageId: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ReleveModeDto) releves?: ReleveModeDto[];
}
export class CorpsSessionFermeeDto {
  @IsUUID('all') sessionId: string;
  @IsOptional() @ValidateNested() @Type(() => ComptageFermetureRejeuDto) comptageFermeture?: ComptageFermetureRejeuDto;
  @IsOptional() @IsString() @Transform(rognerTexte) @MaxLength(500) commentaire?: string;
}
```

Swagger sur l'enveloppe (`@ApiProperty`) ; les corps sont décrits dans la description de la route.

### 4. Règles pures : `src/pharmacie/synchro/rejeu-regles.ts` (nouveau)

```ts
export type StatutResultat = 'APPLIQUE' | 'DEJA_APPLIQUE' | 'EN_ATTENTE' | 'REJETE' | 'A_RENVOYER';
export type CodeRejet = 'EVENEMENT_INVALIDE' | 'EVENEMENT_MODIFIE' | 'SEQUENCE_DEJA_UTILISEE' | 'UTILISATEUR_NON_AUTORISE' | 'SESSION_INCONNUE'
  | 'SESSION_FERMEE' | 'COMPTAGE_DEJA_SAISI' | 'IDENTIFIANT_DEJA_UTILISE' | 'STOCK_INTROUVABLE'
  | 'EVENEMENT_INAPPLICABLE';  // ajouté par le chef (D664)
export type CodeARenvoyer = 'SERVICE_INDISPONIBLE' | 'REGULARISATION_INDISPONIBLE';
export const MESSAGES_REJET: Record<CodeRejet | CodeARenvoyer, string>;
export class RejetSynchro extends Error { constructor(readonly code: CodeRejet, readonly options: { stocker?: boolean; champs?: string[] } = {}) }  // stocker vrai par défaut
export class ARenvoyerSynchro extends Error { constructor(readonly code: CodeARenvoyer) }
export function codeRejetDepuisHttp(code: string | undefined): CodeRejet;   // COMPTAGE_DEJA_SAISI, IDENTIFIANT_DEJA_UTILISE, SESSION_FERMEE, STOCK_INTROUVABLE gardés ; tout autre (VALIDATION, MODE_PAIEMENT_INCONNU, absent) : EVENEMENT_INVALIDE
export function jsonCanonique(valeur: unknown): string;                     // clés triées récursivement, sans espace
export function empreinteEvenement(e: { sequence: number; type: unknown; horodatageLocal: unknown; utilisateurId: unknown; corps: unknown }): string; // sha256 hex de jsonCanonique({ sequence, type, horodatageLocal, utilisateurId, corps }), undefined remplacé par null
export function horodatageBorne(local: Date, maintenant: Date): Date;      // local si <= maintenant + 5 min, sinon maintenant
export function messageSynthese(resultats: { statut: StatutResultat }[]): string;
export function resumeEvenement(type: unknown, corps: unknown): Record<string, string | number | null>; // jamais clientNom ni clientTelephone
```

Messages (`MESSAGES_REJET`), à recopier tels quels :
- `EVENEMENT_INVALIDE` : « Cette opération enregistrée sur le poste est illisible. Elle a été mise de côté : le responsable de la pharmacie la retrouvera dans les anomalies. »
- `EVENEMENT_MODIFIE` : « Cette opération avait déjà été reçue avec un contenu différent : la première version est gardée. Le responsable de la pharmacie en est informé. »
- `SEQUENCE_DEJA_UTILISEE` : « Le numéro d'ordre de cette opération est déjà pris par une autre opération de ce poste. Le responsable de la pharmacie en est informé. »
- `UTILISATEUR_NON_AUTORISE` : « Le vendeur de cette opération ne fait pas partie de la pharmacie. L'opération a été mise de côté pour le responsable. »
- `SESSION_INCONNUE` : « La caisse de cette opération est inconnue. L'opération a été mise de côté pour le responsable de la pharmacie. »
- `SESSION_FERMEE` : « Cette caisse était déjà fermée. L'opération a été mise de côté pour le responsable de la pharmacie. »
- `COMPTAGE_DEJA_SAISI` : « Ce comptage était déjà enregistré pour cette caisse. Le second a été mis de côté pour le responsable. »
- `IDENTIFIANT_DEJA_UTILISE` : « Cette opération porte l'identifiant d'un autre enregistrement. Elle a été mise de côté pour le responsable. »
- `STOCK_INTROUVABLE` : « Un médicament de cette vente est inconnu de la pharmacie. La vente a été mise de côté pour le responsable. »
- `SERVICE_INDISPONIBLE` : « Le service est momentanément indisponible : cette opération sera renvoyée automatiquement. »
- `REGULARISATION_INDISPONIBLE` : « Cette vente sera enregistrée plus tard : elle sera renvoyée automatiquement. »

`messageSynthese` : lot vide : « Poste à jour : aucune opération à envoyer. » ; sinon « Synchronisation : » suivi des seules catégories non nulles, dans cet ordre, séparées par des virgules, puis un point : `N enregistrée(s)` (APPLIQUE), `N déjà enregistrée(s)`, `N en attente`, `N mise(s) de côté` (REJETE), `N à renvoyer`. Exemple : « Synchronisation : 3 enregistrée(s), 1 en attente. »

`resumeEvenement` : `{ sessionId }`, `{ comptageId, sessionId, moment }`, `{ mouvementId, sessionId, typeMouvement, montant }`, `{ venteId, sessionId, numeroTicket, numeroSecours, total, nombreLignes }` selon le type quand ces champs sont lisibles (sinon nuls), `{}` pour un type inconnu.

### 5. Validation d'un corps : `src/pharmacie/synchro/valider-corps.ts` (nouveau)

`export async function validerCorps<T extends object>(classe: new () => T, corps: unknown): Promise<{ ok: true; valeur: T } | { ok: false; champs: string[] }>` : corps qui n'est pas un objet simple : `{ ok: false, champs: ['corps'] }` ; sinon `plainToInstance` puis `validate(instance, { whitelist: true, forbidNonWhitelisted: true })` ; `champs` = chemins des propriétés en erreur (`coupures.0.valeurFaciale`), jamais les valeurs.

### 6. `SynchroService` (`src/pharmacie/synchro/synchro.service.ts`, nouveau)

`constructor(prisma: PrismaService, accesPharmacie: AccesPharmacieService, mouvementsStock: MouvementsStockService, sessionsCaisse: SessionsCaisseService)` (constructeur définitif pour PB18c et PB18d ; `mouvementsStock` sert à PB18c). Options de transaction : `{ maxWait: 5_000, timeout: 15_000 }`.

Résultat d'un événement (type exporté) :

```ts
interface ResultatEvenement {
  evenementId: string; sequence: number; statut: StatutResultat;
  code?: string; message?: string; champs?: string[];
  differe?: true; horsOrdre?: true;
  anomalies?: { type: string; id: string }[];
  piece?: { type: 'SESSION' | 'COMPTAGE' | 'MOUVEMENT_CAISSE' | 'VENTE' | 'REGULARISATION'; id: string; numero?: string };
}
```

La colonne `resultat` stocke `{ statut: 'APPLIQUE' | 'REJETE', code?, message?, champs?, horsOrdre?, anomalies?, piece? }` ; un rejeu la renvoie avec `DEJA_APPLIQUE` (stocké APPLIQUE) ou `REJETE` (stocké REJETE).

#### 6.1 `recevoir(structureId, userId, dto, ip?)`

1. `const { structure } = await this.accesPharmacie.verifier(structureId, userId);`
2. Poste `findFirst({ where: { id: dto.posteId, pointDeVente: { structureId } }, include: { pointDeVente: { select: { ordre: true } } } })` ; absent ou type différent de `DESKTOP` : 409 `POSTE_INCONNU` (`MESSAGE_POSTE_INCONNU`) ; un poste inactif est accepté (D645).
3. Contexte : `structure`, `poste { id, code, libelle, pointDeVenteId, ordre }`, `ip`, et un chargeur d'utilisateurs mis en cache (`user.findUnique({ select: { id, nom, prenom, structureId } })`), préchargé avec les `utilisateurId` chaînes du lot.
4. Événements triés par `sequence` puis position reçue. Pour chacun : si un `A_RENVOYER` a déjà eu lieu dans l'appel, résultat `A_RENVOYER` (`SERVICE_INDISPONIBLE`) sans traitement ; sinon `traiterUn(ctx, e, empreinteEvenement(e), false)` ; puis, si le résultat a fait avancer la séquence (APPLIQUE ou REJETE stocké non hors ordre), `drainer(ctx)` et ajout des résultats différés.
5. Après la boucle, si aucun `A_RENVOYER` : `sauterTrouAncien(ctx)` ; s'il a sauté, `drainer(ctx)`.
6. `enAttente` = nombre d'`EvenementSynchro` EN_ATTENTE du poste ; `sequenceAppliquee` relue.
7. `prisma.poste.update({ where: { id }, data: { dernierContactLe: new Date(), dernierEtat: { fileVide: dto.etat.fileVide && enAttente === 0 && !aRenvoyer, fileVideDeclaree: dto.etat.fileVide, sessionOuverte: dto.etat.sessionOuverte, versionApp: dto.etat.versionApp, enAttente } } })` (D646).
8. Réponse `{ data: { resultats, sequenceAppliquee, enAttente }, message: messageSynthese(resultats), success: true }`.

#### 6.2 `traiterUn(ctx, e, empreinte, differe)`

```
try { return await prisma.$transaction(tx => this.traiterDansTransaction(tx, ctx, e, empreinte, differe), OPTIONS) }
catch (erreur) {
  RejetSynchro            -> return this.enregistrerRejet(ctx, e, empreinte, erreur, differe)
  ARenvoyerSynchro        -> return { evenementId, sequence, statut: 'A_RENVOYER', code, message }
  HttpException           -> rejet = new RejetSynchro(codeRejetDepuisHttp(reponse.code)) puis enregistrerRejet
  autre                   -> logger.warn(`synchro.evenement_echec posteId=.. sequence=.. evenementId=..`) (jamais le corps) ; A_RENVOYER SERVICE_INDISPONIBLE
}
```

Ajout du chef à la validation (D664) : une erreur « autre » (ou un échec de `enregistrerRejet`) passe par `echecImprevu` : une panne passagère de la base (`echecPassager`) reste un simple A_RENVOYER ; sinon le compteur `Poste.dernierEtat.echecImprevu { evenementId, nombre }` augmente, et au 3e échec du même événement il est stocké REJETE code `EVENEMENT_INAPPLICABLE` (anomalie `EVENEMENT_REJETE`, séquence avancée). En tête de `appliquer`, un caractère NUL dans `type`, `horodatageLocal`, `utilisateurId` ou le corps donne `EVENEMENT_INVALIDE` ; un tel corps est stocké `{ corpsIllisible: "<JSON échappé>" }` (`corpsStockable`). Clés inconnues d'un corps rendues `champInconnu`, 20 chemins au plus (D665).

#### 6.3 `traiterDansTransaction(tx, ctx, e, empreinte, differe)`

0. `await verrouillerJourneesPartage(tx, ctx.structure.id);` (première instruction, D613, D661)
1. `SELECT "derniereSequenceAppliquee" FROM "Poste" WHERE "id" = ${posteId} FOR UPDATE` : `derniere`.
2. `connu = tx.evenementSynchro.findUnique({ where: { evenementId } })` :
   - poste ou empreinte différents : `throw new RejetSynchro('EVENEMENT_MODIFIE', { stocker: false })` ;
   - APPLIQUE : renvoyer le résultat stocké avec `DEJA_APPLIQUE` ; REJETE : le résultat stocké (`REJETE`) ;
   - EN_ATTENTE : si `connu.sequence !== derniere + 1`, renvoyer `EN_ATTENTE` ; sinon continuer à l'étape 4 avec `stocke = connu`.
3. Sinon : un autre événement à `(posteId, sequence)` : `throw new RejetSynchro('SEQUENCE_DEJA_UTILISEE', { stocker: false })` ; si `sequence > derniere + 1` : insérer la ligne EN_ATTENTE (`type` = chaîne de 40 caractères au plus sinon `''`, `utilisateurId` = chaîne de 64 au plus sinon nul, `horodatageLocal` = date ISO 8601 valide sinon nul, `corps` = corps reçu ou `{}`, `empreinte`) et renvoyer `EN_ATTENTE`.
4. `horsOrdre = !stocke && sequence <= derniere` ; `resultat = await this.appliquer(tx, ctx, e)` (lève `RejetSynchro`, `ARenvoyerSynchro` ou une `HttpException`) ; écrire la ligne APPLIQUE (mise à jour de `stocke`, sinon création avec les mêmes champs qu'à l'étape 3) avec `resultat` (et `horsOrdre` s'il est vrai) ; si `!horsOrdre`, `UPDATE "Poste" SET "derniereSequenceAppliquee" = sequence`.
5. Renvoyer `{ ...resultat, statut: 'APPLIQUE', differe?, horsOrdre? }`.

#### 6.4 `enregistrerRejet(ctx, e, empreinte, rejet, differe)` (seconde transaction, mêmes verrous 0 et 1)

- Relire `connu` par `evenementId` : s'il existe et n'est plus EN_ATTENTE (traité par un envoi concurrent), renvoyer son résultat comme en 6.3 étape 2.
- `stocker` faux (EVENEMENT_MODIFIE, SEQUENCE_DEJA_UTILISEE) : anomalie `EVENEMENT_REJETE` (pièce `Poste`, `pieceId` = poste) créée seulement si aucune n'existe déjà pour ce poste avec `details.evenementId` égal (`details: { path: ['evenementId'], equals }`) ; rien d'autre n'est écrit ; résultat `REJETE` avec `code`, `message`, `anomalies`.
- Stockable : si une autre ligne occupe `(posteId, sequence)`, traiter comme `SEQUENCE_DEJA_UTILISEE` non stocké ; sinon `id` de ligne = `connu.id` ou `randomUUID()` ; anomalie `EVENEMENT_REJETE` (pièce `EvenementSynchro`, `pieceId` = cet id) ; puis ligne REJETE (mise à jour d'EN_ATTENTE ou création) avec `resultat { statut: 'REJETE', code, message, champs?, anomalies }` ; si `sequence === derniere + 1`, avancer `derniereSequenceAppliquee`.
- `details` de `EVENEMENT_REJETE` (liste blanche, jamais le corps ni une donnée du client) : `{ evenementId, sequence, type (chaîne lisible ou null), code, message, champs?, posteCode, utilisateurId (chaîne lisible ou null), horodatageLocal (ISO ou null), resume: resumeEvenement(type, corps) }` ; attribuée au titulaire (`structure.adminId`).

#### 6.5 `appliquer(tx, ctx, e)`

1. `type` dans `TYPES_EVENEMENT`, sinon `RejetSynchro('EVENEMENT_INVALIDE', { champs: ['type'] })` ; `horodatageLocal` chaîne `isISO8601(.., { strict: true })`, sinon champ `horodatageLocal` ; `utilisateurId` chaîne non vide de 64 au plus, sinon champ `utilisateurId`.
2. Utilisateur chargé : absent, ou ni `structureId === structure.id` ni `structure.adminId === id` : `RejetSynchro('UTILISATEUR_NON_AUTORISE')` (D644).
3. `local = new Date(horodatageLocal)`, `borne = horodatageBorne(local, new Date())`.
4. `VENTE` : `throw new ARenvoyerSynchro('SERVICE_INDISPONIBLE')` (PB18c remplace cette ligne). Autres types : `validerCorps` de la classe du type, échec : `RejetSynchro('EVENEMENT_INVALIDE', { champs })` ; puis le gestionnaire.

Aide `sessionDuPoste(tx, ctx, sessionId)` : `findUnique({ select: { id, posteId } })` ; absente ou d'un autre poste : `RejetSynchro('SESSION_INCONNUE')` ; sinon `this.sessionsCaisse.verrouillerSession(tx, id)`.

#### 6.6 Gestionnaires de caisse

`SESSION_OUVERTE` (D647) :
1. Session `corps.sessionId` existante : du même poste, résultat `{ piece: { type: 'SESSION', id } }` sans écriture ; d'un autre poste : `RejetSynchro('IDENTIFIANT_DEJA_UTILISE')`.
2. Autre session OUVERTE sur le poste : `verrouillerSession` puis `fermerParRejeu(..., { evenementFermetureId: `fermeture-implicite:${evenementId}`, auteurId: utilisateurId })` et anomalie `SEQUENCE_MANQUANTE` au titulaire, pièce `SessionCaisse`, `details { raison: 'FERMETURE_MANQUANTE', sessionId, posteCode, utilisateurNom, jourMetier, message }`, message « La fermeture de la caisse de <utilisateurNom> sur <libellé du poste> n'est jamais arrivée : elle a été fermée automatiquement, sans comptage, à l'ouverture de la caisse suivante. Vérifiez l'argent de ce tiroir. »
3. `jourLocal = jourConakry(borne)` ; si `estJourCloture(tx, pv, jourLocal)` : `jour = (await jourDeRattachement(tx, pv, new Date())).jour`, `jourMetierOrigine = jourLocal` ; sinon `jour = jourLocal`, origine nulle.
4. `tx.sessionCaisse.create({ data: { id: corps.sessionId, pointDeVenteId, posteId, utilisateurId, utilisateurNom: `${prenom} ${nom}`.trim(), jourMetier: jourVersDate(jour), jourMetierOrigine, ouverteLe: new Date(), ouverteLeLocal: local, evenementOuvertureId: evenementId } })`.
5. Résultat `{ piece: { type: 'SESSION', id }, anomalies }`.

`COMPTAGE_SAISI` (D648) : `sessionDuPoste` ; non OUVERTE : `RejetSynchro('SESSION_FERMEE')` ; `const { comptage } = await this.sessionsCaisse.enregistrerComptage(tx, s, corps.moment, { id: corps.comptageId, coupures: corps.coupures, releves: corps.releves }, utilisateurId, local)` (rejeu du même id sans écriture ; ses refus HTTP deviennent les rejets de 6.2) ; résultat `{ piece: { type: 'COMPTAGE', id: comptage.id } }`. Le jour clôturé de la caisse ne l'empêche pas (D625 point 5).

`MOUVEMENT_CAISSE` (D648) : `sessionDuPoste` ; non OUVERTE : `SESSION_FERMEE` ; mouvement `corps.mouvementId` existant : même session, résultat sans écriture ; autre session : `IDENTIFIANT_DEJA_UTILISE` ; mode = `tx.modePaiement.findUnique({ where: { code: corps.mode ?? 'ESPECES' } })` actif ou non, absent : `RejetSynchro('EVENEMENT_INVALIDE', { champs: ['mode'] })` ; `create { id: mouvementId, sessionCaisseId, pointDeVenteId, type, modePaiementId, montant, motif, auteurId: utilisateurId, horodatageLocal: local, evenementId: mouvementId }` ; résultat `{ piece: { type: 'MOUVEMENT_CAISSE', id } }`.

`SESSION_FERMEE` (D649) : `sessionDuPoste` ; non OUVERTE : résultat `{ piece: { type: 'SESSION', id }, code: 'SESSION_DEJA_FERMEE' }` sans écriture ; sinon `fermerParRejeu(tx, ctx, s, { comptageFermeture: corps.comptageFermeture ? { id: comptageId, coupures, releves } : undefined, commentaire, horodatageLocal: local, evenementFermetureId: evenementId, auteurId: utilisateurId })` ; résultat `{ piece, anomalies }`.

`fermerParRejeu(tx, ctx, s, o)` :
1. `{ bilan, anomalies } = await this.sessionsCaisse.fermerSessionVerrouillee(tx, s, ctx.structure, { auteurId, comptageFermeture, commentaire, exigerComptage: false, exigerCommentaire: false, fermeeLeLocal: horodatageLocal, evenementFermetureId, horodatageLocalComptage: horodatageLocal })`.
2. Compté d'espèces nul dans le bilan (aucun comptage de fermeture) : anomalie `ECART_CAISSE` au titulaire, pièce `SessionCaisse`, `details { posteCode, utilisateurId, utilisateurNom, jourMetier, raison: 'COMPTAGE_FERMETURE_ABSENT', theorique (espèces), compte: null, ecart: null, message }`, message « La caisse de <utilisateurNom> a été fermée sur le poste sans comptage des billets : l'argent du tiroir n'a pas été vérifié. »
3. `cloture = tx.clotureJournaliere.findUnique({ pointDeVenteId_jourMetier })` pour le jour de la caisse ; si elle existe : anomalie `REMONTEE_APRES_CLOTURE` au titulaire, pièce `SessionCaisse`, `details { raison: 'CAISSE_FERMEE_APRES_CLOTURE', clotureId, jourCloture, posteManquantDeLaCloture (vrai si `postesManquants` contient `sessionId`), posteCode, sessionId, utilisateurId, utilisateurNom, nombrePieces (ventes + annulations de l'activité), montantEncaisse, theoriqueEspeces, compteEspeces, ecartEspeces, message }`, message « La caisse de <utilisateurNom> (journée du JJ/MM/AAAA, déjà clôturée) a été fermée après la clôture : son argent (<montant> GNF encaissés) n'est compté dans aucune clôture. Vérifiez-le et rapprochez-le. » (montant au format de `formaterGnf`). La caisse reste FERMEE, jamais INCLUSE (D618).
4. Toutes les anomalies créées sont ajoutées au résultat.

#### 6.7 `drainer(ctx)` et `sauterTrouAncien(ctx)`

- `drainer` : boucle : lire (hors transaction) le poste et la ligne EN_ATTENTE à `derniere + 1` ; aucune : fin ; sinon reconstruire `e` (`evenementId`, `sequence`, `type`, `horodatageLocal` en ISO ou `null`, `utilisateurId`, `corps`) et `traiterUn(ctx, e, ligne.empreinte, true)` ; arrêt sur `EN_ATTENTE` (course) ou `A_RENVOYER`.
- `sauterTrouAncien` : transaction (verrous 0 et 1) ; s'il existe une ligne à `derniere + 1`, rien ; sinon `premier` = EN_ATTENTE de plus petite séquence, `ancien` = EN_ATTENTE de plus petit `recuLe` ; si `ancien.recuLe` < maintenant moins 24 h : anomalie `SEQUENCE_MANQUANTE` au titulaire, pièce `Poste`, `details { raison: 'SEQUENCE_MANQUANTE', posteCode, premiere: derniere + 1, derniere: premier.sequence - 1, nombre, message }`, message « Le poste <libellé> n'a jamais envoyé N opération(s) de caisse (numéros a à b) depuis plus de 24 heures : les opérations suivantes ont été enregistrées sans elles. Vérifiez la caisse de ce poste. », puis `derniereSequenceAppliquee = premier.sequence - 1` ; renvoie vrai s'il a sauté.

### 7. Route

`SynchroController` gagne `SynchroService` au constructeur et :

```ts
@Post(':structureId/synchro/evenements')
@RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
@HttpCode(HttpStatus.OK)
recevoir(@Req() req: RequestWithUser, @Param('structureId') structureId: string, @Body() dto: RecevoirEvenementsDto, @Ip() ip: string)
```

Swagger : « Recevoir les opérations de caisse d'un poste desktop » ; description : 200 événements au plus, triés par séquence, idempotent par `evenementId`, statuts, types et corps, corps gzip accepté, 409 `POSTE_INCONNU`. `PharmacieModule` : ajouter `SynchroService`.

### 8. CA22 et test 11

- `routes-pharmacie.ts` : `'POST /pharmacie/:structureId/synchro/evenements'` (`J`, faux, faux). `APPELS` : enregistrer le poste desktop du profil (comme PB18a), puis `POST .../synchro/evenements` `{ posteId, etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' }, evenements: [] }` ; renvoyer les deux réponses.
- `journee-cloturee.db-spec.ts` : construire `synchro = new SynchroService(prisma, acces, mouvements, sessions)` dans `beforeAll` ; au test 11, ajouter au `Promise.allSettled` un septième appel `synchro.recevoir(PHARMACIE, RESPONSABLE, { posteId: D, etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' }, evenements: [{ evenementId: randomUUID(), sequence: 1, type: 'MOUVEMENT_CAISSE', horodatageLocal: new Date().toISOString(), utilisateurId: RESPONSABLE, corps: { mouvementId: randomUUID(), sessionId: randomUUID(), type: 'APPORT', montant: 1000, motif: 'Monnaie' } }] }, ip)`, `attendreAttentes(7)`, commentaire mis à jour (« sept »), et l'assertion : appel résolu, `data.resultats[0]` statut `REJETE`, code `SESSION_INCONNUE`. Aucune autre ligne du fichier ne change (D629, D661).

### 9. Tests

`src/pharmacie/synchro/rejeu-regles.spec.ts` (nouveau) :
1. `jsonCanonique` : ordre des clés indifférent, tableaux gardés dans l'ordre, imbrication.
2. `empreinteEvenement` : 64 caractères hexadécimaux ; identique si les clés du corps sont permutées ; différente si la séquence, le type, l'horodatage, l'utilisateur ou une valeur du corps change.
3. `horodatageBorne` : passé gardé ; +4 min gardé ; +6 min ramené à maintenant.
4. `codeRejetDepuisHttp` : les quatre codes gardés, `VALIDATION`, `MODE_PAIEMENT_INCONNU` et `undefined` donnent `EVENEMENT_INVALIDE`.
5. `messageSynthese` : lot vide ; exemple de la fiche ; une seule catégorie.
6. `resumeEvenement` : vente avec `clientNom` et `clientTelephone` : aucune de ces clés dans le résumé ; type inconnu : `{}`.

`src/pharmacie/synchro/valider-corps.spec.ts` (nouveau) : corps non objet ; corps valide de chaque classe de caisse ; champ inconnu refusé (`forbidNonWhitelisted`) ; chemin `coupures.0.valeurFaciale` rendu, jamais de valeur.

`test/db/synchro-caisse.db-spec.ts` (nouveau, préparation calquée sur `journee-cloturee.db-spec.ts` : `AccesPharmacieService`, `MouvementsStockService`, `SessionsCaisseService`, `PointsDeVenteService`, `CatalogueSynchroService`, `ClotureService`, `SynchroService` ; poste desktop `D` (`desktop-pb18b`) ; `debutCaisse` reculé de 30 jours ; aides `ev(sequence, type, corps, { utilisateurId = VENDEUR, horodatageLocal = maintenant, evenementId = randomUUID() })` et `envoyer(evenements, { etat, expediteur = VENDEUR, posteId = D })`, `coupures` recopiée de `sessions-caisse.db-spec.ts`) ; les numéros de séquence cités ci-dessous valent pour ce passage, mais à partir du test 13 le fichier les calcule depuis `derniereSequenceAppliquee` relu en base (PB18c et PB18d réécrivent le test 14, qui pourra faire avancer la séquence) ; les tests s'exécutent dans l'ordre :
1. « battement de cœur » : lot vide : `resultats` vide, `sequenceAppliquee` 0, message « Poste à jour : aucune opération à envoyer. » ; `dernierContactLe` d'aujourd'hui, `dernierEtat` `{ fileVide: true, fileVideDeclaree: true, sessionOuverte: false, versionApp: '0.1.0', enAttente: 0 }`.
2. « une caisse complète rejouée » : 1 `SESSION_OUVERTE` S1, 2 `COMPTAGE_SAISI` OUVERTURE (20 000 x 5), 3 `MOUVEMENT_CAISSE` APPORT 10 000, 4 `COMPTAGE_SAISI` FERMETURE (20 000 x 5, 10 000 x 1), 5 `SESSION_FERMEE` : cinq `APPLIQUE` ; S1 FERMEE, `utilisateurId` VENDEUR, `ouverteLeLocal` = horodatage envoyé, `jourMetier` aujourd'hui, `evenementOuvertureId` = identifiant de l'événement 1, `evenementFermetureId` = identifiant de l'événement 5 ; comptages avec `horodatageLocal` ; mouvement `auteurId` VENDEUR ; `ResultatSessionMode` espèces écart 0 ; cinq lignes `EvenementSynchro` APPLIQUE, `empreinte` de 64 caractères ; `derniereSequenceAppliquee` 5 ; aucune anomalie.
3. « doublon : rien n'est réappliqué » : les cinq renvoyés : cinq `DEJA_APPLIQUE` avec les mêmes `piece` ; nombres de sessions, comptages, mouvements, résultats, lignes de synchro et anomalies inchangés.
4. « opération modifiée » : identifiant de l'événement 3 avec `montant` 20 000 : `REJETE` `EVENEMENT_MODIFIE` ; mouvement inchangé ; une anomalie `EVENEMENT_REJETE` pièce `Poste` ; renvoyée une seconde fois : toujours une seule anomalie.
5. « numéro d'ordre déjà pris » : nouvel identifiant à la séquence 2 : `REJETE` `SEQUENCE_DEJA_UTILISEE`, anomalie dont `details.resume` contient `sessionId` et aucune clé `corps`.
6. « ordre inversé » : séquences 8 puis 7 (S2 : 7 `COMPTAGE_SAISI` OUVERTURE, 8 `MOUVEMENT_CAISSE`) : deux `EN_ATTENTE`, lignes EN_ATTENTE, `derniereSequenceAppliquee` 5, `dernierEtat.fileVide` faux (déclaré vrai), `enAttente` 2 ; `clotures.preparer(jour(0))` cite D avec la raison `FILE_NON_VIDE` ; puis séquence 6 (`SESSION_OUVERTE` S2) : résultats 6 `APPLIQUE`, 7 et 8 `APPLIQUE` avec `differe` ; lignes passées à APPLIQUE ; `fileVide` vrai ; D n'est plus attendu par `preparer`.
7. « opération illisible, poste jamais bloqué » : 9 `COMPTAGE_SAISI` avec une coupure de 300 : `REJETE` `EVENEMENT_INVALIDE`, ligne REJETE avec son corps, anomalie `EVENEMENT_REJETE` pièce `EvenementSynchro` sans clé `corps` dans `details` ; 10 type `ANNULATION` et 11 `horodatageLocal: 'hier'` : `EVENEMENT_INVALIDE` (`champs` `type`, `horodatageLocal`) ; 12 `MOUVEMENT_CAISSE` valide sur S2 : `APPLIQUE` ; `derniereSequenceAppliquee` 12.
8. « attribution » : 13 avec `utilisateurId` `usr-pharm-p2` : `UTILISATEUR_NON_AUTORISE` ; 14 `MOUVEMENT_CAISSE` du VENDEUR envoyé par RESPONSABLE : `APPLIQUE`, `auteurId` VENDEUR.
9. « caisse inconnue » : `COMPTAGE_SAISI` sur un UUID inconnu, puis sur la caisse web du RESPONSABLE (ouverte par `sessions.ouvrir` sur un poste web) : `SESSION_INCONNUE` deux fois.
10. « caisse déjà fermée » : `MOUVEMENT_CAISSE` sur S1 : `SESSION_FERMEE` ; `SESSION_FERMEE` sur S1 : `APPLIQUE` code `SESSION_DEJA_FERMEE`, aucune écriture.
11. « fermeture sans comptage, écart sans commentaire » : `SESSION_FERMEE` de S2 sans comptage : S2 FERMEE, `ResultatSessionMode` espèces `compte` et `ecart` nuls, anomalie `ECART_CAISSE` raison `COMPTAGE_FERMETURE_ABSENT` ; caisse S3 ouverte avec fond compté 100 000 puis fermée avec un comptage de 50 000 sans commentaire : FERMEE, anomalie `ECART_CAISSE` (comme le web), aucun refus.
12. « fermeture manquante » : S4 ouverte, puis `SESSION_OUVERTE` S5 sans fermer S4 : S4 FERMEE sans comptage, anomalie `SEQUENCE_MANQUANTE` raison `FERMETURE_MANQUANTE`, S5 OUVERTE ; puis S5 fermée par événement.
13. « trou de plus de 24 heures » : ligne EN_ATTENTE insérée par SQL à `derniere + 2` avec `recuLe` = maintenant moins 25 h (`MOUVEMENT_CAISSE` valide sur une caisse S6 ouverte juste avant par événement) ; battement de cœur : anomalie `SEQUENCE_MANQUANTE` (`premiere` = `derniere` = séquence manquante, `nombre` 1), ligne passée APPLIQUE, résultat `differe` ; puis l'événement manquant (un `MOUVEMENT_CAISSE` valide) : `APPLIQUE` avec `horsOrdre`, `derniereSequenceAppliquee` inchangé.
14. « vente pas encore prise en charge » : lot `[VENTE n, MOUVEMENT_CAISSE n+1]` : deux `A_RENVOYER` (`SERVICE_INDISPONIBLE`), aucune ligne `EvenementSynchro` créée, séquence inchangée, `dernierEtat.fileVide` faux.
15. « caisse restée ouverte après une clôture forcée » (D625) : S7 ouverte par événement avec `horodatageLocal` = hier 18:00 : `jourMetier` hier ; `clotures.cloturer(hier)` : 409 `CLOTURE_INCOMPLETE` ; avec `forcer` et motif : `forcee`, `postesManquants[0].sessionId` = S7 ; instantané de la veille (clôture, `TotalClotureMode`, sessions incluses, nombre de pièces du jour) ; puis `COMPTAGE_SAISI` OUVERTURE, `MOUVEMENT_CAISSE`, `SESSION_FERMEE` avec comptage sur S7 : trois `APPLIQUE` ; S7 FERMEE, `clotureJournaliereId` nul ; anomalie `REMONTEE_APRES_CLOTURE` attribuée à `usr-admin-p1`, `details.raison` `CAISSE_FERMEE_APRES_CLOTURE`, `clotureId`, `posteManquantDeLaCloture` vrai ; instantané de la veille identique ; puis `SESSION_OUVERTE` S8 avec `horodatageLocal` = hier 22:00 : `jourMetier` aujourd'hui, `jourMetierOrigine` hier ; S8 fermée par événement.
16. « envois simultanés et clôture en cours » : le même lot de deux événements envoyé deux fois en `Promise.all` : pour chaque événement un `APPLIQUE` et un `DEJA_APPLIQUE`, aucune ligne en double ; puis une clôture tenue en exclusif (`tenirJournees` recopiée de `journee-cloturee.db-spec.ts`) : un envoi attend (`attendreAttentes(1)`) puis aboutit après libération.
17. « séquences dans la photographie » : `catalogue.photographier(D)` : `sequenceAppliquee` = `derniereSequenceAppliquee`, et après une ligne EN_ATTENTE ajoutée par un envoi à `derniere + 3`, `sequenceMaxRecue` = cette séquence.
18. (chef, D664) « caractère NUL » sur un poste dédié `D2` : NUL en attente puis rejeté en différé, NUL dans l'ordre, NUL dans le vendeur : `EVENEMENT_INVALIDE` (`champs` `corps` ou `utilisateurId`), corps relu sans perte depuis `corpsIllisible`, séquence avancée, rejeu sans nouvelle écriture.
19. (chef, D664) « erreur imprévue répétée » : `enregistrerComptage` espionné qui lève une `TypeError` : deux A_RENVOYER (compteur 1 puis 2 dans `dernierEtat`), une panne P2024 non comptée, puis au troisième échec `REJETE` `EVENEMENT_INAPPLICABLE`, l'événement suivant `APPLIQUE`, compteur effacé.

`test/db/synchro-http.db-spec.ts` (compléter) : l'application est créée par `createNestApplication<NestExpressApplication>()` avec `monterAnalyseursJson(app)` avant `init` (chef, D663) ; tests ajoutés (11 par le chef : plus de 100 Ko refusé en 413 et gzip en 415 sur la route des plages, petit corps accepté, plus de 100 Ko accepté sur la synchro ; 10 complété : `versionApp` avec NUL, 400) :
8. « corps compressé gzip » : `POST .../synchro/evenements`, en-têtes `Content-Type: application/json` et `Content-Encoding: gzip`, corps `gzipSync` d'un battement de cœur : 200.
9. « lot de 1,5 Mo accepté, 2,5 Mo refusé » : poste desktop dédié ; 200 événements de séquences 1001 à 1200 (donc `EN_ATTENTE`), corps contenant un texte de 7 500 caractères : 200 et 200 `EN_ATTENTE` ; avec 12 500 caractères : 413.
10. « enveloppe refusée » : `evenementId` non UUID, 201 événements, `etat` absent : 400 `VALIDATION` ; poste web : 409 `POSTE_INCONNU`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin. Aucun journal ne contient un corps d'événement, un nom de client ni un téléphone.

Fichiers autorisés (et seulement eux) : `src/main.ts`, `src/config/analyseurs-corps.ts` et `src/common/filters/all-exceptions.filter.ts` avec son `.spec.ts` (ajoutés par le chef, D663), `src/pharmacie/caisse/sessions-caisse.service.ts`, `src/pharmacie/dto/synchro.dto.ts`, `src/pharmacie/synchro/rejeu-regles.ts`, `src/pharmacie/synchro/rejeu-regles.spec.ts`, `src/pharmacie/synchro/valider-corps.ts`, `src/pharmacie/synchro/valider-corps.spec.ts`, `src/pharmacie/synchro/synchro.service.ts`, `src/pharmacie/synchro/synchro.controller.ts`, `src/pharmacie/pharmacie.module.ts`, `test/etancheite-couts/routes-pharmacie.ts`, `test/db/etancheite-couts.db-spec.ts`, `test/db/journee-cloturee.db-spec.ts`, `test/db/synchro-caisse.db-spec.ts`, `test/db/synchro-http.db-spec.ts`, `CLAUDE.md`.

## CLAUDE.md du back (compléter la puce PB18)

Ajouter : « `POST /pharmacie/:structureId/synchro/evenements` (`caisse:utiliser`, 200, corps JSON jusqu'à 2 Mo, gzip accepté) : `{ posteId, etat: { fileVide, sessionOuverte, versionApp }, evenements: [{ evenementId, sequence, type, horodatageLocal, utilisateurId, corps }] }` (0 à 200 ; lot vide = battement de cœur). Une transaction par événement, verrou de journée partagé en tête puis poste ; idempotent par `evenementId` et empreinte ; ordre strict par poste (`EN_ATTENTE` puis application dès que le trou est comblé, saut après 24 h avec `SEQUENCE_MANQUANTE`) ; statuts `APPLIQUE`, `DEJA_APPLIQUE`, `EN_ATTENTE`, `REJETE` (stocké avec son corps, séquence avancée, anomalie `EVENEMENT_REJETE` sans donnée du client), `A_RENVOYER` (rien d'écrit, renvoyer plus tard) ; réponse `{ resultats, sequenceAppliquee, enAttente }`, avec les événements en attente traités pendant l'appel (`differe`). Le vendeur d'un événement doit être de la pharmacie (`UTILISATEUR_NON_AUTORISE`). Écrit `Poste.dernierContactLe` et `dernierEtat` (`fileVide` = déclaré et rien en attente). Événements de caisse : `SESSION_OUVERTE` (jour local, ou jour de rattachement si clôturé), `COMPTAGE_SAISI`, `MOUVEMENT_CAISSE` (appliqués sur une caisse ouverte même d'un jour clôturé), `SESSION_FERMEE` (jamais refusée ; caisse d'un jour clôturé : FERMEE, jamais incluse, anomalie `REMONTEE_APRES_CLOTURE` au titulaire). Le cœur de fermeture est `SessionsCaisseService.fermerSessionVerrouillee` (D650). Le rejeu figure au test 11 de `journee-cloturee.db-spec.ts`. »

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint` sur les fichiers `.ts` autorisés : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, aucun test existant modifié.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `synchro-caisse` (19 après le chef), `synchro-http` (11 après le chef), `journee-cloturee` (11, test 11 à sept attentes), `etancheite-couts` ; `sessions-caisse`, `clotures`, `vente`, `annulation` verts et inchangés.
5. `git status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes test/db/sessions-caisse.db-spec.ts test/db/clotures.db-spec.ts` vide.
6. `grep -n "verrouillerJourneesPartage" src/pharmacie/synchro/synchro.service.ts` : présent en première instruction de chaque transaction du service (traitement, rejet, saut).
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | dur (codeur Sonnet, vérificateur Sonnet) | PASS, validé par le chef (rapports/PB18b-verification.md, rapports/PB18b-chef.md) | code conforme ; 2 Mo et gzip restreints à la route de synchro (D663) ; événement empoisonné borné : NUL rejeté, 3e échec imprévu mis de côté (D664) ; clés inconnues non recopiées (D665)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | 0 erreur | voir commit
docker compose exec -T backend npx eslint (18 fichiers .ts touchés) | 0 erreur, 1 avertissement préexistant (main.ts, `bootstrap()` non attendu) | voir commit
docker compose exec -T backend npm test | 99 suites, 1079 réussis, 3 ignorés, 0 échec | voir commit
docker compose exec -T backend npm run test:db | 32 suites, 377 réussis, 0 échec | voir commit
docker compose restart backend | démarrage propre ; `/auth/login` 150 Ko : 413, gzip : 415 ; synchro 150 Ko et gzip : lus (401 de la garde), 2,5 Mo : 413 | voir commit
