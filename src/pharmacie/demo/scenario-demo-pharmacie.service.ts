import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { ClotureService } from '../caisse/clotures.service';
import { InventairesService } from '../inventaires/inventaires.service';
import { AnomaliesService } from '../anomalies/anomalies.service';
import { jourConakry, joursAvant } from '../jour-metier';
import { PointsDeVenteService } from '../points-de-vente.service';
import { ReceptionsService } from '../receptions/receptions.service';
import { jourVersDate } from '../stock/lecture-stock';
import { MouvementsStockService } from '../stock/mouvements-stock.service';
import { SynchroService } from '../synchro/synchro.service';
import { VenteService } from '../vente.service';
import {
  ANNULATION_SCENARIO_MOTIF,
  CLOTURE_FORCEE_MOTIF,
  EVENEMENTS_POSTE_LOT_A,
  EVENEMENTS_POSTE_LOT_B,
  FOURNISSEURS_SCENARIO,
  INVENTAIRE_SCENARIO,
  POSTE_SCENARIO,
  RECEPTIONS_SCENARIO,
  STOCK_REPRIS_SCENARIO,
  TRAITEMENT_ANOMALIE_COMMENTAIRE,
  VENTES_WEB_SCENARIO,
  type CleSessionScenario,
  type CoupureScenario,
  type EvenementPosteScenario,
  type PharmacieScenario,
} from './scenario-demo-pharmacie.donnees';

/** Pharmacie du jeu démo : sa structure, son titulaire (administrateur) et son vendeur. */
export interface PharmacieDemo {
  structureId: string;
  titulaireId: string;
  vendeurId: string;
}

export interface ContexteScenarioPharmacie {
  kaloum: PharmacieDemo;
  niger: PharmacieDemo;
}

export interface BilanScenarioPharmacie {
  receptions: number;
  lotsRepris: number;
  inventaires: number;
  evenementsAppliques: number;
  clotures: number;
  ventesWeb: number;
  annulations: number;
  anomaliesTraitees: number;
}

/**
 * Recule le début de la caisse et celui de la fiabilité de la marge d'une pharmacie
 * démo, pour que les journées passées du scénario soient clôturables. Vit ici et non
 * dans le seeder : le balayage d'étanchéité interdit à tout fichier hors de
 * `src/pharmacie/` de nommer `debutFiabiliteMarge` (D671).
 */
export async function reculerDebutsCaisseDemo(
  tx: Prisma.TransactionClient,
  structureId: string,
  debut: Date,
): Promise<void> {
  await tx.parametresPharmacie.update({
    where: { structureId },
    data: { debutCaisse: debut, debutFiabiliteMarge: debut },
  });
}

/**
 * Scénario de pharmacie du jeu démo (phase 2, D670) : joué par les méthodes publiques
 * des services de la tranche, une transaction par opération, jamais d'écriture directe
 * d'une pièce, d'une caisse ou d'un mouvement (sauf le lot repris, par le service du
 * journal de stock). Les identifiants clients sont tirés à chaque exécution.
 */
@Injectable()
export class ScenarioDemoPharmacieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receptions: ReceptionsService,
    private readonly inventaires: InventairesService,
    private readonly pointsDeVente: PointsDeVenteService,
    private readonly synchro: SynchroService,
    private readonly cloture: ClotureService,
    private readonly ventes: VenteService,
    private readonly anomalies: AnomaliesService,
    private readonly mouvementsStock: MouvementsStockService,
  ) {}

  async jouer(
    contexte: ContexteScenarioPharmacie,
  ): Promise<BilanScenarioPharmacie> {
    const { kaloum, niger } = contexte;
    const pharmacies: Record<PharmacieScenario, PharmacieDemo> = {
      kaloum,
      niger,
    };
    // J = aujourd'hui à Conakry ; jour(n) = J décalé de n jours.
    const aujourdhui = jourConakry(new Date());
    const jour = (n: number) => joursAvant(aujourdhui, -n);
    const heure = (n: number, hhmm: string) => `${jour(n)}T${hhmm}:00.000Z`;

    const fiche = async (structureId: string, nom: string) => {
      const trouvee = await this.prisma.stockMedicament.findFirst({
        where: { structureId, medicament: { nom } },
        select: { id: true },
      });
      if (!trouvee) {
        throw new Error(
          `Scénario pharmacie de démonstration : fiche introuvable (${nom}).`,
        );
      }
      return trouvee.id;
    };

    // 1. Fournisseurs
    const fournisseurs = new Map<string, string>();
    for (const f of FOURNISSEURS_SCENARIO) {
      const p = pharmacies[f.pharmacie];
      const cree = await this.receptions.creerFournisseur(
        p.structureId,
        p.titulaireId,
        { nom: f.nom, telephone: f.telephone },
        null,
      );
      fournisseurs.set(f.nom, cree.data.id);
    }

    // 2. Réceptions : lots, péremptions et coûts réels
    for (const r of RECEPTIONS_SCENARIO) {
      const p = pharmacies[r.pharmacie];
      const lignes = await Promise.all(
        r.lignes.map(async (l) => ({
          stockId: await fiche(p.structureId, l.medicament),
          numeroLot: l.numeroLot,
          dateExpiration: jour(l.expirationJours),
          nombreBoites: l.nombreBoites,
          ...(l.coutAchatBoite !== undefined
            ? { coutAchatBoite: l.coutAchatBoite }
            : {}),
        })),
      );
      await this.receptions.enregistrer(
        p.structureId,
        p.titulaireId,
        {
          id: randomUUID(),
          fournisseurId: fournisseurs.get(r.fournisseur),
          reference: r.reference,
          recueLe: heure(r.jour, r.heure),
          lignes,
        },
        null,
      );
    }

    // 3. Stock repris à qualifier : lot technique comme une reprise (D418), jamais de pièce MIGRATION
    const repris = pharmacies[STOCK_REPRIS_SCENARIO.pharmacie];
    const pointDeVenteRepris = await this.prisma.pointDeVente.findFirst({
      where: { structureId: repris.structureId, ordre: 1 },
      select: { id: true },
    });
    if (!pointDeVenteRepris) {
      throw new Error(
        'Scénario pharmacie de démonstration : point de vente introuvable.',
      );
    }
    const stockRepris = await fiche(
      repris.structureId,
      STOCK_REPRIS_SCENARIO.medicament,
    );
    await this.prisma.$transaction((tx) =>
      this.mouvementsStock.creerLot(tx, {
        stockMedicamentId: stockRepris,
        pointDeVenteId: pointDeVenteRepris.id,
        numeroLot: null,
        dateExpiration: jourVersDate(
          jour(STOCK_REPRIS_SCENARIO.expirationJours),
        ),
        quantite: STOCK_REPRIS_SCENARIO.quantite,
        coutUnitaire: 0,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: true,
        auteurId: null,
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: null,
        motif: STOCK_REPRIS_SCENARIO.motif,
      }),
    );

    // 4. Poste desktop de Kaloum et plage de tickets
    const poste = await this.pointsDeVente.enregistrerPoste(
      kaloum.structureId,
      kaloum.titulaireId,
      {
        type: 'DESKTOP',
        appareilId: POSTE_SCENARIO.appareilId,
        libelle: POSTE_SCENARIO.libelle,
      },
    );
    const posteId = poste.data.id;
    const plage = await this.pointsDeVente.attribuerPlage(
      kaloum.structureId,
      kaloum.titulaireId,
      posteId,
      { id: randomUUID() },
    );
    const debutPlage = plage.data.debut;

    // 5. Lot A du poste : caisse S2 de J-2 puis caisse S1 de J-1
    const sessions: Record<CleSessionScenario, string> = {
      S1: randomUUID(),
      S2: randomUUID(),
    };
    const coupures = (c: CoupureScenario[]) =>
      c.map((x) => ({ valeurFaciale: x.valeurFaciale, nombre: x.nombre }));
    const stockKaloum = (nom: string) => fiche(kaloum.structureId, nom);
    const versEvenement = async (e: EvenementPosteScenario) => {
      let corps: Record<string, unknown>;
      switch (e.type) {
        case 'SESSION_OUVERTE':
          corps = { sessionId: sessions[e.session] };
          break;
        case 'COMPTAGE_SAISI':
          corps = {
            comptageId: randomUUID(),
            sessionId: sessions[e.session],
            moment: 'OUVERTURE',
            coupures: coupures(e.coupures),
          };
          break;
        case 'MOUVEMENT_CAISSE':
          corps = {
            mouvementId: randomUUID(),
            sessionId: sessions[e.session],
            type: e.mouvement,
            montant: e.montant,
            motif: e.motif,
          };
          break;
        case 'SESSION_FERMEE':
          corps = {
            sessionId: sessions[e.session],
            comptageFermeture: {
              comptageId: randomUUID(),
              coupures: coupures(e.coupures),
              releves: e.releves.map((r) => ({
                mode: r.mode,
                montant: r.montant,
              })),
            },
          };
          break;
        case 'VENTE': {
          const lignes = await Promise.all(
            e.lignes.map(async (l) => ({
              stockId: await stockKaloum(l.medicament),
              unite: l.unite,
              nombre: l.nombre,
              prixUnitaire: l.prixUnitaire,
              ...(l.ouvertureConditionnement
                ? { ouvertureConditionnement: true }
                : {}),
            })),
          );
          corps = {
            venteId: randomUUID(),
            sessionId: sessions[e.session],
            numeroTicket: debutPlage + e.ticket - 1,
            lignes,
            paiements: e.paiements.map((p) => ({ ...p })),
            total: e.total,
            ordonnanceVerifiee: e.ordonnanceVerifiee,
          };
          break;
        }
      }
      return {
        evenementId: randomUUID(),
        sequence: e.sequence,
        type: e.type,
        horodatageLocal: heure(e.jour, e.heure),
        utilisateurId: kaloum.vendeurId,
        corps,
      };
    };

    let evenementsAppliques = 0;
    const envoyer = async (
      evenements: EvenementPosteScenario[],
      sessionOuverte: boolean,
    ) => {
      const corpsEnvoyes = await Promise.all(evenements.map(versEvenement));
      const reponse = await this.synchro.recevoir(
        kaloum.structureId,
        kaloum.vendeurId,
        {
          posteId,
          etat: { fileVide: true, sessionOuverte, versionApp: '0.1.0' },
          evenements: corpsEnvoyes,
        },
      );
      for (const r of reponse.data.resultats) {
        if (r.statut !== 'APPLIQUE') {
          const type = evenements.find((x) => x.sequence === r.sequence)?.type;
          throw new Error(
            `Scénario pharmacie de démonstration : opération ${r.sequence} ${type ?? 'inconnue'} non appliquée (${r.code ?? r.statut}).`,
          );
        }
        evenementsAppliques++;
      }
    };
    await envoyer(EVENEMENTS_POSTE_LOT_A, true);

    // 6. Clôtures : J-2 normale, J-1 forcée (la caisse du poste est restée ouverte)
    await this.cloture.cloturer(
      kaloum.structureId,
      kaloum.titulaireId,
      { jour: jour(-2) },
      null,
    );
    await this.cloture.cloturer(
      kaloum.structureId,
      kaloum.titulaireId,
      { jour: jour(-1), forcer: true, motifForcage: CLOTURE_FORCEE_MOTIF },
      null,
    );

    // 7. Lot B du poste : retour du réseau, vente régularisée puis fermeture de S1
    await envoyer(EVENEMENTS_POSTE_LOT_B, false);

    // 8. Inventaire de Kaloum : un écart et un lot périmé trouvé au rayon
    const lignesInventaire = await Promise.all(
      INVENTAIRE_SCENARIO.lignes.map(async (l) => ({
        stockId: await stockKaloum(l.medicament),
        numeroLot: l.numeroLot,
        ...(l.expirationJours !== undefined
          ? { dateExpiration: jour(l.expirationJours) }
          : {}),
        nombreBoites: l.nombreBoites,
        ...(l.unitesEnPlus !== undefined
          ? { unitesEnPlus: l.unitesEnPlus }
          : {}),
      })),
    );
    await this.inventaires.enregistrer(
      kaloum.structureId,
      kaloum.titulaireId,
      {
        id: randomUUID(),
        commentaire: INVENTAIRE_SCENARIO.commentaire,
        lignes: lignesInventaire,
      },
      null,
    );

    // 9. Ventes web du jour (poste web par défaut, caisse ouverte automatiquement)
    const idsVentes = new Map<string, string>();
    for (const w of VENTES_WEB_SCENARIO) {
      const lignes = await Promise.all(
        w.lignes.map(async (l) => ({
          stockId: await stockKaloum(l.medicament),
          quantite: l.nombre,
          unite: l.unite,
        })),
      );
      const vente = await this.ventes.creerVente(
        kaloum.structureId,
        kaloum.vendeurId,
        {
          lignes,
          ...(w.paiements
            ? {
                paiements: w.paiements.map((p) => ({
                  mode: p.mode,
                  montant: p.montant,
                  ...(p.reference ? { reference: p.reference } : {}),
                })),
              }
            : {}),
          ...(w.ordonnanceVerifiee ? { ordonnanceVerifiee: true } : {}),
        },
        undefined,
        null,
      );
      idsVentes.set(w.cle, vente.data.id);
    }

    // 10. Annulation de la troisième vente par le titulaire
    await this.ventes.annulerVente(
      kaloum.structureId,
      idsVentes.get('W3') as string,
      kaloum.titulaireId,
      { motif: ANNULATION_SCENARIO_MOTIF },
      null,
    );

    // 11. Traitement de l'anomalie de caisse fermée après la clôture
    const ouvertes = await this.anomalies.lister(
      kaloum.structureId,
      kaloum.titulaireId,
      { type: 'REMONTEE_APRES_CLOTURE' },
    );
    const aTraiter = ouvertes.data.anomalies.find((a) => {
      const details = a.details as { raison?: unknown } | null;
      return details?.raison === 'CAISSE_FERMEE_APRES_CLOTURE';
    });
    if (!aTraiter) {
      throw new Error(
        'Scénario pharmacie de démonstration : anomalie de caisse fermée après la clôture introuvable.',
      );
    }
    await this.anomalies.traiter(
      kaloum.structureId,
      kaloum.titulaireId,
      aTraiter.id,
      { commentaire: TRAITEMENT_ANOMALIE_COMMENTAIRE },
      null,
    );

    return {
      receptions: RECEPTIONS_SCENARIO.length,
      lotsRepris: 1,
      inventaires: 1,
      evenementsAppliques,
      clotures: 2,
      ventesWeb: idsVentes.size,
      annulations: 1,
      anomaliesTraitees: 1,
    };
  }
}
