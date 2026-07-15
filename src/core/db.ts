import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase() {
  if (db) {
    return db;
  }

  const uri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017';
  const databaseName = process.env.MONGO_DB ?? 'ekyc-api';

  client = new MongoClient(uri);
  try {
    await client.connect();
    db = client.db(databaseName);
    console.log(`✅ MongoDB connected successfully to database: "${databaseName}"`);
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

export async function getDatabase() {
  return connectToDatabase();
}
