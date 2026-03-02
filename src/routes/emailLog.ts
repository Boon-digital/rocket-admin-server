import { Router, type Request, type Response } from 'express';
import { getMongoClient } from '../services/mongoService.js';

export const emailLogRouter = Router();

// GET /api/v1/email/logs
emailLogRouter.get('/logs', async (req: Request, res: Response): Promise<void> => {
  const client = getMongoClient();
  const db = client.db(process.env.MONGOCOLLECTION!);
  const collection = db.collection('email_logs');

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '50'), 10)));

  const totalItems = await collection.countDocuments();
  const totalPages = Math.ceil(totalItems / pageSize);
  const skip = (page - 1) * pageSize;

  const data = await collection
    .find()
    .sort({ sentAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .toArray();

  res.json({
    data,
    pagination: { page, pageSize, totalItems, totalPages },
  });
});

// GET /api/v1/email/logs/:id
emailLogRouter.get('/logs/:id', async (req: Request, res: Response): Promise<void> => {
  const { ObjectId } = await import('mongodb');
  const client = getMongoClient();
  const db = client.db(process.env.MONGOCOLLECTION!);
  const doc = await db.collection('email_logs').findOne({ _id: new ObjectId(req.params.id) });
  if (!doc) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(doc);
});
