import { MongoClient, type Db } from 'mongodb';

export interface AuthUser {
  _id?: string;
  email: string;
  name: string;
  provider: 'google' | 'microsoft';
  providerId: string;
  lastLogin: Date;
  createdAt: Date;
}

let db: Db | null = null;

export function initUserService(client: MongoClient, dbName: string): void {
  db = client.db(dbName);
}

function getCollection() {
  if (!db) throw new Error('UserService not initialized. Call initUserService() first.');
  return db.collection<AuthUser>('users');
}

export async function upsertUser(
  provider: 'google' | 'microsoft',
  providerId: string,
  email: string,
  name: string
): Promise<AuthUser> {
  const collection = getCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    { provider, providerId },
    {
      $set: { email, name, lastLogin: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return result as AuthUser;
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const { ObjectId } = await import('mongodb');
  const collection = getCollection();
  try {
    return await collection.findOne({ _id: new ObjectId(id) as any });
  } catch {
    return null;
  }
}
