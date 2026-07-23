import { Collection } from 'mongodb';
import { getDatabase } from '../core/db';

export interface EkycSessionRecord {
  requestId: string;
  idFrontKey?: string;
  idBackKey?: string;
  selfieKey?: string;
  /** Liveness challenge issued for this session */
  livenessChallenge?: {
    challengeId: string;
    action: string;
    issuedAt: number;
  };
  /** Whether the liveness check has been passed */
  livenessPassed?: boolean;
  result?: {
    verified: boolean;
    message: string;
    ocrOnly?: boolean;
    mrzDetected?: boolean;
    extractedName?: string;
    extractedIdNumber?: string;
    extractedDob?: string;
    extractedExpiry?: string;
    extractedNationality?: string;
    extractedSex?: string;
    ocrConfidence?: number;
    faceMatchConfidence?: number | null;
    faceMatchSimilarity?: number | null;
    livenessPassed?: boolean;
  };
}

export class EkycStore {
  private collection: Collection<EkycSessionRecord> | null = null;
  private readonly memoryStore = new Map<string, EkycSessionRecord>();

  private async connect() {
    if (this.collection) {
      return this.collection;
    }

    try {
      const db = await getDatabase();
      const collectionName = process.env.MONGO_COLLECTION ?? 'ekyc_sessions';
      this.collection = db.collection<EkycSessionRecord>(collectionName);
      await this.collection.createIndex({ requestId: 1 }, { unique: true });
      return this.collection;
    } catch {
      return null;
    }
  }

  async get(requestId: string): Promise<EkycSessionRecord | undefined> {
    try {
      const collection = await this.connect();
      if (collection) {
        const record = await collection.findOne({ requestId });
        if (record) return record;
      }
    } catch {
      // Fall back to in-memory store
    }
    return this.memoryStore.get(requestId);
  }

  async set(record: EkycSessionRecord) {
    this.memoryStore.set(record.requestId, record);
    try {
      const collection = await this.connect();
      if (collection) {
        await collection.updateOne(
          { requestId: record.requestId },
          { $set: record },
          { upsert: true },
        );
      }
    } catch {
      // Fall back to in-memory store
    }
    return record;
  }

  async delete(requestId: string) {
    this.memoryStore.delete(requestId);
    try {
      const collection = await this.connect();
      if (collection) {
        await collection.deleteOne({ requestId });
      }
    } catch {
      // Ignore
    }
  }
}
