/**
 * Vérifie, en lecture seule, la cohérence du journal de stock : agrégats contre mouvements,
 * lots au solde négatif, conditionnements ouverts contre reliquat, plages de tickets superposées.
 *
 * Usage (dev) : docker compose exec -T backend npm run stock:verifier
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/stock-verifier.js
 * Lit DATABASE_URL.
 */
import { Client } from 'pg';
import {
  verifierStock,
  type Echantillon,
} from '../src/pharmacie/stock/commandes-stock';

function afficher<T>(
  ecart: Echantillon<T>,
  formater: (exemple: T) => string,
): void {
  for (const exemple of ecart.exemples) {
    console.log(`  - ${formater(exemple)}`);
  }
  if (ecart.nombre > ecart.exemples.length) {
    console.log(`  et ${ecart.nombre - ecart.exemples.length} autre(s)`);
  }
}

function valeur(nombre: number | null): string {
  return nombre === null ? 'absent' : String(nombre);
}

async function principal(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL n'est pas définie.");
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const rapport = await verifierStock(client);
    console.log(
      'Vérification du stock (lecture seule, aucune donnée modifiée)',
    );
    console.log(
      `Agrégats produit différents du journal : ${rapport.agregatsProduit.nombre}`,
    );
    afficher(
      rapport.agregatsProduit,
      (e) =>
        `${e.stockMedicamentId} | point de vente ${e.pointDeVenteId} | agrégat ${valeur(e.agregat)} | journal ${valeur(e.recalcul)}`,
    );
    console.log(
      `Agrégats lot différents du journal : ${rapport.agregatsLot.nombre}`,
    );
    afficher(
      rapport.agregatsLot,
      (e) =>
        `${e.lotId} | agrégat ${valeur(e.agregat)} | journal ${valeur(e.recalcul)}`,
    );
    console.log(`Lots au solde négatif : ${rapport.lotsNegatifs.nombre}`);
    afficher(rapport.lotsNegatifs, (e) => `${e.lotId} | solde ${e.solde}`);
    console.log(
      `Conditionnements ouverts incohérents avec le reliquat : ${rapport.conditionnements.nombre}`,
    );
    afficher(
      rapport.conditionnements,
      (e) => `${e.lotId} | reliquat ${e.reliquat} | ouverts ${e.ouverts}`,
    );
    console.log(
      `Plages de tickets superposées : ${rapport.plagesSuperposees.nombre}`,
    );
    afficher(
      rapport.plagesSuperposees,
      (e) => `point de vente ${e.pointDeVenteId} | ${e.plageA} et ${e.plageB}`,
    );
    if (rapport.totalAnomalies === 0) {
      console.log('Résultat : aucune anomalie.');
    } else {
      console.log(
        `Résultat : ${rapport.totalAnomalies} anomalie(s). Agrégats et conditionnements : lancer stock:reconstruire ; lots négatifs et plages : analyse requise.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(
    'Échec de la vérification du stock :',
    erreur instanceof Error ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
