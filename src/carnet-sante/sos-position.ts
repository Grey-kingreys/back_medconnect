// Règle de qualité de la position d'une alerte SOS (TB10b, D52 à D57). Source unique,
// utilisée à la création de l'alerte et par l'anti-relance.

export const SOS_POSITION_AGE_MAX_MINUTES = 15;
export const SOS_PRECISION_MAX_METRES = 2000;
export const SOS_PRECISION_APPROXIMATIVE_METRES = 500;
export const SOS_HORODATAGE_AVANCE_TOLEREE_MINUTES = 5;

export type QualitePositionSos =
  | 'absente'
  | 'trop_ancienne'
  | 'trop_imprecise'
  | 'approximative'
  | 'precise'
  | 'non_qualifiee';

export interface PositionSos {
  latitude?: number | null;
  longitude?: number | null;
  precisionMetres?: number | null;
  horodatagePosition?: Date | null;
}

export interface EvaluationPositionSos {
  qualite: QualitePositionSos;
  /** Vrai si la position sert à choisir les établissements prévenus. */
  utilisable: boolean;
  precisionMetres: number | null;
  /** Vrai si l'horodatage, trop en avance sur `reference`, a été ignoré (D54). */
  horodatageIgnore: boolean;
}

export function evaluerPositionSos(
  position: PositionSos,
  reference: Date,
): EvaluationPositionSos {
  const precisionMetres = position.precisionMetres ?? null;
  let horodatageIgnore = false;

  if (position.latitude == null || position.longitude == null) {
    return {
      qualite: 'absente',
      utilisable: false,
      precisionMetres,
      horodatageIgnore,
    };
  }

  if (position.horodatagePosition) {
    const ecartMs = reference.getTime() - position.horodatagePosition.getTime();
    if (ecartMs < -SOS_HORODATAGE_AVANCE_TOLEREE_MINUTES * 60_000) {
      horodatageIgnore = true;
    } else if (ecartMs > SOS_POSITION_AGE_MAX_MINUTES * 60_000) {
      return {
        qualite: 'trop_ancienne',
        utilisable: false,
        precisionMetres,
        horodatageIgnore,
      };
    }
  }

  if (precisionMetres !== null && precisionMetres > SOS_PRECISION_MAX_METRES) {
    return {
      qualite: 'trop_imprecise',
      utilisable: false,
      precisionMetres,
      horodatageIgnore,
    };
  }
  if (
    precisionMetres !== null &&
    precisionMetres > SOS_PRECISION_APPROXIMATIVE_METRES
  ) {
    return {
      qualite: 'approximative',
      utilisable: true,
      precisionMetres,
      horodatageIgnore,
    };
  }
  if (precisionMetres !== null) {
    return {
      qualite: 'precise',
      utilisable: true,
      precisionMetres,
      horodatageIgnore,
    };
  }
  return {
    qualite: 'non_qualifiee',
    utilisable: true,
    precisionMetres,
    horodatageIgnore,
  };
}

/** Mètres arrondis à la dizaine, milliers séparés par une espace insécable : 1987 donne « 1 990 ». */
export function formaterMetres(metres: number): string {
  const arrondi = Math.round(metres / 10) * 10;
  return String(arrondi).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Ajouté à la charge de l'alerte et à la notification des soignants (D58). */
export function avertissementPositionApproximative(metres: number): string {
  return `Position approximative, environ ${formaterMetres(metres)} m`;
}

/** Phrase ajoutée au message de succès du patient quand la position est approximative. */
export function phrasePositionApproximative(metres: number): string {
  return ` Votre position est approximative (environ ${formaterMetres(metres)} m) : si vous le pouvez, appelez aussi les secours.`;
}

/** Message au patient quand la position reçue n'a pas servi (D57). */
export function messagePositionNonUtilisee(
  qualite: 'trop_ancienne' | 'trop_imprecise',
  proche: string,
): string {
  if (qualite === 'trop_ancienne') {
    return (
      "Votre position date de plus de 15 minutes et n'est plus fiable : aucun établissement de santé n'a été alerté." +
      `${proche} Appelez immédiatement les secours, puis relancez l'alerte pour envoyer votre position actuelle.`
    );
  }
  return (
    "Votre position est trop imprécise pour prévenir les établissements de santé proches : aucun établissement n'a été alerté." +
    `${proche} Appelez immédiatement les secours. Si vous le pouvez, placez-vous à découvert, attendez quelques secondes que votre position se précise, puis relancez l'alerte.`
  );
}
