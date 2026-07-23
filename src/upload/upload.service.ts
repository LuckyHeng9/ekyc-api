import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, mkdir } from 'node:fs/promises';
import { S3Service } from '../ekyc/s3.service';
import { OcrService } from '../ekyc/ocr.service';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly s3Service: S3Service,
    private readonly ocrService: OcrService,
  ) {}

  async createPresignedUpload(payload: {
    fileName: string;
    contentType: string;
    contentLength?: number;
  }) {
    return this.s3Service.createPresignedUpload(payload);
  }

  async createPresignedView(payload: { key: string }) {
    return this.s3Service.createPresignedView(payload);
  }

  async uploadFile(file: Express.Multer.File) {
    let key: string;
    let s3Url: string | undefined;

    if (this.s3Service.isConfigured()) {
      const s3Key = `uploads/${randomUUID()}-${file.originalname}`;
      const uploadRes = await this.s3Service.uploadImage(
        s3Key,
        file.buffer,
        file.mimetype || 'image/jpeg',
      );
      key = uploadRes.key;
      s3Url = uploadRes.url;
      this.logger.log(`Uploaded file to S3 bucket [${uploadRes.bucket}] → ${key}`);
    } else {
      const uploadDir = join(tmpdir(), 'ekyc-uploads');
      await mkdir(uploadDir, { recursive: true });
      const filename = `${randomUUID()}-${file.originalname}`;
      const filepath = join(uploadDir, filename);
      await writeFile(filepath, file.buffer);
      key = `local:${filepath}`;
      s3Url = this.s3Service.getPreviewUrl(key);
      this.logger.log(`Saved file locally → ${filepath}`);
    }

    let ocrResult;
    try {
      this.logger.log('Extracting OCR from uploaded file...');
      ocrResult = await this.ocrService.extractFromImage(file.buffer);
    } catch (err) {
      this.logger.warn(`OCR extraction skipped/failed: ${err}`);
    }

    return {
      key,
      url: s3Url,
      ocrResult,
    };
  }
}
