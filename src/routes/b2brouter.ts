import { Router, raw as expressRaw, type Request, type Response } from 'express';
import { createHmac } from 'node:crypto';
import { getMongoClient } from '../services/mongoService.js';
import { ObjectId } from 'mongodb';
import { buildServerInvoicePayload, mapPayloadToB2BRouter, PAYMENT_TYPE_INCL_BK_INCL_CITYTAX, PAYMENT_TYPE_INCL_BK_EXCL_CITYTAX } from '../lib/invoicePayload.js';

export const b2brouterRouter = Router();

const B2B_BASE_URL = process.env.B2B_ROUTER_BASE_URL || 'https://api-staging.b2brouter.net';
const B2B_API_VERSION = '2026-03-02';

function getApiKey(): string {
  const key = process.env.B2B_ROUTER_API_KEY;
  if (!key) throw new Error('B2B_ROUTER_API_KEY is not configured');
  return key;
}

function getAccountId(): string {
  const id = process.env.B2B_ROUTER_ACCOUNT_ID;
  if (!id) throw new Error('B2B_ROUTER_ACCOUNT_ID is not configured');
  return id;
}

async function getNextInvoiceNumber(): Promise<string> {
  const client = getMongoClient();
  const db = client.db(process.env.MONGOCOLLECTION!);
  const year = new Date().getFullYear();
  const counterId = `invoice_number_${year}`;

  const result = await db.collection('counters').findOneAndUpdate(
    { _id: counterId as any },
    { $inc: { seq: 1 } } as any,
    { upsert: true, returnDocument: 'after' },
  );

  const seq = (result as any)?.seq ?? 1;
  return `INV-${year}-${String(seq).padStart(3, '0')}`;
}

// GET /api/v1/b2brouter/invoice-pdf/:b2bRouterId
// Proxies the PDF from B2B Router so the client never needs the API key
b2brouterRouter.get('/invoice-pdf/:b2bRouterId', async (req: Request, res: Response): Promise<void> => {
  const { b2bRouterId } = req.params;
  const headers = {
    'X-B2B-API-Key': getApiKey(),
    'X-B2B-API-Version': B2B_API_VERSION,
    'Accept': 'application/pdf',
  };
  // GET /invoices/{id}/as/pdf.invoice — the correct B2B Router PDF endpoint
  const endpoints = [
    `${B2B_BASE_URL}/invoices/${b2bRouterId}/as/pdf.invoice`,
  ];
  try {
    for (const apiUrl of endpoints) {
      console.log('[b2brouter] Proxying PDF:', apiUrl);
      const pdfRes = await fetch(apiUrl, { headers });
      if (pdfRes.ok) {
        res.setHeader('Content-Type', 'application/pdf');
        const buf = await pdfRes.arrayBuffer();
        res.send(Buffer.from(buf));
        return;
      }
      console.log('[b2brouter] PDF endpoint returned', pdfRes.status, '— trying next');
    }
    res.status(404).json({ error: 'PDF not available for this invoice' });
  } catch (err: any) {
    console.error('[b2brouter] PDF proxy error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

// POST /api/v1/b2brouter/send-invoice
b2brouterRouter.post('/send-invoice', async (req: Request, res: Response): Promise<void> => {
  console.log('[b2brouter] POST /send-invoice body:', JSON.stringify(req.body, null, 2));

  const { bookingId, stayIds, invoiceType = 'tour_operator_margin' } = req.body;

  if (!bookingId || !Array.isArray(stayIds) || stayIds.length === 0) {
    console.warn('[b2brouter] Validation failed — bookingId:', bookingId, 'stayIds:', stayIds);
    res.status(400).json({ error: 'bookingId and stayIds[] are required' });
    return;
  }

  try {
    const client = getMongoClient();
    const db = client.db(process.env.MONGOCOLLECTION!);

    // 1. Fetch booking
    console.log('[b2brouter] Fetching booking:', bookingId);
    const booking = await db.collection('bookings').findOne({ _id: new ObjectId(bookingId) });
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    // 2. Fetch company (if linked) and booker contact (for email)
    let company: Record<string, any> | null = null;
    if (booking.companyId) {
      try {
        company = await db.collection('companies').findOne({ _id: new ObjectId(booking.companyId) });
      } catch {
        // companyId may not be a valid ObjectId — ignore
      }
    }

    let bookerContact: Record<string, any> | null = null;
    if (booking.bookerId) {
      try {
        bookerContact = await db.collection('contacts').findOne({ _id: new ObjectId(booking.bookerId) });
      } catch {
        // bookerId may not be a valid ObjectId — ignore
      }
    }

    console.log('[b2brouter] Booking found:', booking?.confirmationNo, '| company:', booking?.companyName);
    console.log('[b2brouter] Fetching stays:', stayIds);

    // 3. Fetch selected stays
    const stayObjectIds = stayIds.map((id: string) => {
      try { return new ObjectId(id) } catch { return null }
    }).filter((id): id is ObjectId => id !== null);

    const stays = await db.collection('stays').find({ _id: { $in: stayObjectIds } }).toArray();
    if (stays.length === 0) {
      res.status(404).json({ error: 'No matching stays found' });
      return;
    }

    // 3b. Fetch hotels for selected stays (for city tax)
    const hotelIdStrings = [...new Set(stays.map((s: any) => s.hotelId).filter(Boolean))] as string[];
    const hotelObjectIds = hotelIdStrings.map((id: string) => { try { return new ObjectId(id) } catch { return null } }).filter((id): id is ObjectId => id !== null);
    const hotelsArr = hotelObjectIds.length > 0 ? await db.collection('hotels').find({ _id: { $in: hotelObjectIds } }).toArray() : [];
    const hotelsMap = new Map(hotelsArr.map((h: any) => [h._id.toString(), h]));

    // 3c. Fetch FX rates for any non-EUR currencies in stays
    const nonEurCurrencies = [...new Set([
      ...stays.map((s: any) => (s.roomCurrency as string | undefined)?.toUpperCase()).filter((c): c is string => !!c && c !== 'EUR'),
      ...stays.flatMap((s: any) => (Array.isArray(s.lineItems) ? s.lineItems : []).map((item: any) => (item.currency as string | undefined)?.toUpperCase()).filter((c: string | undefined): c is string => !!c && c !== 'EUR')),
    ])];

    let fxRates: Record<string, number> = {};
    if (nonEurCurrencies.length > 0) {
      try {
        const fxRes = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${nonEurCurrencies.join(',')}`);
        if (fxRes.ok) {
          const fxData: any = await fxRes.json();
          for (const [cur, rate] of Object.entries(fxData.rates as Record<string, number>)) {
            fxRates[cur] = Math.round((1 / rate) * 1e6) / 1e6;
          }
          console.log('[b2brouter] FX rates fetched:', fxRates);
        } else {
          console.warn('[b2brouter] FX rate fetch failed:', fxRes.status, '— amounts sent as-is');
        }
      } catch (fxErr) {
        console.warn('[b2brouter] FX rate fetch error:', fxErr, '— amounts sent as-is');
      }
    }

    // 3d. Build payload + validate
    const { payload: invoicePayload, issues } = buildServerInvoicePayload({
      booking,
      company,
      booker: bookerContact,
      selectedStays: stays,
      hotels: hotelsMap,
      fxRates,
      overrides: {
        reservationFee: req.body.reservationFee,
        extraInfo: req.body.extraInfo,
        contactName: req.body.contactName,
        contactEmail: req.body.contactEmail,
        contactAddress: req.body.contactAddress,
        contactPostalCode: req.body.contactPostalCode,
        contactCity: req.body.contactCity,
        contactCountry: req.body.contactCountry,
        date: req.body.date,
        dueDate: req.body.dueDate,
      },
    });

    const blockingIssues = issues.filter((i) => i.blocking);
    if (blockingIssues.length > 0) {
      res.status(400).json({ error: blockingIssues[0].message, issues });
      return;
    }

    // 4. Generate invoice number
    let invoiceNumber = await getNextInvoiceNumber();

    // 5. Map to B2B Router format
    const payload = mapPayloadToB2BRouter(invoicePayload, invoiceNumber);
    const total = invoicePayload.subtotal;

    console.log('[b2brouter] Overrides received:', JSON.stringify({ contactEmail: req.body.contactEmail, contactName: req.body.contactName, contactAddress: req.body.contactAddress, contactCity: req.body.contactCity, contactCountry: req.body.contactCountry, date: req.body.date, dueDate: req.body.dueDate }));
    console.log('[b2brouter] Resolved contact email in payload:', invoicePayload.contact.email);
    console.log('[b2brouter] Stays found:', stays.length, stays.map((s: any) => s.hotelName));
    console.log('[b2brouter] Invoice number:', invoiceNumber, '| total:', total);
    console.log('[b2brouter] Payload:', JSON.stringify(payload, null, 2));

    // 7. POST to B2B Router — retry once if number is already taken
    const apiUrl = `${B2B_BASE_URL}/accounts/${getAccountId()}/invoices`;

    async function postToB2B(currentPayload: typeof payload) {
      return fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-B2B-API-Key': getApiKey(),
          'X-B2B-API-Version': B2B_API_VERSION,
        },
        body: JSON.stringify(currentPayload),
      });
    }

    let b2bRes = await postToB2B(payload);
    console.log('[b2brouter] B2B Router response status:', b2bRes.status);

    // If number is already taken, get the next one and retry once
    if (b2bRes.status === 422) {
      const errBody: any = await b2bRes.json().catch(() => ({}));
      if (errBody?.error?.code === 'parameter_taken' && errBody?.error?.param === 'number') {
        console.warn('[b2brouter] Invoice number taken, retrying with next number...');
        invoiceNumber = await getNextInvoiceNumber();
        payload.invoice.number = invoiceNumber;
        console.log('[b2brouter] Retrying with:', invoiceNumber);
        b2bRes = await postToB2B(payload);
        console.log('[b2brouter] Retry response status:', b2bRes.status);
      } else {
        const errorText = JSON.stringify(errBody);
        console.error('[b2brouter] API error 422:', errorText);
        res.status(502).json({ error: `B2B Router error: 422`, details: errorText });
        return;
      }
    }

    if (!b2bRes.ok) {
      const errorBody = await b2bRes.text();
      console.error('[b2brouter] API error:', b2bRes.status, errorBody);
      res.status(502).json({ error: `B2B Router error: ${b2bRes.status}`, details: errorBody });
      return;
    }

    const b2bData: any = await b2bRes.json();
    console.log('[b2brouter] B2B Router success:', JSON.stringify(b2bData, null, 2));
    const b2bRouterId = b2bData?.id || b2bData?.invoice?.id;
    const b2bStatus = b2bData?.state || b2bData?.invoice?.state || 'new';
    const b2bErrors: string[] = b2bData?.invoice?.errors ?? [];
    if (b2bErrors.length > 0) {
      console.warn('[b2brouter] Invoice created with errors:', b2bErrors);
    }

    // 8. Save invoice to MongoDB
    const sentAt = new Date().toISOString();

    // Collect only fields that were manually overridden (non-undefined in req.body)
    const overrideKeys = ['reservationFee', 'extraInfo', 'contactName', 'contactEmail', 'contactAddress', 'contactPostalCode', 'contactCity', 'contactCountry', 'date', 'dueDate'] as const;
    const manualOverrides: Record<string, unknown> = {};
    for (const key of overrideKeys) {
      if (req.body[key] !== undefined) manualOverrides[key] = req.body[key];
    }

    const invoiceDoc = {
      invoiceNumber,
      b2bRouterId,
      bookingId,
      bookingConfirmationNo: booking.confirmationNo || '',
      companyId: booking.companyId || null,
      companyName: booking.companyName || company?.name || '',
      bookerName: booking.bookerName || '',
      costCentre: booking.costCentre || '',
      stayIds,
      status: b2bErrors.length > 0 ? 'error' : b2bStatus,
      errors: b2bErrors.length > 0 ? b2bErrors : undefined,
      total,
      currency: 'EUR',
      invoiceType,
      ...(Object.keys(manualOverrides).length > 0 ? { manualOverrides } : {}),
      sentAt,
      createdAt: sentAt,
      updatedAt: sentAt,
    };

    const insertResult = await db.collection('invoices').insertOne(invoiceDoc);
    const invoiceId = insertResult.insertedId.toString();

    console.log(`[b2brouter] Invoice ${invoiceNumber} created, B2B Router ID: ${b2bRouterId}`);

    // 9. Stamp city tax on each selected stay from the hotel's current city tax value (non-fatal)
    let cityTaxStampedCount = 0;
    if (b2bErrors.length === 0) {
      try {
        for (const stay of stays) {
          const hotel = stay.hotelId ? hotelsMap.get(new ObjectId(stay.hotelId).toString()) : null;
          if (!hotel) continue;

          // Skip stamping if city tax is already included in the rate
          if (stay.paymentType === PAYMENT_TYPE_INCL_BK_INCL_CITYTAX) continue;

          // Compute nights for multiplication
          const nights = (stay.checkInDate && stay.checkOutDate)
            ? Math.round((new Date(stay.checkOutDate).getTime() - new Date(stay.checkInDate).getTime()) / 86400000)
            : 1;

          let cityTaxAmount = 0;
          let cityTaxCurrency = 'EUR';

          // Flat and percentage are additive — both charged if both set
          let flatTaxAmount = 0;
          if (hotel.cityTaxAmount != null) {
            if (typeof hotel.cityTaxAmount === 'object' && 'amount' in hotel.cityTaxAmount) {
              flatTaxAmount = parseFloat(hotel.cityTaxAmount.amount) || 0;
              if (flatTaxAmount > 0) cityTaxCurrency = hotel.cityTaxAmount.currency || 'EUR';
            } else {
              flatTaxAmount = parseFloat(hotel.cityTaxAmount) || 0;
            }
          }
          if (flatTaxAmount > 0) {
            cityTaxAmount += Math.round(flatTaxAmount * nights * 100) / 100;
          }

          if (hotel.cityTaxPercent != null) {
            const percent = parseFloat(hotel.cityTaxPercent) || 0;
            if (percent > 0) {
              const roomPrice = stay.roomPrice;
              let roomAmount = 0;
              if (typeof roomPrice === 'object' && roomPrice !== null && 'amount' in roomPrice) {
                roomAmount = parseFloat(roomPrice.amount) || 0;
                if (flatTaxAmount === 0) cityTaxCurrency = roomPrice.currency || 'EUR';
              } else if (roomPrice != null) {
                roomAmount = parseFloat(roomPrice) || 0;
              }
              // Deduct gross breakfast rate from tax base for INCL_BK_EXCL_CITYTAX stays
              let taxBase = roomAmount;
              if (stay.paymentType === PAYMENT_TYPE_INCL_BK_EXCL_CITYTAX && hotel.grossBreakfastRate != null) {
                const grossBreakfastRate = typeof hotel.grossBreakfastRate === 'object' && 'amount' in hotel.grossBreakfastRate
                  ? parseFloat(hotel.grossBreakfastRate.amount) || 0
                  : parseFloat(hotel.grossBreakfastRate) || 0;
                taxBase = Math.max(0, roomAmount - grossBreakfastRate);
              }
              cityTaxAmount += Math.round((taxBase * percent / 100) * nights * 100) / 100;
            }
          }
          cityTaxAmount = Math.round(cityTaxAmount * 100) / 100;

          if (cityTaxAmount === 0) continue;

          await db.collection('stays').updateOne(
            { _id: stay._id },
            { $set: {
              cityTaxStamped: { amount: cityTaxAmount, currency: cityTaxCurrency },
              cityTaxStampedAt: sentAt,
              cityTaxInvoiceNumber: invoiceNumber,
              updatedAt: sentAt,
            }},
          );
          cityTaxStampedCount++;
        }
        console.log(`[b2brouter] City tax stamped on ${cityTaxStampedCount} stay(s)`);
      } catch (stampErr) {
        console.error('[b2brouter] City tax stamp error:', stampErr);
      }
    }

    res.json({ invoiceId, invoiceNumber, b2bRouterId, status: invoiceDoc.status, cityTaxStampedCount, errors: b2bErrors.length > 0 ? b2bErrors : undefined });
  } catch (err: any) {
    console.error('[b2brouter] send-invoice error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

// POST /api/v1/b2brouter/sync-statuses
// Fetches all invoices from B2B Router and updates changed statuses in MongoDB
b2brouterRouter.post('/sync-statuses', async (_req: Request, res: Response): Promise<void> => {
  console.log('[b2brouter] POST /sync-statuses');
  try {
    const client = getMongoClient();
    const db = client.db(process.env.MONGOCOLLECTION!);

    // Fetch all invoices from B2B Router (up to 100)
    const apiUrl = `${B2B_BASE_URL}/accounts/${getAccountId()}/invoices?limit=500`;
    const b2bRes = await fetch(apiUrl, {
      headers: {
        'X-B2B-API-Key': getApiKey(),
        'X-B2B-API-Version': B2B_API_VERSION,
      },
    });

    if (!b2bRes.ok) {
      const err = await b2bRes.text();
      console.error('[b2brouter] sync-statuses list error:', b2bRes.status, err);
      res.status(502).json({ error: `B2B Router error: ${b2bRes.status}` });
      return;
    }

    const b2bData: any = await b2bRes.json();
    const b2bInvoices: Array<{ id: number | string; state: string; errors?: string[] }> =
      b2bData?.invoices ?? b2bData ?? [];

    console.log('[b2brouter] sync-statuses: fetched', b2bInvoices.length, 'invoices from B2B Router');

    let synced = 0;
    const checked = b2bInvoices.length;

    for (const inv of b2bInvoices) {
      const b2bRouterId = String(inv.id);
      const newStatus = inv.state;
      if (!b2bRouterId || !newStatus) continue;

      // Only update if status actually changed
      const result = await db.collection('invoices').updateOne(
        { b2bRouterId: { $in: [b2bRouterId, Number(b2bRouterId)] }, status: { $ne: newStatus } },
        { $set: { status: newStatus, updatedAt: new Date().toISOString() } },
      );
      if (result.modifiedCount > 0) {
        console.log(`[b2brouter] sync-statuses: updated ${b2bRouterId} → ${newStatus}`);
        synced++;
      }
    }

    res.json({ synced, checked });
  } catch (err: any) {
    console.error('[b2brouter] sync-statuses error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

// Webhook router — mounted at /webhooks, outside the API prefix + auth middleware
// Uses raw body parser for HMAC verification
export const b2brouterWebhookRouter = Router();

b2brouterWebhookRouter.post('/b2brouter', expressRaw({ type: 'application/json' }), async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['x-b2brouter-signature'] as string | undefined;
  const webhookSecret = process.env.B2B_ROUTER_WEBHOOK_SECRET;

  // Verify HMAC signature if secret is configured
  if (webhookSecret && signature) {
    // Format: t={timestamp},s={hmac}
    const parts = Object.fromEntries(
      signature.split(',').map((p) => {
        const idx = p.indexOf('=');
        return [p.slice(0, idx), p.slice(idx + 1)] as [string, string];
      })
    );
    const timestamp = parts['t'];
    const receivedHmac = parts['s'];

    if (timestamp && receivedHmac) {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
      const expected = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      if (expected !== receivedHmac) {
        console.warn('[b2brouter webhook] Invalid signature — ignoring');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }
  }

  let event: any;
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    event = JSON.parse(rawBody);
  } catch {
    event = req.body;
  }

  // Respond 200 immediately so B2B Router doesn't retry
  res.json({ received: true });

  // Handle state_change events asynchronously
  if (event?.code === 'issued_invoice.state_change') {
    try {
      const b2bRouterId = event?.data?.invoice_id;
      const newStatus = event?.data?.state;

      if (b2bRouterId && newStatus) {
        const client = getMongoClient();
        const db = client.db(process.env.MONGOCOLLECTION!);
        const updateResult = await db.collection('invoices').updateOne(
          { b2bRouterId },
          { $set: { status: newStatus, updatedAt: new Date().toISOString() } },
        );
        console.log(`[b2brouter webhook] Updated invoice ${b2bRouterId} → ${newStatus} (matched: ${updateResult.matchedCount})`);
      }
    } catch (err) {
      console.error('[b2brouter webhook] Failed to update invoice status:', err);
    }
  }
});
