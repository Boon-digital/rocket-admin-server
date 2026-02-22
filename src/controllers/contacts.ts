import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

interface Contact {
  _id: { $oid: string } | string;
  old_id?: string;
  general: {
    firstName: string;
    lastName: string;
    role: string;
    email?: string;
    phone?: string;
    remarks?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
}

const contactService = new MockDataService<Contact>('CONTACT_MOCKDATA.json');

export const contactsController = {
  async getContacts(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };
      const result = await contactService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchContacts(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      if (!query) throw new AppError(400, 'Search query is required');
      const results = await contactService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getContactById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const contact = await contactService.getById(id);
      if (!contact) throw new AppError(404, `Contact with ID ${id} not found`);
      res.json({ success: true, data: contact });
    } catch (error) {
      next(error);
    }
  },

  async createContact(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await contactService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateContact(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await contactService.update(id, req.body);
      if (!result) throw new AppError(404, `Contact with ID ${id} not found`);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteContact(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await contactService.delete(id);
      if (!deleted) throw new AppError(404, `Contact with ID ${id} not found`);
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
