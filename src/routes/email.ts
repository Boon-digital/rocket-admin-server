import { Router, type Request, type Response } from 'express';
import { Resend } from 'resend';
import { getMongoClient } from '../services/mongoService.js';

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
<body style="font-family: Arial, sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 24px;">
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
      to: [to],
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
    ...(errorMessage ? { errorMessage } : {}),
    ...(resendId ? { resendId } : {}),
  };

  const insertResult = await emailLogsCollection.insertOne(logEntry);
  const emailLogId = insertResult.insertedId.toString();

  if (status === 'failed') {
    res.status(500).json({ success: false, emailLogId, error: errorMessage });
    return;
  }

  res.json({ success: true, emailLogId });
});
