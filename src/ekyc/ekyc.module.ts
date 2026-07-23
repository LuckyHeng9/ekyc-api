import { Module } from '@nestjs/common';
import { EkycController } from './ekyc.controller';
import { EkycService } from './ekyc.service';
import { S3Service } from './s3.service';
import { OcrService } from './ocr.service';
import { CompreFaceService } from './compreface.service';
import { LivenessService } from './liveness.service';

@Module({
  controllers: [EkycController],
  providers: [
    EkycService,
    S3Service,
    OcrService,
    CompreFaceService,
    LivenessService,
  ],
})
export class EkycModule {}
