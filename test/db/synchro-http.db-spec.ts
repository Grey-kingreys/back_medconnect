import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  ClassSerializerInterceptor,
  ExecutionContext,
  Provider,
  Type,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { monterAnalyseursJson } from 'src/config/analyseurs-corps';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { fabriquerErreurValidation } from 'src/common/filters/erreur-validation';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PERMISSIONS_AUTORISEES_PHARMACIE } from 'src/common/rbac/permissions-type-structure';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { SortiesStockService } from 'src/pharmacie/inventaires/sorties.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { PharmacieModule } from 'src/pharmacie/pharmacie.module';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { MESSAGE_CATALOGUE_POSTE_WEB } from 'src/pharmacie/synchro/catalogue-synchro.service';
import { StorageService } from 'src/storage/storage.service';
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

const S = 'str-pharma-1';
const PROFILS = {
  titulaire: { userId: 'usr-admin-p1', role: 'STRUCTURE_ADMIN' },
  vendeur: { userId: 'usr-pharm-p1', role: 'PHARMACIEN' },
} as const;
type Profil = keyof typeof PROFILS;

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface LotRep {
  id: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  solde: number;
  coefficientReception: number;
}
interface FicheRep {
  stockId: string;
  quantite: number;
  prixUnitaire: number | null;
  lots: LotRep[];
}
interface Photographie {
  data: {
    poste: {
      code: string;
      sequenceAppliquee: number;
      sequenceMaxRecue: number;
      plages: { id: string; debut: number; fin: number }[];
    };
    parametres: Record<string, unknown>;
    fiches: FicheRep[];
  };
}

describe('Photographie du catalogue en HTTP, sur base de test (PB18a)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let app: NestExpressApplication;
  let D: string;
  let ficheF: string;
  let ficheG: string;
  let ficheH: string;
  let etag = '';

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

  const en = (
    profil: Profil,
    methode: 'get' | 'post' | 'patch' | 'delete',
    chemin: string,
  ) =>
    request(serveur())
      [methode](chemin)
      .set('x-essai-user', PROFILS[profil].userId);

  const photographier = (
    profil: Profil,
    posteId: string,
    entetes: Record<string, string> = {},
  ) => {
    let r = en(
      profil,
      'get',
      `/pharmacie/${S}/synchro/catalogue?posteId=${posteId}`,
    );
    for (const [nom, valeur] of Object.entries(entetes)) r = r.set(nom, valeur);
    return r;
  };

  const enregistrerPoste = async (
    type: 'WEB' | 'DESKTOP',
    appareil: string,
  ) => {
    const r = await en('titulaire', 'post', `/pharmacie/${S}/postes`).send({
      type,
      appareilId: appareil,
    });
    expect(r.status).toBe(200);
    return (r.body as { data: { id: string } }).data.id;
  };

  async function nouvelleFiche(id: string, nom: string): Promise<string> {
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB18a', false, now())`,
      [`syn-med-${id}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 8000, 10, true, now())`,
      [`syn-stk-${id}`, `syn-med-${id}`, S],
    );
    return `syn-stk-${id}`;
  }

  async function recevoir(
    lignes: {
      stockId: string;
      nombreBoites: number;
      numeroLot: string;
      dateExpiration: string;
      coutAchatBoite: number;
    }[],
  ): Promise<{ id: string; numeroLot: string }[]> {
    const reception = (await app
      .get(ReceptionsService)
      .enregistrer(
        S,
        PROFILS.titulaire.userId,
        { lignes },
        '127.0.0.1',
      )) as unknown as { data: { lots: { id: string; numeroLot: string }[] } };
    return reception.data.lots;
  }

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

    const controleurs = Reflect.getMetadata(
      'controllers',
      PharmacieModule,
    ) as Type[];
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
    app = module.createNestApplication<NestExpressApplication>();
    // Mêmes analyseurs que main.ts (D663).
    monterAnalyseursJson(app);
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

    expect(PERMISSIONS_AUTORISEES_PHARMACIE).toContain('caisse:utiliser');

    await sql(
      'UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval \'60 days\' WHERE "structureId" = $1',
      [S],
    );

    // Fiche F : deux lots de 5 boîtes (coefficient 10), le premier corrigé à J-3.
    ficheF = await nouvelleFiche('F', 'Produit photographié');
    const lotsF = await recevoir([
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
    ]);
    const lotA = lotsF.find((l) => l.numeroLot === 'LOT-A')?.id ?? '';
    const correction = await en(
      'titulaire',
      'patch',
      `/pharmacie/${S}/lots/${lotA}`,
    ).send({ dateExpiration: jour(-3), motif: 'Correction pour le test' });
    expect(correction.status).toBe(200);

    // Fiche G archivée avec un lot.
    ficheG = await nouvelleFiche('G', 'Produit archivé');
    await recevoir([
      {
        stockId: ficheG,
        nombreBoites: 2,
        numeroLot: 'LOT-G',
        dateExpiration: jour(100),
        coutAchatBoite: 3000,
      },
    ]);
    const archivage = await en(
      'titulaire',
      'delete',
      `/pharmacie/stock/${S}/${ficheG}`,
    );
    expect(archivage.status).toBe(200);

    // Fiche H dont l'unique lot est entièrement sorti.
    ficheH = await nouvelleFiche('H', 'Produit épuisé');
    const lotsH = await recevoir([
      {
        stockId: ficheH,
        nombreBoites: 3,
        numeroLot: 'LOT-H',
        dateExpiration: jour(100),
        coutAchatBoite: 3000,
      },
    ]);
    await app.get(SortiesStockService).enregistrer(
      S,
      PROFILS.titulaire.userId,
      {
        stockId: ficheH,
        lotId: lotsH[0].id,
        unite: 'UNITE',
        quantite: 30,
        raison: 'CASSE',
      },
      '127.0.0.1',
    );

    D = await enregistrerPoste('DESKTOP', 'desktop-synchro-1');
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
      else if (prisma) await fermerPrismaDeTest(prisma);
    } finally {
      if (base) await supprimerBaseDeTest(base);
    }
  });

  it('1. photographie sans aucun coût', async () => {
    const res = await photographier('titulaire', D, {
      'Accept-Encoding': 'gzip',
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    etag = String(res.headers.etag);
    expect(etag.startsWith('W/"')).toBe(true);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(String(res.headers.vary)).toContain('Accept-Encoding');

    const { data } = res.body as Photographie;
    expect(data.poste.code).toBe('D1');
    expect(data.poste.sequenceAppliquee).toBe(0);
    expect(data.poste.sequenceMaxRecue).toBe(0);
    expect(data.poste.plages).toEqual([]);
    expect(Object.keys(data.parametres).sort()).toEqual(
      [
        'debutCaisse',
        'horizonsPeremptionJours',
        'seuilAvertissementPrixPct',
        'seuilEcartCaisse',
        'seuilRechargementPlagePct',
        'seuilStockBas',
        'taillePlageTickets',
      ].sort(),
    );

    const f = data.fiches.find((x) => x.stockId === ficheF);
    expect(f?.quantite).toBe(100);
    expect(f?.lots.map((l) => l.dateExpiration)).toEqual([jour(-3), jour(200)]);
    expect(f?.lots.map((l) => l.solde)).toEqual([50, 50]);
    expect(f?.lots.every((l) => l.coefficientReception === 10)).toBe(true);

    expect(cheminsCout(res.body)).toEqual([]);
    const vendeur = await photographier('vendeur', D);
    expect(vendeur.status).toBe(200);
    expect(cheminsCout(vendeur.body)).toEqual([]);
  });

  it('2. fiche archivée et lot épuisé exclus', async () => {
    const { data } = (await photographier('titulaire', D)).body as Photographie;
    expect(data.fiches.find((x) => x.stockId === ficheG)).toBeUndefined();
    const h = data.fiches.find((x) => x.stockId === ficheH);
    expect(h).toBeDefined();
    expect(h?.lots).toEqual([]);
    expect(h?.quantite).toBe(0);
  });

  it('3. 304 si rien n a changé', async () => {
    const res = await photographier('titulaire', D, { 'If-None-Match': etag });
    expect(res.status).toBe(304);
    expect(res.text ?? '').toBe('');
    const liste = await photographier('titulaire', D, {
      'If-None-Match': `"x", ${etag}`,
    });
    expect(liste.status).toBe(304);
  });

  it('4. l ETag change avec le catalogue', async () => {
    const patch = await en(
      'titulaire',
      'patch',
      `/pharmacie/${S}/stock/${ficheF}/fiche`,
    ).send({ prixUnitaire: 9000 });
    expect(patch.status).toBe(200);
    const res = await photographier('titulaire', D, { 'If-None-Match': etag });
    expect(res.status).toBe(200);
    expect(String(res.headers.etag)).not.toBe(etag);
    etag = String(res.headers.etag);
  });

  it('5. encodage choisi', async () => {
    const br = await photographier('titulaire', D, {
      'Accept-Encoding': 'br, gzip',
    });
    expect(br.status).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    const brut = await photographier('titulaire', D, {
      'Accept-Encoding': 'identity',
    });
    expect(brut.status).toBe(200);
    expect(brut.headers['content-encoding']).toBeUndefined();
    expect((brut.body as Photographie).data.poste.code).toBe('D1');
  });

  it('6. postes refusés', async () => {
    const web = await enregistrerPoste('WEB', 'navigateur-synchro-1');
    const refuse = await photographier('titulaire', web);
    expect(refuse.status).toBe(409);
    expect((refuse.body as { code: string }).code).toBe('POSTE_INCONNU');
    expect((refuse.body as { message: string }).message).toBe(
      MESSAGE_CATALOGUE_POSTE_WEB,
    );

    const inconnu = await photographier('titulaire', randomUUID());
    expect(inconnu.status).toBe(409);
    expect((inconnu.body as { code: string }).code).toBe('POSTE_INCONNU');

    const inactif = await enregistrerPoste('DESKTOP', 'desktop-synchro-2');
    const desactive = await en(
      'titulaire',
      'patch',
      `/pharmacie/${S}/postes/${inactif}`,
    ).send({ actif: false });
    expect(desactive.status).toBe(200);
    const res = await photographier('titulaire', inactif);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('POSTE_INCONNU');
  });

  it('7. plages et séquences dans la photographie', async () => {
    const id = randomUUID();
    const premiere = await en(
      'titulaire',
      'post',
      `/pharmacie/${S}/postes/${D}/plages`,
    ).send({ id });
    expect(premiere.status).toBe(200);
    expect((premiere.body as { data: { cree: boolean } }).data.cree).toBe(true);
    const rejeu = await en(
      'titulaire',
      'post',
      `/pharmacie/${S}/postes/${D}/plages`,
    ).send({ id });
    expect(rejeu.status).toBe(200);
    expect((rejeu.body as { data: { cree: boolean } }).data.cree).toBe(false);

    await sql(
      `INSERT INTO "EvenementSynchro" ("id","evenementId","posteId","sequence","type","utilisateurId","statut","empreinte","corps") VALUES ($1,$2,$3,5,'VENTE',$4,'EN_ATTENTE','empreinte-essai','{}'::jsonb)`,
      [randomUUID(), randomUUID(), D, PROFILS.titulaire.userId],
    );

    const { data } = (await photographier('titulaire', D)).body as Photographie;
    expect(data.poste.plages.map((p) => p.id)).toEqual([id]);
    expect(data.poste.sequenceMaxRecue).toBe(5);
    expect(data.poste.sequenceAppliquee).toBe(0);
  });

  const battement = (posteId: string) => ({
    posteId,
    etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' },
    evenements: [],
  });

  it('8. corps compressé gzip', async () => {
    const poste = await enregistrerPoste('DESKTOP', 'desktop-synchro-gzip');
    const r = await en(
      'titulaire',
      'post',
      `/pharmacie/${S}/synchro/evenements`,
    )
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      // Sans sérialiseur neutre, superagent réécrit le Buffer en JSON.
      .serialize((corps: unknown) => corps as string)
      .send(gzipSync(JSON.stringify(battement(poste))) as unknown as object);
    expect(r.status).toBe(200);
    expect(
      (r.body as { data: { resultats: unknown[] } }).data.resultats,
    ).toEqual([]);
  });

  it('9. lot de 1,5 Mo accepté, 2,5 Mo refusé', async () => {
    const poste = await enregistrerPoste('DESKTOP', 'desktop-synchro-gros');
    const lot = (taille: number) => ({
      ...battement(poste),
      evenements: Array.from({ length: 200 }, (_, i) => ({
        evenementId: randomUUID(),
        sequence: 1001 + i,
        type: 'VENTE',
        horodatageLocal: new Date().toISOString(),
        utilisateurId: PROFILS.titulaire.userId,
        corps: { texte: 'x'.repeat(taille) },
      })),
    });
    const accepte = await en(
      'titulaire',
      'post',
      `/pharmacie/${S}/synchro/evenements`,
    ).send(lot(7_500));
    expect(accepte.status).toBe(200);
    const resultats = (
      accepte.body as { data: { resultats: { statut: string }[] } }
    ).data.resultats;
    expect(resultats).toHaveLength(200);
    expect(resultats.every((x) => x.statut === 'EN_ATTENTE')).toBe(true);

    const refuse = await en(
      'titulaire',
      'post',
      `/pharmacie/${S}/synchro/evenements`,
    ).send(lot(12_500));
    expect(refuse.status).toBe(413);
  });

  it('10. enveloppe refusée', async () => {
    const poste = await enregistrerPoste('DESKTOP', 'desktop-synchro-env');
    const evenement = (
      sequence: number,
      evenementId: string = randomUUID(),
    ) => ({
      evenementId,
      sequence,
      type: 'VENTE',
      horodatageLocal: new Date().toISOString(),
      utilisateurId: PROFILS.titulaire.userId,
      corps: {},
    });
    const envoyer = (corps: unknown) =>
      en('titulaire', 'post', `/pharmacie/${S}/synchro/evenements`).send(
        corps as object,
      );

    const mauvaisId = await envoyer({
      ...battement(poste),
      evenements: [evenement(1, 'pas-un-uuid')],
    });
    expect(mauvaisId.status).toBe(400);
    expect((mauvaisId.body as { code: string }).code).toBe('VALIDATION');

    const trop = await envoyer({
      ...battement(poste),
      evenements: Array.from({ length: 201 }, (_, i) => evenement(i + 1)),
    });
    expect(trop.status).toBe(400);
    expect((trop.body as { code: string }).code).toBe('VALIDATION');

    const sansEtat = await envoyer({ posteId: poste, evenements: [] });
    expect(sansEtat.status).toBe(400);
    expect((sansEtat.body as { code: string }).code).toBe('VALIDATION');

    const web = await enregistrerPoste('WEB', 'navigateur-synchro-2');
    const refuse = await envoyer(battement(web));
    expect(refuse.status).toBe(409);
    expect((refuse.body as { code: string }).code).toBe('POSTE_INCONNU');

    const nul = await envoyer({
      ...battement(poste),
      etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1\u0000' },
    });
    expect(nul.status).toBe(400);
    expect((nul.body as { code: string }).code).toBe('VALIDATION');
  });

  it('11. 2 Mo et gzip sur la seule route de synchro (D663)', async () => {
    const poste = await enregistrerPoste('DESKTOP', 'desktop-synchro-limite');
    const chemin = `/pharmacie/${S}/postes/${poste}/plages`;
    // Plus de 100 ko sur une autre route JSON : refusé avant toute garde.
    const gros = await en('titulaire', 'post', chemin).send({
      id: randomUUID(),
      bourrage: 'x'.repeat(150_000),
    });
    expect(gros.status).toBe(413);
    // Corps compressé sur une autre route : refusé.
    const compresse = await en('titulaire', 'post', chemin)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .serialize((corps: unknown) => corps as string)
      .send(
        gzipSync(JSON.stringify({ id: randomUUID() })) as unknown as object,
      );
    expect(compresse.status).toBe(415);
    // Un petit corps y reste lu normalement (lu une seule fois).
    const normal = await en('titulaire', 'post', chemin).send({
      id: randomUUID(),
    });
    expect(normal.status).toBe(200);
    // La route de synchro accepte toujours plus de 100 ko.
    const synchro = await en(
      'titulaire',
      'post',
      `/pharmacie/${S}/synchro/evenements`,
    ).send({
      ...battement(poste),
      evenements: [
        {
          evenementId: randomUUID(),
          sequence: 5000,
          type: 'VENTE',
          horodatageLocal: new Date().toISOString(),
          utilisateurId: PROFILS.titulaire.userId,
          corps: { texte: 'x'.repeat(150_000) },
        },
      ],
    });
    expect(synchro.status).toBe(200);
  });
});
