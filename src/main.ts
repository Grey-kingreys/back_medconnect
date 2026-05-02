import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    .setTitle('MedConnect API')
    .setDescription('API de la plateforme de santé numérique MedConnect')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`🚀 MedConnect API démarrée sur http://localhost:${port}`);
  console.log(`📚 Swagger disponible sur http://localhost:${port}/api`);
}
bootstrap();