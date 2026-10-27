import { Module } from '@nestjs/common';
import { PharmacieService } from './pharmacie.service';
import { CatalogueImportService } from './catalogue-import.service';
import { PharmacieController } from './pharmacie.controller';
import { VenteController } from './vente.controller';
import { VenteService } from './vente.service';
import { AccesPharmacieService } from './acces-pharmacie.service';
import { PointsDeVenteController } from './points-de-vente.controller';
import { PointsDeVenteService } from './points-de-vente.service';
import { FicheProduitController } from './fiche-produit.controller';
import { FicheProduitService } from './fiche-produit.service';
import { MouvementsStockService } from './stock/mouvements-stock.service';
import { SessionsCaisseController } from './caisse/sessions-caisse.controller';
import { SessionsCaisseService } from './caisse/sessions-caisse.service';
import { ReceptionsController } from './receptions/receptions.controller';
import { ReceptionsService } from './receptions/receptions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthModule } from 'src/auth/auth.module';

import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [
    PharmacieController,
    VenteController,
    PointsDeVenteController,
    FicheProduitController,
    SessionsCaisseController,
    ReceptionsController,
  ],
  providers: [
    PharmacieService,
    CatalogueImportService,
    VenteService,
    AccesPharmacieService,
    PointsDeVenteService,
    FicheProduitService,
    MouvementsStockService,
    SessionsCaisseService,
    ReceptionsService,
    PrismaService,
  ],
})
export class PharmacieModule {}
