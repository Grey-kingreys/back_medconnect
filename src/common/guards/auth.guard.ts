import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { RevocationService } from 'src/auth/revocation.service';
import { messagePourCode } from 'src/auth/sessions.constants';

interface ChargeJeton {
  userId: string;
  role: string;
  structureId?: string;
  sid?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly revocation: RevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException(
        'Token manquant. Veuillez vous connecter.',
      );
    }

    let payload: ChargeJeton;
    try {
      payload = await this.jwtService.verifyAsync<ChargeJeton>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré.');
    }

    // Hors du try : l'exception de révocation ne doit pas être remplacée par « Token invalide ».
    const code = await this.revocation.verifier({
      userId: payload.userId,
      sid: payload.sid,
    });
    if (code) {
      throw new UnauthorizedException({ message: messagePourCode(code), code });
    }

    request['user'] = payload;
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
