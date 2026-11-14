# PB10 - Postes et sessions de caisse

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur lus par les pharmaciens au comptoir, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Quatrième pas du jalon J2 (PB07 à PB13, indissociables, D445). Les tables de caisse existent depuis PB09 (M5). Cette tâche écrit le service et les routes des sessions de caisse : ouvrir, session courante d'un poste, comptage par coupure (6 billets de 20 000 à 500 GNF, aucune ligne « pièces et autres ») et relevés mobiles (Orange Money, MTN MoMo) à la fermeture, mouvements de caisse motivés (prélèvement, apport, remboursement), bilan (activité du vendeur d'abord), fermeture (comptage requis, commentaire exigé au-delà du seuil d'écart), photographie `ResultatSessionMode`, anomalies `FOND_NON_COMPTE` et `ECART_CAISSE`, liste des sessions du jour, session ouverte dans `GET /postes`.

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate` nécessaire.** Ne pas toucher à la vente ni à l'annulation (`vente.service.ts`, `vente.controller.ts` : PB11, PB12), ni au domaine pur `src/pharmacie/domaine/` (PB04), ni aux instantanés `test/db/instantanes/`. Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D427, D428, D431, D435, D466, D469, D474, D481 à D484, D507, D514 à D517, D520, et surtout **D526 à D533** (écrites avec cette fiche). `CORRECTIONS-PORTEUR.md` point 1 prime sur le plan : coupures de 20 000, 10 000, 5 000, 2 000, 1 000 et 500 GNF uniquement, aucune ligne « pièces et autres ».

### Contexte vérifié (ne pas re-découvrir)

- Schéma (M5, `prisma/schema.prisma`) :
  - `SessionCaisse { id, pointDeVenteId, posteId, utilisateurId String?, utilisateurNom, statut StatutSession (OUVERTE | FERMEE | INCLUSE_DANS_CLOTURE), technique, jourMetier @db.Date, jourMetierOrigine?, ouverteLe, ouverteLeLocal?, fermeeLe?, fermeeLeLocal?, evenementOuvertureId @unique, evenementFermetureId? @unique, commentaireEcart?, commentaireParId?, clotureJournaliereId? }`, relations `poste`, `pointDeVente`, `comptages`, `mouvementsCaisse`, `paiements`, `resultats`, `ventes`. Index unique partiel : une seule OUVERTE par poste.
  - Trigger `session_caisse_proteger` : à l'insertion, poste du même point de vente et `technique` si et seulement si le poste est TECHNIQUE ; colonnes d'ouverture figées ; seule transition utile ici : OUVERTE vers FERMEE, dans **un seul UPDATE** qui pose ensemble `statut`, `fermeeLe`, `evenementFermetureId`, `commentaireEcart`, `commentaireParId` (un UPDATE qui change le commentaire d'une session restée OUVERTE est refusé). CHECK `SessionCaisse_fermeture_check` : `fermeeLe` nul si et seulement si OUVERTE.
  - `ComptageCaisse { id, sessionCaisseId, moment MomentComptage (OUVERTURE | FERMETURE), totalEspeces, auteurId, evenementId @unique, horodatageLocal?, createdAt }`, `@@unique([sessionCaisseId, moment])`, relations `lignes LigneComptage[]`, `releves ReleveModePaiement[]`. `LigneComptage { id, comptageId, valeurFaciale, nombre }` `@@unique([comptageId, valeurFaciale])`. `ReleveModePaiement { id, comptageId, modePaiementId, montantDeclare }` `@@unique([comptageId, modePaiementId])`. Tous immuables (trigger).
  - `MouvementCaisse { id, sessionCaisseId, pointDeVenteId, type TypeMouvementCaisse (PRELEVEMENT | APPORT | REMBOURSEMENT), modePaiementId, montant (> 0), motif (non vide), auteurId, horodatageServeur, horodatageLocal?, evenementId @unique }`, immuable.
  - `Paiement { id, venteId, sessionCaisseId, modePaiementId, montant (signé, <> 0), referenceExterne?, montantRecu?, createdAt }`, immuable.
  - `ResultatSessionMode { id, sessionCaisseId, modePaiementId, theorique, compte?, ecart?, createdAt }`, `@@unique([sessionCaisseId, modePaiementId])`, CHECK `ecart = compte - theorique` (nuls ensemble), immuable.
  - `Vente` porte `sessionCaisseId`, `typePiece` (VENTE | ANNULATION | REGULARISATION), `total`, `vendeurId` ; une ANNULATION exige `venteOrigineId` et `motifAnnulation` non vide (trigger M6). Trigger `vente_verifier_rattachement` : PV de la pharmacie, session de ce PV et de ce poste.
  - `ModePaiement { id, code @unique, libelle, comptagePhysique, referenceAutorisee, ordre, actif }` : M2 a inséré `ESPECES` (physique, ordre 1), `ORANGE_MONEY` (2), `MTN_MOMO` (3). `CoupureMonnaie { devise, valeurFaciale, type, ordre, actif }` : 6 billets GNF 20000 à 500.
  - `Anomalie { id, pointDeVenteId, type TypeAnomalie (dont FOND_NON_COMPTE, ECART_CAISSE), statut (défaut OUVERTE), attribueeAId?, pieceType String, pieceId?, details Json, creeLe }`.
  - `ParametresPharmacie.seuilEcartCaisse` (défaut 5000 GNF), clé `structureId`.
  - Poste : `{ id, pointDeVenteId, code, libelle, type TypePoste (WEB | DESKTOP | TECHNIQUE), actif, appareilId, ... }`, relation `sessionsCaisse`. Chaque PV a une session technique FERMEE sur le poste `REPRISE` (D517) : à exclure partout (`technique: false`).
- Domaine pur existant (PB04, ne pas modifier), `src/pharmacie/domaine/caisse.ts` : `CODE_ESPECES = 'ESPECES'`, types `TypeMouvementCaisse`, `LigneComptageCalcul`, `PaiementCalcul { mode, montant }`, `MouvementCaisseCalcul { type, mode, montant }`, `totalComptage(lignes)`, `calculerTheorique({ modes, fondEspeces, paiements, mouvements }): { mode, theorique }[]` (lève `RangeError` sur un mode inconnu ou en double, ou un fond positif sans `ESPECES`), `ecartCaisse(compte | null, theorique): number | null`.
- `jourConakry(d: Date): string` (AAAA-MM-JJ, Conakry = UTC+0) est exporté par `src/pharmacie/vente.service.ts` : l'importer de là.
- `AccesPharmacieService.verifier(structureId, userId)` : `{ user: { id, nom, prenom, structureId }, structure: { id, nom, type, adminId, isActive, ... } }` ; 404 pharmacie inconnue, 403 non membre, hôpital ou désactivée.
- `assurerPointDeVente(tx, { id, nom })` (`src/pharmacie/point-de-vente.ts`) renvoie `{ pointDeVente, parametres }` (upserts) : ne l'appeler que si le PV ou les paramètres manquent (D507).
- `PermissionsService` (module global) : `getUserPermissions(userId): Promise<string[]>` ; `PERMISSIONS.CAISSE_UTILISER` (`'caisse:utiliser'`), `PERMISSIONS.CAISSE_SUPERVISER` (`'caisse:superviser'`) dans `src/common/rbac/permissions.constants.ts`.
- `Reponse<T>` (`{ data, message, success: true }`) est exporté par `src/pharmacie/points-de-vente.service.ts` : le réutiliser.
- Erreurs : `throw new ConflictException({ message, code: 'POSTE_INCONNU' })` ; le filtre (`AllExceptionsFilter`) ne garde `code` que s'il est dans `CODES_ERREUR` ; pour `VALIDATION`, `champs: [{ champ, contraintes: [..], message }]` (un seul champ porteur de `message` remplace le message général). Toute 403 sans code reçoit `PERMISSION_REFUSEE`.
- `cheminsCout(donnees)` (`src/pharmacie/masquer-couts.ts`, D466) liste les clés qui correspondent à `/cout|marge/i` : **aucune clé de cette tâche ne doit contenir « cout » ni « marge »** (`compte`, `comptage`, `ecart`, `theorique` sont sûrs). Aucune donnée de coût ici, donc pas d'appel à `masquerCouts`, mais un test l'atteste.
- Transactions : `this.prisma.$transaction(async (tx) => ...)`, type `Prisma.TransactionClient` (`import type { Prisma } from 'generated/prisma/client'`). Verrou de ligne par `tx.$queryRaw\`SELECT ... FOR UPDATE\``. Après une erreur de requête dans une transaction interactive, la transaction est perdue : relancer, ne jamais continuer à écrire.
- Jeu `chargerFormatActuel` (`test/db/fixtures/format-actuel.ts`) : `usr-admin-p1` (Fatoumata Camara, administratrice et `adminId` de `str-pharma-1`), `usr-pharm-p1` (Mamadou Diallo, pharmacien de `str-pharma-1`), `usr-admin-p2`, `usr-pharm-p2` (`str-pharma-2`), `usr-admin-h1` (hôpital `str-hopital-1`). M2 a créé un PV d'ordre 1, un poste `REPRISE` et des paramètres par pharmacie ; M5 une session technique par PV. Modèle de test en base : `test/db/points-de-vente.db-spec.ts` (fonctions `refus`, `sql`, `compter`) et `test/db/caisse-pieces.db-spec.ts` (insertion SQL d'une `Vente`). Modèle de test HTTP : `src/pharmacie/points-de-vente.http.spec.ts`.

### 1. Codes d'erreur (`src/common/filters/codes-erreur.ts`)

Ajouter à la fin de `CODES_ERREUR`, avant `] as const;`, dans cet ordre, chacun précédé de son commentaire. Ne pas toucher à `CODES_AVEC_DETAILS`.

```ts
  // Poste de caisse inconnu, technique, d'une autre pharmacie ou désactivé (409).
  'POSTE_INCONNU',
  // Le poste a déjà une caisse ouverte par un autre utilisateur (409).
  'SESSION_AUTRE_UTILISATEUR',
  // Session de caisse déjà fermée : comptage, mouvement ou réouverture impossibles (409).
  'SESSION_FERMEE',
  // Comptage d'ouverture ou de fermeture déjà enregistré pour cette session (409).
  'COMPTAGE_DEJA_SAISI',
  // Fermeture de caisse sans comptage de fermeture (400).
  'COMPTAGE_FERMETURE_REQUIS',
  // Écart d'espèces au-delà du seuil de la pharmacie sans commentaire (400).
  'COMMENTAIRE_ECART_REQUIS',
  // Mode de paiement inconnu ou désactivé (400).
  'MODE_PAIEMENT_INCONNU',
  // Identifiant fourni par le client déjà porté par un autre enregistrement de caisse (409).
  'IDENTIFIANT_DEJA_UTILISE',
```

### 2. Règles pures d'assemblage (`src/pharmacie/caisse/bilan-caisse.ts`, nouveau)

Sans import de Nest, de Prisma ni d'horloge. Contenu exact :

```ts
import {
  CODE_ESPECES,
  calculerTheorique,
  ecartCaisse,
  type MouvementCaisseCalcul,
  type PaiementCalcul,
} from '../domaine/caisse';

export interface ModeReferentiel {
  code: string;
  libelle: string;
  actif: boolean;
  comptagePhysique: boolean;
}

export interface EntreeResultats {
  /** TOUS les modes connus, actifs ou non, dans l'ordre d'affichage (ordre, code). */
  modes: ModeReferentiel[];
  /** Total du comptage d'ouverture, 0 sans comptage. */
  fondEspeces: number;
  paiements: PaiementCalcul[];
  mouvements: MouvementCaisseCalcul[];
  /** Total du comptage de fermeture, null sans comptage. */
  totalEspecesCompte: number | null;
  /** Relevés de fermeture des modes sans comptage physique. */
  releves: { mode: string; montant: number }[];
}

export interface ResultatMode {
  mode: string;
  libelle: string;
  theorique: number;
  /** null : non rapproché. */
  compte: number | null;
  ecart: number | null;
}

/**
 * Théorique, compté et écart par mode (D474, D531). Compté des espèces = comptage de
 * fermeture ; compté d'un autre mode = son relevé, sinon null. Un mode figure s'il est
 * actif, ou si son théorique est non nul, ou s'il a un compté.
 */
export function resultatsParMode(entree: EntreeResultats): ResultatMode[] {
  const parCode = new Map(entree.modes.map((m) => [m.code, m]));
  const releves = new Map<string, number>();
  for (const r of entree.releves) {
    if (r.mode === CODE_ESPECES) {
      throw new RangeError('Les espèces se comptent par coupure, pas par relevé.');
    }
    if (!parCode.has(r.mode)) {
      throw new RangeError(`Mode de paiement inconnu : ${r.mode}.`);
    }
    if (releves.has(r.mode)) {
      throw new RangeError(`Relevé en double : ${r.mode}.`);
    }
    releves.set(r.mode, r.montant);
  }
  const theoriques = calculerTheorique({
    modes: entree.modes.map((m) => m.code),
    fondEspeces: entree.fondEspeces,
    paiements: entree.paiements,
    mouvements: entree.mouvements,
  });
  const resultats: ResultatMode[] = [];
  for (const { mode, theorique } of theoriques) {
    const ref = parCode.get(mode) as ModeReferentiel;
    const compte =
      mode === CODE_ESPECES
        ? entree.totalEspecesCompte
        : (releves.get(mode) ?? null);
    if (!ref.actif && theorique === 0 && compte === null) continue;
    resultats.push({
      mode,
      libelle: ref.libelle,
      theorique,
      compte,
      ecart: ecartCaisse(compte, theorique),
    });
  }
  return resultats;
}

/** Commentaire exigé si la valeur absolue de l'écart d'espèces dépasse strictement le seuil (D532). */
export function commentaireEcartRequis(
  ecartEspeces: number | null,
  seuil: number,
): boolean {
  return ecartEspeces !== null && Math.abs(ecartEspeces) > seuil;
}

/** Montant lisible : séparateur de milliers = espace ordinaire, signe conservé (-10 000). */
export function formaterGnf(montant: number): string {
  return String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
```

### 3. DTO (`src/pharmacie/dto/sessions-caisse.dto.ts`, nouveau)

Contenu exact (décorateurs Swagger compris) :

```ts
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MOMENTS_COMPTAGE = ['OUVERTURE', 'FERMETURE'] as const;
export type MomentComptageSaisi = (typeof MOMENTS_COMPTAGE)[number];
export const TYPES_MOUVEMENT_CAISSE = [
  'PRELEVEMENT',
  'APPORT',
  'REMBOURSEMENT',
] as const;
export type TypeMouvementCaisseSaisi = (typeof TYPES_MOUVEMENT_CAISSE)[number];
/** Code de mode de paiement (ESPECES, ORANGE_MONEY, MTN_MOMO, ...). */
export const MOTIF_CODE_MODE = /^[A-Z0-9_]{2,40}$/;

export class LigneComptageDto {
  @ApiProperty({ example: 20000, description: 'Valeur faciale du billet en GNF' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  valeurFaciale: number;

  @ApiProperty({ example: 12, description: 'Nombre de billets, 0 à 10 000' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  nombre: number;
}

export class ReleveModeDto {
  @ApiProperty({ example: 'ORANGE_MONEY' })
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode: string;

  @ApiProperty({ example: 150000, description: 'Total relevé sur le compte marchand, GNF' })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  montant: number;
}

export class ComptageOuvertureDto {
  @ApiProperty({ type: [LigneComptageDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LigneComptageDto)
  coupures: LigneComptageDto[];
}

export class ComptageFermetureDto extends ComptageOuvertureDto {
  @ApiPropertyOptional({ description: 'UUID généré par le client (rejeu sans doublon)' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiPropertyOptional({ type: [ReleveModeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReleveModeDto)
  releves?: ReleveModeDto[];
}

export class SaisirComptageDto extends ComptageFermetureDto {
  @ApiProperty({ enum: MOMENTS_COMPTAGE, example: 'FERMETURE' })
  @IsIn(MOMENTS_COMPTAGE)
  moment: MomentComptageSaisi;
}

export class OuvrirSessionDto {
  @ApiPropertyOptional({ description: 'UUID généré par le client (rejeu sans doublon)' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ description: 'Identifiant du poste de caisse' })
  @IsUUID('all')
  posteId: string;

  @ApiPropertyOptional({ type: ComptageOuvertureDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ComptageOuvertureDto)
  comptage?: ComptageOuvertureDto;
}

export class SessionCouranteQueryDto {
  @ApiProperty({ description: 'Identifiant du poste de caisse' })
  @IsUUID('all')
  posteId: string;
}

export class MouvementCaisseDto {
  @ApiPropertyOptional({ description: 'UUID généré par le client (rejeu sans doublon)' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ enum: TYPES_MOUVEMENT_CAISSE, example: 'PRELEVEMENT' })
  @IsIn(TYPES_MOUVEMENT_CAISSE)
  type: TypeMouvementCaisseSaisi;

  @ApiProperty({ example: 100000, description: 'GNF, 1 à 100 000 000' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  montant: number;

  @ApiPropertyOptional({
    example: 'Dépôt à la banque',
    description: 'Motif obligatoire, 3 à 300 caractères',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300, { message: 'Le motif ne doit pas dépasser 300 caractères.' })
  motif?: string;

  @ApiPropertyOptional({ example: 'ESPECES', description: 'Défaut : ESPECES' })
  @IsOptional()
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode?: string;
}

export class FermerSessionDto {
  @ApiPropertyOptional({ type: ComptageFermetureDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ComptageFermetureDto)
  comptageFermeture?: ComptageFermetureDto;

  @ApiPropertyOptional({
    example: 'Erreur de rendu de monnaie',
    description: 'Obligatoire si l’écart d’espèces dépasse le seuil (3 à 500 caractères)',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500, { message: 'Le commentaire ne doit pas dépasser 500 caractères.' })
  commentaire?: string;
}

export class ListerSessionsQueryDto {
  @ApiPropertyOptional({ example: '2026-10-25', description: 'Jour AAAA-MM-JJ (défaut : aujourd hui)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  jour?: string;
}
```

### 4. Service (`src/pharmacie/caisse/sessions-caisse.service.ts`, nouveau)

`@Injectable() export class SessionsCaisseService`, constructeur `(private readonly prisma: PrismaService, private readonly accesPharmacie: AccesPharmacieService, private readonly permissions: PermissionsService)`.

#### 4.1 Constantes de messages exportées (textes exacts)

```ts
export const MESSAGE_SESSION_INTROUVABLE = 'Cette session de caisse est introuvable.';
export const MESSAGE_SESSION_AUTRE_VENDEUR =
  'Cette caisse appartient à un autre vendeur : seul un responsable peut la consulter ou la modifier.';
export const MESSAGE_POSTE_INCONNU =
  "Ce poste de caisse est inconnu ou désactivé. Rechargez la page pour l'enregistrer à nouveau.";
export const MESSAGE_SESSION_FERMEE =
  'Cette caisse est déjà fermée : ouvrez une nouvelle caisse pour continuer.';
export const MESSAGE_IDENTIFIANT_DEJA_UTILISE =
  'Cet identifiant est déjà utilisé par un autre enregistrement de caisse.';
export const MESSAGE_COMPTAGE_FERMETURE_REQUIS =
  'Comptez les billets du tiroir avant de fermer la caisse.';
export const MESSAGE_MOTIF_MOUVEMENT_REQUIS =
  'Indiquez le motif de ce mouvement de caisse (3 caractères au moins).';
export function messageSessionAutreUtilisateur(nom: string): string {
  return `La caisse de ce poste est ouverte par ${nom}. Elle doit être fermée avant que vous puissiez encaisser ici.`;
}
export function messageComptageDejaSaisi(moment: 'OUVERTURE' | 'FERMETURE'): string {
  return moment === 'OUVERTURE'
    ? "Le comptage d'ouverture de cette caisse est déjà enregistré."
    : 'Le comptage de fermeture de cette caisse est déjà enregistré.';
}
export function messageModeInconnu(code: string): string {
  return `Le mode de paiement ${code} n'existe pas ou n'est plus accepté.`;
}
export function messageCommentaireRequis(ecart: number, seuil: number): string {
  return `L'écart d'espèces est de ${formaterGnf(ecart)} GNF, au-delà du seuil de ${formaterGnf(seuil)} GNF : ajoutez un commentaire pour fermer la caisse.`;
}
```

Messages de VALIDATION (lever `new BadRequestException({ message, code: 'VALIDATION', champs: [{ champ, contraintes: [contrainte], message }] })`) :

| Cas | `champ` | contrainte | message |
|---|---|---|---|
| coupure absente du référentiel actif GNF | `coupures` | `coupureConnue` | `La coupure de ${formaterGnf(v)} GNF n'existe pas : comptez uniquement les billets proposés.` |
| même valeur faciale deux fois | `coupures` | `coupureUnique` | `Chaque billet ne doit être compté qu'une fois.` |
| relevés au moment OUVERTURE (liste non vide) | `releves` | `releveFermetureSeulement` | `Les relevés Orange Money et MTN MoMo se saisissent à la fermeture.` |
| relevé d'un mode à `comptagePhysique` vrai | `releves` | `releveSansEspeces` | `Les espèces se comptent billet par billet, pas par relevé.` |
| même mode relevé deux fois | `releves` | `releveUnique` | `Chaque mode de paiement ne doit être relevé qu'une fois.` |
| `jour` de la liste inexistant (ex. 2026-02-31) | `jour` | `dateValide` | `La date doit être une date valide au format AAAA-MM-JJ.` |

Ordre des contrôles d'un comptage : coupures (doublon puis inconnue), puis relevés (moment, puis doublon, puis mode inconnu en 400 `MODE_PAIEMENT_INCONNU`, puis comptage physique). Un relevé peut viser un mode inactif s'il existe (il peut avoir des paiements).

#### 4.2 Types de réponse exportés

```ts
export interface ComptageReponse {
  id: string;
  moment: 'OUVERTURE' | 'FERMETURE';
  totalEspeces: number;
  coupures: { valeurFaciale: number; nombre: number }[]; // valeur faciale décroissante
  releves: { mode: string; libelle: string; montant: number }[]; // ordre des modes (ordre, code)
  auteurId: string;
  createdAt: Date;
}

export interface SessionReponse {
  id: string;
  poste: { id: string; code: string; libelle: string; type: 'WEB' | 'DESKTOP' };
  utilisateurId: string;
  utilisateurNom: string;
  statut: 'OUVERTE' | 'FERMEE' | 'INCLUSE_DANS_CLOTURE';
  jourMetier: string; // AAAA-MM-JJ
  ouverteLe: Date;
  fermeeLe: Date | null;
  commentaireEcart: string | null;
  fondCaisse: number; // total du comptage d'ouverture, 0 sans comptage
  fondCompte: boolean; // vrai si le comptage d'ouverture existe
  comptageOuverture: ComptageReponse | null;
  comptageFermeture: ComptageReponse | null;
}

export interface MouvementCaisseReponse {
  id: string;
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';
  mode: string;
  montant: number;
  motif: string;
  auteurId: string;
  horodatageServeur: Date;
}

export interface BilanSession {
  activite: {
    nombreVentes: number; // pièces VENTE et REGULARISATION de la session
    nombreAnnulations: number; // pièces ANNULATION
    montantEncaisse: number; // somme signée des paiements de la session
    parMode: { mode: string; libelle: string; montant: number; nombrePaiements: number }[]; // modes payés seulement, ordre des modes
  };
  session: SessionReponse;
  fond: { montant: number; compte: boolean };
  mouvements: MouvementCaisseReponse[]; // horodatageServeur croissant puis id
  theorique: { mode: string; libelle: string; montant: number }[];
  compte: { mode: string; libelle: string; montant: number | null }[];
  ecarts: { mode: string; libelle: string; ecart: number | null }[];
  ecartEspeces: number | null; // écart du mode ESPECES, null sans comptage de fermeture
  seuilEcartCaisse: number;
  commentaireRequis: boolean; // commentaireEcartRequis(ecartEspeces, seuil)
  fige: boolean; // vrai pour une session FERMEE ou INCLUSE (relu de ResultatSessionMode)
}
```

`activite` est la PREMIÈRE clé de `BilanSession` (l'activité du vendeur d'abord). `theorique`, `compte` et `ecarts` ont les mêmes modes dans le même ordre.

#### 4.3 Fonctions internes communes (privées, dans le service)

- `includeSession` : `{ poste: true, comptages: { include: { lignes: true, releves: { include: { modePaiement: true } } } } }`.
- `versSessionReponse(s)` : `jourMetier` = `jourConakry(s.jourMetier)` ; `utilisateurId` = `s.utilisateurId as string` (jamais nul hors session technique, CHECK) ; comptages triés : coupures par `valeurFaciale` décroissante, relevés par `modePaiement.ordre` puis `code` ; `poste.type` restreint à WEB ou DESKTOP (cast).
- `modesReferentiel(client)` : `modePaiement.findMany({ orderBy: [{ ordre: 'asc' }, { code: 'asc' }] })` (TOUS, actifs ou non).
- `lireSessionPharmacie(structureId, sessionId)` : `sessionCaisse.findFirst({ where: { id: sessionId, technique: false, pointDeVente: { structureId } }, include: includeSession })`, null : `NotFoundException(MESSAGE_SESSION_INTROUVABLE)`.
- `exigerDroitSurSession(session, userId)` : si `session.utilisateurId === userId` : rien ; sinon si `(await this.permissions.getUserPermissions(userId)).includes(PERMISSIONS.CAISSE_SUPERVISER)` : rien ; sinon `ForbiddenException(MESSAGE_SESSION_AUTRE_VENDEUR)`. Toujours appelé AVANT d'ouvrir la transaction (appel Redis).
- `verrouillerSession(tx, sessionId)` : `` tx.$queryRaw`SELECT "id" FROM "SessionCaisse" WHERE "id" = ${sessionId} FOR UPDATE` `` puis relecture `tx.sessionCaisse.findUniqueOrThrow({ where: { id }, include: includeSession })`.
- `enregistrerComptage(tx, session, moment, dto: { id?, coupures, releves? }, auteurId)` → `{ comptage: ComptageReponse, cree: boolean }` :
  1. `existant` = comptage de `session.comptages` au même `moment`. S'il existe : `dto.id === existant.id` → `{ comptage: existant, cree: false }` ; sinon 409 `COMPTAGE_DEJA_SAISI` (`messageComptageDejaSaisi(moment)`).
  2. Si `dto.id` est fourni et qu'un `ComptageCaisse` de cet id existe déjà (autre session ou autre moment) : 409 `IDENTIFIANT_DEJA_UTILISE`.
  3. Contrôles du tableau 4.1 (coupures contre `tx.coupureMonnaie.findMany({ where: { actif: true, devise: 'GNF' } })`, relevés contre `modesReferentiel(tx)`).
  4. `totalEspeces = totalComptage(coupures)` ; `id = dto.id ?? randomUUID()` (`node:crypto`) ; `tx.comptageCaisse.create({ data: { id, sessionCaisseId, moment, totalEspeces, auteurId, evenementId: id, lignes: { create: coupures.map(...) }, releves: { create: releves.map((r) => ({ modePaiementId, montantDeclare: r.montant })) } } })`.
- `calculerBilan(client, session, structureId)` → `BilanSession` (client = `this.prisma` ou `tx`) :
  1. `modes = modesReferentiel(client)` ; `seuil` = `parametresPharmacie.findUnique({ where: { structureId } })?.seuilEcartCaisse`, si absents : `(await assurerPointDeVente(...)).parametres` dans une transaction (même règle que `lireParametres` de `PointsDeVenteService`) ; dans `fermer`, déjà en transaction, appeler `assurerPointDeVente(tx, structure)`.
  2. `paiements` = `paiement.findMany({ where: { sessionCaisseId }, select: { montant, modePaiement: { select: { code } } } })` ; `mouvements` = `mouvementCaisse.findMany({ where: { sessionCaisseId }, include: { modePaiement: true }, orderBy: [{ horodatageServeur: 'asc' }, { id: 'asc' }] })` ; `pieces` = `vente.groupBy({ by: ['typePiece'], where: { sessionCaisseId }, _count: { _all: true } })`.
  3. `activite` : `nombreVentes` = comptes VENTE + REGULARISATION, `nombreAnnulations` = ANNULATION, `montantEncaisse` = somme des montants, `parMode` = pour chaque mode (ordre de `modes`) ayant au moins un paiement : `{ mode, libelle, montant: somme, nombrePaiements }`.
  4. Session OUVERTE : `resultats = resultatsParMode({ modes, fondEspeces, paiements, mouvements, totalEspecesCompte: comptage FERMETURE?.totalEspeces ?? null, releves: relevés du comptage FERMETURE })`. Session FERMEE ou INCLUSE : `resultats` = `resultatSessionMode.findMany({ where: { sessionCaisseId }, include: { modePaiement: true } })` triés par `modePaiement.ordre` puis `code`, projetés en `{ mode, libelle, theorique, compte, ecart }` ; `fige = true`.
  5. `ecartEspeces` = `ecart` du résultat `ESPECES` (null s'il manque) ; `commentaireRequis = commentaireEcartRequis(ecartEspeces, seuil)`.

#### 4.4 `ouvrirDansTransaction` (publique, réutilisée par PB11)

```ts
async ouvrirDansTransaction(
  tx: Prisma.TransactionClient,
  entree: {
    structureId: string;
    userId: string;
    utilisateurNom: string;
    posteId: string;
    sessionId?: string;
    comptage?: { coupures: { valeurFaciale: number; nombre: number }[] };
  },
): Promise<{ session: SessionReponse; ouverteMaintenant: boolean }>
```

1. Verrou du poste : `` tx.$queryRaw<{ id: string; pointDeVenteId: string; type: string; actif: boolean }[]>`SELECT p."id", p."pointDeVenteId", p."type"::text AS "type", p."actif" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE p."id" = ${posteId} AND pv."structureId" = ${structureId} FOR UPDATE OF p` ``. Aucune ligne, `type = 'TECHNIQUE'` ou `actif` faux : 409 `POSTE_INCONNU` (`MESSAGE_POSTE_INCONNU`).
2. Si `sessionId` : `connue = tx.sessionCaisse.findUnique({ where: { id: sessionId }, include: includeSession })`. Si elle existe : même `posteId` et même `utilisateurId` → OUVERTE : aller en 4 avec `session = connue` ; sinon 409 `SESSION_FERMEE` ; autre poste ou autre utilisateur : 409 `IDENTIFIANT_DEJA_UTILISE`.
3. `ouverte = tx.sessionCaisse.findFirst({ where: { posteId, statut: 'OUVERTE' }, include: includeSession })`. Si elle existe : `utilisateurId === userId` → aller en 4 avec `session = ouverte` ; sinon 409 `SESSION_AUTRE_UTILISATEUR` (`messageSessionAutreUtilisateur(ouverte.utilisateurNom)`).
4. Session existante (`ouverteMaintenant = false`) : si `comptage` fourni et aucun comptage OUVERTURE : `enregistrerComptage(tx, session, 'OUVERTURE', comptage, userId)` puis relire la session ; si un comptage d'ouverture existe déjà : ignorer `comptage` (aucune erreur). Renvoyer.
5. Sinon création : `id = sessionId ?? randomUUID()`, `maintenant = new Date()`, `tx.sessionCaisse.create({ data: { id, pointDeVenteId: poste.pointDeVenteId, posteId, utilisateurId: userId, utilisateurNom, jourMetier: new Date(\`${jourConakry(maintenant)}T00:00:00.000Z\`), ouverteLe: maintenant, evenementOuvertureId: id }, include: includeSession })` ; si `comptage` : `enregistrerComptage(...)` puis relire. `ouverteMaintenant = true`.

`utilisateurNom` = `` `${user.prenom} ${user.nom}`.trim() ``.

#### 4.5 Méthodes publiques des routes

Toutes commencent par `const { user, structure } = await this.accesPharmacie.verifier(structureId, userId)`.

| Méthode | Signature | Comportement | `message` |
|---|---|---|---|
| `ouvrir` | `(structureId, userId, dto: OuvrirSessionDto): Promise<Reponse<SessionReponse & { ouverteMaintenant: boolean }>>` | `this.prisma.$transaction((tx) => this.ouvrirDansTransaction(tx, { structureId, userId, utilisateurNom, posteId: dto.posteId, sessionId: dto.id, comptage: dto.comptage }))` | `Caisse ouverte.` ou `Votre caisse était déjà ouverte.` |
| `courante` | `(structureId, userId, posteId): Promise<Reponse<SessionReponse \| null>>` | poste = `poste.findFirst({ where: { id: posteId, type: { not: 'TECHNIQUE' }, pointDeVente: { structureId } } })` (inactif accepté), absent : 409 `POSTE_INCONNU` ; session OUVERTE du poste (quel que soit l'utilisateur) ou `null` | `Caisse ouverte sur ce poste.` ou `Aucune caisse ouverte sur ce poste.` |
| `saisirComptage` | `(structureId, userId, sessionId, dto: SaisirComptageDto): Promise<Reponse<ComptageReponse & { cree: boolean }>>` | `lireSessionPharmacie`, `exigerDroitSurSession`, puis transaction : `verrouillerSession` ; statut différent de OUVERTE : 409 `SESSION_FERMEE` ; `enregistrerComptage(tx, session, dto.moment, dto, user.id)` | `Comptage enregistré.` ou `Ce comptage était déjà enregistré.` |
| `enregistrerMouvement` | `(structureId, userId, sessionId, dto: MouvementCaisseDto): Promise<Reponse<MouvementCaisseReponse & { cree: boolean }>>` | motif absent ou de moins de 3 caractères : 400 `MOTIF_REQUIS` (`MESSAGE_MOTIF_MOUVEMENT_REQUIS`), testé AVANT tout accès base après `verifier` ; `lireSessionPharmacie`, `exigerDroitSurSession` ; transaction : `verrouillerSession`, statut non OUVERTE : 409 `SESSION_FERMEE` ; si `dto.id` et un `MouvementCaisse` de cet id existe : même session → renvoyer (`cree: false`), sinon 409 `IDENTIFIANT_DEJA_UTILISE` ; mode = `modePaiement.findFirst({ where: { code: dto.mode ?? 'ESPECES', actif: true } })`, absent : 400 `MODE_PAIEMENT_INCONNU` ; `id = dto.id ?? randomUUID()` ; `create({ id, sessionCaisseId, pointDeVenteId: session.pointDeVenteId, type, modePaiementId, montant, motif, auteurId: user.id, evenementId: id })` | `Prélèvement enregistré.`, `Apport enregistré.` ou `Remboursement enregistré.` ; rejeu : `Ce mouvement était déjà enregistré.` |
| `bilan` | `(structureId, userId, sessionId): Promise<Reponse<BilanSession>>` | `lireSessionPharmacie`, `exigerDroitSurSession`, `calculerBilan(this.prisma, session, structureId)` | `Bilan de la caisse.` |
| `fermer` | `(structureId, userId, sessionId, dto: FermerSessionDto): Promise<Reponse<BilanSession>>` | voir 4.6 | `Caisse fermée.` ou `Cette session était déjà fermée.` |
| `listerDuJour` | `(structureId, userId, query: ListerSessionsQueryDto): Promise<Reponse<SessionReponse[]>>` | `jour = query.jour ?? jourConakry(new Date())`, validité comme `listerVentes` (`new Date(jour + 'T00:00:00.000Z')`, `jourConakry` du résultat égal à `jour`, sinon 400 `VALIDATION` `dateValide`) ; `sessionCaisse.findMany({ where: { technique: false, pointDeVente: { structureId }, jourMetier: new Date(jour + 'T00:00:00.000Z') }, include: includeSession, orderBy: [{ ouverteLe: 'asc' }, { id: 'asc' }] })` | `${n} session(s) le ${jour}.` |

Le motif est rogné par le DTO ; le service relit `dto.motif ?? ''` et teste `length < 3`.

#### 4.6 Fermeture (`fermer`)

1. `verifier` ; `session = lireSessionPharmacie` ; `exigerDroitSurSession(session, userId)`.
2. Transaction : `s = verrouillerSession(tx, sessionId)`.
3. `s.statut !== 'OUVERTE'` : renvoyer `calculerBilan(tx, s, structureId)` (figé), message `Cette session était déjà fermée.` (aucune écriture, corps ignoré).
4. Si `dto.comptageFermeture` : `enregistrerComptage(tx, s, 'FERMETURE', dto.comptageFermeture, user.id)` (règles complètes, y compris 409 `COMPTAGE_DEJA_SAISI` si un comptage de fermeture d'un autre id existe), puis relire `s`.
5. Aucun comptage FERMETURE : 400 `COMPTAGE_FERMETURE_REQUIS`.
6. `bilan = calculerBilan(tx, s, structureId)` (session encore OUVERTE, donc calculé).
7. `commentaire = (dto.commentaire ?? '')` ; si `bilan.commentaireRequis` et `commentaire.length < 3` : 400 `COMMENTAIRE_ECART_REQUIS` (`messageCommentaireRequis(bilan.ecartEspeces as number, bilan.seuilEcartCaisse)`). La levée annule la transaction : le comptage du point 4 n'est pas enregistré.
8. Un seul UPDATE : `tx.sessionCaisse.update({ where: { id }, data: { statut: 'FERMEE', fermeeLe: new Date(), evenementFermetureId: 'fermeture:' + id, commentaireEcart: commentaire.length >= 3 ? commentaire : null, commentaireParId: commentaire.length >= 3 ? user.id : null } })`.
9. `tx.resultatSessionMode.createMany({ data: resultats.map(...) })`, un par mode de `bilan.theorique` (identifiant du mode retrouvé par code).
10. Point de vente : `pointDeVenteId = s.pointDeVenteId`. Anomalies (`tx.anomalie.create`, `attribueeAId: structure.adminId`, `pieceType: 'SessionCaisse'`, `pieceId: id`) :
    - aucun comptage OUVERTURE : `type: 'FOND_NON_COMPTE'`, `details: { posteCode, utilisateurId, utilisateurNom, jourMetier }` ;
    - `bilan.commentaireRequis` : `type: 'ECART_CAISSE'`, `details: { posteCode, utilisateurId, utilisateurNom, jourMetier, theorique, compte, ecart, seuilEcartCaisse }` (valeurs du mode ESPECES). Jamais le commentaire dans `details`.
11. Relire la session et renvoyer `calculerBilan(tx, session, structureId)` (désormais figé), message `Caisse fermée.`.

### 5. Contrôleur (`src/pharmacie/caisse/sessions-caisse.controller.ts`, nouveau)

Modèle : `src/pharmacie/points-de-vente.controller.ts` (`@ApiTags('Pharmacie : caisse')`, `@ApiBearerAuth()`, `@Controller('pharmacie')`, `@UseGuards(AuthGuard, PermissionsGuard)`, `req.user.userId`). Routes, dans cet ordre (la route `courante` AVANT toute route à paramètre `:sessionId` de même profondeur) :

| Méthode | Chemin | Permission | HTTP | Appel |
|---|---|---|---|---|
| POST | `:structureId/caisse/sessions` | `CAISSE_UTILISER` | 200 (`@HttpCode(HttpStatus.OK)`) | `ouvrir(structureId, userId, dto)` |
| GET | `:structureId/caisse/sessions/courante` | `CAISSE_UTILISER` | 200 | `courante(structureId, userId, query.posteId)` (`@Query() query: SessionCouranteQueryDto`) |
| GET | `:structureId/caisse/sessions` | `CAISSE_SUPERVISER` | 200 | `listerDuJour(structureId, userId, query)` |
| POST | `:structureId/caisse/sessions/:sessionId/comptages` | `CAISSE_UTILISER` | 200 | `saisirComptage(...)` |
| POST | `:structureId/caisse/sessions/:sessionId/mouvements` | `CAISSE_UTILISER` | 200 | `enregistrerMouvement(...)` |
| GET | `:structureId/caisse/sessions/:sessionId/bilan` | `CAISSE_UTILISER` | 200 | `bilan(...)` |
| POST | `:structureId/caisse/sessions/:sessionId/fermer` | `CAISSE_UTILISER` | 200 | `fermer(...)` |

Chaque route : `@ApiOperation({ summary })` en français, `@ApiParam` pour `structureId` et `sessionId`, `@ApiResponse` pour les codes 409 et 400 propres à la route.

### 6. Module (`src/pharmacie/pharmacie.module.ts`)

Ajouter `SessionsCaisseController` aux `controllers` et `SessionsCaisseService` aux `providers` (après `MouvementsStockService`). Rien d'autre.

### 7. `GET /postes` (`src/pharmacie/points-de-vente.service.ts`)

Dans `listerPostes` seulement : ajouter à `findMany` `include: { sessionsCaisse: { where: { statut: 'OUVERTE' }, select: { id: true, utilisateurId: true, utilisateurNom: true, ouverteLe: true, jourMetier: true }, take: 1 } }` et renvoyer pour chaque poste `{ ...versPosteReponse(p), sessionOuverte: s ? { id, utilisateurId, utilisateurNom, ouverteLe, jourMetier: jourConakry(s.jourMetier) } : null }`. Exporter `export interface PosteAvecSession extends PosteReponse { sessionOuverte: { id: string; utilisateurId: string | null; utilisateurNom: string; ouverteLe: Date; jourMetier: string } | null }` ; type de retour `Promise<Reponse<PosteAvecSession[]>>`. `versPosteReponse` et les autres méthodes ne changent pas.

### 8. Tests

#### 8.1 `src/pharmacie/caisse/bilan-caisse.spec.ts` (nouveau, `npm test`)

Modes de test : `ESPECES` (actif, physique), `ORANGE_MONEY`, `MTN_MOMO` (actifs), `CHEQUE` (inactif).

1. `CA15 : fond 200 000, ventes 400 000, prélèvement 100 000, compté 490 000 donnent 500 000 et -10 000` : résultat ESPECES `{ theorique: 500000, compte: 490000, ecart: -10000 }` ; ORANGE_MONEY et MTN_MOMO `{ theorique: 0, compte: null, ecart: null }` ; CHEQUE absent ; ordre ESPECES, ORANGE_MONEY, MTN_MOMO.
2. `CA16 : moitié espèces moitié Orange Money, relevé 45 000` : paiements 50000 ESPECES et 50000 ORANGE_MONEY, compté espèces 50000, relevé ORANGE_MONEY 45000 : ESPECES écart 0, ORANGE_MONEY `{ theorique: 50000, compte: 45000, ecart: -5000 }`, MTN_MOMO compte null.
3. `mode inactif affiché seulement s il a un théorique ou un compté` : paiement 10000 CHEQUE : CHEQUE présent avec theorique 10000 ; sans paiement : absent.
4. `sans comptage de fermeture, espèces non rapprochées` : `totalEspecesCompte: null` donne compte et ecart nuls pour ESPECES.
5. `relevé des espèces, mode inconnu ou en double : RangeError`.
6. `commentaireEcartRequis` : (-10000, 5000) vrai ; (5000, 5000) faux ; (-5001, 5000) vrai ; (null, 0) faux ; (1, 0) vrai.
7. `formaterGnf` : -10000 donne `-10 000` ; 490000 donne `490 000` ; 500 donne `500` ; 0 donne `0`.

#### 8.2 `src/pharmacie/caisse/sessions-caisse.http.spec.ts` (nouveau, `npm test`)

Calqué sur `points-de-vente.http.spec.ts` (vrai `PermissionsGuard` et vrai `PermissionsService`, Prisma et Redis simulés, même `ValidationPipe` et `AllExceptionsFilter`, `SessionsCaisseService` simulé, `x-essai-user` = `pharmacien` | `admin` | `hopital` avec les profils du modèle). UUID d'essai : `11111111-1111-4111-8111-111111111111`.

1. `les sept routes répondent 200 et appellent le service avec les bons arguments` (pharmacien pour six routes, admin pour la liste) ; POST rendus en 200, pas 201.
2. `GET /caisse/sessions exige caisse:superviser : pharmacien 403 PERMISSION_REFUSEE`.
3. `hôpital refusé partout (403)` sur POST ouvrir et GET bilan.
4. `validation 400 VALIDATION` : `posteId` absent ou non UUID ; `id` non UUID ; `coupures[0].valeurFaciale` décimal (1.5) ; `coupures[0].nombre` -1 ; `moment` `MILIEU` ; `type` `RETRAIT` ; `montant` 0 ; `releves[0].mode` `orange` ; `jour` `25-10-2026` ; `posteId` absent de `GET courante` ; champ inconnu `pieces: 3` dans le corps de POST `.../comptages` refusé par `forbidNonWhitelisted` (aucune ligne « pièces et autres ») ; service jamais appelé.
5. `motif absent accepté par le DTO (le service répond MOTIF_REQUIS)` : POST mouvement sans motif atteint le service.

#### 8.3 `test/db/sessions-caisse.db-spec.ts` (nouveau, `npm run test:db`)

Mise en place calquée sur `test/db/points-de-vente.db-spec.ts` : base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations restantes, `creerPrismaDeTest`. Services : `acces = new AccesPharmacieService(prisma)`, `permissions = { getUserPermissions: (id) => Promise.resolve(['usr-admin-p1', 'usr-admin-p2'].includes(id) ? ['caisse:utiliser', 'caisse:superviser'] : ['caisse:utiliser']) } as unknown as PermissionsService`, `service = new SessionsCaisseService(prisma, acces, permissions)`, `postes = new PointsDeVenteService(prisma, acces)`. Postes créés par `postes.enregistrerPoste('str-pharma-1', <utilisateur>, { type: 'WEB', appareilId })` (un poste par test qui ouvre une session, `appareilId` distinct de 8 caractères au moins). Fonctions utilitaires du fichier : `refus` (statut et corps), `sql`, `compter`, `venteSql({ id, sessionId, numero, total, typePiece?, origine?, motif? })` (INSERT `Vente` comme `caisse-pieces.db-spec.ts`, `structureId` `str-pharma-1`, `jourMetier` = `jourMetier` de la session, `vendeurId` `usr-pharm-p1`), `paiementSql(id, venteId, sessionId, codeMode, montant)` (INSERT `Paiement`, `modePaiementId` lu par code), `coupures(montants: Record<number, number>)`. Jour attendu : `jourConakry(new Date())`. Tests (noms et assertions) :

1. `ouvrir : session OUVERTE du jour au nom du vendeur, sans fond compté` : `ouverteMaintenant` vrai, `statut` OUVERTE, `utilisateurNom` `Mamadou Diallo`, `jourMetier` = jour attendu, `fondCaisse` 0, `fondCompte` faux, `comptageOuverture` null, `poste.code` commence par `W`, message `Caisse ouverte.` ; en base `evenementOuvertureId` = id.
2. `ouvrir rejoué : même session, aucune ligne ajoutée` : second appel sans id, puis avec l'id de la session, puis avec un autre UUID : même `id`, `ouverteMaintenant` faux, message `Votre caisse était déjà ouverte.`, `count(*)` des sessions OUVERTES du poste = 1.
3. `ouvrir avec un id client et un comptage d ouverture` : id UUID fourni, comptage `{20000: 10}` : session de cet id, `fondCaisse` 200000, `fondCompte` vrai, `comptageOuverture.coupures` = `[{ valeurFaciale: 20000, nombre: 10 }]`.
4. `cinq ouvertures simultanées du même vendeur sur le même poste : une seule session` (`Promise.all`, cinq réponses de même id, une seule ligne OUVERTE).
5. `autre vendeur sur un poste occupé : 409 SESSION_AUTRE_UTILISATEUR qui nomme le collègue` : `usr-admin-p1` sur le poste de `usr-pharm-p1`, message contient `Mamadou Diallo`.
6. `poste technique, d une autre pharmacie, désactivé ou inconnu : 409 POSTE_INCONNU` (poste `REPRISE` de `str-pharma-1` ; poste enregistré par `usr-pharm-p2` dans `str-pharma-2` ; poste désactivé par `UPDATE "Poste" SET "actif" = false` ; UUID inconnu) ; aucune session créée.
7. `id client déjà pris par une autre session : 409 IDENTIFIANT_DEJA_UTILISE`.
8. `courante : session ouverte du poste, null sinon, poste technique refusé` : renvoie la session de `usr-pharm-p1` à `usr-admin-p1` ; `null` et message `Aucune caisse ouverte sur ce poste.` pour un poste sans session ; poste `REPRISE` : 409 `POSTE_INCONNU`.
9. `comptage d ouverture après coup, rejoué, puis refusé une seconde fois` : POST comptage `OUVERTURE` `{20000: 10}` id X : `cree` vrai, `totalEspeces` 200000 ; même id X : `cree` faux ; autre id : 409 `COMPTAGE_DEJA_SAISI` message `Le comptage d'ouverture de cette caisse est déjà enregistré.` ; une seule ligne `ComptageCaisse` OUVERTURE.
10. `coupures : 100 GNF inconnu (correction du porteur), doublon refusé, liste vide acceptée` : `[{ valeurFaciale: 100, nombre: 3 }]` : 400 `VALIDATION`, `champs[0].contraintes` `['coupureConnue']` ; 20000 deux fois : `['coupureUnique']` ; `coupures: []` au moment FERMETURE sur une autre session : `totalEspeces` 0.
11. `relevés : refusés à l ouverture, pour les espèces, en double ; mode inconnu` : contraintes `releveFermetureSeulement`, `releveSansEspeces`, `releveUnique` ; mode `CARTE` : 400 `MODE_PAIEMENT_INCONNU` ; aucun comptage écrit.
12. `mouvement : motif exigé, mode vérifié, attribué, rejouable` : sans motif et motif `ab` : 400 `MOTIF_REQUIS` ; mode `CARTE` : 400 `MODE_PAIEMENT_INCONNU` ; prélèvement 100000 motif `Dépôt à la banque` id Y : `cree` vrai, `mode` ESPECES, `auteurId` `usr-pharm-p1`, message `Prélèvement enregistré.` ; même id Y : `cree` faux, une seule ligne ; id Y sur une autre session : 409 `IDENTIFIANT_DEJA_UTILISE`.
13. `CA15 : fond 200 000, ventes 400 000, prélèvement 100 000, compté 490 000 : théorique 500 000, écart -10 000` : session de `usr-pharm-p1` avec comptage d'ouverture `{20000: 10}` ; deux ventes SQL (150000 et 250000) payées en ESPECES ; prélèvement 100000. Bilan avant fermeture : `Object.keys(bilan)[0]` = `activite` ; `activite` `{ nombreVentes: 2, nombreAnnulations: 0, montantEncaisse: 400000 }`, `parMode` = `[{ mode: 'ESPECES', libelle: 'Espèces', montant: 400000, nombrePaiements: 2 }]` ; `theorique` ESPECES 500000 ; `compte` ESPECES null ; `fige` faux. `fermer` avec `comptageFermeture { coupures: {20000: 24, 10000: 1} }` sans commentaire : 400 `COMMENTAIRE_ECART_REQUIS`, message exact `L'écart d'espèces est de -10 000 GNF, au-delà du seuil de 5 000 GNF : ajoutez un commentaire pour fermer la caisse.` ; ensuite aucun comptage FERMETURE en base et session OUVERTE. `fermer` avec le même comptage et `commentaire: 'Erreur de rendu de monnaie'` : message `Caisse fermée.`, `fige` vrai, ESPECES `theorique` 500000, `compte` 490000, `ecart` -10000, `ecartEspeces` -10000 ; ORANGE_MONEY et MTN_MOMO `compte` null ; en base : session FERMEE, `fermeeLe` non nul, `evenementFermetureId` `fermeture:<id>`, `commentaireEcart` posé, `commentaireParId` `usr-pharm-p1` ; 3 lignes `ResultatSessionMode` (ESPECES 500000, 490000, -10000) ; une anomalie `ECART_CAISSE` OUVERTE, `attribueeAId` `usr-admin-p1`, `pieceType` `SessionCaisse`, `details.ecart` -10000, `details` sans clé `commentaire` ; aucune `FOND_NON_COMPTE` pour cette session.
14. `CA18 : fermeture sans comptage refusée, session restée ouverte` : 400 `COMPTAGE_FERMETURE_REQUIS`, message `Comptez les billets du tiroir avant de fermer la caisse.`.
15. `fermeture sans comptage d ouverture : fond 0 et anomalie FOND_NON_COMPTE, écart sous le seuil sans commentaire` : une vente 30000 ESPECES, comptage de fermeture 30000 (`{20000: 1, 10000: 1}`) : fermeture acceptée sans commentaire, `ecartEspeces` 0, `commentaireEcart` null, une anomalie `FOND_NON_COMPTE` (`details.posteCode` = code du poste), aucune `ECART_CAISSE`.
16. `CA16 : moitié espèces moitié Orange Money, relevé mobile, MTN non rapproché` : vente 100000, paiements 50000 ESPECES et 50000 ORANGE_MONEY, comptage d'ouverture `{}` vide (fond 0, compté), fermeture avec coupures `{20000: 2, 10000: 1}` et `releves: [{ mode: 'ORANGE_MONEY', montant: 45000 }]` : ESPECES écart 0 ; ORANGE_MONEY `{ theorique: 50000, compte: 45000, ecart: -5000 }` ; MTN_MOMO compte null ; aucune anomalie `ECART_CAISSE` (seul l'écart d'espèces compte).
17. `théorique signé : annulation, apport et remboursement mobile` : vente 30000 ESPECES, pièce ANNULATION de cette vente (`origine`, `motif` `Erreur`) avec paiement -30000 ESPECES, apport 20000 ESPECES, remboursement 5000 MTN_MOMO : bilan `nombreVentes` 1, `nombreAnnulations` 1, `montantEncaisse` 0 ; théorique ESPECES 20000 (sans fond), MTN_MOMO -5000.
18. `session fermée : comptage et mouvement refusés, fermeture rejouée, nouvelle ouverture possible` : sur la session de 13 : comptage 409 `SESSION_FERMEE` ; mouvement 409 `SESSION_FERMEE` ; `fermer` de nouveau : 200, message `Cette session était déjà fermée.`, même bilan figé (`ecart` -10000), toujours 3 `ResultatSessionMode` ; `ouvrir` sur le même poste : nouvelle session, `ouverteMaintenant` vrai ; ouvrir avec l'id de la session fermée : 409 `SESSION_FERMEE`.
19. `droits : un vendeur ne voit pas la caisse d un collègue, le responsable la voit et la ferme` : `usr-pharm-p1` sur le bilan d'une session de `usr-admin-p1` : 403 ; `usr-admin-p1` (superviseur) bilan d'une session de `usr-pharm-p1` : 200, puis fermeture avec comptage exact : `commentaireParId` reste nul sans commentaire ; `usr-pharm-p2` (autre pharmacie) : 403 ; session technique de `str-pharma-1` (`technique = true`) : 404 `Cette session de caisse est introuvable.`.
20. `liste du jour et postes : sessions non techniques, session ouverte par poste` : `listerDuJour('str-pharma-1', 'usr-admin-p1', {})` : toutes les sessions créées par ce fichier pour `str-pharma-1`, aucune technique, triées par `ouverteLe` ; `jour: '2026-02-31'` : 400 `VALIDATION` `dateValide` ; `postes.listerPostes` : `sessionOuverte` renseigné (`utilisateurNom`, `jourMetier` AAAA-MM-JJ) pour un poste à session ouverte, `null` pour un poste sans.
21. `aucune clé de coût dans les réponses de caisse` : `cheminsCout` de la réponse d'ouverture, d'un comptage, d'un mouvement, d'un bilan figé et de la liste du jour : `[]`.

Les ventes et paiements de ces tests sont insérés en SQL (la vente recâblée arrive en PB11) ; ne jamais passer par `VenteService`.

### 9. `CLAUDE.md` du dépôt back

Ajouter après le paragraphe « Stock recâblé sur le journal (tranche pharmacie 1, PB08) » un paragraphe « **Sessions de caisse (tranche pharmacie 1, PB10)** » qui résume en une liste compacte : routes et permissions (section 5), idempotence par identifiant client et rejeu en 200, coupures du référentiel uniquement (20 000 à 500 GNF, aucune ligne « pièces et autres »), relevés mobiles à la fermeture seulement, théorique par mode et écart signé jamais corrigé, commentaire au-delà de `seuilEcartCaisse`, `ResultatSessionMode` figé, anomalies `FOND_NON_COMPTE` et `ECART_CAISSE` attribuées au titulaire, les huit codes d'erreur, `sessionOuverte` de `GET /postes`, `ouvrirDansTransaction` réutilisée par la vente (PB11). Aucun tiret cadratin ni demi-cadratin.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Propres à la tâche :
- Liste fermée des fichiers touchés : `src/common/filters/codes-erreur.ts`, `src/pharmacie/caisse/bilan-caisse.ts`, `src/pharmacie/caisse/bilan-caisse.spec.ts`, `src/pharmacie/caisse/sessions-caisse.service.ts`, `src/pharmacie/caisse/sessions-caisse.controller.ts`, `src/pharmacie/caisse/sessions-caisse.http.spec.ts`, `src/pharmacie/dto/sessions-caisse.dto.ts`, `src/pharmacie/pharmacie.module.ts`, `src/pharmacie/points-de-vente.service.ts`, `test/db/sessions-caisse.db-spec.ts`, `CLAUDE.md`. Tout autre fichier : BLOCKED.
- `prisma/`, `test/db/instantanes/`, `src/pharmacie/domaine/`, `vente.service.ts` intouchés. Aucune migration.
- Aucune URL de base, mot de passe ni valeur de `.env` affichée ou écrite (D454).
- Textes de messages exactement ceux de la fiche ; français, aucun tiret cadratin ni demi-cadratin, aucun points de suspension typographiques.
- Aucune clé de réponse contenant « cout » ou « marge » (D466).

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (racine du monorepo) :

1. `docker compose exec -T backend npx tsc --noEmit` : code 0.
2. `docker compose exec -T backend npx eslint --max-warnings 0 src/common/filters/codes-erreur.ts src/pharmacie/caisse/bilan-caisse.ts src/pharmacie/caisse/bilan-caisse.spec.ts src/pharmacie/caisse/sessions-caisse.service.ts src/pharmacie/caisse/sessions-caisse.controller.ts src/pharmacie/caisse/sessions-caisse.http.spec.ts src/pharmacie/dto/sessions-caisse.dto.ts src/pharmacie/pharmacie.module.ts src/pharmacie/points-de-vente.service.ts test/db/sessions-caisse.db-spec.ts` : code 0.
3. `docker compose exec -T backend npm test` : tout vert, suites `bilan-caisse` (7 tests) et `sessions-caisse.http` présentes.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `sessions-caisse.db-spec.ts` (21 tests) et `points-de-vente.db-spec.ts` inchangé et vert ; la base de test se dérive de `DATABASE_URL` du conteneur en changeant seulement le nom de la base (harnais PB01).
5. `git -C back_medconnect status --short prisma test/db/instantanes src/pharmacie/domaine src/pharmacie/vente.service.ts` : vide.
6. Aucune base `mc_test_` restante après les tests (liste des bases du serveur de test, sans afficher d'URL).
7. `git -C back_medconnect diff -U0 | LC_ALL=C.UTF-8 grep -nP '[\x{2013}\x{2014}\x{2026}]'` et la même recherche sur les fichiers non suivis : aucune ligne.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

Fichiers attendus : ceux de la liste fermée des contraintes.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
