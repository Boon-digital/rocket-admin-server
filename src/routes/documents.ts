import { Router, type Request, type Response } from 'express';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectId } from 'mongodb';
import { getMongoClient } from '../services/mongoService.js';
import { requireAuth } from '../middleware/auth.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../uploads'
);

export const documentsRouter = Router();

function isLocalMode(): boolean {
  return !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY;
}

function getR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

// GET /api/v1/documents — aggregate all documents from bookings and stays
documentsRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const client = getMongoClient();
    const db = client.db(process.env.MONGOCOLLECTION!);

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const pageSize = Math.min(1000, Math.max(1, parseInt(String(req.query.pageSize ?? '100'), 10)));
    const search = String(req.query.search ?? '').toLowerCase().trim();

    // Fetch all bookings that have documents
    const bookings = await db.collection('bookings')
      .find(
        { documents: { $exists: true, $not: { $size: 0 } } },
        { projection: { _id: 1, confirmationNo: 1, documents: 1 } }
      )
      .toArray();

    // Flatten documents[] across all bookings and stays into rows
    let rows: Array<{
      id: string
      name: string
      size: number
      type: string
      url: string
      uploadedAt: string
      uploadedBy?: string
      source: 'booking' | 'stay' | 'hotel' | 'company'
      bookingId?: string
      bookingConfirmationNo?: string
      stayId?: string
      hotelName?: string
      hotelConfirmationNo?: string
      hotelId?: string
      companyId?: string
      companyName?: string
    }> = [];

    for (const booking of bookings) {
      const bookingId = String(booking._id);
      const confirmationNo = booking.confirmationNo ?? '';
      const docs: any[] = booking.documents ?? [];

      for (const doc of docs) {
        if (!doc || !doc.url) continue;
        rows.push({
          id: doc.id ?? doc._id ?? doc.url,
          name: doc.name ?? '',
          size: doc.size ?? 0,
          type: doc.type ?? '',
          url: doc.url ?? '',
          uploadedAt: doc.uploadedAt ?? '',
          uploadedBy: doc.uploadedBy,
          source: 'booking',
          bookingId,
          bookingConfirmationNo: confirmationNo,
        });
      }
    }

    // Fetch all stays that have documents
    const stays = await db.collection('stays')
      .find(
        { documents: { $exists: true, $not: { $size: 0 } } },
        { projection: { _id: 1, hotelName: 1, hotelConfirmationNo: 1, documents: 1 } }
      )
      .toArray();

    for (const stay of stays) {
      const stayId = String(stay._id);
      const docs: any[] = stay.documents ?? [];

      for (const doc of docs) {
        if (!doc || !doc.url) continue;
        rows.push({
          id: doc.id ?? doc._id ?? doc.url,
          name: doc.name ?? '',
          size: doc.size ?? 0,
          type: doc.type ?? '',
          url: doc.url ?? '',
          uploadedAt: doc.uploadedAt ?? '',
          uploadedBy: doc.uploadedBy,
          source: 'stay',
          stayId,
          hotelName: stay.hotelName ?? '',
          hotelConfirmationNo: stay.hotelConfirmationNo ?? '',
        });
      }
    }

    // Fetch all hotels that have documents
    const hotels = await db.collection('hotels')
      .find(
        { documents: { $exists: true, $not: { $size: 0 } } },
        { projection: { _id: 1, name: 1, documents: 1 } }
      ).toArray();

    for (const hotel of hotels) {
      const hotelId = String(hotel._id);
      for (const doc of (hotel.documents ?? []) as any[]) {
        if (!doc?.url) continue;
        rows.push({
          id: doc.id ?? doc._id ?? doc.url,
          name: doc.name ?? '',
          size: doc.size ?? 0,
          type: doc.type ?? '',
          url: doc.url,
          uploadedAt: doc.uploadedAt ?? '',
          uploadedBy: doc.uploadedBy,
          source: 'hotel',
          hotelId,
          hotelName: hotel.name ?? '',
        });
      }
    }

    // Fetch all companies that have documents
    const companies = await db.collection('companies')
      .find(
        { documents: { $exists: true, $not: { $size: 0 } } },
        { projection: { _id: 1, name: 1, documents: 1 } }
      ).toArray();

    for (const company of companies) {
      const companyId = String(company._id);
      for (const doc of (company.documents ?? []) as any[]) {
        if (!doc?.url) continue;
        rows.push({
          id: doc.id ?? doc._id ?? doc.url,
          name: doc.name ?? '',
          size: doc.size ?? 0,
          type: doc.type ?? '',
          url: doc.url,
          uploadedAt: doc.uploadedAt ?? '',
          uploadedBy: doc.uploadedBy,
          source: 'company',
          companyId,
          companyName: company.name ?? '',
        });
      }
    }

    // Filter by search (filename, booking ref, or hotel name/conf no)
    if (search) {
      rows = rows.filter((r) => {
        if (r.name.toLowerCase().includes(search)) return true;
        if (r.source === 'booking') {
          return (r.bookingConfirmationNo ?? '').toLowerCase().includes(search);
        } else if (r.source === 'stay') {
          return (
            (r.hotelName ?? '').toLowerCase().includes(search) ||
            (r.hotelConfirmationNo ?? '').toLowerCase().includes(search)
          );
        } else if (r.source === 'hotel') {
          return (r.hotelName ?? '').toLowerCase().includes(search);
        } else if (r.source === 'company') {
          return (r.companyName ?? '').toLowerCase().includes(search);
        }
        return false;
      });
    }

    // Sort by uploadedAt desc
    rows.sort((a, b) => {
      const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return tb - ta;
    });

    const totalItems = rows.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (page - 1) * pageSize;
    const data = rows.slice(skip, skip + pageSize);

    res.json({ data, pagination: { page, pageSize, totalItems, totalPages } });
  } catch (err) {
    console.error('[documents] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// DELETE /api/v1/documents — atomically remove file from storage + $pull from MongoDB
documentsRouter.delete('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { docId, docUrl, entityType, entityId } = req.body as {
      docId?: string;
      docUrl?: string;
      entityType?: string;
      entityId?: string;
    };

    if (!docId || !docUrl || !entityType || !entityId) {
      res.status(400).json({ error: 'Missing required fields: docId, docUrl, entityType, entityId' });
      return;
    }
    if (entityType !== 'booking' && entityType !== 'stay' && entityType !== 'hotel' && entityType !== 'company') {
      res.status(400).json({ error: 'entityType must be "booking", "stay", "hotel", or "company"' });
      return;
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(entityId);
    } catch {
      res.status(400).json({ error: 'Invalid entityId' });
      return;
    }

    // Delete from storage (fire-and-forget errors — continue to MongoDB cleanup)
    try {
      if (isLocalMode()) {
        const filename = path.basename(new URL(docUrl).pathname);
        await fs.unlink(path.join(LOCAL_UPLOADS_DIR, filename)).catch(() => {/* already gone */});
      } else {
        const key = new URL(docUrl).pathname.replace(/^\//, '');
        const client = getR2Client();
        await client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET!,
          Key: key,
        }));
      }
    } catch (err) {
      console.error('[documents] DELETE storage error (continuing):', err);
    }

    // Atomically remove the document entry from MongoDB
    const collectionName =
      entityType === 'stay' ? 'stays' :
      entityType === 'hotel' ? 'hotels' :
      entityType === 'company' ? 'companies' :
      'bookings';
    const db = getMongoClient().db(process.env.MONGOCOLLECTION!);
    const result = await db.collection(collectionName).updateOne(
      { _id: objectId },
      { $pull: { documents: { id: docId } } } as any
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[documents] DELETE error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// GET /api/v1/documents/presign?key=<url-or-key>
documentsRouter.get('/presign', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { key: rawKey } = req.query;
    if (!rawKey || typeof rawKey !== 'string') {
      res.status(400).json({ error: 'Missing key query parameter' });
      return;
    }

    // If R2 credentials aren't configured, or the URL is already a public URL
    // (served via R2_PUBLIC_URL custom domain or localhost), return it as-is
    if (isLocalMode()) {
      res.json({ url: rawKey });
      return;
    }

    const publicBase = process.env.R2_PUBLIC_URL;
    if (publicBase && rawKey.startsWith(publicBase)) {
      res.json({ url: rawKey });
      return;
    }

    // Extract the object key from a full private R2 URL or use as-is
    let objectKey = rawKey;
    try {
      const parsed = new URL(rawKey);
      objectKey = parsed.pathname.replace(/^\//, '');
    } catch {
      // rawKey is already a bare key
    }

    const s3 = getR2Client();
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: objectKey,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    res.json({ url });
  } catch (err) {
    console.error('[documents] presign error:', err);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});
