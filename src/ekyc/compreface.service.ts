import { Injectable, Logger } from '@nestjs/common';
import FormData from 'form-data';

export interface FaceMatchResult {
  matched: boolean;
  similarity: number; // 0–1 (1 = identical)
  confidence: number; // 0–100%
  message: string;
}

@Injectable()
export class CompreFaceService {
  private readonly logger = new Logger(CompreFaceService.name);

  /** Base URL of the running CompreFace instance, e.g. http://compreface-ui:8000 */
  private get baseUrl(): string {
    return (process.env.COMPREFACE_URL ?? 'http://localhost:8000').replace(
      /\/$/,
      '',
    );
  }

  /** API key of the Face Verification service created in CompreFace UI */
  private get apiKey(): string {
    return process.env.COMPREFACE_API_KEY ?? '';
  }

  /**
   * Compare two face images using CompreFace Face Verification API.
   *
   * @param sourceBuffer  - selfie image (the "live" face)
   * @param targetBuffer  - ID-card front image (the reference face)
   */
  async compareFaces(
    sourceBuffer: Buffer,
    targetBuffer: Buffer,
  ): Promise<FaceMatchResult> {
    const url = `${this.baseUrl}/api/v1/verification/verify`;

    const form = new FormData();
    form.append('source_image', sourceBuffer, {
      filename: 'selfie.jpg',
      contentType: 'image/jpeg',
    });
    form.append('target_image', targetBuffer, {
      filename: 'id_front.jpg',
      contentType: 'image/jpeg',
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          ...form.getHeaders(),
        },
        // form-data is a node Readable stream — cast for TypeScript
        body: form as unknown as BodyInit,
      });
    } catch (err) {
      this.logger.error(`CompreFace request failed: ${err}`);
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: 'CompreFace service unreachable',
      };
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`CompreFace HTTP ${res.status}: ${body}`);
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: `CompreFace error: ${res.status}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();

    /*
     * CompreFace response shape:
     * {
     *   "result": [{
     *     "source_image_face": { ... },
     *     "face_matches": [{ "similarity": 0.97, "face": { ... } }]
     *   }]
     * }
     */
    const matches: { similarity: number }[] | undefined =
      json?.result?.[0]?.face_matches;

    if (!matches || matches.length === 0) {
      this.logger.warn('CompreFace: no face match result returned');
      return {
        matched: false,
        similarity: 0,
        confidence: 0,
        message: 'No face detected in one or both images',
      };
    }

    const similarity = matches[0].similarity ?? 0;
    const threshold = parseFloat(process.env.COMPREFACE_THRESHOLD ?? '0.85');
    const matched = similarity >= threshold;
    const confidence = Math.round(similarity * 100);

    this.logger.log(
      `CompreFace: similarity=${similarity.toFixed(4)}, threshold=${threshold}, matched=${matched}`,
    );

    return {
      matched,
      similarity: parseFloat(similarity.toFixed(4)),
      confidence,
      message: matched
        ? `Face match successful (${confidence}% similarity)`
        : `Face mismatch — similarity ${confidence}% below threshold ${Math.round(threshold * 100)}%`,
    };
  }
}
