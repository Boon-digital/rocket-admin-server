import { Request, Response, NextFunction } from 'express';
import { MongoService } from '../services/mongoService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { entityRegistry, type EntityKey } from '@boon-digital/rocket-admin-config/registry.js';
import { AppError } from '../middleware/errorHandler.js';

// Per-entity write-time denormalization: called before create/update, mutates body in place
type DenormalizeFn = (body: any) => Promise<void>

const contactService = new MongoService('contacts')

const denormalizations: Partial<Record<EntityKey, DenormalizeFn>> = {
  stays: async (body: any) => {
    const ids: string[] = body.guestIds ?? []
    if (ids.length === 0) {
      body.guestNames = []
      return
    }
    const contacts = await contactService.getByIds(ids)
    const contactMap = new Map(contacts.map((c: any) => {
      const id = typeof c._id === 'object' ? c._id.toString() : String(c._id)
      const name = [c.general?.firstName, c.general?.lastName].filter(Boolean).join(' ')
      return [id, name]
    }))
    body.guestNames = ids.map((id) => contactMap.get(id) ?? id)
  },
}

export function makeEntityController(entityKey: EntityKey) {
  const entry = entityRegistry[entityKey];
  const service = new MongoService(entityKey);
  const entityName = entry.name;
  const denormalize = denormalizations[entityKey]

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
        if (denormalize) await denormalize(body);
        const result = await service.create(body);
        res.status(201).json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async update(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        const body = req.body;
        if (denormalize && 'guestIds' in body) await denormalize(body);
        const result = await service.update(id, body);
        if (!result) throw new AppError(404, `${entityName} with ID ${id} not found`);
        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async delete(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        const deleted = await service.delete(id);
        if (!deleted) throw new AppError(404, `${entityName} with ID ${id} not found`);
        res.json({ success: true, data: { id } });
      } catch (error) {
        next(error);
      }
    },
  };
}
