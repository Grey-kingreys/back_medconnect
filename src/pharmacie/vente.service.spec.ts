import { HttpException } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { StorageService } from 'src/storage/storage.service';
import {
  bornesDuJour,
  formaterNumero,
  jourConakry,
  VenteService,
} from './vente.service';
import { CreerVenteDto } from './dto/vente.dto';

/**
 * Ventes en pharmacie : Prisma est remplacé par un faux EN MÉMOIRE (stocks, ventes,
 * compteur, audit). Le faux ne sérialise pas les transactions : chaque opération cède
 * la main avant de s'appliquer, donc les requêtes simultanées s'entrelacent vraiment.
 * Le retour arrière d'une transaction rejoue les opérations inverses (journal), ce qui
 * reste juste quand une autre transaction a écrit entre-temps.
 */

interface MedicamentFaux {
  id: string;
  nom: string;
  ordonnanceRequise: boolean;
}

interface StockFaux {
  id: string;
  structureId: string;
  medicamentId: string;
  quantite: number;
  prixUnitaire: number | null;
  disponible: boolean;
  dateExpiration: Date | null;
  medicament: MedicamentFaux;
}

interface LigneFausse {
  id: string;
  venteId: string;
  medicamentId: string;
  stockMedicamentId: string;
  nomMedicament: string;
  prixUnitaire: number;
  quantite: number;
  sousTotal: number;
}

interface VenteFausse {
  id: string;
  structureId: string;
  numero: string;
  vendeurId: string;
  vendeurNom: string;
  clientNom: string | null;
  clientTelephone: string | null;
  ordonnanceVerifiee: boolean;
  total: number;
  statut: 'VALIDEE' | 'ANNULEE';
  annuleeLe: Date | null;
  annuleeParId: string | null;
  motifAnnulation: string | null;
  cleIdempotence: string | null;
  createdAt: Date;
  lignes: LigneFausse[];
}

interface AuditFaux {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  ip: string | null;
  metadata: Record<string, unknown>;
}

type Annulation = () => void;
type Condition = Record<string, unknown>;

const cede = () => new Promise<void>((resolve) => setImmediate(resolve));

function correspond(ligne: object, where: Condition): boolean {
  const source = ligne as Record<string, unknown>;
  return Object.entries(where).every(([cle, attendu]) => {
    const valeur = source[cle];
    if (
      attendu !== null &&
      typeof attendu === 'object' &&
      !(attendu instanceof Date)
    ) {
      const c = attendu as { in?: unknown[]; gte?: unknown; lt?: unknown };
      if (c.in) return c.in.includes(valeur);
      if (c.gte !== undefined && !(Number(valeur) >= Number(c.gte)))
        return false;
      if (c.lt !== undefined && !(Number(valeur) < Number(c.lt))) return false;
      return true;
    }
    return valeur === attendu;
  });
}

function copieVente(v: VenteFausse): VenteFausse {
  return { ...v, lignes: v.lignes.map((l) => ({ ...l })) };
}

function erreurCleDejaPresente() {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`structureId`,`cleIdempotence`)',
    {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['structureId', 'cleIdempotence'] },
    },
  );
}

class BaseFausse {
  stocks: StockFaux[] = [];
  ventes: VenteFausse[] = [];
  compteurs = new Map<string, number>();
  audits: AuditFaux[] = [];
  utilisateurs = new Map<
    string,
    { id: string; nom: string; prenom: string; structureId: string | null }
  >();
  structures = new Map<string, Record<string, unknown>>();
  private sequence = 0;

  prochainId(prefixe: string): string {
    this.sequence += 1;
    return `${prefixe}-${this.sequence}`;
  }

  /** API Prisma simulée ; `annuler` reçoit les opérations inverses d'une transaction. */
  api(annuler: Annulation[]) {
    return {
      $queryRaw: async (
        _chaines: TemplateStringsArray,
        ...valeurs: unknown[]
      ) => {
        await cede();
        const cle = `${String(valeurs[0])}:${String(valeurs[1])}`;
        const numero = (this.compteurs.get(cle) ?? 0) + 1;
        this.compteurs.set(cle, numero);
        annuler.push(() =>
          this.compteurs.set(cle, (this.compteurs.get(cle) ?? 1) - 1),
        );
        return [{ dernierNumero: numero }];
      },
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          await cede();
          return this.utilisateurs.get(where.id) ?? null;
        },
        findMany: () => Promise.resolve([{ id: 'u-pharmacien' }]),
      },
      structure: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          await cede();
          return this.structures.get(where.id) ?? null;
        },
      },
      stockMedicament: {
        findMany: async ({ where }: { where: Condition }) => {
          await cede();
          return this.stocks
            .filter((s) => correspond(s, where))
            .map((s) => ({ ...s, medicament: { ...s.medicament } }));
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Condition;
          data: {
            quantite?: number | { decrement?: number; increment?: number };
            disponible?: boolean;
          };
        }) => {
          await cede();
          const touches = this.stocks.filter((s) => correspond(s, where));
          for (const s of touches) {
            const disponibleAvant = s.disponible;
            let delta = 0;
            if (typeof data.quantite === 'number') {
              delta = data.quantite - s.quantite;
            } else if (data.quantite?.decrement !== undefined) {
              delta = -data.quantite.decrement;
            } else if (data.quantite?.increment !== undefined) {
              delta = data.quantite.increment;
            }
            s.quantite += delta;
            if (data.disponible !== undefined) s.disponible = data.disponible;
            annuler.push(() => {
              s.quantite -= delta;
              s.disponible = disponibleAvant;
            });
          }
          return { count: touches.length };
        },
      },
      vente: {
        create: async ({
          data,
        }: {
          data: Omit<VenteFausse, 'id' | 'lignes' | 'createdAt' | 'statut'> & {
            lignes: { create: Omit<LigneFausse, 'id' | 'venteId'>[] };
          };
        }) => {
          await cede();
          if (
            data.cleIdempotence !== null &&
            this.ventes.some(
              (v) =>
                v.structureId === data.structureId &&
                v.cleIdempotence === data.cleIdempotence,
            )
          ) {
            throw erreurCleDejaPresente();
          }
          const id = this.prochainId('vente');
          const { lignes, ...reste } = data;
          const vente: VenteFausse = {
            ...reste,
            id,
            statut: 'VALIDEE',
            annuleeLe: null,
            annuleeParId: null,
            motifAnnulation: null,
            createdAt: new Date(),
            lignes: lignes.create.map((l) => ({
              ...l,
              id: this.prochainId('ligne'),
              venteId: id,
            })),
          };
          this.ventes.push(vente);
          annuler.push(() => {
            this.ventes = this.ventes.filter((v) => v.id !== id);
          });
          return copieVente(vente);
        },
        findUnique: async ({
          where,
        }: {
          where: {
            structureId_cleIdempotence: {
              structureId: string;
              cleIdempotence: string;
            };
          };
        }) => {
          await cede();
          const { structureId, cleIdempotence } =
            where.structureId_cleIdempotence;
          const v = this.ventes.find(
            (x) =>
              x.structureId === structureId &&
              x.cleIdempotence === cleIdempotence,
          );
          return v ? copieVente(v) : null;
        },
        findFirst: async ({ where }: { where: Condition }) => {
          await cede();
          const v = this.ventes.find((x) => correspond(x, where));
          return v ? copieVente(v) : null;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<VenteFausse>;
        }) => {
          await cede();
          const v = this.ventes.find((x) => x.id === where.id);
          if (!v) throw new Error('vente absente');
          Object.assign(v, data);
          return copieVente(v);
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Condition;
          data: Partial<VenteFausse>;
        }) => {
          await cede();
          const touches = this.ventes.filter((v) => correspond(v, where));
          for (const v of touches) {
            const avant = { ...v };
            Object.assign(v, data);
            annuler.push(() => Object.assign(v, avant));
          }
          return { count: touches.length };
        },
        count: async ({ where }: { where: Condition }) => {
          await cede();
          return this.ventes.filter((v) => correspond(v, where)).length;
        },
        aggregate: async ({ where }: { where: Condition }) => {
          await cede();
          const total = this.ventes
            .filter((v) => correspond(v, where))
            .reduce((somme, v) => somme + v.total, 0);
          return { _sum: { total: total === 0 ? null : total } };
        },
        findMany: async ({
          where,
          skip,
          take,
        }: {
          where: Condition;
          skip: number;
          take: number;
        }) => {
          await cede();
          return this.ventes
            .filter((v) => correspond(v, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(skip, skip + take)
            .map(copieVente);
        },
      },
      auditLog: {
        create: async ({ data }: { data: AuditFaux }) => {
          await cede();
          this.audits.push(data);
          annuler.push(() => {
            this.audits = this.audits.filter((a) => a !== data);
          });
          return data;
        },
      },
    };
  }

  prisma() {
    return {
      ...this.api([]),
      $transaction: async <T>(
        corps: (tx: ReturnType<BaseFausse['api']>) => Promise<T>,
      ): Promise<T> => {
        const annuler: Annulation[] = [];
        try {
          return await corps(this.api(annuler));
        } catch (erreur) {
          for (const inverse of annuler.reverse()) inverse();
          throw erreur;
        }
      },
    };
  }
}

describe('VenteService (ventes en pharmacie)', () => {
  const S1 = 's1';
  const ANNEE = new Date().getUTCFullYear();
  const HIER = new Date(Date.now() - 24 * 3600 * 1000);

  let base: BaseFausse;
  let notifications: { createManyNotifications: jest.Mock };
  let service: VenteService;

  const medicament = (
    id: string,
    nom: string,
    ordonnanceRequise = false,
  ): MedicamentFaux => ({ id, nom, ordonnanceRequise });

  function ajouterStock(
    id: string,
    surcharges: Partial<StockFaux> & {
      nom?: string;
      ordonnance?: boolean;
    } = {},
  ): StockFaux {
    const { nom, ordonnance, ...champs } = surcharges;
    const stock: StockFaux = {
      id,
      structureId: S1,
      medicamentId: `med-${id}`,
      quantite: 10,
      prixUnitaire: 1000,
      disponible: true,
      dateExpiration: null,
      medicament: medicament(
        `med-${id}`,
        nom ?? `Médicament ${id}`,
        ordonnance,
      ),
      ...champs,
    };
    base.stocks.push(stock);
    return stock;
  }

  const lignes = (...l: [string, number][]): CreerVenteDto['lignes'] =>
    l.map(([stockId, quantite]) => ({ stockId, quantite }));

  const vendre = (
    l: CreerVenteDto['lignes'],
    extra: Partial<CreerVenteDto> = {},
    cle?: string,
    userId = 'u-vendeur',
    structureId = S1,
  ) =>
    service.creerVente(
      structureId,
      userId,
      { lignes: l, ...extra },
      cle,
      '10.0.0.1',
    );

  async function erreurDe(promesse: Promise<unknown>): Promise<HttpException> {
    try {
      await promesse;
    } catch (e) {
      return e as HttpException;
    }
    throw new Error("L'appel aurait dû échouer");
  }

  const corps = (e: HttpException) =>
    e.getResponse() as Record<string, unknown>;

  const etat = () =>
    JSON.stringify({
      stocks: base.stocks.map((s) => [s.id, s.quantite, s.disponible]),
      ventes: base.ventes.length,
      compteurs: [...base.compteurs].filter(([, n]) => n !== 0),
      audits: base.audits.length,
    });

  beforeEach(() => {
    base = new BaseFausse();
    base.utilisateurs.set('u-vendeur', {
      id: 'u-vendeur',
      nom: 'Keita',
      prenom: 'Ousmane',
      structureId: S1,
    });
    base.utilisateurs.set('u-admin', {
      id: 'u-admin',
      nom: 'Baldé',
      prenom: 'Djénabou',
      structureId: null,
    });
    base.utilisateurs.set('u-autre', {
      id: 'u-autre',
      nom: 'Diallo',
      prenom: 'Fatou',
      structureId: 's2',
    });
    base.utilisateurs.set('u-hopital', {
      id: 'u-hopital',
      nom: 'Camara',
      prenom: 'Moussa',
      structureId: 'h1',
    });
    base.structures.set(S1, {
      id: S1,
      type: 'PHARMACIE',
      adminId: 'u-admin',
      nom: 'Pharmacie de Kaloum',
      adresse: 'Avenue de la République',
      ville: 'Conakry',
      telephone: '+224 621 00 00 00',
      logoFile: { key: 'logos/s1.png' },
    });
    base.structures.set('s2', {
      id: 's2',
      type: 'PHARMACIE',
      adminId: 'u-admin2',
      nom: 'Autre pharmacie',
      logoFile: null,
    });
    base.structures.set('h1', {
      id: 'h1',
      type: 'HOPITAL',
      adminId: 'u-admin3',
      nom: 'Hôpital',
      logoFile: null,
    });
    notifications = { createManyNotifications: jest.fn() };
    const stockage = {
      getPublicUrl: (cle: string) => `https://cdn.test/${cle}`,
    };
    service = new VenteService(
      base.prisma() as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      stockage as unknown as StorageService,
    );
  });

  it('fonctions utilitaires : jour, bornes, numéro', () => {
    expect(jourConakry(new Date('2026-10-22T23:59:59.999Z'))).toBe(
      '2026-10-22',
    );
    const { debut, fin } = bornesDuJour('2026-10-22');
    expect(debut.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(fin.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(formaterNumero(2026, 42)).toBe('V-2026-000042');
  });

  it('1. vente nominale : numéro, montants, stock, reçu, audit, clé jamais renvoyée', async () => {
    ajouterStock('a', { quantite: 10, prixUnitaire: 1500, nom: 'Doliprane' });
    ajouterStock('b', { quantite: 5, prixUnitaire: 2000 });

    const res = await vendre(
      lignes(['a', 2], ['b', 1]),
      { clientNom: ' Mamadou Bah ' },
      'cle-idempotence-1',
    );

    expect(res.success).toBe(true);
    expect(res.message).toBe(`Vente enregistrée (V-${ANNEE}-000001).`);
    expect(res.data).toMatchObject({
      numero: `V-${ANNEE}-000001`,
      statut: 'VALIDEE',
      total: 5000,
      clientNom: 'Mamadou Bah',
      clientTelephone: null,
      ordonnanceVerifiee: false,
      vendeur: { id: 'u-vendeur', nom: 'Ousmane Keita' },
      annuleeLe: null,
      pharmacie: {
        id: S1,
        nom: 'Pharmacie de Kaloum',
        ville: 'Conakry',
        logoUrl: 'https://cdn.test/logos/s1.png',
      },
    });
    expect(res.data.lignes).toHaveLength(2);
    expect(res.data.lignes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stockId: 'a',
          nomMedicament: 'Doliprane',
          prixUnitaire: 1500,
          quantite: 2,
          sousTotal: 3000,
        }),
        expect.objectContaining({ stockId: 'b', sousTotal: 2000 }),
      ]),
    );
    expect(res.data).not.toHaveProperty('cleIdempotence');
    expect(base.stocks.map((s) => s.quantite)).toEqual([8, 4]);
    expect(base.audits).toHaveLength(1);
    expect(base.audits[0]).toMatchObject({
      userId: 'u-vendeur',
      action: 'create',
      entityType: 'Vente',
      ip: '10.0.0.1',
      metadata: { numero: `V-${ANNEE}-000001`, total: 5000, nombreLignes: 2 },
    });
  });

  it('2. deux ventes simultanées de la dernière boîte : une seule réussit', async () => {
    ajouterStock('a', { quantite: 1, nom: 'Doliprane' });

    const resultats = await Promise.allSettled([
      vendre(lignes(['a', 1]), {}, 'cle-simultanee-A'),
      vendre(lignes(['a', 1]), {}, 'cle-simultanee-B'),
    ]);

    const reussies = resultats.filter((r) => r.status === 'fulfilled');
    const refusees = resultats.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(reussies).toHaveLength(1);
    expect(refusees).toHaveLength(1);
    const erreur = refusees[0].reason as HttpException;
    expect(erreur.getStatus()).toBe(409);
    expect(corps(erreur).code).toBe('STOCK_INSUFFISANT');
    expect(corps(erreur).details).toEqual([
      { stockId: 'a', nom: 'Doliprane', disponible: 0, demande: 1 },
    ]);
    expect(base.stocks[0].quantite).toBe(0);
    expect(base.stocks[0].disponible).toBe(false);
    expect(base.ventes).toHaveLength(1);
  });

  it('3. rejeu de la même clé : même vente, un seul retrait', async () => {
    ajouterStock('a', { quantite: 10 });

    const premiere = await vendre(lignes(['a', 3]), {}, 'cle-rejeu-0001');
    const seconde = await vendre(lignes(['a', 3]), {}, 'cle-rejeu-0001');

    expect(seconde.data.id).toBe(premiere.data.id);
    expect(seconde.data).toMatchObject({ rejeu: true });
    expect(premiere.data).not.toHaveProperty('rejeu');
    expect(seconde.message).toBe('Cette vente était déjà enregistrée.');
    expect(base.stocks[0].quantite).toBe(7);
    expect(base.ventes).toHaveLength(1);
  });

  it('4. rejeu simultané de la même clé : une seule vente, même identifiant', async () => {
    ajouterStock('a', { quantite: 10 });

    const [x, y] = await Promise.all([
      vendre(lignes(['a', 2]), {}, 'cle-concurrente'),
      vendre(lignes(['a', 2]), {}, 'cle-concurrente'),
    ]);

    expect(x.data.id).toBe(y.data.id);
    expect(base.ventes).toHaveLength(1);
    expect(base.stocks[0].quantite).toBe(8);
  });

  it('5. clé de plus de 24 h : nouvelle vente, ancienne vente sans clé', async () => {
    ajouterStock('a', { quantite: 10 });
    const ancienne = await vendre(lignes(['a', 1]), {}, 'cle-expiree-01');
    base.ventes[0].createdAt = new Date(Date.now() - 25 * 3600 * 1000);

    const nouvelle = await vendre(lignes(['a', 1]), {}, 'cle-expiree-01');

    expect(nouvelle.data.id).not.toBe(ancienne.data.id);
    expect(nouvelle.data).not.toHaveProperty('rejeu');
    expect(base.ventes).toHaveLength(2);
    expect(base.ventes.find((v) => v.id === ancienne.data.id)).toMatchObject({
      cleIdempotence: null,
    });
    expect(base.stocks[0].quantite).toBe(8);
  });

  describe('6. refus', () => {
    it('STOCK_INTROUVABLE (404) : ligne absente de la pharmacie', async () => {
      ajouterStock('a');
      const avant = etat();

      const e = await erreurDe(vendre(lignes(['a', 1], ['fantome', 1])));

      expect(e.getStatus()).toBe(404);
      expect(corps(e).code).toBe('STOCK_INTROUVABLE');
      expect(corps(e).details).toEqual([{ stockId: 'fantome' }]);
      expect(etat()).toBe(avant);
    });

    it('STOCK_INTROUVABLE : le stock d une autre pharmacie est refusé', async () => {
      ajouterStock('autre', { structureId: 's2' });
      const e = await erreurDe(vendre(lignes(['autre', 1])));
      expect(corps(e).code).toBe('STOCK_INTROUVABLE');
    });

    it('MEDICAMENT_EXPIRE (400) : hier refusé, aujourd hui accepté', async () => {
      ajouterStock('p', { dateExpiration: HIER, nom: 'Périmé' });
      const avant = etat();

      const e = await erreurDe(vendre(lignes(['p', 1])));

      expect(e.getStatus()).toBe(400);
      expect(corps(e).code).toBe('MEDICAMENT_EXPIRE');
      expect(corps(e).details).toEqual([{ stockId: 'p', nom: 'Périmé' }]);
      expect(corps(e).message).toBe(
        'Vente impossible : « Périmé » est périmé. Retirez-le du panier.',
      );
      expect(etat()).toBe(avant);

      ajouterStock('j', { dateExpiration: new Date() });
      await expect(vendre(lignes(['j', 1]))).resolves.toBeDefined();
    });

    it.each([null, 0])('PRIX_MANQUANT (400) : prix %s', async (prix) => {
      ajouterStock('x', { prixUnitaire: prix, nom: 'Sans prix' });
      const avant = etat();

      const e = await erreurDe(vendre(lignes(['x', 1])));

      expect(e.getStatus()).toBe(400);
      expect(corps(e).code).toBe('PRIX_MANQUANT');
      expect(corps(e).details).toEqual([{ stockId: 'x', nom: 'Sans prix' }]);
      expect(etat()).toBe(avant);
    });

    it('ORDONNANCE_NON_CONFIRMEE (400) puis acceptée avec la confirmation', async () => {
      ajouterStock('o', { ordonnance: true, nom: 'Amoxicilline' });
      const avant = etat();

      const e = await erreurDe(vendre(lignes(['o', 1])));

      expect(e.getStatus()).toBe(400);
      expect(corps(e).code).toBe('ORDONNANCE_NON_CONFIRMEE');
      expect(corps(e).details).toEqual([{ stockId: 'o', nom: 'Amoxicilline' }]);
      expect(etat()).toBe(avant);

      const res = await vendre(lignes(['o', 1]), { ordonnanceVerifiee: true });
      expect(res.data.ordonnanceVerifiee).toBe(true);
    });

    it('doublon de stockId : 400 VALIDATION sur le champ lignes', async () => {
      ajouterStock('a');
      const avant = etat();

      const e = await erreurDe(vendre(lignes(['a', 1], ['a', 2])));

      expect(e.getStatus()).toBe(400);
      expect(corps(e).code).toBe('VALIDATION');
      expect(corps(e).champs).toEqual([
        { champ: 'lignes', contraintes: ['stockUnique'] },
      ]);
      expect(etat()).toBe(avant);
    });

    it('total au-delà de 2147483647 : 400 VALIDATION', async () => {
      ajouterStock('a', { quantite: 10000, prixUnitaire: 2147483647 });
      const avant = etat();

      const e = await erreurDe(vendre(lignes(['a', 2])));

      expect(e.getStatus()).toBe(400);
      expect(corps(e).code).toBe('VALIDATION');
      expect(corps(e).champs).toEqual([
        { champ: 'lignes', contraintes: ['totalMaximal'] },
      ]);
      expect(etat()).toBe(avant);
    });
  });

  it('7. stock insuffisant sur une ligne : aucune des deux lignes n est retirée', async () => {
    ajouterStock('a', { quantite: 10 });
    ajouterStock('b', { quantite: 1, nom: 'Rare' });
    const avant = etat();

    const e = await erreurDe(vendre(lignes(['a', 2], ['b', 3])));

    expect(e.getStatus()).toBe(409);
    expect(corps(e).code).toBe('STOCK_INSUFFISANT');
    expect(corps(e).details).toEqual([
      { stockId: 'b', nom: 'Rare', disponible: 1, demande: 3 },
    ]);
    expect(corps(e).message).toBe(
      'Le stock ne suffit plus pour « Rare » : il en reste 1. Ajustez la quantité puis validez de nouveau.',
    );
    expect(etat()).toBe(avant);
    expect(base.stocks.map((s) => s.quantite)).toEqual([10, 1]);
  });

  it('8. numérotation : séquence continue, un refus ne consomme pas de numéro', async () => {
    ajouterStock('a', { quantite: 10 });
    ajouterStock('p', { dateExpiration: HIER });

    const un = await vendre(lignes(['a', 1]));
    await erreurDe(vendre(lignes(['p', 1])));
    const deux = await vendre(lignes(['a', 1]));

    expect((un.data as { numero: string }).numero).toBe(`V-${ANNEE}-000001`);
    expect((deux.data as { numero: string }).numero).toBe(`V-${ANNEE}-000002`);
  });

  describe('9. alerte de stock bas', () => {
    it('passage de 12 à 8 : une notification', async () => {
      ajouterStock('a', { quantite: 12, nom: 'Doliprane' });

      await vendre(lignes(['a', 4]));

      expect(notifications.createManyNotifications).toHaveBeenCalledTimes(1);
      expect(notifications.createManyNotifications).toHaveBeenCalledWith(
        ['u-pharmacien'],
        {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message: 'Le stock de "Doliprane" est descendu à 8 unités.',
        },
      );
    });

    it('passage à 0 : stock épuisé', async () => {
      ajouterStock('a', { quantite: 12, nom: 'Doliprane' });

      await vendre(lignes(['a', 12]));

      expect(notifications.createManyNotifications).toHaveBeenCalledWith(
        ['u-pharmacien'],
        expect.objectContaining({
          message: 'Le stock de "Doliprane" est épuisé.',
        }),
      );
    });

    it('pas d alerte si le stock était déjà bas', async () => {
      ajouterStock('a', { quantite: 9 });
      await vendre(lignes(['a', 2]));
      expect(notifications.createManyNotifications).not.toHaveBeenCalled();
    });

    it('échec de la notification : la vente réussit quand même', async () => {
      ajouterStock('a', { quantite: 12 });
      notifications.createManyNotifications.mockRejectedValue(new Error('x'));

      const res = await vendre(lignes(['a', 4]));

      expect(res.success).toBe(true);
      expect(base.ventes).toHaveLength(1);
    });
  });

  it('10. annulation : statut, traces, stock remis, audit sans motif', async () => {
    ajouterStock('a', { quantite: 5 });
    const vente = await vendre(lignes(['a', 5]), {
      clientNom: 'Client secret',
    });
    expect(base.stocks[0]).toMatchObject({ quantite: 0, disponible: false });

    const res = await service.annulerVente(
      S1,
      vente.data.id,
      'u-admin',
      { motif: 'Erreur de quantité' },
      '10.0.0.2',
    );

    expect(res.data).toMatchObject({
      statut: 'ANNULEE',
      annuleeParId: 'u-admin',
      motifAnnulation: 'Erreur de quantité',
    });
    expect(res.data.annuleeLe).toBeInstanceOf(Date);
    expect(res.message).toBe(
      `Vente ${vente.data.numero} annulée. Les quantités ont été remises en stock.`,
    );
    expect(base.stocks[0]).toMatchObject({ quantite: 5, disponible: true });
    const audit = base.audits[1];
    expect(audit).toMatchObject({
      userId: 'u-admin',
      action: 'annuler',
      entityType: 'Vente',
      ip: '10.0.0.2',
      metadata: {
        numero: vente.data.numero,
        total: 5000,
        lignesNonRemises: 0,
      },
    });
    const texteAudit = JSON.stringify(audit);
    expect(texteAudit).not.toContain('Erreur de quantité');
    expect(texteAudit).not.toContain('Client secret');
  });

  describe('11. annulation refusée ou partielle', () => {
    it('déjà annulée : 409 VENTE_DEJA_ANNULEE, même si la vente date d hier', async () => {
      ajouterStock('a', { quantite: 5 });
      const vente = await vendre(lignes(['a', 1]));
      await service.annulerVente(S1, vente.data.id, 'u-admin', {
        motif: 'Erreur',
      });
      base.ventes[0].createdAt = HIER;

      const e = await erreurDe(
        service.annulerVente(S1, vente.data.id, 'u-admin', { motif: 'Erreur' }),
      );

      expect(e.getStatus()).toBe(409);
      expect(corps(e).code).toBe('VENTE_DEJA_ANNULEE');
      expect(base.stocks[0].quantite).toBe(5);
    });

    it('vente d hier : 409 ANNULATION_HORS_DELAI', async () => {
      ajouterStock('a', { quantite: 5 });
      const vente = await vendre(lignes(['a', 1]));
      base.ventes[0].createdAt = HIER;

      const e = await erreurDe(
        service.annulerVente(S1, vente.data.id, 'u-admin', { motif: 'Erreur' }),
      );

      expect(e.getStatus()).toBe(409);
      expect(corps(e).code).toBe('ANNULATION_HORS_DELAI');
      expect(base.ventes[0].statut).toBe('VALIDEE');
      expect(base.stocks[0].quantite).toBe(4);
    });

    it('annulations simultanées : une seule remise en stock', async () => {
      ajouterStock('a', { quantite: 5 });
      const vente = await vendre(lignes(['a', 2]));

      const resultats = await Promise.allSettled([
        service.annulerVente(S1, vente.data.id, 'u-admin', { motif: 'Erreur' }),
        service.annulerVente(S1, vente.data.id, 'u-admin', { motif: 'Erreur' }),
      ]);

      expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(base.stocks[0].quantite).toBe(5);
    });

    it('ligne de stock supprimée : annulation réussie, ligne non remise signalée', async () => {
      ajouterStock('a', { quantite: 5 });
      ajouterStock('b', { quantite: 5 });
      const vente = await vendre(lignes(['a', 1], ['b', 1]));
      base.stocks = base.stocks.filter((s) => s.id !== 'b');

      const res = await service.annulerVente(S1, vente.data.id, 'u-admin', {
        motif: 'Erreur',
      });

      expect(res.data.statut).toBe('ANNULEE');
      expect(res.message).toBe(
        `Vente ${vente.data.numero} annulée. 1 médicament n'était plus dans le stock et n'y a pas été remis.`,
      );
      expect(base.audits[1].metadata).toMatchObject({ lignesNonRemises: 1 });
      expect(base.stocks[0].quantite).toBe(5);
    });
  });

  describe('12. accès', () => {
    it('utilisateur d une autre pharmacie : 403', async () => {
      ajouterStock('a');
      const e = await erreurDe(
        vendre(lignes(['a', 1]), {}, undefined, 'u-autre'),
      );
      expect(e.getStatus()).toBe(403);
      expect(e.message).toBe(
        "Vous n'avez pas accès aux ventes de cette pharmacie.",
      );
    });

    it('structure de type HOPITAL : 403', async () => {
      const e = await erreurDe(service.listerVentes('h1', 'u-hopital', {}));
      expect(e.getStatus()).toBe(403);
    });

    it('l administrateur de la pharmacie, non rattaché, a accès', async () => {
      const res = await service.listerVentes(S1, 'u-admin', {});
      expect(res.success).toBe(true);
    });

    it('vente d une autre pharmacie en détail : 404', async () => {
      ajouterStock('z', { structureId: 's2' });
      base.utilisateurs.set('u-s2', {
        id: 'u-s2',
        nom: 'N',
        prenom: 'P',
        structureId: 's2',
      });
      const autre = await service.creerVente(
        's2',
        'u-s2',
        { lignes: lignes(['z', 1]) },
        undefined,
        null,
      );

      const e = await erreurDe(
        service.detailVente(S1, autre.data.id, 'u-vendeur'),
      );

      expect(e.getStatus()).toBe(404);
      expect(e.message).toBe('Cette vente est introuvable.');
    });

    it('structure inexistante : 404', async () => {
      const e = await erreurDe(
        service.listerVentes('nulle-part', 'u-vendeur', {}),
      );
      expect(e.getStatus()).toBe(404);
    });
  });

  it('reçu : détail et annulation renvoient la pharmacie complète', async () => {
    ajouterStock('a', { quantite: 5 });
    const attendu = {
      id: S1,
      nom: 'Pharmacie de Kaloum',
      adresse: 'Avenue de la République',
      ville: 'Conakry',
      telephone: '+224 621 00 00 00',
      logoUrl: 'https://cdn.test/logos/s1.png',
    };
    const vente = await vendre(lignes(['a', 1]));

    const detail = await service.detailVente(S1, vente.data.id, 'u-vendeur');
    expect(detail.data.pharmacie).toEqual(attendu);

    const annulee = await service.annulerVente(
      S1,
      vente.data.id,
      'u-admin',
      { motif: 'Test de reçu' },
      null,
    );
    expect(annulee.data.pharmacie).toEqual(attendu);
  });

  it('reçu sans logo : logoUrl null, champs absents null', async () => {
    ajouterStock('z', { structureId: 's2' });
    base.utilisateurs.set('u-s2', {
      id: 'u-s2',
      nom: 'N',
      prenom: 'P',
      structureId: 's2',
    });

    const vente = await service.creerVente(
      's2',
      'u-s2',
      { lignes: lignes(['z', 1]) },
      undefined,
      null,
    );

    expect(vente.data.pharmacie).toEqual({
      id: 's2',
      nom: 'Autre pharmacie',
      adresse: null,
      ville: null,
      telephone: null,
      logoUrl: null,
    });
  });

  describe('13. liste du jour', () => {
    it('totalJour ne compte que les validées, nombre compte tout', async () => {
      ajouterStock('a', { quantite: 50, prixUnitaire: 1000 });
      ajouterStock('b', { quantite: 50, prixUnitaire: 500 });
      await vendre(lignes(['a', 2], ['b', 3]));
      const annulee = await vendre(lignes(['a', 5]));
      await service.annulerVente(S1, annulee.data.id, 'u-admin', {
        motif: 'Erreur',
      });

      const res = await service.listerVentes(S1, 'u-vendeur', {});

      expect(res.data).toMatchObject({
        date: jourConakry(new Date()),
        totalJour: 3500,
        nombre: 2,
        page: 1,
        parPage: 50,
        totalPages: 1,
      });
      expect(res.data.ventes).toHaveLength(2);
      expect(res.data.ventes.map((v) => v.nombreArticles).sort()).toEqual([
        5, 5,
      ]);
      expect(res.data.ventes[0]).toEqual(
        expect.objectContaining({
          vendeur: { id: 'u-vendeur', nom: 'Ousmane Keita' },
          clientNom: null,
        }),
      );
      expect(res.message).toBe(`2 vente(s) le ${jourConakry(new Date())}.`);
    });

    it('un autre jour est vide', async () => {
      ajouterStock('a');
      await vendre(lignes(['a', 1]));

      const res = await service.listerVentes(S1, 'u-vendeur', {
        date: '2020-01-01',
      });

      expect(res.data).toMatchObject({ totalJour: 0, nombre: 0, ventes: [] });
    });

    it('date invalide 2026-02-31 : 400 VALIDATION sur le champ date', async () => {
      const e = await erreurDe(
        service.listerVentes(S1, 'u-vendeur', { date: '2026-02-31' }),
      );
      expect(e.getStatus()).toBe(400);
      expect(corps(e).code).toBe('VALIDATION');
      expect(corps(e).champs).toEqual([
        { champ: 'date', contraintes: ['dateValide'] },
      ]);
    });
  });
});
