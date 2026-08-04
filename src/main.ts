import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { RedisIoAdapter } from './common/redis-io.adapter';

async function bootstrap() {
  // `bufferLogs` : conserve les logs émis avant que Pino ne soit prêt.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Logger structuré (Pino) pour toute l'application, y compris les logs
  // internes de Nest. Masquage des données sensibles configuré dans app.module.
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Derrière Traefik (Dokploy) : `req.ip` = IP réelle du client via X-Forwarded-For.
  // Indispensable au rate-limiting/anti-brute-force par IP.
  app.set('trust proxy', 1);

  // Adapter socket.io ↔ Redis : partage des événements temps réel (chat, SOS)
  // entre instances. Indispensable dès que BACKEND_REPLICAS > 1.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Cookies
  app.use(cookieParser());

  // Sécurité des en-têtes HTTP
  app.use(helmet());

  // Sérialisation globale (conformément aux Skills Expert)
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Validation globale
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Supprime les champs non déclarés dans les DTOs
      forbidNonWhitelisted: true,
      transform: true,       // Transforme automatiquement les types
    }),
  );

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('MedConnecte API')
    .setDescription('API de la plateforme de santé numérique MedConnecte')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // `||` et non `??` : une variable déclarée mais vide doit retomber sur le défaut.
  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`🚀 MedConnecte API démarrée sur http://localhost:${port}`);
  logger.log(`📚 Swagger disponible sur http://localhost:${port}/api`);
}
bootstrap();