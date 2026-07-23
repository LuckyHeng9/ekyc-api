import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

@Injectable()
export class S3Service {
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor() {
    this.bucket =
      process.env.S3_BUCKET ?? process.env.AWS_S3_BUCKET ?? 'local-bucket';
    const accessKeyId =
      process.env.S3_ACCESS_KEY_ID ??
      process.env.AWS_ACCESS_KEY_ID ??
      'minioadmin';
    const secretAccessKey =
      process.env.S3_SECRET_ACCESS_KEY ??
      process.env.AWS_SECRET_ACCESS_KEY ??
      'minioadmin';
    const region =
      process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT;

    this.client = endpoint
      ? new S3Client({
          region,
          endpoint,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
          forcePathStyle: true,
        })
      : null;
  }

  private async ensureBucketExists() {
    if (!this.client) return;
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      const httpStatus = err?.$metadata?.httpStatusCode ?? 0;
      // Treat 409 (already exists), 403 (no permission = already exists in Supabase) as OK
      const ignore = err?.name === 'BucketAlreadyOwnedByYou' || httpStatus === 409 || httpStatus === 403;
      if (!ignore) throw error;
    }
  }

  async uploadImage(key: string, buffer: Buffer, contentType: string) {
    if (this.client) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });
      await this.client.send(command);
    }

    return {
      key,
      bucket: this.bucket,
      url: this.getPreviewUrl(key),
    };
  }

  async createPresignedUpload(payload: {
    fileName: string;
    contentType: string;
    contentLength?: number;
  }) {
    if (!this.client) {
      throw new BadRequestException(
        'S3 is not configured. Set S3_ENDPOINT and related credentials.',
      );
    }

    const key = `uploads/${randomUUID()}-${payload.fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: payload.contentType,
      ContentLength: payload.contentLength,
    });

    const presignedUrl = await getSignedUrl(this.client, command, {
      expiresIn: 300,
    });

    return {
      key,
      bucket: this.bucket,
      presignedUrl,
    };
  }

  async downloadImage(key: string): Promise<Buffer> {
    // Handle locally-stored files (uploaded via browser → NestJS)
    if (key.startsWith('local:')) {
      const filepath = key.slice('local:'.length);
      const { readFile } = await import('node:fs/promises');
      return readFile(filepath);
    }

    if (!this.client) {
      throw new BadRequestException('S3 is not configured.');
    }

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async createPresignedView(payload: { key: string }) {
    if (!this.client) {
      throw new BadRequestException(
        'S3 is not configured. Set S3_ENDPOINT and related credentials.',
      );
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: payload.key,
    });

    const presignedUrl = await getSignedUrl(this.client, command, {
      expiresIn: 300,
    });

    return {
      key: payload.key,
      presignedUrl,
    };
  }

  getPreviewUrl(key: string) {
    const endpoint = process.env.S3_ENDPOINT ?? '';
    if (endpoint) {
      const normalizedEndpoint = endpoint.replace(/\/$/, '');
      return `${normalizedEndpoint}/${this.bucket}/${key}`;
    }

    return `http://localhost:2000/uploads/${encodeURIComponent(key)}`;
  }
}
