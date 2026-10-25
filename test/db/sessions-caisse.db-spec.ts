import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { jourConakry } from 'src/pharmacie/vente.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import { chargerFormatActuel } from './fixtures/format-actuel';

async function refus<T>(
  promesse: Promise<T>,
): Promise<{ statut: number; corps: Record<string, unknown> }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      const reponse = erreur.getResponse();
      return {
        statut: erreur.getStatus(),
        corps:
          typeof reponse === 'string'
            ? { message: reponse }
            : (reponse as Record<string, unknown>),
      };
    }
    throw erreur;
  }
  throw new Error('Un refus était attendu, la promesse a abouti.');
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Sessions de caisse sur base de test (PB10)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let service: SessionsCaisseService;
  let postes: PointsDeVenteService;
  let compteurPoste = 0;
  let compteurVente = 0;
  const jour = jourConakry(new Date());

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          ['usr-admin-p1', 'usr-admin-p2'].includes(id)
            ? ['caisse:utiliser', 'caisse:superviser']
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    service = new SessionsCaisseService(prisma, acces, permissions);
    postes = new PointsDeVenteService(prisma, acces);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await fermerPrismaDeTest(prisma);
      }
    } finally {
      if (base) {
        await supprimerBaseDeTest(base);
      }
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function nouveauPoste(
    utilisateur = VENDEUR,
    structure = PHARMACIE,
  ): Promise<string> {
    compteurPoste += 1;
    const { data } = await postes.enregistrerPoste(structure, utilisateur, {
      type: 'WEB',
      appareilId: `appareil-essai-${compteurPoste}-${randomUUID().slice(0, 8)}`,
    });
    return data.id;
  }

  const coupures = (montants: Record<number, number>) =>
    Object.entries(montants).map(([valeur, nombre]) => ({
      valeurFaciale: Number(valeur),
      nombre,
    }));

  async function ouvrirSession(
    posteId: string,
    utilisateur = VENDEUR,
    montants?: Record<number, number>,
  ) {
    const { data } = await service.ouvrir(PHARMACIE, utilisateur, {
      posteId,
      comptage: montants ? { coupures: coupures(montants) } : undefined,
    });
    return data;
  }

  async function venteSql(v: {
    id: string;
    sessionId: string;
    total: number;
    typePiece?: string;
    origine?: string;
    motif?: string;
  }): Promise<void> {
    compteurVente += 1;
    await sql(
      'INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece","venteOrigineId","motifAnnulation") SELECT $1,$2,s."pointDeVenteId",s."posteId",s."id",$4,$5,$6,\'Caissier (harnais)\',$7,s."jourMetier",$8::"TypePieceVente",$9,$10 FROM "SessionCaisse" s WHERE s."id" = $3',
      [
        v.id,
        PHARMACIE,
        v.sessionId,
        `V-ESSAI-${String(compteurVente).padStart(6, '0')}`,
        9000 + compteurVente,
        VENDEUR,
        v.total,
        v.typePiece ?? 'VENTE',
        v.origine ?? null,
        v.motif ?? null,
      ],
    );
  }

  async function paiementSql(
    id: string,
    venteId: string,
    sessionId: string,
    codeMode: string,
    montant: number,
  ): Promise<void> {
    await sql(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant") SELECT $1,$2,$3,m."id",$5 FROM "ModePaiement" m WHERE m."code" = $4',
      [id, venteId, sessionId, codeMode, montant],
    );
  }

  /** Vente SQL payée en un seul mode. */
  async function venteEncaissee(
    sessionId: string,
    montant: number,
    mode = 'ESPECES',
  ): Promise<string> {
    const id = `vte-essai-${randomUUID()}`;
    await venteSql({ id, sessionId, total: montant });
    await paiementSql(`pai-${id}`, id, sessionId, mode, montant);
    return id;
  }

  let posteUn: string;
  let sessionUn: string;

  it('1. ouvrir : session OUVERTE du jour au nom du vendeur, sans fond compté', async () => {
    posteUn = await nouveauPoste();
    const { data, message } = await service.ouvrir(PHARMACIE, VENDEUR, {
      posteId: posteUn,
    });
    sessionUn = data.id;
    expect(data.ouverteMaintenant).toBe(true);
    expect(data.statut).toBe('OUVERTE');
    expect(data.utilisateurNom).toBe('Mamadou Diallo');
    expect(data.jourMetier).toBe(jour);
    expect(data.fondCaisse).toBe(0);
    expect(data.fondCompte).toBe(false);
    expect(data.comptageOuverture).toBeNull();
    expect(data.poste.code.startsWith('W')).toBe(true);
    expect(message).toBe('Caisse ouverte.');
    const res = await sql(
      'SELECT "evenementOuvertureId" FROM "SessionCaisse" WHERE "id" = $1',
      [data.id],
    );
    expect(res.rows[0].evenementOuvertureId).toBe(data.id);
  });

  it('2. ouvrir rejoué : même session, aucune ligne ajoutée', async () => {
    const a = await service.ouvrir(PHARMACIE, VENDEUR, { posteId: posteUn });
    const b = await service.ouvrir(PHARMACIE, VENDEUR, {
      posteId: posteUn,
      id: sessionUn,
    });
    const c = await service.ouvrir(PHARMACIE, VENDEUR, {
      posteId: posteUn,
      id: randomUUID(),
    });
    for (const r of [a, b, c]) {
      expect(r.data.id).toBe(sessionUn);
      expect(r.data.ouverteMaintenant).toBe(false);
      expect(r.message).toBe('Votre caisse était déjà ouverte.');
    }
    expect(
      await compter(
        'SELECT count(*) AS n FROM "SessionCaisse" WHERE "posteId" = $1 AND "statut" = \'OUVERTE\'',
        [posteUn],
      ),
    ).toBe(1);
  });

  it('3. ouvrir avec un id client et un comptage d ouverture', async () => {
    const poste = await nouveauPoste();
    const id = randomUUID();
    const { data } = await service.ouvrir(PHARMACIE, VENDEUR, {
      id,
      posteId: poste,
      comptage: { coupures: coupures({ 20000: 10 }) },
    });
    expect(data.id).toBe(id);
    expect(data.fondCaisse).toBe(200000);
    expect(data.fondCompte).toBe(true);
    expect(data.comptageOuverture?.coupures).toEqual([
      { valeurFaciale: 20000, nombre: 10 },
    ]);
  });

  it('4. cinq ouvertures simultanées du même vendeur sur le même poste : une seule session', async () => {
    const poste = await nouveauPoste();
    const reponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.ouvrir(PHARMACIE, VENDEUR, { posteId: poste }),
      ),
    );
    expect(new Set(reponses.map((r) => r.data.id)).size).toBe(1);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "SessionCaisse" WHERE "posteId" = $1 AND "statut" = \'OUVERTE\'',
        [poste],
      ),
    ).toBe(1);
  });

  it('5. autre vendeur sur un poste occupé : 409 SESSION_AUTRE_UTILISATEUR qui nomme le collègue', async () => {
    const e = await refus(
      service.ouvrir(PHARMACIE, RESPONSABLE, { posteId: posteUn }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('SESSION_AUTRE_UTILISATEUR');
    expect(String(e.corps.message)).toContain('Mamadou Diallo');
  });

  it('6. poste technique, d une autre pharmacie, désactivé ou inconnu : 409 POSTE_INCONNU', async () => {
    const avant = await compter('SELECT count(*) AS n FROM "SessionCaisse"');
    const technique = await sql(
      'SELECT p."id" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE pv."structureId" = $1 AND p."type" = \'TECHNIQUE\'',
      [PHARMACIE],
    );
    const autrePharmacie = await nouveauPoste('usr-pharm-p2', 'str-pharma-2');
    const desactive = await nouveauPoste();
    await sql('UPDATE "Poste" SET "actif" = false WHERE "id" = $1', [
      desactive,
    ]);
    for (const posteId of [
      technique.rows[0].id as string,
      autrePharmacie,
      desactive,
      randomUUID(),
    ]) {
      const e = await refus(service.ouvrir(PHARMACIE, VENDEUR, { posteId }));
      expect(e.statut).toBe(409);
      expect(e.corps.code).toBe('POSTE_INCONNU');
    }
    expect(await compter('SELECT count(*) AS n FROM "SessionCaisse"')).toBe(
      avant,
    );
  });

  it('7. id client déjà pris par une autre session : 409 IDENTIFIANT_DEJA_UTILISE', async () => {
    const poste = await nouveauPoste();
    const e = await refus(
      service.ouvrir(PHARMACIE, VENDEUR, { posteId: poste, id: sessionUn }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('IDENTIFIANT_DEJA_UTILISE');
  });

  it('8. courante : session ouverte du poste, null sinon, poste technique refusé', async () => {
    const vue = await service.courante(PHARMACIE, RESPONSABLE, posteUn);
    expect(vue.data?.id).toBe(sessionUn);
    expect(vue.message).toBe('Caisse ouverte sur ce poste.');
    const libre = await nouveauPoste();
    const vide = await service.courante(PHARMACIE, VENDEUR, libre);
    expect(vide.data).toBeNull();
    expect(vide.message).toBe('Aucune caisse ouverte sur ce poste.');
    const technique = await sql(
      'SELECT p."id" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE pv."structureId" = $1 AND p."type" = \'TECHNIQUE\'',
      [PHARMACIE],
    );
    const e = await refus(
      service.courante(PHARMACIE, VENDEUR, technique.rows[0].id as string),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('POSTE_INCONNU');
  });

  it('9. comptage d ouverture après coup, rejoué, puis refusé une seconde fois', async () => {
    const poste = await nouveauPoste();
    const session = await ouvrirSession(poste);
    const x = randomUUID();
    const premier = await service.saisirComptage(
      PHARMACIE,
      VENDEUR,
      session.id,
      { id: x, moment: 'OUVERTURE', coupures: coupures({ 20000: 10 }) },
    );
    expect(premier.data.cree).toBe(true);
    expect(premier.data.totalEspeces).toBe(200000);
    const rejeu = await service.saisirComptage(PHARMACIE, VENDEUR, session.id, {
      id: x,
      moment: 'OUVERTURE',
      coupures: coupures({ 20000: 10 }),
    });
    expect(rejeu.data.cree).toBe(false);
    const e = await refus(
      service.saisirComptage(PHARMACIE, VENDEUR, session.id, {
        id: randomUUID(),
        moment: 'OUVERTURE',
        coupures: coupures({ 20000: 10 }),
      }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('COMPTAGE_DEJA_SAISI');
    expect(e.corps.message).toBe(
      "Le comptage d'ouverture de cette caisse est déjà enregistré.",
    );
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ComptageCaisse" WHERE "sessionCaisseId" = $1 AND "moment" = \'OUVERTURE\'',
        [session.id],
      ),
    ).toBe(1);
  });

  it('10. coupures : 100 GNF inconnu (correction du porteur), doublon refusé, liste vide acceptée', async () => {
    const inconnue = await refus(
      service.saisirComptage(PHARMACIE, VENDEUR, sessionUn, {
        moment: 'FERMETURE',
        coupures: [{ valeurFaciale: 100, nombre: 3 }],
      }),
    );
    expect(inconnue.statut).toBe(400);
    expect(inconnue.corps.code).toBe('VALIDATION');
    expect(
      (inconnue.corps.champs as { contraintes: string[] }[])[0].contraintes,
    ).toEqual(['coupureConnue']);
    const doublon = await refus(
      service.saisirComptage(PHARMACIE, VENDEUR, sessionUn, {
        moment: 'FERMETURE',
        coupures: [
          { valeurFaciale: 20000, nombre: 1 },
          { valeurFaciale: 20000, nombre: 2 },
        ],
      }),
    );
    expect(
      (doublon.corps.champs as { contraintes: string[] }[])[0].contraintes,
    ).toEqual(['coupureUnique']);
    const autre = await ouvrirSession(await nouveauPoste());
    const vide = await service.saisirComptage(PHARMACIE, VENDEUR, autre.id, {
      moment: 'FERMETURE',
      coupures: [],
    });
    expect(vide.data.totalEspeces).toBe(0);
  });

  it('11. relevés : refusés à l ouverture, pour les espèces, en double ; mode inconnu', async () => {
    const session = await ouvrirSession(await nouveauPoste());
    const releve = (mode: string) => ({ mode, montant: 1000 });
    const contraintes = async (
      moment: 'OUVERTURE' | 'FERMETURE',
      releves: { mode: string; montant: number }[],
    ) => {
      const e = await refus(
        service.saisirComptage(PHARMACIE, VENDEUR, session.id, {
          moment,
          coupures: [],
          releves,
        }),
      );
      return e;
    };
    const ouverture = await contraintes('OUVERTURE', [releve('ORANGE_MONEY')]);
    expect(
      (ouverture.corps.champs as { contraintes: string[] }[])[0].contraintes,
    ).toEqual(['releveFermetureSeulement']);
    const especes = await contraintes('FERMETURE', [releve('ESPECES')]);
    expect(
      (especes.corps.champs as { contraintes: string[] }[])[0].contraintes,
    ).toEqual(['releveSansEspeces']);
    const double = await contraintes('FERMETURE', [
      releve('MTN_MOMO'),
      releve('MTN_MOMO'),
    ]);
    expect(
      (double.corps.champs as { contraintes: string[] }[])[0].contraintes,
    ).toEqual(['releveUnique']);
    const inconnu = await contraintes('FERMETURE', [releve('CARTE')]);
    expect(inconnu.statut).toBe(400);
    expect(inconnu.corps.code).toBe('MODE_PAIEMENT_INCONNU');
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ComptageCaisse" WHERE "sessionCaisseId" = $1',
        [session.id],
      ),
    ).toBe(0);
  });

  it('12. mouvement : motif exigé, mode vérifié, attribué, rejouable', async () => {
    const session = await ouvrirSession(await nouveauPoste());
    const autre = await ouvrirSession(await nouveauPoste());
    for (const motif of [undefined, 'ab']) {
      const e = await refus(
        service.enregistrerMouvement(PHARMACIE, VENDEUR, session.id, {
          type: 'PRELEVEMENT',
          montant: 1000,
          motif,
        }),
      );
      expect(e.statut).toBe(400);
      expect(e.corps.code).toBe('MOTIF_REQUIS');
    }
    const inconnu = await refus(
      service.enregistrerMouvement(PHARMACIE, VENDEUR, session.id, {
        type: 'PRELEVEMENT',
        montant: 1000,
        motif: 'Dépôt',
        mode: 'CARTE',
      }),
    );
    expect(inconnu.corps.code).toBe('MODE_PAIEMENT_INCONNU');
    const y = randomUUID();
    const corps = {
      id: y,
      type: 'PRELEVEMENT' as const,
      montant: 100000,
      motif: 'Dépôt à la banque',
    };
    const premier = await service.enregistrerMouvement(
      PHARMACIE,
      VENDEUR,
      session.id,
      corps,
    );
    expect(premier.data.cree).toBe(true);
    expect(premier.data.mode).toBe('ESPECES');
    expect(premier.data.auteurId).toBe(VENDEUR);
    expect(premier.message).toBe('Prélèvement enregistré.');
    const rejeu = await service.enregistrerMouvement(
      PHARMACIE,
      VENDEUR,
      session.id,
      corps,
    );
    expect(rejeu.data.cree).toBe(false);
    expect(rejeu.message).toBe('Ce mouvement était déjà enregistré.');
    expect(
      await compter(
        'SELECT count(*) AS n FROM "MouvementCaisse" WHERE "id" = $1',
        [y],
      ),
    ).toBe(1);
    const e = await refus(
      service.enregistrerMouvement(PHARMACIE, VENDEUR, autre.id, corps),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('IDENTIFIANT_DEJA_UTILISE');
  });

  let sessionCa15: string;
  let posteCa15: string;

  it('13. CA15 : fond 200 000, ventes 400 000, prélèvement 100 000, compté 490 000 : théorique 500 000, écart -10 000', async () => {
    posteCa15 = await nouveauPoste();
    const session = await ouvrirSession(posteCa15, VENDEUR, { 20000: 10 });
    sessionCa15 = session.id;
    await venteEncaissee(session.id, 150000);
    await venteEncaissee(session.id, 250000);
    await service.enregistrerMouvement(PHARMACIE, VENDEUR, session.id, {
      type: 'PRELEVEMENT',
      montant: 100000,
      motif: 'Dépôt à la banque',
    });

    const avant = await service.bilan(PHARMACIE, VENDEUR, session.id);
    expect(Object.keys(avant.data)[0]).toBe('activite');
    expect(avant.data.activite).toMatchObject({
      nombreVentes: 2,
      nombreAnnulations: 0,
      montantEncaisse: 400000,
    });
    expect(avant.data.activite.parMode).toEqual([
      {
        mode: 'ESPECES',
        libelle: 'Espèces',
        montant: 400000,
        nombrePaiements: 2,
      },
    ]);
    expect(
      avant.data.theorique.find((t) => t.mode === 'ESPECES')?.montant,
    ).toBe(500000);
    expect(avant.data.compte.find((t) => t.mode === 'ESPECES')?.montant).toBe(
      null,
    );
    expect(avant.data.fige).toBe(false);

    const comptageFermeture = { coupures: coupures({ 20000: 24, 10000: 1 }) };
    const sans = await refus(
      service.fermer(PHARMACIE, VENDEUR, session.id, { comptageFermeture }),
    );
    expect(sans.statut).toBe(400);
    expect(sans.corps.code).toBe('COMMENTAIRE_ECART_REQUIS');
    expect(sans.corps.message).toBe(
      "L'écart d'espèces est de -10 000 GNF, au-delà du seuil de 5 000 GNF : ajoutez un commentaire pour fermer la caisse.",
    );
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ComptageCaisse" WHERE "sessionCaisseId" = $1 AND "moment" = \'FERMETURE\'',
        [session.id],
      ),
    ).toBe(0);
    expect(
      (
        await sql('SELECT "statut" FROM "SessionCaisse" WHERE "id" = $1', [
          session.id,
        ])
      ).rows[0].statut,
    ).toBe('OUVERTE');

    const { data, message } = await service.fermer(
      PHARMACIE,
      VENDEUR,
      session.id,
      { comptageFermeture, commentaire: 'Erreur de rendu de monnaie' },
    );
    expect(message).toBe('Caisse fermée.');
    expect(data.fige).toBe(true);
    expect(data.theorique[0].mode).toBe('ESPECES');
    expect(data.theorique[0].montant).toBe(500000);
    expect(data.compte[0].montant).toBe(490000);
    expect(data.ecarts[0].ecart).toBe(-10000);
    expect(data.ecartEspeces).toBe(-10000);
    for (const mode of ['ORANGE_MONEY', 'MTN_MOMO']) {
      expect(data.compte.find((c) => c.mode === mode)?.montant).toBeNull();
    }

    const s = await sql(
      'SELECT "statut","fermeeLe","evenementFermetureId","commentaireEcart","commentaireParId" FROM "SessionCaisse" WHERE "id" = $1',
      [session.id],
    );
    expect(s.rows[0].statut).toBe('FERMEE');
    expect(s.rows[0].fermeeLe).not.toBeNull();
    expect(s.rows[0].evenementFermetureId).toBe(`fermeture:${session.id}`);
    expect(s.rows[0].commentaireEcart).toBe('Erreur de rendu de monnaie');
    expect(s.rows[0].commentaireParId).toBe(VENDEUR);
    const r = await sql(
      'SELECT m."code", r."theorique", r."compte", r."ecart" FROM "ResultatSessionMode" r JOIN "ModePaiement" m ON m."id" = r."modePaiementId" WHERE r."sessionCaisseId" = $1 ORDER BY m."ordre"',
      [session.id],
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      code: 'ESPECES',
      theorique: 500000,
      compte: 490000,
      ecart: -10000,
    });
    const anomalies = await sql(
      'SELECT "type","statut","attribueeAId","pieceType","details" FROM "Anomalie" WHERE "pieceId" = $1',
      [session.id],
    );
    expect(anomalies.rows).toHaveLength(1);
    expect(anomalies.rows[0]).toMatchObject({
      type: 'ECART_CAISSE',
      statut: 'OUVERTE',
      attribueeAId: RESPONSABLE,
      pieceType: 'SessionCaisse',
    });
    const details = anomalies.rows[0].details as Record<string, unknown>;
    expect(details.ecart).toBe(-10000);
    expect(Object.keys(details)).not.toContain('commentaire');
  });

  it('14. CA18 : fermeture sans comptage refusée, session restée ouverte', async () => {
    const session = await ouvrirSession(await nouveauPoste());
    const e = await refus(service.fermer(PHARMACIE, VENDEUR, session.id, {}));
    expect(e.statut).toBe(400);
    expect(e.corps.code).toBe('COMPTAGE_FERMETURE_REQUIS');
    expect(e.corps.message).toBe(
      'Comptez les billets du tiroir avant de fermer la caisse.',
    );
    expect(
      (
        await sql('SELECT "statut" FROM "SessionCaisse" WHERE "id" = $1', [
          session.id,
        ])
      ).rows[0].statut,
    ).toBe('OUVERTE');
  });

  it('15. fermeture sans comptage d ouverture : fond 0 et anomalie FOND_NON_COMPTE, écart sous le seuil sans commentaire', async () => {
    const session = await ouvrirSession(await nouveauPoste());
    await venteEncaissee(session.id, 30000);
    const { data } = await service.fermer(PHARMACIE, VENDEUR, session.id, {
      comptageFermeture: { coupures: coupures({ 20000: 1, 10000: 1 }) },
    });
    expect(data.ecartEspeces).toBe(0);
    expect(data.session.commentaireEcart).toBeNull();
    const anomalies = await sql(
      'SELECT "type","details" FROM "Anomalie" WHERE "pieceId" = $1',
      [session.id],
    );
    expect(anomalies.rows.map((a) => a.type)).toEqual(['FOND_NON_COMPTE']);
    expect(
      (anomalies.rows[0].details as Record<string, unknown>).posteCode,
    ).toBe(session.poste.code);
  });

  it('16. CA16 : moitié espèces moitié Orange Money, relevé mobile, MTN non rapproché', async () => {
    const session = await ouvrirSession(await nouveauPoste(), VENDEUR, {});
    const id = `vte-essai-${randomUUID()}`;
    await venteSql({ id, sessionId: session.id, total: 100000 });
    await paiementSql(`pai-a-${id}`, id, session.id, 'ESPECES', 50000);
    await paiementSql(`pai-b-${id}`, id, session.id, 'ORANGE_MONEY', 50000);
    const { data } = await service.fermer(PHARMACIE, VENDEUR, session.id, {
      comptageFermeture: {
        coupures: coupures({ 20000: 2, 10000: 1 }),
        releves: [{ mode: 'ORANGE_MONEY', montant: 45000 }],
      },
    });
    const ligne = (mode: string) => ({
      theorique: data.theorique.find((t) => t.mode === mode)?.montant,
      compte: data.compte.find((t) => t.mode === mode)?.montant,
      ecart: data.ecarts.find((t) => t.mode === mode)?.ecart,
    });
    expect(ligne('ESPECES').ecart).toBe(0);
    expect(ligne('ORANGE_MONEY')).toEqual({
      theorique: 50000,
      compte: 45000,
      ecart: -5000,
    });
    expect(ligne('MTN_MOMO').compte).toBeNull();
    expect(
      await compter(
        'SELECT count(*) AS n FROM "Anomalie" WHERE "pieceId" = $1 AND "type" = \'ECART_CAISSE\'',
        [session.id],
      ),
    ).toBe(0);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "Anomalie" WHERE "pieceId" = $1 AND "type" = \'FOND_NON_COMPTE\'',
        [session.id],
      ),
    ).toBe(0);
  });

  it('17. théorique signé : annulation, apport et remboursement mobile', async () => {
    const session = await ouvrirSession(await nouveauPoste());
    const origine = await venteEncaissee(session.id, 30000);
    const annulation = `vte-essai-${randomUUID()}`;
    await venteSql({
      id: annulation,
      sessionId: session.id,
      total: -30000,
      typePiece: 'ANNULATION',
      origine,
      motif: 'Erreur',
    });
    await paiementSql(
      `pai-${annulation}`,
      annulation,
      session.id,
      'ESPECES',
      -30000,
    );
    await service.enregistrerMouvement(PHARMACIE, VENDEUR, session.id, {
      type: 'APPORT',
      montant: 20000,
      motif: 'Monnaie ajoutée',
    });
    await service.enregistrerMouvement(PHARMACIE, VENDEUR, session.id, {
      type: 'REMBOURSEMENT',
      montant: 5000,
      motif: 'Client remboursé',
      mode: 'MTN_MOMO',
    });
    const { data } = await service.bilan(PHARMACIE, VENDEUR, session.id);
    expect(data.activite.nombreVentes).toBe(1);
    expect(data.activite.nombreAnnulations).toBe(1);
    expect(data.activite.montantEncaisse).toBe(0);
    expect(data.theorique.find((t) => t.mode === 'ESPECES')?.montant).toBe(
      20000,
    );
    expect(data.theorique.find((t) => t.mode === 'MTN_MOMO')?.montant).toBe(
      -5000,
    );
  });

  it('18. session fermée : comptage et mouvement refusés, fermeture rejouée, nouvelle ouverture possible', async () => {
    const c = await refus(
      service.saisirComptage(PHARMACIE, VENDEUR, sessionCa15, {
        moment: 'OUVERTURE',
        coupures: [],
      }),
    );
    expect(c.statut).toBe(409);
    expect(c.corps.code).toBe('SESSION_FERMEE');
    const m = await refus(
      service.enregistrerMouvement(PHARMACIE, VENDEUR, sessionCa15, {
        type: 'APPORT',
        montant: 1000,
        motif: 'Apport tardif',
      }),
    );
    expect(m.corps.code).toBe('SESSION_FERMEE');
    const rejeu = await service.fermer(PHARMACIE, VENDEUR, sessionCa15, {});
    expect(rejeu.message).toBe('Cette session était déjà fermée.');
    expect(rejeu.data.fige).toBe(true);
    expect(rejeu.data.ecarts[0].ecart).toBe(-10000);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ResultatSessionMode" WHERE "sessionCaisseId" = $1',
        [sessionCa15],
      ),
    ).toBe(3);
    const nouvelle = await service.ouvrir(PHARMACIE, VENDEUR, {
      posteId: posteCa15,
    });
    expect(nouvelle.data.ouverteMaintenant).toBe(true);
    expect(nouvelle.data.id).not.toBe(sessionCa15);
    const e = await refus(
      service.ouvrir(PHARMACIE, VENDEUR, {
        posteId: posteCa15,
        id: sessionCa15,
      }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('SESSION_FERMEE');
  });

  it('19. droits : un vendeur ne voit pas la caisse d un collègue, le responsable la voit et la ferme', async () => {
    const posteResp = await nouveauPoste(RESPONSABLE);
    const sessionResp = await ouvrirSession(posteResp, RESPONSABLE);
    const interdit = await refus(
      service.bilan(PHARMACIE, VENDEUR, sessionResp.id),
    );
    expect(interdit.statut).toBe(403);

    const posteVend = await nouveauPoste();
    const sessionVend = await ouvrirSession(posteVend);
    const vu = await service.bilan(PHARMACIE, RESPONSABLE, sessionVend.id);
    expect(vu.data.session.id).toBe(sessionVend.id);
    const fermee = await service.fermer(
      PHARMACIE,
      RESPONSABLE,
      sessionVend.id,
      {
        comptageFermeture: { coupures: [] },
      },
    );
    expect(fermee.data.fige).toBe(true);
    const res = await sql(
      'SELECT "commentaireParId" FROM "SessionCaisse" WHERE "id" = $1',
      [sessionVend.id],
    );
    expect(res.rows[0].commentaireParId).toBeNull();

    const autrePharmacie = await refus(
      service.bilan(PHARMACIE, 'usr-pharm-p2', sessionVend.id),
    );
    expect(autrePharmacie.statut).toBe(403);

    const technique = await sql(
      'SELECT "id" FROM "SessionCaisse" s WHERE s."technique" AND s."pointDeVenteId" IN (SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1)',
      [PHARMACIE],
    );
    const e = await refus(
      service.bilan(PHARMACIE, RESPONSABLE, technique.rows[0].id as string),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe('Cette session de caisse est introuvable.');
  });

  it('20. liste du jour et postes : sessions non techniques, session ouverte par poste', async () => {
    const { data } = await service.listerDuJour(PHARMACIE, RESPONSABLE, {});
    const attendues = await sql(
      'SELECT s."id" FROM "SessionCaisse" s JOIN "PointDeVente" pv ON pv."id" = s."pointDeVenteId" WHERE pv."structureId" = $1 AND NOT s."technique" AND s."jourMetier" = $2::date ORDER BY s."ouverteLe", s."id"',
      [PHARMACIE, jour],
    );
    expect(data.map((s) => s.id)).toEqual(attendues.rows.map((r) => r.id));
    expect(data.length).toBeGreaterThan(5);
    const invalide = await refus(
      service.listerDuJour(PHARMACIE, RESPONSABLE, { jour: '2026-02-31' }),
    );
    expect(invalide.statut).toBe(400);
    expect(invalide.corps.code).toBe('VALIDATION');
    expect(
      (invalide.corps.champs as { contraintes: string[] }[])[0].contraintes,
    ).toEqual(['dateValide']);

    const libre = await nouveauPoste();
    const liste = await postes.listerPostes(PHARMACIE, RESPONSABLE);
    const occupe = liste.data.find((p) => p.id === posteUn);
    expect(occupe?.sessionOuverte).toMatchObject({
      id: sessionUn,
      utilisateurNom: 'Mamadou Diallo',
      jourMetier: jour,
    });
    expect(liste.data.find((p) => p.id === libre)?.sessionOuverte).toBeNull();
  });

  it('21. aucune clé de coût dans les réponses de caisse', async () => {
    const poste = await nouveauPoste();
    const ouverture = await service.ouvrir(PHARMACIE, VENDEUR, {
      posteId: poste,
    });
    const comptage = await service.saisirComptage(
      PHARMACIE,
      VENDEUR,
      ouverture.data.id,
      { moment: 'OUVERTURE', coupures: coupures({ 5000: 2 }) },
    );
    const mouvement = await service.enregistrerMouvement(
      PHARMACIE,
      VENDEUR,
      ouverture.data.id,
      { type: 'APPORT', montant: 1000, motif: 'Monnaie' },
    );
    const bilanFige = await service.bilan(PHARMACIE, VENDEUR, sessionCa15);
    const liste = await service.listerDuJour(PHARMACIE, RESPONSABLE, {});
    for (const reponse of [ouverture, comptage, mouvement, bilanFige, liste]) {
      expect(cheminsCout(reponse)).toEqual([]);
    }
  });
});
