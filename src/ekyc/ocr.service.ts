import { Injectable, Logger } from '@nestjs/common';
import Tesseract from 'tesseract.js';

export interface OcrResult {
  fullText: string;
  extractedName?: string;
  extractedIdNumber?: string;
  extractedDob?: string;
  extractedExpiry?: string;
  extractedNationality?: string;
  extractedSex?: string;
  confidence: number;
  mrzDetected?: boolean;
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
    this.logger.debug(`OCR raw text:\n${fullText}`);

    // Try MRZ parsing first (more reliable for ID cards than free-text OCR)
    const mrz = this.parseMRZ(fullText);
    if (mrz) {
      this.logger.log('MRZ detected — using MRZ data');
      return { fullText, confidence, mrzDetected: true, ...mrz };
    }

    return {
      fullText,
      confidence,
      mrzDetected: false,
      extractedName: this.extractName(fullText),
      extractedIdNumber: this.extractIdNumber(fullText),
      extractedDob: this.extractDate(fullText, 'dob'),
      extractedExpiry: this.extractDate(fullText, 'expiry'),
    };
  }

  // ── MRZ Parser (ICAO 9303 TD1 / TD3) ─────────────────────────────────────

  private parseMRZ(text: string): Partial<OcrResult> | null {
    // Trim each line, strip leading non-alphanumeric noise, filter short/empty lines
    const cleanedLines = text
      .split('\n')
      .map((l) => l.trim().toUpperCase().replace(/^[^A-Z0-9<]+/, ''))
      .filter((l) => l.length >= 10);

    // Standardize MRZ characters
    const mrzLines = cleanedLines.map((l) =>
      l
        .replace(/\s+/g, '<')
        .replace(/[^A-Z0-9<]/g, '<')
        .replace(/O(?=\d)|(?<=\d)O/g, '0'),
    );

    // ── Strategy 1: TD1 (3 lines e.g. Cambodian National ID) ─────────────────
    // Line 1: Starts with I (e.g. IDKHM1806714117...) and contains document number digits
    const line1Idx = mrzLines.findIndex(
      (l) =>
        (/^I[A-Z0-9<][A-Z]{3}/.test(l) || /^ID[A-Z]{3}/.test(l) || /^I[A-Z0-9<]{4}/.test(l)) &&
        /\d{5,}/.test(l),
    );

    if (line1Idx !== -1) {
      const line1 = mrzLines[line1Idx];
      const remaining = mrzLines.slice(line1Idx + 1);

      // Line 2: Starts with 6 digits (DOB) and contains sex/expiry
      const line2 = remaining.find((l) => /^\d{6}[0-9<][MF<]\d{6}/.test(l));

      if (line2) {
        const line2Idx = remaining.indexOf(line2);
        // Line 3: Name line after Line 2 or Line 1
        const line3 =
          remaining
            .slice(line2Idx + 1)
            .find((l) => /[A-Z]{2,}[<KLIXZ4]{1,}[A-Z]{2,}/.test(l) || l.includes('<<')) ||
          remaining.find((l) => l !== line2 && /[A-Z]{2,}/.test(l));

        if (line3) {
          this.logger.log(
            `MRZ TD1 matched: L1=${line1.slice(0, 15)}, L2=${line2.slice(0, 15)}, L3=${line3.slice(0, 15)}`,
          );
          return this.parseTD1(line1, line2, line3);
        }
      }
    }

    // ── Strategy 2: Any TD1 (3 lines ≥ 25 chars) ─────────────────────────────
    const mrzLike = mrzLines.filter((l) => l.length >= 25 && /^[A-Z0-9<]{25,}$/.test(l));
    if (mrzLike.length >= 3) {
      return this.parseTD1(mrzLike[0], mrzLike[1], mrzLike[2]);
    }

    // ── Strategy 3: TD3 passport (2 lines ≥ 36 chars) ────────────────────────
    const td3 = mrzLines.filter((l) => l.length >= 36);
    if (td3.length >= 2) return this.parseTD3(td3[0], td3[1]);

    return null;
  }

  private parseTD1(line1: string, line2: string, line3: string): Partial<OcrResult> {
    // Line 1: [type 2][country 3][docNo 9][check 1][optional 15]
    const docNumber = line1.slice(5, 14).replace(/</g, '').replace(/\D/g, '');

    // Line 2: [dob 6][check][sex][expiry 6][check][nationality 3][optional 11][check]
    const digitRuns = line2.match(/\d{6}/g) ?? [];
    const dobRaw = digitRuns[0] ?? line2.slice(0, 6);
    const expiryRaw = digitRuns[1] ?? line2.slice(8, 14);
    const sex =
      line2[7] === 'M' || line2[6] === 'M'
        ? 'Male'
        : line2[7] === 'F' || line2[6] === 'F'
          ? 'Female'
          : undefined;

    // Nationality: 3 letters around position 15
    const natMatch = line2.slice(15, 18).replace(/[^A-Z]/g, '');
    const nationality = natMatch.length === 3 ? natMatch : (line2.match(/[A-Z]{3}/)?.[0] ?? 'KHM');

    // Line 3: [surname]<<[given names]
    const fullName = this.cleanMrzName(line3);

    return {
      extractedIdNumber: docNumber || undefined,
      extractedName: fullName,
      extractedDob: this.fmtDate(dobRaw),
      extractedExpiry: this.fmtDate(expiryRaw),
      extractedNationality: nationality || undefined,
      extractedSex: sex,
    };
  }

  private parseTD3(line1: string, line2: string): Partial<OcrResult> {
    const nameParts   = line1.slice(5).replace(/</g, ' ').trim().split(/\s{2,}/);
    const fullName    = [nameParts[0], nameParts[1]].filter(Boolean).join(' ') || undefined;
    const docNumber   = line2.slice(0, 9).replace(/</g, '');
    const nationality = line2.slice(10, 13).replace(/</g, '');
    const dobRaw      = line2.slice(13, 19);
    const sex         = line2[20] === 'M' ? 'Male' : line2[20] === 'F' ? 'Female' : undefined;
    const expiryRaw   = line2.slice(21, 27);

    return {
      extractedIdNumber:    docNumber    || undefined,
      extractedName:        fullName,
      extractedDob:         this.fmtDate(dobRaw),
      extractedExpiry:      this.fmtDate(expiryRaw),
      extractedNationality: nationality  || undefined,
      extractedSex:         sex,
    };
  }

  private fmtDate(raw: string): string | undefined {
    if (!raw || raw.length !== 6 || !/^\d{6}$/.test(raw)) return undefined;
    const yy = parseInt(raw.slice(0, 2), 10);
    const mm = raw.slice(2, 4);
    const dd = raw.slice(4, 6);
    const curYY = new Date().getFullYear() % 100;
    const year  = yy <= curYY + 10 ? 2000 + yy : 1900 + yy;
    return `${year}-${mm}-${dd}`;
  }

  private cleanMrzName(line3: string): string | undefined {
    // 1. Strip leading non-alpha noise and trailing chevrons/spaces ONLY (never strip letters like L at word end)
    let raw = line3.toUpperCase().replace(/^[^A-Z]+/, '').replace(/[<\s]+$/, '');

    const parts = raw.split(/<{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return undefined;

    const surname = parts[0].replace(/[^A-Z]/g, '');

    let rawGiven = parts[1] ?? '';
    // Strip leading misread single filler char if Tesseract read '<<K' as part of given name
    rawGiven = rawGiven.replace(/^[KLIXZ4](?=[A-Z]{2,})/, '');

    const givenWords = rawGiven
      .split('<')
      .map((w) => w.replace(/[^A-Z]/g, ''))
      .filter(Boolean);

    const validGivenWords: string[] = [];
    for (let w of givenWords) {
      if (!w) continue;
      // Collapse 3+ character repetitions (e.g. LLLLLLLLL -> L)
      w = w.replace(/([A-Z])\1{2,}/g, '$1');
      // Strip trailing single noise characters like KL at word end if added by OCR fill
      w = w.replace(/(?<=[A-Z]{3,})[KLIXZ4]{1,2}$/, '');

      // If a single letter (like 'L') follows a word of length >= 3, merge it back (e.g. SOPHOR + L -> SOPHORL)
      const lastIdx = validGivenWords.length - 1;
      if (w.length === 1 && lastIdx >= 0 && validGivenWords[lastIdx].length >= 3) {
        validGivenWords[lastIdx] += w;
      } else {
        validGivenWords.push(w);
      }
    }

    const given = validGivenWords.join(' ');
    return [surname, given].filter(Boolean).join(' ') || undefined;
  }

  // ── Free-text fallbacks ────────────────────────────────────────────────────

  private extractName(text: string): string | undefined {
    const patterns = [
      /(?:Name|NAME|Full Name)[:\s]+([A-Z][A-Z\s]{2,40})/i,
      /^([A-Z]{2,}\s+[A-Z]{2,}(?:\s+[A-Z]{2,})?)\s*$/m,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return undefined;
  }

  private extractIdNumber(text: string): string | undefined {
    const patterns = [
      /(?:ID|No|Number|Card No)[.:\s]+([A-Z0-9]{6,20})/i,
      /\b([0-9]{9,12})\b/,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return undefined;
  }

  private extractDate(text: string, type: 'dob' | 'expiry'): string | undefined {
    const keywords = type === 'dob'
      ? ['Date of Birth', 'DOB', 'Born']
      : ['Expiry', 'Expiration', 'Valid Until'];

    for (const kw of keywords) {
      const m = text.match(new RegExp(`${kw}[:\\s]+([0-9]{1,2}[\\s/\\-][A-Za-z0-9]{1,3}[\\s/\\-][0-9]{2,4})`, 'i'));
      if (m?.[1]) return m[1].trim().replace(/\s+/g, '-');
    }

    const all = [...text.matchAll(/\b(\d{1,2}[\s/-]\d{1,2}[\s/-]\d{2,4})\b/g)].map((m) => m[1]);
    if (!all.length) return undefined;
    return (type === 'dob' ? all[0] : all[all.length - 1]).replace(/\s+/g, '-');
  }
}
