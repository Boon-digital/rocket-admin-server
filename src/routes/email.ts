import { Router, type Request, type Response } from 'express';
import { Resend } from 'resend';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMongoClient } from '../services/mongoService.js';

const LOCAL_UPLOADS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../uploads'
);

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
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL}/${key}`;
  }
  return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${key}`;
}

export const emailRouter = Router();

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

function buildEmailHtml(bookerName: string, _confirmationNo: string, staySummaries: any[]): string {
  const stayRows = staySummaries
    .map((s) => {
      const guestNames =
        s.guestNames && s.guestNames.length > 0 ? s.guestNames.join(', ') : 'N/A';
      return `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${s.hotelName || 'N/A'}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${guestNames}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${formatDate(s.checkInDate)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${formatDate(s.checkOutDate)}</td>
        </tr>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: Arial, sans-serif; color: #000000; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p>Dear ${bookerName},</p>

  <p>Thank you for making your reservation with us. Please find attached your booking confirmation for the following details:</p>

  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <thead>
      <tr style="background-color: #f3f4f6;">
        <th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid #d1d5db;">Hotel</th>
        <th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid #d1d5db;">Guest</th>
        <th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid #d1d5db;">Check-in</th>
        <th style="padding: 8px 12px; text-align: left; border-bottom: 2px solid #d1d5db;">Check-out</th>
      </tr>
    </thead>
    <tbody>
      ${stayRows}
    </tbody>
  </table>

  <p>Should you have any questions or need to make any changes, please do not hesitate to contact us directly.</p>

  <p>We hope you and/or your guest(s) have a pleasant stay.</p>

  <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
    Corporate Meeting Partner<br />
    <a href="mailto:donotreply@corporatemeetingpartner.com" style="color: #6b7280;">donotreply@corporatemeetingpartner.com</a>
  </p>
</body>
</html>`;
}

// POST /api/v1/email/send-confirmation
emailRouter.post('/send-confirmation', async (req: Request, res: Response): Promise<void> => {
  const {
    bookingId,
    to,
    bookerName,
    confirmationNo,
    staySummaries,
    pdfBase64,
    pdfFilename,
    sentBy,
  } = req.body;

  if (!to || !bookingId) {
    res.status(400).json({ error: 'Missing required fields: to, bookingId' });
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    res.status(500).json({ error: 'RESEND_API_KEY is not configured' });
    return;
  }

  const resend = new Resend(resendApiKey);
  const client = getMongoClient();
  const db = client.db(process.env.MONGOCOLLECTION!);
  const emailLogsCollection = db.collection('email_logs');

  // ─── TEST GUARD ────────────────────────────────────────────────────────────
  // During testing, override the recipient so no real bookers receive emails.
  // Remove this block (and the TEST_EMAIL_OVERRIDE env var) when going live.
  const testOverride = process.env.TEST_EMAIL_OVERRIDE;
  const effectiveTo = testOverride ?? to;
  if (testOverride) {
    console.log(`[email] TEST_EMAIL_OVERRIDE active — redirecting ${to} → ${testOverride}`);
  }
  // ───────────────────────────────────────────────────────────────────────────

  const subject = `Your hotel confirmation: ${confirmationNo ?? ''}`;
  const html = buildEmailHtml(bookerName ?? 'Guest', confirmationNo ?? '', staySummaries ?? []);

  let status: 'sent' | 'failed' = 'sent';
  let errorMessage: string | undefined;
  let resendId: string | undefined;

  try {
    const attachments = [];
    if (pdfBase64 && pdfFilename) {
      attachments.push({
        filename: pdfFilename,
        content: pdfBase64,
      });
    }

    const result = await resend.emails.send({
      from: 'Corporate Meeting Partner <donotreply@develop-digital.nl>',
      to: [effectiveTo],
      bcc: ['donotreply@develop-digital.nl'],
      subject,
      html,
      attachments,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }

    resendId = result.data?.id;
  } catch (err: any) {
    status = 'failed';
    errorMessage = err?.message ?? 'Unknown error';
    console.error('[email] Send failed:', errorMessage);
  }

  // Save log entry regardless of outcome
  const logEntry = {
    bookingId,
    confirmationNo: confirmationNo ?? '',
    to,
    sentBy: sentBy ?? req.session?.userEmail ?? 'unknown',
    sentAt: new Date(),
    status,
    html,
    pdfFilename: pdfFilename ?? null,
    ...(errorMessage ? { errorMessage } : {}),
    ...(resendId ? { resendId } : {}),
  };

  const insertResult = await emailLogsCollection.insertOne(logEntry);
  const emailLogId = insertResult.insertedId.toString();

  if (status === 'failed') {
    res.status(500).json({ success: false, emailLogId, error: errorMessage });
    return;
  }

  // Patch booking with sent timestamp (and optionally save PDF to documents)
  try {
    const { ObjectId } = await import('mongodb');
    const bookingsCollection = db.collection('bookings');
    const bookingObjectId = new ObjectId(bookingId);

    if (pdfBase64 && pdfFilename) {
      console.log('[email] Saving PDF to documents, local mode:', isLocalMode());
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      const sanitized = pdfFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `${Date.now()}-${sanitized}`;
      let uploadedUrl: string;

      if (isLocalMode()) {
        await fs.mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
        await fs.writeFile(path.join(LOCAL_UPLOADS_DIR, key), pdfBuffer);
        const port = process.env.PORT || 3001;
        uploadedUrl = `http://localhost:${port}/uploads/${key}`;
        console.log('[email] PDF written to disk:', key);
      } else {
        const client = getR2Client();
        await client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET!,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        }));
        uploadedUrl = getPublicUrl(key);
        console.log('[email] PDF uploaded to R2:', key);
      }

      const newDoc = {
        id: key,
        name: pdfFilename,
        size: pdfBuffer.length,
        type: 'application/pdf',
        url: uploadedUrl,
        uploadedAt: logEntry.sentAt.toISOString(),
        uploadedBy: logEntry.sentBy,
      };

      const updateResult = await bookingsCollection.updateOne(
        { _id: bookingObjectId },
        {
          $set: { confirmationSent: true, confirmationSentAt: logEntry.sentAt },
          $push: { documents: newDoc },
        } as any,
      );
      console.log('[email] Booking patch result:', updateResult.matchedCount, 'matched,', updateResult.modifiedCount, 'modified');
    } else {
      console.log('[email] No PDF provided, skipping document save (pdfBase64:', !!pdfBase64, 'pdfFilename:', !!pdfFilename, ')');
      await bookingsCollection.updateOne(
        { _id: bookingObjectId },
        { $set: { confirmationSent: true, confirmationSentAt: logEntry.sentAt } },
      );
    }
  } catch (err) {
    console.error('[email] Failed to patch booking confirmationSentAt:', err);
  }

  res.json({ success: true, emailLogId });
});
