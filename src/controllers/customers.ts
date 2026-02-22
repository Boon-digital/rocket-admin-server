import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

// Customer type for server-side
interface Customer {
  _id: number | string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  domains: Array<{ domain: string }>;
  actief: boolean;
}

const customerService = new MockDataService<Customer>('CUSTOMER_MOCKDATA.json');

export const customersController = {
  async getCustomers(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };

      const result = await customerService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchCustomers(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!query) {
        throw new AppError(400, 'Search query is required');
      }

      const results = await customerService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getCustomerById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const customer = await customerService.getById(id);

      if (!customer) {
        throw new AppError(404, `Customer with ID ${id} not found`);
      }

      res.json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  },

  async createCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const data = req.body as Omit<Customer, '_id'>;
      const result = await customerService.create(data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await customerService.update(id, req.body);
      if (!result) {
        throw new AppError(404, `Customer with ID ${id} not found`);
      }
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await customerService.delete(id);
      if (!deleted) {
        throw new AppError(404, `Customer with ID ${id} not found`);
      }
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
