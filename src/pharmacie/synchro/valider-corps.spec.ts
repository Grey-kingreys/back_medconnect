import { randomUUID } from 'node:crypto';
import {
  CorpsComptageSaisiDto,
  CorpsMouvementCaisseDto,
  CorpsSessionFermeeDto,
  CorpsSessionOuverteDto,
} from '../dto/synchro.dto';
import { validerCorps } from './valider-corps';

describe('validerCorps', () => {
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
