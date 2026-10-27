// Non-régression des lectures pharmacie (PB02). Rejoué après chaque migration
// de la tranche. Les instantanés ne se régénèrent jamais sans décision
// consignée du chef (D458). Les tâches qui changent les constructeurs des
// services ne modifient que le bloc « construction des services » (D462).
import { NotificationsService } from 'src/notifications/notifications.service';
import { PharmacieService } from 'src/pharmacie/pharmacie.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { VenteService } from 'src/pharmacie/vente.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import type { StorageService } from 'src/storage/storage.service';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  ResumeFormatActuel,
} from './fixtures/format-actuel';
import {
  capturerErreur,
  ecartsInstantane,
  jourRelatif,
  libelleRelatif,
  normaliser,
  OptionsNormalisation,
  trierDansGroupes,
  verifierInstantane,
  VOLATIL,
} from './outils-instantanes';

const VOLATILES_FICHES = ['createdAt', 'updatedAt'] as const; // fiches et médicaments : horodatés par now() au chargement
const VOLATILES_VENTES = ['updatedAt'] as const; // createdAt des ventes est fixé par le jeu (J + 8 h...)
const COORDONNEES: ReadonlyArray<[string, number, number]> = [
  ['str-pharma-1', 9.5092, -13.7122],
  ['str-pharma-2', 9.5716, -13.6476],
];
const ACCES_STOCK: ReadonlyArray<[string, string]> = [
  ['str-pharma-1', 'usr-admin-p1'],
  ['str-pharma-2', 'usr-pharm-p2'],
  ['str-pharma-3', 'usr-admin-p3'],
];

interface EntreeAlerte {
  id: string;
  nom: string;
  quantite?: number;
}

interface ReponseStock {
  data: {
    stocks: unknown[];
    alertes: { stockBas: EntreeAlerte[]; rupture: EntreeAlerte[] };
  };
}

interface ResultatRecherche {
  id: string;
  quantite: number;
  disponible: boolean;
  structure: { id: string };
}

interface ReponseMedicament {
  data: { stocks: Array<{ id: string }> };
}

interface ReponseListe {
  data: {
    totalJour: number;
    nombre: number;
    ventes: Array<{ id: string }>;
  };
}

interface ReponseDetail {
  data: {
    statut: string;
    motifAnnulation: string | null;
    total: number;
    lignes: unknown[];
    pharmacie: { logoUrl: string | null };
  };
}

function parId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Divergences attendues après le recâblage des lectures (D460, D506), nommées une à une
const DATE_PERIMEE = 'J-30j 00:00:00.000';
type EntreeInstantane = Record<string, unknown>;

/** D460 (2) : une fiche sans lot en stock a une date calculée nulle. */
function dateNulleSansStock(attendu: unknown): unknown {
  const objet = attendu as Record<
    string,
    { data: { stocks: EntreeInstantane[] } }
  >;
  for (const reponse of Object.values(objet)) {
    for (const s of reponse.data.stocks) {
      if (s.quantite === 0) s.dateExpiration = null;
    }
  }
  return objet;
}

/** D460 (1), D426 : la recherche publique n'annonce plus un stock périmé. */
function rechercheSansPerimes(attendu: unknown): unknown {
  const objet = attendu as Record<
    string,
    { data: EntreeInstantane[]; message: string }
  >;
  for (const reponse of Object.values(objet)) {
    reponse.data = reponse.data.filter(
      (s) => s.dateExpiration !== DATE_PERIMEE,
    );
    reponse.message = reponse.message.replace(
      /^\d+ résultat/,
      `${reponse.data.length} résultat`,
    );
  }
  return objet;
}

/** D460 (1), D426 : le détail catalogue n'annonce plus un stock périmé. */
function medicamentSansPerimes(attendu: unknown): unknown {
  const objet = attendu as Record<
    string,
    { data?: { stocks?: EntreeInstantane[] } }
  >;
  for (const reponse of Object.values(objet)) {
    if (reponse.data?.stocks) {
      reponse.data.stocks = reponse.data.stocks.filter(
        (s) => s.dateExpiration !== DATE_PERIMEE,
      );
    }
  }
  return objet;
}

describe('Non-régression des lectures pharmacie (PB02)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let resume: ResumeFormatActuel;
  let pharmacie: PharmacieService;
  let ventes: VenteService;
  let J: Date;
  let jourJ: string;
  let veille: string;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);

    // Coordonnées pour la branche « distance » (D463)
    for (const [id, lat, lng] of COORDONNEES) {
      await base.client.query(
        'UPDATE "Structure" SET "latitude" = $2, "longitude" = $3 WHERE "id" = $1',
        [id, lat, lng],
      );
    }

    // Construction des services (seul bloc modifiable par les tâches suivantes, D462)
    const notifications = new NotificationsService(prisma);
    const stockageFactice = {
      getPublicUrl: (cle: string) => `logo-harnais/${cle}`,
    } as unknown as StorageService;
    const acces = new AccesPharmacieService(prisma);
    const permissionsFactices = {
      getUserPermissions: () => Promise.resolve([] as string[]),
    } as unknown as PermissionsService;
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      new MouvementsStockService(),
      permissionsFactices,
      new ReceptionsService(
        prisma,
        acces,
        new MouvementsStockService(),
        permissionsFactices,
      ),
      new InventairesService(prisma, acces, new MouvementsStockService()),
    );
    ventes = new VenteService(
      prisma,
      notifications,
      stockageFactice,
      acces,
      permissionsFactices,
      new MouvementsStockService(),
      new SessionsCaisseService(prisma, acces, permissionsFactices),
    );

    J = resume.aujourdhui;
    jourJ = J.toISOString().slice(0, 10);
    veille = new Date(J.getTime() - 86_400_000).toISOString().slice(0, 10);
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

  function options(cles: readonly string[]): OptionsNormalisation {
    return { aujourdhui: J, clesVolatiles: cles };
  }

  it('normalise les dates relativement au jour du jeu', () => {
    const j0 = new Date(Date.UTC(2026, 0, 15));
    const resultat = normaliser(
      {
        a: new Date(Date.UTC(2026, 0, 15, 8)),
        b: '2025-12-16T00:00:00.000Z',
        c: 'V-2026-000001',
        d: '2 vente(s) le 2026-01-14.',
        e: 1.23456789,
        f: null,
        g: undefined,
        updatedAt: new Date(),
      },
      { aujourdhui: j0, clesVolatiles: ['updatedAt'] },
    );
    expect(resultat).toEqual({
      a: 'J+0j 08:00:00.000',
      b: 'J-30j 00:00:00.000',
      c: 'V-AAAA-000001',
      d: '2 vente(s) le J-1.',
      e: 1.234568,
      f: null,
      updatedAt: VOLATIL,
    });
    expect(Object.keys(resultat as Record<string, unknown>)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'updatedAt',
    ]);
    expect(libelleRelatif(new Date(Date.UTC(2026, 0, 14, 16)), j0)).toBe(
      'J-1j 16:00:00.000',
    );
    expect(jourRelatif('2026-01-15', j0)).toBe('J+0');
  });

  it('compare un instantané par projection sur ses clés', () => {
    expect(
      ecartsInstantane(
        { a: 1, b: { c: [1, 2] } },
        { a: 1, b: { c: [1, 2], x: true }, d: 5 },
      ),
    ).toEqual([]);
    expect(
      ecartsInstantane({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } }),
    ).toEqual(['$.b.c[1] : attendu 2, reçu 3']);
    expect(ecartsInstantane({ a: 1 }, {})).toEqual(['$.a : clé absente']);
    expect(ecartsInstantane({ l: [1, 2] }, { l: [1] })).toEqual([
      '$.l : 2 éléments attendus, 1 reçus',
    ]);
    expect(ecartsInstantane({ o: {} }, { o: null })).toEqual([
      '$.o : objet attendu, reçu null',
    ]);
    expect(ecartsInstantane({ n: null }, { n: 0 })).toEqual([
      '$.n : attendu null, reçu 0',
    ]);
  });

  it("trie seulement à l'intérieur des groupes consécutifs", () => {
    expect(
      trierDansGroupes(
        [
          { id: 'b', g: '1' },
          { id: 'a', g: '1' },
          { id: 'd', g: '2' },
          { id: 'c', g: '2' },
          { id: 'e', g: '1' },
        ],
        (e) => e.g,
      ).map((e) => e.id),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('alertes de stock : stock bas et rupture par pharmacie (exigence de la demande)', async () => {
    let totalBas = 0;
    let totalRupture = 0;
    for (const [structureId, userId] of ACCES_STOCK) {
      const r = (await pharmacie.getStockPharmacie(
        structureId,
        userId,
      )) as unknown as ReponseStock;
      const fiches = resume.fiches.filter((f) => f.structureId === structureId);
      expect(r.data.stocks.length).toBe(fiches.length);

      const idsBas = r.data.alertes.stockBas.map((e) => e.id).sort();
      expect(idsBas).toEqual(
        fiches
          .filter((f) => f.quantite > 0 && f.quantite < 10)
          .map((f) => f.id)
          .sort(),
      );
      const idsRupture = r.data.alertes.rupture.map((e) => e.id).sort();
      expect(idsRupture).toEqual(
        fiches
          .filter((f) => f.quantite === 0)
          .map((f) => f.id)
          .sort(),
      );

      for (const entree of r.data.alertes.stockBas) {
        const fiche = resume.fiches.find((f) => f.id === entree.id);
        expect(entree.quantite).toBe(fiche?.quantite);
        expect(entree.nom.length).toBeGreaterThan(0);
        expect([10, 11]).not.toContain(entree.quantite);
      }
      totalBas += r.data.alertes.stockBas.length;
      totalRupture += r.data.alertes.rupture.length;
    }
    expect(totalBas).toBe(14);
    expect(totalRupture).toBe(7);
  });

  it('instantané de getStockPharmacie (alertes et stocks)', async () => {
    const objet: Record<string, unknown> = {};
    for (const [structureId, userId] of ACCES_STOCK) {
      objet[structureId] = await pharmacie.getStockPharmacie(
        structureId,
        userId,
      );
    }
    verifierInstantane(
      'get-stock-pharmacie',
      normaliser(objet, options(VOLATILES_FICHES)),
      dateNulleSansStock,
    );
  });

  it('instantané de rechercherDisponibilite', async () => {
    type Appel = Parameters<PharmacieService['rechercherDisponibilite']>;
    const cas: Array<[string, Appel]> = [
      ['sans filtre', []],
      ['recherche para', ['para']],
      ['recherche AMOX en majuscules', ['AMOX']],
      ['recherche trop courte', ['p']],
      ['recherche sans résultat', ['zzzz']],
      ['ville conakry', [undefined, 'conakry']],
      ['ville inconnue', [undefined, 'Kankan']],
      [
        'pharmacie 2',
        [undefined, undefined, undefined, undefined, 'str-pharma-2'],
      ],
      [
        'pharmacie 3 non configurée',
        [undefined, undefined, undefined, undefined, 'str-pharma-3'],
      ],
      [
        'hôpital',
        [undefined, undefined, undefined, undefined, 'str-hopital-1'],
      ],
      ['distance depuis Kaloum', [undefined, undefined, 9.5092, -13.7122]],
      ['distance et recherche', ['para', undefined, 9.5716, -13.6476]],
    ];
    const objet: Record<string, unknown> = {};
    for (const [cle, args] of cas) {
      const r = await pharmacie.rechercherDisponibilite(...args);
      const liste = r.data as unknown as ResultatRecherche[];
      objet[cle] = {
        ...r,
        data: trierDansGroupes(liste, (s) => s.structure.id),
      };

      if (cle === 'sans filtre') {
        expect(liste.length).toBe(23);
        for (const s of liste) {
          expect(s.quantite).toBeGreaterThan(0);
          expect(s.disponible).toBe(true);
          expect(['str-pharma-1', 'str-pharma-2']).toContain(s.structure.id);
        }
        expect(liste.map((s) => s.id).sort()).toEqual(
          resume.fiches
            .filter(
              (f) =>
                ['str-pharma-1', 'str-pharma-2'].includes(f.structureId) &&
                f.quantite > 0 &&
                !(f.dateExpiration !== null && f.dateExpiration < J),
            )
            .map((f) => f.id)
            .sort(),
        );
      }
      if (cle === 'pharmacie 3 non configurée' || cle === 'hôpital') {
        expect(liste.length).toBe(0);
      }
    }
    verifierInstantane(
      'rechercher-disponibilite',
      normaliser(objet, options(VOLATILES_FICHES)),
      rechercheSansPerimes,
    );
  });

  it('instantané de getMedicament', async () => {
    const objet: Record<string, unknown> = {};
    for (let n = 1; n <= 20; n++) {
      const id = 'med-' + String(n).padStart(2, '0');
      const r = (await pharmacie.getMedicament(
        id,
      )) as unknown as ReponseMedicament;
      objet[id] = {
        ...r,
        data: { ...r.data, stocks: [...r.data.stocks].sort(parId) },
      };
      expect(r.data.stocks.map((s) => s.id).sort()).toEqual(
        resume.fiches
          .filter(
            (f) =>
              f.medicamentId === id &&
              f.quantite > 0 &&
              f.disponible &&
              !(f.dateExpiration !== null && f.dateExpiration < J),
          )
          .map((f) => f.id)
          .sort(),
      );
    }
    const erreur = await capturerErreur(
      pharmacie.getMedicament('med-inexistant'),
    );
    expect(erreur.statut).toBe(404);
    objet['med-inexistant'] = erreur;
    verifierInstantane(
      'get-medicament',
      normaliser(objet, options(VOLATILES_FICHES)),
      medicamentSansPerimes,
    );
  });

  it('instantané de listerVentes', async () => {
    const lire = async (
      structureId: string,
      userId: string,
      query: { date?: string; page?: number },
    ) =>
      (await ventes.listerVentes(
        structureId,
        userId,
        query,
      )) as unknown as ReponseListe;

    const objet: Record<string, unknown> = {};
    const jour = await lire('str-pharma-1', 'usr-pharm-p1', { date: jourJ });
    objet['str-pharma-1 J'] = jour;
    objet['str-pharma-1 J page 2'] = await lire(
      'str-pharma-1',
      'usr-pharm-p1',
      {
        date: jourJ,
        page: 2,
      },
    );
    const veille1 = await lire('str-pharma-1', 'usr-pharm-p1', {
      date: veille,
    });
    objet['str-pharma-1 veille'] = veille1;
    const veille2 = await lire('str-pharma-2', 'usr-admin-p2', {
      date: veille,
    });
    objet['str-pharma-2 veille'] = veille2;
    const jour2 = await lire('str-pharma-2', 'usr-admin-p2', { date: jourJ });
    objet['str-pharma-2 J'] = jour2;
    const invalide = await capturerErreur(
      ventes.listerVentes('str-pharma-1', 'usr-pharm-p1', {
        date: '2026-02-30',
      }),
    );
    expect(invalide.statut).toBe(400);
    objet['date invalide'] = invalide;

    expect(jour.data.totalJour).toBe(24000);
    expect(jour.data.nombre).toBe(4);
    expect(jour.data.ventes.map((v) => v.id)).toEqual([
      'vte-p1-4',
      'vte-p1-3',
      'vte-p1-2',
      'vte-p1-1',
    ]);
    expect(veille2.data.totalJour).toBe(6000);
    expect(veille2.data.nombre).toBe(2);
    expect(veille1.data.nombre).toBe(0);
    expect(jour2.data.nombre).toBe(0);

    verifierInstantane(
      'lister-ventes',
      normaliser(objet, options(VOLATILES_VENTES)),
    );
  });

  it('instantané de detailVente', async () => {
    const appels: Array<[string, string, string]> = [
      ['vte-p1-1', 'str-pharma-1', 'usr-pharm-p1'],
      ['vte-p1-2', 'str-pharma-1', 'usr-pharm-p1'],
      ['vte-p1-3', 'str-pharma-1', 'usr-pharm-p1'],
      ['vte-p1-4', 'str-pharma-1', 'usr-pharm-p1'],
      ['vte-p2-1', 'str-pharma-2', 'usr-admin-p2'],
      ['vte-p2-2', 'str-pharma-2', 'usr-admin-p2'],
    ];
    const objet: Record<string, unknown> = {};
    const details: Record<string, ReponseDetail> = {};
    for (const [venteId, structureId, userId] of appels) {
      const r = (await ventes.detailVente(
        structureId,
        venteId,
        userId,
      )) as unknown as ReponseDetail;
      details[venteId] = r;
      objet[venteId] = r;
    }
    const erreur = await capturerErreur(
      ventes.detailVente('str-pharma-1', 'vte-p2-1', 'usr-pharm-p1'),
    );
    expect(erreur.statut).toBe(404);
    objet['vte-p2-1 depuis str-pharma-1'] = erreur;

    expect(details['vte-p1-3'].data.statut).toBe('ANNULEE');
    expect(details['vte-p1-3'].data.motifAnnulation).toBe('Erreur de saisie');
    expect(details['vte-p1-3'].data.lignes.length).toBe(1);
    expect(details['vte-p1-1'].data.lignes.length).toBe(2);
    expect(details['vte-p1-1'].data.total).toBe(15000);
    for (const d of Object.values(details)) {
      expect(d.data.pharmacie.logoUrl).toBeNull();
    }

    verifierInstantane(
      'detail-vente',
      normaliser(objet, options(VOLATILES_VENTES)),
    );
  });
});
