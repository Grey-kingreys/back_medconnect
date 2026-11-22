import { randomUUID } from 'node:crypto';
import {
  CorpsInventaireEnregistreDto,
  TYPES_EVENEMENT,
} from '../dto/synchro.dto';
import { permissionsRequisesPourType, resumeEvenement } from './rejeu-regles';
import { validerCorps } from './valider-corps';

describe("Événement d'inventaire hors ligne : corps et droits", () => {
  const ligne = () => ({
    stockId: 's',
    lotId: randomUUID(),
    quantiteComptee: 12,
    theoriqueLocal: 10,
  });
  const corps = () => ({ id: randomUUID(), lignes: [ligne()] });

  it('le type est accepté et exige inventaire:write', () => {
    expect(TYPES_EVENEMENT).toContain('INVENTAIRE_ENREGISTRE');
    expect(permissionsRequisesPourType('INVENTAIRE_ENREGISTRE')).toEqual([
      'inventaire:write',
    ]);
  });

  it('un inventaire valide passe, avec un lot existant ou un nouveau lot', async () => {
    expect((await validerCorps(CorpsInventaireEnregistreDto, corps())).ok).toBe(
      true,
    );
    const nouveau = {
      id: randomUUID(),
      commentaire: 'Comptage du soir',
      lignes: [
        {
          stockId: 's',
          nouveauLot: {
            id: randomUUID(),
            numeroLot: 'L1',
            dateExpiration: '2030-01-31',
          },
          quantiteComptee: 5,
          theoriqueLocal: 0,
        },
      ],
    };
    expect((await validerCorps(CorpsInventaireEnregistreDto, nouveau)).ok).toBe(
      true,
    );
  });

  it('identifiant, quantité ou théorique invalides, clé en trop : refus', async () => {
    expect(
      (await validerCorps(CorpsInventaireEnregistreDto, { lignes: [ligne()] }))
        .ok,
    ).toBe(false);
    const negatif = corps();
    negatif.lignes[0].quantiteComptee = -1;
    expect((await validerCorps(CorpsInventaireEnregistreDto, negatif)).ok).toBe(
      false,
    );
    const sansTheorique = corps();
    delete (sansTheorique.lignes[0] as { theoriqueLocal?: number })
      .theoriqueLocal;
    expect(
      (await validerCorps(CorpsInventaireEnregistreDto, sansTheorique)).ok,
    ).toBe(false);
    expect(
      (await validerCorps(CorpsInventaireEnregistreDto, { ...corps(), x: 1 }))
        .ok,
    ).toBe(false);
  });

  it("le résumé ne cite que l'identifiant et le nombre de lignes", () => {
    const c = corps();
    expect(resumeEvenement('INVENTAIRE_ENREGISTRE', c)).toEqual({
      inventaireId: c.id,
      nombreLignes: 1,
    });
  });
});
