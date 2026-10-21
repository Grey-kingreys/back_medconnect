import { Module } from '@nestjs/common';
import { ConfigurationPubliqueController } from './configuration-publique.controller';
import { ConfigurationPubliqueService } from './configuration-publique.service';

// Version minimale et configuration publique de l'application mobile (TB5).
@Module({
  controllers: [ConfigurationPubliqueController],
  providers: [ConfigurationPubliqueService],
  exports: [ConfigurationPubliqueService],
})
export class ConfigurationPubliqueModule {}
