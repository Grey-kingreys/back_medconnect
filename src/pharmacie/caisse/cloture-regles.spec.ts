import {
  forcageAutorise,
  lireFileVide,
  postesAttendus,
  totauxCloture,
  versPosteManquant,
  type PosteCaisse,
  type ResultatPourCloture,
} from './cloture-regles';

describe('Règles de la clôture journalière', () => {
  const debutJour = new Date('2026-10-30T00:00:00.000Z');

  const poste = (o: Partial<PosteCaisse> & { id: string }): PosteCaisse => ({
    code: o.id,
    libelle: `Poste ${o.id}`,
    type: 'DESKTOP',
    actif: true,
    dernierContactLe: null,
    dernierEtat: null,
    ...o,
  });

  const attendus = (entree: {
    postes: PosteCaisse[];
    sessionsOuvertes?: {
      id: string;
      posteId: string;
      utilisateurNom: string;
    }[];
    postesAyantVendu?: string[];
  }) =>
    postesAttendus({
      debutJour,
      postes: entree.postes,
      sessionsOuvertes: entree.sessionsOuvertes ?? [],
      postesAyantVendu: new Set(entree.postesAyantVendu ?? []),
    });

  it('1. lireFileVide lit le booléen ou rend null', () => {
    expect(lireFileVide({ fileVide: true })).toBe(true);
    expect(lireFileVide({ fileVide: false })).toBe(false);
    expect(lireFileVide(null)).toBeNull();
    expect(lireFileVide([])).toBeNull();
    expect(lireFileVide({})).toBeNull();
    expect(lireFileVide({ fileVide: 'non' })).toBeNull();
    expect(lireFileVide('x')).toBeNull();
  });

  it('2. session ouverte, web et desktop', () => {
    const res = attendus({
      postes: [
        poste({ id: 'W1', type: 'WEB' }),
        poste({ id: 'D1', type: 'DESKTOP' }),
      ],
      sessionsOuvertes: [
        { id: 'sw', posteId: 'W1', utilisateurNom: 'Awa Bah' },
        { id: 'sd', posteId: 'D1', utilisateurNom: 'Mamadou Diallo' },
      ],
    });
    expect(res.map((r) => r.posteCode)).toEqual(['D1', 'W1']);
    expect(res[0]).toMatchObject({
      raison: 'SESSION_OUVERTE',
      sessionId: 'sd',
      utilisateurNom: 'Mamadou Diallo',
      message:
        'La caisse de Mamadou Diallo est encore ouverte sur Poste D1 (D1) : ses ventes ne sont peut-être pas toutes arrivées.',
    });
    expect(res[1]).toMatchObject({
      raison: 'SESSION_OUVERTE',
      sessionId: 'sw',
      utilisateurNom: 'Awa Bah',
      message:
        'La caisse de Awa Bah est encore ouverte sur Poste W1 (W1) : elle doit être fermée avec le comptage du tiroir.',
    });
  });

  it('3. file non vide', () => {
    const d2 = poste({
      id: 'D2',
      dernierEtat: { fileVide: false },
      dernierContactLe: new Date('2026-10-29T18:00:00.000Z'),
    });
    const res = attendus({ postes: [d2] });
    expect(res).toHaveLength(1);
    expect(res[0].raison).toBe('FILE_NON_VIDE');
    expect(res[0].sessionId).toBeNull();
    expect(res[0].message).toContain('29/10/2026 à 18:00');
    expect(attendus({ postes: [{ ...d2, actif: false }] })).toEqual([]);
  });

  it('4. synchro incomplète', () => {
    const d3 = poste({
      id: 'D3',
      dernierContactLe: new Date('2026-10-29T23:00:00.000Z'),
      dernierEtat: { fileVide: true },
    });
    const res = attendus({ postes: [d3], postesAyantVendu: ['D3'] });
    expect(res.map((r) => r.raison)).toEqual(['SYNCHRO_INCOMPLETE']);
    const jamais = attendus({
      postes: [{ ...d3, dernierContactLe: null }],
      postesAyantVendu: ['D3'],
    });
    expect(jamais[0].message).toContain('jamais');
  });

  it('5. synchro complète depuis le début du jour', () => {
    const d4 = poste({
      id: 'D4',
      dernierContactLe: new Date('2026-10-30T08:00:00.000Z'),
      dernierEtat: { fileVide: true },
    });
    expect(attendus({ postes: [d4], postesAyantVendu: ['D4'] })).toEqual([]);
    const inconnue = attendus({
      postes: [{ ...d4, dernierEtat: null }],
      postesAyantVendu: ['D4'],
    });
    expect(inconnue.map((r) => r.raison)).toEqual(['SYNCHRO_INCOMPLETE']);
  });

  it('6. poste qui n’a pas vendu', () => {
    expect(attendus({ postes: [poste({ id: 'D5' })] })).toEqual([]);
    expect(
      attendus({
        postes: [
          poste({ id: 'W2', type: 'WEB', dernierEtat: { fileVide: false } }),
        ],
      }),
    ).toEqual([]);
  });

  it('7. la session ouverte l’emporte sur la file non vide', () => {
    const res = attendus({
      postes: [poste({ id: 'D6', dernierEtat: { fileVide: false } })],
      sessionsOuvertes: [
        { id: 's6', posteId: 'D6', utilisateurNom: 'Awa Bah' },
      ],
    });
    expect(res).toHaveLength(1);
    expect(res[0].raison).toBe('SESSION_OUVERTE');
  });

  it('8. forcageAutorise et versPosteManquant', () => {
    const desktop = attendus({
      postes: [poste({ id: 'D1' })],
      sessionsOuvertes: [{ id: 's', posteId: 'D1', utilisateurNom: 'A B' }],
    });
    const web = attendus({
      postes: [poste({ id: 'W1', type: 'WEB' })],
      sessionsOuvertes: [{ id: 's2', posteId: 'W1', utilisateurNom: 'A B' }],
    });
    expect(forcageAutorise([])).toBe(false);
    expect(forcageAutorise(desktop)).toBe(true);
    expect(forcageAutorise([...desktop, ...web])).toBe(false);
    const manquant = versPosteManquant(desktop[0]);
    expect(manquant).not.toHaveProperty('message');
    expect(Object.keys(manquant)).toEqual([
      'posteId',
      'posteCode',
      'libelle',
      'type',
      'raison',
      'sessionId',
      'utilisateurNom',
      'dernierContactLe',
    ]);
  });

  it('9. totauxCloture somme par mode', () => {
    const r = (
      sessionId: string,
      mode: string,
      ordre: number,
      theorique: number,
      compte: number | null,
    ): ResultatPourCloture => ({
      sessionId,
      mode,
      libelle: mode,
      ordre,
      theorique,
      compte,
    });
    const totaux = totauxCloture([
      r('s2', 'MTN_MOMO', 3, 20000, null),
      r('s1', 'ORANGE_MONEY', 2, 50000, 50000),
      r('s2', 'ESPECES', 1, 100000, 100000),
      r('s2', 'ORANGE_MONEY', 2, 0, null),
      r('s1', 'ESPECES', 1, 300000, 290000),
    ]);
    expect(totaux.map((t) => t.mode)).toEqual([
      'ESPECES',
      'ORANGE_MONEY',
      'MTN_MOMO',
    ]);
    expect(totaux[0]).toMatchObject({
      theorique: 400000,
      compte: 390000,
      ecart: -10000,
      sessionsNonRapprochees: 0,
    });
    expect(totaux[1]).toMatchObject({
      theorique: 50000,
      compte: 50000,
      ecart: 0,
      sessionsNonRapprochees: 0,
    });
    expect(totaux[2]).toMatchObject({
      theorique: 20000,
      compte: null,
      ecart: null,
      sessionsNonRapprochees: 1,
    });
    expect(totauxCloture([])).toEqual([]);
  });
});
