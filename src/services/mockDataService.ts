import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { PaginatedRequest, PaginatedResponse } from '@ruben/admin-template-config/types/api.js';
import { MOCKDATA_DIR_DEFAULT } from '@ruben/admin-template-config/registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to mockdata directory - configurable via MOCKDATA_DIR env variable
const MOCKDATA_DIR = process.env.MOCKDATA_DIR || MOCKDATA_DIR_DEFAULT;
const MOCKDATA_PATH = join(__dirname, '../../..', MOCKDATA_DIR);

/**
 * Base entity type that supports both ID formats:
 * - Simple: _id: "123" or _id: 123
 * - MongoDB: _id: { $oid: "507f1f77bcf86cd799439011" }
 */
type BaseEntity = {
  _id: string | number | { $oid: string }
}

/**
 * Extract ID from entity regardless of format
 */
function extractId(entity: BaseEntity): string {
  if (typeof entity._id === 'object' && '$oid' in entity._id) {
    return entity._id.$oid
  }
  return String(entity._id)
}

/**
 * Generic service for loading and querying mock data
 * Supports both MongoDB-style IDs and simple IDs
 */
export class MockDataService<T extends BaseEntity> {
  private data: T[] | null = null;
  private readonly fileName: string;

  constructor(fileName: string) {
    this.fileName = fileName;
  }

  /**
   * Load mock data from JSON file
   */
  private async loadData(): Promise<T[]> {
    if (this.data) {
      return this.data;
    }

    const filePath = join(MOCKDATA_PATH, this.fileName);
    const fileContent = await readFile(filePath, 'utf-8');
    this.data = JSON.parse(fileContent);
    return this.data as T[];
  }

  /**
   * Write in-memory data back to the JSON file
   */
  private async persist(): Promise<void> {
    const filePath = join(MOCKDATA_PATH, this.fileName);
    await writeFile(filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Get all items (with optional filtering)
   */
  async getAll(filter?: (item: T) => boolean): Promise<T[]> {
    const data = await this.loadData();
    if (filter) {
      return data.filter(filter);
    }
    return data;
  }

  /**
   * Get paginated items with filtering, sorting, and search
   * Mimics MongoDB-style queries
   */
  async getPaginated(params: PaginatedRequest): Promise<PaginatedResponse<T>> {
    const {
      page = 1,
      pageSize = 10,
      sortBy,
      sortOrder = 'asc',
      search,
      ...filters
    } = params;

    let data = await this.loadData();

    // Apply search filter (searches across all string fields including nested)
    if (search) {
      const searchLower = search.toLowerCase();
      data = data.filter((item) =>
        Object.values(item).some((value) => {
          if (typeof value === 'object' && value !== null) {
            // Search nested objects
            return Object.values(value).some((v) =>
              String(v).toLowerCase().includes(searchLower)
            );
          }
          return String(value).toLowerCase().includes(searchLower);
        })
      );
    }

    // Apply additional filters (supports dot notation for nested fields)
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        data = data.filter((item) => {
          const itemValue = this.getNestedValue(item, key);
          return String(itemValue) === String(value);
        });
      }
    });

    // Apply sorting (supports dot notation for nested fields)
    if (sortBy) {
      data = [...data].sort((a, b) => {
        const aVal = this.getNestedValue(a, sortBy);
        const bVal = this.getNestedValue(b, sortBy);

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Handle booleans
        if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
          return sortOrder === 'asc' ? (aVal ? 1 : 0) - (bVal ? 1 : 0) : (bVal ? 1 : 0) - (aVal ? 1 : 0);
        }

        // Try numeric comparison for values that start with a number
        const aNum = parseFloat(String(aVal));
        const bNum = parseFloat(String(bVal));
        const comparison = (!isNaN(aNum) && !isNaN(bNum))
          ? aNum - bNum
          : String(aVal).localeCompare(String(bVal));
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    // Calculate pagination
    const totalItems = data.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    // Get paginated data
    const paginatedData = data.slice(startIndex, endIndex);

    return {
      data: paginatedData,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Get item by ID (supports both ID formats)
   */
  async getById(id: string): Promise<T | null> {
    const data = await this.loadData();
    return data.find((item) => extractId(item) === id) || null;
  }

  /**
   * Get items by IDs (supports both ID formats)
   */
  async getByIds(ids: string[]): Promise<T[]> {
    const data = await this.loadData();
    return data.filter((item) => ids.includes(extractId(item)));
  }

  /**
   * Search items (partial match on any field including nested)
   */
  async search(query: string, limit = 10): Promise<T[]> {
    const data = await this.loadData();
    const searchLower = query.toLowerCase();

    return data
      .filter((item) =>
        Object.values(item).some((value) => {
          if (typeof value === 'object' && value !== null) {
            return Object.values(value).some((v) =>
              String(v).toLowerCase().includes(searchLower)
            );
          }
          return String(value).toLowerCase().includes(searchLower);
        })
      )
      .slice(0, limit);
  }

  /**
   * Create a new item. Generates a new ID automatically.
   */
  async create(data: Omit<T, '_id'>): Promise<T> {
    const items = await this.loadData();

    // Generate a new numeric ID (max existing + 1) or use timestamp for string IDs
    let newId: string | number;
    const existingIds = items.map((item) => extractId(item));
    const numericIds = existingIds.map(Number).filter((n) => !isNaN(n));
    if (numericIds.length > 0) {
      newId = Math.max(...numericIds) + 1;
    } else {
      newId = `${Date.now()}`;
    }

    const newItem = { ...data, _id: newId } as T;
    items.push(newItem);
    await this.persist();
    return newItem;
  }

  /**
   * Update an existing item by ID (partial merge).
   * Returns the updated item, or null if not found.
   */
  async update(id: string, data: Partial<Omit<T, '_id'>>): Promise<T | null> {
    const items = await this.loadData();
    const index = items.findIndex((item) => extractId(item) === id);
    if (index === -1) return null;

    items[index] = { ...items[index], ...data };
    await this.persist();
    return items[index];
  }

  /**
   * Delete an item by ID.
   * Returns true if deleted, false if not found.
   */
  async delete(id: string): Promise<boolean> {
    const items = await this.loadData();
    const index = items.findIndex((item) => extractId(item) === id);
    if (index === -1) return false;

    items.splice(index, 1);
    await this.persist();
    return true;
  }
}

// Export the extractId helper for use elsewhere
export { extractId };
