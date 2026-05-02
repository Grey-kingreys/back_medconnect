import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Dans docker, on utilise le nom du service. Hors docker, localhost.
    this.aiUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8002';
  }

  async predictMaladie(symptomes: string) {
    try {
      this.logger.log(`Appel IA pour les symptômes: "${symptomes.substring(0, 50)}..."`);
      
      const response = await firstValueFrom(
        this.httpService.post(`${this.aiUrl}/predire`, { symptomes }),
      );
      
      return response.data;
    } catch (error) {
      this.logger.error(`Erreur lors de l'appel à l'IA: ${error.message}`);
      // Fallback si l'IA est hors-ligne
      return {
        maladie: 'Inconnue (Service indisponible)',
        reponse: 'Désolé, notre service d\'analyse est momentanément indisponible. Veuillez consulter un professionnel.',
        confiance: 0,
        certain: false
      };
    }
  }
}
