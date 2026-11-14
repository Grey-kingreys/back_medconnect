import {
  estCleEtrangereViolee,
  estDoublonSur,
  violeContrainte,
} from './erreurs-base';

describe('erreurs-base', () => {
  describe('violeContrainte', () => {
    it('reconnaît un CHECK violé remonté par l adaptateur', () => {
      const erreur = {
        name: 'DriverAdapterError',
        cause: {
          code: '23514',
          originalMessage:
            'new row for relation "AgregatStockLot" violates check constraint "AgregatStockLot_quantite_check"',
        },
      };
      expect(violeContrainte(erreur, 'AgregatStockLot_quantite_check')).toBe(
        true,
      );
    });

    it('refuse une autre contrainte', () => {
      const erreur = {
        cause: { originalMessage: 'violates check constraint "autre_check"' },
      };
      expect(violeContrainte(erreur, 'AgregatStockLot_quantite_check')).toBe(
        false,
      );
    });

    it('refuse les valeurs qui ne sont pas des erreurs', () => {
      expect(violeContrainte(null, 'AgregatStockLot_quantite_check')).toBe(
        false,
      );
      expect(violeContrainte('texte', 'AgregatStockLot_quantite_check')).toBe(
        false,
      );
      expect(violeContrainte(42, 'AgregatStockLot_quantite_check')).toBe(false);
    });
  });

  describe('estDoublonSur', () => {
    it('reconnaît un P2002 sur le bon modèle', () => {
      expect(
        estDoublonSur(
          { code: 'P2002', meta: { modelName: 'ConditionnementOuvert' } },
          'ConditionnementOuvert',
        ),
      ).toBe(true);
    });

    it('refuse un autre modèle ou un autre code', () => {
      expect(
        estDoublonSur(
          { code: 'P2002', meta: { modelName: 'LotStock' } },
          'ConditionnementOuvert',
        ),
      ).toBe(false);
      expect(
        estDoublonSur(
          { code: 'P2003', meta: { modelName: 'ConditionnementOuvert' } },
          'ConditionnementOuvert',
        ),
      ).toBe(false);
    });
  });

  describe('estCleEtrangereViolee', () => {
    it('reconnaît P2003 et le code PostgreSQL 23503', () => {
      expect(estCleEtrangereViolee({ code: 'P2003' })).toBe(true);
      expect(estCleEtrangereViolee({ cause: { originalCode: '23503' } })).toBe(
        true,
      );
    });

    it('refuse les autres erreurs', () => {
      expect(estCleEtrangereViolee({ code: 'P2002' })).toBe(false);
      expect(estCleEtrangereViolee(undefined)).toBe(false);
    });
  });
});
