# B6 - TB10b : qualité de la position du SOS (precision, horodatage, source) et Idempotency-Key

Tier: spécifié (agent implementeur-specifie)
Audience: dev (contrat JSON, en-tête, migration, charge socket) ; non-dev pour les messages au patient et la notification aux soignants (textes fixés ci-dessous, à recopier à l'identique)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot3-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot3/decisions.md`, D52 à D62. Plan : `mobile_medconnect/docs/PLAN-APPLICATION-MOBILE.md`, paragraphe TB10b (vers la ligne 1098) et Q15 (ligne 1781).

## Spec

### Contexte (à lire avant de coder)

- `src/carnet-sante/dto/carnet-sante.dto.ts`, `CreateUrgenceDto` (vers la ligne 409) : `latitude?`, `longitude?` (`@IsNumber`), `message?`. Le `ValidationPipe` global a `whitelist` et `forbidNonWhitelisted` : tout nouveau champ doit être déclaré. Pas de `enableImplicitConversion` : les nombres arrivent déjà en nombres (JSON).
- `src/carnet-sante/carnet-sante.service.ts` :
  - `derniereUrgenceActive` (vers 1286, `findFirst` avec `include`) et `etatRelanceUrgence` (vers 1301) : l'anti-relance de 5 min (`SOS_ANTI_DOUBLON_MINUTES`) ne s'applique aujourd'hui qu'à une alerte `LANCE` qui a une latitude et une longitude.
  - `createUrgence(userId, dto)` (vers 1394) : anti-relance (409 `SOS_DEJA_ACTIF`), `prisma.urgence.create` avec `include.patient`, email et SMS au proche via `enfilerSansBloquer` (lien Google Maps si position), diffusion aux 5 structures les plus proches (`structuresLesPlusProches`, membres actifs titulaires de `sos:respond`, `chatGateway.sendEmergencyAlert(soignants, alertData)`, notification `SOS_ALERTE`), journal `sos.diffusion`, message honnête au patient, notification `SOS_DECLENCHE`, réponse `{ success, data: { ...urgence sans patient, structuresAlertees, soignantsAlertes, procheAlerte, positionTransmise }, message }`.
  - `getActiveUrgences` (vers 1713, `findMany` avec `include`), `takeCharge` (`update` vers 1645, avec `include`), `updateUrgenceStatus` (`update` vers 1744, sans include ni select).
- `src/carnet-sante/carnet-sante.controller.ts` : route `POST /carnet-sante/sos` (`createUrgence(req, dto)`, vers la ligne 368), réservée au rôle PATIENT.
- Tests existants à garder verts sans changer leurs attentes : `carnet-sante.sos-diffusion.spec.ts`, `carnet-sante.urgence.spec.ts`, `carnet-sante.controller.spec.ts` (seule exception autorisée : point 7). Modèle de construction du service à reprendre : `carnet-sante.sos-diffusion.spec.ts` lignes 1 à 92 (dix dépendances passées `as never`).
- Construction d'une erreur Prisma dans un test : voir `src/common/telephone/telephone-unicite.spec.ts` ligne 94 (`new Prisma.PrismaClientKnownRequestError(message, { code: 'P2002', clientVersion: ... })`).
- Journaux : pino masque déjà `req.body.latitude` et `req.body.longitude` (`src/app.module.ts`) ; aucune ligne `this.logger.*` ne doit contenir une latitude, une longitude ni le contenu de `alertData`.
- Imports : bare specifier `src/...` et `generated/prisma/client` (ou `generated/prisma/enums` pour les énumérations, comme `UrgenceStatus` dans le DTO).

Tout ce qui suit est livré dans cette seule tâche (colonnes, DTO, règle de qualité, idempotence et réponses ne fonctionnent qu'ensemble).

### 1. Schéma Prisma (`prisma/schema.prisma`)

Ajouter, juste après `enum UrgenceStatus` :
```prisma
// Origine de la position envoyée avec une alerte SOS (TB10b).
enum SourcePositionUrgence {
  gps
  reseau
  inconnue
}
```
Dans `model Urgence`, après `message String?` :
```prisma
  // Qualité de la position (TB10b) : rayon d'incertitude en mètres, heure de la mesure
  // côté téléphone, origine. Toujours enregistrées, même si la position n'a pas servi.
  precisionMetres    Float?
  horodatagePosition DateTime?
  sourcePosition     SourcePositionUrgence?

  // Idempotence (TB10b, D59) : clé envoyée par le client dans Idempotency-Key, et bilan
  // de diffusion renvoyé tel quel à un rejeu. Jamais renvoyés par les routes SOS (D61).
  cleIdempotence String?
  bilanDiffusion Json?
```
Et, à côté de `@@index([patientId, createdAt])` :
```prisma
  // Un rejeu (même patient, même clé) retrouve l'alerte d'origine ; NULL n'est jamais en conflit.
  @@unique([patientId, cleIdempotence])
```

### 2. Migration `prisma/migrations/20261021150000_tb10b_sos_position_idempotence/migration.sql`

Contenu exact (en-tête de commentaire compris) :
```sql
-- Alerte SOS (TB10b) : qualité de la position (précision, heure de mesure, origine)
-- et idempotence de la création (clé du client, bilan de diffusion rejoué).
-- Généré par `prisma migrate diff` (schéma précédent vers schéma courant).

-- CreateEnum
CREATE TYPE "SourcePositionUrgence" AS ENUM ('gps', 'reseau', 'inconnue');

-- AlterTable
ALTER TABLE "Urgence" ADD COLUMN     "bilanDiffusion" JSONB,
ADD COLUMN     "cleIdempotence" TEXT,
ADD COLUMN     "horodatagePosition" TIMESTAMP(3),
ADD COLUMN     "precisionMetres" DOUBLE PRECISION,
ADD COLUMN     "sourcePosition" "SourcePositionUrgence";

-- CreateIndex
CREATE UNIQUE INDEX "Urgence_patientId_cleIdempotence_key" ON "Urgence"("patientId", "cleIdempotence");
```
Contrôle avant application : `docker compose exec -T backend npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` doit produire ces mêmes instructions (à l'ordre des colonnes près). En cas d'écart, reprendre le SQL produit par la commande et le signaler dans le Return. Puis `docker compose exec -T backend npx prisma migrate deploy` et `docker compose exec -T backend npx prisma generate`. Jamais de `prisma migrate dev` ni de `db push`.

### 3. DTO (`src/carnet-sante/dto/carnet-sante.dto.ts`)

`Min`, `IsNumber`, `IsDateString`, `IsEnum` et `IsOptional` sont déjà importés ; ajouter seulement l'import `SourcePositionUrgence` depuis `generated/prisma/enums` (à côté de `UrgenceStatus`). Dans `CreateUrgenceDto`, entre `longitude` et `message` :
```ts
  @ApiPropertyOptional({
    example: 25,
    minimum: 0,
    description:
      "Rayon d'incertitude de la position, en mètres. Au-delà de 2 000 m, la position n'est pas utilisée pour choisir les établissements prévenus ; au-delà de 500 m, elle leur est signalée comme approximative.",
  })
  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'La précision de la position doit être un nombre de mètres.' },
  )
  @Min(0, { message: 'La précision de la position ne peut pas être négative.' })
  precision?: number;

  @ApiPropertyOptional({
    example: '2026-10-21T14:03:12.000Z',
    description:
      "Heure de la mesure de la position sur le téléphone (ISO 8601). Une position de plus de 15 minutes n'est pas utilisée pour choisir les établissements prévenus.",
  })
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: "L'heure de la position n'est pas valide." },
  )
  horodatagePosition?: string;

  @ApiPropertyOptional({
    enum: SourcePositionUrgence,
    example: SourcePositionUrgence.gps,
    description: 'Origine de la position : gps, reseau ou inconnue.',
  })
  @IsOptional()
  @IsEnum(SourcePositionUrgence, {
    message: "L'origine de la position n'est pas valide.",
  })
  source?: SourcePositionUrgence;
```
`latitude`, `longitude` et `message` inchangés.

### 4. Nouveau fichier `src/carnet-sante/sos-position.ts` (module pur, aucun import)

Commentaire de tête : règle de qualité de la position d'une alerte SOS (TB10b, D52 à D57), source unique utilisée à la création et par l'anti-relance.

Exporter exactement :
```ts
export const SOS_POSITION_AGE_MAX_MINUTES = 15;
export const SOS_PRECISION_MAX_METRES = 2000;
export const SOS_PRECISION_APPROXIMATIVE_METRES = 500;
export const SOS_HORODATAGE_AVANCE_TOLEREE_MINUTES = 5;

export type QualitePositionSos =
  | 'absente'
  | 'trop_ancienne'
  | 'trop_imprecise'
  | 'approximative'
  | 'precise'
  | 'non_qualifiee';

export interface PositionSos {
  latitude?: number | null;
  longitude?: number | null;
  precisionMetres?: number | null;
  horodatagePosition?: Date | null;
}

export interface EvaluationPositionSos {
  qualite: QualitePositionSos;
  /** Vrai si la position sert à choisir les établissements prévenus. */
  utilisable: boolean;
  precisionMetres: number | null;
  /** Vrai si l'horodatage, trop en avance sur `reference`, a été ignoré (D54). */
  horodatageIgnore: boolean;
}

export function evaluerPositionSos(position: PositionSos, reference: Date): EvaluationPositionSos
```
Règle de `evaluerPositionSos`, dans cet ordre (D52, D54, D55) :
1. `precisionMetres` = `position.precisionMetres ?? null` ; `horodatageIgnore` = `false` au départ.
2. `latitude` ou `longitude` null ou undefined : `absente`, non utilisable.
3. Si `horodatagePosition` est présent : `ecartMs = reference.getTime() - horodatagePosition.getTime()`. Si `ecartMs < -SOS_HORODATAGE_AVANCE_TOLEREE_MINUTES * 60_000` : `horodatageIgnore = true` (on passe à l'étape 4 sans juger l'âge). Sinon, si `ecartMs > SOS_POSITION_AGE_MAX_MINUTES * 60_000` (strictement) : `trop_ancienne`, non utilisable. (Une avance de 5 min au plus compte comme un âge nul : rien à faire.)
4. `precisionMetres !== null && precisionMetres > SOS_PRECISION_MAX_METRES` : `trop_imprecise`, non utilisable.
5. `precisionMetres !== null && precisionMetres > SOS_PRECISION_APPROXIMATIVE_METRES` : `approximative`, utilisable.
6. `precisionMetres !== null` : `precise`, utilisable (0 compris).
7. Sinon : `non_qualifiee`, utilisable (ancien client, comportement actuel).

Exporter aussi les textes (recopier à l'identique ; `proche` est la phrase existante sur le proche, vide ou commençant par une espace) :
```ts
/** Mètres arrondis à la dizaine, milliers séparés par une espace insécable : 1987 donne « 1 990 ». */
export function formaterMetres(metres: number): string {
  const arrondi = Math.round(metres / 10) * 10;
  return String(arrondi).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/** Ajouté à la charge de l'alerte et à la notification des soignants (D58). */
export function avertissementPositionApproximative(metres: number): string {
  return `Position approximative, environ ${formaterMetres(metres)} m`;
}

/** Phrase ajoutée au message de succès du patient quand la position est approximative. */
export function phrasePositionApproximative(metres: number): string {
  return ` Votre position est approximative (environ ${formaterMetres(metres)} m) : si vous le pouvez, appelez aussi les secours.`;
}

/** Message au patient quand la position reçue n'a pas servi (D57). */
export function messagePositionNonUtilisee(
  qualite: 'trop_ancienne' | 'trop_imprecise',
  proche: string,
): string {
  if (qualite === 'trop_ancienne') {
    return (
      "Votre position date de plus de 15 minutes et n'est plus fiable : aucun établissement de santé n'a été alerté." +
      `${proche} Appelez immédiatement les secours, puis relancez l'alerte pour envoyer votre position actuelle.`
    );
  }
  return (
    "Votre position est trop imprécise pour prévenir les établissements de santé proches : aucun établissement n'a été alerté." +
    `${proche} Appelez immédiatement les secours. Si vous le pouvez, placez-vous à découvert, attendez quelques secondes que votre position se précise, puis relancez l'alerte.`
  );
}
```

### 5. Nouveau fichier `src/carnet-sante/sos-idempotence.ts`

Imports : `Prisma` de `generated/prisma/client` ; `type QualitePositionSos` de `./sos-position`. Commentaire de tête : idempotence de la création d'une alerte SOS (en-tête `Idempotency-Key`, D59 à D61).

Exporter exactement :
```ts
export const SOS_IDEMPOTENCE_HEURES = 24;

const FORMAT_CLE = /^[A-Za-z0-9._:-]{8,128}$/;

export const MESSAGE_SOS_DIFFUSION_EN_COURS =
  "Votre alerte est déjà en cours d'envoi. En cas de danger immédiat, appelez les secours.";

/** Clé lue dans l'en-tête (trim), ou null si absente ou mal formée (D60). */
export function lireCleIdempotence(enTete: string | undefined): string | null {
  if (typeof enTete !== 'string') return null;
  const cle = enTete.trim();
  return FORMAT_CLE.test(cle) ? cle : null;
}

/** Bilan de diffusion enregistré avec l'alerte et renvoyé tel quel à un rejeu. */
export interface BilanSos {
  structuresAlertees: number;
  soignantsAlertes: number;
  procheAlerte: boolean;
  positionTransmise: boolean;
  positionUtilisee: boolean;
  qualitePosition: QualitePositionSos;
  precisionMetres: number | null;
  message: string;
}

export function estBilanSos(valeur: unknown): valeur is BilanSos
```
`estBilanSos` : vrai seulement pour un objet non null dont `structuresAlertees` et `soignantsAlertes` sont des `number`, `procheAlerte`, `positionTransmise` et `positionUtilisee` des `boolean`, `qualitePosition` et `message` des `string`, et `precisionMetres` un `number` ou `null`.

```ts
/** Vrai pour un P2002 levé par l'unicité (patientId, cleIdempotence) : rejeu concurrent. */
export function estConflitCleIdempotence(erreur: unknown): boolean
```
Même construction que `estConflitTelephone` de `src/common/telephone/telephone-unicite.ts` : `false` si pas `Prisma.PrismaClientKnownRequestError` ou code différent de `P2002` ; sinon `meta` sérialisé dans un try/catch, et `` `${erreur.message} ${meta}`.includes('cleIdempotence') ``. (Pas d'extraction commune : deux usages seulement, règle de trois.)

```ts
/** Champs de l'alerte renvoyables au client : sans patient, clé ni bilan (D61). */
export function donneesUrgencePubliques(
  urgence: Record<string, unknown>,
): Record<string, unknown> {
  const champsExclus = new Set(['patient', 'cleIdempotence', 'bilanDiffusion']);
  return Object.fromEntries(
    Object.entries(urgence).filter(([cle]) => !champsExclus.has(cle)),
  );
}
```

### 6. Service (`src/carnet-sante/carnet-sante.service.ts`)

Imports à ajouter : `evaluerPositionSos`, `avertissementPositionApproximative`, `phrasePositionApproximative`, `messagePositionNonUtilisee` depuis `./sos-position` ; `SOS_IDEMPOTENCE_HEURES`, `MESSAGE_SOS_DIFFUSION_EN_COURS`, `lireCleIdempotence`, `estBilanSos`, `estConflitCleIdempotence`, `donneesUrgencePubliques`, `type BilanSos` depuis `./sos-idempotence` ; `Prisma` depuis `generated/prisma/client` s'il n'est pas déjà importé.

6.1 `derniereUrgenceActive` : ajouter `omit: { cleIdempotence: true, bilanDiffusion: true }` (à côté de `include`). Même ajout dans `getActiveUrgences` (`findMany`), dans `takeCharge` (`update`) et dans `updateUrgenceStatus` (`update`). Rien d'autre ne change dans ces méthodes.

6.2 `etatRelanceUrgence` : ajouter au type du paramètre `precisionMetres?: number | null; horodatagePosition?: Date | null;` et remplacer la condition `urgence.latitude != null && urgence.longitude != null` par `evaluerPositionSos(urgence, urgence.createdAt).utilisable`. Mettre à jour le commentaire : sans position utilisable (absente, trop ancienne ou trop imprécise), l'alerte n'a été diffusée à aucun établissement, le patient peut relancer tout de suite (D56).

6.3 Nouvelle méthode privée, juste avant `createUrgence` :
```ts
  /** Réponse à un rejeu (même patient, même clé) : même alerte, aucune nouvelle diffusion. */
  private reponseRejeuSos(urgence: Record<string, unknown> & { id: string; bilanDiffusion?: unknown }) {
    const donnees = donneesUrgencePubliques(urgence);
    if (estBilanSos(urgence.bilanDiffusion)) {
      const { message, ...bilan } = urgence.bilanDiffusion;
      this.logger.log(`sos.rejeu urgenceId=${urgence.id}`);
      return { success: true, data: { ...donnees, ...bilan, rejeu: true }, message };
    }
    this.logger.log(`sos.rejeu urgenceId=${urgence.id} diffusionEnCours=true`);
    return {
      success: true,
      data: { ...donnees, rejeu: true, diffusionEnCours: true },
      message: MESSAGE_SOS_DIFFUSION_EN_COURS,
    };
  }
```
(Ajuster seulement le typage si `tsc` le demande.)

6.4 `createUrgence(userId: string, dto: CreateUrgenceDto, enTeteIdempotence?: string)`, dans cet ordre :

a. Au tout début :
```ts
    const cleIdempotence = lireCleIdempotence(enTeteIdempotence);
    if (enTeteIdempotence !== undefined && enTeteIdempotence.trim() !== '' && !cleIdempotence) {
      this.logger.warn('sos.cle_idempotence_ignoree format invalide');
    }
    if (cleIdempotence) {
      const existante = await this.prisma.urgence.findUnique({
        where: { patientId_cleIdempotence: { patientId: userId, cleIdempotence } },
      });
      if (existante) {
        const limite = Date.now() - SOS_IDEMPOTENCE_HEURES * 3_600_000;
        if (existante.createdAt.getTime() >= limite) {
          return this.reponseRejeuSos(existante);
        }
        // Clé réutilisée après 24 h : elle est retirée de l'ancienne alerte, la nouvelle la reprend.
        await this.prisma.urgence.update({
          where: { id: existante.id },
          data: { cleIdempotence: null },
        });
        this.logger.log(`sos.cle_idempotence_expiree urgenceId=${existante.id}`);
      }
    }
```
b. Anti-relance existant, inchangé (le rejeu passe avant, il ne reçoit jamais le 409).

c. Création : ajouter dans `data` (valeurs `undefined` quand absentes, jamais `null`, pour ne pas casser les attentes des tests existants) :
```ts
        precisionMetres: dto.precision ?? undefined,
        horodatagePosition: dto.horodatagePosition ? new Date(dto.horodatagePosition) : undefined,
        sourcePosition: dto.source ?? undefined,
        cleIdempotence: cleIdempotence ?? undefined,
```
Entourer l'appel `create` d'un try/catch : si `estConflitCleIdempotence(erreur) && cleIdempotence`, relire `findUnique` (même `where` qu'en a) ; si trouvée, journaliser `sos.rejeu_concurrent urgenceId=<id>` (`this.logger.log`) puis `return this.reponseRejeuSos(trouvee)` ; sinon relancer l'erreur. Toute autre erreur est relancée. Garder `const urgence` utilisable après le bloc (déclarer avec `let` ou extraire l'appel, au choix, sans changer le reste).

d. Juste après la création :
```ts
    const evaluation = evaluerPositionSos(
      {
        latitude: dto.latitude,
        longitude: dto.longitude,
        precisionMetres: dto.precision,
        horodatagePosition: dto.horodatagePosition ? new Date(dto.horodatagePosition) : null,
      },
      urgence.createdAt,
    );
    if (evaluation.horodatageIgnore) {
      this.logger.warn(`sos.horodatage_futur urgenceId=${urgence.id}`);
    }
    const positionUtilisee = evaluation.utilisable;
    const positionApproximative = evaluation.qualite === 'approximative';
    const avertissementPosition =
      positionApproximative && evaluation.precisionMetres !== null
        ? avertissementPositionApproximative(evaluation.precisionMetres)
        : null;
```
`hasLocation` reste calculé comme aujourd'hui (position reçue).

e. Email au proche : `location` seulement si `positionUtilisee` (au lieu de `hasLocation`). SMS au proche : `locationStr` seulement si `positionUtilisee`. (D56)

f. Diffusion aux structures : `if (positionUtilisee)` au lieu de `if (hasLocation)`. Dans `alertData`, ajouter après `longitude` :
```ts
        qualitePosition: evaluation.qualite,
        precisionMetres: evaluation.precisionMetres,
        positionApproximative,
        avertissementPosition,
```
Message de la notification `SOS_ALERTE` : ``message: `URGENCE : Un patient (${alertData.patientName}) a besoin d'aide à proximité.${avertissementPosition ? ` ${avertissementPosition}.` : ''}` ``.

g. Journal : `sos.diffusion urgenceId=${urgence.id} position=${hasLocation} qualitePosition=${evaluation.qualite} structures=${structuresAlertees} soignants=${soignantsAlertes}` (aucune coordonnée, aucune précision).

h. Message au patient, en remplaçant la cascade actuelle :
```ts
    if (structuresAlertees > 0) {
      message =
        `Alerte envoyée à ${structuresAlertees} établissement${...} de santé proche${...}.` +
        `${proche}` +
        (positionApproximative && evaluation.precisionMetres !== null
          ? phrasePositionApproximative(evaluation.precisionMetres)
          : '') +
        ' Restez calme, un soignant va prendre en charge votre alerte.';
    } else if (evaluation.qualite === 'trop_ancienne' || evaluation.qualite === 'trop_imprecise') {
      message = messagePositionNonUtilisee(evaluation.qualite, proche);
    } else if (!hasLocation) {
      // texte actuel inchangé
    } else {
      // texte actuel inchangé (« Aucun soignant disponible... »)
    }
```
Le texte de succès sans position approximative doit rester exactement celui d'aujourd'hui (les tests existants le vérifient).

i. Notification `SOS_DECLENCHE` : inchangée.

j. Réponse et bilan :
```ts
    const bilan: BilanSos = {
      structuresAlertees,
      soignantsAlertes,
      procheAlerte,
      positionTransmise: hasLocation,
      positionUtilisee,
      qualitePosition: evaluation.qualite,
      precisionMetres: evaluation.precisionMetres,
      message,
    };
    if (cleIdempotence) {
      try {
        await this.prisma.urgence.update({
          where: { id: urgence.id },
          data: { bilanDiffusion: bilan as unknown as Prisma.InputJsonValue },
        });
      } catch (e) {
        this.logger.error(`sos.bilan_non_enregistre urgenceId=${urgence.id} : ${(e as Error).message}`);
      }
    }
    const { message: _message, ...champsBilan } = bilan;  // ou équivalent sans variable inutilisée signalée par eslint
    return {
      success: true,
      data: { ...donneesUrgencePubliques(urgence), ...champsBilan, rejeu: false },
      message,
    };
```
La réponse garde donc `structuresAlertees`, `soignantsAlertes`, `procheAlerte`, `positionTransmise` et ajoute `positionUtilisee`, `qualitePosition`, `precisionMetres`, `rejeu`. L'ancien `Object.fromEntries(... cle !== 'patient')` est remplacé par `donneesUrgencePubliques`.

### 7. Contrôleur (`src/carnet-sante/carnet-sante.controller.ts`)

Importer `Headers` (`@nestjs/common`) et `ApiHeader` (`@nestjs/swagger`). Sur `createUrgence` :
```ts
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      "Clé unique par alerte (8 à 128 caractères parmi lettres, chiffres, . _ : -), par exemple un UUID. Un renvoi avec la même clé dans les 24 h renvoie la même alerte sans nouvelle diffusion. Clé mal formée : ignorée.",
  })
  createUrgence(
    @Req() req: RequestWithUser,
    @Body() dto: CreateUrgenceDto,
    @Headers('idempotency-key') enTeteIdempotence?: string,
  ) {
    ...
    return this.carnetSanteService.createUrgence(req.user.userId, dto, enTeteIdempotence);
  }
```
Dans `carnet-sante.controller.spec.ts`, seule modification autorisée d'une attente existante : `toHaveBeenCalledWith('u1', dto)` devient `toHaveBeenCalledWith('u1', dto, undefined)` ; ajouter un test « transmet l'en-tête Idempotency-Key » (appel avec un troisième argument `'cle-essai-0001'`, attendu `('u1', dto, 'cle-essai-0001')`).

### 8. Tests Jest (nouveaux fichiers)

`src/carnet-sante/sos-position.spec.ts` (référence fixe `new Date('2026-10-21T12:00:00Z')`) :
- latitude ou longitude absente : `absente`, non utilisable ;
- ni precision ni horodatage : `non_qualifiee`, utilisable ;
- precision 0 et 500 : `precise` ; 501 et 2000 : `approximative`, utilisable ; 2001 : `trop_imprecise`, non utilisable ;
- horodatage 15 min pile avant : utilisable ; 15 min et 1 s avant : `trop_ancienne` ;
- horodatage 4 min dans le futur avec precision 30 : `precise`, `horodatageIgnore` faux ; 10 min dans le futur avec precision 3000 : `trop_imprecise`, `horodatageIgnore` vrai ; 10 min dans le futur sans precision : `non_qualifiee`, utilisable ;
- horodatage 20 min avant et precision 3000 : `trop_ancienne` (priorité) ;
- `formaterMetres(847)` vaut `'850'`, `formaterMetres(1987)` vaut `'1\u00a0990'` ; `avertissementPositionApproximative(900)` vaut `'Position approximative, environ 900 m'` ;
- `messagePositionNonUtilisee('trop_imprecise', '')` contient « trop imprécise » et « Appelez immédiatement les secours » ; `'trop_ancienne'` contient « plus de 15 minutes ».

`src/carnet-sante/sos-idempotence.spec.ts` :
- `lireCleIdempotence` : UUID accepté ; espaces autour retirés ; `undefined`, `''`, 7 caractères, 129 caractères, `'cle avec espace'` et `'clé-accentuée'` donnent `null` ;
- `estBilanSos` : bilan complet vrai ; `null`, `{}`, bilan sans `message`, `precisionMetres: '12'` faux ;
- `estConflitCleIdempotence` : P2002 dont le message cite `cleIdempotence` vrai ; P2002 sur `telephoneNormalise` faux ; P2025 faux ; `new Error('x')` faux ;
- `donneesUrgencePubliques` retire `patient`, `cleIdempotence`, `bilanDiffusion` et garde les autres champs.

`src/carnet-sante/dto/create-urgence.dto.spec.ts` (`plainToInstance` puis `validate`, comme `carnet-sante.dto.spec.ts`) :
- `{ latitude, longitude }` seuls : 0 erreur ; `{}` : 0 erreur ;
- complet (`precision: 12.5`, `horodatagePosition: '2026-10-21T14:03:12.000Z'`, `source: 'gps'`) : 0 erreur ; `source: 'reseau'` et `'inconnue'` : 0 erreur ; `precision: null` : 0 erreur ;
- `precision: -1` : erreur sur `precision` avec le message « La précision de la position ne peut pas être négative. » ; `precision: 'abc'` : erreur sur `precision` ;
- `horodatagePosition: 'hier'` : erreur sur `horodatagePosition` ; `source: 'satellite'` : erreur sur `source`.

`src/carnet-sante/carnet-sante.sos-position.spec.ts` (construction du service et mocks copiés de `carnet-sante.sos-diffusion.spec.ts`, avec en plus `urgence.findUnique` (défaut `null`) et `urgence.update` (défaut `{}`) ; `urgence.create` renvoie `createdAt: new Date()`) :
1. ancien client `{ latitude: 9.5, longitude: -13.7 }` : une alerte socket, `data.qualitePosition === 'non_qualifiee'`, `data.positionUtilisee === true`, `data.rejeu === false`, `findUnique` jamais appelé, `update` jamais appelé ;
2. `precision: 3000` : `structure.findMany` et `sendEmergencyAlert` jamais appelés ; `urgence.create` appelé avec `precisionMetres: 3000`, `latitude: 9.5`, `longitude: -13.7` ; `data.positionTransmise === true`, `data.positionUtilisee === false`, `data.qualitePosition === 'trop_imprecise'` ; le profil du mock n'ayant ni `contactTelephone` ni `contactEmail`, message égal à `messagePositionNonUtilisee('trop_imprecise', '')` ;
3. `horodatagePosition` 20 min avant maintenant (precision 20) : aucune alerte socket, `qualitePosition === 'trop_ancienne'`, message contient « plus de 15 minutes » ;
4. `precision: 900` avec horodatage récent et `source: 'gps'` : une alerte socket dont la charge contient `positionApproximative: true`, `precisionMetres: 900`, `avertissementPosition: 'Position approximative, environ 900 m'` ; la notification `SOS_ALERTE` se termine par `Position approximative, environ 900 m.` ; le message patient contient « Votre position est approximative (environ 900 m) » ; `create` appelé avec `sourcePosition: 'gps'` ;
5. proche avec `contactTelephone` et `precision: 3000` : `enqueueSos` appelé avec `location: undefined` ; avec `precision: 900` : `location` commence par `Position: https://www.google.com/maps?q=` ;
6. anti-relance : `urgence.findFirst` renvoie une alerte `LANCE` créée il y a 1 min avec latitude, longitude et `precisionMetres: 3000` : pas de 409, `create` appelé ; même alerte avec `precisionMetres: 100` : 409 `SOS_DEJA_ACTIF` ;
7. rejeu : en-tête `'3f6c2a1e-8b4d-4c7a-9e21-5d0b7f3a6c11'`, `findUnique` renvoie une alerte créée il y a 1 h avec un `bilanDiffusion` complet (message `'Alerte envoyée à 1 établissement de santé proche. Restez calme, un soignant va prendre en charge votre alerte.'`) et `cleIdempotence` : même `data.id`, `data.rejeu === true`, `message` égal à celui du bilan, `data` sans `cleIdempotence` ni `bilanDiffusion` ; `create`, `urgence.findFirst`, `sendEmergencyAlert`, `createNotification`, `createManyNotifications`, `enqueueSos`, `enqueueEmergencyEmail` jamais appelés ;
8. clé expirée : `findUnique` renvoie une alerte créée il y a 25 h : `update` appelé avec `{ where: { id: <ancienne> }, data: { cleIdempotence: null } }`, puis `create` appelé avec `cleIdempotence` égal à la clé ;
9. nouvelle clé : `create` appelé avec `cleIdempotence` égal à la clé ; `update` appelé avec `data.bilanDiffusion` dont `message` est égal au `message` de la réponse ;
10. rejeu concurrent : `create` rejette un P2002 citant `cleIdempotence`, `findUnique` renvoie `null` au premier appel puis une alerte sans `bilanDiffusion` : `data.diffusionEnCours === true`, `data.rejeu === true`, message égal à `MESSAGE_SOS_DIFFUSION_EN_COURS`, aucune alerte socket ;
11. en-tête invalide `'abc'` : `findUnique` jamais appelé, `create` appelé sans clé (`cleIdempotence` undefined) ;
12. aucune coordonnée dans les journaux : `jest.spyOn(Logger.prototype, 'log' | 'warn' | 'error' | 'debug')` (import `Logger` de `@nestjs/common`), SOS avec `latitude: 9.51234`, `longitude: -13.74567`, `precision: 900` ; aucun argument d'aucun appel ne contient `9.51234` ni `13.74567`. Restaurer les espions après le test.

### 9. Documentation (`CLAUDE.md` du dépôt back)

Ajouter, dans « Conventions importantes (pièges) », juste après la puce « Un numéro par compte (TB17) », une puce **SOS : qualité de la position et idempotence (TB10b)** qui dit, en un paragraphe : champs optionnels `precision` (mètres, 0 ou plus), `horodatagePosition` (ISO 8601) et `source` (`gps`, `reseau`, `inconnue`) de `POST /carnet-sante/sos`, enregistrés dans `Urgence` (`precisionMetres`, `horodatagePosition`, `sourcePosition`) ; règle de `src/carnet-sante/sos-position.ts` (plus de 15 min ou plus de 2 000 m : position enregistrée mais non utilisée, aucune structure prévenue, pas de lien au proche, message au patient qui demande d'appeler, relance possible aussitôt ; plus de 500 m : utilisée et signalée `avertissementPosition` dans la charge `emergencyAlert` et la notification ; horodatage en avance de plus de 5 min ignoré ; sans precision ni horodatage : comportement d'avant) ; champs ajoutés à la réponse (`positionUtilisee`, `qualitePosition`, `precisionMetres`, `rejeu`, et `diffusionEnCours` pour un rejeu arrivé pendant l'envoi) ; en-tête facultatif `Idempotency-Key` (8 à 128 caractères `[A-Za-z0-9._:-]`, sinon ignoré) : même patient et même clé dans les 24 h donne la même alerte, réponse 201 rejouée depuis `Urgence.bilanDiffusion`, sans nouvelle diffusion ni 409 ; stockage en base (unicité `patientId` + `cleIdempotence`), indépendant de Redis ; `cleIdempotence` et `bilanDiffusion` ne sortent jamais dans les réponses ; aucune coordonnée dans les journaux. Pas de tiret cadratin ni demi-cadratin.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Propres à B6 :
- Aucune nouvelle dépendance npm ; `package.json` et `package-lock.json` inchangés. Pas de Redis pour l'idempotence (D59).
- Aucune modification des migrations existantes ; la nouvelle migration ne contient que le SQL du point 2.
- Ne pas toucher à `structuresLesPlusProches`, à `ficheUrgence`, au calcul des destinataires (TB10a, hors périmètre), ni à `src/chat/chat.gateway.ts`, `src/app.module.ts`, au front ou au mobile.
- Aucune ligne de journal ne contient latitude, longitude, précision ni contenu de `alertData` ou du DTO.
- Textes visibles recopiés à l'identique, en français, sans tiret cadratin ni demi-cadratin ; aucun terme interdit (docs/ORCHESTRATOR.md, sections 1 et 14) dans les textes destinés au patient ou aux soignants.
- Ne jamais lire ni modifier un fichier `.env` réel.
- Si une commande du « Done when » échoue sur un fichier hors de la liste ci-dessous (dette existante), ne pas le corriger : le signaler dans le Return.

Fichiers touchés (liste fermée) :
- nouveaux : `prisma/migrations/20261021150000_tb10b_sos_position_idempotence/migration.sql`, `src/carnet-sante/sos-position.ts`, `src/carnet-sante/sos-position.spec.ts`, `src/carnet-sante/sos-idempotence.ts`, `src/carnet-sante/sos-idempotence.spec.ts`, `src/carnet-sante/dto/create-urgence.dto.spec.ts`, `src/carnet-sante/carnet-sante.sos-position.spec.ts` ;
- modifiés : `prisma/schema.prisma`, `src/carnet-sante/dto/carnet-sante.dto.ts`, `src/carnet-sante/carnet-sante.service.ts`, `src/carnet-sante/carnet-sante.controller.ts`, `src/carnet-sante/carnet-sante.controller.spec.ts`, `CLAUDE.md`.

## Done when

Toutes les commandes lancées depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (Git Bash, conteneurs `backend` et `postgres` démarrés), après la migration du point 2 :

1. `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0.
2. `docker compose exec -T backend npx eslint src/carnet-sante/sos-position.ts src/carnet-sante/sos-position.spec.ts src/carnet-sante/sos-idempotence.ts src/carnet-sante/sos-idempotence.spec.ts src/carnet-sante/dto/create-urgence.dto.spec.ts src/carnet-sante/carnet-sante.sos-position.spec.ts src/carnet-sante/dto/carnet-sante.dto.ts src/carnet-sante/carnet-sante.service.ts src/carnet-sante/carnet-sante.controller.ts src/carnet-sante/carnet-sante.controller.spec.ts` : 0 erreur (si un de ces fichiers portait déjà un `eslint-disable` global de dette, il reste tel quel).
3. `docker compose exec -T backend npx jest` : toutes les suites vertes, dont les quatre nouvelles (`sos-position`, `sos-idempotence`, `create-urgence.dto`, `carnet-sante.sos-position`), et `carnet-sante.sos-diffusion`, `carnet-sante.urgence`, `carnet-sante.controller` sans autre changement d'attente que celui du point 7.
4. Migration et schéma alignés : `docker compose exec -T backend npx prisma migrate status` annonce le schéma à jour ; `docker compose exec -T backend npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` affiche `-- This is an empty migration.`
5. Base : `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT indexdef FROM pg_indexes WHERE indexname = '"'"'Urgence_patientId_cleIdempotence_key'"'"'" -c "SELECT string_agg(column_name, chr(44) ORDER BY column_name) FROM information_schema.columns WHERE table_name = '"'"'Urgence'"'"' AND column_name IN ('"'"'precisionMetres'"'"','"'"'horodatagePosition'"'"','"'"'sourcePosition'"'"','"'"'cleIdempotence'"'"','"'"'bilanDiffusion'"'"')"'` affiche une définition `CREATE UNIQUE INDEX ... ("patientId", "cleIdempotence")` puis `bilanDiffusion,cleIdempotence,horodatagePosition,precisionMetres,sourcePosition`.
6. Contrat publié (Swagger actif en dev) : `docker compose exec -T backend node -e "fetch('http://localhost:3001/api-json').then(r=>r.json()).then(d=>{const op=d.paths['/carnet-sante/sos'].post;console.log((op.parameters||[]).map(p=>p.name).join(','));console.log(Object.keys(d.components.schemas.CreateUrgenceDto.properties).sort().join(','))})"` affiche une première ligne contenant `Idempotency-Key` et une seconde égale à `horodatagePosition,latitude,longitude,message,precision,source`.
7. Pas de coordonnée journalisée : `grep -n -A2 "logger\.\(log\|warn\|error\|debug\)(" back_medconnect/src/carnet-sante/carnet-sante.service.ts back_medconnect/src/carnet-sante/sos-position.ts back_medconnect/src/carnet-sante/sos-idempotence.ts | grep -i "latitude\|longitude\|precision\|alertData"` ne renvoie aucune ligne (vide avant la tâche, constaté par l'orchestrateur), et le test 12 de `carnet-sante.sos-position.spec.ts` (Spec, section 8) est vert.
8. (Git Bash) `git -C back_medconnect diff -U0 | grep "^+" | LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]"` et `LC_ALL=C.UTF-8 grep -nP "[\x{2013}\x{2014}]" back_medconnect/src/carnet-sante/sos-*.ts back_medconnect/src/carnet-sante/carnet-sante.sos-position.spec.ts back_medconnect/src/carnet-sante/dto/create-urgence.dto.spec.ts back_medconnect/prisma/migrations/20261021150000_tb10b_sos_position_idempotence/migration.sql` : aucune ligne.
9. `git -C back_medconnect status --porcelain` ne liste que les fichiers de la liste fermée (plus rien sous `docs/plans/` venant du codeur).

## Return

Liste des fichiers créés et modifiés, puis pour chaque point du « Done when » : commande lancée, résultat en une ligne. Écart éventuel du SQL produit par `prisma migrate diff` (point 2). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
