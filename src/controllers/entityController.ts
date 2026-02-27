import { Request, Response, NextFunction } from 'express';
import { MongoService } from '../services/mongoService.js';
import type { PaginatedRequest } from '@boon-digital/rocket-admin-config/types/api.js';
import { entityRegistry, type EntityKey } from '@boon-digital/rocket-admin-config/registry.js';
import { AppError } from '../middleware/errorHandler.js';

// Per-entity write-time denormalization: called before create/update, mutates body in place
type DenormalizeFn = (body: any) => Promise<void>

// Per-entity post-write sync: called after create/update/delete to keep related entities in sync
// op: 'upsert' after create/update, 'delete' after delete
// savedDoc: the full saved document (null on delete)
// previousDoc: the document before the write (null on create)
type CrossEntitySyncFn = (op: 'upsert' | 'delete', savedDoc: any | null, previousDoc: any | null) => Promise<void>

const contactService = new MongoService('contacts')
const bookingService = new MongoService('bookings')

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

/**
 * Build a staySummary entry from a stay document.
 * Only includes the fields that are denormalized into the booking.
 */
function buildStaySummary(stay: any): object {
  return {
    stayId: typeof stay._id === 'object' ? (stay._id.$oid ?? stay._id.toString()) : String(stay._id),
    hotelName: stay.hotelName ?? '',
    checkInDate: stay.checkInDate ?? '',
    checkOutDate: stay.checkOutDate ?? '',
    guestNames: stay.guestNames ?? [],
  }
}

const crossEntitySyncs: Partial<Record<EntityKey, CrossEntitySyncFn>> = {
  /**
   * When a stay is created, updated or deleted:
   * - Find the parent booking via bookingId
   * - Rebuild that booking's staySummaries entry for this stay
   * - Patch the booking (fire-and-forget style — we log but don't fail the stay response)
   */
  stays: async (op, savedDoc, previousDoc) => {
    try {
      // Determine which booking(s) are affected.
      // On delete the savedDoc is null, use previousDoc instead.
      const stayDoc = savedDoc ?? previousDoc
      if (!stayDoc) return

      const bookingId: string | undefined = stayDoc.bookingId
      if (!bookingId) return

      const booking = await bookingService.getById(bookingId)
      if (!booking) return

      const currentSummaries: any[] = (booking as any).staySummaries ?? []
      const stayId = typeof stayDoc._id === 'object'
        ? (stayDoc._id.$oid ?? stayDoc._id.toString())
        : String(stayDoc._id)

      let nextSummaries: any[]

      if (op === 'delete') {
        // Remove this stay's summary entry
        nextSummaries = currentSummaries.filter((s: any) => s.stayId !== stayId)
      } else {
        // Upsert: replace existing entry or append
        const existingIndex = currentSummaries.findIndex((s: any) => s.stayId === stayId)
        const summary = buildStaySummary(stayDoc)
        if (existingIndex >= 0) {
          nextSummaries = [...currentSummaries]
          nextSummaries[existingIndex] = summary
        } else {
          nextSummaries = [...currentSummaries, summary]
        }
      }

      await bookingService.update(bookingId, { staySummaries: nextSummaries } as any)
    } catch (err) {
      // Sync failure must not break the primary stay response
      console.error('[crossEntitySync] stays → bookings sync failed:', err)
    }
  },
}

export function makeEntityController(entityKey: EntityKey) {
  const entry = entityRegistry[entityKey];
  const service = new MongoService(entityKey);
  const entityName = entry.name;
  const denormalize = denormalizations[entityKey]
  const syncRelated = crossEntitySyncs[entityKey]

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
        if (syncRelated) await syncRelated('upsert', result, null);
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
        if (syncRelated) await syncRelated('upsert', result, null);
        res.json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },

    async delete(req: Request, res: Response, next: NextFunction) {
      try {
        const { id } = req.params;
        // Fetch before deleting so sync has the full document (including bookingId)
        const docBeforeDelete = syncRelated ? await service.getById(id) : null;
        const deleted = await service.delete(id);
        if (!deleted) throw new AppError(404, `${entityName} with ID ${id} not found`);
        if (syncRelated) await syncRelated('delete', null, docBeforeDelete);
        res.json({ success: true, data: { id } });
      } catch (error) {
        next(error);
      }
    },
  };
}
