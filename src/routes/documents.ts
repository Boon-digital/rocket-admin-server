import { Router, type Request, type Response } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getMongoClient } from '../services/mongoService.js';
import { requireAuth } from '../middleware/auth.js';

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

// GET /api/v1/documents — aggregate all documents from bookings
documentsRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const client = getMongoClient();
    const db = client.db(process.env.MONGOCOLLECTION!);
    const collection = db.collection('bookings');

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const pageSize = Math.min(1000, Math.max(1, parseInt(String(req.query.pageSize ?? '100'), 10)));
    const search = String(req.query.search ?? '').toLowerCase().trim();

    // Fetch all bookings that have documents
    const bookings = await collection
      .find(
        { documents: { $exists: true, $not: { $size: 0 } } },
        { projection: { _id: 1, confirmationNo: 1, documents: 1 } }
      )
      .toArray();

    // Flatten documents[] across all bookings into rows
    let rows: Array<{
      id: string
      name: string
      size: number
      type: string
      url: string
      uploadedAt: string
      uploadedBy?: string
      bookingId: string
      bookingConfirmationNo: string
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
          bookingId,
          bookingConfirmationNo: confirmationNo,
        });
      }
    }

    // Filter by search (filename or booking ref)
    if (search) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          r.bookingConfirmationNo.toLowerCase().includes(search)
      );
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

// GET /api/v1/documents/presign?key=<url-or-key>
documentsRouter.get('/presign', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { key: rawKey } = req.query;
    if (!rawKey || typeof rawKey !== 'string') {
      res.status(400).json({ error: 'Missing key query parameter' });
      return;
    }

    if (isLocalMode()) {
      // In local mode just return the URL as-is
      res.json({ url: rawKey });
      return;
    }

    // Extract the object key from a full URL or use as-is
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
