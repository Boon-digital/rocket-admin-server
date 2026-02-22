import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

interface Hotel {
  _id: { $oid: string } | string;
  old_id?: string;
  name: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

const hotelService = new MockDataService<Hotel>('HOTEL_MOCKDATA.json');

export const hotelsController = {
  async getHotels(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };
      const result = await hotelService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchHotels(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      if (!query) throw new AppError(400, 'Search query is required');
      const results = await hotelService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getHotelById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const hotel = await hotelService.getById(id);
      if (!hotel) throw new AppError(404, `Hotel with ID ${id} not found`);
      res.json({ success: true, data: hotel });
    } catch (error) {
      next(error);
    }
  },

  async createHotel(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await hotelService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateHotel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await hotelService.update(id, req.body);
      if (!result) throw new AppError(404, `Hotel with ID ${id} not found`);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteHotel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await hotelService.delete(id);
      if (!deleted) throw new AppError(404, `Hotel with ID ${id} not found`);
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
