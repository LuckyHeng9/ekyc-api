import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VerifyIdentityDto } from './dto/verify-identity.dto';
import { EkycStore, EkycSessionRecord } from './ekyc.store';
import { OcrService } from './ocr.service';
import { CompreFaceService } from './compreface.service';
import { LivenessService, LivenessAction } from './liveness.service';
import { S3Service } from './s3.service';

@Injectable()
export class EkycService {
  private readonly logger = new Logger(EkycService.name);
  private readonly store = new EkycStore();
  private readonly ocr = new OcrService();
  private readonly faceMatch = new CompreFaceService();
  private readonly liveness = new LivenessService();
  private readonly s3 = new S3Service();

  getStatus() {
    return {
      service: 'ekyc',
      status: 'ready',
      faceEngine: 'compreface',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Session lifecycle
  // ─────────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  //  Image uploads
  // ─────────────────────────────────────────────────────────────────────────

  async uploadIdFront(payload: { requestId: string; key: string }) {
    const session = await this.getSession(payload.requestId);
    session.idFrontKey = payload.key;

    let ocrResult:
      Awaited<ReturnType<typeof this.ocr.extractFromImage>> | undefined;
    try {
      this.logger.log(
        `[${payload.requestId}] Extracting OCR from ID front key: ${payload.key}...`,
      );
      const idBuffer = await this.s3.downloadImage(payload.key);
      ocrResult = await this.ocr.extractFromImage(idBuffer);
      this.logger.log(
        `[${payload.requestId}] Instant OCR done — confidence: ${ocrResult.confidence.toFixed(1)}%`,
      );
    } catch (err) {
      this.logger.warn(
        `[${payload.requestId}] Instant OCR skipped for key ${payload.key}: ${err}`,
      );
    }

    await this.store.set(session);
    return {
      requestId: payload.requestId,
      status: 'id-front-uploaded',
      key: payload.key,
      ocrResult,
    };
  }

  async uploadIdBack(payload: { requestId: string; key: string }) {
    const session = await this.getSession(payload.requestId);
    session.idBackKey = payload.key;

    let ocrResult:
      Awaited<ReturnType<typeof this.ocr.extractFromImage>> | undefined;
    try {
      this.logger.log(
        `[${payload.requestId}] Extracting OCR from ID back key: ${payload.key}...`,
      );
      const idBuffer = await this.s3.downloadImage(payload.key);
      ocrResult = await this.ocr.extractFromImage(idBuffer);
    } catch (err) {
      this.logger.warn(
        `[${payload.requestId}] Instant OCR skipped for key ${payload.key}: ${err}`,
      );
    }

    await this.store.set(session);
    return {
      requestId: payload.requestId,
      status: 'id-back-uploaded',
      key: payload.key,
      ocrResult,
    };
  }

  async uploadSelfie(payload: { requestId: string; key: string }) {
    const session = await this.getSession(payload.requestId);
    session.selfieKey = payload.key;
    await this.store.set(session);
    return {
      requestId: payload.requestId,
      status: 'selfie-uploaded',
      key: payload.key,
    };
  }

  /**
   * Upload a file (browser → NestJS → Supabase S3 or local fallback).
   * Automatically creates an E-KYC session if `requestId` is omitted,
   * and automatically extracts OCR if the uploaded file is an ID image.
   */
  async uploadFile(payload: {
    requestId?: string;
    file?: Express.Multer.File;
    type?: 'id-front' | 'id-back' | 'selfie';
  }) {
    if (!payload.file || !payload.file.buffer) {
      throw new BadRequestException(
        'Image file is required. Multipart field name must be "file".',
      );
    }

    const requestId = payload.requestId || randomUUID();
    let session = await this.store.get(requestId);
    if (!session) {
      session = { requestId };
      await this.store.set(session);
    }

    const uploadType = payload.type || 'id-front';

    let key: string;
    let s3Url: string | undefined;

    if (this.s3.isConfigured()) {
      try {
        const s3Key = `uploads/${randomUUID()}-${payload.file.originalname}`;
        const uploadRes = await this.s3.uploadImage(
          s3Key,
          payload.file.buffer,
          payload.file.mimetype || 'image/jpeg',
        );
        key = uploadRes.key;
        s3Url = uploadRes.url;
        this.logger.log(
          `Uploaded ${uploadType} to S3 bucket [${uploadRes.bucket}] → ${key}`,
        );
      } catch (s3Err) {
        this.logger.warn(
          `S3 upload failed (${s3Err}) — falling back to local storage`,
        );
        const uploadDir = join(tmpdir(), 'ekyc-uploads');
        await mkdir(uploadDir, { recursive: true });
        const filename = `${randomUUID()}-${payload.file.originalname}`;
        const filepath = join(uploadDir, filename);
        await writeFile(filepath, payload.file.buffer);
        key = `local:${filepath}`;
      }
    } else {
      // Save to local temp directory if S3 is not configured
      const uploadDir = join(tmpdir(), 'ekyc-uploads');
      await mkdir(uploadDir, { recursive: true });
      const filename = `${randomUUID()}-${payload.file.originalname}`;
      const filepath = join(uploadDir, filename);
      await writeFile(filepath, payload.file.buffer);
      key = `local:${filepath}`;
      this.logger.log(`Saved ${uploadType} locally → ${filepath}`);
    }

    if (uploadType === 'id-front') session.idFrontKey = key;
    else if (uploadType === 'id-back') session.idBackKey = key;
    else session.selfieKey = key;

    let ocrResult:
      Awaited<ReturnType<typeof this.ocr.extractFromImage>> | undefined;
    if (uploadType === 'id-front' || uploadType === 'id-back') {
      try {
        this.logger.log(`Running instant OCR extraction on ${uploadType}...`);
        ocrResult = await this.ocr.extractFromImage(payload.file.buffer);
        this.logger.log(
          `Instant OCR complete for ${uploadType} — confidence: ${ocrResult.confidence.toFixed(1)}%`,
        );
      } catch (err) {
        this.logger.error(`Instant OCR failed on ${uploadType}: ${err}`);
      }
    }

    await this.store.set(session);
    return {
      requestId,
      status: `${uploadType}-uploaded`,
      key,
      url: s3Url,
      ocrResult,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Liveness
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Issue a random liveness challenge for this session.
   * The client should display the instruction, capture the user performing
   * the action, then call `confirmLiveness`.
   */
  async requestLiveness(requestId: string) {
    const session = await this.getSession(requestId);
    const challenge = this.liveness.issueChallenge();

    // Store challenge metadata in session (for audit / expiry cross-check)
    session.livenessChallenge = {
      challengeId: challenge.challengeId,
      action: challenge.action,
      issuedAt: challenge.issuedAt,
    };
    session.livenessPassed = false;
    await this.store.set(session);

    return {
      requestId,
      challengeId: challenge.challengeId,
      action: challenge.action,
      instruction: challenge.instruction,
      expiresIn: challenge.expiresIn,
    };
  }

  /**
   * Confirm the liveness challenge.
   * Client provides the `challengeId` it received and the `action` it performed.
   *
   * In production: also submit a short video / frame so the server can
   * run an anti-spoofing model instead of trusting the client claim.
   */
  async confirmLiveness(payload: {
    requestId: string;
    challengeId: string;
    action: LivenessAction;
  }) {
    const session = await this.getSession(payload.requestId);

    const result = this.liveness.confirmChallenge(
      payload.challengeId,
      payload.action,
    );

    session.livenessPassed = result.passed;
    await this.store.set(session);

    if (!result.passed) {
      throw new BadRequestException(result.message);
    }

    return {
      requestId: payload.requestId,
      livenessPassed: true,
      action: result.action,
      message: result.message,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Verification
  // ─────────────────────────────────────────────────────────────────────────

  async verifyIdentity(payload: VerifyIdentityDto) {
    const session = await this.getSession(payload.requestId);

    if (!session.idFrontKey) {
      throw new BadRequestException('ID front image has not been uploaded yet');
    }
    // Selfie is optional — if missing, only OCR is run (no face match)
    const selfieOptional = !session.selfieKey;
    if (!session.livenessPassed) {
      throw new BadRequestException(
        'Liveness check must be completed before verification. ' +
          'Call POST /ekyc/liveness/request then POST /ekyc/liveness/confirm.',
      );
    }

    this.logger.log(`[${payload.requestId}] Starting verification...`);

    // ── Step 1: Download ID image ────────────────────────────────────────────
    const idBuffer = await this.s3.downloadImage(session.idFrontKey);

    // ── Step 2: Run OCR on ID image ──────────────────────────────────────────
    this.logger.log(`[${payload.requestId}] Running OCR...`);
    const ocrResult = await this.ocr.extractFromImage(idBuffer);
    this.logger.log(
      `[${payload.requestId}] OCR done — confidence: ${ocrResult.confidence.toFixed(1)}%`,
    );

    // ── Step 3: Face match (only if selfie uploaded) ─────────────────────────
    let faceResult: Awaited<
      ReturnType<typeof this.faceMatch.compareFaces>
    > | null = null;
    if (!selfieOptional && session.selfieKey) {
      this.logger.log(`[${payload.requestId}] Running face match...`);
      const selfieBuffer = await this.s3.downloadImage(session.selfieKey);
      faceResult = await this.faceMatch.compareFaces(selfieBuffer, idBuffer);
      this.logger.log(
        `[${payload.requestId}] Face match done — ${faceResult.message}`,
      );
    } else {
      this.logger.log(
        `[${payload.requestId}] No selfie — skipping face match (OCR only)`,
      );
    }

    // ── Step 4: Determine overall result ─────────────────────────────────────
    const faceMatched = faceResult?.matched ?? true; // no selfie = skip face check
    // Lower confidence threshold for OCR-only mode (Khmer IDs score lower with Tesseract)
    const ocrThreshold = selfieOptional ? 10 : 30;
    const verified =
      faceMatched &&
      ocrResult.confidence > ocrThreshold &&
      (session.livenessPassed ?? false);

    const message = verified
      ? selfieOptional
        ? 'OCR extraction successful (no face match — selfie not provided)'
        : 'Verification successful'
      : !faceMatched
        ? (faceResult?.message ?? 'Face match failed')
        : !(session.livenessPassed ?? false)
          ? 'Liveness check not passed'
          : 'OCR confidence too low — image may be unclear';

    const result = {
      verified,
      message,
      ocrOnly: selfieOptional,
      mrzDetected: ocrResult.mrzDetected ?? false,
      livenessPassed: session.livenessPassed ?? false,
      extractedName: ocrResult.extractedName,
      extractedIdNumber: ocrResult.extractedIdNumber,
      extractedDob: ocrResult.extractedDob,
      extractedExpiry: ocrResult.extractedExpiry,
      extractedNationality: ocrResult.extractedNationality,
      extractedSex: ocrResult.extractedSex,
      ocrConfidence: parseFloat(ocrResult.confidence.toFixed(1)),
      faceMatchConfidence: faceResult?.confidence ?? null,
      faceMatchSimilarity: faceResult?.similarity ?? null,
    };

    session.result = result;
    await this.store.set(session);

    this.logger.log(
      `[${payload.requestId}] Verification complete — verified: ${verified}`,
    );

    return { requestId: payload.requestId, ...result };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Result
  // ─────────────────────────────────────────────────────────────────────────

  async getResult(requestId: string) {
    const session = await this.getSession(requestId);

    if (!session.result) {
      return {
        requestId,
        status: 'pending',
        message: 'Verification has not completed yet',
      };
    }

    return { requestId, status: 'completed', ...session.result };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async getSession(requestId: string): Promise<EkycSessionRecord> {
    const session = await this.store.get(requestId);
    if (!session) throw new NotFoundException('E-KYC session not found');
    return session;
  }
}
