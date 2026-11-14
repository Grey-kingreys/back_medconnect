import { MEDICAMENTS_DEMO, STOCKS_DEMO } from 'src/demo/demo.donnees';
import {
  EVENEMENTS_POSTE_LOT_A,
  EVENEMENTS_POSTE_LOT_B,
  EVENEMENTS_POSTE_LOT_C,
  FOURNISSEURS_SCENARIO,
  INVENTAIRE_SCENARIO,
  RECEPTIONS_SCENARIO,
  STOCK_REPRIS_SCENARIO,
  VENTES_WEB_SCENARIO,
  type CoupureScenario,
  type EvenementPosteScenario,
  type LigneTicketScenario,
  type PaiementScenario,
} from './scenario-demo-pharmacie.donnees';

const EVENEMENTS_POSTE = [
  ...EVENEMENTS_POSTE_LOT_A,
  ...EVENEMENTS_POSTE_LOT_B,
  ...EVENEMENTS_POSTE_LOT_C,
];
const COUPURES_REFERENTIEL = [20000, 10000, 5000, 2000, 1000, 500];

const fichesKaloum = new Map(
  STOCKS_DEMO.filter((s) => s.pharmacie === 'pharmaKaloum').map((s) => [
    s.medicament,
    s,
  ]),
);
const fichesNiger = new Map(
  STOCKS_DEMO.filter((s) => s.pharmacie === 'pharmaNiger').map((s) => [
    s.medicament,
    s,
  ]),
);

const somme = (nombres: number[]) => nombres.reduce((a, b) => a + b, 0);
const sommeLignes = (lignes: LigneTicketScenario[]) =>
  somme(lignes.map((l) => l.nombre * l.prixUnitaire));
const sommePaiements = (paiements: PaiementScenario[]) =>
  somme(paiements.map((p) => p.montant));
const valeurComptage = (coupures: CoupureScenario[]) =>
  somme(coupures.map((c) => c.valeurFaciale * c.nombre));

const ventesPoste = EVENEMENTS_POSTE.flatMap((e) =>
  e.type === 'VENTE' ? [e] : [],
);
/** Toutes les lignes vendues (poste et web) avec l'ordonnance de leur vente. */
const lignesVendues = [
  ...ventesPoste.map((v) => ({
    lignes: v.lignes,
    ordonnanceVerifiee: v.ordonnanceVerifiee,
  })),
  ...VENTES_WEB_SCENARIO.map((w) => ({
    lignes: w.lignes,
    ordonnanceVerifiee: w.ordonnanceVerifiee === true,
  })),
].flatMap((v) =>
  v.lignes.map((l) => ({ ligne: l, ordonnanceVerifiee: v.ordonnanceVerifiee })),
);

describe('Scénario pharmacie de démonstration : données', () => {
  it('la vente de Ventoline sans stock passe par le poste, sur la caisse S3 du jour, ticket 10 (D721)', () => {
    const vente = EVENEMENTS_POSTE_LOT_C.flatMap((e) =>
      e.type === 'VENTE' ? [e] : [],
    );
    expect(vente).toHaveLength(1);
    expect(vente[0].session).toBe('S3');
    expect(vente[0].ticket).toBe(10);
    expect(vente[0].lignes[0].medicament).toBe('Ventoline 100 µg');
    expect(
      VENTES_WEB_SCENARIO.some((w) =>
        w.lignes.some((l) => l.medicament === 'Ventoline 100 µg'),
      ),
    ).toBe(false);
  });

  it('chaque vente du poste et du web a un total égal à la somme de ses lignes et de ses paiements', () => {
    expect(ventesPoste).toHaveLength(10);
    for (const v of ventesPoste) {
      expect(sommeLignes(v.lignes)).toBe(v.total);
      expect(sommePaiements(v.paiements)).toBe(v.total);
    }
    expect(VENTES_WEB_SCENARIO).toHaveLength(2);
    for (const w of VENTES_WEB_SCENARIO) {
      expect(sommeLignes(w.lignes)).toBe(w.total);
      if (w.paiements) expect(sommePaiements(w.paiements)).toBe(w.total);
    }
  });

  it("les prix des tickets sont ceux des fiches (boîte ou unité) et l'unité n'est vendue que sur une fiche déconditionnable", () => {
    for (const { ligne } of lignesVendues) {
      const fiche = fichesKaloum.get(ligne.medicament);
      expect(fiche).toBeDefined();
      if (!fiche) continue;
      if (ligne.unite === 'BOITE') {
        expect(ligne.prixUnitaire).toBe(fiche.prixUnitaire);
      } else {
        expect(fiche.deconditionnable).toBe(true);
        expect(ligne.prixUnitaire).toBe(fiche.prixUnite);
      }
    }
  });

  it('les comptages n’utilisent que les coupures du référentiel et valent 200 000, 211 000 et 224 000 GNF', () => {
    const comptages = EVENEMENTS_POSTE.flatMap((e) =>
      e.type === 'COMPTAGE_SAISI' || e.type === 'SESSION_FERMEE'
        ? [e.coupures]
        : [],
    );
    for (const coupures of comptages) {
      for (const c of coupures) {
        expect(COUPURES_REFERENTIEL).toContain(c.valeurFaciale);
      }
    }
    expect(comptages.map(valeurComptage)).toEqual([
      200000, 211000, 200000, 224000, 200000,
    ]);
  });

  it('tout médicament du scénario a une fiche dans la pharmacie concernée', () => {
    for (const r of RECEPTIONS_SCENARIO) {
      const fiches = r.pharmacie === 'kaloum' ? fichesKaloum : fichesNiger;
      for (const l of r.lignes) expect(fiches.has(l.medicament)).toBe(true);
    }
    for (const f of FOURNISSEURS_SCENARIO) {
      expect(
        RECEPTIONS_SCENARIO.some(
          (r) => r.pharmacie === f.pharmacie && r.fournisseur === f.nom,
        ),
      ).toBe(true);
    }
    expect(fichesNiger.has(STOCK_REPRIS_SCENARIO.medicament)).toBe(true);
    expect(fichesNiger.get(STOCK_REPRIS_SCENARIO.medicament)?.qualifie).toBe(
      false,
    );
    for (const l of INVENTAIRE_SCENARIO.lignes) {
      expect(fichesKaloum.has(l.medicament)).toBe(true);
    }
    for (const { ligne } of lignesVendues) {
      expect(fichesKaloum.has(ligne.medicament)).toBe(true);
    }
  });

  it("toute ligne d'un médicament sur ordonnance a l'ordonnance vérifiée", () => {
    const surOrdonnance = new Set(
      MEDICAMENTS_DEMO.filter((m) => m.ordonnanceRequise).map((m) => m.nom),
    );
    let controlees = 0;
    for (const { ligne, ordonnanceVerifiee } of lignesVendues) {
      if (!surOrdonnance.has(ligne.medicament)) continue;
      controlees++;
      expect(ordonnanceVerifiee).toBe(true);
    }
    expect(controlees).toBeGreaterThan(0);
  });

  it('les réceptions comptent un lot à 7 jours au plus, un à 30, un à 90, et un lot sans coût ; aucune péremption passée', () => {
    const lots = RECEPTIONS_SCENARIO.flatMap((r) => r.lignes);
    expect(lots.every((l) => l.expirationJours > 0)).toBe(true);
    expect(
      lots.filter((l) => l.expirationJours <= 7).map((l) => l.numeroLot),
    ).toEqual(['CT23H990']);
    expect(
      lots
        .filter((l) => l.expirationJours > 7 && l.expirationJours <= 30)
        .map((l) => l.numeroLot),
    ).toEqual(['DL23K052']);
    expect(
      lots
        .filter((l) => l.expirationJours > 30 && l.expirationJours <= 90)
        .map((l) => l.numeroLot),
    ).toEqual(['FG24E118']);
    expect(
      lots
        .filter((l) => l.coutAchatBoite === undefined)
        .map((l) => l.numeroLot),
    ).toEqual(['IB24G210']);
    expect(STOCK_REPRIS_SCENARIO.expirationJours).toBeGreaterThan(0);
  });

  it("les séquences du poste vont de 1 à 19 sans trou, dans l'ordre des horodatages", () => {
    expect(EVENEMENTS_POSTE.map((e) => e.sequence)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
    const instant = (e: EvenementPosteScenario) =>
      `${String(e.jour + 100).padStart(3, '0')}T${e.heure}`;
    const instants = EVENEMENTS_POSTE.map(instant);
    expect(instants).toEqual([...instants].sort());
    expect(new Set(instants).size).toBe(instants.length);
  });
});
