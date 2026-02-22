import { Request, Response, NextFunction } from 'express';
import { MongoService } from '../services/mongoService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { entityRegistry, type EntityKey } from '@boon-digital/rocket-admin-config/registry.js';
import { AppError } from '../middleware/errorHandler.js';

export function makeEntityController(entityKey: EntityKey) {
  const entry = entityRegistry[entityKey];
  const service = new MongoService(entityKey);
  const entityName = entry.name;

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

    async create(req: Request, res: Response, next: NextFunction) {
      try {
        const result = await service.create(req.body);
        res.status(201).json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async update(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        const result = await service.update(id, req.body);
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
