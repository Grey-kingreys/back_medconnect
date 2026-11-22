import { randomUUID } from 'node:crypto';
import {
  CorpsClientCreditCreeDto,
  CorpsClientCreditModifieDto,
  CorpsDateLimiteModifieeDto,
  CorpsRemboursementCreditDto,
  CorpsVenteDto,
  TYPES_EVENEMENT,
} from '../dto/synchro.dto';
import {
  MESSAGES_REJET,
  permissionsRequisesPourType,
  resumeEvenement,
} from './rejeu-regles';
import { validerCorps } from './valider-corps';

describe('Cahier de crédit hors ligne : corps et droits', () => {
  it('les quatre types sont acceptés et exigent credit:write', () => {
    for (const type of [
      'CLIENT_CREDIT_CREE',
      'CLIENT_CREDIT_MODIFIE',
      'REMBOURSEMENT_CREDIT',
      'DATE_LIMITE_MODIFIEE',
    ]) {
      expect(TYPES_EVENEMENT).toContain(type);
      expect(permissionsRequisesPourType(type)).toEqual(['credit:write']);
    }
  });

  it("le rejet CREDIT_HORS_LIGNE n'existe plus", () => {
    expect(Object.keys(MESSAGES_REJET)).not.toContain('CREDIT_HORS_LIGNE');
  });

  it('un client créé valide passe, un nom trop court ou une clé en trop est refusé', async () => {
    const corps = {
      id: randomUUID(),
      nomComplet: 'Mamadou Bah',
      telephone: '+224 621 00 00 00',
      note: '',
    };
    expect((await validerCorps(CorpsClientCreditCreeDto, corps)).ok).toBe(true);
    expect(
      (
        await validerCorps(CorpsClientCreditCreeDto, {
          ...corps,
          nomComplet: 'M',
        })
      ).ok,
    ).toBe(false);
    expect(
      (await validerCorps(CorpsClientCreditCreeDto, { ...corps, plafond: 5 }))
        .ok,
    ).toBe(false);
    expect(
      (
        await validerCorps(CorpsClientCreditCreeDto, {
          ...corps,
          telephone: 'abc',
        })
      ).ok,
    ).toBe(false);
  });

  it('une modification accepte null pour effacer le téléphone et refuse un champ inconnu', async () => {
    const id = randomUUID();
    expect(
      (
        await validerCorps(CorpsClientCreditModifieDto, {
          id,
          champs: { telephone: null, note: 'Voisin' },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsClientCreditModifieDto, {
          id,
          champs: { solde: 1 },
        })
      ).ok,
    ).toBe(false);
  });

  it('un remboursement exige un montant entier positif et un identifiant', async () => {
    const corps = {
      id: randomUUID(),
      clientId: randomUUID(),
      montant: 50000,
      verseEnCaisse: true,
      sessionId: randomUUID(),
    };
    expect((await validerCorps(CorpsRemboursementCreditDto, corps)).ok).toBe(
      true,
    );
    for (const faux of [
      { ...corps, montant: 0 },
      { ...corps, montant: 1.5 },
      { ...corps, id: 'x' },
      { ...corps, verseEnCaisse: 'oui' },
    ]) {
      expect((await validerCorps(CorpsRemboursementCreditDto, faux)).ok).toBe(
        false,
      );
    }
  });

  it('une date limite accepte null et refuse un format libre', async () => {
    const venteId = randomUUID();
    expect(
      (
        await validerCorps(CorpsDateLimiteModifieeDto, {
          venteId,
          dateLimite: null,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsDateLimiteModifieeDto, {
          venteId,
          dateLimite: '2026-12-31',
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsDateLimiteModifieeDto, {
          venteId,
          dateLimite: '31/12/2026',
        })
      ).ok,
    ).toBe(false);
  });

  it("une vente à crédit porte client, nouveau client et date limite ; le nouveau client garde l'identifiant du poste", async () => {
    const base = {
      venteId: randomUUID(),
      sessionId: randomUUID(),
      numeroTicket: 3,
      lignes: [{ stockId: 's', unite: 'BOITE', nombre: 1, prixUnitaire: 1000 }],
      paiements: [{ mode: 'CREDIT', montant: 1000 }],
      total: 1000,
      ordonnanceVerifiee: false,
    };
    expect(
      (
        await validerCorps(CorpsVenteDto, {
          ...base,
          clientCreditId: randomUUID(),
          dateLimiteCredit: '2026-12-31',
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsVenteDto, {
          ...base,
          nouveauClientCredit: { id: randomUUID(), nomComplet: 'Awa Diallo' },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsVenteDto, {
          ...base,
          dateLimiteCredit: 'demain',
        })
      ).ok,
    ).toBe(false);
  });

  it('le résumé ne contient jamais de nom, de téléphone ni de note', () => {
    const corps = {
      id: 'r1',
      clientId: 'c1',
      montant: 5000,
      note: 'secret',
      nomComplet: 'Awa',
      telephone: '621',
    };
    expect(resumeEvenement('REMBOURSEMENT_CREDIT', corps)).toEqual({
      remboursementId: 'r1',
      clientId: 'c1',
      montant: 5000,
    });
    expect(
      resumeEvenement('CLIENT_CREDIT_CREE', {
        id: 'c1',
        nomComplet: 'Awa',
        telephone: '621',
      }),
    ).toEqual({ clientId: 'c1' });
    expect(resumeEvenement('DATE_LIMITE_MODIFIEE', { venteId: 'v1' })).toEqual({
      venteId: 'v1',
    });
  });
});
