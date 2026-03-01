import { Request, Response, NextFunction } from 'express';
import { MongoService } from '../services/mongoService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { entityRegistry, type EntityKey } from '@boon-digital/rocket-admin-config/registry.js';
import { AppError } from '../middleware/errorHandler.js';

// Per-entity write-time denormalization: called before create/update, mutates body in place
// id is provided on update (undefined on create)
export type DenormalizeFn = (body: any, id?: string) => Promise<void>

// Per-entity post-write sync: called after create/update/delete to keep related entities in sync
// op: 'upsert' after create/update, 'delete' after delete
// savedDoc: the full saved document (null on delete)
// previousDoc: the document before the write (null on create)
export type CrossEntitySyncFn = (op: 'upsert' | 'delete', savedDoc: any | null, previousDoc: any | null) => Promise<void>

// Registerable hook maps — populated by calling registerDenormalization / registerCrossEntitySync
// before the server starts handling requests. Empty by default so the shared server works without miceflow-specific logic.
const denormalizations: Partial<Record<EntityKey, DenormalizeFn>> = {}
const crossEntitySyncs: Partial<Record<EntityKey, CrossEntitySyncFn>> = {}

/**
 * Register a denormalization function for an entity key.
 * Call this at startup (e.g. from src/config/entityHooks.ts) before the server begins serving requests.
 */
export function registerDenormalization(key: EntityKey, fn: DenormalizeFn): void {
  denormalizations[key] = fn
}

/**
 * Register a cross-entity sync function for an entity key.
 * Call this at startup (e.g. from src/config/entityHooks.ts) before the server begins serving requests.
 */
export function registerCrossEntitySync(key: EntityKey, fn: CrossEntitySyncFn): void {
  crossEntitySyncs[key] = fn
}


export function makeEntityController(entityKey: EntityKey) {
  const entry = entityRegistry[entityKey];
  const service = new MongoService(entityKey);
  const entityName = entry.name;
  // Look up hooks dynamically so registrations made after this call are still used
  const denormalize = () => denormalizations[entityKey]
  const syncRelated = () => crossEntitySyncs[entityKey]

  return {
    async getAll(req: Request, res: Response, next: NextFunction) {
      try {
        const params: PaginatedRequest = {
          ...req.query,
          page: parseInt(req.query.page as string) || 1,
          pageSize: parseInt(req.query.pageSize as string) || 10,
          sortBy: req.query.sortBy as string,
          sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
          search: req.query.search as string,
        };
        const result = await service.getPaginated(params);
        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async search(req: Request, res: Response, next: NextFunction) {
      try {
        const query = req.query.q as string;
        const limit = parseInt(req.query.limit as string) || 10;
        if (!query) throw new AppError(400, 'Search query is required');
        const results = await service.search(query, limit);
        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    },

    async getById(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        const item = await service.getById(id);
        if (!item) throw new AppError(404, `${entityName} with ID ${id} not found`);
        res.json({ success: true, data: item });
      } catch (error) {
        next(error);
      }
    },

    async getByIds(req: Request, res: Response, next: NextFunction) {
      try {
        const ids = req.query.ids as string;
        if (!ids) throw new AppError(400, 'ids query parameter is required');
        const idList = ids.split(',').filter(Boolean);
        const results = await service.getByIds(idList);
        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    },

    async getByField(req: Request, res: Response, next: NextFunction) {
      try {
        const { field, value } = req.params;
        if (!field || !value) throw new AppError(400, 'field and value parameters are required');
        const results = await service.findByField(field, value);
        res.json({ success: true, data: results });
      } catch (error) {
        next(error);
      }
    },

    async create(req: Request, res: Response, next: NextFunction) {
      try {
        const body = req.body;
        const dn = denormalize(); if (dn) await dn(body);
        const result = await service.create(body);
        const sync = syncRelated(); if (sync) await sync('upsert', result, null);
        res.status(201).json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async update(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        const body = req.body;
        const dn = denormalize(); if (dn) await dn(body, id);
        const result = await service.update(id, body);
        if (!result) throw new AppError(404, `${entityName} with ID ${id} not found`);
        const sync = syncRelated(); if (sync) await sync('upsert', result, null);
        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async delete(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        // Fetch before deleting so sync has the full document (including bookingId)
        const sync = syncRelated();
        const docBeforeDelete = sync ? await service.getById(id) : null;
        const deleted = await service.delete(id);
        if (!deleted) throw new AppError(404, `${entityName} with ID ${id} not found`);
        if (sync) await sync('delete', null, docBeforeDelete);
        res.json({ success: true, data: { id } });
      } catch (error) {
        next(error);
      }
    },
  };
}
