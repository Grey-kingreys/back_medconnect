/**
 * Compare, en lecture seule, le compteur gelé des fiches et le stock calculé par le journal :
 * reprise, agrégat et activité depuis la reprise.
 *
 * Usage (dev) : docker compose exec -T backend npm run stock:comparer-compteur
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/stock-comparer-compteur.js
 * Lit DATABASE_URL.
 */
import { Client } from 'pg';
import {
  comparerCompteur,
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
    const rapport = await comparerCompteur(client);
    console.log(
      'Comparaison du compteur gelé et du stock calculé (lecture seule, aucune donnée modifiée)',
    );
    console.log(`Fiches : ${rapport.fiches}`);
    console.log(
      `1. Compteur gelé différent de la reprise (doit être 0) : ${rapport.ecartsReprise.nombre}`,
    );
    afficher(
      rapport.ecartsReprise,
      (e) =>
        `${e.stockMedicamentId} | compteur ${e.compteur} | reprise ${e.reprise}`,
    );
    console.log(
      `2. Agrégat différent du journal (doit être 0) : ${rapport.ecartsAgregat.nombre}`,
    );
    afficher(
      rapport.ecartsAgregat,
      (e) =>
        `${e.stockMedicamentId} | agrégat ${e.agregat} | journal ${e.recalcul}`,
    );
    console.log(
      `3. Fiches dont le stock a bougé depuis la reprise (information) : ${rapport.fichesEnEcartActivite}`,
    );
    console.log('Mouvements depuis la reprise, par type de pièce :');
    if (rapport.activite.length === 0) {
      console.log('  - aucun');
    }
    for (const a of rapport.activite) {
      console.log(
        `  - ${a.typePiece} : ${a.mouvements} mouvement(s), ${a.quantite}`,
      );
    }
    if (
      rapport.ecartsReprise.nombre === 0 &&
      rapport.ecartsAgregat.nombre === 0
    ) {
      console.log('Résultat : reprise et agrégats cohérents.');
    } else {
      console.log(
        'Résultat : écart à analyser avant toute suppression de la colonne quantite.',
      );
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(
    'Échec de la comparaison :',
    erreur instanceof Error ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
