import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Controller,
  forwardRef,
  Get,
  Module,
  Patch,
  Post,
  type Type,
} from '@nestjs/common';
import { AppModule } from 'src/app.module';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PharmacieModule } from 'src/pharmacie/pharmacie.module';
import {
  controleursDuModule,
  routesDesControleurs,
  type RouteDecouverte,
} from 'test/etancheite-couts/decouverte-routes';
import { ROUTES_PHARMACIE } from 'test/etancheite-couts/routes-pharmacie';

/**
 * Étanchéité des coûts (CA22, D606 à D609) : l'inventaire des routes /pharmacie
 * doit être celui des routes réellement exposées par la métadonnée Nest.
 */
const inventaire: Record<
  string,
  { classe: string; porteCout: boolean; exigeMarge: boolean }
> = ROUTES_PHARMACIE;

const estPharmacie = (r: { chemin: string }) =>
  r.chemin === '/pharmacie' || r.chemin.startsWith('/pharmacie/');

describe('Étanchéité des coûts : inventaire des routes /pharmacie', () => {
  // Découverte asynchrone : les imports en promesse (ConfigModule.forRoot) sont suivis (D611).
  let routesApp: RouteDecouverte[] = [];
  beforeAll(async () => {
    routesApp = routesDesControleurs(
      await controleursDuModule(AppModule),
    ).filter(estPharmacie);
    expect(routesApp.length).toBeGreaterThan(0);
  });

  it('toutes les routes /pharmacie exposées sont inventoriées, et seulement elles', () => {
    const cles = routesApp.map((r) => r.cle);
    const manquantes = cles.filter((c) => !(c in inventaire));
    const enTrop = Object.keys(inventaire).filter((c) => !cles.includes(c));
    expect(manquantes).toEqual([]);
    expect(enTrop).toEqual([]);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('les routes /pharmacie viennent toutes de PharmacieModule', async () => {
    // PharmacieModule importe AuthModule : on ne compare que les routes /pharmacie.
    const clesModule = routesDesControleurs(
      await controleursDuModule(PharmacieModule),
    )
      .filter(estPharmacie)
      .map((r) => r.cle);
    expect(clesModule).toEqual(routesApp.map((r) => r.cle));
  });

  it('exigeMarge suit exactement RequirePermissions', () => {
    for (const route of routesApp) {
      expect({
        cle: route.cle,
        exigeMarge: route.permissions.includes(PERMISSIONS.MARGE_READ),
      }).toEqual({
        cle: route.cle,
        exigeMarge: inventaire[route.cle].exigeMarge,
      });
    }
  });

  it('PUBLIQUE exactement pour les routes sans AuthGuard', () => {
    for (const route of routesApp) {
      expect({
        cle: route.cle,
        publique: !route.gardes.includes(AuthGuard),
      }).toEqual({
        cle: route.cle,
        publique: inventaire[route.cle].classe === 'PUBLIQUE',
      });
    }
  });

  it('hors src/pharmacie, aucun fichier ne lit un coût', () => {
    const motif =
      /\b(lotStock|allocationLot|LotStock|AllocationLot)\b|cout(Unitaire|AchatBoite)|debutFiabiliteMarge/;
    const racine = path.resolve(__dirname, '..', '..');
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
        const complet = path.join(dossier, entree.name);
        if (entree.isDirectory()) {
          parcourir(complet);
        } else if (
          entree.name.endsWith('.ts') &&
          !entree.name.endsWith('.spec.ts')
        ) {
          const relatif = path
            .relative(racine, complet)
            .split(path.sep)
            .join('/');
          if (relatif.startsWith('src/pharmacie/')) continue;
          if (motif.test(fs.readFileSync(complet, 'utf8'))) {
            fichiers.push(relatif);
          }
        }
      }
    };
    parcourir(path.join(racine, 'src'));
    expect(fichiers.sort()).toEqual([]);
  });

  it('découverte : chemins, tableaux, méthode racine et imports en promesse', async () => {
    @Controller('essai')
    class Essai {
      @Get() a() {}
      @Post(['x', 'y/:id']) b() {}
      @Patch('/z/') c() {}
    }
    @Controller()
    class Racine {
      @Get('sante') d() {}
    }
    @Module({})
    class ModuleDyn {}
    @Module({ controllers: [Essai] })
    class ModuleB {}
    @Module({
      imports: [
        { module: ModuleDyn, controllers: [Racine] },
        forwardRef(() => ModuleB),
      ],
      controllers: [Essai],
    })
    class ModuleFactice {}
    // Une promesse de module dynamique est attendue puis parcourue (D611).
    @Module({
      imports: [Promise.resolve({ module: ModuleDyn, controllers: [Racine] })],
    })
    class ModuleAsynchrone {}
    // Une forme vraiment non reconnue lève toujours une erreur.
    @Module({ imports: [42 as unknown as Type] })
    class ModuleNombre {}
    @Module({ imports: [null as unknown as Type] })
    class ModuleNul {}

    expect(routesDesControleurs([Essai, Racine]).map((r) => r.cle)).toEqual([
      'GET /essai',
      'GET /sante',
      'PATCH /essai/z',
      'POST /essai/x',
      'POST /essai/y/:id',
    ]);
    const controleurs = await controleursDuModule(ModuleFactice);
    expect(controleurs.filter((c) => c === Essai)).toHaveLength(1);
    expect(controleurs.filter((c) => c === Racine)).toHaveLength(1);
    expect(controleurs).toHaveLength(2);
    expect(await controleursDuModule(ModuleAsynchrone)).toEqual([Racine]);
    await expect(controleursDuModule(ModuleNombre)).rejects.toThrow(
      'Import de module non reconnu : 42',
    );
    await expect(controleursDuModule(ModuleNul)).rejects.toThrow(
      'Import de module non reconnu : null',
    );
  });
});
