// Server-side invoice payload builder.
// Structurally mirrors config/invoice-payload.ts from the miceflow-admin monorepo,
// but operates on Record<string, any> MongoDB documents (the server has no dependency
// on @boon-digital/rocket-admin-config).
// Keep in sync with config/invoice-payload.ts when changing shared logic.

export const PAYMENT_TYPE_INCL_BK_EXCL_CITYTAX = 'Above rate is including breakfast and excluding Citytax'
export const PAYMENT_TYPE_INCL_BK_INCL_CITYTAX = 'Above rate is including breakfast and including Citytax'
export const PAYMENT_TYPE_INCL_BK_EXCL_ALL_TAX = 'Above rate is including breakfast and excluding all taxes and fees'
export const PAYMENT_TYPE_EXCL_BK_EXCL_ALL_TAX = 'Above rate is excluding breakfast, all taxes, and fees'

export interface InvoiceContact {
  name: string
  address: string
  postalCode: string
  city: string
  country: string
  email: string
}

export interface InvoiceLine {
  type: 'room' | 'city_tax' | 'reservation_fee' | 'line_item'
  description: string
  notes?: string
  quantity?: number   // number of nights (room/city_tax); undefined for reservation_fee
  unitPrice?: number  // per-night price; price = unitPrice × quantity
  price: number       // total (unitPrice × quantity, or flat for reservation_fee)
  deliveryCountry: string
  taxCategory: 'S' | 'E'
  taxPercent: number
  // FX metadata — set when the original amount was converted from a non-EUR currency
  originalCurrency?: string  // e.g. 'GBP'
  fxRate?: number            // 1 originalCurrency = fxRate EUR
}

export interface InvoicePayload {
  contact: InvoiceContact
  confirmationEntity: string
  senderIban: string
  senderBic: string
  date: string
  dueDate: string
  reservationFee: number
  extraInfo: string  // intro + TOMS + bank details → B2B Router extra_info (renders with \n)
  bookingConfirmationNo?: string  // → file_reference
  bookerName?: string             // → customer_contact_person
  costCentre?: string             // → buyer_accounting_reference
  lines: InvoiceLine[]
  subtotal: number
}

export interface InvoiceValidationIssue {
  field: string
  fieldLabel: string
  message: string
  blocking: boolean
}

export interface BuildServerInvoicePayloadInput {
  booking: Record<string, any>
  company: Record<string, any> | null
  booker: Record<string, any> | null
  selectedStays: Record<string, any>[]
  hotels?: Map<string, Record<string, any>>
  // FX rates: { GBP: 1.1234 } means 1 GBP = 1.1234 EUR. Amounts in EUR stay as-is.
  fxRates?: Record<string, number>
  overrides?: {
    reservationFee?: number
    extraInfo?: string
    // Contact overrides (send-only, never saved to DB)
    contactName?: string
    contactEmail?: string
    contactAddress?: string
    contactPostalCode?: string
    contactCity?: string
    contactCountry?: string
    // Invoice term overrides
    date?: string
    dueDate?: string
  }
}

export interface BuildServerInvoicePayloadResult {
  payload: InvoicePayload
  issues: InvoiceValidationIssue[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractAmount(val: unknown): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'object' && val !== null && 'amount' in (val as any)) {
    return parseFloat((val as any).amount) || 0
  }
  return parseFloat(val as string) || 0
}

function applyFx(amount: number, currency: string | undefined, fxRates?: Record<string, number>): { eur: number; originalCurrency?: string; fxRate?: number } {
  const cur = (currency || 'EUR').toUpperCase()
  if (cur === 'EUR' || !fxRates || !fxRates[cur]) return { eur: amount }
  const rate = fxRates[cur]
  return { eur: Math.round(amount * rate * 100) / 100, originalCurrency: cur, fxRate: rate }
}

function buildStayLines(stay: Record<string, any>, hotel?: Record<string, any>, fxRates?: Record<string, number>): InvoiceLine[] {
  const rawPrice = extractAmount(stay.roomPrice)
  const roomCurrency = (stay.roomCurrency as string | undefined) || 'EUR'
  const { eur: price, originalCurrency: roomOrigCurrency, fxRate: roomFxRate } = applyFx(rawPrice, roomCurrency, fxRates)
  const hotelCountry = (stay.hotelCountry || stay.country || '').toLowerCase() || 'nl'
  const hotelName = stay.hotelName || 'Hotel'
  const checkIn = stay.checkInDate || ''
  const checkOut = stay.checkOutDate || ''
  const paymentType = stay.paymentType as string | undefined

  const nights = (checkIn && checkOut)
    ? Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
    : undefined

const guestNames = Array.isArray(stay.guestNames) && stay.guestNames.length > 0 ? stay.guestNames.join(', ') : undefined
  const roomType = paymentType?.toLowerCase().includes('including breakfast') ? 'Roomnight incl. breakfast' : 'Roomnight'
  const descParts = [hotelName, guestNames, `${checkIn} \u2013 ${checkOut}`, roomType].filter(Boolean)

  const roomLine: InvoiceLine = {
    type: 'room',
    description: descParts.join(' | '),
    quantity: nights && nights > 0 ? nights : undefined,
    unitPrice: nights && nights > 0 ? price : undefined,
    price: nights && nights > 0 ? Math.round(price * nights * 100) / 100 : price,
    deliveryCountry: hotelCountry,
    taxCategory: 'E',
    taxPercent: 0,
    ...(roomOrigCurrency ? { originalCurrency: roomOrigCurrency, fxRate: roomFxRate } : {}),
  }

  // City tax — payment-type-aware (hotel city tax has no currency field, assumed EUR)
  // Flat and percentage are additive — both charged if both set
  let cityTaxPrice = 0

  if (paymentType !== PAYMENT_TYPE_INCL_BK_INCL_CITYTAX) {
    const flatAmount = hotel?.cityTaxAmount != null ? extractAmount(hotel.cityTaxAmount) : 0
    if (flatAmount > 0) cityTaxPrice += flatAmount

    if (hotel?.cityTaxPercent != null) {
      const percent = parseFloat(hotel.cityTaxPercent) || 0
      if (percent > 0) {
        if (paymentType === PAYMENT_TYPE_INCL_BK_EXCL_CITYTAX) {
          // Breakfast excluded from tax base; if grossBreakfastRate missing, calculate over full price
          const grossBreakfastRate = hotel.grossBreakfastRate != null ? extractAmount(hotel.grossBreakfastRate) : 0
          const taxBase = Math.max(0, price - grossBreakfastRate)
          cityTaxPrice += Math.round(taxBase * percent / 100 * 100) / 100
        } else {
          cityTaxPrice += Math.round(price * percent / 100 * 100) / 100
        }
      }
    }
    cityTaxPrice = Math.round(cityTaxPrice * 100) / 100
  }

  const cityTaxLine: InvoiceLine | null = cityTaxPrice > 0 ? {
    type: 'city_tax',
    description: `City tax: ${hotelName} (${checkIn} \u2013 ${checkOut})`,
    quantity: nights && nights > 0 ? nights : undefined,
    unitPrice: nights && nights > 0 ? cityTaxPrice : undefined,
    price: nights && nights > 0 ? Math.round(cityTaxPrice * nights * 100) / 100 : cityTaxPrice,
    deliveryCountry: hotelCountry,
    taxCategory: 'E',
    taxPercent: 0,
  } : null

  // Map stay.lineItems[] (e.g. Hotel Service Fee, Misc. Restaurant)
  const extraLines: InvoiceLine[] = (Array.isArray(stay.lineItems) ? stay.lineItems : [])
    .filter((item: any) => item?.description)
    .map((item: any): InvoiceLine => {
      const qty = parseFloat(item.qty) || 1
      const rawUnit = parseFloat(item.unitPrice) || 0
      const itemCurrency = (item.currency as string | undefined) || 'EUR'
      const { eur: unitPriceVal, originalCurrency: itemOrigCurrency, fxRate: itemFxRate } = applyFx(rawUnit, itemCurrency, fxRates)
      return {
        type: 'line_item',
        description: item.description,
        quantity: qty,
        unitPrice: unitPriceVal,
        price: Math.round(unitPriceVal * qty * 100) / 100,
        deliveryCountry: hotelCountry,
        taxCategory: 'E',
        taxPercent: 0,
        ...(itemOrigCurrency ? { originalCurrency: itemOrigCurrency, fxRate: itemFxRate } : {}),
      }
    })

  return [roomLine, ...(cityTaxLine ? [cityTaxLine] : []), ...extraLines]
}

function buildReservationFeeLine(contactCountry: string, fee: number): InvoiceLine {
  return {
    type: 'reservation_fee',
    description: 'Reservation costs',
    price: fee,
    deliveryCountry: contactCountry || 'nl',
    taxCategory: 'E',
    taxPercent: 0,
  }
}

// → B2B Router extra_info field (renders with line breaks; shown as "Notities" in PDF)
// We also put payment terms here since payment_terms field ignores \n and renders as a single line.
// Sending extra_info as empty string hides the Notities section entirely — so we keep content here.
function buildDefaultExtraInfo(booking: Record<string, any>, confirmationEntity: string): string {
  const lines: string[] = [`The Dutch/EU Travel Agent Margin Scheme (TOMS) applies to this invoice.`, ``]
  if (booking.bookerName) lines.push(`Ordered by: ${booking.bookerName}`, ``)
  lines.push(`Account holder: ${confirmationEntity}`)
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n')
}

// ─── Main exported function ───────────────────────────────────────────────────

export function buildServerInvoicePayload(input: BuildServerInvoicePayloadInput): BuildServerInvoicePayloadResult {
  const { booking, company, booker, selectedStays, hotels, fxRates, overrides = {} } = input

  const contactName = overrides.contactName ?? (company?.name || booking.companyName || booking.bookerName || 'Unknown')
  const address = overrides.contactAddress ?? (company?.address ?? '')
  const postalCode = overrides.contactPostalCode ?? (company?.postal_code ?? '')
  const city = overrides.contactCity ?? (company?.city ?? '')
  const country = (overrides.contactCountry ?? (company?.country ?? '')).toLowerCase()
  const email = overrides.contactEmail ?? (booker?.general?.email ?? '')

  const confirmationEntity: string = booking.confirmationEntity || ''
  const isUK = confirmationEntity.toLowerCase().includes('uk')
  const senderIban = isUK ? 'GB29 NWBK 6016 1331 9268 19' : 'NL91 RABO 0353 2121 80'
  const senderBic = isUK ? 'NWBKGB2L' : 'RABONL2U'

  const date = overrides.date ?? new Date().toISOString().split('T')[0]
  const dueDate = overrides.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const reservationFee = overrides.reservationFee ?? extractAmount(company?.reservationCost)
  const stayLines = selectedStays.flatMap((stay) => buildStayLines(stay, hotels?.get(stay.hotelId?.toString()), fxRates))
  const reservationLine = buildReservationFeeLine(country, reservationFee)
  const lines = [...stayLines, reservationLine]
  const subtotal = lines.reduce((sum, l) => sum + l.price, 0)

  const resolvedEntity = confirmationEntity || 'Corporate Meeting Partner B.V.'
  const extraInfo = overrides.extraInfo ?? buildDefaultExtraInfo(booking, resolvedEntity)

  const issues: InvoiceValidationIssue[] = []

  if (!confirmationEntity) {
    issues.push({ field: 'confirmationEntity', fieldLabel: 'Confirmation entity', message: 'No confirmation entity set on the booking — cannot determine bank details', blocking: true })
  }

  if (!booker) {
    issues.push({ field: 'contact.email', fieldLabel: 'Delivery email', message: 'No booker linked — delivery email missing (invoice will be saved as draft)', blocking: false })
  } else if (!email) {
    issues.push({ field: 'contact.email', fieldLabel: 'Delivery email', message: 'Booker has no email address — invoice will be saved as draft', blocking: false })
  }

  for (const stay of selectedStays) {
    const hotelName = stay.hotelName || 'unknown hotel'
    const hotel = hotels?.get(stay.hotelId?.toString())
    const paymentType = stay.paymentType as string | undefined

    if (extractAmount(stay.roomPrice) === 0) {
      issues.push({ field: `lines[room:${hotelName}].price`, fieldLabel: `Room price — ${hotelName}`, message: `Stay at ${hotelName} has no room price set`, blocking: true })
    }

    // "Exc. Citytax" payment types + no city tax on hotel — warn that nothing will be charged
    if (
      paymentType === PAYMENT_TYPE_INCL_BK_EXCL_CITYTAX &&
      extractAmount(hotel?.cityTaxAmount) === 0 &&
      (hotel?.cityTaxPercent == null || parseFloat(hotel.cityTaxPercent) === 0)
    ) {
      issues.push({
        field: `lines[city_tax:${hotelName}].missing`,
        fieldLabel: `City tax — ${hotelName}`,
        message: `Stay at ${hotelName} excludes city tax but no city tax is configured on the hotel — no city tax line will be added`,
        blocking: false,
      })
    }

    // "Incl. BK, Exc. Citytax" + percentage city tax + missing grossBreakfastRate
    if (
      paymentType === PAYMENT_TYPE_INCL_BK_EXCL_CITYTAX &&
      hotel?.cityTaxPercent != null &&
      (parseFloat(hotel.cityTaxPercent) || 0) > 0 &&
      hotel?.grossBreakfastRate == null
    ) {
      issues.push({
        field: `lines[city_tax:${hotelName}].breakfastRate`,
        fieldLabel: `Breakfast rate — ${hotelName}`,
        message: `Stay at ${hotelName} uses percentage city tax but no gross breakfast rate is set on the hotel — city tax base cannot be calculated`,
        blocking: true,
      })
    }

    // "Exc. all tax" + no city tax on hotel — warn that nothing will be charged
    if (
      (paymentType === PAYMENT_TYPE_INCL_BK_EXCL_ALL_TAX || paymentType === PAYMENT_TYPE_EXCL_BK_EXCL_ALL_TAX) &&
      extractAmount(hotel?.cityTaxAmount) === 0 &&
      (hotel?.cityTaxPercent == null || parseFloat(hotel.cityTaxPercent) === 0)
    ) {
      issues.push({
        field: `lines[city_tax:${hotelName}].missing`,
        fieldLabel: `City tax — ${hotelName}`,
        message: `Stay at ${hotelName} excludes all taxes but no city tax is configured on the hotel — no city tax line will be added`,
        blocking: false,
      })
    }

  }

  if (!company) {
    issues.push({ field: 'contact.name', fieldLabel: 'Company', message: 'No company linked — using booker name as invoice recipient', blocking: false })
  } else if (!company.address) {
    issues.push({ field: 'contact.address', fieldLabel: 'Company address', message: 'Address is missing — invoice will be sent without a billing address', blocking: false })
  }

  // ── Override format validation ──
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const COUNTRY_RE = /^[a-z]{2}$/

  if (overrides.contactEmail !== undefined && overrides.contactEmail !== '' && !EMAIL_RE.test(overrides.contactEmail)) {
    issues.push({ field: 'contact.email', fieldLabel: 'Delivery email', message: 'Edited email is not a valid email address', blocking: true })
  }
  if (overrides.contactCountry !== undefined && overrides.contactCountry !== '' && !COUNTRY_RE.test(overrides.contactCountry.toLowerCase())) {
    issues.push({ field: 'contact.country', fieldLabel: 'Country', message: 'Country must be a 2-letter ISO code (e.g. nl, gb)', blocking: true })
  }
  if (overrides.date !== undefined && overrides.date !== '' && !ISO_DATE.test(overrides.date)) {
    issues.push({ field: 'date', fieldLabel: 'Invoice date', message: 'Date must be in YYYY-MM-DD format', blocking: true })
  }
  if (overrides.dueDate !== undefined && overrides.dueDate !== '' && !ISO_DATE.test(overrides.dueDate)) {
    issues.push({ field: 'dueDate', fieldLabel: 'Due date', message: 'Due date must be in YYYY-MM-DD format', blocking: true })
  }

  return {
    payload: {
      contact: { name: contactName, address, postalCode, city, country, email },
      confirmationEntity: resolvedEntity,
      senderIban,
      senderBic,
      date,
      dueDate,
      reservationFee,
      extraInfo,
      bookingConfirmationNo: booking.confirmationNo || undefined,
      bookerName: booking.bookerName || undefined,
      costCentre: booking.costCentre || undefined,
      lines,
      subtotal,
    },
    issues,
  }
}

// ─── B2B Router payload mapper (server-only) ─────────────────────────────────

export function mapPayloadToB2BRouter(payload: InvoicePayload, invoiceNumber: string) {
  return {
    send_after_import: false,
    invoice: {
      type: 'IssuedInvoice',
      number: invoiceNumber,
      date: payload.date,
      due_date: payload.dueDate,
      currency: 'EUR',
      language: 'en',
      payment_method: 58,  // TRANSFER SEPA
      payment_method_text: `Betaling via SEPA-overschrijving op de rekening\nIBAN ${payload.senderIban}\nBIC ${payload.senderBic}`,
      bank_account: {
        type: 'iban',
        iban: payload.senderIban,
        bic: payload.senderBic,
        name: payload.confirmationEntity,
      },
      extra_info: payload.extraInfo,
      // Structured fields — shown in the right places on the generated invoice
      ...(payload.bookingConfirmationNo ? { file_reference: payload.bookingConfirmationNo } : {}),
      ...(payload.bookerName ? { customer_contact_person: payload.bookerName } : {}),
      ...(payload.costCentre ? { buyer_accounting_reference: payload.costCentre } : {}),
      contact: {
        name: payload.contact.name,
        address: payload.contact.address,
        postalcode: payload.contact.postalCode,
        city: payload.contact.city,
        country: payload.contact.country || 'nl',
        email: payload.contact.email || undefined,
        ...(payload.contact.email ? { transport_type_code: 'email', document_type_code: 'pdf.invoice' } : {}),
      },
      invoice_lines_attributes: payload.lines.map((line) => ({
        quantity: line.quantity ?? 1,
        price: line.unitPrice ?? line.price,
        description: line.description,
        delivery_country: line.deliveryCountry,
        taxes_attributes: [{
          name: line.type === 'city_tax' ? 'City tax' : 'Exempt',
          category: line.taxCategory,
          percent: line.taxPercent,
        }],
      })),
    },
  }
}
