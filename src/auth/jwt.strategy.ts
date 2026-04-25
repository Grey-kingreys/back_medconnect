import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';

export type UserPayload = {
    userId: string;
    role: string; // Ajoutez le rôle ici
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
            },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('Utilisateur non trouvé ou inactif');
        }

        return {
            userId: user.id,
            role: user.role, // Incluez le rôle dans le payload
        };
    }
}