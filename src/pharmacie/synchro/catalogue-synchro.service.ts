import { CODE_CREDIT } from '../credit/credit-regles';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { AccesPharmacieService } from '../acces-pharmacie.service';
import { MESSAGE_POSTE_INCONNU } from '../caisse/sessions-caisse.service';
import { assurerPointDeVente } from '../point-de-vente';
import {
  versParametresReponse,
  type ParametresReponse,
} from '../points-de-vente.service';
import {
  AnomaliesService,
  type ElementAnomalie,
} from '../anomalies/anomalies.service';
import { dateVersJour } from '../stock/lecture-stock';
import { lirePlagesNonEpuisees, type PlageLue } from './plages';

export const MESSAGE_CATALOGUE_POSTE_WEB =
  "La photographie du catalogue sert seulement à l'application MedConnecte Caisse pour Windows.";

export interface LotSynchro {
  id: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  dateReception: string;
  coefficientReception: number;
  solde: number;
  lotTechnique: boolean;
}

export interface FicheSynchro {
  stockId: string;
  medicamentId: string;
  nom: string;
  nomGenerique: string | null;
  categorie: string;
  formes: string[];
  ordonnanceRequise: boolean;
  prixUnitaire: number | null;
  prixUnite: number | null;
  coefficientBoite: number;
  uniteMinimale: string;
  deconditionnable: boolean;
  /** Faux : la fiche reste à qualifier (filtre et export du stock hors ligne). */
  qualifie: boolean;
  notes: string | null;
  /** Jamais négative (D719) : le poste affiche 0 et `quantiteARegulariser`. */
  quantite: number;
  quantiteARegulariser: number;
  lots: LotSynchro[];
}

/**
 * Photographie complète du catalogue d'un poste desktop (D633). L'ordre des clés fixe l'ETag.
 * Aucun champ qui dépend de l'heure (D662) : l'ETag ne change que si le catalogue change.
 */
export interface CatalogueSynchro {
  pharmacie: {
    id: string;
    nom: string;
    adresse: string | null;
    ville: string | null;
    telephone: string | null;
    logoUrl: string | null;
  };
  pointDeVente: { id: string; ordre: number };
  poste: {
    id: string;
    code: string;
    libelle: string;
    sequenceAppliquee: number;
    sequenceMaxRecue: number;
    plages: PlageLue[];
  };
  parametres: ParametresReponse;
  modesPaiement: {
    code: string;
    libelle: string;
    comptagePhysique: boolean;
    referenceAutorisee: boolean;
    ordre: number;
  }[];
  coupures: {
    devise: string;
    valeurFaciale: number;
    type: string;
    ordre: number;
  }[];
  fiches: FicheSynchro[];
  /** Anomalies OUVERTES de la pharmacie, détails lisibles, sans aucun coût (lecture hors ligne). */
  anomalies: ElementAnomalie[];
}

function comparerLots(a: LotSynchro, b: LotSynchro): number {
  if (a.dateExpiration !== b.dateExpiration) {
    if (a.dateExpiration === null) return -1;
    if (b.dateExpiration === null) return 1;
    return a.dateExpiration < b.dateExpiration ? -1 : 1;
  }
  if (a.dateReception !== b.dateReception) {
    return a.dateReception < b.dateReception ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

@Injectable()
export class CatalogueSynchroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly storage: StorageService,
    private readonly anomalies: AnomaliesService,
  ) {}

  async photographier(
    structureId: string,
    userId: string,
    posteId: string,
  ): Promise<CatalogueSynchro> {
    const { structure } = await this.accesPharmacie.verifier(
      structureId,
      userId,
    );

    const poste = await this.prisma.poste.findFirst({
      where: { id: posteId, pointDeVente: { structureId: structure.id } },
    });
    if (!poste || poste.type === 'TECHNIQUE' || !poste.actif) {
      throw new ConflictException({
        message: MESSAGE_POSTE_INCONNU,
        code: 'POSTE_INCONNU',
      });
    }
    if (poste.type === 'WEB') {
      throw new ConflictException({
        message: MESSAGE_CATALOGUE_POSTE_WEB,
        code: 'POSTE_INCONNU',
      });
    }

    // Hors de la lecture : crée la configuration manquante avant la photographie.
    const parametresExistants =
      await this.prisma.parametresPharmacie.findUnique({
        where: { structureId: structure.id },
      });
    if (!parametresExistants) {
      await this.prisma.$transaction((tx) =>
        assurerPointDeVente(tx, structure),
      );
    }

    const lue = await this.prisma.$transaction(
      async (tx) => {
        const posteLu = await tx.poste.findUniqueOrThrow({
          where: { id: poste.id },
        });
        const recue = await tx.evenementSynchro.aggregate({
          where: { posteId: poste.id },
          _max: { sequence: true },
        });
        const sequenceMaxRecue = Math.max(
          posteLu.derniereSequenceAppliquee,
          recue._max.sequence ?? 0,
        );
        const plages = await lirePlagesNonEpuisees(tx, poste.id);
        const pointDeVente = await tx.pointDeVente.findUniqueOrThrow({
          where: { id: poste.pointDeVenteId },
          select: { id: true, ordre: true },
        });
        const parametres = await tx.parametresPharmacie.findUniqueOrThrow({
          where: { structureId: structure.id },
        });
        const modesPaiement = await tx.modePaiement.findMany({
          where: { actif: true, code: { not: CODE_CREDIT } },
          orderBy: [{ ordre: 'asc' }, { code: 'asc' }],
          select: {
            code: true,
            libelle: true,
            comptagePhysique: true,
            referenceAutorisee: true,
            ordre: true,
          },
        });
        const coupures = await tx.coupureMonnaie.findMany({
          where: { actif: true },
          orderBy: [{ ordre: 'asc' }, { valeurFaciale: 'desc' }],
          select: {
            devise: true,
            valeurFaciale: true,
            type: true,
            ordre: true,
          },
        });
        const fiches = await tx.stockMedicament.findMany({
          where: { structureId: structure.id, archiveLe: null },
          select: {
            id: true,
            prixUnitaire: true,
            prixUnite: true,
            coefficientBoite: true,
            uniteMinimale: true,
            deconditionnable: true,
            qualifie: true,
            notes: true,
            medicament: {
              select: {
                id: true,
                nom: true,
                nomGenerique: true,
                categorie: true,
                formes: true,
                ordonnanceRequise: true,
              },
            },
          },
        });
        const agregats = await tx.agregatStockProduit.findMany({
          where: { pointDeVenteId: pointDeVente.id },
        });
        const lots = await tx.lotStock.findMany({
          where: {
            pointDeVenteId: pointDeVente.id,
            stockMedicament: { structureId: structure.id, archiveLe: null },
            agregat: { is: { quantite: { gt: 0 } } },
          },
          select: {
            id: true,
            stockMedicamentId: true,
            numeroLot: true,
            dateExpiration: true,
            dateReception: true,
            coefficientReception: true,
            lotTechnique: true,
            agregat: { select: { quantite: true } },
          },
        });
        const anomalies = await this.anomalies.lireOuvertes(
          tx,
          pointDeVente.id,
        );
        return {
          anomalies,
          posteLu,
          sequenceMaxRecue,
          plages,
          pointDeVente,
          parametres,
          modesPaiement,
          coupures,
          fiches,
          agregats,
          lots,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );

    const quantites = new Map(
      lue.agregats.map((a) => [a.stockMedicamentId, a.quantite]),
    );
    const lotsParFiche = new Map<string, LotSynchro[]>();
    for (const lot of lue.lots) {
      const liste = lotsParFiche.get(lot.stockMedicamentId) ?? [];
      liste.push({
        id: lot.id,
        numeroLot: lot.numeroLot,
        dateExpiration: lot.dateExpiration
          ? dateVersJour(lot.dateExpiration)
          : null,
        dateReception: lot.dateReception.toISOString(),
        coefficientReception: lot.coefficientReception,
        solde: lot.agregat?.quantite ?? 0,
        lotTechnique: lot.lotTechnique,
      });
      lotsParFiche.set(lot.stockMedicamentId, liste);
    }

    const fichesSynchro: FicheSynchro[] = lue.fiches.map((f) => {
      const lotsFiche = (lotsParFiche.get(f.id) ?? []).sort(comparerLots);
      const agregat = quantites.get(f.id) ?? 0;
      const sommeLots = lotsFiche.reduce(
        (somme, l) => somme + Math.max(0, l.solde),
        0,
      );
      return {
        stockId: f.id,
        medicamentId: f.medicament.id,
        nom: f.medicament.nom,
        nomGenerique: f.medicament.nomGenerique,
        categorie: f.medicament.categorie,
        formes: f.medicament.formes,
        ordonnanceRequise: f.medicament.ordonnanceRequise,
        prixUnitaire: f.prixUnitaire,
        prixUnite: f.prixUnite,
        coefficientBoite: f.coefficientBoite,
        uniteMinimale: f.uniteMinimale,
        deconditionnable: f.deconditionnable,
        qualifie: f.qualifie,
        notes: f.notes ?? null,
        quantite: Math.max(0, agregat),
        quantiteARegulariser: Math.max(0, sommeLots - agregat),
        lots: lotsFiche,
      };
    });
    fichesSynchro.sort(
      (a, b) =>
        a.nom.localeCompare(b.nom, 'fr') ||
        (a.stockId < b.stockId ? -1 : a.stockId > b.stockId ? 1 : 0),
    );

    return {
      pharmacie: {
        id: structure.id,
        nom: structure.nom,
        adresse: structure.adresse ?? null,
        ville: structure.ville ?? null,
        telephone: structure.telephone ?? null,
        logoUrl: structure.logoFile
          ? this.storage.getPublicUrl(structure.logoFile.key)
          : null,
      },
      pointDeVente: lue.pointDeVente,
      poste: {
        id: lue.posteLu.id,
        code: lue.posteLu.code,
        libelle: lue.posteLu.libelle,
        sequenceAppliquee: lue.posteLu.derniereSequenceAppliquee,
        sequenceMaxRecue: lue.sequenceMaxRecue,
        plages: lue.plages,
      },
      parametres: versParametresReponse(lue.parametres),
      modesPaiement: lue.modesPaiement,
      coupures: lue.coupures,
      fiches: fichesSynchro,
      anomalies: lue.anomalies,
    };
  }
}
