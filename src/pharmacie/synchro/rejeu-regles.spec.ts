import {
  codeRejetDepuisHttp,
  contientNul,
  corpsIllisible,
  corpsStockable,
  echecPassager,
  empreinteEvenement,
  horodatageBorne,
  jsonCanonique,
  messageSynthese,
  resumeEvenement,
} from './rejeu-regles';

describe('caractère NUL (D664)', () => {
  it('est trouvé dans une valeur, une clé ou une imbrication', () => {
    expect(contientNul('a\u0000b')).toBe(true);
    expect(contientNul({ a: [{ b: 'x\u0000' }] })).toBe(true);
    expect(contientNul({ ['c\u0000']: 1 })).toBe(true);
    expect(contientNul({ a: ['b', 1, null, true] })).toBe(false);
    expect(contientNul(undefined)).toBe(false);
  });

  it('un corps avec NUL est stocké en texte, sans perte, et reconnu illisible', () => {
    const corps = { motif: 'Mon\u0000naie' };
    const stocke = corpsStockable(corps) as { corpsIllisible: string };
    expect(contientNul(stocke)).toBe(false);
    expect(JSON.parse(stocke.corpsIllisible)).toEqual(corps);
    expect(corpsIllisible(corps)).toBe(true);
    expect(corpsIllisible(stocke)).toBe(true);
    expect(corpsIllisible({ motif: 'Monnaie' })).toBe(false);
    expect(corpsStockable({ motif: 'Monnaie' })).toEqual({ motif: 'Monnaie' });
    expect(corpsStockable(undefined)).toEqual({});
  });

  it('le résumé ne garde pas une chaîne avec NUL', () => {
    expect(resumeEvenement('SESSION_FERMEE', { sessionId: 's\u0000' })).toEqual(
      { sessionId: null },
    );
  });
});

describe('echecPassager (D664)', () => {
  it('reconnaît une panne passagère de la base', () => {
    const avecCode = (code: string) =>
      Object.assign(new Error('erreur'), { code });
    expect(echecPassager(avecCode('P2024'))).toBe(true);
    expect(echecPassager(avecCode('P2034'))).toBe(true);
    expect(echecPassager(avecCode('40P01'))).toBe(true);
    expect(
      echecPassager(new Error('Transaction already closed: timeout')),
    ).toBe(true);
    const init = new Error('base injoignable');
    init.name = 'PrismaClientInitializationError';
    expect(echecPassager(init)).toBe(true);
  });

  it('compte une erreur qui se répète à coup sûr', () => {
    expect(echecPassager(new TypeError('x is undefined'))).toBe(false);
    expect(
      echecPassager(
        Object.assign(new Error('unsupported Unicode escape sequence'), {
          code: 'P2010',
        }),
      ),
    ).toBe(false);
    expect(echecPassager('texte')).toBe(false);
  });
});

describe('jsonCanonique', () => {
  it("ignore l'ordre des clés, garde l'ordre des tableaux et trie en profondeur", () => {
    expect(jsonCanonique({ b: 1, a: { d: 2, c: 3 } })).toBe(
      jsonCanonique({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(jsonCanonique({ a: { c: 3, d: 2 }, b: 1 })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(jsonCanonique([3, 1, 2])).toBe('[3,1,2]');
    expect(jsonCanonique([3, 1, 2])).not.toBe(jsonCanonique([1, 2, 3]));
    expect(jsonCanonique({ liste: [{ y: 1, x: 2 }] })).toBe(
      '{"liste":[{"x":2,"y":1}]}',
    );
  });
});

describe('empreinteEvenement', () => {
  const base = {
    sequence: 4,
    type: 'MOUVEMENT_CAISSE',
    horodatageLocal: '2026-10-30T10:00:00.000Z',
    utilisateurId: 'usr-1',
    corps: { montant: 1000, motif: 'Monnaie' },
  };

  it('donne 64 caractères hexadécimaux, stables si les clés du corps sont permutées', () => {
    const e = empreinteEvenement(base);
    expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(
      empreinteEvenement({
        ...base,
        corps: { motif: 'Monnaie', montant: 1000 },
      }),
    ).toBe(e);
  });

  it('change quand la séquence, le type, l horodatage, l utilisateur ou le corps change', () => {
    const e = empreinteEvenement(base);
    expect(empreinteEvenement({ ...base, sequence: 5 })).not.toBe(e);
    expect(empreinteEvenement({ ...base, type: 'SESSION_FERMEE' })).not.toBe(e);
    expect(
      empreinteEvenement({
        ...base,
        horodatageLocal: '2026-10-30T10:00:01.000Z',
      }),
    ).not.toBe(e);
    expect(empreinteEvenement({ ...base, utilisateurId: 'usr-2' })).not.toBe(e);
    expect(
      empreinteEvenement({
        ...base,
        corps: { montant: 2000, motif: 'Monnaie' },
      }),
    ).not.toBe(e);
  });
});

describe('horodatageBorne', () => {
  const maintenant = new Date('2026-10-30T12:00:00.000Z');
  it('garde le passé et une avance de 4 minutes, ramène +6 minutes à maintenant', () => {
    const passe = new Date('2026-10-29T12:00:00.000Z');
    const quatre = new Date(maintenant.getTime() + 4 * 60_000);
    const six = new Date(maintenant.getTime() + 6 * 60_000);
    expect(horodatageBorne(passe, maintenant)).toBe(passe);
    expect(horodatageBorne(quatre, maintenant)).toBe(quatre);
    expect(horodatageBorne(six, maintenant)).toBe(maintenant);
  });
});

describe('codeRejetDepuisHttp', () => {
  it('garde les quatre codes connus, le reste devient EVENEMENT_INVALIDE', () => {
    for (const code of [
      'COMPTAGE_DEJA_SAISI',
      'IDENTIFIANT_DEJA_UTILISE',
      'SESSION_FERMEE',
      'STOCK_INTROUVABLE',
    ]) {
      expect(codeRejetDepuisHttp(code)).toBe(code);
    }
    expect(codeRejetDepuisHttp('VALIDATION')).toBe('EVENEMENT_INVALIDE');
    expect(codeRejetDepuisHttp('MODE_PAIEMENT_INCONNU')).toBe(
      'EVENEMENT_INVALIDE',
    );
    expect(codeRejetDepuisHttp(undefined)).toBe('EVENEMENT_INVALIDE');
  });
});

describe('messageSynthese', () => {
  it('lot vide, exemple de la fiche et catégorie unique', () => {
    expect(messageSynthese([])).toBe(
      'Poste à jour : aucune opération à envoyer.',
    );
    expect(
      messageSynthese([
        { statut: 'APPLIQUE' },
        { statut: 'APPLIQUE' },
        { statut: 'APPLIQUE' },
        { statut: 'EN_ATTENTE' },
      ]),
    ).toBe('Synchronisation : 3 enregistrée(s), 1 en attente.');
    expect(messageSynthese([{ statut: 'REJETE' }])).toBe(
      'Synchronisation : 1 mise(s) de côté.',
    );
  });
});

describe('resumeEvenement', () => {
  it('ne contient jamais le nom ni le téléphone du client', () => {
    const resume = resumeEvenement('VENTE', {
      venteId: 'v1',
      sessionId: 's1',
      numeroTicket: 12,
      total: 5000,
      lignes: [{}, {}],
      clientNom: 'Mariama',
      clientTelephone: '620000000',
    });
    expect(resume).toEqual({
      venteId: 'v1',
      sessionId: 's1',
      numeroTicket: 12,
      numeroSecours: null,
      total: 5000,
      nombreLignes: 2,
    });
    expect(Object.keys(resume)).not.toContain('clientNom');
    expect(Object.keys(resume)).not.toContain('clientTelephone');
  });

  it('rend un objet vide pour un type inconnu', () => {
    expect(resumeEvenement('ANNULATION', { sessionId: 's' })).toEqual({});
  });
});
