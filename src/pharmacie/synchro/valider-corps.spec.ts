import { randomUUID } from 'node:crypto';
import {
  CorpsComptageSaisiDto,
  CorpsMouvementCaisseDto,
  CorpsSessionFermeeDto,
  CorpsSessionOuverteDto,
} from '../dto/synchro.dto';
import { validerCorps } from './valider-corps';

describe('validerCorps', () => {
  it('accepte un comptage par montant total, refuse un montant négatif ou décimal', async () => {
    const base = {
      comptageId: randomUUID(),
      sessionId: randomUUID(),
      moment: 'FERMETURE',
    };
    const ok = await validerCorps(CorpsComptageSaisiDto, {
      ...base,
      montantEspeces: 350000,
    });
    expect(ok.ok).toBe(true);
    for (const montantEspeces of [-1, 1.5, 'abc', null]) {
      const r = await validerCorps(CorpsComptageSaisiDto, {
        ...base,
        montantEspeces,
      });
      expect(r.ok).toBe(false);
    }
  });

  it('refuse coupures à null, en comptage et en fermeture rejouée', async () => {
    const base = {
      comptageId: randomUUID(),
      sessionId: randomUUID(),
      moment: 'FERMETURE',
    };
    expect(
      (await validerCorps(CorpsComptageSaisiDto, { ...base, coupures: null }))
        .ok,
    ).toBe(false);
    expect(
      (
        await validerCorps(CorpsSessionFermeeDto, {
          sessionId: base.sessionId,
          comptageFermeture: {
            comptageId: base.comptageId,
            montantEspeces: null,
          },
        })
      ).ok,
    ).toBe(false);
  });

  it("refuse un corps qui n'est pas un objet", async () => {
    for (const corps of [null, undefined, 'texte', 12, [1]]) {
      expect(await validerCorps(CorpsSessionOuverteDto, corps)).toEqual({
        ok: false,
        champs: ['corps'],
      });
    }
  });

  it('accepte un corps valide de chaque classe de caisse', async () => {
    const sessionId = randomUUID();
    expect((await validerCorps(CorpsSessionOuverteDto, { sessionId })).ok).toBe(
      true,
    );
    expect(
      (
        await validerCorps(CorpsComptageSaisiDto, {
          comptageId: randomUUID(),
          sessionId,
          moment: 'OUVERTURE',
          coupures: [{ valeurFaciale: 20000, nombre: 5 }],
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsMouvementCaisseDto, {
          mouvementId: randomUUID(),
          sessionId,
          type: 'APPORT',
          montant: 1000,
          motif: ' Monnaie ',
        })
      ).ok,
    ).toBe(true);
    const fermee = await validerCorps(CorpsSessionFermeeDto, {
      sessionId,
      comptageFermeture: {
        comptageId: randomUUID(),
        coupures: [{ valeurFaciale: 10000, nombre: 1 }],
      },
      commentaire: 'RAS',
    });
    expect(fermee.ok).toBe(true);
  });

  it('refuse un champ inconnu', async () => {
    const resultat = await validerCorps(CorpsSessionOuverteDto, {
      sessionId: randomUUID(),
      intrus: 1,
    });
    expect(resultat).toEqual({ ok: false, champs: ['champInconnu'] });
  });

  it('ne recopie jamais une clé inconnue du poste et borne les chemins (D665)', async () => {
    const corps: Record<string, unknown> = { sessionId: randomUUID() };
    for (let i = 0; i < 50; i += 1) corps[`cle-${'x'.repeat(500)}-${i}`] = i;
    const resultat = await validerCorps(CorpsSessionOuverteDto, corps);
    expect(resultat).toEqual({ ok: false, champs: ['champInconnu'] });

    const coupures = Array.from({ length: 60 }, () => ({
      valeurFaciale: 'faux',
      nombre: 1,
    }));
    const beaucoup = await validerCorps(CorpsComptageSaisiDto, {
      comptageId: randomUUID(),
      sessionId: randomUUID(),
      moment: 'OUVERTURE',
      coupures,
    });
    expect(beaucoup.ok).toBe(false);
    if (!beaucoup.ok) expect(beaucoup.champs.length).toBeLessThanOrEqual(20);
  });

  it('rend le chemin du champ fautif, jamais sa valeur', async () => {
    const resultat = await validerCorps(CorpsComptageSaisiDto, {
      comptageId: randomUUID(),
      sessionId: randomUUID(),
      moment: 'OUVERTURE',
      coupures: [{ valeurFaciale: 'secret-1234', nombre: 5 }],
    });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.champs).toContain('coupures.0.valeurFaciale');
      expect(JSON.stringify(resultat)).not.toContain('secret-1234');
    }
  });
});
