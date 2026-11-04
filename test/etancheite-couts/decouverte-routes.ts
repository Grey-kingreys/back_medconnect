import { RequestMethod, type Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from 'src/common/rbac/require-permissions.decorator';

export interface RouteDecouverte {
  /** 'GET /pharmacie/:structureId/ventes' */
  cle: string;
  methode: string;
  chemin: string;
  controleur: Type;
  handler: string;
  /** Permissions de @RequirePermissions sur la méthode (tableau vide sinon). */
  permissions: string[];
  /** Gardes de @UseGuards, méthode puis classe. */
  gardes: unknown[];
}

type Meta = unknown;

function lire<T>(cle: string, cible: object): T | undefined {
  return Reflect.getMetadata(cle, cible) as T | undefined;
}

/**
 * Contrôleurs de tout le graphe d'imports d'un module, sans doublon, dans l'ordre de parcours.
 * Un import qui est une promesse (ex. `ConfigModule.forRoot`) est attendu, puis son module
 * résolu est parcouru comme tout autre import (D611) : aucune route n'est oubliée.
 */
export async function controleursDuModule(racine: unknown): Promise<Type[]> {
  const visites = new Set<unknown>();
  const controleurs: Type[] = [];

  const ajouter = (liste: Meta[] | undefined) => {
    for (const c of liste ?? []) {
      if (!controleurs.includes(c as Type)) controleurs.push(c as Type);
    }
  };

  const parcourir = async (element: unknown): Promise<void> => {
    if (element instanceof Promise) {
      await parcourir(await element);
      return;
    }
    if (typeof element === 'function') {
      if (visites.has(element)) return;
      visites.add(element);
      ajouter(lire<Meta[]>('controllers', element));
      for (const sous of lire<unknown[]>('imports', element) ?? []) {
        await parcourir(sous);
      }
      return;
    }
    if (typeof element === 'object' && element !== null) {
      const objet = element as Record<string, unknown>;
      if (typeof objet.forwardRef === 'function') {
        await parcourir((objet.forwardRef as () => unknown)());
        return;
      }
      if (typeof objet.module === 'function') {
        const module = objet.module;
        // Un module dynamique peut être importé plusieurs fois avec des champs différents.
        ajouter(lire<Meta[]>('controllers', module));
        ajouter(objet.controllers as Meta[] | undefined);
        const dejaVisite = visites.has(module);
        visites.add(module);
        if (!dejaVisite) {
          for (const sous of lire<unknown[]>('imports', module) ?? []) {
            await parcourir(sous);
          }
        }
        for (const sous of (objet.imports as unknown[] | undefined) ?? []) {
          await parcourir(sous);
        }
        return;
      }
    }
    throw new Error(`Import de module non reconnu : ${String(element)}`);
  };

  await parcourir(racine);
  return controleurs;
}

function enTableau(valeur: unknown): string[] {
  if (valeur === undefined) return [''];
  return Array.isArray(valeur) ? (valeur as string[]) : [valeur as string];
}

function assembler(classe: string, methode: string): string {
  const brut =
    '/' + [classe, methode === '/' ? '' : methode].filter(Boolean).join('/');
  const reduit = brut.replace(/\/{2,}/g, '/');
  return reduit.length > 1 ? reduit.replace(/\/$/, '') : reduit;
}

/** Routes HTTP de ces contrôleurs, triées par clé. */
export function routesDesControleurs(controleurs: Type[]): RouteDecouverte[] {
  const routes: RouteDecouverte[] = [];
  for (const controleur of controleurs) {
    const cheminsClasse = enTableau(
      Reflect.getMetadata(PATH_METADATA, controleur),
    ).map((c) => (c === '/' ? '' : c));
    const gardesClasse = lire<unknown[]>(GUARDS_METADATA, controleur) ?? [];
    for (const nom of Object.getOwnPropertyNames(controleur.prototype)) {
      if (nom === 'constructor') continue;
      const fonction = (controleur.prototype as Record<string, unknown>)[
        nom
      ] as object;
      if (typeof fonction !== 'function') continue;
      if (Reflect.getMetadata(PATH_METADATA, fonction) === undefined) continue;
      const cheminsMethode = enTableau(
        Reflect.getMetadata(PATH_METADATA, fonction),
      );
      const methode =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, fonction) as number];
      const permissions = lire<string[]>(PERMISSIONS_KEY, fonction) ?? [];
      const gardes = [
        ...(lire<unknown[]>(GUARDS_METADATA, fonction) ?? []),
        ...gardesClasse,
      ];
      for (const cc of cheminsClasse) {
        for (const cm of cheminsMethode) {
          const chemin = assembler(cc, cm);
          routes.push({
            cle: `${methode} ${chemin}`,
            methode,
            chemin,
            controleur,
            handler: nom,
            permissions,
            gardes,
          });
        }
      }
    }
  }
  return routes.sort((a, b) => a.cle.localeCompare(b.cle));
}
