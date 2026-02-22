import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@ruben/admin-template-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

// Domain type for server-side
interface Domain {
  _id: string;
  website_url: string;
  register_date: string | null;
  registrar: string;
  type: string;
  pagespeed: number;
  notes: string;
  status: {
    ssl: boolean;
    is_online: boolean;
    gtm: string;
    php_version: string;
    wordpress_version: string;
  };
  server: string | null;
}

const domainService = new MockDataService<Domain>('DOMAINS_MOCKDATA.json');

export const domainsController = {
  async getDomains(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };

      const result = await domainService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchDomains(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!query) {
        throw new AppError(400, 'Search query is required');
      }

      const results = await domainService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getDomainById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const domain = await domainService.getById(id);

      if (!domain) {
        throw new AppError(404, `Domain with ID ${id} not found`);
      }

      res.json({ success: true, data: domain });
    } catch (error) {
      next(error);
    }
  },

  async getDomainsByServerId(req: Request, res: Response, next: NextFunction) {
    try {
      const { serverId } = req.params;
      const domains = await domainService.getAll((domain) => domain.server === serverId);
      res.json({ success: true, data: domains });
    } catch (error) {
      next(error);
    }
  },

  async createDomain(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as Omit<Domain, '_id'>;
      const result = await domainService.create(data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateDomain(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await domainService.update(id, req.body);
      if (!result) {
        throw new AppError(404, `Domain with ID ${id} not found`);
      }
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteDomain(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await domainService.delete(id);
      if (!deleted) {
        throw new AppError(404, `Domain with ID ${id} not found`);
      }
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
