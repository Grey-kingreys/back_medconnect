import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { cheminsCout, masquerCouts } from 'src/pharmacie/masquer-couts';
import { RapportsService } from 'src/pharmacie/rapports/rapports.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { CreerReceptionDto } from 'src/pharmacie/dto/receptions.dto';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
import { VenteService } from 'src/pharmacie/vente.service';
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
import { rejeuParDefaut } from './rejeu-provisoire';

async function refus<T>(
  promesse: Promise<T>,
): Promise<{ statut: number; corps: Record<string, unknown> }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      const reponse = erreur.getResponse();
      return {
        statut: erreur.getStatus(),
        corps:
          typeof reponse === 'string'
            ? { message: reponse }
            : (reponse as Record<string, unknown>),
      };
    }
    throw erreur;
  }
  throw new Error('Un refus était attendu, la promesse a abouti.');
}

interface LotRep {
  id: string;
  stockId: string;
}
interface ReceptionRep {
  data: { id: string; lots: LotRep[] };
}
interface VenteRep {
  data: { id: string; total: number };
}
interface MargeRep {
  data: {
    du: string;
    au: string;
    debutFiabilite: string | null;
    periodeAvantFiabilite: boolean;
    nombrePieces: number;
    chiffreAffairesTotal: number;
    chiffreAffairesValorise: number;
    coutAlloue: number;
    marge: number;
    nonValorisable: {
      nombreVentes: number;
      nombreLignes: number;
      chiffreAffaires: number;
    };
    provisoires: { nombreLignes: number; chiffreAffaires: number };
  };
}
interface LotAlerteRep {
  lotId: string;
  stockId: string;
  joursRestants: number;
  quantite: number;
  quantiteBoites: number;
  unitesEnPlus: number;
  ficheArchivee: boolean;
  valeurVente: number | null;
  valeurCout?: number | null;
  coutConnu?: boolean;
}
interface GroupeRep {
  nombreLots: number;
  nombreLotsCoutInconnu?: number;
  lots: LotAlerteRep[];
}
interface AlertesRep {
  data: {
    horizons: (GroupeRep & { jours: number })[];
    perimes: GroupeRep;
    sansDate: { nombreLots: number };
  };
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const AUTRE = 'usr-admin-p2';

describe('Alertes de péremption et rapport de marge, sur base de test (PB16a)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let venteParRejeu: ReturnType<typeof rejeuParDefaut>;
  let receptions: ReceptionsService;
  let inventaires: InventairesService;
  let rapports: RapportsService;
  let pv1: string;
  let compteurFiche = 0;
  const alertes = jest.fn().mockResolvedValue(undefined);

  /** Fiche du test 3 (réutilisée par les tests 7 et 9). */
  let ficheValorisee = '';
  /** Lot technique de la fixture (test 4, réutilisé par le test 7). */
  let technique: { stockId: string; total: number } | undefined;
  /** Réponse du titulaire du test 12, relue par le test 13. */
  let reponseTitulaire: AlertesRep | undefined;

  const jour = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    const notifications = {
      createManyNotifications: alertes,
    } as unknown as NotificationsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          id === RESPONSABLE
            ? [
                'vente:write',
                'vente:annuler',
                'caisse:utiliser',
                'stock:read',
                'stock:write',
                'reception:write',
                'inventaire:write',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser', 'stock:read'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    service = new VenteService(
      prisma,
      notifications,
      stockage,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    venteParRejeu = rejeuParDefaut({
      synchro: new SynchroService(prisma, acces, mouvements, sessions),
      postes: new PointsDeVenteService(prisma, acces),
      structureId: PHARMACIE,
      vendeurId: VENDEUR,
      responsableId: RESPONSABLE,
      appareilId: 'desktop-pb20-rapports',
    });
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
    inventaires = new InventairesService(prisma, acces, mouvements);
    rapports = new RapportsService(prisma, acces, permissions);
    pv1 = await pointDeVente(PHARMACIE);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await fermerPrismaDeTest(prisma);
      }
    } finally {
      if (base) {
        await supprimerBaseDeTest(base);
      }
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function pointDeVente(structureId: string): Promise<string> {
    const res = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [structureId],
    );
    return String(res.rows[0].id);
  }

  async function nouvelleFiche(
    o: { prix?: number; coef?: number } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit rapport ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB16a', false, now())`,
      [`med-rap-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, true, now())`,
      [`stk-rap-${n}`, `med-rap-${n}`, PHARMACIE, o.prix ?? 8000, o.coef ?? 1],
    );
    return { stockId: `stk-rap-${n}`, nom };
  }

  async function recevoir(dto: CreerReceptionDto): Promise<ReceptionRep> {
    return (await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      dto,
      '127.0.0.1',
    )) as unknown as ReceptionRep;
  }

  const recevoirBoites = (
    stockId: string,
    nombreBoites: number,
    o: { dans?: number; cout?: number } = {},
  ) =>
    recevoir({
      lignes: [
        {
          stockId,
          nombreBoites,
          dateExpiration: jour(o.dans ?? 300),
          ...(o.cout === undefined ? {} : { coutAchatBoite: o.cout }),
        },
      ],
    });

  async function vendre(lignes: { stockId: string; quantite: number }[]) {
    const dto: CreerVenteDto = { lignes, ordonnanceVerifiee: true };
    return (await service.creerVente(
      PHARMACIE,
      VENDEUR,
      dto,
      undefined,
      '127.0.0.1',
    )) as unknown as VenteRep;
  }

  async function rapportDuJour(): Promise<MargeRep['data']> {
    const r = (await rapports.rapportMarge(PHARMACIE, RESPONSABLE, {
      du: jour(0),
      au: jour(0),
    })) as unknown as MargeRep;
    return r.data;
  }

  async function soldeLot(lotId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  const alertesDe = (utilisateur: string) =>
    rapports.alertesPeremption(
      PHARMACIE,
      utilisateur,
    ) as unknown as Promise<AlertesRep>;

  const lotsDe = (g: GroupeRep, stockId: string) =>
    g.lots.filter((l) => l.stockId === stockId);

  it('ventes historiques non valorisables, annulées historiques écartées', async () => {
    const bornes = await sql(
      `SELECT to_char(min("jourMetier"), 'YYYY-MM-DD') AS "debut", to_char(max("jourMetier"), 'YYYY-MM-DD') AS "fin" FROM "Vente" WHERE "pointDeVenteId" = $1`,
      [pv1],
    );
    const du = String(bornes.rows[0].debut);
    const au = String(bornes.rows[0].fin);
    const r = (await rapports.rapportMarge(PHARMACIE, RESPONSABLE, {
      du,
      au,
    })) as unknown as MargeRep;

    const periode = [pv1, du, au];
    const validees = await compter(
      `SELECT count(*) AS n FROM "Vente" WHERE "pointDeVenteId" = $1 AND "jourMetier" BETWEEN $2 AND $3 AND "statut" = 'VALIDEE'`,
      periode,
    );
    const annulees = await compter(
      `SELECT count(*) AS n FROM "Vente" WHERE "pointDeVenteId" = $1 AND "jourMetier" BETWEEN $2 AND $3 AND "statut" = 'ANNULEE'`,
      periode,
    );
    const ca = await compter(
      `SELECT coalesce(sum(l."sousTotal"), 0) AS n FROM "LigneVente" l JOIN "Vente" v ON v."id" = l."venteId" WHERE v."pointDeVenteId" = $1 AND v."jourMetier" BETWEEN $2 AND $3 AND v."statut" = 'VALIDEE'`,
      periode,
    );

    expect(annulees).toBeGreaterThan(0);
    expect(r.data.nombrePieces).toBe(validees);
    expect(r.data.nonValorisable.nombreVentes).toBe(validees);
    expect(r.data.nonValorisable.chiffreAffaires).toBe(ca);
    expect(r.data.chiffreAffairesValorise).toBe(0);
    expect(r.data.coutAlloue).toBe(0);
    expect(r.data.marge).toBe(0);
  });

  it('date de fiabilité', async () => {
    const lu = await sql(
      `SELECT to_char("debutFiabiliteMarge", 'YYYY-MM-DD') AS "jour" FROM "ParametresPharmacie" WHERE "structureId" = $1`,
      [PHARMACIE],
    );
    const debut = String(lu.rows[0].jour);

    const ancien = (await rapports.rapportMarge(PHARMACIE, RESPONSABLE, {
      du: jour(-30),
      au: jour(0),
    })) as unknown as MargeRep;
    expect(ancien.data.debutFiabilite).toBe(debut);
    expect(ancien.data.periodeAvantFiabilite).toBe(true);

    const courant = await rapportDuJour();
    expect(courant.periodeAvantFiabilite).toBe(false);
  });

  it('CA11 de bout en bout : coût par allocation', async () => {
    const { stockId } = await nouvelleFiche({ prix: 8000, coef: 10 });
    ficheValorisee = stockId;
    const lot1 = await recevoirBoites(stockId, 2, { dans: 30, cout: 5000 });
    const lot2 = await recevoirBoites(stockId, 10, { dans: 90, cout: 7000 });

    const avant = await rapportDuJour();
    await vendre([{ stockId, quantite: 3 }]);
    const apres = await rapportDuJour();

    const allocations = await sql(
      `SELECT a."quantite", a."coutUnitaire", a."statut"::text AS "statut" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."stockMedicamentId" = $1 ORDER BY a."coutUnitaire"`,
      [stockId],
    );
    expect(
      allocations.rows.map((a) => [
        Number(a.quantite),
        Number(a.coutUnitaire),
        a.statut,
      ]),
    ).toEqual([
      [20, 500, 'DEFINITIVE'],
      [10, 700, 'DEFINITIVE'],
    ]);
    expect(await soldeLot(lot1.data.lots[0].id)).toBe(0);
    expect(await soldeLot(lot2.data.lots[0].id)).toBe(90);

    expect(apres.chiffreAffairesValorise - avant.chiffreAffairesValorise).toBe(
      24000,
    );
    expect(apres.coutAlloue - avant.coutAlloue).toBe(17000);
    expect(apres.marge - avant.marge).toBe(7000);
    expect(apres.nonValorisable).toEqual(avant.nonValorisable);
    expect(apres.provisoires).toEqual(avant.provisoires);
  });

  it('CA12 : lot technique de reprise', async () => {
    const res = await sql(
      `SELECT l."stockMedicamentId" AS "stockId", s."prixUnitaire" AS "prix"
       FROM "LotStock" l
       JOIN "AgregatStockLot" a ON a."lotId" = l."id"
       JOIN "StockMedicament" s ON s."id" = l."stockMedicamentId"
       WHERE l."pointDeVenteId" = $1 AND l."lotTechnique" = true AND a."quantite" >= 2
         AND s."archiveLe" IS NULL AND s."prixUnitaire" > 0
         AND (l."dateExpiration" IS NULL OR l."dateExpiration" >= CURRENT_DATE)
         AND (SELECT count(*) FROM "LotStock" x WHERE x."stockMedicamentId" = s."id" AND x."pointDeVenteId" = l."pointDeVenteId") = 1
       ORDER BY l."id" LIMIT 1`,
      [pv1],
    );
    expect(res.rows).toHaveLength(1);
    const stockId = String(res.rows[0].stockId);

    const avant = await rapportDuJour();
    const vente = await vendre([{ stockId, quantite: 1 }]);
    technique = { stockId, total: vente.data.total };
    const apres = await rapportDuJour();

    expect(apres.nonValorisable.nombreVentes).toBe(
      avant.nonValorisable.nombreVentes + 1,
    );
    expect(apres.nonValorisable.chiffreAffaires).toBe(
      avant.nonValorisable.chiffreAffaires + vente.data.total,
    );
    expect(apres.chiffreAffairesValorise).toBe(avant.chiffreAffairesValorise);
    expect(apres.coutAlloue).toBe(avant.coutAlloue);
    expect(apres.marge).toBe(avant.marge);
  });

  it("CA12 : lot trouvé à l'inventaire, jamais une marge à 100 %", async () => {
    const { stockId } = await nouvelleFiche({ prix: 3000 });
    await inventaires.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      {
        lignes: [{ stockId, quantiteComptee: 5, dateExpiration: jour(100) }],
      },
      '127.0.0.1',
    );
    const lot = await sql(
      `SELECT "coutUnitaire" FROM "LotStock" WHERE "stockMedicamentId" = $1`,
      [stockId],
    );
    expect(lot.rows.map((l) => Number(l.coutUnitaire))).toEqual([0]);

    const avant = await rapportDuJour();
    await vendre([{ stockId, quantite: 1 }]);
    const apres = await rapportDuJour();

    expect(apres.nonValorisable.nombreVentes).toBe(
      avant.nonValorisable.nombreVentes + 1,
    );
    expect(apres.nonValorisable.chiffreAffaires).toBe(
      avant.nonValorisable.chiffreAffaires + 3000,
    );
    expect(apres.marge).toBe(avant.marge);
    expect(apres.chiffreAffairesValorise).toBe(avant.chiffreAffairesValorise);
  });

  it('CA12 : lot reçu sans coût', async () => {
    const { stockId } = await nouvelleFiche({ prix: 4000 });
    await recevoirBoites(stockId, 5);

    const avant = await rapportDuJour();
    await vendre([{ stockId, quantite: 1 }]);
    const apres = await rapportDuJour();

    expect(apres.nonValorisable.nombreVentes).toBe(
      avant.nonValorisable.nombreVentes + 1,
    );
    expect(apres.marge).toBe(avant.marge);
    expect(apres.chiffreAffairesValorise).toBe(avant.chiffreAffairesValorise);
  });

  it('CA12 : vente mixte', async () => {
    if (!technique) throw new Error('Le test du lot technique doit précéder.');
    const avant = await rapportDuJour();
    const vente = await vendre([
      { stockId: ficheValorisee, quantite: 1 },
      { stockId: technique.stockId, quantite: 1 },
    ]);
    const apres = await rapportDuJour();

    expect(apres.nonValorisable.nombreVentes).toBe(
      avant.nonValorisable.nombreVentes + 1,
    );
    expect(apres.nonValorisable.nombreLignes).toBe(
      avant.nonValorisable.nombreLignes + 1,
    );
    expect(apres.nonValorisable.chiffreAffaires).toBe(
      avant.nonValorisable.chiffreAffaires + vente.data.total,
    );
    expect(apres.chiffreAffairesValorise).toBe(avant.chiffreAffairesValorise);
  });

  it('provisoire puis rattachement', async () => {
    const { stockId } = await nouvelleFiche({ prix: 2000, coef: 1 });

    const avantVente = await rapportDuJour();
    // Vente sans stock : seul le rejeu d'un poste l'accepte (prix du ticket : 2000)
    await venteParRejeu({ stockId, nombre: 2, prixUnitaire: 2000 });
    const provisoire = await rapportDuJour();
    expect(provisoire.provisoires.nombreLignes).toBe(
      avantVente.provisoires.nombreLignes + 1,
    );
    expect(provisoire.provisoires.chiffreAffaires).toBe(
      avantVente.provisoires.chiffreAffaires + 4000,
    );

    await recevoirBoites(stockId, 5, { cout: 1200 });
    const apres = await rapportDuJour();
    expect(apres.provisoires).toEqual(avantVente.provisoires);
    expect(
      apres.chiffreAffairesValorise - avantVente.chiffreAffairesValorise,
    ).toBe(4000);
    expect(apres.coutAlloue - avantVente.coutAlloue).toBe(2400);
    expect(apres.marge - avantVente.marge).toBe(1600);
  });

  it('annulation : la pièce inverse annule la marge', async () => {
    const avant = await rapportDuJour();
    const vente = await vendre([{ stockId: ficheValorisee, quantite: 1 }]);
    await service.annulerVente(
      PHARMACIE,
      vente.data.id,
      RESPONSABLE,
      { motif: 'Erreur de quantité' },
      '127.0.0.1',
    );
    const apres = await rapportDuJour();

    expect(apres.chiffreAffairesValorise).toBe(avant.chiffreAffairesValorise);
    expect(apres.coutAlloue).toBe(avant.coutAlloue);
    expect(apres.marge).toBe(avant.marge);
    expect(apres.nombrePieces).toBe(avant.nombrePieces + 2);
  });

  it('cohérence des totaux', async () => {
    const r = await rapportDuJour();
    expect(r.chiffreAffairesTotal).toBe(
      r.chiffreAffairesValorise +
        r.nonValorisable.chiffreAffaires +
        r.provisoires.chiffreAffaires,
    );
  });

  it('période refusée', async () => {
    const cas: [{ du?: string; au?: string }, string, string][] = [
      [{ du: '2026-02-30' }, 'du', 'jourInvalide'],
      [{ du: jour(0), au: jour(-1) }, 'du', 'periodeInversee'],
      [{ du: jour(-92), au: jour(0) }, 'au', 'periodeMaximale'],
    ];
    for (const [dto, champ, contrainte] of cas) {
      const r = await refus(rapports.rapportMarge(PHARMACIE, RESPONSABLE, dto));
      expect(r.statut).toBe(400);
      expect(r.corps.code).toBe('VALIDATION');
      expect(r.corps.champs).toEqual([{ champ, contraintes: [contrainte] }]);
    }

    const limite = (await rapports.rapportMarge(PHARMACIE, RESPONSABLE, {
      du: jour(-91),
      au: jour(0),
    })) as unknown as MargeRep;
    expect(limite.data.du).toBe(jour(-91));

    const defaut = (await rapports.rapportMarge(
      PHARMACIE,
      RESPONSABLE,
      {},
    )) as unknown as MargeRep;
    expect(defaut.data.au).toBe(jour(0));
    expect(defaut.data.du).toBe(jour(0).slice(0, 8) + '01');
  });

  it('CA14 de bout en bout : alertes par lot valorisées au coût', async () => {
    const { stockId } = await nouvelleFiche({ prix: 8000, coef: 10 });
    const lotA = (await recevoirBoites(stockId, 10, { dans: 5, cout: 5000 }))
      .data.lots[0].id;
    const lotB = (await recevoirBoites(stockId, 2, { dans: 20 })).data.lots[0]
      .id;
    const lotC = (await recevoirBoites(stockId, 3, { dans: 60, cout: 7000 }))
      .data.lots[0].id;
    const lotD = (await recevoirBoites(stockId, 1, { dans: 200, cout: 5000 }))
      .data.lots[0].id;
    const lotE = (await recevoirBoites(stockId, 4, { dans: 10, cout: 6000 }))
      .data.lots[0].id;
    await sql(
      `UPDATE "LotStock" SET "dateExpiration" = CURRENT_DATE - 3 WHERE "id" = $1`,
      [lotE],
    );

    const r = await alertesDe(RESPONSABLE);
    reponseTitulaire = r;
    const d = r.data;
    expect(d.horizons.map((h) => h.jours)).toEqual([90, 30, 7]);
    const [h90, h30, h7] = d.horizons;

    const a = lotsDe(h7, stockId);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      lotId: lotA,
      joursRestants: 5,
      quantite: 100,
      quantiteBoites: 10,
      unitesEnPlus: 0,
      valeurVente: 80000,
      valeurCout: 50000,
      coutConnu: true,
    });

    const b = lotsDe(h30, stockId);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({
      lotId: lotB,
      valeurCout: null,
      coutConnu: false,
      valeurVente: 16000,
    });
    expect(h30.nombreLotsCoutInconnu).toBeGreaterThanOrEqual(1);

    const c = lotsDe(h90, stockId);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ lotId: lotC, valeurCout: 21000 });

    const tousHorizons = d.horizons.flatMap((h) => h.lots.map((l) => l.lotId));
    expect(tousHorizons).not.toContain(lotD);

    const e = lotsDe(d.perimes, stockId);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      lotId: lotE,
      joursRestants: -3,
      valeurCout: 24000,
    });
  });

  it('CA14 : le vendeur reçoit les mêmes lots sans aucune donnée de coût', async () => {
    if (!reponseTitulaire) throw new Error('Le test CA14 doit précéder.');
    const vendeur = await alertesDe(VENDEUR);
    expect(cheminsCout(vendeur.data)).toEqual([]);
    expect(vendeur.data).toEqual(masquerCouts(reponseTitulaire.data, false));
  });

  it('horizons des paramètres, lot sans date, fiche archivée, autre pharmacie', async () => {
    await sql(
      `UPDATE "ParametresPharmacie" SET "horizonsPeremptionJours" = '{60,30}' WHERE "structureId" = $1`,
      [PHARMACIE],
    );
    try {
      const { stockId } = await nouvelleFiche({ prix: 8000, coef: 10 });
      const lot = (await recevoirBoites(stockId, 2, { dans: 45, cout: 5000 }))
        .data.lots[0].id;

      const premier = await alertesDe(RESPONSABLE);
      expect(premier.data.horizons.map((h) => h.jours)).toEqual([60, 30]);
      const h60 = premier.data.horizons[0];
      expect(lotsDe(h60, stockId).map((l) => l.lotId)).toEqual([lot]);

      const autre = await nouvelleFiche({ prix: 1000 });
      await recevoir({
        lignes: [
          { stockId: autre.stockId, nombreBoites: 1, sansPeremption: true },
        ],
      });
      const second = await alertesDe(RESPONSABLE);
      expect(second.data.sansDate.nombreLots).toBe(
        premier.data.sansDate.nombreLots + 1,
      );

      await sql(
        `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1`,
        [stockId],
      );
      const archive = await alertesDe(RESPONSABLE);
      const lotArchive = lotsDe(archive.data.horizons[0], stockId);
      expect(lotArchive).toHaveLength(1);
      expect(lotArchive[0].ficheArchivee).toBe(true);

      const interdit = await refus(
        rapports.alertesPeremption(PHARMACIE, AUTRE),
      );
      expect(interdit.statut).toBe(403);
    } finally {
      await sql(
        `UPDATE "ParametresPharmacie" SET "horizonsPeremptionJours" = '{90,30,7}' WHERE "structureId" = $1`,
        [PHARMACIE],
      );
    }
  });
});
