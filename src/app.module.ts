import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EkycModule } from './ekyc/ekyc.module';
import { UploadModule } from './upload/upload.module';
import { UserModule } from './users/user.module';

@Module({
  imports: [EkycModule, UploadModule, UserModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
