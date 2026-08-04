import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';

/**
 * Câblage global de l'AppModule (PLAN §2.3, §1.5).
 *
 * L'AuditInterceptor et le throttler par utilisateur ont chacun existé, écrits et
 * corrects, tout en n'étant PAS déclarés dans `providers` — donc silencieusement
 * inactifs (aucune erreur, aucun log). Un test de comportement ne l'aurait pas vu
 * sans provoquer la situation exacte ; on vérifie donc directement la déclaration.
 *
 * Lire les métadonnées du module n'instancie rien : pas de Postgres ni de Redis
 * requis. Toute suppression de ces deux `APP_*` fait échouer ce test.
 */
describe('AppModule — câblage global (audit + throttling)', () => {
  const providers: Array<{ provide?: unknown; useClass?: unknown }> =
    Reflect.getMetadata('providers', AppModule) ?? [];

  const estDeclare = (token: unknown, classe: unknown) =>
    providers.some((p) => p?.provide === token && p?.useClass === classe);

  it('enregistre AuditInterceptor comme APP_INTERCEPTOR global (audit trail santé)', () => {
    expect(estDeclare(APP_INTERCEPTOR, AuditInterceptor)).toBe(true);
  });

  it('enregistre UserThrottlerGuard comme APP_GUARD global (rate-limiting)', () => {
    expect(estDeclare(APP_GUARD, UserThrottlerGuard)).toBe(true);
  });
});
