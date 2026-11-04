import type { Prisma } from 'generated/prisma/client';
import { dateVersJour, jourVersDate } from './stock/lecture-stock';
import type { MouvementsStockService } from './stock/mouvements-stock.service';
import type { LigneAllouee, PaiementPrevu } from './vente-regles';

/** Écriture d'une pièce de vente, partagée par la vente web et le rejeu d'un poste (D657). */

export interface LignePieceAEcrire {
  fiche: { id: string; medicamentId: string; nom: string };
  calcul: {
    prixAppliqueParUm: number;
    quantiteUm: number;
    montantLigne: number;
    uniteAffichee: 'BOITE' | 'UNITE';
    nombreAffiche: number;
    coefficientApplique: number;
  };
  allocation: LigneAllouee;
  /** Rejeu : clés ajoutées aux details de STOCK_NEGATIF. */
  detailsAnomalie?: Record<string, string | number | boolean | null>;
  /** Rejeu : STOCK_NEGATIF même sans reste provisoire (ligne provisoire sur le poste, D652). */
  anomalieMemeSansProvisoire?: boolean;
}

export interface PieceVenteAEcrire {
  id?: string;
  structureId: string;
  adminId: string | null;
  pointDeVenteId: string;
  posteId: string;
  posteCode: string;
  sessionId: string;
  typePiece: 'VENTE' | 'REGULARISATION';
  /** Rejeu d'un poste : un reste provisoire est permis (D713.2) ; vente web : jamais (D716). */
  provisoireAutorise: boolean;
  numero: string;
  numeroTicket: number | null;
  jourMetier: Date;
  jourMetierOrigine?: Date | null;
  vendeur: { id: string; nom: string };
  clientNom: string | null;
  clientTelephone: string | null;
  ordonnanceVerifiee: boolean;
  total: number;
  cleIdempotence: string | null;
  horodatageLocal?: Date | null;
  sequencePoste?: number | null;
  lignes: LignePieceAEcrire[];
  paiements: PaiementPrevu[];
  /** Rejeu : evenementId stable de chaque mouvement (D656) ; sinon UUID serveur. */
  evenementIdMouvement?: (indexLigne: number, lotId: string | null) => string;
}

export async function ecrirePieceVente(
  tx: Prisma.TransactionClient,
  mouvementsStock: MouvementsStockService,
  p: PieceVenteAEcrire,
): Promise<{
  venteId: string;
  apresParFiche: Map<string, number>;
  anomalies: { type: 'STOCK_NEGATIF'; id: string }[];
}> {
  // Filet (D716) : le contrôle de VenteService refuse avant d'arriver ici
  if (
    !p.provisoireAutorise &&
    p.lignes.some((c) => c.allocation.resteProvisoire > 0)
  ) {
    throw new RangeError(
      'Une vente en ligne ne peut pas porter de reste provisoire.',
    );
  }

  // 13. Pièce, lignes et allocations
  const vente = await tx.vente.create({
    data: {
      ...(p.id ? { id: p.id } : {}),
      structureId: p.structureId,
      pointDeVenteId: p.pointDeVenteId,
      posteId: p.posteId,
      sessionCaisseId: p.sessionId,
      typePiece: p.typePiece,
      numero: p.numero,
      numeroTicket: p.numeroTicket,
      jourMetier: p.jourMetier,
      jourMetierOrigine: p.jourMetierOrigine ?? null,
      horodatageLocal: p.horodatageLocal ?? null,
      sequencePoste: p.sequencePoste ?? null,
      vendeurId: p.vendeur.id,
      vendeurNom: p.vendeur.nom,
      clientNom: p.clientNom,
      clientTelephone: p.clientTelephone,
      ordonnanceVerifiee: p.ordonnanceVerifiee,
      total: p.total,
      cleIdempotence: p.cleIdempotence,
      lignes: {
        create: p.lignes.map((c) => {
          const a = c.allocation;
          return {
            medicamentId: c.fiche.medicamentId,
            stockMedicamentId: c.fiche.id,
            nomMedicament: c.fiche.nom,
            prixUnitaire: c.calcul.prixAppliqueParUm,
            quantite: c.calcul.quantiteUm,
            sousTotal: c.calcul.montantLigne,
            uniteAffichee: c.calcul.uniteAffichee,
            nombreAffiche: c.calcul.nombreAffiche,
            coefficientApplique: c.calcul.coefficientApplique,
            allocations: {
              create: [
                ...a.allocations.map((al) => ({
                  lotId: al.lotId,
                  numeroLot: al.numeroLot,
                  dateExpiration: al.dateExpiration
                    ? jourVersDate(al.dateExpiration)
                    : null,
                  quantite: al.quantite,
                  coutUnitaire: al.coutUnitaire,
                  lotTechnique: al.lotTechnique,
                  statut: 'DEFINITIVE' as const,
                  sortieManuelle: al.sortieManuelle,
                  motif: al.motif,
                  auteurId: p.vendeur.id,
                })),
                ...(a.resteProvisoire > 0
                  ? [
                      {
                        lotId: null,
                        numeroLot: null,
                        dateExpiration: null,
                        quantite: a.resteProvisoire,
                        coutUnitaire: 0,
                        lotTechnique: false,
                        statut: 'PROVISOIRE' as const,
                        sortieManuelle: false,
                        motif: null,
                        auteurId: p.vendeur.id,
                      },
                    ]
                  : []),
              ],
            },
          };
        }),
      },
    },
    select: { id: true },
  });

  // 14. Paiements
  await tx.paiement.createMany({
    data: p.paiements.map((pa) => ({
      venteId: vente.id,
      sessionCaisseId: p.sessionId,
      modePaiementId: pa.modePaiementId,
      montant: pa.montant,
      referenceExterne: pa.referenceExterne,
      montantRecu: pa.montantRecu,
    })),
  });

  // 15. Mouvements de stock
  const apresParFiche = new Map<string, number>();
  for (const [index, c] of p.lignes.entries()) {
    const a = c.allocation;
    for (const al of a.allocations) {
      const ecrit = await mouvementsStock.ecrire(tx, {
        ...(p.evenementIdMouvement
          ? { evenementId: p.evenementIdMouvement(index, al.lotId) }
          : {}),
        pointDeVenteId: p.pointDeVenteId,
        stockMedicamentId: c.fiche.id,
        lotId: al.lotId,
        type: 'VENTE',
        quantite: -al.quantite,
        pieceOrigineType: 'VENTE',
        pieceOrigineId: vente.id,
        motif: al.sortieManuelle ? al.motif : null,
        auteurId: p.vendeur.id,
        horodatageLocal: p.horodatageLocal ?? null,
        posteId: p.posteId,
        sequencePoste: p.sequencePoste ?? null,
      });
      apresParFiche.set(c.fiche.id, ecrit.soldeProduit);
    }
    if (a.resteProvisoire > 0) {
      const ecrit = await mouvementsStock.ecrire(tx, {
        ...(p.evenementIdMouvement
          ? { evenementId: p.evenementIdMouvement(index, null) }
          : {}),
        pointDeVenteId: p.pointDeVenteId,
        stockMedicamentId: c.fiche.id,
        lotId: null,
        type: 'VENTE',
        quantite: -a.resteProvisoire,
        pieceOrigineType: 'VENTE',
        pieceOrigineId: vente.id,
        motif: null,
        auteurId: p.vendeur.id,
        horodatageLocal: p.horodatageLocal ?? null,
        posteId: p.posteId,
        sequencePoste: p.sequencePoste ?? null,
      });
      apresParFiche.set(c.fiche.id, ecrit.soldeProduit);
    }
  }

  // 16. Anomalies de stock négatif (jamais de donnée du client)
  const anomalies: { type: 'STOCK_NEGATIF'; id: string }[] = [];
  for (const c of p.lignes) {
    const a = c.allocation;
    if (a.resteProvisoire <= 0 && !c.anomalieMemeSansProvisoire) continue;
    const soldeProduit = apresParFiche.get(c.fiche.id) ?? 0;
    const quantiteLocale = Number(c.detailsAnomalie?.quantiteProvisoireLocale);
    const message =
      a.resteProvisoire > 0
        ? `${c.fiche.nom} : ${a.resteProvisoire} unité(s) vendue(s) sans stock disponible (vente ${p.numero}, poste ${p.posteCode}, ${p.vendeur.nom}). Le stock de ce médicament affiche ${Math.max(0, soldeProduit)} unité(s) et cette vente reste à régulariser : enregistrez la réception ou l'inventaire qui rattachera ces unités à un lot.`
        : `${c.fiche.nom} : le poste ${p.posteCode} a vendu ${Number.isFinite(quantiteLocale) ? quantiteLocale : 0} unité(s) sans stock (vente ${p.numero}, ${p.vendeur.nom}) ; le serveur a trouvé du stock pour cette vente. Vérifiez le stock de ce médicament sur le poste.`;
    const creee = await tx.anomalie.create({
      data: {
        pointDeVenteId: p.pointDeVenteId,
        type: 'STOCK_NEGATIF',
        attribueeAId: p.adminId,
        pieceType: 'VENTE',
        pieceId: vente.id,
        details: {
          stockId: c.fiche.id,
          nom: c.fiche.nom,
          quantiteProvisoire: a.resteProvisoire,
          soldeProduit,
          posteCode: p.posteCode,
          utilisateurId: p.vendeur.id,
          utilisateurNom: p.vendeur.nom,
          jourMetier: dateVersJour(p.jourMetier),
          ...c.detailsAnomalie,
          message,
        },
      },
      select: { id: true },
    });
    anomalies.push({ type: 'STOCK_NEGATIF', id: creee.id });
  }

  return { venteId: vente.id, apresParFiche, anomalies };
}
