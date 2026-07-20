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
    await this.store.set(session);
    return { requestId: payload.requestId, status: 'id-front-uploaded', key: payload.key };
  }

  async uploadIdBack(payload: { requestId: string; key: string }) {
    const session = await this.getSession(payload.requestId);
    session.idBackKey = payload.key;
    await this.store.set(session);
    return { requestId: payload.requestId, status: 'id-back-uploaded', key: payload.key };
  }

  async uploadSelfie(payload: { requestId: string; key: string }) {
    const session = await this.getSession(payload.requestId);
    session.selfieKey = payload.key;
    await this.store.set(session);
    return { requestId: payload.requestId, status: 'selfie-uploaded', key: payload.key };
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
    if (!session.selfieKey) {
      throw new BadRequestException('Selfie image has not been uploaded yet');
    }
    if (!session.livenessPassed) {
      throw new BadRequestException(
        'Liveness check must be completed before verification. ' +
        'Call POST /ekyc/liveness/request then POST /ekyc/liveness/confirm.',
      );
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

    // ── Step 3: Face match via CompreFace ────────────────────────────────────
    this.logger.log(`[${payload.requestId}] Running CompreFace face match...`);
    // CompreFace: source = selfie (live), target = ID card
    const faceResult = await this.faceMatch.compareFaces(selfieBuffer, idBuffer);
    this.logger.log(
      `[${payload.requestId}] Face match done — ${faceResult.message}`,
    );

    // ── Step 4: Determine overall result ─────────────────────────────────────
    const verified =
      faceResult.matched &&
      ocrResult.confidence > 30 &&
      (session.livenessPassed ?? false);

    const message = verified
      ? 'Verification successful'
      : !faceResult.matched
        ? faceResult.message
        : !(session.livenessPassed ?? false)
          ? 'Liveness check not passed'
          : 'OCR confidence too low — image may be unclear';

    const result = {
      verified,
      message,
      livenessPassed: session.livenessPassed ?? false,
      extractedName: ocrResult.extractedName,
      extractedIdNumber: ocrResult.extractedIdNumber,
      extractedDob: ocrResult.extractedDob,
      extractedExpiry: ocrResult.extractedExpiry,
      ocrConfidence: parseFloat(ocrResult.confidence.toFixed(1)),
      faceMatchConfidence: faceResult.confidence,
      faceMatchSimilarity: faceResult.similarity,
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
