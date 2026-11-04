import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { VenteService } from './vente.service';
import {
  AnnulerVenteDto,
  CreerVenteDto,
  ListerVentesQueryDto,
} from './dto/vente.dto';

@ApiTags('Pharmacie : ventes')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class VenteController {
  constructor(private readonly venteService: VenteService) {}

  @Post(':structureId/ventes')
  @RequirePermissions(PERMISSIONS.VENTE_WRITE, PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enregistrer une vente au comptoir',
    description:
      'Permissions : vente:write et caisse:utiliser. Succès : 201. Le serveur vérifie chaque ligne, prend les quantités dans les lots (reliquat puis péremption la plus proche), ouvre la caisse du vendeur si besoin, enregistre les paiements et la vente en une seule opération. Les deux prix (boîte, unité) viennent de la fiche du médicament, jamais du client. Sans paiements, la vente est réglée en espèces. 409 JOURNEE_CLOTUREE si la caisse ouverte du vendeur compte pour une journée clôturée.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Clé unique par panier (8 à 128 caractères parmi lettres, chiffres, . _ : -), par exemple un UUID. Un renvoi avec la même clé renvoie la même vente, sans limite de durée. Clé mal formée : ignorée.',
  })
  @ApiResponse({
    status: 201,
    description:
      "Vente enregistrée (ou rejouée avec rejeu: true), jamais au-delà du stock vendable (sinon 409 STOCK_INSUFFISANT). data : id, numero, statut, createdAt, total, ordonnanceVerifiee, clientNom, clientTelephone, vendeur { id, nom }, annuleeLe, annuleeParId, motifAnnulation, typePiece, numeroTicket, jourMetier, provisoire, poste { id, code }, session { id, ouverteAutomatiquement }, paiements [ { id, mode, libelle, montant, reference, montantRecu, rendu } ], annulation, venteOrigine, motif, lignes [ { id, stockId, medicamentId, nomMedicament, prixUnitaire, quantite, sousTotal, uniteAffichee, nombreAffiche, coefficientApplique, allocations [ ... ] } ], pharmacie { id, nom, adresse, ville, telephone, logoUrl }. Les coûts ne sont renvoyés qu'avec la permission marge:read.",
  })
  @ApiResponse({
    status: 400,
    description:
      'Corps invalide (VALIDATION), vente à l’unité interdite (VENTE_UNITE_INTERDITE), sans prix à l’unité (PRIX_UNITE_MANQUANT), sans prix (PRIX_MANQUANT), ordonnance non confirmée (ORDONNANCE_NON_CONFIRMEE), motif absent (MOTIF_REQUIS), paiements incohérents (PAIEMENTS_INCOHERENTS) ou mode inconnu (MODE_PAIEMENT_INCONNU). Lignes concernées dans details.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Ligne de stock absente de la pharmacie (STOCK_INTROUVABLE, lignes dans details) ou lot introuvable.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Stock insuffisant (STOCK_INSUFFISANT : details [ { stockId, nom, unite, demande, disponible, disponibleUm } ], le stock restant est dans le message), il ne reste que des lots périmés (SORTIE_MANUELLE_REQUISE, lots dans details), lot épuisé (STOCK_LOT_NEGATIF), poste inconnu (POSTE_INCONNU), caisse d’un autre utilisateur (SESSION_AUTRE_UTILISATEUR) ou appareil d’un autre type (POSTE_TYPE_DIFFERENT).',
  })
  creerVente(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerVenteDto,
    @Ip() ip: string,
    @Headers('idempotency-key') enTeteIdempotence?: string,
  ) {
    return this.venteService.creerVente(
      structureId,
      req.user.userId,
      dto,
      enTeteIdempotence,
      ip,
    );
  }

  @Get(':structureId/ventes')
  @RequirePermissions(PERMISSIONS.VENTE_READ)
  @ApiOperation({
    summary: 'Lister les ventes d’un jour',
    description:
      'Permission : vente:read. Succès : 200. Pièces du jour métier (défaut : aujourd’hui), ventes et annulations, avec le total signé des pièces validées et leur nombre.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiResponse({ status: 400, description: 'Date invalide (VALIDATION).' })
  listerVentes(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: ListerVentesQueryDto,
  ) {
    return this.venteService.listerVentes(structureId, req.user.userId, query);
  }

  @Get(':structureId/ventes/:venteId')
  @RequirePermissions(PERMISSIONS.VENTE_READ)
  @ApiOperation({
    summary: 'Détail d’une vente (reçu)',
    description:
      'Permission : vente:read. Succès : 200, même forme que la réponse de création. 404 si la vente est introuvable.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'venteId', description: 'Identifiant de la vente' })
  @ApiResponse({
    status: 200,
    description:
      'Même forme que la création, avec pharmacie { id, nom, adresse, ville, telephone, logoUrl } pour le reçu.',
  })
  @ApiResponse({ status: 404, description: 'Vente introuvable.' })
  detailVente(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('venteId') venteId: string,
  ) {
    return this.venteService.detailVente(structureId, venteId, req.user.userId);
  }

  @Post(':structureId/ventes/:venteId/annuler')
  @RequirePermissions(PERMISSIONS.VENTE_ANNULER, PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annuler une vente',
    description:
      "Permissions : vente:annuler et caisse:utiliser. Succès : 200. Crée une pièce d'annulation qui pointe la vente : lignes, lots et paiements opposés, quantités remises dans les lots d'origine, remboursement enregistré dans la caisse de l'auteur (ouverte automatiquement si besoin) et rattaché au jour de cette caisse. Aucune limite de date. Motif de 3 à 300 caractères (400 VALIDATION). 409 JOURNEE_CLOTUREE si la caisse de l'auteur compte pour une journée clôturée.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'venteId', description: 'Identifiant de la vente' })
  @ApiResponse({
    status: 200,
    description:
      "Vente d'origine, avec statut ANNULEE et annulation { id, numero, motif, le, par { id, nom } }. Les coûts ne sont renvoyés qu'avec la permission marge:read.",
  })
  @ApiResponse({ status: 404, description: 'Vente introuvable.' })
  @ApiResponse({
    status: 409,
    description:
      'Vente déjà annulée (VENTE_DEJA_ANNULEE), pièce non annulable : annulation, régularisation ou vente d’avant la caisse (PIECE_NON_ANNULABLE), poste inconnu ou d’un autre point de vente (POSTE_INCONNU), caisse d’un autre utilisateur (SESSION_AUTRE_UTILISATEUR).',
  })
  annulerVente(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('venteId') venteId: string,
    @Body() dto: AnnulerVenteDto,
    @Ip() ip: string,
  ) {
    return this.venteService.annulerVente(
      structureId,
      venteId,
      req.user.userId,
      dto,
      ip,
    );
  }
}
