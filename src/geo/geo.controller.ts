import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { GeoService } from './geo.service';

@ApiTags('Géolocalisation')
@Controller('geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) { }

  @Get('structures')
  @ApiOperation({
    summary: 'Rechercher des structures de santé',
    description:
      'Trouve les hôpitaux, cliniques et pharmacies. Passe lat/lng pour trier par distance.',
  })
  @ApiQuery({ name: 'type', required: false, description: 'HOPITAL | CLINIQUE | PHARMACIE' })
  @ApiQuery({ name: 'ville', required: false, description: 'Ville (ex: Conakry)' })
  @ApiQuery({ name: 'estDeGarde', required: false, type: Boolean })
  @ApiQuery({ name: 'lat', required: false, type: Number, description: 'Latitude GPS' })
  @ApiQuery({ name: 'lng', required: false, type: Number, description: 'Longitude GPS' })
  @ApiQuery({ name: 'rayon', required: false, type: Number, description: 'Rayon en km (défaut: 50)' })
  rechercherStructures(
    @Query('type') type?: string,
    @Query('ville') ville?: string,
    @Query('estDeGarde') estDeGarde?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('rayon') rayon?: string,
  ) {
    return this.geoService.rechercherStructures({
      type,
      ville,
      estDeGarde: estDeGarde !== undefined ? estDeGarde === 'true' : undefined,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      rayon: rayon ? parseInt(rayon) : undefined,
    });
  }

  @Get('structures/garde')
  @ApiOperation({
    summary: 'Structures de garde',
    description: 'Retourne toutes les structures actuellement en garde.',
  })
  @ApiQuery({ name: 'ville', required: false })
  getStructuresDeGarde(@Query('ville') ville?: string) {
    return this.geoService.getStructuresDeGarde(ville);
  }

  @Get('structures/:structureId')
  @ApiParam({ name: 'structureId' })
  @ApiOperation({ summary: 'Fiche publique d\'une structure' })
  getStructure(@Param('structureId') structureId: string) {
    return this.geoService.getStructurePublique(structureId);
  }
}