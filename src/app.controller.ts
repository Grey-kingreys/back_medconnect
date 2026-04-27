import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('App')
@Controller()
export class AppController {
    @Get()
    @ApiOperation({ summary: 'Health check' })
    getHello(): object {
        return {
            message: '🏥 MedConnect API — Plateforme de Santé Numérique',
            version: '1.0.0',
            status: 'running',
            docs: '/api',
        };
    }
}