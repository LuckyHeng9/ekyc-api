import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VerifyIdentityDto } from './dto/verify-identity.dto';
import { EkycStore, EkycSessionRecord } from './ekyc.store';
import { OcrService } from './ocr.service';
import { FaceMatchService } from './face-match.service';
import { S3Service } from './s3.service';

@Injectable()
export class EkycService {
  private readonly logger = new Logger(EkycService.name);
  private readonly store = new EkycStore();
  private readonly ocr = new OcrService();
  private readonly faceMatch = new FaceMatchService();
  private readonly s3 = new S3Service();

  getStatus() {
    return {
      service: 'ekyc',
      status: 'ready',
    };
  }

  async startEkyc() {
    const requestId = randomUUID();
    const session: EkycSessionRecord = { requestId };
    await this.store.set(session);

    return {
      requestId,
      status: 'started',
      message: 'E-KYC session created',
    };
  }

  async uploadIdFront(payload: { requestId: string; key: string }) {
    const session = await this.store.get(payload.requestId);
    if (!session) {
      throw new NotFoundException('E-KYC session not found');
    }

    session.idFrontKey = payload.key;
    await this.store.set(session);
    return {
      requestId: payload.requestId,
      status: 'id-front-uploaded',
      key: payload.key,
    };
  }

  async uploadIdBack(payload: { requestId: string; key: string }) {
    const session = await this.store.get(payload.requestId);
    if (!session) {
      throw new NotFoundException('E-KYC session not found');
    }

    session.idBackKey = payload.key;
    await this.store.set(session);
    return {
      requestId: payload.requestId,
      status: 'id-back-uploaded',
      key: payload.key,
    };
  }

  async uploadSelfie(payload: { requestId: string; key: string }) {
    const session = await this.store.get(payload.requestId);
    if (!session) {
      throw new NotFoundException('E-KYC session not found');
    }

    session.selfieKey = payload.key;
    await this.store.set(session);
    return {
      requestId: payload.requestId,
      status: 'selfie-uploaded',
      key: payload.key,
    };
  }

  async verifyIdentity(payload: VerifyIdentityDto) {
    const session = await this.store.get(payload.requestId);
    if (!session) {
      throw new NotFoundException('E-KYC session not found');
    }

    if (!session.idFrontKey) {
      throw new BadRequestException('ID front image has not been uploaded yet');
    }

    if (!session.selfieKey) {
      throw new BadRequestException('Selfie image has not been uploaded yet');
    }

    this.logger.log(`[${payload.requestId}] Starting verification...`);

    // ── Step 1: Download images from S3 ─────────────────────────────────────
    this.logger.log(`[${payload.requestId}] Downloading images from S3...`);
    const [idBuffer, selfieBuffer] = await Promise.all([
      this.s3.downloadImage(session.idFrontKey),
      this.s3.downloadImage(session.selfieKey),
    ]);

    // ── Step 2: Run OCR on ID image ──────────────────────────────────────────
    this.logger.log(`[${payload.requestId}] Running OCR...`);
    const ocrResult = await this.ocr.extractFromImage(idBuffer);
    this.logger.log(
      `[${payload.requestId}] OCR done — confidence: ${ocrResult.confidence.toFixed(1)}%`,
    );

    // ── Step 3: Face match selfie vs ID photo ────────────────────────────────
    this.logger.log(`[${payload.requestId}] Running face match...`);
    const faceResult = await this.faceMatch.compareFaces(
      idBuffer,
      selfieBuffer,
    );
    this.logger.log(
      `[${payload.requestId}] Face match done — ${faceResult.message}`,
    );

    // ── Step 4: Determine overall verification result ────────────────────────
    const verified = faceResult.matched && ocrResult.confidence > 30;
    const message = verified
      ? 'Verification successful'
      : !faceResult.matched
        ? faceResult.message
        : 'OCR confidence too low — image may be unclear';

    const result = {
      verified,
      message,
      extractedName: ocrResult.extractedName,
      extractedIdNumber: ocrResult.extractedIdNumber,
      extractedDob: ocrResult.extractedDob,
      extractedExpiry: ocrResult.extractedExpiry,
      ocrConfidence: parseFloat(ocrResult.confidence.toFixed(1)),
      faceMatchConfidence: faceResult.confidence,
      faceMatchDistance: faceResult.distance,
    };

    session.result = result;
    await this.store.set(session);

    this.logger.log(
      `[${payload.requestId}] Verification complete — verified: ${verified}`,
    );

    return {
      requestId: payload.requestId,
      ...result,
    };
  }

  async getResult(requestId: string) {
    const session = await this.store.get(requestId);
    if (!session) {
      throw new NotFoundException('E-KYC session not found');
    }

    if (!session.result) {
      return {
        requestId,
        status: 'pending',
        message: 'Verification has not completed yet',
      };
    }

    return {
      requestId,
      status: 'completed',
      ...session.result,
    };
  }
}
