import { randomUUID } from 'node:crypto';
import type { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import type { SynchroService } from 'src/pharmacie/synchro/synchro.service';

/**
 * Aide commune des specs en base : une vente sans stock ne peut plus passer par la route
 * en ligne (D713, 409 STOCK_INSUFFISANT). Le seul chemin qui l'accepte est le rejeu des
 * ventes hors ligne d'un poste desktop (D713.2) : allocation provisoire, anomalie
 * STOCK_NEGATIF, agrégat négatif. Une spec qui a besoin de ce résultat passe par ici ;
 * une spec qui vend sans viser le provisoire reçoit du stock.
 */

/** Poste desktop de la spec, avec son compteur de séquences et de numéros de secours. */
export interface PosteRejeu {
  id: string;
  /** Dernière séquence envoyée au serveur (0 : aucun événement). */
  sequence: number;
  /** Dernier numéro de secours utilisé. */
  secours: number;
}

export function posteRejeu(id: string, sequence = 0): PosteRejeu {
  return { id, sequence, secours: 0 };
}

interface EntreeEnvoi {
  structureId: string;
  vendeurId: string;
  poste: PosteRejeu;
}

async function envoyerUnEvenement(
  synchro: SynchroService,
  e: EntreeEnvoi,
  type: string,
  corps: Record<string, unknown>,
  horodatageLocal = new Date().toISOString(),
) {
  e.poste.sequence += 1;
  const evenementId = randomUUID();
  const reponse = await synchro.recevoir(
    e.structureId,
    e.vendeurId,
    {
      posteId: e.poste.id,
      etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' },
      evenements: [
        {
          evenementId,
          sequence: e.poste.sequence,
          type,
          horodatageLocal,
          utilisateurId: e.vendeurId,
          corps,
        },
      ],
    },
    '127.0.0.1',
  );
  const resultat = reponse.data.resultats[0];
  expect(resultat.statut).toBe('APPLIQUE');
  return resultat;
}

/** Ouvre une caisse sur le poste par le rejeu (événement SESSION_OUVERTE), renvoie son identifiant. */
export async function ouvrirSessionRejeu(
  synchro: SynchroService,
  entree: EntreeEnvoi,
): Promise<string> {
  const sessionId = randomUUID();
  await envoyerUnEvenement(synchro, entree, 'SESSION_OUVERTE', { sessionId });
  return sessionId;
}

export interface VenteRejeuDemandee extends EntreeEnvoi {
  sessionId: string;
  stockId: string;
  nombre: number;
  unite: 'BOITE' | 'UNITE';
  prixUnitaire: number;
  ordonnanceVerifiee?: boolean;
  clientNom?: string;
  clientTelephone?: string;
  /** Lignes suivantes du même ticket (même fiche par défaut), par exemple des unités avec une boîte. */
  autresLignes?: {
    stockId?: string;
    nombre: number;
    unite: 'BOITE' | 'UNITE';
    prixUnitaire: number;
  }[];
}

/**
 * Vend par le rejeu à la séquence suivante du poste, sous un numéro de secours, et
 * vérifie que l'événement est appliqué. Une vente sans stock devient provisoire.
 */
export async function venteProvisoireParRejeu(
  synchro: SynchroService,
  v: VenteRejeuDemandee,
): Promise<{ data: { id: string }; venteId: string }> {
  const venteId = randomUUID();
  v.poste.secours += 1;
  const lignes = [
    {
      stockId: v.stockId,
      unite: v.unite,
      nombre: v.nombre,
      prixUnitaire: v.prixUnitaire,
    },
    ...(v.autresLignes ?? []).map((l) => ({
      stockId: l.stockId ?? v.stockId,
      unite: l.unite,
      nombre: l.nombre,
      prixUnitaire: l.prixUnitaire,
    })),
  ];
  const total = lignes.reduce((s, l) => s + l.nombre * l.prixUnitaire, 0);
  await envoyerUnEvenement(synchro, v, 'VENTE', {
    venteId,
    sessionId: v.sessionId,
    numeroSecours: v.poste.secours,
    lignes,
    paiements: [{ mode: 'ESPECES', montant: total }],
    total,
    ordonnanceVerifiee: v.ordonnanceVerifiee ?? true,
    ...(v.clientNom ? { clientNom: v.clientNom } : {}),
    ...(v.clientTelephone ? { clientTelephone: v.clientTelephone } : {}),
  });
  return { data: { id: venteId }, venteId };
}

/**
 * Poste desktop et caisse du rejeu d'une spec, créés à la première vente puis
 * réutilisés. Les services sont ceux que la spec instancie déjà.
 */
export function rejeuParDefaut(deps: {
  synchro: SynchroService;
  postes: Pick<PointsDeVenteService, 'enregistrerPoste'>;
  structureId: string;
  vendeurId: string;
  /** Titulaire qui enregistre le poste. */
  responsableId: string;
  appareilId: string;
}) {
  let etat: { poste: PosteRejeu; sessionId: string } | undefined;
  return async (o: {
    stockId: string;
    nombre: number;
    unite?: 'BOITE' | 'UNITE';
    prixUnitaire?: number;
    ordonnanceVerifiee?: boolean;
    clientNom?: string;
    clientTelephone?: string;
    autresLignes?: VenteRejeuDemandee['autresLignes'];
  }) => {
    if (!etat) {
      const enregistre = await deps.postes.enregistrerPoste(
        deps.structureId,
        deps.responsableId,
        { type: 'DESKTOP', appareilId: deps.appareilId },
      );
      const poste = posteRejeu(enregistre.data.id);
      const sessionId = await ouvrirSessionRejeu(deps.synchro, {
        structureId: deps.structureId,
        vendeurId: deps.vendeurId,
        poste,
      });
      etat = { poste, sessionId };
    }
    return venteProvisoireParRejeu(deps.synchro, {
      structureId: deps.structureId,
      vendeurId: deps.vendeurId,
      poste: etat.poste,
      sessionId: etat.sessionId,
      stockId: o.stockId,
      nombre: o.nombre,
      unite: o.unite ?? 'BOITE',
      prixUnitaire: o.prixUnitaire ?? 1000,
      ...(o.ordonnanceVerifiee === undefined
        ? {}
        : { ordonnanceVerifiee: o.ordonnanceVerifiee }),
      ...(o.clientNom ? { clientNom: o.clientNom } : {}),
      ...(o.clientTelephone ? { clientTelephone: o.clientTelephone } : {}),
      ...(o.autresLignes ? { autresLignes: o.autresLignes } : {}),
    });
  };
}
