import { Collection } from 'mongodb';
import { getDatabase } from '../core/db';

export interface EkycSessionRecord {
  requestId: string;
  idFrontKey?: string;
  selfieKey?: string;
  result?: {
    verified: boolean;
    message: string;
    extractedName?: string;
    extractedIdNumber?: string;
    extractedDob?: string;
    extractedExpiry?: string;
    ocrConfidence?: number;
    faceMatchConfidence?: number;
    faceMatchDistance?: number;
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
