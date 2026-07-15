import { Module } from '@nestjs/common';
import { EkycController } from './ekyc.controller';
import { EkycService } from './ekyc.service';
import { S3Service } from './s3.service';
import { OcrService } from './ocr.service';
import { FaceMatchService } from './face-match.service';

@Module({
  controllers: [EkycController],
  providers: [EkycService, S3Service, OcrService, FaceMatchService],
})
export class EkycModule {}

