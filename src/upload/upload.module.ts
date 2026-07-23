import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { S3Service } from '../ekyc/s3.service';
import { OcrService } from '../ekyc/ocr.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService, S3Service, OcrService],
})
export class UploadModule {}
