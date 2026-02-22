import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@ruben/admin-template-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

// Server type for server-side
interface Server {
  _id: string;
  name: string;
  ip_adres: string;
  provider: string;
  control_panel: {
    cp_type: string;
    cp_url: string;
    cp_username: string;
    cp_password: string;
  };
  os: {
    type: string;
    version: string;
  };
  web_server: {
    type: string;
    version: string;
  };
  database: {
    type: string;
    version: string;
  };
  domains: string[];
}

const serverService = new MockDataService<Server>('SERVERS_MOCKDATA.json');

export const serversController = {
  async getServers(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };

      const result = await serverService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchServers(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!query) {
        throw new AppError(400, 'Search query is required');
      }

      const results = await serverService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getServerById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const server = await serverService.getById(id);

      if (!server) {
        throw new AppError(404, `Server with ID ${id} not found`);
      }

      res.json({ success: true, data: server });
    } catch (error) {
      next(error);
    }
  },

  async createServer(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as Omit<Server, '_id'>;
      const result = await serverService.create(data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateServer(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await serverService.update(id, req.body);
      if (!result) {
        throw new AppError(404, `Server with ID ${id} not found`);
      }
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteServer(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await serverService.delete(id);
      if (!deleted) {
        throw new AppError(404, `Server with ID ${id} not found`);
      }
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
