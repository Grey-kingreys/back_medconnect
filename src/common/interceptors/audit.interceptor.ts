import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../services/prisma.service';

/** Segment de route → type d'entité auditée. */
const ENTITES: Record<string, string> = {
  consultations: 'Consultation',
  ordonnances: 'Ordonnance',
  analyses: 'ResultatAnalyse',
  vaccinations: 'Vaccination',
  'profil-medical': 'ProfilMedical',
};

/**
 * Audit trail des données de santé : qui a lu ou modifié quoi, quand et depuis
 * quelle IP. Enregistré en `APP_INTERCEPTOR` (cf. `app.module.ts`).
 *
 * Périmètre : les accès au carnet d'un patient par un tiers (médecin), les
 * lectures unitaires et toutes les mutations d'entités médicales. Les listes
 * (« mes consultations ») ne sont pas journalisées : elles ne portent pas sur une
 * entité identifiable et noieraient les accès réellement sensibles.
 *
 * L'écriture de l'audit ne doit jamais faire échouer la requête métier : toute
 * erreur est logguée et avalée.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const { method } = request;
    // `trust proxy` est configuré dans main.ts : `req.ip` résout déjà
    // X-Forwarded-For pour les proxies de confiance, sans être falsifiable
    // par le client (contrairement à une lecture brute de l'en-tête).
    const ip = request.ip ?? null;
    const userId = request.user?.userId ?? null;
    const path: string = request.route?.path ?? request.url ?? '';

    return next.handle().pipe(
      tap({
        next: (response) => {
          const cible = this.resoudreCible(request, response);
          if (!cible) return;
          void this.enregistrer({
            userId,
            action: this.actionDepuisMethode(method),
            ...cible,
            ip,
            path,
            method,
          });
        },
        error: (error) => {
          // Un accès refusé à des données médicales est précisément ce qu'un
          // audit doit retenir.
          if (error?.status !== 403) return;
          const cible = this.resoudreCible(request, null);
          if (!cible) return;
          void this.enregistrer({
            userId,
            action: 'denied',
            ...cible,
            ip,
            path,
            method,
          });
        },
      }),
    );
  }

  /**
   * Détermine l'entité visée à partir de l'URL et, à défaut, de la réponse
   * (cas d'une création où l'ID n'existe pas encore dans l'URL).
   */
  private resoudreCible(
    request: any,
    response: any,
  ): { entityType: string; entityId: string } | null {
    const url: string = request.originalUrl ?? request.url ?? '';
    const chemin = url.split('?')[0];

    // Consultation du carnet d'un patient par un tiers (médecin).
    const carnetPatient = chemin.match(/\/carnet-sante\/patient\/([\w-]+)/);
    if (carnetPatient) {
      return { entityType: 'CarnetSante', entityId: carnetPatient[1] };
    }

    const segments = chemin.match(/\/carnet-sante\/([\w-]+)(?:\/([\w-]+))?/);
    if (!segments) return null;

    const entityType = ENTITES[segments[1]];
    if (!entityType) return null;

    // ID dans l'URL (lecture unitaire, suppression) sinon ID de l'entité créée.
    const entityId = segments[2] ?? response?.id;
    if (!entityId) return null;

    return { entityType, entityId };
  }

  private actionDepuisMethode(method: string): string {
    switch (method) {
      case 'GET':
        return 'read';
      case 'POST':
        return 'create';
      case 'PATCH':
      case 'PUT':
        return 'update';
      case 'DELETE':
        return 'delete';
      default:
        return 'unknown';
    }
  }

  private async enregistrer(entree: {
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    ip: string | null;
    path: string;
    method: string;
  }): Promise<void> {
    const { path, method, ...donnees } = entree;
    try {
      await this.prisma.auditLog.create({
        data: { ...donnees, metadata: { path, method } },
      });
    } catch (error) {
      this.logger.error(
        `audit.write_failed — ${entree.action} ${entree.entityType}:${entree.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
