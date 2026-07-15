import { Injectable } from '@nestjs/common';
import { S3Service } from '../ekyc/s3.service';

@Injectable()
export class UploadService {
  constructor(private readonly s3Service: S3Service) {}

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
}
