import { Injectable, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

export interface OcrResult {
  fullText: string;
  extractedName?: string;
  extractedIdNumber?: string;
  extractedDob?: string;
  extractedExpiry?: string;
  confidence: number;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extractFromImage(imageBuffer: Buffer): Promise<OcrResult> {
    this.logger.log('Running Tesseract OCR on image...');

    const { data } = await Tesseract.recognize(imageBuffer, 'eng', {
      logger: () => {},
    });

    const fullText = data.text;
    const confidence = data.confidence;

    this.logger.log(`OCR confidence: ${confidence.toFixed(1)}%`);
    this.logger.debug(`OCR raw text: ${fullText}`);

    return {
      fullText,
      confidence,
      extractedName: this.extractName(fullText),
      extractedIdNumber: this.extractIdNumber(fullText),
      extractedDob: this.extractDate(fullText, 'dob'),
      extractedExpiry: this.extractDate(fullText, 'expiry'),
    };
  }

  // ── private helpers ──────────────────────────────────────────────────────────

  private extractName(text: string): string | undefined {
    // Try common ID card name patterns
    const patterns = [
      /(?:Name|NAME|Full Name|FULL NAME)[:\s]+([A-Z][A-Z\s]{2,40})/i,
      /(?:Surname|SURNAME)[:\s]+([A-Z][A-Z\s]{1,30})/i,
      // Khmer ID: name often on its own line in caps
      /^([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})?)\s*$/m,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return undefined;
  }

  private extractIdNumber(text: string): string | undefined {
    const patterns = [
      /(?:ID|No|Number|Card No)[.:\s]+([A-Z0-9]{6,20})/i,
      /\b([0-9]{9,12})\b/, // 9-12 digit number (common for national IDs)
      /\b([A-Z]{1,3}[0-9]{6,9})\b/, // Letter+digit format
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return undefined;
  }

  private extractDate(
    text: string,
    type: 'dob' | 'expiry',
  ): string | undefined {
    const keywords =
      type === 'dob'
        ? ['Date of Birth', 'DOB', 'Born', 'Birth']
        : ['Expiry', 'Expiration', 'Valid Until', 'Expires'];

    // Try keyword-specific extraction first
    for (const keyword of keywords) {
      const pattern = new RegExp(
        `${keyword}[:\\s]+([0-9]{1,2}[\\s/\\-][A-Za-z0-9]{1,3}[\\s/\\-][0-9]{2,4})`,
        'i',
      );
      const match = text.match(pattern);
      if (match?.[1]) return this.normalizeDate(match[1]);
    }

    // Fallback: extract all dates and pick first (dob) or last (expiry)
    const datePattern = /\b(\d{1,2}[\s/-]\d{1,2}[\s/-]\d{2,4})\b/g;
    const dates = [...text.matchAll(datePattern)].map((m) => m[1]);

    if (dates.length === 0) return undefined;
    const picked = type === 'dob' ? dates[0] : dates[dates.length - 1];
    return this.normalizeDate(picked);
  }

  private normalizeDate(raw: string): string {
    // Normalize separators and return as-is (let consumer parse)
    return raw.trim().replace(/\s+/g, '-');
  }
}
