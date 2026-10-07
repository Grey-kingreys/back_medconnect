/**
 * CODE INUTILISÉ (constaté le 2026-10-06, point 25 du BACKLOG-PRIORISE racine).
 * Ce fichier n'est importé par aucun module : l'authentification passe par `AuthGuard` (`src/common/guards/auth.guard.ts`) qui vérifie le token avec `JwtService`.
 * Conservé volontairement (consigne : ne supprimer aucun code existant).
 * À retirer lors d'un nettoyage dédié, après vérification.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- code inutilisé, dette de typage préexistante non corrigée */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

export type UserPayload = {
  userId: string;
  role: string;
  structureId?: string | null;
};

export type RequestWithUser = {
  user: UserPayload;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: any): Promise<UserPayload> {
    // Récupérez l'utilisateur depuis la base de données avec son rôle
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        structureId: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Utilisateur non trouvé ou inactif');
    }

    return {
      userId: user.id,
      role: user.role,
      structureId: user.structureId,
    };
  }
}
