import type { Prisma } from 'generated/prisma/client';

const ANCIEN_MESSAGE = /Le stock de ce médicament est à (-\d+) unité\(s\) :/;

/** Nombre écrêté à zéro (D713 : une quantité n'est jamais affichée négative). */
function ecreter(valeur: unknown): unknown {
  return typeof valeur === 'number' && valeur < 0 ? 0 : valeur;
}

/**
 * Détails d'une anomalie tels que la lecture les expose (D720). Le stockage garde la
 * vérité : rien n'est réécrit en base. `soldeProduit` et `lignes[].quantiteTheorique`
 * négatifs sont écrêtés à 0 ; un ancien message « est à -N unité(s) : » prend la forme
 * du message actuel. Un détail positif, ou d'un autre type sans quantité, est rendu tel
 * quel.
 */
export function detailsLisibles(
  type: string,
  details: Prisma.JsonValue,
): Prisma.JsonValue {
  if (
    details === null ||
    typeof details !== 'object' ||
    Array.isArray(details)
  ) {
    return details;
  }
  const source = details as Record<string, Prisma.JsonValue>;
  const copie: Record<string, Prisma.JsonValue> = { ...source };

  if (type === 'STOCK_NEGATIF') {
    if ('soldeProduit' in copie) {
      copie.soldeProduit = ecreter(copie.soldeProduit) as Prisma.JsonValue;
    }
    if (typeof copie.message === 'string') {
      copie.message = copie.message.replace(
        ANCIEN_MESSAGE,
        'Le stock de ce médicament affiche 0 unité(s) et cette vente reste à régulariser :',
      );
    }
  }
  if (Array.isArray(copie.lignes)) {
    copie.lignes = copie.lignes.map((l) =>
      l !== null && typeof l === 'object' && !Array.isArray(l)
        ? {
            ...l,
            ...('quantiteTheorique' in l
              ? {
                  quantiteTheorique: ecreter(
                    l.quantiteTheorique,
                  ) as Prisma.JsonValue,
                }
              : {}),
          }
        : l,
    );
  }
  return copie;
}
