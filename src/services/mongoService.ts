import { MongoClient, ObjectId, type Db, type Filter } from 'mongodb';
import type { PaginatedRequest, PaginatedResponse } from '@boon-digital/rocket-admin-config/types/api.js';
import { entityRegistry, type EntityKey } from '@boon-digital/rocket-admin-config/registry.js';
import { maskEncryptedFields } from '../lib/crypto.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export function getMongoClient(): MongoClient {
  if (!client) throw new Error('MongoDB not connected. Call connectMongo() first.');
  return client;
}

export async function connectMongo(): Promise<void> {
  const connectionString = process.env.MONGOCONNECTIONSTRING;
  const dbName = process.env.MONGOCOLLECTION;

  if (!connectionString) throw new Error('MONGOCONNECTIONSTRING env var is not set');
  if (!dbName) throw new Error('MONGOCOLLECTION env var is not set');

  client = new MongoClient(connectionString);
  await client.connect();
  db = client.db(dbName);
  console.log(`✅ Connected to MongoDB (${dbName})`);
}

function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected. Call connectMongo() first.');
  return db;
}

export class MongoService<T extends { _id?: any }> {
  private readonly collectionName: string;
  private readonly searchFields: string[];

  constructor(entityKey: EntityKey) {
    this.collectionName = entityKey;
    this.searchFields = entityRegistry[entityKey].searchFields;
  }

  private get collection() {
    return getDb().collection<T>(this.collectionName);
  }

  async getPaginated(params: PaginatedRequest): Promise<PaginatedResponse<T>> {
    const {
      page = 1,
      pageSize = 10,
      sortBy,
      sortOrder = 'asc',
      search,
      ...filters
    } = params;

    const query: Filter<T> = {};

    // Text search across searchFields using $or / $regex
    if (search && search.trim() !== '') {
      const regex = { $regex: search, $options: 'i' };
      (query as any).$or = this.searchFields.map((field) => ({ [field]: regex }));
    }

    // Additional filters (from query params) - skip pagination/sort keys
    const skipKeys = new Set(['page', 'pageSize', 'sortBy', 'sortOrder', 'search']);
    for (const [key, value] of Object.entries(filters)) {
      if (skipKeys.has(key)) continue;
      if (value === undefined || value === null || value === '') continue;

      // Date range filter: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
      if (typeof value === 'object' && !Array.isArray(value) && 'from' in value && 'to' in value) {
        const { from, to } = value as { from: string; to: string };
        (query as any)[key] = {
          $gte: from,
          $lte: to,
        };
      } else {
        (query as any)[key] = value;
      }
    }

    const totalItems = await this.collection.countDocuments(query);
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (page - 1) * pageSize;

    const sortSpec: Record<string, 1 | -1> = sortBy
      ? { [sortBy]: sortOrder === 'desc' ? -1 : 1 }
      : {};

    const data = (await this.collection
      .find(query)
      .sort(sortSpec)
      .skip(skip)
      .limit(pageSize)
      .toArray() as T[]).map(maskEncryptedFields);

    return {
      data,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  async getById(id: string): Promise<T | null> {
    try {
      const result = await this.collection.findOne({ _id: new ObjectId(id) } as Filter<T>);
      return result ? maskEncryptedFields(result as Record<string, any>) as T : null;
    } catch {
      return null;
    }
  }

  /**
   * Like getById but returns the raw document without masking encrypted fields.
   * Only use this server-side (e.g. in the decrypt controller).
   */
  async getRawById(id: string): Promise<T | null> {
    try {
      const result = await this.collection.findOne({ _id: new ObjectId(id) } as Filter<T>);
      return result as T | null;
    } catch {
      return null;
    }
  }

  async getByIds(ids: string[]): Promise<T[]> {
    try {
      const objectIds = ids.map((id) => new ObjectId(id));
      const results = await this.collection
        .find({ _id: { $in: objectIds } } as Filter<T>)
        .toArray();
      return (results as T[]).map(maskEncryptedFields);
    } catch {
      return [];
    }
  }

  async search(query: string, limit = 10): Promise<T[]> {
    const regex = { $regex: query, $options: 'i' };
    const filter: Filter<T> = {
      $or: this.searchFields.map((field) => ({ [field]: regex })),
    } as Filter<T>;

    const results = await this.collection.find(filter).limit(limit).toArray() as T[];
    return results.map(maskEncryptedFields);
  }

  async findByField(field: string, value: string): Promise<T[]> {
    try {
      const filter = { [field]: value } as Filter<T>;
      const results = await this.collection.find(filter).toArray() as T[];
      return results.map(maskEncryptedFields);
    } catch {
      return [];
    }
  }

  async create(data: Omit<T, '_id'>): Promise<T> {
    const result = await this.collection.insertOne(data as any);
    return { ...data, _id: result.insertedId } as T;
  }

  async update(id: string, data: Partial<Omit<T, '_id'>>): Promise<T | null> {
    try {
      const { _id, ...safeData } = data as any;
      const result = await this.collection.findOneAndUpdate(
        { _id: new ObjectId(id) } as Filter<T>,
        { $set: safeData },
        { returnDocument: 'after' }
      );
      return result as T | null;
    } catch (e) {
      console.error('MongoService.update error:', e);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.collection.deleteOne({ _id: new ObjectId(id) } as Filter<T>);
      return result.deletedCount === 1;
    } catch {
      return false;
    }
  }
}
