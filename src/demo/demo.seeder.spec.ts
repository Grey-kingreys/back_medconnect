import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from 'src/common/services/encryption.service';
import { DemoSeeder } from './demo.seeder';
import {
  ANALYSES_DEMO,
  COMPTES_DEMO,
  CONSULTATIONS_DEMO,
  RENDEZ_VOUS_DEMO,
  STRUCTURES_DEMO,
  URGENCES_DEMO,
} from './demo.donnees';

// Hachage simulé : le coût réel (12) ralentirait le test sans rien prouver de plus.
jest.mock('bcrypt', () => ({
  hash: jest.fn((valeur: string) => Promise.resolve(`hash:${valeur}`)),
}));

const FORMAT_CHIFFRE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/i;

type Modele = Record<string, jest.Mock>;
type PrismaSimule = Record<string, Modele> & { $transaction: jest.Mock };

/**
 * Doublure Prisma : chaque modèle est créé à la demande, chaque méthode est un
 * jest.fn. Lectures vides par défaut (`count` 0, `findFirst` null, `findMany` []).
 */
function creerPrisma(): PrismaSimule {
  const modeles: Record<string, Modele> = {};
  const methode = (nom: string): jest.Mock => {
    if (nom === 'count') return jest.fn().mockResolvedValue(0);
    if (nom === 'findFirst' || nom === 'findUnique')
      return jest.fn().mockResolvedValue(null);
    if (nom === 'findMany') return jest.fn().mockResolvedValue([]);
    return jest.fn().mockResolvedValue({ id: `id-${nom}` });
  };
  // `then` et les symboles restent indéfinis : la doublure ne doit pas passer pour une promesse.
  const ignore = (cle: string | symbol): cle is symbol | 'then' =>
    typeof cle === 'symbol' || cle === 'then';
  const prisma = new Proxy({} as PrismaSimule, {
    get(_cible, cle: string | symbol) {
      if (ignore(cle)) return undefined;
      if (cle === '$transaction') return transaction;
      modeles[cle] ??= new Proxy({} as Modele, {
        get(m, nom: string | symbol) {
          if (ignore(nom)) return undefined;
          m[nom] ??= methode(nom);
          return m[nom];
        },
      });
      return modeles[cle];
    },
  });
  const transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn(prisma),
  );
  return prisma;
}

/** Données passées au premier appel d'une méthode `createMany` ou `create`. */
const donnees = <T>(mock: jest.Mock, appel = 0): T =>
  (mock.mock.calls[appel] as [{ data: T }])[0].data;

describe('DemoSeeder', () => {
  const valeurInitiale = process.env.DEMO_MODE;
  let prisma: PrismaSimule;
  let encryption: EncryptionService;
  let rolesService: {
    resolveAssignableRoleId: jest.Mock;
    seedStructureDefaultRoles: jest.Mock;
  };
  let permissionsService: { invalidateUser: jest.Mock };
  let seeder: DemoSeeder;

  beforeEach(() => {
    prisma = creerPrisma();
    encryption = new EncryptionService({
      get: () => 'a'.repeat(64),
    } as unknown as ConfigService);
    rolesService = {
      resolveAssignableRoleId: jest.fn().mockResolvedValue('role-systeme'),
      seedStructureDefaultRoles: jest.fn().mockResolvedValue(undefined),
    };
    permissionsService = {
      invalidateUser: jest.fn().mockResolvedValue(undefined),
    };
    seeder = new DemoSeeder(
      prisma as never,
      encryption,
      rolesService as never,
      permissionsService as never,
    );
  });

  afterEach(() => {
    if (valeurInitiale === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = valeurInitiale;
  });

  it.each([undefined, 'false', 'oui'])(
    'mode inactif (DEMO_MODE=%s) : ne touche jamais à la base',
    async (valeur) => {
      if (valeur === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = valeur;

      await seeder.onApplicationBootstrap();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.createMany).not.toHaveBeenCalled();
      expect(rolesService.resolveAssignableRoleId).not.toHaveBeenCalled();
    },
  );

  describe('mode actif', () => {
    beforeEach(() => {
      process.env.DEMO_MODE = 'true';
    });

    it('ne crée rien si des comptes démo existent déjà (idempotent)', async () => {
      prisma.user.count.mockResolvedValue(3);

      expect(await seeder.creerJeuDeDonnees()).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.createMany).not.toHaveBeenCalled();
    });

    it('ne crée rien si une structure démo existe déjà', async () => {
      prisma.structure.count.mockResolvedValue(1);

      expect(await seeder.creerJeuDeDonnees()).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crée tout le jeu de données dans une seule transaction', async () => {
      expect(await seeder.creerJeuDeDonnees()).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const structures = donnees<{ email: string; horaires: string }[]>(
        prisma.structure.createMany,
      );
      expect(structures).toHaveLength(STRUCTURES_DEMO.length);
      expect(
        structures.every((s) => s.email.endsWith('@demo.medconnecte.gn')),
      ).toBe(true);
      expect(() => JSON.parse(structures[0].horaires) as unknown).not.toThrow();

      const comptes = [
        ...donnees<{ email: string; password: string; role: string }[]>(
          prisma.user.createMany,
          0,
        ),
        ...donnees<{ email: string; password: string; role: string }[]>(
          prisma.user.createMany,
          1,
        ),
      ];
      expect(comptes).toHaveLength(COMPTES_DEMO.length);
      expect(
        comptes.every((c) => c.email.endsWith('@demo.medconnecte.gn')),
      ).toBe(true);
      // Mots de passe hachés, tous différents
      expect(comptes.every((c) => c.password.startsWith('hash:'))).toBe(true);
      expect(new Set(comptes.map((c) => c.password)).size).toBe(comptes.length);

      const roles = new Set(comptes.map((c) => c.role));
      for (const role of [
        'PATIENT',
        'MEDECIN',
        'PHARMACIEN',
        'ACCUEIL',
        'STRUCTURE_ADMIN',
        'SUPER_ADMIN',
      ]) {
        expect(roles.has(role)).toBe(true);
      }
      expect(
        comptes.filter((c) => c.role === 'PATIENT').length,
      ).toBeGreaterThanOrEqual(5);

      // Chaque structure a son administrateur
      expect(prisma.structure.update).toHaveBeenCalledTimes(
        STRUCTURES_DEMO.length,
      );
    });

    it('chiffre les champs médicaux comme les services', async () => {
      await seeder.creerJeuDeDonnees();

      const profils = donnees<
        { allergies: string; pathologies: string; traitements: string }[]
      >(prisma.profilMedical.createMany);
      expect(profils.length).toBeGreaterThanOrEqual(5);
      for (const p of profils) {
        for (const champ of [p.allergies, p.pathologies, p.traitements]) {
          expect(champ).toMatch(FORMAT_CHIFFRE);
        }
      }
      const aminata = COMPTES_DEMO.find((c) => c.cle === 'aminata');
      expect(encryption.decrypt(profils[0].allergies)).toBe(
        aminata?.profil?.allergies,
      );

      const consultation = donnees<{
        motif: string;
        diagnostic: string;
        notes: string;
      }>(prisma.consultation.create);
      expect(consultation.motif).toMatch(FORMAT_CHIFFRE);
      expect(encryption.decrypt(consultation.motif)).toBe(
        CONSULTATIONS_DEMO[0].motif,
      );
      expect(consultation.diagnostic).toMatch(FORMAT_CHIFFRE);

      // Ordonnance : JSON chiffré, lignes du catalogue avec medicamentId, plus une ligne libre
      const ordonnance = donnees<{ medicaments: string }>(
        prisma.ordonnance.create,
      );
      expect(ordonnance.medicaments).toMatch(FORMAT_CHIFFRE);
      const lignes = JSON.parse(encryption.decrypt(ordonnance.medicaments)) as {
        nom: string;
        medicamentId?: string;
      }[];
      expect(lignes.some((l) => typeof l.medicamentId === 'string')).toBe(true);
      expect(lignes.some((l) => l.medicamentId === undefined)).toBe(true);

      const analyses = donnees<
        { typeAnalyse: string; resultats: string; laboratoire: string }[]
      >(prisma.resultatAnalyse.createMany);
      expect(analyses).toHaveLength(ANALYSES_DEMO.length);
      expect(encryption.decrypt(analyses[0].resultats)).toBe(
        ANALYSES_DEMO[0].resultats,
      );
      expect(analyses[0].laboratoire).toMatch(FORMAT_CHIFFRE);

      const vaccins = donnees<
        { vaccin: string; prochainRappel: Date | null }[]
      >(prisma.vaccination.createMany);
      expect(vaccins.every((v) => FORMAT_CHIFFRE.test(v.vaccin))).toBe(true);
      expect(vaccins.some((v) => v.prochainRappel === null)).toBe(true);
      expect(vaccins.some((v) => v.prochainRappel instanceof Date)).toBe(true);

      const diagnostics = donnees<
        { symptomes: string; recommendation: string; analyseia: string }[]
      >(prisma.autoDiagnostic.createMany);
      expect(diagnostics.every((d) => FORMAT_CHIFFRE.test(d.symptomes))).toBe(
        true,
      );
      expect(
        diagnostics.every((d) => FORMAT_CHIFFRE.test(d.recommendation)),
      ).toBe(true);
      expect(
        () => JSON.parse(diagnostics[0].analyseia) as unknown,
      ).not.toThrow();
    });

    it('couvre tous les statuts de rendez-vous et de SOS attendus', async () => {
      await seeder.creerJeuDeDonnees();

      const rdv = donnees<{ status: string }[]>(prisma.rendezVous.createMany);
      expect(rdv).toHaveLength(RENDEZ_VOUS_DEMO.length);
      expect(new Set(rdv.map((r) => r.status))).toEqual(
        new Set([
          'PROGRAMME',
          'CONFIRME',
          'ANNULE',
          'TERMINE',
          'EN_ATTENTE',
          'REFUSE',
        ]),
      );

      const urgences = donnees<
        {
          status: string;
          delaiArriveeMinutes: number | null;
          priseEnChargeAt: Date | null;
          structurePriseEnChargeId: string | null;
        }[]
      >(prisma.urgence.createMany);
      expect(urgences).toHaveLength(URGENCES_DEMO.length);
      const priseEnCharge = urgences.find((u) => u.status === 'PRIS_EN_CHARGE');
      expect(priseEnCharge?.delaiArriveeMinutes).toBe(20);
      expect(priseEnCharge?.priseEnChargeAt).toBeInstanceOf(Date);
      expect(priseEnCharge?.structurePriseEnChargeId).toEqual(
        expect.any(String),
      );
      expect(new Set(urgences.map((u) => u.status))).toEqual(
        new Set(['LANCE', 'PRIS_EN_CHARGE', 'TERMINE']),
      );

      // Stocks : au moins une rupture et un stock faible
      const stocks = donnees<{ quantite: number; disponible: boolean }[]>(
        prisma.stockMedicament.createMany,
      );
      expect(stocks.some((s) => s.quantite === 0 && !s.disponible)).toBe(true);
      expect(stocks.some((s) => s.quantite > 0 && s.quantite < 10)).toBe(true);
    });

    it('réutilise un médicament déjà présent au catalogue', async () => {
      prisma.medicament.findFirst.mockImplementation(
        ({ where }: { where: { nom: string } }) =>
          Promise.resolve(
            where.nom === 'Coartem 20/120' ? { id: 'coartem-existant' } : null,
          ),
      );

      await seeder.creerJeuDeDonnees();

      const crees = prisma.medicament.create.mock.calls.map(
        (c) => (c as [{ data: { nom: string } }])[0].data.nom,
      );
      expect(crees).not.toContain('Coartem 20/120');
      const stocks = donnees<{ medicamentId: string }[]>(
        prisma.stockMedicament.createMany,
      );
      expect(stocks.some((s) => s.medicamentId === 'coartem-existant')).toBe(
        true,
      );
    });

    it('rattache les rôles des comptes démo restés sans rôle', async () => {
      prisma.permission.count.mockResolvedValue(30);
      prisma.structure.findMany.mockResolvedValue([
        { id: 's1', type: 'HOPITAL' },
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: 'MEDECIN', structureId: 's1' },
      ]);
      rolesService.resolveAssignableRoleId.mockResolvedValue('role-medecin');

      await seeder.rattacherRoles();

      expect(rolesService.seedStructureDefaultRoles).toHaveBeenCalledWith(
        's1',
        'HOPITAL',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { appRoleId: 'role-medecin' },
      });
      expect(permissionsService.invalidateUser).toHaveBeenCalledWith('u1');
    });

    it('laisse les rôles à RolesService si le catalogue de permissions est vide', async () => {
      await seeder.rattacherRoles();

      expect(rolesService.seedStructureDefaultRoles).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("n'empêche pas le démarrage si la création échoue", async () => {
      prisma.$transaction.mockRejectedValue(new Error('base indisponible'));

      await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });

  describe('remise à zéro (DEMO_RESET)', () => {
    const resetInitial = process.env.DEMO_RESET;
    const filtreDemo = { email: { endsWith: '@demo.medconnecte.gn' } };
    let journal: jest.SpyInstance;
    let avertissement: jest.SpyInstance;

    beforeEach(() => {
      process.env.DEMO_RESET = 'true';
      journal = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      avertissement = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (resetInitial === undefined) delete process.env.DEMO_RESET;
      else process.env.DEMO_RESET = resetInitial;
    });

    it('mode démo inactif : ne supprime rien et journalise un avertissement', async () => {
      process.env.DEMO_MODE = 'false';

      await seeder.onApplicationBootstrap();
      expect(await seeder.reinitialiserJeuDeDonnees()).toBeNull();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.structure.deleteMany).not.toHaveBeenCalled();
      expect(avertissement).toHaveBeenCalledWith(
        expect.stringContaining('DEMO_RESET=true ignoré'),
      );
    });

    it('DEMO_RESET=false : aucune purge, création idempotente habituelle', async () => {
      process.env.DEMO_MODE = 'true';
      process.env.DEMO_RESET = 'false';
      prisma.user.count.mockResolvedValue(3);

      await seeder.onApplicationBootstrap();

      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.user.createMany).not.toHaveBeenCalled();
    });

    it('mode démo actif : purge le seul domaine démo puis recrée tout, dans une transaction', async () => {
      process.env.DEMO_MODE = 'true';
      // Des données démo existent déjà : la remise à zéro passe outre.
      prisma.user.count.mockResolvedValue(20);
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      prisma.user.deleteMany.mockResolvedValue({ count: 2 });
      prisma.structure.deleteMany.mockResolvedValue({ count: 5 });

      await seeder.onApplicationBootstrap();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { userId: { in: ['u1', 'u2'] } },
      });
      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: filtreDemo,
      });
      expect(prisma.structure.deleteMany).toHaveBeenCalledWith({
        where: filtreDemo,
      });
      // Le catalogue de médicaments, partagé, n'est jamais supprimé.
      expect(prisma.medicament.deleteMany).not.toHaveBeenCalled();
      expect(prisma.medicament.delete).not.toHaveBeenCalled();
      // Purge avant recréation.
      expect(
        prisma.structure.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.structure.createMany.mock.invocationCallOrder[0]);
      expect(prisma.user.createMany).toHaveBeenCalledTimes(2);
      expect(journal).toHaveBeenCalledWith(
        expect.stringContaining(
          'Données de démonstration supprimées puis recréées',
        ),
      );
    });

    it("ne supprime aucun journal d'audit si aucun compte démo n'existe", async () => {
      process.env.DEMO_MODE = 'true';
      prisma.user.deleteMany.mockResolvedValue({ count: 0 });
      prisma.structure.deleteMany.mockResolvedValue({ count: 0 });

      expect(await seeder.reinitialiserJeuDeDonnees()).toEqual({
        comptes: 0,
        structures: 0,
      });
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });
  });
});
