import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { CreditService } from './credit.service';
import {
  CreerClientCreditDto,
  EnregistrerRemboursementDto,
  ListerClientsCreditQueryDto,
  ModifierClientCreditDto,
  ModifierDateLimiteDto,
} from '../dto/credit.dto';

@ApiTags('Pharmacie : cahier de crédit')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class CreditController {
  constructor(private readonly credit: CreditService) {}

  @Get(':structureId/credits')
  @RequirePermissions(PERMISSIONS.CREDIT_READ)
  @ApiOperation({
    summary: 'Liste des clients de crédit',
    description:
      'Permission : credit:read. Succès : 200. data : clients [ { id, nomComplet, telephone, resteAPayer, statut (EN_COURS, EN_RETARD, SOLDE), dernierePrise, resume, dateLimite, nombrePrises } ], total, page, parPage, totalPages, resteTotal. Recherche q (nom, téléphone), filtre statut. Tri : en retard, en cours, soldés. Aucun coût d’achat.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  lister(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: ListerClientsCreditQueryDto,
  ) {
    return this.credit.lister(structureId, req.user.userId, query);
  }

  @Post(':structureId/credits/clients')
  @RequirePermissions(PERMISSIONS.CREDIT_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Créer un client de crédit',
    description:
      'Permission : credit:write. Succès : 201, fiche du client. Nom complet obligatoire, téléphone et note facultatifs. Journalisé.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  creerClient(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerClientCreditDto,
    @Ip() ip: string,
  ) {
    return this.credit.creerClient(structureId, req.user.userId, dto, ip);
  }

  @Get(':structureId/credits/clients/:clientId')
  @RequirePermissions(PERMISSIONS.CREDIT_READ)
  @ApiOperation({
    summary: "Fiche d'un client de crédit",
    description:
      'Permission : credit:read. Succès : 200. data : infos, resteAPayer, totalPris, totalRembourse, statut, dateLimite, prises (ventes à crédit avec lignes, montant, date, date limite, annulée ou non), remboursements. 404 CLIENT_CREDIT_INTROUVABLE.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'clientId', description: 'Identifiant du client' })
  @ApiResponse({ status: 404, description: 'Client introuvable.' })
  detail(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('clientId') clientId: string,
  ) {
    return this.credit.detail(structureId, req.user.userId, clientId);
  }

  @Patch(':structureId/credits/clients/:clientId')
  @RequirePermissions(PERMISSIONS.CREDIT_WRITE)
  @ApiOperation({
    summary: 'Modifier un client de crédit',
    description:
      'Permission : credit:write. Succès : 200, fiche du client. Nom, téléphone, note (null efface le téléphone ou la note). Journalisé (champs modifiés).',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'clientId', description: 'Identifiant du client' })
  modifierClient(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('clientId') clientId: string,
    @Body() dto: ModifierClientCreditDto,
    @Ip() ip: string,
  ) {
    return this.credit.modifierClient(
      structureId,
      req.user.userId,
      clientId,
      dto,
      ip,
    );
  }

  @Patch(':structureId/credits/prises/:venteId/date-limite')
  @RequirePermissions(PERMISSIONS.CREDIT_WRITE)
  @ApiOperation({
    summary: "Modifier la date limite d'une prise à crédit",
    description:
      'Permission : credit:write. Succès : 200, fiche du client. dateLimite AAAA-MM-JJ (aujourd’hui ou plus tard) ou null pour la retirer. 404 PRISE_INTROUVABLE, 409 PRISE_ANNULEE, 409 PRISE_SOLDEE, 400 DATE_LIMITE_PASSEE. Journalisé.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({
    name: 'venteId',
    description: 'Identifiant de la vente à crédit',
  })
  modifierDateLimite(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('venteId') venteId: string,
    @Body() dto: ModifierDateLimiteDto,
    @Ip() ip: string,
  ) {
    return this.credit.modifierDateLimite(
      structureId,
      req.user.userId,
      venteId,
      dto,
      ip,
    );
  }

  @Post(':structureId/credits/clients/:clientId/remboursements')
  @RequirePermissions(PERMISSIONS.CREDIT_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enregistrer un remboursement',
    description:
      'Permission : credit:write. Succès : 201. Montant entier en GNF, au plus le reste à payer (400 MONTANT_SUPERIEUR_AU_RESTE, 409 CREDIT_DEJA_SOLDE). verseEnCaisse (défaut false) : entrée d’espèces dans la caisse ouverte de l’auteur (409 CAISSE_NON_OUVERTE, 409 JOURNEE_CLOTUREE). data : remboursement, resteAPayer, statut. Journalisé.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'clientId', description: 'Identifiant du client' })
  enregistrerRemboursement(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('clientId') clientId: string,
    @Body() dto: EnregistrerRemboursementDto,
    @Ip() ip: string,
  ) {
    return this.credit.enregistrerRemboursement(
      structureId,
      req.user.userId,
      clientId,
      dto,
      ip,
    );
  }
}
