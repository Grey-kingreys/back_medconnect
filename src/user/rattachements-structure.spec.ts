import {
  analyserRattachements,
  type CompteRattachement,
} from './rattachements-structure';

const compte = (
  id: string,
  role: string,
  structureId: string | null,
  structureAdministreeId: string | null,
): CompteRattachement => ({
  id,
  email: `${id}@b.gn`,
  role,
  structureId,
  structureNom: structureId ? `Structure ${structureId}` : null,
  structureAdministreeId,
  structureAdministreeNom: structureAdministreeId
    ? `Structure ${structureAdministreeId}`
    : null,
});

describe('analyserRattachements', () => {
  it('administrateur sans structureId : adminsSansStructure', () => {
    const c = compte('a1', 'STRUCTURE_ADMIN', null, 's1');
    const analyse = analyserRattachements([c]);
    expect(analyse.adminsSansStructure).toEqual([c]);
    expect(analyse.adminsRattachesAilleurs).toEqual([]);
    expect(analyse.rolesSansStructure).toEqual([]);
  });

  it('administrateur rattaché à une autre structure : adminsRattachesAilleurs', () => {
    const c = compte('a2', 'STRUCTURE_ADMIN', 's2', 's1');
    const analyse = analyserRattachements([c]);
    expect(analyse.adminsRattachesAilleurs).toEqual([c]);
    expect(analyse.adminsSansStructure).toEqual([]);
    expect(analyse.rolesSansStructure).toEqual([]);
  });

  it("rôle d'établissement sans aucune structure : rolesSansStructure", () => {
    const c = compte('p1', 'PHARMACIEN', null, null);
    const analyse = analyserRattachements([c]);
    expect(analyse.rolesSansStructure).toEqual([c]);
    expect(analyse.adminsSansStructure).toEqual([]);
    expect(analyse.adminsRattachesAilleurs).toEqual([]);
  });

  it('comptes corrects ou hors sujet : rien', () => {
    const analyse = analyserRattachements([
      compte('m1', 'MEDECIN', 's1', null),
      compte('a3', 'STRUCTURE_ADMIN', 's1', 's1'),
      compte('pat', 'PATIENT', null, null),
      compte('adm', 'ADMIN', null, null),
    ]);
    expect(analyse.total).toBe(4);
    expect(analyse.adminsSansStructure).toEqual([]);
    expect(analyse.adminsRattachesAilleurs).toEqual([]);
    expect(analyse.rolesSansStructure).toEqual([]);
  });

  it("conserve l'ordre d'entrée dans chaque catégorie", () => {
    const b = compte('b', 'MEDECIN', null, null);
    const a = compte('a', 'ACCUEIL', null, null);
    const analyse = analyserRattachements([
      b,
      compte('ok', 'PATIENT', null, null),
      a,
    ]);
    expect(analyse.rolesSansStructure.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
