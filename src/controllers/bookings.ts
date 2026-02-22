import { Request, Response, NextFunction } from 'express';
import { MockDataService } from '../services/mockDataService.js';
import type { PaginatedRequest } from '@ruben/admin-template-config/types/api.js';
import { AppError } from '../middleware/errorHandler.js';

interface Booking {
  _id: { $oid: string } | string;
  confirmationNo: string;
  bookerId?: string;
  bookerName?: string;
  costCentre?: string;
  travelPeriodStart?: string;
  travelPeriodEnd?: string;
  companyId?: string;
  companyName?: string;
  stayIds?: string[];
  status?: string;
  updatedAt?: { $date: string } | string;
  confirmationSent?: boolean;
  salesInvoice?: string;
  notes?: string;
}

const bookingService = new MockDataService<Booking>('BOOKINGS_MOCKDATA.json');

export const bookingsController = {
  async getBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const params: PaginatedRequest = {
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 10,
        sortBy: req.query.sortBy as string,
        sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'asc',
        search: req.query.search as string,
        ...req.query,
      };
      const result = await bookingService.getPaginated(params);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async searchBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;
      if (!query) throw new AppError(400, 'Search query is required');
      const results = await bookingService.search(query, limit);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },

  async getBookingById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const booking = await bookingService.getById(id);
      if (!booking) throw new AppError(404, `Booking with ID ${id} not found`);
      res.json({ success: true, data: booking });
    } catch (error) {
      next(error);
    }
  },

  async createBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await bookingService.create(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await bookingService.update(id, req.body);
      if (!result) throw new AppError(404, `Booking with ID ${id} not found`);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async deleteBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const deleted = await bookingService.delete(id);
      if (!deleted) throw new AppError(404, `Booking with ID ${id} not found`);
      res.json({ success: true, data: { id } });
    } catch (error) {
      next(error);
    }
  },
};
