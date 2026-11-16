import { randomUUID } from 'node:crypto';
import {
  CorpsImportStockFichierDto,
  TAILLE_MAX_FICHIER_DIFFERE,
  TYPES_EVENEMENT,
} from '../dto/synchro.dto';
import { LIMITE_CORPS_JSON } from '../../config/origines-cors';
import { permissionsRequisesPourType, resumeEvenement } from './rejeu-regles';
import { validerCorps } from './valider-corps';

describe("Événement d'import Excel mis de côté hors ligne : corps et droits", () => {
  const corps = () => ({
    id: randomUUID(),
    mode: 'livraison',
    nomFichier: 'livraison.xlsx',
    contenuBase64: Buffer.from('xlsx').toString('base64'),
  });

  it('le type est accepté et exige au moins stock:write (le droit du mode est contrôlé au rejeu)', () => {
    expect(TYPES_EVENEMENT).toContain('IMPORT_STOCK_FICHIER');
    expect(permissionsRequisesPourType('IMPORT_STOCK_FICHIER')).toEqual([
      'stock:write',
    ]);
  });

  it('un corps valide passe, pour les deux modes', async () => {
    expect((await validerCorps(CorpsImportStockFichierDto, corps())).ok).toBe(
      true,
    );
    expect(
      (
        await validerCorps(CorpsImportStockFichierDto, {
          ...corps(),
          mode: 'inventaire',
        })
      ).ok,
    ).toBe(true);
  });

  it('mode inconnu, identifiant absent, nom vide, contenu vide ou clé en trop : refus', async () => {
    for (const mauvais of [
      { ...corps(), mode: 'autre' },
      { ...corps(), id: undefined },
      { ...corps(), nomFichier: '' },
      { ...corps(), contenuBase64: '' },
      { ...corps(), surprise: 1 },
    ]) {
      expect((await validerCorps(CorpsImportStockFichierDto, mauvais)).ok).toBe(
        false,
      );
    }
  });

  it('un fichier de la taille maximale, encodé en base64, tient dans le corps de 2 Mo avec son enveloppe', () => {
    const base64 = Buffer.alloc(TAILLE_MAX_FICHIER_DIFFERE).toString('base64');
    const lot = JSON.stringify({
      posteId: randomUUID(),
      etat: { fileVide: false, sessionOuverte: true, versionApp: '0.1.0' },
      evenements: [
        {
          evenementId: randomUUID(),
          sequence: 1,
          type: 'IMPORT_STOCK_FICHIER',
          horodatageLocal: new Date().toISOString(),
          utilisateurId: randomUUID(),
          corps: { ...corps(), contenuBase64: base64 },
        },
      ],
    });
    expect(LIMITE_CORPS_JSON).toBe('2mb');
    expect(Buffer.byteLength(lot)).toBeLessThan(2 * 1024 * 1024 - 100_000);
  });

  it('le résumé ne contient jamais le contenu du fichier', () => {
    const c = corps();
    const resume = resumeEvenement('IMPORT_STOCK_FICHIER', c);
    expect(resume).toEqual({
      importId: c.id,
      mode: 'livraison',
      nomFichier: 'livraison.xlsx',
    });
    expect(JSON.stringify(resume)).not.toContain(c.contenuBase64);
  });
});
