import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('App')
@Controller()
export class AppController {
    @Get()
    @SkipThrottle() // Health check : jamais throttlé.
    @ApiOperation({ summary: 'Health check' })
    getHello(): object {
        return {
            message: '🏥 MedConnecte API — Plateforme de Santé Numérique',
            version: '1.0.0',
            status: 'running',
            docs: '/api',
        };
    }
}