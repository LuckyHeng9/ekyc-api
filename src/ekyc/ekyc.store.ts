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

  private async connect() {
    if (this.collection) {
      return this.collection;
    }

    const db = await getDatabase();
    const collectionName = process.env.MONGO_COLLECTION ?? 'ekyc_sessions';
    this.collection = db.collection<EkycSessionRecord>(collectionName);
    await this.collection.createIndex({ requestId: 1 }, { unique: true });
    return this.collection;
  }

  async get(requestId: string): Promise<EkycSessionRecord | undefined> {
    const collection = await this.connect();
    const record = await collection.findOne({ requestId });
    return record ? record : undefined;
  }

  async set(record: EkycSessionRecord) {
    const collection = await this.connect();
    await collection.updateOne(
      { requestId: record.requestId },
      { $set: record },
      { upsert: true },
    );
    return record;
  }

  async delete(requestId: string) {
    const collection = await this.connect();
    await collection.deleteOne({ requestId });
  }
}
