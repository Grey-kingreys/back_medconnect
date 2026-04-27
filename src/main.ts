import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('MedConnect API')
    .setDescription('API de la plateforme de santé numérique MedConnect')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 MedConnect API démarrée sur http://localhost:${port}`);
  console.log(`📚 Swagger disponible sur http://localhost:${port}/api`);
}
bootstrap();