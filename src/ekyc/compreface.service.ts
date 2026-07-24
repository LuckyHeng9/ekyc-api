import { Injectable, Logger } from '@nestjs/common';
import FormData from 'form-data';

export interface FaceMatchResult {
  matched: boolean;
  similarity: number; // 0–1
  confidence: number; // 0–100%
  message: string;
}

interface LuxandSubjectResponse {
  uuid?: string;
}

interface LuxandMatch {
  uuid?: string;
  similarity?: number;
}

interface LuxandSearchResult {
  matches?: LuxandMatch[];
}

interface LuxandErrorResponse {
  message?: string;
}

/**
 * Face verification using Luxand.cloud Face API
 *
 * Free tier: 500 API calls/month (no credit card required)
 *
 * Setup:
 * 1. Sign up at dashboard.luxand.cloud
 * 2. Copy your API token (top right of dashboard)
 * 3. Add to .env:
 *    LUXAND_TOKEN=your_token_here
 *    COMPREFACE_THRESHOLD=0.8
 *
 * API docs: https://luxand.cloud/help
 */
@Injectable()
export class CompreFaceService {
  private readonly logger = new Logger(CompreFaceService.name);

  private get token(): string {
    return process.env.LUXAND_TOKEN ?? '';
  }

  private get threshold(): number {
    return parseFloat(process.env.COMPREFACE_THRESHOLD ?? '0.8');
  }

  /**
   * Compare two face images using Luxand Face Verification.
   *
   * @param sourceBuffer - selfie (live face)
   * @param targetBuffer - ID card front (reference face)
   */
  async compareFaces(
    sourceBuffer: Buffer,
    targetBuffer: Buffer,
  ): Promise<FaceMatchResult> {
    if (!this.token) {
      if (process.env.ALLOW_MOCK_FACEMATCH === 'true') {
        this.logger.warn(
          'Luxand token not set — using MOCK face match (ALLOW_MOCK_FACEMATCH=true)',
        );
        return {
          matched: true,
          similarity: 0.95,
          confidence: 95,
          message: 'Face match successful (Mock Mode)',
        };
      }
      this.logger.warn('Luxand token not set — check LUXAND_TOKEN in .env');
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: 'Face API not configured (set LUXAND_TOKEN)',
      };
    }

    try {
      // Step 1: Detect + store face from ID card → get uuid
      const storeRes = await this.storeFace(targetBuffer, 'ID card');
      if (storeRes.error) {
        if (process.env.ALLOW_MOCK_FACEMATCH === 'true') {
          this.logger.warn(
            `Luxand API error (${storeRes.error}) — falling back to MOCK face match`,
          );
          return {
            matched: true,
            similarity: 0.92,
            confidence: 92,
            message: 'Face match successful (Mock Fallback)',
          };
        }
        return {
          matched: false,
          similarity: 0,
          confidence: 0,
          message: storeRes.error,
        };
      }

      const idUuid = storeRes.uuid;
      if (!idUuid) {
        return {
          matched: false,
          similarity: 0,
          confidence: 0,
          message: 'No face detected in ID card photo',
        };
      }

      // Step 2: Verify selfie against stored ID face
      const result = await this.verifyFace(sourceBuffer, idUuid);

      // Step 3: Delete the stored face (cleanup — don't persist biometric data)
      await this.deleteFace(idUuid);

      return result;
    } catch (err) {
      this.logger.error(`Luxand API error: ${err}`);
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: 'Face comparison failed due to API error',
      };
    }
  }

  /**
   * Upload a face photo to Luxand temporary subject store.
   * Returns the Luxand uuid for the stored face, or error message.
   */
  private async storeFace(
    buffer: Buffer,
    label: string,
  ): Promise<{ uuid: string | null; error?: string }> {
    const form = new FormData();
    form.append('photo', buffer, {
      filename: 'face.jpg',
      contentType: 'image/jpeg',
    });
    form.append('name', `ekyc_${Date.now()}`);

    const res = await fetch('https://us-api.luxand.cloud/subject', {
      method: 'POST',
      headers: {
        token: this.token,
        ...form.getHeaders(),
      },
      body: form as unknown as BodyInit,
    });

    if (!res.ok) {
      const errText = await res.text();
      let errorMsg = `Luxand Face API HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText) as LuxandErrorResponse;
        if (typeof errJson?.message === 'string') {
          errorMsg = `Face API Error: ${errJson.message}`;
        }
      } catch {
        // use raw text if not json
      }
      this.logger.error(
        `Luxand store face failed for ${label} (${res.status}): ${errText}`,
      );
      return { uuid: null, error: errorMsg };
    }

    const json = (await res.json()) as LuxandSubjectResponse;
    const uuid: string | undefined = json?.uuid;

    if (!uuid) {
      this.logger.warn(`No face detected in ${label} by Luxand`);
      return { uuid: null };
    }

    this.logger.log(`Luxand: stored ${label} face → uuid=${uuid}`);
    return { uuid };
  }

  /**
   * Verify a selfie against a stored Luxand subject uuid.
   */
  private async verifyFace(
    selfieBuffer: Buffer,
    uuid: string,
  ): Promise<FaceMatchResult> {
    const form = new FormData();
    form.append('photo', selfieBuffer, {
      filename: 'selfie.jpg',
      contentType: 'image/jpeg',
    });

    const res = await fetch(`https://us-api.luxand.cloud/photo/search`, {
      method: 'POST',
      headers: {
        token: this.token,
        ...form.getHeaders(),
      },
      body: form as unknown as BodyInit,
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Luxand verify failed (${res.status}): ${err}`);
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: `Luxand error: ${res.status}`,
      };
    }

    const results = (await res.json()) as LuxandSearchResult[];
    if (!results || results.length === 0) {
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: 'No face detected in selfie',
      };
    }

    // Find match for our stored uuid

    const match = results[0]?.matches?.find(
      (m: LuxandMatch) => m.uuid === uuid,
    );
    const similarity: number =
      match?.similarity ?? results[0]?.matches?.[0]?.similarity ?? 0;
    const matched = similarity >= this.threshold;
    const confidence = Math.round(similarity * 100);

    this.logger.log(
      `Luxand: similarity=${similarity.toFixed(4)}, threshold=${this.threshold}, matched=${matched}`,
    );

    return {
      matched,
      similarity: parseFloat(similarity.toFixed(4)),
      confidence,
      message: matched
        ? `Face match successful (${confidence}% confidence)`
        : `Face mismatch — confidence ${confidence}% below threshold ${Math.round(this.threshold * 100)}%`,
    };
  }

  /** Delete stored face from Luxand (GDPR / privacy cleanup) */
  private async deleteFace(uuid: string): Promise<void> {
    try {
      await fetch(`https://us-api.luxand.cloud/subject/${uuid}`, {
        method: 'DELETE',
        headers: { token: this.token },
      });
      this.logger.log(`Luxand: deleted stored face uuid=${uuid}`);
    } catch {
      this.logger.warn(`Luxand: failed to delete face uuid=${uuid}`);
    }
  }
}
