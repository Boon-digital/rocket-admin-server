import { Router, type Request, type Response } from 'express';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireAuth } from '../middleware/auth.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const uploadRouter = Router();

const LOCAL_UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../uploads'
);
const LOCAL_UPLOADS_URL_PREFIX = '/uploads';

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

function getPublicUrl(key: string): string {
  const bucket = process.env.R2_BUCKET!;
  const accountId = process.env.R2_ACCOUNT_ID!;
  // Use custom public domain if set, otherwise use the r2.dev dev URL
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${key}`;
}

// ─── Parse multipart/form-data — extract the first file part ─────────────────
function parseMultipart(
  body: Buffer,
  boundary: string
): { filename: string; mimeType: string; fileBuffer: Buffer } | null {
  const boundaryBuf = Buffer.from('--' + boundary);
  let start = 0;

  while (start < body.length) {
    const idx = body.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    const partStart = idx + boundaryBuf.length;
    const nextIdx = body.indexOf(boundaryBuf, partStart);
    if (nextIdx === -1) break;
    const part = body.slice(partStart, nextIdx);

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = nextIdx; continue; }

    const headerStr = part.slice(0, headerEnd).toString('utf8');
    if (!headerStr.includes('filename=')) { start = nextIdx; continue; }

    const nameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    let fileData = part.slice(headerEnd + 4);
    if (fileData.slice(-2).toString() === '\r\n') fileData = fileData.slice(0, -2);

    return {
      filename: nameMatch?.[1] ?? 'upload',
      mimeType: ctMatch?.[1].trim() ?? 'application/octet-stream',
      fileBuffer: fileData,
    };
  }

  return null;
}

// ─── POST /api/v1/upload ──────────────────────────────────────────────────────
uploadRouter.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      res.status(400).json({ error: 'Expected multipart/form-data' });
      return;
    }

    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      res.status(400).json({ error: 'Missing multipart boundary' });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    const parsed = parseMultipart(body, boundaryMatch[1]);
    if (!parsed) {
      res.status(400).json({ error: 'No file found in upload' });
      return;
    }

    const { filename, mimeType, fileBuffer } = parsed;

    if (isLocalMode()) {
      // ── Local dev: write to disk ──────────────────────────────────────────
      await fs.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
      const unique = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await fs.writeFile(path.join(LOCAL_UPLOADS_DIR, unique), fileBuffer);
      const port = process.env.PORT || 3001;
      res.json({
        url: `http://localhost:${port}${LOCAL_UPLOADS_URL_PREFIX}/${unique}`,
        pathname: unique,
        contentType: mimeType,
        size: fileBuffer.length,
      });
    } else {
      // ── Production: Cloudflare R2 ─────────────────────────────────────────
      const key = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const client = getR2Client();
      await client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
      }));
      const url = getPublicUrl(key);
      res.json({
        url,
        pathname: key,
        contentType: mimeType,
        size: fileBuffer.length,
      });
    }
  } catch (err) {
    console.error('[upload] POST error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ─── DELETE /api/v1/upload?url=... ────────────────────────────────────────────
uploadRouter.delete('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Missing url query parameter' });
      return;
    }

    if (isLocalMode()) {
      // ── Local dev: delete from disk ───────────────────────────────────────
      const filename = path.basename(new URL(url).pathname);
      await fs.unlink(path.join(LOCAL_UPLOADS_DIR, filename)).catch(() => {/* already gone */});
    } else {
      // ── Production: Cloudflare R2 ─────────────────────────────────────────
      const key = new URL(url).pathname.replace(/^\//, '');
      const client = getR2Client();
      await client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
      }));
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[upload] DELETE error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});
