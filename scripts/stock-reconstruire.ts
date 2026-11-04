/**
 * Reconstruit les agrégats de stock (par lot et par produit) depuis le journal des mouvements
 * et réaligne les conditionnements ouverts, dans une transaction sous verrou.
 *
 * Usage (dev) : docker compose exec -T backend npm run stock:reconstruire
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/stock-reconstruire.js
 * Lit DATABASE_URL.
 */
import { Client } from 'pg';
import { reconstruireStock } from '../src/pharmacie/stock/commandes-stock';

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
    const bilan = await reconstruireStock(client);
    console.log('Reconstruction des agrégats de stock depuis le journal');
    console.log(`Agrégats produit recalculés : ${bilan.agregatsProduit}`);
    console.log(`Agrégats lot recalculés : ${bilan.agregatsLot}`);
    console.log(`Conditionnements fermés : ${bilan.conditionnementsFermes}`);
    console.log(`Conditionnements ouverts : ${bilan.conditionnementsOuverts}`);
    console.log('Résultat : agrégats reconstruits.');
  } finally {
    await client.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(
    "Échec de la reconstruction (rien n'a été modifié) :",
    erreur instanceof Error ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
