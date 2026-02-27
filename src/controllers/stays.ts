import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

interface Stay {
  _id: { $oid: string } | string;
  checkInDate: string;
  checkOutDate: string;
  guestIds?: string[];
  hotelId?: string;
  hotelName?: string;
  hotelConfirmationNo?: string;
  roomType?: string;
  roomPrice?: string;
  roomCurrency?: string;
  status?: string;
  prepaid?: string;
  confirmationNo?: string;
  bookingId?: string;
  reference?: string;
  adminRemarks?: string;
  notes?: string;
}

const stayService = new MockDataService<Stay>('STAY_MOCKDATA.json');

export const staysController = {
  async getStays(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };
      const result = await stayService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchStays(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      if (!query) throw new AppError(400, 'Search query is required');
      const results = await stayService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getStayById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const stay = await stayService.getById(id);
      if (!stay) throw new AppError(404, `Stay with ID ${id} not found`);
      res.json({ success: true, data: stay });
    } catch (error) {
      next(error);
    }
  },

  async createStay(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await stayService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateStay(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await stayService.update(id, req.body);
      if (!result) throw new AppError(404, `Stay with ID ${id} not found`);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteStay(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await stayService.delete(id);
      if (!deleted) throw new AppError(404, `Stay with ID ${id} not found`);
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
