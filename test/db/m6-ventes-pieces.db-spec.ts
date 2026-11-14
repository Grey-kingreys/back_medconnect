import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import {
  appliquerMigrations,
  appliquerRetourArriere,
  appliquerSql,
  BaseDeTest,
  creerBaseVide,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  DOSSIER_MIGRATIONS,
  DOSSIER_RETOURS_ARRIERE,
  supprimerBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

const M1 = '20261026090000_pharmacie_t1_permissions';
const M2 = '20261026100000_pharmacie_t1_points_de_vente';
const M3 = '20261026110000_pharmacie_t1_fiche_produit';
const M4 = '20261026120000_pharmacie_t1_lots_mouvements';
const M5 = '20261026130000_pharmacie_t1_caisse';
const M6 = '20261026140000_pharmacie_t1_ventes_pieces';
const JOUR_MS = 24 * 60 * 60 * 1000;
const MESSAGE_PIECES = /ne se modifient ni ne se suppriment jamais/;

function lignesSql(fichier: string): string[] {
  return readFileSync(fichier, 'utf8')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '' && !ligne.startsWith('--'));
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function compter(client: Client, sql: string): Promise<number> {
  const res = await client.query<{ n: number }>(sql);
  return res.rows[0].n;
}

async function pv(client: Client, structureId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
    [structureId],
  );
  return res.rows[0].id;
}

async function posteReprise(client: Client, pvId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "Poste" WHERE "pointDeVenteId" = $1 AND "code" = \'REPRISE\'',
    [pvId],
  );
  return res.rows[0].id;
}

async function sessionTechnique(client: Client, pvId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "SessionCaisse" WHERE "pointDeVenteId" = $1 AND "technique"',
    [pvId],
  );
  return res.rows[0].id;
}

async function mode(client: Client, code: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "ModePaiement" WHERE "code" = $1',
    [code],
  );
  return res.rows[0].id;
}

async function lotTechnique(client: Client, stockId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "lotTechnique"',
    [stockId],
  );
  return res.rows[0].id;
}

describe('Migration M6, pièces de vente et allocations de lots (PB09)', () => {
  let base: BaseDeTest | undefined;
  let appliquees: string[];
  let resume: ResumeFormatActuel;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    appliquees = await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M6,
    });
  });

  afterAll(async () => {
    if (base) {
      await supprimerBaseDeTest(base);
    }
  });

  function client(): Client {
    if (!base) throw new Error('Base de test non créée.');
    return base.client;
  }

  const plus = (jours: number): Date =>
    new Date(resume.aujourdhui.getTime() + jours * JOUR_MS);

  async function piece(p: {
    id: string;
    structureId: string;
    sessionId: string;
    posteId?: string;
    numero: string;
    numeroTicket?: number | null;
    total: number;
    typePiece?: string;
    venteOrigineId?: string | null;
    motif?: string | null;
  }): Promise<void> {
    const c = client();
    const session = await c.query<{ pointDeVenteId: string; posteId: string }>(
      'SELECT "pointDeVenteId", "posteId" FROM "SessionCaisse" WHERE "id" = $1',
      [p.sessionId],
    );
    await c.query(
      'INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece","venteOrigineId","motifAnnulation") VALUES ($1,$2,$3,$4,$5,$6,$7,\'usr-pharm-p1\',\'Mamadou Diallo\',$8,$9::date,$10::"TypePieceVente",$11,$12)',
      [
        p.id,
        p.structureId,
        session.rows[0].pointDeVenteId,
        p.posteId ?? session.rows[0].posteId,
        p.sessionId,
        p.numero,
        p.numeroTicket ?? null,
        p.total,
        jourIso(resume.aujourdhui),
        p.typePiece ?? 'VENTE',
        p.venteOrigineId ?? null,
        p.motif ?? null,
      ],
    );
  }

  async function ligne(l: {
    id: string;
    venteId: string;
    stockId: string;
    prix: number;
    quantite: number;
    sousTotal: number;
    unite: string;
    nombre: number;
    coefficient: number;
  }): Promise<void> {
    await client().query(
      'INSERT INTO "LigneVente" ("id","venteId","medicamentId","stockMedicamentId","nomMedicament","prixUnitaire","quantite","sousTotal","uniteAffichee","nombreAffiche","coefficientApplique") SELECT $1,$2,f."medicamentId",f."id",\'Harnais\',$4,$5,$6,$7::"UniteVente",$8,$9 FROM "StockMedicament" f WHERE f."id" = $3',
      [
        l.id,
        l.venteId,
        l.stockId,
        l.prix,
        l.quantite,
        l.sousTotal,
        l.unite,
        l.nombre,
        l.coefficient,
      ],
    );
  }

  async function allocation(a: {
    id: string;
    ligneId: string;
    lotId: string | null;
    quantite: number;
    cout?: number;
    statut: string;
    lotTechnique?: boolean;
    remplaceePar?: string | null;
    sortieManuelle?: boolean;
    motif?: string | null;
  }): Promise<void> {
    await client().query(
      'INSERT INTO "AllocationLot" ("id","ligneVenteId","lotId","quantite","coutUnitaire","lotTechnique","statut","remplaceeParPieceId","sortieManuelle","motif") VALUES ($1,$2,$3,$4,$5,$6,$7::"StatutAllocation",$8,$9,$10)',
      [
        a.id,
        a.ligneId,
        a.lotId,
        a.quantite,
        a.cout ?? 0,
        a.lotTechnique ?? false,
        a.statut,
        a.remplaceePar ?? null,
        a.sortieManuelle ?? false,
        a.motif ?? null,
      ],
    );
  }

  it('M6 et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)', () => {
    for (const fichier of [
      path.join(DOSSIER_MIGRATIONS, M6, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M6}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
  });

  it('toutes les ventes historiques ont un point de vente, un poste et une session (CA26)', async () => {
    const c = client();
    expect(appliquees).toEqual([M1, M2, M3, M4, M5, M6]);
    for (const [table, colonne] of [
      ['Vente', 'pointDeVenteId'],
      ['Vente', 'posteId'],
      ['Vente', 'sessionCaisseId'],
      ['Vente', 'jourMetier'],
      ['LigneVente', 'nombreAffiche'],
    ]) {
      const res = await c.query<{ is_nullable: string }>(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, colonne],
      );
      expect(res.rows[0].is_nullable).toBe('NO');
    }
    const ventes = await c.query<{
      id: string;
      structureId: string;
      pointDeVenteId: string;
      posteId: string;
      sessionCaisseId: string;
      typePiece: string;
      venteOrigineId: string | null;
      numeroTicket: number | null;
      jourMetierOrigine: Date | null;
      horodatageLocal: Date | null;
      sequencePoste: number | null;
      jour: string;
    }>(
      'SELECT v.*, to_char(v."jourMetier", \'YYYY-MM-DD\') AS "jour" FROM "Vente" v ORDER BY v."id"',
    );
    expect(ventes.rows).toHaveLength(6);
    for (const v of ventes.rows) {
      const pvId = await pv(c, v.structureId);
      expect(v.pointDeVenteId).toBe(pvId);
      expect(v.posteId).toBe(await posteReprise(c, pvId));
      expect(v.sessionCaisseId).toBe(await sessionTechnique(c, pvId));
      expect(v.typePiece).toBe('VENTE');
      expect(v.venteOrigineId).toBeNull();
      expect(v.numeroTicket).toBeNull();
      expect(v.jourMetierOrigine).toBeNull();
      expect(v.horodatageLocal).toBeNull();
      expect(v.sequencePoste).toBeNull();
      expect(v.jour).toBe(
        v.id.startsWith('vte-p1-')
          ? jourIso(resume.aujourdhui)
          : jourIso(plus(-1)),
      );
    }
  });

  it('ventes historiques inchangées : statut, annulation, montants, lignes', async () => {
    const c = client();
    const annulee = await c.query<{ annuleeLe: Date | null }>(
      'SELECT "statut", "annuleeParId", "motifAnnulation", "annuleeLe" FROM "Vente" WHERE "id" = $1',
      ['vte-p1-3'],
    );
    expect(annulee.rows[0]).toMatchObject({
      statut: 'ANNULEE',
      annuleeParId: 'usr-admin-p1',
      motifAnnulation: 'Erreur de saisie',
    });
    expect(annulee.rows[0].annuleeLe).not.toBeNull();
    const autre = await c.query(
      'SELECT "statut", "motifAnnulation" FROM "Vente" WHERE "id" = $1',
      ['vte-p2-2'],
    );
    expect(autre.rows[0]).toEqual({
      statut: 'ANNULEE',
      motifAnnulation: 'Client parti sans payer',
    });
    expect(
      await compter(c, 'SELECT count(*)::int AS n FROM "LigneVente"'),
    ).toBe(7);
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "LigneVente" WHERE "nombreAffiche" = "quantite" AND "coefficientApplique" = 1 AND "uniteAffichee" = \'BOITE\' AND "sousTotal" = "prixUnitaire" * "quantite"',
      ),
    ).toBe(7);
    expect(
      await compter(c, 'SELECT count(*)::int AS n FROM "AllocationLot"'),
    ).toBe(0);
    expect(await compter(c, 'SELECT count(*)::int AS n FROM "Paiement"')).toBe(
      0,
    );
  });

  it('ventes et lignes immuables, suppression sous contournement seulement', async () => {
    const c = client();
    await expect(
      c.query(
        'UPDATE "Vente" SET "statut" = \'ANNULEE\' WHERE "id" = \'vte-p1-1\'',
      ),
    ).rejects.toThrow(/Écriture refusée sur la table Vente/);
    await expect(
      c.query(
        'UPDATE "Vente" SET "cleIdempotence" = NULL WHERE "id" = \'vte-p1-4\'',
      ),
    ).rejects.toThrow(/Écriture refusée sur la table Vente/);
    await expect(
      c.query('DELETE FROM "Vente" WHERE "id" = \'vte-p1-1\''),
    ).rejects.toThrow(/Écriture refusée sur la table Vente/);
    await expect(
      c.query('UPDATE "LigneVente" SET "quantite" = 5 WHERE "id" = \'lv-01\''),
    ).rejects.toThrow(/Écriture refusée sur la table LigneVente/);
    await expect(
      c.query('DELETE FROM "LigneVente" WHERE "id" = \'lv-01\''),
    ).rejects.toThrow(/Écriture refusée sur la table LigneVente/);
    await expect(c.query('TRUNCATE "Vente" CASCADE')).rejects.toThrow(
      MESSAGE_PIECES,
    );

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    await expect(
      c.query(
        'UPDATE "Vente" SET "statut" = \'ANNULEE\' WHERE "id" = \'vte-p1-1\'',
      ),
    ).rejects.toThrow();
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    expect(
      (await c.query('DELETE FROM "LigneVente" WHERE "venteId" = \'vte-p1-4\''))
        .rowCount,
    ).toBe(1);
    expect(
      (await c.query('DELETE FROM "Vente" WHERE "id" = \'vte-p1-4\'')).rowCount,
    ).toBe(1);
    await c.query('ROLLBACK');

    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "Vente" WHERE "id" = \'vte-p1-4\'',
      ),
    ).toBe(1);
  });

  it('clés étrangères des pièces en Restrict (O12, D430)', async () => {
    const c = client();
    const tables = [
      'Vente',
      'LigneVente',
      'AllocationLot',
      'SessionCaisse',
      'ComptageCaisse',
      'LigneComptage',
      'ReleveModePaiement',
      'MouvementCaisse',
      'Paiement',
      'ResultatSessionMode',
      'ClotureJournaliere',
      'TotalClotureMode',
      'Reception',
      'Inventaire',
      'LigneInventaire',
      'EvenementSynchro',
    ];
    const cles = await c.query<{ conname: string; confdeltype: string }>(
      'SELECT c."conname", c."confdeltype" FROM pg_constraint c JOIN pg_class t ON t."oid" = c."conrelid" WHERE c."contype" = \'f\' AND t."relname" = ANY($1::text[])',
      [tables],
    );
    expect(cles.rows).toHaveLength(33);
    for (const cle of cles.rows) {
      expect(cle.confdeltype).toBe('r');
    }
    const noms = cles.rows.map((r) => r.conname);
    expect(noms).toContain('Vente_structureId_fkey');
    expect(noms).toContain('LigneVente_venteId_fkey');
    const reception = await c.query<{ confdeltype: string }>(
      'SELECT "confdeltype" FROM pg_constraint WHERE "conname" = \'LotStock_receptionId_fkey\'',
    );
    expect(reception.rows[0].confdeltype).toBe('r');
    await expect(
      c.query('DELETE FROM "Structure" WHERE "id" = \'str-pharma-2\''),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('nouvelle pièce : rattachement à la pharmacie, au poste et à la session (D520)', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    await c.query(
      'INSERT INTO "Poste" ("id","pointDeVenteId","code","libelle","type","appareilId") VALUES (\'poste-p1-w1\',$1,\'W1\',\'Navigateur\',\'WEB\',\'harnais-p1-w1\')',
      [pv1],
    );
    await c.query(
      'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","jourMetier","evenementOuvertureId") VALUES (\'s-p1-1\',$1,\'poste-p1-w1\',\'usr-pharm-p1\',\'Mamadou Diallo\',$2::date,\'ouv-s-p1-1\')',
      [pv1, jourIso(resume.aujourdhui)],
    );
    await expect(
      piece({
        id: 'vte-x1',
        structureId: 'str-pharma-2',
        sessionId: 's-p1-1',
        numero: 'T1-X1',
        total: 100,
      }),
    ).rejects.toThrow(/Vente refusée : le point de vente/);
    await expect(
      piece({
        id: 'vte-x2',
        structureId: 'str-pharma-1',
        sessionId: 's-p1-1',
        posteId: await posteReprise(c, pv1),
        numero: 'T1-X2',
        total: 100,
      }),
    ).rejects.toThrow(/Vente refusée/);
    await piece({
      id: 'vte-t1-1',
      structureId: 'str-pharma-1',
      sessionId: 's-p1-1',
      numero: 'T1-0000001',
      numeroTicket: 1,
      total: 3000,
    });
    await expect(
      piece({
        id: 'vte-t1-2',
        structureId: 'str-pharma-1',
        sessionId: 's-p1-1',
        numero: 'T1-0000002',
        numeroTicket: 1,
        total: 100,
      }),
    ).rejects.toMatchObject({
      constraint: 'Vente_pointDeVenteId_numeroTicket_key',
    });
    const base = {
      venteId: 'vte-t1-1',
      stockId: 'stk-06',
      prix: 150,
      sousTotal: 3000,
    };
    await expect(
      ligne({
        ...base,
        id: 'lv-x1',
        quantite: 20,
        unite: 'BOITE',
        nombre: 2,
        coefficient: 8,
      }),
    ).rejects.toMatchObject({ constraint: 'LigneVente_quantite_check' });
    await expect(
      ligne({
        ...base,
        id: 'lv-x2',
        quantite: 20,
        unite: 'UNITE',
        nombre: 2,
        coefficient: 10,
      }),
    ).rejects.toMatchObject({ constraint: 'LigneVente_uniteAffichee_check' });
    await expect(
      ligne({
        ...base,
        id: 'lv-x3',
        quantite: 0,
        unite: 'BOITE',
        nombre: 0,
        coefficient: 0,
      }),
    ).rejects.toMatchObject({
      constraint: 'LigneVente_coefficientApplique_check',
    });
    await ligne({
      ...base,
      id: 'lv-t1-1',
      quantite: 20,
      unite: 'BOITE',
      nombre: 2,
      coefficient: 10,
    });
  });

  it('pièce d annulation : origine obligatoire, motif obligatoire, une seule par vente, même point de vente (D519)', async () => {
    const c = client();
    const especes = await mode(c, 'ESPECES');
    await expect(
      piece({
        id: 'vte-n1',
        structureId: 'str-pharma-1',
        sessionId: 's-p1-1',
        numero: 'A-N1',
        total: -100,
        typePiece: 'ANNULATION',
        motif: 'Erreur',
      }),
    ).rejects.toMatchObject({ constraint: 'Vente_venteOrigine_check' });
    await expect(
      piece({
        id: 'vte-n2',
        structureId: 'str-pharma-1',
        sessionId: 's-p1-1',
        numero: 'T1-N2',
        total: 100,
        venteOrigineId: 'vte-p1-1',
      }),
    ).rejects.toMatchObject({ constraint: 'Vente_venteOrigine_check' });
    for (const motif of [null, '   ']) {
      await expect(
        piece({
          id: 'vte-n3',
          structureId: 'str-pharma-1',
          sessionId: 's-p1-1',
          numero: 'A-N3',
          total: -100,
          typePiece: 'ANNULATION',
          venteOrigineId: 'vte-t1-1',
          motif,
        }),
      ).rejects.toMatchObject({ constraint: 'Vente_motifAnnulation_check' });
    }
    await expect(
      piece({
        id: 'vte-n4',
        structureId: 'str-pharma-1',
        sessionId: 's-p1-1',
        numero: 'A-N4',
        total: -6000,
        typePiece: 'ANNULATION',
        venteOrigineId: 'vte-p2-1',
        motif: 'Erreur',
      }),
    ).rejects.toThrow(/pièce d'origine vte-p2-1 n'appartient pas/);

    await piece({
      id: 'vte-a-1',
      structureId: 'str-pharma-1',
      sessionId: 's-p1-1',
      numero: 'A-T1-0000001',
      total: -3000,
      typePiece: 'ANNULATION',
      venteOrigineId: 'vte-t1-1',
      motif: 'Client parti',
    });
    await ligne({
      id: 'lv-a-1',
      venteId: 'vte-a-1',
      stockId: 'stk-06',
      prix: 150,
      quantite: -20,
      sousTotal: -3000,
      unite: 'BOITE',
      nombre: -2,
      coefficient: 10,
    });
    await c.query(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant") VALUES (\'pai-a-1\',\'vte-a-1\',\'s-p1-1\',$1,-3000)',
      [especes],
    );
    await expect(
      piece({
        id: 'vte-a-1bis',
        structureId: 'str-pharma-1',
        sessionId: 's-p1-1',
        numero: 'A-T1-0000001bis',
        total: -3000,
        typePiece: 'ANNULATION',
        venteOrigineId: 'vte-t1-1',
        motif: 'Encore',
      }),
    ).rejects.toMatchObject({ constraint: 'Vente_venteOrigineId_key' });
    await piece({
      id: 'vte-a-2',
      structureId: 'str-pharma-1',
      sessionId: 's-p1-1',
      numero: 'A-V-2026-000001',
      total: -15000,
      typePiece: 'ANNULATION',
      venteOrigineId: 'vte-p1-1',
      motif: 'Retour client',
    });
    await piece({
      id: 'vte-r-1',
      structureId: 'str-pharma-1',
      sessionId: 's-p1-1',
      numero: 'S1-W1-1',
      total: 1500,
      typePiece: 'REGULARISATION',
    });
  });

  it('allocations : lot si et seulement si définitive, remplacement d une provisoire seulement (D519)', async () => {
    const c = client();
    const lotTech = await lotTechnique(c, 'stk-06');
    const ligneId = 'lv-t1-1';
    await expect(
      allocation({
        id: 'al-x1',
        ligneId,
        lotId: null,
        quantite: 1,
        statut: 'DEFINITIVE',
      }),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_lot_check' });
    await expect(
      allocation({
        id: 'al-x2',
        ligneId,
        lotId: lotTech,
        quantite: 1,
        statut: 'PROVISOIRE',
      }),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_lot_check' });
    await expect(
      allocation({
        id: 'al-x3',
        ligneId,
        lotId: lotTech,
        quantite: 0,
        statut: 'DEFINITIVE',
      }),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_quantite_check' });
    await expect(
      allocation({
        id: 'al-x4',
        ligneId,
        lotId: lotTech,
        quantite: 1,
        cout: -1,
        statut: 'DEFINITIVE',
      }),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_coutUnitaire_check' });
    await expect(
      allocation({
        id: 'al-x5',
        ligneId,
        lotId: lotTech,
        quantite: 1,
        statut: 'DEFINITIVE',
        sortieManuelle: true,
      }),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_motif_check' });
    await expect(
      allocation({
        id: 'al-x6',
        ligneId,
        lotId: null,
        quantite: 1,
        statut: 'REMPLACEE',
      }),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_remplacee_check' });

    await allocation({
      id: 'al-1',
      ligneId,
      lotId: lotTech,
      quantite: 12,
      statut: 'DEFINITIVE',
      lotTechnique: true,
    });
    await allocation({
      id: 'al-2',
      ligneId,
      lotId: null,
      quantite: 8,
      statut: 'PROVISOIRE',
    });
    await expect(
      c.query(
        'UPDATE "AllocationLot" SET "quantite" = 11 WHERE "id" = \'al-1\'',
      ),
    ).rejects.toThrow(/ne peut pas être modifiée/);
    await expect(
      c.query(
        'UPDATE "AllocationLot" SET "statut" = \'REMPLACEE\' WHERE "id" = \'al-2\'',
      ),
    ).rejects.toMatchObject({ constraint: 'AllocationLot_remplacee_check' });
    expect(
      (
        await c.query(
          'UPDATE "AllocationLot" SET "statut" = \'REMPLACEE\', "remplaceeParPieceId" = \'resolution-1\' WHERE "id" = \'al-2\'',
        )
      ).rowCount,
    ).toBe(1);
    await expect(
      c.query(
        'UPDATE "AllocationLot" SET "statut" = \'PROVISOIRE\', "remplaceeParPieceId" = NULL WHERE "id" = \'al-2\'',
      ),
    ).rejects.toThrow(/ne peut pas être modifiée/);
    await expect(
      c.query('DELETE FROM "AllocationLot" WHERE "id" = \'al-1\''),
    ).rejects.toThrow(/ne peut pas être supprimée/);
    await expect(c.query('TRUNCATE "AllocationLot"')).rejects.toThrow(
      MESSAGE_PIECES,
    );

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    expect(
      (await c.query('DELETE FROM "AllocationLot" WHERE "id" = \'al-1\''))
        .rowCount,
    ).toBe(1);
    await c.query('ROLLBACK');
  });

  it('retour arrière de M5 refusé tant que M6 est en place', async () => {
    const c = client();
    await expect(appliquerRetourArriere(c, M5)).rejects.toThrow(
      "appliquer d'abord le retour arrière de M6",
    );
    const table = await c.query<{ r: string | null }>(
      'SELECT to_regclass(\'"SessionCaisse"\')::text AS "r"',
    );
    expect(table.rows[0].r).not.toBeNull();
  });

  it('retour arrière de M6 après activité : annulations reportées sur l origine, régularisation et ventes T conservées', async () => {
    const c = client();
    const dates = await c.query<{ id: string; createdAt: Date }>(
      'SELECT "id", "createdAt" FROM "Vente" WHERE "id" IN (\'vte-a-1\', \'vte-a-2\')',
    );
    const creeeLe = (id: string) =>
      dates.rows.find((r) => r.id === id)?.createdAt;
    const notices: string[] = [];
    const ecouteur = (n: { message?: string }) => {
      notices.push(n.message ?? '');
    };
    c.on('notice', ecouteur);
    try {
      await appliquerRetourArriere(c, M6);
    } finally {
      c.off('notice', ecouteur);
    }
    expect(notices.some((m) => m.includes("2 pièce(s) d'annulation"))).toBe(
      true,
    );

    const t1 = await c.query(
      'SELECT "statut", "annuleeParId", "motifAnnulation", "annuleeLe" FROM "Vente" WHERE "id" = \'vte-t1-1\'',
    );
    expect(t1.rows[0]).toEqual({
      statut: 'ANNULEE',
      annuleeParId: 'usr-pharm-p1',
      motifAnnulation: 'Client parti',
      annuleeLe: creeeLe('vte-a-1'),
    });
    const p1 = await c.query(
      'SELECT "statut", "motifAnnulation", "annuleeLe" FROM "Vente" WHERE "id" = \'vte-p1-1\'',
    );
    expect(p1.rows[0]).toEqual({
      statut: 'ANNULEE',
      motifAnnulation: 'Retour client',
      annuleeLe: creeeLe('vte-a-2'),
    });
    for (const [table, id] of [
      ['Vente', 'vte-a-1'],
      ['Vente', 'vte-a-2'],
      ['LigneVente', 'lv-a-1'],
      ['Paiement', 'pai-a-1'],
    ]) {
      expect(
        await compter(
          c,
          `SELECT count(*)::int AS n FROM "${table}" WHERE "id" = '${id}'`,
        ),
      ).toBe(0);
    }
    const regul = await c.query<{ statut: string }>(
      'SELECT "statut" FROM "Vente" WHERE "id" = \'vte-r-1\'',
    );
    expect(regul.rows[0].statut).toBe('VALIDEE');
    const allocations = await c.query<{ r: string | null }>(
      'SELECT to_regclass(\'"AllocationLot"\')::text AS "r"',
    );
    expect(allocations.rows[0].r).toBeNull();

    const colonnes = await c.query<{
      table_name: string;
      column_name: string;
    }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('Vente', 'LigneVente')",
    );
    const presentes = colonnes.rows.map(
      (r) => `${r.table_name}.${r.column_name}`,
    );
    for (const colonne of [
      'horodatageLocal',
      'jourMetier',
      'jourMetierOrigine',
      'numeroTicket',
      'pointDeVenteId',
      'posteId',
      'sequencePoste',
      'sessionCaisseId',
      'typePiece',
      'venteOrigineId',
    ]) {
      expect(presentes).not.toContain(`Vente.${colonne}`);
    }
    for (const colonne of [
      'coefficientApplique',
      'nombreAffiche',
      'uniteAffichee',
    ]) {
      expect(presentes).not.toContain(`LigneVente.${colonne}`);
    }
    const cles = await c.query<{ conname: string; confdeltype: string }>(
      'SELECT "conname", "confdeltype" FROM pg_constraint WHERE "conname" IN (\'Vente_structureId_fkey\', \'LigneVente_venteId_fkey\')',
    );
    expect(cles.rows).toHaveLength(2);
    for (const cle of cles.rows) {
      expect(cle.confdeltype).toBe('c');
    }
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_type WHERE typname IN ('TypePieceVente', 'UniteVente', 'StatutAllocation')",
      ),
    ).toBe(0);
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('vente_verifier_rattachement', 'allocation_lot_proteger')",
      ),
    ).toBe(0);

    await c.query('BEGIN');
    const libre = await c.query(
      'UPDATE "Vente" SET "clientNom" = \'x\' WHERE "id" = \'vte-p1-2\'',
    );
    expect(libre.rowCount).toBe(1);
    await c.query('ROLLBACK');
  });

  it('retour arrière de M5 puis haut de nouveau M5 et M6', async () => {
    const c = client();
    await appliquerRetourArriere(c, M5);
    expect(await appliquerMigrations(c, { apres: M4, jusqua: M6 })).toEqual([
      M5,
      M6,
    ]);
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "SessionCaisse" WHERE "technique"',
      ),
    ).toBe(3);
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "SessionCaisse" WHERE "id" = \'s-p1-1\'',
      ),
    ).toBe(0);
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "Vente" WHERE "pointDeVenteId" IS NULL OR "posteId" IS NULL OR "sessionCaisseId" IS NULL',
      ),
    ).toBe(0);
    const pv1 = await pv(c, 'str-pharma-1');
    const technique = await sessionTechnique(c, pv1);
    const rattachees = await c.query<{ id: string; sessionCaisseId: string }>(
      'SELECT "id", "sessionCaisseId" FROM "Vente" WHERE "id" IN (\'vte-t1-1\', \'vte-r-1\')',
    );
    expect(rattachees.rows).toHaveLength(2);
    for (const v of rattachees.rows) {
      expect(v.sessionCaisseId).toBe(technique);
    }
  });

  describe('arrêts de M6', () => {
    let autre: BaseDeTest | undefined;

    beforeAll(async () => {
      autre = await creerBaseVide();
      await appliquerMigrations(autre.client, {
        jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      });
      await chargerFormatActuel(autre.client);
      await appliquerMigrations(autre.client, {
        apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
        jusqua: M5,
      });
    });

    afterAll(async () => {
      if (autre) {
        await supprimerBaseDeTest(autre);
      }
    });

    function cible(): Client {
      if (!autre) throw new Error('Base de test non créée.');
      return autre.client;
    }

    it('arrêt : vente sans point de vente puis sans session technique listée, M6 passe une fois corrigée', async () => {
      const c = cible();
      await c.query(
        `INSERT INTO "Structure" ("id", "nom", "type", "email", "ville", "isActive", "isConfigured", "createdAt", "updatedAt") VALUES ('str-pharma-sans-pv', 'Pharmacie sans point de vente (harnais)', 'PHARMACIE', 'sanspv@harnais.test', 'Conakry', true, true, now(), now())`,
      );
      await c.query(
        'INSERT INTO "Vente" ("id","structureId","numero","vendeurId","vendeurNom","total") VALUES (\'vte-sans-pv\',\'str-pharma-sans-pv\',\'V-2026-000001\',\'usr-x\',\'X\',100)',
      );
      await expect(
        appliquerMigrations(c, { apres: M5, jusqua: M6 }),
      ).rejects.toThrow(`La migration ${M6} a échoué`);
      await expect(
        appliquerMigrations(c, { apres: M5, jusqua: M6 }),
      ).rejects.toThrow(
        '1 vente(s) appartiennent à une structure sans point de vente',
      );
      await expect(
        appliquerMigrations(c, { apres: M5, jusqua: M6 }),
      ).rejects.toThrow('Ventes en cause (50 au plus) : vte-sans-pv');
      const table = await c.query<{ r: string | null }>(
        'SELECT to_regclass(\'"AllocationLot"\')::text AS "r"',
      );
      expect(table.rows[0].r).toBeNull();
      expect(
        await compter(
          c,
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Vente' AND column_name = 'jourMetier'",
        ),
      ).toBe(0);

      await c.query(
        'INSERT INTO "PointDeVente" ("id","structureId","ordre","nom") VALUES (\'pv-sans-pv\',\'str-pharma-sans-pv\',1,\'Sans PV\')',
      );
      await c.query(
        'INSERT INTO "Poste" ("id","pointDeVenteId","code","libelle","type","actif") VALUES (\'poste-reprise-sans-pv\',\'pv-sans-pv\',\'REPRISE\',\'Reprise des ventes historiques\',\'TECHNIQUE\',false)',
      );
      await expect(
        appliquerMigrations(c, { apres: M5, jusqua: M6 }),
      ).rejects.toThrow(/n'a pas de session technique de reprise/);
      await expect(
        appliquerMigrations(c, { apres: M5, jusqua: M6 }),
      ).rejects.toThrow(/vte-sans-pv/);

      const lignes = readFileSync(
        path.join(DOSSIER_MIGRATIONS, M5, 'migration.sql'),
        'utf8',
      ).split(/\r?\n/);
      const debut = lignes.findIndex((l) => l.startsWith('-- REPRISE: DEBUT'));
      const fin = lignes.findIndex((l) => l === '-- REPRISE: FIN');
      await appliquerSql(c, lignes.slice(debut, fin + 1).join('\n'));

      expect(await appliquerMigrations(c, { apres: M5, jusqua: M6 })).toEqual([
        M6,
      ]);
      const rattachee = await c.query<{ sessionCaisseId: string }>(
        'SELECT "sessionCaisseId" FROM "Vente" WHERE "id" = \'vte-sans-pv\'',
      );
      expect(rattachee.rows[0].sessionCaisseId).toBe(
        await sessionTechnique(c, 'pv-sans-pv'),
      );
    });
  });
});
