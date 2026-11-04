/**
 * Contrôle, en lecture seule, que la base peut recevoir la tranche pharmacie 1 : quantités
 * négatives, structures non pharmacies porteuses de stock ou de ventes, fiches avec du stock sans
 * point de vente. À lancer AVANT le déploiement.
 *
 * Usage (dev) : docker compose exec -T backend npm run pharmacie:pre-migration
 * Usage (production) :
 *   docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/pharmacie-pre-migration.js
 * Lit DATABASE_URL.
 */
import { Client } from 'pg';
import {
  analyserPreMigration,
  type Echantillon,
} from '../src/pharmacie/stock/commandes-stock';

function afficher(ecart: Echantillon<string>): void {
  for (const exemple of ecart.exemples) {
    console.log(`  - ${exemple}`);
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
    const rapport = await analyserPreMigration(client);
    console.log(
      'Contrôle avant migration de la tranche pharmacie 1 (lecture seule, aucune donnée modifiée)',
    );
    console.log(`Pharmacies : ${rapport.pharmacies}`);
    console.log(
      `Fiches de stock : ${rapport.fiches} (${rapport.fichesAvecStock} avec du stock, ${rapport.fichesVides} vides)`,
    );
    console.log(
      rapport.ventes === null
        ? 'Ventes : table absente'
        : `Ventes : ${rapport.ventes}`,
    );
    console.log(
      `Fiches sans prix ou à prix nul (information) : ${rapport.fichesPrixManquant}`,
    );
    console.log(
      `Fiches à date de péremption passée (information) : ${rapport.fichesPerimees}`,
    );
    console.log(
      `Fiches sans date de péremption (information) : ${rapport.fichesSansDate}`,
    );
    console.log(
      rapport.journalEnPlace
        ? 'Journal de stock : déjà en place (M4 appliquée)'
        : 'Journal de stock : pas encore créé (M4)',
    );
    console.log(
      `Bloquant pour M4, fiches à quantité négative : ${rapport.fichesNegatives.nombre}`,
    );
    afficher(rapport.fichesNegatives);
    console.log(
      `Bloquant pour M2, structures non pharmacies porteuses de stock ou de ventes : ${rapport.structuresNonPharmacie.nombre}`,
    );
    afficher(rapport.structuresNonPharmacie);
    if (rapport.fichesSansPointDeVente === null) {
      console.log('Points de vente : pas encore créés (créés par M2)');
    } else {
      console.log(
        `Bloquant pour M4, fiches avec du stock sans point de vente : ${rapport.fichesSansPointDeVente.nombre}`,
      );
      afficher(rapport.fichesSansPointDeVente);
    }
    if (rapport.bloquant) {
      console.log(
        "Résultat : migration impossible en l'état, corriger les points bloquants ci-dessus.",
      );
      process.exitCode = 1;
    } else {
      console.log('Résultat : migration possible.');
    }
  } finally {
    await client.end();
  }
}

principal().catch((erreur: unknown) => {
  console.error(
    'Échec du contrôle avant migration :',
    erreur instanceof Error ? erreur.message : erreur,
  );
  process.exitCode = 1;
});
