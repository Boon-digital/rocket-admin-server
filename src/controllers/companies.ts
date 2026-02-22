import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from 'admin-template-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

interface Company {
  _id: { $oid: string } | string;
  old_id?: string;
  name: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  remarks?: string;
  updatedAt?: string;
  updatedBy?: string;
  version?: string;
}

const companyService = new MockDataService<Company>('COMPANIES_MOCKDATA.json');

export const companiesController = {
  async getCompanies(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };
      const result = await companyService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchCompanies(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      if (!query) throw new AppError(400, 'Search query is required');
      const results = await companyService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getCompanyById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const company = await companyService.getById(id);
      if (!company) throw new AppError(404, `Company with ID ${id} not found`);
      res.json({ success: true, data: company });
    } catch (error) {
      next(error);
    }
  },

  async createCompany(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await companyService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateCompany(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await companyService.update(id, req.body);
      if (!result) throw new AppError(404, `Company with ID ${id} not found`);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteCompany(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await companyService.delete(id);
      if (!deleted) throw new AppError(404, `Company with ID ${id} not found`);
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
