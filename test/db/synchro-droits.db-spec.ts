import { randomUUID } from 'node:crypto';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import {
  MESSAGES_REJET,
  PERMISSIONS_PAR_TYPE,
} from 'src/pharmacie/synchro/rejeu-regles';
import {
  SynchroService,
  type ReponseSynchro,
} from 'src/pharmacie/synchro/synchro.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import { chargerFormatActuel } from './fixtures/format-actuel';

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const ip = '127.0.0.1';

describe('Synchro desktop : droits au rejeu par type d événement (A3), sur base de test', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let D: string;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          id === RESPONSABLE
            ? ['caisse:utiliser', 'caisse:superviser', 'stock:write']
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    const postes = new PointsDeVenteService(prisma, acces);
    synchro = new SynchroService(
      prisma,
      acces,
      mouvements,
      sessions,
      permissions,
    );
    await sql(
      `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = $1`,
      [PHARMACIE],
    );
    D = (
      await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
        type: 'DESKTOP',
        appareilId: 'desktop-droits',
      })
    ).data.id;
  });

  afterAll(async () => {
    try {
      if (prisma) await fermerPrismaDeTest(prisma);
    } finally {
      if (base) await supprimerBaseDeTest(base);
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  const envoyer = (
    sequence: number,
    utilisateurId: string,
    sessionId: string,
  ): Promise<{ data: ReponseSynchro; message: string }> =>
    synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: D,
        etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' },
        evenements: [
          {
            evenementId: randomUUID(),
            sequence,
            type: 'SESSION_OUVERTE',
            horodatageLocal: new Date().toISOString(),
            utilisateurId,
            corps: { sessionId },
          },
        ],
      },
      ip,
    );

  it('sans permission exigée (vente et caisse), le rejeu est inchangé : la session est appliquée', async () => {
    const r = await envoyer(1, VENDEUR, randomUUID());
    expect(r.data.resultats[0].statut).toBe('APPLIQUE');
  });

  it('un type qui exige une permission que l utilisateur n a plus est rejeté PERMISSION_INSUFFISANTE, la file continue', async () => {
    const table = PERMISSIONS_PAR_TYPE as Record<string, readonly string[]>;
    const avant = table.SESSION_OUVERTE;
    table.SESSION_OUVERTE = ['stock:write'];
    try {
      const sessionRefusee = randomUUID();
      const refuse = await envoyer(2, VENDEUR, sessionRefusee);
      const resultat = refuse.data.resultats[0];
      expect(resultat.statut).toBe('REJETE');
      expect(resultat.code).toBe('PERMISSION_INSUFFISANTE');
      expect(resultat.message).toBe(MESSAGES_REJET.PERMISSION_INSUFFISANTE);
      const sessions = await sql(
        'SELECT count(*)::int AS n FROM "SessionCaisse" WHERE "id" = $1',
        [sessionRefusee],
      );
      expect(sessions.rows[0].n).toBe(0);
      const anomalies = await sql(
        `SELECT count(*)::int AS n FROM "Anomalie" WHERE "type"::text = 'EVENEMENT_REJETE'`,
      );
      expect(anomalies.rows[0].n).toBeGreaterThanOrEqual(1);

      // Un utilisateur qui a la permission passe, au numéro d'ordre suivant.
      const accepte = await envoyer(3, RESPONSABLE, randomUUID());
      expect(accepte.data.resultats[0].statut).toBe('APPLIQUE');
    } finally {
      table.SESSION_OUVERTE = avant;
    }
  });
});
