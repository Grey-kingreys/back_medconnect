import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../services/prisma.service';

/**
 * Intercepteur d'audit trail pour les mutations du carnet de santé
 * (consultations, ordonnances, analyses, vaccinations).
 * Enregistre qui a fait quoi, quand et d'où (IP source).
 * Capturé APRÈS succès de la requête pour ne logger que les changements réels.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, path, user } = request;
    const userId = user?.userId;
    const ip = this.extractClientIp(request);

    return next.handle().pipe(
      tap(async (response) => {
        // Déterminer le type d'entité et l'ID en fonction de la route et de la réponse
        const { entityType, entityId } = this.extractEntityInfo(path, response);

        if (entityType && entityId) {
          // Déterminer l'action
          const action = this.extractAction(method, path);

          // Enregistrer dans AuditLog
          await this.prisma.auditLog.create({
            data: {
              userId,
              action,
              entityType,
              entityId,
              ip,
              metadata: {
                path,
                method,
                timestamp: new Date().toISOString(),
              },
            },
          });
        }
      }),
    );
  }

  /**
   * Extraire l'adresse IP réelle du client (derrière un proxy comme Caddy)
   */
  private extractClientIp(request: any): string {
    // Ordre : X-Forwarded-For (Caddy/proxy), X-Real-IP, connection.remoteAddress
    return (
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Extraire le type et l'ID de l'entité mutée depuis le path et la réponse
   */
  private extractEntityInfo(
    path: string,
    response: any,
  ): { entityType: string | null; entityId: string | null } {
    // Pattern: POST/PATCH/DELETE /carnet-sante/consultations/:id
    const consultationMatch = path.match(/\/carnet-sante\/consultations\/([\w-]+)/);
    if (consultationMatch) {
      return {
        entityType: 'Consultation',
        entityId: consultationMatch[1] || response?.id,
      };
    }

    const ordonnanceMatch = path.match(/\/carnet-sante\/ordonnances\/([\w-]+)/);
    if (ordonnanceMatch) {
      return {
        entityType: 'Ordonnance',
        entityId: ordonnanceMatch[1] || response?.id,
      };
    }

    const analyseMatch = path.match(/\/carnet-sante\/analyses\/([\w-]+)/);
    if (analyseMatch) {
      return {
        entityType: 'ResultatAnalyse',
        entityId: analyseMatch[1] || response?.id,
      };
    }

    const vaccinMatch = path.match(/\/carnet-sante\/vaccinations\/([\w-]+)/);
    if (vaccinMatch) {
      return {
        entityType: 'Vaccination',
        entityId: vaccinMatch[1] || response?.id,
      };
    }

    // Fallback : tirer l'ID de la réponse si c'est un objet avec `id`
    if (response?.id) {
      if (path.includes('consultation')) {
        return { entityType: 'Consultation', entityId: response.id };
      }
      if (path.includes('ordonnance')) {
        return { entityType: 'Ordonnance', entityId: response.id };
      }
      if (path.includes('analyse')) {
        return { entityType: 'ResultatAnalyse', entityId: response.id };
      }
      if (path.includes('vaccin')) {
        return { entityType: 'Vaccination', entityId: response.id };
      }
    }

    return { entityType: null, entityId: null };
  }

  /**
   * Mapper la méthode HTTP vers une action d'audit
   */
  private extractAction(method: string, path: string): string {
    if (method === 'POST') return 'create';
    if (method === 'PATCH') return 'update';
    if (method === 'PUT') return 'update';
    if (method === 'DELETE') return 'delete';
    return 'unknown';
  }
}
