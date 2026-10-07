// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiUrl: string;
  private readonly urgenceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Dans docker, on utilise le nom du service. Hors docker, localhost.
    this.aiUrl =
      this.configService.get<string>('AI_SERVICE_URL') ||
      'http://localhost:8002';
    this.urgenceUrl =
      this.configService.get<string>('AI_URGENCE') || 'http://localhost:8004';
  }

  async predictMaladie(symptomes: string) {
    try {
      // Jamais le contenu des symptômes dans les logs (donnée de santé)
      this.logger.log(
        `Appel IA Diagnostic (longueur des symptômes : ${symptomes.length} caractères)`,
      );

      const response = await firstValueFrom(
        this.httpService.post(`${this.aiUrl}/predire`, { symptomes }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'appel à l'IA Diagnostic: ${error.message}`,
      );
      return {
        maladie: 'Inconnue (Service indisponible)',
        reponse:
          "Désolé, notre service d'analyse est momentanément indisponible. Veuillez consulter un professionnel.",
        confiance: 0,
        certain: false,
      };
    }
  }

  async getEmergencyFirstAid(question: string) {
    try {
      // Jamais le contenu de la question dans les logs (donnée de santé)
      this.logger.log(
        `Appel IA Urgence (longueur de la question : ${question.length} caractères)`,
      );

      const response = await firstValueFrom(
        this.httpService.post(`${this.urgenceUrl}/urgence`, { question }),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'appel à l'IA Urgence: ${error.message}`,
      );
      return {
        tag: 'erreur',
        reponse:
          "Une erreur est survenue lors de la récupération des instructions de secours. En cas d'urgence vitale, appelez immédiatement le 15 ou les secours locaux.",
        similarite: 0,
        certain: false,
      };
    }
  }
}
