import { randomUUID } from 'node:crypto';
import {
  ClassSerializerInterceptor,
  ExecutionContext,
  INestApplication,
  Provider,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import request from 'supertest';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { fabriquerErreurValidation } from 'src/common/filters/erreur-validation';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PERMISSIONS_AUTORISEES_PHARMACIE } from 'src/common/rbac/permissions-type-structure';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { cheminsCout, MOTIF_CLE_COUT } from 'src/pharmacie/masquer-couts';
import { MIME_XLSX } from 'src/pharmacie/pharmacie.service';
import { PharmacieModule } from 'src/pharmacie/pharmacie.module';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { StorageService } from 'src/storage/storage.service';
import { routesDesControleurs } from 'test/etancheite-couts/decouverte-routes';
import {
  ROUTES_PHARMACIE,
  type CleRoutePharmacie,
} from 'test/etancheite-couts/routes-pharmacie';
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

/**
 * CA22 (D606 à D609) : chaque route /pharmacie est appelée en HTTP avec les vrais
 * contrôleurs, les vrais services, le vrai PermissionsGuard et les vrais rôles ;
 * un vendeur qui a toutes les permissions de pharmacie sauf marge:read ne reçoit
 * jamais de clé de coût ou de marge.
 */
const S = 'str-pharma-1';
const PROFILS = {
  titulaire: { userId: 'usr-admin-p1', role: 'STRUCTURE_ADMIN' },
  vendeur: { userId: 'usr-pharm-p1', role: 'PHARMACIEN' },
} as const;

type Profil = keyof typeof PROFILS;

interface Contexte {
  profil: Profil;
  /** Requête authentifiée du profil (en-tête x-essai-user). */
  en: (
    methode: 'get' | 'post' | 'patch' | 'delete',
    chemin: string,
  ) => request.Test;
  /** Requête sans authentification. */
  anonyme: (chemin: string) => request.Test;
  /** État propre au profil (identifiants créés par les appels précédents). */
  etat: Record<string, string>;
}
type Appel = (c: Contexte) => Promise<request.Response[]>;

/** Lit le classeur de l'export du stock : titres et valeur de la colonne de coût de chaque ligne. */
async function lireClasseurStock(corps: unknown) {
  const classeur = new Workbook();
  await classeur.xlsx.load(corps as ArrayBuffer);
  const feuille = classeur.getWorksheet('Stock');
  const titres: string[] = [];
  feuille
    ?.getRow(1)
    .eachCell((cellule) =>
      titres.push(typeof cellule.value === 'string' ? cellule.value : ''),
    );
  const colonne = titres.indexOf("Coût d'achat de la boîte (GNF)") + 1;
  const lignes: { cout: unknown }[] = [];
  feuille?.eachRow((ligne, numero) => {
    if (numero === 1) return;
    const valeur = ligne.getCell(colonne).value;
    lignes.push({
      cout: valeur === undefined || valeur === '' ? null : valeur,
    });
  });
  return { titres, lignes };
}

const ENTETES_LIVRAISON = [
  'Médicament',
  'Quantité (boîtes)',
  'Prix de la boîte (GNF)',
  "Date d'expiration (AAAA-MM-JJ)",
  'Lot',
  "Coût d'achat de la boîte (GNF)",
  'Notes',
];
const ENTETES_INVENTAIRE = [
  'Médicament',
  'Quantité comptée (boîtes)',
  'Unités en plus (boîte entamée)',
  'Lot',
  "Date d'expiration (AAAA-MM-JJ)",
];
const ENTETES_CATALOGUE = [
  'Nom',
  'Nom générique',
  'Catégorie',
  'Description',
  'Ordonnance requise',
  'Formes',
];

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Chaque profil clôture un jour sans activité différent (une journée vide se clôture, D620).
const JOUR_CLOTURE: Record<Profil, () => string> = {
  titulaire: () => jour(-10),
  vendeur: () => jour(-11),
};

async function classeur(
  feuille: string,
  entetes: string[],
  ligne: unknown[],
): Promise<Buffer> {
  const workbook = new Workbook();
  const f = workbook.addWorksheet(feuille);
  f.addRow(entetes);
  f.addRow(ligne);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const estSucces = (r: request.Response) => r.status >= 200 && r.status < 300;
const donnees = (r: request.Response) =>
  (r.body as { data?: Record<string, unknown> }).data ?? {};

/** Mémorise l'identifiant d'une réponse 2xx. */
function retenir(
  c: Contexte,
  nom: string,
  r: request.Response,
  extraire: (data: Record<string, unknown>) => unknown = (d) => d.id,
): void {
  if (!estSucces(r)) return;
  const valeur = extraire(donnees(r));
  if (typeof valeur === 'string') c.etat[nom] = valeur;
}

describe('Étanchéité des coûts, sur base de test (PB16b, CA22)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let app: INestApplication;
  let controleurs: Type[];
  let ficheF: string;
  let lotF1: string;
  let lotF2: string;
  let medicamentF: string;
  const fiches: Record<
    string,
    { fiche: string; archive: string; medicament: string }
  > = {};

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

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

    controleurs = Reflect.getMetadata('controllers', PharmacieModule) as Type[];
    const fournisseurs = (
      Reflect.getMetadata('providers', PharmacieModule) as Provider[]
    ).filter((p) => p !== PrismaService);
    const module = await Test.createTestingModule({
      controllers: controleurs,
      providers: [
        ...fournisseurs,
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createManyNotifications: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StorageService,
          useValue: { getPublicUrl: (cle: string) => `logo/${cle}` },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{
            headers: Record<string, string>;
            user?: unknown;
          }>();
          const userId = req.headers['x-essai-user'];
          const profil = Object.values(PROFILS).find(
            (p) => p.userId === userId,
          );
          if (!profil) return false;
          req.user = { userId, role: profil.role, structureId: S };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: fabriquerErreurValidation,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();
  });

  afterAll(async () => {
    try {
      // La fermeture de l'application ferme déjà Prisma (onModuleDestroy).
      if (app) await app.close();
      else if (prisma) await fermerPrismaDeTest(prisma);
    } finally {
      if (base) await supprimerBaseDeTest(base);
    }
  });

  async function nouvelleFiche(
    id: string,
    nom: string,
    o: { coef?: number; prix?: number; qualifie?: boolean } = {},
  ): Promise<{ stockId: string; medicamentId: string }> {
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB16b', false, now())`,
      [`etan-med-${id}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "toleranceInventaire", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, null, $6, now())`,
      [
        `etan-stk-${id}`,
        `etan-med-${id}`,
        S,
        o.prix ?? 1000,
        o.coef ?? 1,
        o.qualifie ?? true,
      ],
    );
    return { stockId: `etan-stk-${id}`, medicamentId: `etan-med-${id}` };
  }

  async function preparerDonnees(): Promise<void> {
    await sql(
      'UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval \'60 days\' WHERE "structureId" = $1',
      [S],
    );
    const f = await nouvelleFiche('F', 'Produit étanchéité', {
      coef: 10,
      prix: 8000,
    });
    ficheF = f.stockId;
    medicamentF = f.medicamentId;
    const reception = (await app.get(ReceptionsService).enregistrer(
      S,
      PROFILS.titulaire.userId,
      {
        lignes: [
          {
            stockId: ficheF,
            nombreBoites: 5,
            numeroLot: 'LOT-A',
            dateExpiration: jour(20),
            coutAchatBoite: 5000,
          },
          {
            stockId: ficheF,
            nombreBoites: 5,
            numeroLot: 'LOT-B',
            dateExpiration: jour(200),
            coutAchatBoite: 7000,
          },
        ],
      },
      '127.0.0.1',
    )) as unknown as {
      data: { lots: { id: string; numeroLot: string }[] };
    };
    lotF1 = reception.data.lots.find((l) => l.numeroLot === 'LOT-A')?.id ?? '';
    lotF2 = reception.data.lots.find((l) => l.numeroLot === 'LOT-B')?.id ?? '';
    expect(lotF1).not.toBe('');
    expect(lotF2).not.toBe('');
    for (const p of Object.keys(PROFILS)) {
      const fp = await nouvelleFiche(`F-${p}`, `Fiche produit ${p}`);
      const ap = await nouvelleFiche(`A-${p}`, `Fiche archivage ${p}`);
      await sql(
        `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB16b', false, now())`,
        [`etan-med-M-${p}`, `Médicament upsert ${p}`],
      );
      fiches[p] = {
        fiche: fp.stockId,
        archive: ap.stockId,
        medicament: `etan-med-M-${p}`,
      };
    }
  }

  function contexte(profil: Profil): Contexte {
    const utilisateur = PROFILS[profil].userId;
    return {
      profil,
      en: (methode, chemin) =>
        request(serveur())[methode](chemin).set('x-essai-user', utilisateur),
      anonyme: (chemin) => request(serveur()).get(chemin),
      etat: {},
    };
  }

  const id = (c: Contexte, nom: string) => c.etat[nom] ?? 'inexistant';

  /** Enregistre (idempotent) le poste desktop du profil et le retient. */
  async function enregistrerPosteDesktop(
    c: Contexte,
  ): Promise<request.Response> {
    const r = await c.en('post', `/pharmacie/${S}/postes`).send({
      type: 'DESKTOP',
      appareilId: `etancheite-desktop-${c.profil}`,
    });
    retenir(c, 'posteDesktopId', r);
    return r;
  }

  const APPELS: Record<CleRoutePharmacie, Appel> = {
    'GET /pharmacie/:structureId/referentiels': async (c) => [
      await c.en('get', `/pharmacie/${S}/referentiels`),
    ],
    'GET /pharmacie/:structureId/parametres': async (c) => [
      await c.en('get', `/pharmacie/${S}/parametres`),
    ],
    'PATCH /pharmacie/:structureId/parametres': async (c) => [
      await c
        .en('patch', `/pharmacie/${S}/parametres`)
        .send({ seuilEcartCaisse: 6000 }),
    ],
    'POST /pharmacie/:structureId/postes': async (c) => {
      const r = await c
        .en('post', `/pharmacie/${S}/postes`)
        .send({ type: 'WEB', appareilId: `etancheite-${c.profil}` });
      retenir(c, 'posteId', r);
      return [r];
    },
    'GET /pharmacie/:structureId/postes': async (c) => [
      await c.en('get', `/pharmacie/${S}/postes`),
    ],
    'PATCH /pharmacie/:structureId/postes/:posteId': async (c) => [
      await c
        .en('patch', `/pharmacie/${S}/postes/${id(c, 'posteId')}`)
        .send({ libelle: `Comptoir ${c.profil}` }),
    ],
    'POST /pharmacie/:structureId/postes/:posteId/plages': async (c) => {
      const poste = await enregistrerPosteDesktop(c);
      return [
        poste,
        await c
          .en(
            'post',
            `/pharmacie/${S}/postes/${id(c, 'posteDesktopId')}/plages`,
          )
          .send({ id: randomUUID() }),
      ];
    },
    'GET /pharmacie/:structureId/synchro/catalogue': async (c) => {
      const poste = await enregistrerPosteDesktop(c);
      return [
        poste,
        await c.en(
          'get',
          `/pharmacie/${S}/synchro/catalogue?posteId=${id(c, 'posteDesktopId')}`,
        ),
      ];
    },
    'POST /pharmacie/:structureId/synchro/evenements': async (c) => {
      const poste = await enregistrerPosteDesktop(c);
      return [
        poste,
        await c.en('post', `/pharmacie/${S}/synchro/evenements`).send({
          posteId: id(c, 'posteDesktopId'),
          etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' },
          evenements: [],
        }),
      ];
    },
    'POST /pharmacie/:structureId/caisse/sessions': async (c) => {
      const r = await c
        .en('post', `/pharmacie/${S}/caisse/sessions`)
        .send({ posteId: id(c, 'posteId') });
      retenir(c, 'sessionId', r);
      return [r];
    },
    'GET /pharmacie/:structureId/caisse/sessions/courante': async (c) => [
      await c.en(
        'get',
        `/pharmacie/${S}/caisse/sessions/courante?posteId=${id(c, 'posteId')}`,
      ),
    ],
    'GET /pharmacie/:structureId/caisse/sessions': async (c) => [
      await c.en('get', `/pharmacie/${S}/caisse/sessions`),
    ],
    'POST /pharmacie/:structureId/caisse/sessions/:sessionId/comptages': async (
      c,
    ) => [
      await c
        .en(
          'post',
          `/pharmacie/${S}/caisse/sessions/${id(c, 'sessionId')}/comptages`,
        )
        .send({
          moment: 'OUVERTURE',
          coupures: [{ valeurFaciale: 5000, nombre: 2 }],
        }),
    ],
    'POST /pharmacie/:structureId/caisse/sessions/:sessionId/mouvements':
      async (c) => [
        await c
          .en(
            'post',
            `/pharmacie/${S}/caisse/sessions/${id(c, 'sessionId')}/mouvements`,
          )
          .send({
            type: 'APPORT',
            montant: 5000,
            motif: 'Fond complémentaire',
          }),
      ],
    'GET /pharmacie/:structureId/caisse/sessions/:sessionId/bilan': async (
      c,
    ) => [
      await c.en(
        'get',
        `/pharmacie/${S}/caisse/sessions/${id(c, 'sessionId')}/bilan`,
      ),
    ],
    'POST /pharmacie/:structureId/ventes': async (c) => {
      const r = await c.en('post', `/pharmacie/${S}/ventes`).send({
        posteId: id(c, 'posteId'),
        lignes: [{ stockId: ficheF, quantite: 1 }],
        ordonnanceVerifiee: true,
      });
      retenir(c, 'venteId', r);
      return [r];
    },
    'GET /pharmacie/:structureId/ventes': async (c) => [
      await c.en('get', `/pharmacie/${S}/ventes`),
    ],
    'GET /pharmacie/:structureId/ventes/:venteId': async (c) => [
      await c.en('get', `/pharmacie/${S}/ventes/${id(c, 'venteId')}`),
    ],
    'POST /pharmacie/:structureId/ventes/:venteId/annuler': async (c) => [
      await c
        .en('post', `/pharmacie/${S}/ventes/${id(c, 'venteId')}/annuler`)
        .send({ motif: 'Erreur de saisie', posteId: id(c, 'posteId') }),
    ],
    'POST /pharmacie/:structureId/caisse/sessions/:sessionId/fermer': async (
      c,
    ) => [
      await c
        .en(
          'post',
          `/pharmacie/${S}/caisse/sessions/${id(c, 'sessionId')}/fermer`,
        )
        .send({
          comptageFermeture: {
            coupures: [{ valeurFaciale: 5000, nombre: 3 }],
          },
          commentaire: 'Contrôle de fin de journée',
        }),
    ],
    'GET /pharmacie/:structureId/credits': async (c) => [
      await c.en('get', `/pharmacie/${S}/credits`),
    ],
    'POST /pharmacie/:structureId/credits/clients': async (c) => {
      const r = await c
        .en('post', `/pharmacie/${S}/credits/clients`)
        .send({ nomComplet: `Client crédit ${c.profil}` });
      retenir(c, 'clientCreditId', r);
      return [r];
    },
    'GET /pharmacie/:structureId/credits/clients/:clientId': async (c) => [
      await c.en(
        'get',
        `/pharmacie/${S}/credits/clients/${id(c, 'clientCreditId')}`,
      ),
    ],
    'PATCH /pharmacie/:structureId/credits/clients/:clientId': async (c) => [
      await c
        .en(
          'patch',
          `/pharmacie/${S}/credits/clients/${id(c, 'clientCreditId')}`,
        )
        .send({ note: 'Voisin' }),
    ],
    'PATCH /pharmacie/:structureId/credits/prises/:venteId/date-limite': async (
      c,
    ) => {
      const vente = await c.en('post', `/pharmacie/${S}/ventes`).send({
        posteId: id(c, 'posteId'),
        lignes: [{ stockId: ficheF, quantite: 1 }],
        ordonnanceVerifiee: true,
        clientCreditId: id(c, 'clientCreditId'),
        dateLimiteCredit: jour(30),
      });
      retenir(c, 'venteCreditId', vente);
      return [
        vente,
        await c
          .en(
            'patch',
            `/pharmacie/${S}/credits/prises/${id(c, 'venteCreditId')}/date-limite`,
          )
          .send({ dateLimite: jour(40) }),
      ];
    },
    'POST /pharmacie/:structureId/credits/clients/:clientId/remboursements':
      async (c) => [
        await c
          .en(
            'post',
            `/pharmacie/${S}/credits/clients/${id(c, 'clientCreditId')}/remboursements`,
          )
          .send({ montant: 1000 }),
      ],
    'GET /pharmacie/:structureId/fournisseurs': async (c) => [
      await c.en('get', `/pharmacie/${S}/fournisseurs`),
    ],
    'POST /pharmacie/:structureId/fournisseurs': async (c) => {
      const r = await c
        .en('post', `/pharmacie/${S}/fournisseurs`)
        .send({ nom: `Fournisseur ${c.profil}` });
      retenir(c, 'fournisseurId', r);
      return [r];
    },
    'POST /pharmacie/:structureId/receptions': async (c) => {
      const r = await c.en('post', `/pharmacie/${S}/receptions`).send({
        fournisseurId: id(c, 'fournisseurId'),
        lignes: [
          {
            stockId: ficheF,
            nombreBoites: 1,
            dateExpiration: jour(150),
            coutAchatBoite: 6000,
          },
        ],
      });
      retenir(c, 'receptionId', r);
      return [r];
    },
    'GET /pharmacie/:structureId/receptions': async (c) => [
      await c.en('get', `/pharmacie/${S}/receptions`),
    ],
    'GET /pharmacie/:structureId/receptions/:receptionId': async (c) => [
      await c.en('get', `/pharmacie/${S}/receptions/${id(c, 'receptionId')}`),
    ],
    'GET /pharmacie/:structureId/stock/:stockId/lots': async (c) => [
      await c.en('get', `/pharmacie/${S}/stock/${ficheF}/lots`),
    ],
    'PATCH /pharmacie/:structureId/lots/:lotId': async (c) => [
      await c.en('patch', `/pharmacie/${S}/lots/${lotF2}`).send({
        dateExpiration: jour(c.profil === 'titulaire' ? 201 : 202),
        motif: 'Date relue sur la boîte',
      }),
    ],
    'PATCH /pharmacie/:structureId/stock/:stockId/fiche': async (c) => [
      await c
        .en('patch', `/pharmacie/${S}/stock/${fiches[c.profil].fiche}/fiche`)
        .send({ toleranceInventaire: 2 }),
    ],
    'GET /pharmacie/stock/:structureId': async (c) => [
      await c.en('get', `/pharmacie/stock/${S}`),
    ],
    'POST /pharmacie/stock/:structureId': async (c) => [
      await c.en('post', `/pharmacie/stock/${S}`).send({
        medicamentId: fiches[c.profil].medicament,
        quantite: 5,
        prixUnitaire: 4000,
        dateExpiration: jour(120),
      }),
    ],
    'PATCH /pharmacie/stock/:structureId/:stockId/quantite': async (c) => [
      await c
        .en('patch', `/pharmacie/stock/${S}/${ficheF}/quantite`)
        .send({ variation: 1, lotId: lotF2, motif: 'Boîte retrouvée' }),
    ],
    'DELETE /pharmacie/stock/:structureId/:stockId': async (c) => [
      await c.en('delete', `/pharmacie/stock/${S}/${fiches[c.profil].archive}`),
    ],
    'POST /pharmacie/:structureId/stock/sorties': async (c) => [
      await c.en('post', `/pharmacie/${S}/stock/sorties`).send({
        stockId: ficheF,
        lotId: lotF2,
        unite: 'UNITE',
        quantite: 1,
        raison: 'CASSE',
      }),
    ],
    'POST /pharmacie/:structureId/inventaires': async (c) => {
      const r = await c.en('post', `/pharmacie/${S}/inventaires`).send({
        lignes: [
          {
            stockId: ficheF,
            lotId: lotF1,
            quantiteComptee: c.profil === 'titulaire' ? 41 : 42,
          },
        ],
      });
      retenir(c, 'inventaireId', r);
      retenir(c, 'anomalieId', r, (d) => {
        const anomalies = d.anomalies as { id: string }[] | undefined;
        return anomalies?.[0]?.id;
      });
      return [r];
    },
    'GET /pharmacie/:structureId/inventaires': async (c) => [
      await c.en('get', `/pharmacie/${S}/inventaires`),
    ],
    'GET /pharmacie/:structureId/inventaires/:inventaireId': async (c) => [
      await c.en('get', `/pharmacie/${S}/inventaires/${id(c, 'inventaireId')}`),
    ],
    'GET /pharmacie/:structureId/anomalies': async (c) => [
      await c.en('get', `/pharmacie/${S}/anomalies`),
    ],
    'PATCH /pharmacie/:structureId/anomalies/:anomalieId': async (c) => [
      await c
        .en('patch', `/pharmacie/${S}/anomalies/${id(c, 'anomalieId')}`)
        .send({ commentaire: 'Écart vérifié en rayon' }),
    ],
    'GET /pharmacie/stock/:structureId/export': async (c) => [
      await c
        .en('get', `/pharmacie/stock/${S}/export`)
        .buffer(true)
        .parse((res, cb) => {
          const morceaux: Buffer[] = [];
          res.on('data', (m: Buffer) => morceaux.push(m));
          res.on('end', () => cb(null, Buffer.concat(morceaux)));
        }),
    ],
    'GET /pharmacie/stock/:structureId/import/modele': async (c) => [
      await c.en('get', `/pharmacie/stock/${S}/import/modele?mode=livraison`),
    ],
    'POST /pharmacie/stock/:structureId/import/apercu': async (c) =>
      importsStock(c, `/pharmacie/stock/${S}/import/apercu`),
    'POST /pharmacie/stock/:structureId/import': async (c) =>
      importsStock(c, `/pharmacie/stock/${S}/import`),
    'GET /pharmacie/:structureId/stock/alertes-peremption': async (c) => [
      await c.en('get', `/pharmacie/${S}/stock/alertes-peremption`),
    ],
    'GET /pharmacie/:structureId/rapports/marge': async (c) => [
      await c.en(
        'get',
        `/pharmacie/${S}/rapports/marge?du=${jour(0)}&au=${jour(0)}`,
      ),
    ],
    'GET /pharmacie/:structureId/caisse/clotures/:jour/preparation': async (
      c,
    ) => [
      await c.en(
        'get',
        `/pharmacie/${S}/caisse/clotures/${JOUR_CLOTURE[c.profil]()}/preparation`,
      ),
    ],
    'POST /pharmacie/:structureId/caisse/clotures': async (c) => [
      await c
        .en('post', `/pharmacie/${S}/caisse/clotures`)
        .send({ jour: JOUR_CLOTURE[c.profil]() }),
    ],
    'GET /pharmacie/:structureId/caisse/clotures/:jour/export': async (c) => [
      await c.en(
        'get',
        `/pharmacie/${S}/caisse/clotures/${JOUR_CLOTURE[c.profil]()}/export`,
      ),
    ],
    'GET /pharmacie/:structureId/caisse/clotures': async (c) => [
      await c.en(
        'get',
        `/pharmacie/${S}/caisse/clotures?mois=${JOUR_CLOTURE[c.profil]().slice(0, 7)}`,
      ),
    ],
    'GET /pharmacie/rechercher': async (c) => [
      await c.anonyme(
        `/pharmacie/rechercher?q=${encodeURIComponent('Produit étanchéité')}`,
      ),
    ],
    'GET /pharmacie/catalogue': async (c) => [
      await c.anonyme('/pharmacie/catalogue'),
    ],
    'GET /pharmacie/catalogue/categories': async (c) => [
      await c.anonyme('/pharmacie/catalogue/categories'),
    ],
    'GET /pharmacie/catalogue/:medicamentId': async (c) => [
      await c.anonyme(`/pharmacie/catalogue/${medicamentF}`),
    ],
    'POST /pharmacie/catalogue': async (c) => {
      const r = await c.en('post', '/pharmacie/catalogue').send({
        nom: `Médicament étanchéité ${c.profil}`,
        categorie: 'Test',
        ordonnanceRequise: false,
      });
      retenir(c, 'medicamentId', r);
      return [r];
    },
    'PATCH /pharmacie/catalogue/:medicamentId': async (c) => [
      await c
        .en('patch', `/pharmacie/catalogue/${id(c, 'medicamentId')}`)
        .send({ description: 'Relu par la pharmacie' }),
    ],
    'GET /pharmacie/catalogue/import/modele': async (c) => [
      await c.en('get', '/pharmacie/catalogue/import/modele'),
    ],
    'POST /pharmacie/catalogue/import/apercu': async (c) => [
      await importCatalogue(c, '/pharmacie/catalogue/import/apercu'),
    ],
    'POST /pharmacie/catalogue/import': async (c) => [
      await importCatalogue(c, '/pharmacie/catalogue/import'),
    ],
    'DELETE /pharmacie/catalogue/:medicamentId': async (c) => [
      await c.en('delete', `/pharmacie/catalogue/${id(c, 'medicamentId')}`),
    ],
  };

  async function importsStock(
    c: Contexte,
    chemin: string,
  ): Promise<request.Response[]> {
    const livraison = await classeur('Stock', ENTETES_LIVRAISON, [
      'Produit étanchéité',
      1,
      8000,
      jour(160),
      `LIV-${c.profil}`,
      6000,
      '',
    ]);
    const inventaire = await classeur('Stock', ENTETES_INVENTAIRE, [
      'Produit étanchéité',
      3,
      0,
      'LOT-B',
      '',
    ]);
    const options = { filename: 'stock.xlsx', contentType: MIME_XLSX };
    return [
      await c
        .en('post', chemin)
        .field('mode', 'livraison')
        .attach('fichier', livraison, options),
      await c
        .en('post', chemin)
        .field('mode', 'inventaire')
        .attach('fichier', inventaire, options),
    ];
  }

  async function importCatalogue(
    c: Contexte,
    chemin: string,
  ): Promise<request.Response> {
    const fichier = await classeur('Catalogue', ENTETES_CATALOGUE, [
      `Import étanchéité ${c.profil}`,
      '',
      'Test',
      '',
      'non',
      'comprimé',
    ]);
    return c.en('post', chemin).attach('fichier', fichier, {
      filename: 'catalogue.xlsx',
      contentType: MIME_XLSX,
    });
  }

  const ordre = Object.keys(ROUTES_PHARMACIE) as CleRoutePharmacie[];

  async function jouer(
    profil: Profil,
  ): Promise<{ cle: CleRoutePharmacie; reponses: request.Response[] }[]> {
    const c = contexte(profil);
    const resultats: {
      cle: CleRoutePharmacie;
      reponses: request.Response[];
    }[] = [];
    for (const cle of ordre) {
      resultats.push({ cle, reponses: await APPELS[cle](c) });
    }
    return resultats;
  }

  it("D732 : le Pharmacien par défaut enregistre une réception sans recevoir de coût, et reste refusé sur l'inventaire", async () => {
    const permissions = app.get(PermissionsService);
    const droits = await permissions.getUserPermissions(PROFILS.vendeur.userId);
    expect(droits).toContain(PERMISSIONS.RECEPTION_WRITE);
    expect(droits).not.toContain(PERMISSIONS.INVENTAIRE_WRITE);
    expect(droits).not.toContain(PERMISSIONS.MARGE_READ);

    const fiche = await nouvelleFiche('D732', 'Produit livraison pharmacien');
    const reception = await request(serveur())
      .post(`/pharmacie/${S}/receptions`)
      .set('x-essai-user', PROFILS.vendeur.userId)
      .send({
        lignes: [
          {
            stockId: fiche.stockId,
            nombreBoites: 2,
            dateExpiration: jour(150),
            coutAchatBoite: 6000,
          },
        ],
      });
    expect(estSucces(reception)).toBe(true);
    expect(cheminsCout(reception.body)).toEqual([]);
    const detail = await request(serveur())
      .get(
        `/pharmacie/${S}/receptions/${String((reception.body as { data: { id: string } }).data.id)}`,
      )
      .set('x-essai-user', PROFILS.vendeur.userId);
    expect(detail.status).toBe(200);
    expect(cheminsCout(detail.body)).toEqual([]);
    // Le coût saisi est bien enregistré (lu par le titulaire seulement).
    const cout = await sql(
      `SELECT "coutUnitaire" FROM "LotStock" WHERE "stockMedicamentId" = $1`,
      [fiche.stockId],
    );
    expect(cout.rows).toHaveLength(1);
    expect(Number(cout.rows[0].coutUnitaire)).toBe(6000);

    const inventaire = await request(serveur())
      .post(`/pharmacie/${S}/inventaires`)
      .set('x-essai-user', PROFILS.vendeur.userId)
      .send({ lignes: [{ stockId: fiche.stockId, quantiteComptee: 5 }] });
    expect(inventaire.status).toBe(403);
  });

  it("le Pharmacien par défaut n'a pas marge:read, le titulaire l'a", async () => {
    const permissions = app.get(PermissionsService);
    expect(
      await permissions.getUserPermissions(PROFILS.vendeur.userId),
    ).not.toContain(PERMISSIONS.MARGE_READ);
    expect(
      await permissions.getUserPermissions(PROFILS.titulaire.userId),
    ).toContain(PERMISSIONS.MARGE_READ);

    const codes = PERMISSIONS_AUTORISEES_PHARMACIE.filter(
      (code) => code !== PERMISSIONS.MARGE_READ,
    );
    expect(codes).toHaveLength(21);
    await sql(
      `INSERT INTO "AppRole" ("id", "nom", "structureId", "isSystem", "updatedAt") VALUES ('rol-p1-vendeur-etendu', 'Vendeur étendu (test)', $1, false, now())`,
      [S],
    );
    const permissionsBase = await sql(
      `SELECT "id", "code" FROM "Permission" WHERE "code" = ANY($1)`,
      [codes],
    );
    expect(permissionsBase.rows).toHaveLength(21);
    for (const ligne of permissionsBase.rows) {
      await sql(
        `INSERT INTO "RolePermission" ("appRoleId", "permissionId") VALUES ('rol-p1-vendeur-etendu', $1)`,
        [ligne.id],
      );
    }
    await sql(
      `UPDATE "User" SET "appRoleId" = 'rol-p1-vendeur-etendu' WHERE "id" = $1`,
      [PROFILS.vendeur.userId],
    );
    const etendu = await permissions.getUserPermissions(PROFILS.vendeur.userId);
    for (const code of codes) expect(etendu).toContain(code);
    expect(etendu).not.toContain(PERMISSIONS.MARGE_READ);
  });

  it("l'inventaire est celui des routes réellement montées", async () => {
    await preparerDonnees();
    const montees = routesDesControleurs(controleurs).map((r) => r.cle);
    expect([...montees].sort()).toEqual(Object.keys(ROUTES_PHARMACIE).sort());
    expect(Object.keys(APPELS).sort()).toEqual(
      Object.keys(ROUTES_PHARMACIE).sort(),
    );
  });

  it('contrôle positif : le titulaire reçoit des coûts là où il y en a', async () => {
    for (const { cle, reponses } of await jouer('titulaire')) {
      if (!ROUTES_PHARMACIE[cle].porteCout) continue;
      expect({
        cle,
        statuts: reponses.map((r) => (estSucces(r) ? '2xx' : r.status)),
      }).toEqual({ cle, statuts: reponses.map(() => '2xx') });
      expect({
        cle,
        porteCout: reponses.some((r) => cheminsCout(r.body).length > 0),
      }).toEqual({ cle, porteCout: true });
    }
  });

  it("l'export du stock : coûts remplis pour le titulaire (marge:read), vides pour le vendeur", async () => {
    const titulaire = await jouer('titulaire');
    const reponse = titulaire.find(
      (j) => j.cle === 'GET /pharmacie/stock/:structureId/export',
    )?.reponses[0];
    expect(reponse?.status).toBe(200);
    const { titres, lignes } = await lireClasseurStock(reponse?.body);
    expect(titres).toEqual(ENTETES_LIVRAISON);
    expect(lignes.some((l) => l.cout !== null)).toBe(true);
  });

  it('CA22 : le vendeur ne reçoit aucune donnée de coût ni de marge, route par route', async () => {
    for (const { cle, reponses } of await jouer('vendeur')) {
      const route = ROUTES_PHARMACIE[cle];
      for (const r of reponses) {
        if (route.exigeMarge) {
          expect({ cle, statut: r.status }).toEqual({ cle, statut: 403 });
        } else {
          expect({ cle, succes: estSucces(r), statut: r.status }).toEqual({
            cle,
            succes: true,
            statut: r.status,
          });
        }
        if (route.classe === 'TEXTE') {
          expect(String(r.headers['content-type'])).toContain('text/csv');
          expect({
            cle,
            coutDansTexte: MOTIF_CLE_COUT.test(r.text),
          }).toEqual({ cle, coutDansTexte: false });
          continue;
        }
        if (route.classe === 'CLASSEUR_STOCK') {
          expect(String(r.headers['content-type'])).toContain('spreadsheetml');
          const { lignes } = await lireClasseurStock(r.body);
          expect(lignes.length).toBeGreaterThan(0);
          expect(lignes.filter((l) => l.cout !== null)).toEqual([]);
          continue;
        }
        if (route.classe === 'FICHIER') {
          expect(String(r.headers['content-type'])).toContain('spreadsheetml');
          continue;
        }
        expect({ cle, chemins: cheminsCout(r.body) }).toEqual({
          cle,
          chemins: [],
        });
      }
    }
  });
});
