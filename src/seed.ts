import 'dotenv/config';
import { Db } from 'mongodb';
import { connectToDatabase } from './core/db';

interface EkycSessionRecord {
  requestId: string;
  idFrontKey?: string;
  selfieKey?: string;
  result?: {
    verified: boolean;
    message: string;
    extractedName?: string;
    extractedIdNumber?: string;
    extractedDob?: string;
  };
}

interface UserRecord {
  name: string;
  email: string;
  phone?: string;
  ekycStatus: 'pending' | 'verified' | 'failed';
  ekycRequestId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── ekyc_sessions seed data ──────────────────────────────────────────────────
const ekycSeedData: EkycSessionRecord[] = [
  {
    requestId: 'seed-0001-aaaa-bbbb-cccc-dddddddddddd',
    idFrontKey: 'uploads/id-front/seed-0001.jpg',
    selfieKey: 'uploads/selfie/seed-0001.jpg',
    result: {
      verified: true,
      message: 'Verification successful',
      extractedName: 'John Doe',
      extractedIdNumber: 'ID-12345678',
      extractedDob: '1990-01-15',
    },
  },
  {
    requestId: 'seed-0002-aaaa-bbbb-cccc-dddddddddddd',
    idFrontKey: 'uploads/id-front/seed-0002.jpg',
    selfieKey: 'uploads/selfie/seed-0002.jpg',
    result: {
      verified: false,
      message: 'Verification failed: face mismatch',
      extractedName: 'Jane Smith',
      extractedIdNumber: 'ID-87654321',
      extractedDob: '1985-07-22',
    },
  },
  {
    // Session in progress — selfie not yet uploaded
    requestId: 'seed-0003-aaaa-bbbb-cccc-dddddddddddd',
    idFrontKey: 'uploads/id-front/seed-0003.jpg',
  },
  {
    // Session just started — no uploads yet
    requestId: 'seed-0004-aaaa-bbbb-cccc-dddddddddddd',
  },
];

// ── users seed data ──────────────────────────────────────────────────────────
const userSeedData: UserRecord[] = [
  {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+855 12 345 678',
    ekycStatus: 'verified',
    ekycRequestId: 'seed-0001-aaaa-bbbb-cccc-dddddddddddd',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
    phone: '+855 98 765 432',
    ekycStatus: 'failed',
    ekycRequestId: 'seed-0002-aaaa-bbbb-cccc-dddddddddddd',
    createdAt: new Date('2024-02-20'),
    updatedAt: new Date('2024-02-20'),
  },
  {
    name: 'Sok Chan',
    email: 'sok.chan@example.com',
    phone: '+855 77 111 222',
    ekycStatus: 'pending',
    ekycRequestId: 'seed-0003-aaaa-bbbb-cccc-dddddddddddd',
    createdAt: new Date('2024-03-10'),
    updatedAt: new Date('2024-03-10'),
  },
  {
    name: 'Dara Pich',
    email: 'dara.pich@example.com',
    ekycStatus: 'pending',
    createdAt: new Date('2024-04-01'),
    updatedAt: new Date('2024-04-01'),
  },
];

// ── seeders ──────────────────────────────────────────────────────────────────
async function seedEkycSessions(db: Db) {
  const collectionName = process.env.MONGO_COLLECTION ?? 'ekyc_sessions';
  const collection = db.collection(collectionName);
  await collection.createIndex({ requestId: 1 }, { unique: true });

  let inserted = 0;
  let skipped = 0;

  for (const record of ekycSeedData) {
    const existing = await collection.findOne({ requestId: record.requestId });
    if (existing) {
      console.log(`⏭️  [ekyc_sessions] Skipped: ${record.requestId}`);
      skipped++;
      continue;
    }
    await collection.insertOne(record);
    console.log(`✅ [ekyc_sessions] Inserted: ${record.requestId}`);
    inserted++;
  }

  console.log(`   → ekyc_sessions: inserted=${inserted}, skipped=${skipped}`);
}

async function seedUsers(db: Db) {
  const collection = db.collection('users');
  await collection.createIndex({ email: 1 }, { unique: true });

  let inserted = 0;
  let skipped = 0;

  for (const record of userSeedData) {
    const existing = await collection.findOne({ email: record.email });
    if (existing) {
      console.log(`⏭️  [users] Skipped: ${record.email}`);
      skipped++;
      continue;
    }
    await collection.insertOne(record);
    console.log(`✅ [users] Inserted: ${record.email}`);
    inserted++;
  }

  console.log(`   → users: inserted=${inserted}, skipped=${skipped}`);
}

async function seed() {
  console.log('🌱 Starting database seed...');

  const db = await connectToDatabase();

  await seedEkycSessions(db);
  await seedUsers(db);

  console.log('\n📊 Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
