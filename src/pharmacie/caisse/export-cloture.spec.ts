import {
  ENTETES_EXPORT_CLOTURE,
  exporterCloture,
  type MouvementExport,
  type PieceExport,
} from './export-cloture';

const jour = '2026-10-30';
const BOM = '\u{FEFF}';

function instant(heure: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 9, 30, heure, minute));
}

function piece(sur: Partial<PieceExport> = {}): PieceExport {
  return {
    numero: 'T1-0000012',
    typePiece: 'VENTE',
    numeroOrigine: null,
    createdAt: instant(14, 5),
    posteCode: 'W1',
    vendeurNom: 'Mamadou Diallo',
    total: 25000,
    motif: null,
    caisseIncluse: true,
    paiements: [],
    ...sur,
  };
}

function mouvement(sur: Partial<MouvementExport> = {}): MouvementExport {
  return {
    type: 'APPORT',
    horodatage: instant(9),
    posteCode: 'W1',
    utilisateurNom: 'Mamadou Diallo',
    libelleMode: 'Espèces',
    montant: 50000,
    motif: 'Fond complémentaire',
    caisseIncluse: true,
    ...sur,
  };
}

/** Lignes du fichier sans la ligne d'en-têtes, découpées par point-virgule. */
function lignesDe(texte: string): string[] {
  const lignes = texte.split('\r\n');
  lignes.pop();
  return lignes.slice(1);
}

describe('exporterCloture', () => {
  it('1. un fichier vide ne contient que le BOM et les en-têtes', () => {
    const texte = exporterCloture(jour, [], []);
    expect(texte.startsWith(BOM)).toBe(true);
    expect(ENTETES_EXPORT_CLOTURE).toHaveLength(13);
    expect(texte).toBe(`${BOM}${ENTETES_EXPORT_CLOTURE.join(';')}\r\n`);
  });

  it('2. une pièce suivie de ses paiements triés par mode', () => {
    const texte = exporterCloture(
      jour,
      [
        piece({
          paiements: [
            {
              libelleMode: 'Orange Money',
              ordreMode: 2,
              codeMode: 'ORANGE_MONEY',
              reference: 'OM-778',
              montant: 15000,
              createdAt: instant(14, 5),
            },
            {
              libelleMode: 'Espèces',
              ordreMode: 1,
              codeMode: 'ESPECES',
              reference: null,
              montant: 10000,
              createdAt: instant(14, 5),
            },
          ],
        }),
      ],
      [],
    );
    const lignes = lignesDe(texte);
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toBe(
      '2026-10-30;Pièce;T1-0000012;Vente;;30/10/2026 à 14:05;W1;Mamadou Diallo;;;25000;;Oui',
    );
    expect(lignes[1]).toBe(
      '2026-10-30;Paiement;T1-0000012;Vente;;30/10/2026 à 14:05;W1;Mamadou Diallo;Espèces;;10000;;Oui',
    );
    expect(lignes[2]).toBe(
      '2026-10-30;Paiement;T1-0000012;Vente;;30/10/2026 à 14:05;W1;Mamadou Diallo;Orange Money;OM-778;15000;;Oui',
    );
  });

  it('3. une annulation porte son origine, son motif et des montants négatifs', () => {
    const texte = exporterCloture(
      jour,
      [
        piece({
          numero: 'A-T1-0000012',
          typePiece: 'ANNULATION',
          numeroOrigine: 'T1-0000012',
          total: -25000,
          motif: 'Erreur de quantité',
          paiements: [
            {
              libelleMode: 'Espèces',
              ordreMode: 1,
              codeMode: 'ESPECES',
              reference: null,
              montant: -25000,
              createdAt: instant(14, 5),
            },
          ],
        }),
      ],
      [],
    );
    const [entete, paiement] = lignesDe(texte).map((l) => l.split(';'));
    expect(entete[3]).toBe('Annulation');
    expect(entete[4]).toBe('T1-0000012');
    expect(entete[10]).toBe('-25000');
    expect(entete[11]).toBe('Erreur de quantité');
    expect(paiement[10]).toBe('-25000');
  });

  it('4. les mouvements sont signés, triés par horodatage et placés après les pièces', () => {
    const texte = exporterCloture(
      jour,
      [piece()],
      [
        mouvement({
          type: 'REMBOURSEMENT',
          horodatage: instant(16),
          montant: 5000,
          motif: 'Remboursement client',
        }),
        mouvement({
          type: 'PRELEVEMENT',
          horodatage: instant(12),
          montant: 100000,
          motif: 'Dépôt au coffre',
        }),
        mouvement({ type: 'APPORT', horodatage: instant(9), montant: 50000 }),
      ],
    );
    const lignes = lignesDe(texte).map((l) => l.split(';'));
    expect(lignes.map((l) => l[1])).toEqual([
      'Pièce',
      'Mouvement de caisse',
      'Mouvement de caisse',
      'Mouvement de caisse',
    ]);
    expect(lignes.slice(1).map((l) => [l[3], l[10]])).toEqual([
      ['Apport', '50000'],
      ['Prélèvement', '-100000'],
      ['Remboursement', '-5000'],
    ]);
  });

  it('5. les guillemets, points-virgules et sauts de ligne sont échappés', () => {
    const texte = exporterCloture(
      jour,
      [
        piece({
          typePiece: 'ANNULATION',
          motif: 'Client "pressé"; rendu 500',
        }),
        piece({
          numero: 'T1-0000013',
          typePiece: 'ANNULATION',
          motif: 'Première ligne\nSeconde ligne',
        }),
      ],
      [],
    );
    expect(texte).toContain(';"Client ""pressé""; rendu 500";Oui');
    expect(texte).toContain(';"Première ligne\nSeconde ligne";Oui');
  });

  it('6. les textes qui ressemblent à une formule sont neutralisés, pas les montants', () => {
    const texte = exporterCloture(
      jour,
      [
        piece({
          typePiece: 'ANNULATION',
          motif: '=SOMME(A1)',
          vendeurNom: '-Fanta',
          total: -25000,
        }),
      ],
      [],
    );
    const [champs] = lignesDe(texte).map((l) => l.split(';'));
    expect(champs[7]).toBe("'-Fanta");
    expect(champs[11]).toBe("'=SOMME(A1)");
    expect(champs[10]).toBe('-25000');
  });

  it('7. une caisse non incluse dans la clôture donne Non sur la pièce et ses paiements', () => {
    const texte = exporterCloture(
      jour,
      [
        piece({
          caisseIncluse: false,
          paiements: [
            {
              libelleMode: 'Espèces',
              ordreMode: 1,
              codeMode: 'ESPECES',
              reference: null,
              montant: 25000,
              createdAt: instant(14, 5),
            },
          ],
        }),
      ],
      [],
    );
    const lignes = lignesDe(texte).map((l) => l.split(';'));
    expect(lignes).toHaveLength(2);
    expect(lignes.map((l) => l[12])).toEqual(['Non', 'Non']);
  });

  it('8. une référence faite uniquement de chiffres reste du texte dans Excel (D628)', () => {
    const paiement = (
      reference: string,
      codeMode: string,
      ordreMode: number,
    ) => ({
      libelleMode: codeMode,
      ordreMode,
      codeMode,
      reference,
      montant: 5000,
      createdAt: instant(14, 5),
    });
    const texte = exporterCloture(
      jour,
      [
        piece({
          total: 15000,
          paiements: [
            paiement('0012345678', 'ORANGE_MONEY', 2),
            paiement('123456789012', 'MTN_MOMO', 3),
            paiement('OM-0042', 'AUTRE', 4),
          ],
        }),
      ],
      [],
    );
    const references = lignesDe(texte)
      .slice(1)
      .map((l) => l.split(';')[9]);
    expect(references).toEqual(["'0012345678", "'123456789012", 'OM-0042']);
  });
});
