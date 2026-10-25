import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { numerosUrgence, type NumeroUrgence } from '../config/numeros-urgence';
import {
  VERSION_DOCUMENT_PAR_DEFAUT,
  VERSION_PAR_DEFAUT,
} from './configuration-publique.constants';
import {
  comparerVersions,
  FORMAT_VERSION_CONFIG,
  lireVersion,
} from './versions';

export const PLATEFORMES = ['android', 'ios'] as const;
export type Plateforme = (typeof PLATEFORMES)[number];

export interface VersionPlateforme {
  versionMinimale: string;
  versionRecommandee: string;
  urlTelechargement: string | null;
}

export interface ConfigurationPublique {
  numerosUrgence: NumeroUrgence[];
  versionsDocuments: { cgu: string; politiqueConfidentialite: string };
  fonctions: {
    espaceSoignant: boolean;
    annulationSos: boolean;
    boutonDemo: boolean;
  };
}

@Injectable()
export class ConfigurationPubliqueService {
  constructor(private readonly config: ConfigService) {}

  /** Valeur de la variable sans espaces, undefined si absente ou vide. */
  private lire(cle: string): string | undefined {
    const valeur = this.config.get<string>(cle)?.trim();
    return valeur ? valeur : undefined;
  }

  private lireVersionConfig(cle: string): string {
    const valeur = this.lire(cle);
    return valeur && FORMAT_VERSION_CONFIG.test(valeur)
      ? valeur
      : VERSION_PAR_DEFAUT;
  }

  private fonctionActive(cle: string): boolean {
    return this.lire(cle)?.toLowerCase() === 'true';
  }

  versionMinimale(plateforme: Plateforme): string {
    return this.lireVersionConfig(
      `APP_VERSION_MINIMALE_${plateforme.toUpperCase()}`,
    );
  }

  versions(): Record<Plateforme, VersionPlateforme> {
    const resultat = {} as Record<Plateforme, VersionPlateforme>;
    for (const plateforme of PLATEFORMES) {
      const suffixe = plateforme.toUpperCase();
      const versionMinimale = this.versionMinimale(plateforme);
      let versionRecommandee = this.lireVersionConfig(
        `APP_VERSION_RECOMMANDEE_${suffixe}`,
      );
      const recommandee = lireVersion(versionRecommandee);
      const minimale = lireVersion(versionMinimale);
      if (
        recommandee &&
        minimale &&
        comparerVersions(recommandee, minimale) < 0
      ) {
        versionRecommandee = versionMinimale;
      }
      resultat[plateforme] = {
        versionMinimale,
        versionRecommandee,
        urlTelechargement:
          this.lire(`APP_URL_TELECHARGEMENT_${suffixe}`) ?? null,
      };
    }
    return resultat;
  }

  configuration(): ConfigurationPublique {
    return {
      numerosUrgence: numerosUrgence(this.config),
      versionsDocuments: {
        cgu: this.lire('VERSION_CGU') ?? VERSION_DOCUMENT_PAR_DEFAUT,
        politiqueConfidentialite:
          this.lire('VERSION_POLITIQUE_CONFIDENTIALITE') ??
          VERSION_DOCUMENT_PAR_DEFAUT,
      },
      fonctions: {
        espaceSoignant: this.fonctionActive('FONCTION_ESPACE_SOIGNANT'),
        annulationSos: this.fonctionActive('FONCTION_ANNULATION_SOS'),
        boutonDemo: this.fonctionActive('FONCTION_BOUTON_DEMO'),
      },
    };
  }
}
