import {
  ANALYSES_DEMO,
  AUTO_DIAGNOSTICS_DEMO,
  COMPTES_DEMO,
  CONSULTATIONS_DEMO,
  CONVERSATIONS_DEMO,
  MEDICAMENTS_DEMO,
  NOTIFICATIONS_DEMO,
  RENDEZ_VOUS_DEMO,
  URGENCES_DEMO,
  VACCINATIONS_DEMO,
} from './demo.donnees';

/**
 * Dossier vitrine d'Aminata Diallo (compte patient de la page de connexion) :
 * volume suffisant pour une démonstration riche, et crédibilité médicale.
 */
describe("Dossier démo d'Aminata Diallo", () => {
  const aminata = COMPTES_DEMO.find((c) => c.cle === 'aminata');
  const consultations = CONSULTATIONS_DEMO.filter(
    (c) => c.patient === 'aminata',
  );
  const ordonnances = consultations.flatMap((c) =>
    c.ordonnance ? [c.ordonnance] : [],
  );

  it('reste le compte vitrine allergique à la pénicilline', () => {
    expect(aminata?.email).toBe('aminata.diallo@demo.medconnecte.gn');
    expect(aminata?.profil?.allergies).toMatch(/pénicilline/i);
    expect(aminata?.medecinTraitant).toBe('drDiallo');
  });

  it('contient au moins 8 consultations, 6 analyses, 6 vaccinations et 6 rendez-vous', () => {
    const pour = <T extends { patient: string }>(liste: T[]) =>
      liste.filter((x) => x.patient === 'aminata').length;

    expect(consultations.length).toBeGreaterThanOrEqual(8);
    expect(ordonnances.length).toBeGreaterThanOrEqual(6);
    expect(pour(ANALYSES_DEMO)).toBeGreaterThanOrEqual(6);
    expect(pour(VACCINATIONS_DEMO)).toBeGreaterThanOrEqual(6);
    expect(pour(RENDEZ_VOUS_DEMO)).toBeGreaterThanOrEqual(6);
    expect(pour(AUTO_DIAGNOSTICS_DEMO)).toBeGreaterThanOrEqual(3);
    expect(pour(URGENCES_DEMO)).toBeGreaterThanOrEqual(2);
    expect(
      NOTIFICATIONS_DEMO.filter((n) => n.destinataire === 'aminata').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('a au moins 2 conversations de 5 messages ou plus', () => {
    const conversations = CONVERSATIONS_DEMO.filter(
      (c) => c.patient === 'aminata' && c.messages.length >= 5,
    );
    expect(conversations.length).toBeGreaterThanOrEqual(2);
    expect(conversations.some((c) => c.medecin === 'drDiallo')).toBe(true);
    expect(conversations.some((c) => c.structure !== undefined)).toBe(true);
  });

  it('couvre plusieurs statuts de rendez-vous et plusieurs médecins', () => {
    const rdv = RENDEZ_VOUS_DEMO.filter((r) => r.patient === 'aminata');
    const statuts = new Set(rdv.map((r) => r.status));
    for (const s of ['TERMINE', 'CONFIRME', 'EN_ATTENTE', 'ANNULE']) {
      expect(statuts.has(s as never)).toBe(true);
    }
    expect(new Set(rdv.map((r) => r.medecin)).size).toBeGreaterThanOrEqual(3);
  });

  it('a des vaccinations avec et sans rappel', () => {
    const vaccins = VACCINATIONS_DEMO.filter((v) => v.patient === 'aminata');
    expect(vaccins.some((v) => v.rappelJours !== undefined)).toBe(true);
    expect(vaccins.some((v) => v.rappelJours === undefined)).toBe(true);
  });

  it('autorise chaque structure où elle a consulté', () => {
    for (const c of consultations) {
      expect(aminata?.autorisations).toContain(c.structure);
    }
    expect(new Set(consultations.map((c) => c.structure)).size).toBeGreaterThan(
      2,
    );
  });

  it('ne prescrit aucune pénicilline ni dérivé (allergie connue)', () => {
    const interdit =
      /cilline|augmentin|clamoxyl|clavulan|extencilline|bactox|orbénine/i;
    const catalogue = new Map(MEDICAMENTS_DEMO.map((m) => [m.nom, m]));

    const lignes = ordonnances.flatMap((o) => o.lignes);
    expect(lignes.length).toBeGreaterThan(0);
    for (const l of lignes) {
      expect(`${l.nom} ${l.dosage} ${l.instructions ?? ''}`).not.toMatch(
        interdit,
      );
      if (l.catalogue) {
        const m = catalogue.get(l.nom);
        // Une ligne du catalogue doit exister au catalogue (sinon le seed échoue).
        expect(m).toBeDefined();
        expect(`${m?.nomGenerique} ${m?.description}`).not.toMatch(interdit);
      }
    }
    for (const o of ordonnances) {
      expect(o.notes).not.toMatch(interdit);
    }
  });

  it('traite le paludisme par artéméther et luméfantrine', () => {
    const paludisme = consultations.find((c) =>
      /paludisme/i.test(c.diagnostic),
    );
    const catalogue = new Map(MEDICAMENTS_DEMO.map((m) => [m.nom, m]));
    const generiques = (paludisme?.ordonnance?.lignes ?? []).map(
      (l) => catalogue.get(l.nom)?.nomGenerique ?? '',
    );
    expect(generiques).toContain('Artéméther et luméfantrine');
  });
});
