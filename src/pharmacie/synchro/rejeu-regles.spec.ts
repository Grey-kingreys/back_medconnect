import type { CorpsVenteDto } from '../dto/synchro.dto';
import {
  anomaliesApplication,
  calculerLigneRejeu,
  codeRejetDepuisHttp,
  contientNul,
  corpsIllisible,
  corpsStockable,
  echecPassager,
  empreinteEvenement,
  horodatageBorne,
  jsonCanonique,
  messageSynthese,
  numeroHorsPlage,
  numeroSecours,
  resumeEvenement,
  verifierCoherenceVente,
  type FicheRejeu,
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

describe('calculerLigneRejeu (D652)', () => {
  it('une boîte de 10 à 1 200 : 10 unités à 120', () => {
    expect(
      calculerLigneRejeu({
        unite: 'BOITE',
        nombre: 1,
        prixTicket: 1200,
        coefficientBoite: 10,
      }),
    ).toEqual({
      prixAppliqueParUm: 120,
      quantiteUm: 10,
      montantLigne: 1200,
      uniteAffichee: 'BOITE',
      nombreAffiche: 1,
      coefficientApplique: 10,
    });
  });

  it('3 unités à 150 : coefficient 1, montant 450', () => {
    expect(
      calculerLigneRejeu({
        unite: 'UNITE',
        nombre: 3,
        prixTicket: 150,
        coefficientBoite: 10,
      }),
    ).toEqual({
      prixAppliqueParUm: 150,
      quantiteUm: 3,
      montantLigne: 450,
      uniteAffichee: 'UNITE',
      nombreAffiche: 3,
      coefficientApplique: 1,
    });
  });

  it('une boîte de 3 à 1 000 : prix par unité arrondi à 333', () => {
    const l = calculerLigneRejeu({
      unite: 'BOITE',
      nombre: 1,
      prixTicket: 1000,
      coefficientBoite: 3,
    });
    expect(l.prixAppliqueParUm).toBe(333);
    expect(l.quantiteUm).toBe(3);
    expect(l.montantLigne).toBe(1000);
  });
});

describe('verifierCoherenceVente', () => {
  const base = (surcharge: Partial<CorpsVenteDto>): CorpsVenteDto =>
    ({
      venteId: 'v',
      sessionId: 's',
      numeroTicket: 5,
      lignes: [
        { stockId: 'a', unite: 'BOITE', nombre: 2, prixUnitaire: 1000 },
        { stockId: 'b', unite: 'UNITE', nombre: 3, prixUnitaire: 150 },
      ],
      paiements: [{ mode: 'ESPECES', montant: 2450 }],
      total: 2450,
      ordonnanceVerifiee: true,
      ...surcharge,
    }) as CorpsVenteDto;

  it('accepte un corps juste', () => {
    expect(verifierCoherenceVente(base({}))).toEqual({ ok: true });
    expect(
      verifierCoherenceVente(
        base({ numeroTicket: undefined, numeroSecours: 3 }),
      ),
    ).toEqual({ ok: true });
  });

  it('refuse deux numéros ou aucun', () => {
    expect(verifierCoherenceVente(base({ numeroSecours: 3 }))).toEqual({
      ok: false,
      champs: ['numeroTicket'],
    });
    expect(verifierCoherenceVente(base({ numeroTicket: undefined }))).toEqual({
      ok: false,
      champs: ['numeroTicket'],
    });
  });

  it('refuse un total faux', () => {
    expect(verifierCoherenceVente(base({ total: 2000 }))).toEqual({
      ok: false,
      champs: ['total'],
    });
  });
});

describe('numéros de ticket hors compteur (D655)', () => {
  it('formats de secours et hors plage', () => {
    expect(numeroSecours(1, 'D2', 4)).toBe('S1-D2-4');
    expect(numeroHorsPlage(1, 'D2', 17)).toBe('N1-D2-17');
  });
});

describe('anomaliesApplication (D653)', () => {
  const fiche = (surcharge: Partial<FicheRejeu> = {}): FicheRejeu => ({
    id: 'f1',
    nom: 'Paracétamol',
    prixUnitaire: 1000,
    prixUnite: 150,
    deconditionnable: true,
    ordonnanceRequise: false,
    archive: false,
    ...surcharge,
  });

  it('rien à signaler pour une vente conforme', () => {
    expect(
      anomaliesApplication(
        [{ fiche: fiche(), unite: 'BOITE', prixTicket: 1000 }],
        true,
      ),
    ).toEqual({
      prixDivergents: [],
      uniteInterdite: [],
      ordonnance: [],
      archives: [],
    });
  });

  it('prix de boîte différent', () => {
    const r = anomaliesApplication(
      [{ fiche: fiche(), unite: 'BOITE', prixTicket: 900 }],
      true,
    );
    expect(r.prixDivergents).toEqual([
      {
        stockId: 'f1',
        nom: 'Paracétamol',
        unite: 'BOITE',
        prixTicket: 900,
        prixFiche: 1000,
      },
    ]);
  });

  it('prix à l unité absent de la fiche', () => {
    const r = anomaliesApplication(
      [{ fiche: fiche({ prixUnite: null }), unite: 'UNITE', prixTicket: 150 }],
      true,
    );
    expect(r.prixDivergents).toHaveLength(1);
    expect(r.prixDivergents[0].prixFiche).toBeNull();
  });

  it('unité interdite, ordonnance et archive', () => {
    const r = anomaliesApplication(
      [
        {
          fiche: fiche({
            deconditionnable: false,
            ordonnanceRequise: true,
            archive: true,
            prixUnite: null,
          }),
          unite: 'UNITE',
          prixTicket: 150,
        },
      ],
      false,
    );
    expect(r.uniteInterdite).toEqual([{ stockId: 'f1', nom: 'Paracétamol' }]);
    expect(r.ordonnance).toEqual([{ stockId: 'f1', nom: 'Paracétamol' }]);
    expect(r.archives).toEqual([{ stockId: 'f1', nom: 'Paracétamol' }]);
    // Une seule anomalie pour l'unité interdite, jamais un prix divergent en plus (D666)
    expect(r.prixDivergents).toEqual([]);
  });

  it('unité interdite : le prix est contrôlé sur une autre ligne à la boîte (D666)', () => {
    const f = fiche({ deconditionnable: false, prixUnite: null });
    const r = anomaliesApplication(
      [
        { fiche: f, unite: 'UNITE', prixTicket: 150 },
        { fiche: f, unite: 'BOITE', prixTicket: 900 },
      ],
      true,
    );
    expect(r.uniteInterdite).toEqual([{ stockId: 'f1', nom: 'Paracétamol' }]);
    expect(r.prixDivergents).toEqual([
      {
        stockId: 'f1',
        nom: 'Paracétamol',
        unite: 'BOITE',
        prixTicket: 900,
        prixFiche: 1000,
      },
    ]);
  });

  it('ordonnance confirmée : aucune anomalie', () => {
    const r = anomaliesApplication(
      [
        {
          fiche: fiche({ ordonnanceRequise: true }),
          unite: 'BOITE',
          prixTicket: 1000,
        },
      ],
      true,
    );
    expect(r.ordonnance).toEqual([]);
  });

  it('une fiche sur deux lignes ne donne qu une entrée par cause', () => {
    const r = anomaliesApplication(
      [
        { fiche: fiche({ archive: true }), unite: 'BOITE', prixTicket: 900 },
        { fiche: fiche({ archive: true }), unite: 'BOITE', prixTicket: 800 },
      ],
      true,
    );
    expect(r.prixDivergents).toHaveLength(1);
    expect(r.prixDivergents[0].prixTicket).toBe(900);
    expect(r.archives).toHaveLength(1);
  });
});
