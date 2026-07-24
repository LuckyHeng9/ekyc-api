import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  private get bucket(): string {
    return (
      process.env.S3_BUCKET ?? process.env.AWS_S3_BUCKET ?? 'documents-ekyc'
    );
  }

  private get client(): S3Client | null {
    const endpoint = process.env.S3_ENDPOINT;
    if (!endpoint) return null;

    const accessKeyId =
      process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '';
    const secretAccessKey =
      process.env.S3_SECRET_ACCESS_KEY ??
      process.env.AWS_SECRET_ACCESS_KEY ??
      '';
    const region =
      process.env.S3_REGION ?? process.env.AWS_REGION ?? 'ap-southeast-1';

    return new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  isFirebaseConfigured(): boolean {
    return !!process.env.FIREBASE_STORAGE_BUCKET;
  }

  isConfigured(): boolean {
    return this.isFirebaseConfigured() || !!this.client;
  }

  private async ensureBucketExists() {
    if (!this.client) return;
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      const err = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const httpStatus = err?.$metadata?.httpStatusCode ?? 0;
      // Treat 409 (already exists), 403 (no permission = already exists in Supabase), 400 as OK
      const ignore =
        err?.name === 'BucketAlreadyOwnedByYou' ||
        err?.name === 'BucketAlreadyExists' ||
        httpStatus === 409 ||
        httpStatus === 403 ||
        httpStatus === 400;
      if (!ignore) throw error;
    }
  }

  private readonly logger = new Logger(S3Service.name);

  async uploadToFirebase(key: string, buffer: Buffer, contentType: string) {
    const bucket = process.env.FIREBASE_STORAGE_BUCKET;
    if (!bucket) {
      throw new BadRequestException(
        'FIREBASE_STORAGE_BUCKET is not set in .env',
      );
    }

    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType || 'image/jpeg',
      },
      body: buffer as unknown as BodyInit,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Firebase Storage upload failed (${res.status}): ${errText}`,
      );
    }

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`;
    this.logger.log(`Uploaded to Firebase Storage bucket [${bucket}] → ${key}`);
    return {
      key: `firebase:${key}`,
      bucket,
      url: publicUrl,
    };
  }

  async uploadImage(key: string, buffer: Buffer, contentType: string) {
    if (this.client) {
      await this.ensureBucketExists();
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });
      await this.client.send(command);
      this.logger.log(
        `Successfully uploaded to Supabase S3 bucket [${this.bucket}] → ${key}`,
      );
      return {
        key,
        bucket: this.bucket,
        url: this.getPreviewUrl(key),
      };
    }

    if (this.isFirebaseConfigured()) {
      return this.uploadToFirebase(key, buffer, contentType);
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

    // Handle Firebase Storage files
    if (key.startsWith('firebase:')) {
      const cleanKey = key.slice('firebase:'.length);
      const bucket = process.env.FIREBASE_STORAGE_BUCKET ?? this.bucket;
      const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(cleanKey)}?alt=media`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Firebase Storage download failed (${res.status})`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    if (!this.client) {
      throw new BadRequestException('S3/Firebase is not configured.');
    }

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);

    if (
      response.Body &&
      typeof (
        response.Body as unknown as {
          transformToByteArray?: () => Promise<Uint8Array>;
        }
      ).transformToByteArray === 'function'
    ) {
      const byteArray = await (
        response.Body as unknown as {
          transformToByteArray: () => Promise<Uint8Array>;
        }
      ).transformToByteArray();
      return Buffer.from(byteArray);
    }

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

    const appUrl = process.env.APP_URL ?? 'https://ekyc-api.onrender.com';
    return `${appUrl.replace(/\/$/, '')}/uploads/${encodeURIComponent(key)}`;
  }
}
