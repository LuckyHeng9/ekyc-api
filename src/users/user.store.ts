import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../core/db';

export interface UserRecord {
  _id?: ObjectId;
  name: string;
  email: string;
  phone?: string;
  ekycStatus: 'pending' | 'verified' | 'failed';
  ekycRequestId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class UserStore {
  private collection: Collection<UserRecord> | null = null;

  private async connect() {
    if (this.collection) {
      return this.collection;
    }

    const db = await getDatabase();
    this.collection = db.collection<UserRecord>('users');
    await this.collection.createIndex({ email: 1 }, { unique: true });
    return this.collection;
  }

  async findAll(): Promise<UserRecord[]> {
    const collection = await this.connect();
    return collection.find({}).toArray();
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const collection = await this.connect();
    if (!ObjectId.isValid(id)) return undefined;
    const record = await collection.findOne({ _id: new ObjectId(id) });
    return record ?? undefined;
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const collection = await this.connect();
    const record = await collection.findOne({ email });
    return record ?? undefined;
  }

  async create(data: Omit<UserRecord, '_id' | 'createdAt' | 'updatedAt'>): Promise<UserRecord> {
    const collection = await this.connect();
    const now = new Date();
    const record: UserRecord = { ...data, createdAt: now, updatedAt: now };
    const result = await collection.insertOne(record as any);
    return { ...record, _id: result.insertedId };
  }
}
