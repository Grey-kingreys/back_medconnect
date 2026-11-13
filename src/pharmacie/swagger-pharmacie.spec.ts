import type { Type } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PharmacieModule } from 'src/pharmacie/pharmacie.module';
import {
  controleursDuModule,
  routesDesControleurs,
  type RouteDecouverte,
} from 'test/etancheite-couts/decouverte-routes';
import { ROUTES_PHARMACIE } from 'test/etancheite-couts/routes-pharmacie';

/**
 * Swagger des routes /pharmacie (D678) : les descriptions citent la permission
 * exigée, les routes gardées déclarent l'authentification Bearer, chaque contrôleur
 * porte un tag.
 */
const estPharmacie = (r: { chemin: string }) =>
  r.chemin === '/pharmacie' || r.chemin.startsWith('/pharmacie/');

interface Operation {
  summary?: string;
  description?: string;
}

function operationDe(route: RouteDecouverte): Operation | undefined {
  const methode = (route.controleur.prototype as Record<string, object>)[
    route.handler
  ];
  return Reflect.getMetadata(DECORATORS.API_OPERATION, methode) as
    | Operation
    | undefined;
}

describe('Swagger des routes /pharmacie', () => {
  let controleurs: Type[] = [];
  let routes: RouteDecouverte[] = [];

  beforeAll(async () => {
    controleurs = await controleursDuModule(PharmacieModule);
    routes = routesDesControleurs(controleurs).filter(estPharmacie);
  });

  it('64 routes /pharmacie découvertes, celles de l’inventaire', () => {
    const cles = routes.map((r) => r.cle).sort();
    expect(cles).toEqual(Object.keys(ROUTES_PHARMACIE).sort());
    expect(cles).toHaveLength(64);
  });

  it('chaque route a un résumé et une description', () => {
    const sansTexte = routes
      .filter((r) => {
        const op = operationDe(r);
        return !op?.summary?.trim() || !op.description?.trim();
      })
      .map((r) => r.cle);
    expect(sansTexte).toEqual([]);
  });

  it('la description cite chaque permission exigée', () => {
    const manquantes: string[] = [];
    for (const r of routes) {
      const description = operationDe(r)?.description ?? '';
      for (const permission of r.permissions) {
        if (!description.includes(permission)) {
          manquantes.push(`${r.cle} : ${permission}`);
        }
      }
    }
    expect(manquantes).toEqual([]);
  });

  it('toute route gardée déclare l’authentification Bearer', () => {
    const sansBearer = routes
      .filter((r) => r.gardes.includes(AuthGuard))
      .filter((r) => {
        const surMethode = Reflect.getMetadata(
          DECORATORS.API_SECURITY,
          (r.controleur.prototype as Record<string, object>)[r.handler],
        ) as unknown;
        const surClasse = Reflect.getMetadata(
          DECORATORS.API_SECURITY,
          r.controleur,
        ) as unknown;
        return !surMethode && !surClasse;
      })
      .map((r) => r.cle);
    expect(sansBearer).toEqual([]);
  });

  it('chaque contrôleur a un tag', () => {
    const controleursDesRoutes = [...new Set(routes.map((r) => r.controleur))];
    const sansTag = controleursDesRoutes
      .filter((c) => {
        const tags = Reflect.getMetadata(DECORATORS.API_TAGS, c) as
          | string[]
          | undefined;
        return !tags || tags.length === 0;
      })
      .map((c) => c.name);
    expect(sansTag).toEqual([]);
  });
});
