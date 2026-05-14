import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './services/encryption.service';
import { SmsService } from './services/sms.service';

@Global()
@Module({
  providers: [EncryptionService, SmsService],
  exports: [EncryptionService, SmsService],
})
export class SecurityModule {}
