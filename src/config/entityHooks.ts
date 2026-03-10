/**
 * Miceflow-specific entity hooks.
 *
 * Registers denormalization and cross-entity sync functions with the shared
 * entityController. Call initEntityHooks() at startup (before the server
 * begins serving requests) to activate these behaviors.
 *
 * Other apps using the shared server submodule simply omit this call and
 * no miceflow-specific logic runs.
 */

import { MongoService } from '../services/mongoService.js'
import { registerDenormalization, registerCrossEntitySync } from '../controllers/entityController.js'

// ─── Status computation ────────────────────────────────────────────────────────

export function computeStayStatus(stay: any): { status: string; subStatus: string | null } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const checkIn = stay.checkInDate ? new Date(stay.checkInDate) : null
  const checkOut = stay.checkOutDate ? new Date(stay.checkOutDate) : null

  if (checkIn) checkIn.setHours(0, 0, 0, 0)
  if (checkOut) checkOut.setHours(0, 0, 0, 0)

  const stayId = typeof stay._id === 'object' ? (stay._id.$oid ?? stay._id.toString()) : String(stay._id ?? 'unknown')
  const label = `[computeStayStatus] stay=${stayId} (${stay.hotelName ?? '?'})`

  console.log(`${label} today=${today.toISOString().slice(0, 10)} checkIn=${stay.checkInDate ?? 'null'} checkOut=${stay.checkOutDate ?? 'null'}`)

  if (checkIn && today < checkIn) {
    console.log(`${label} → coming_up (today < checkIn)`)
    return { status: 'coming_up', subStatus: null }
  }

  if (checkIn && checkOut && today >= checkIn && today <= checkOut) {
    console.log(`${label} → in_progress (checkIn <= today <= checkOut)`)
    return { status: 'in_progress', subStatus: null }
  }

  if (checkOut && today > checkOut) {
    const hasPurchaseInvoice = Boolean(stay.purchaseInvoice?.trim?.() ?? stay.purchaseInvoice)
    const hasCommissionInvoice = Boolean(stay.commissionInvoice?.trim?.() ?? stay.commissionInvoice)
    const purchaseInvoicePaid: string = stay.purchaseInvoicePaid ?? ''
    const paymentSatisfied = purchaseInvoicePaid !== '' && purchaseInvoicePaid !== 'not_paid'
    const allSatisfied = hasPurchaseInvoice && hasCommissionInvoice && paymentSatisfied

    console.log(`${label} past checkout — purchaseInvoice=${stay.purchaseInvoice ?? 'null'} commissionInvoice=${stay.commissionInvoice ?? 'null'} purchaseInvoicePaid="${purchaseInvoicePaid}" paymentSatisfied=${paymentSatisfied} allSatisfied=${allSatisfied}`)

    if (allSatisfied) {
      console.log(`${label} → completed`)
      return { status: 'completed', subStatus: null }
    }

    let subStatus: string
    if (!hasPurchaseInvoice && !hasCommissionInvoice) {
      subStatus = 'missing_purchase_commission'
    } else if (!hasPurchaseInvoice) {
      subStatus = 'missing_purchase'
    } else if (!hasCommissionInvoice && !paymentSatisfied) {
      subStatus = 'missing_commission_unpaid'
    } else if (!hasCommissionInvoice) {
      subStatus = 'missing_commission'
    } else {
      subStatus = 'pending_payment'
    }

    console.log(`${label} → incomplete / ${subStatus}`)
    return { status: 'incomplete', subStatus }
  }

  console.log(`${label} → coming_up (fallback: no checkOut)`)
  return { status: 'coming_up', subStatus: null }
}

export function computeBookingStatus(
  booking: any,
  stays: any[]
): { status: string; subStatus: string | null } {
  const bookingId = typeof booking._id === 'object' ? (booking._id.$oid ?? booking._id.toString()) : String(booking._id ?? 'unknown')
  const label = `[computeBookingStatus] booking=${bookingId} (${booking.confirmationNo ?? '?'})`

  const nonCancelledStays = stays.filter((s: any) => s.status !== 'cancelled')

  console.log(`${label} totalStays=${stays.length} nonCancelled=${nonCancelledStays.length} salesInvoice="${booking.salesInvoice ?? ''}" travelPeriod=${booking.travelPeriodStart ?? 'null'}→${booking.travelPeriodEnd ?? 'null'}`)
  console.log(`${label} stays: ${stays.map((s: any) => {
    const sid = typeof s._id === 'object' ? (s._id.$oid ?? s._id.toString()) : String(s._id ?? '?')
    return `${sid}(status=${s.status ?? 'null'} subStatus=${s.subStatus ?? 'null'})`
  }).join(', ') || '(none)'}`)

  if (stays.length > 0 && nonCancelledStays.length === 0) {
    console.log(`${label} → all_cancelled`)
    return { status: 'all_cancelled', subStatus: null }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const periodStart = booking.travelPeriodStart ? new Date(booking.travelPeriodStart) : null
  const periodEnd = booking.travelPeriodEnd ? new Date(booking.travelPeriodEnd) : null
  if (periodStart) periodStart.setHours(0, 0, 0, 0)
  if (periodEnd) periodEnd.setHours(0, 0, 0, 0)

  if (periodStart && today < periodStart) {
    console.log(`${label} → coming_up (today < periodStart)`)
    return { status: 'coming_up', subStatus: null }
  }

  if (periodStart && periodEnd && today >= periodStart && today <= periodEnd) {
    console.log(`${label} → in_progress (periodStart <= today <= periodEnd)`)
    return { status: 'in_progress', subStatus: null }
  }

  const hasSalesInvoice = Boolean(booking.salesInvoice?.trim?.() ?? booking.salesInvoice)
  const allStaysCompleted = nonCancelledStays.length > 0 &&
    nonCancelledStays.every((s: any) => s.status === 'completed')

  console.log(`${label} past period — hasSalesInvoice=${hasSalesInvoice} allStaysCompleted=${allStaysCompleted}`)

  if (allStaysCompleted && hasSalesInvoice) {
    console.log(`${label} → finished`)
    return { status: 'finished', subStatus: null }
  }

  const DOC_MISSING_SUBSTATUS = new Set([
    'missing_purchase',
    'missing_commission',
    'missing_purchase_commission',
    'missing_commission_unpaid',
  ])

  const hasDocMissing = !hasSalesInvoice ||
    nonCancelledStays.some((s: any) => DOC_MISSING_SUBSTATUS.has(s.subStatus))

  console.log(`${label} incomplete check — hasDocMissing=${hasDocMissing} (salesInvoiceMissing=${!hasSalesInvoice} stayDocMissing=${nonCancelledStays.some((s: any) => DOC_MISSING_SUBSTATUS.has(s.subStatus))})`)

  if (hasDocMissing) {
    console.log(`${label} → incomplete / doc_missing`)
    return { status: 'incomplete', subStatus: 'doc_missing' }
  }

  const hasPaymentPending = nonCancelledStays.some((s: any) => s.subStatus === 'pending_payment')
  console.log(`${label} hasPaymentPending=${hasPaymentPending}`)
  if (hasPaymentPending) {
    console.log(`${label} → incomplete / payment_pending`)
    return { status: 'incomplete', subStatus: 'payment_pending' }
  }

  console.log(`${label} → incomplete / action_required (fallback)`)
  return { status: 'incomplete', subStatus: 'action_required' }
}

// ─── Denormalization helpers ───────────────────────────────────────────────────

function buildStaySummary(stay: any): object {
  return {
    stayId: typeof stay._id === 'object' ? (stay._id.$oid ?? stay._id.toString()) : String(stay._id),
    hotelName: stay.hotelName ?? '',
    checkInDate: stay.checkInDate ?? '',
    checkOutDate: stay.checkOutDate ?? '',
    guestNames: stay.guestNames ?? [],
  }
}

// ─── Hook registration ─────────────────────────────────────────────────────────

export function initEntityHooks(): void {
  const contactService = new MongoService('contacts')
  const bookingService = new MongoService('bookings')
  const stayService = new MongoService('stays')

  // bookings: recompute travelPeriod + booking status on every write
  registerDenormalization('bookings', async (body, id) => {
    const summaries: any[] = body.staySummaries ?? []
    if (summaries.length > 0) {
      const timestamps = summaries
        .flatMap((s: any) => [s.checkInDate, s.checkOutDate])
        .filter(Boolean)
        .map((d: string) => new Date(d).getTime())
        .filter((t: number) => !isNaN(t))
      if (timestamps.length > 0) {
        body.travelPeriodStart = new Date(Math.min(...timestamps)).toISOString().slice(0, 10)
        body.travelPeriodEnd = new Date(Math.max(...timestamps)).toISOString().slice(0, 10)
      }
    }

    let bookingData = body
    if (id) {
      const current = await bookingService.getById(id)
      if (current) bookingData = { ...current, ...body }
    }
    const bookingId = id ?? (
      typeof bookingData._id === 'object'
        ? (bookingData._id.$oid ?? bookingData._id.toString())
        : String(bookingData._id ?? '')
    )
    if (bookingId) {
      let stays = await stayService.findByField('bookingId', bookingId)
      console.log(`[denorm:bookings] bookingId=${bookingId} stays found by bookingId field: ${stays.length}`)
      if (stays.length === 0) {
        const summaryIds: string[] = (bookingData.staySummaries ?? []).map((s: any) => s.stayId).filter(Boolean)
        if (summaryIds.length > 0) {
          stays = await stayService.getByIds(summaryIds)
          console.log(`[denorm:bookings] fallback via staySummaries ids=${summaryIds.join(',')} found: ${stays.length}`)
        }
      }
      const { status, subStatus } = computeBookingStatus(bookingData, stays)
      body.status = status
      body.subStatus = subStatus
    }
  })

  // stays: resolve guestNames from guestIds + compute status/subStatus
  registerDenormalization('stays', async (body, id) => {
    if ('guestIds' in body) {
      const ids: string[] = body.guestIds ?? []
      if (ids.length === 0) {
        body.guestNames = []
      } else {
        const contacts = await contactService.getByIds(ids)
        const contactMap = new Map(contacts.map((c: any) => {
          // Normalise _id to its hex string regardless of whether it's an ObjectId instance or {$oid} wrapper
          const cid = typeof c._id === 'object' && c._id !== null
            ? (c._id.$oid ?? c._id.toString())
            : String(c._id)
          const name = [c.general?.firstName, c.general?.lastName].filter(Boolean).join(' ')
          return [cid, name]
        }))
        body.guestNames = ids.map((bodyId) => contactMap.get(bodyId) ?? '')
      }
    }

    let stayData = body
    if (id) {
      const current = await stayService.getById(id)
      if (current) stayData = { ...current, ...body }
    }

    const cancelledReason = stayData.cancelledReason ?? body.cancelledReason
    if (cancelledReason) {
      body.status = 'cancelled'
      body.subStatus = cancelledReason
    } else {
      const computed = computeStayStatus(stayData)
      body.status = computed.status
      body.subStatus = computed.subStatus
    }

    // Copy denormalized booking fields onto the stay
    const bookingId = body.bookingId ?? stayData.bookingId
    if (bookingId) {
      const booking = await bookingService.getById(bookingId)
      if (booking) {
        body.costCentre = (booking as any).costCentre ?? null
        body.salesInvoice = (booking as any).salesInvoice ?? null
        body.bookerName = (booking as any).bookerName ?? null
        body.companyName = (booking as any).companyName ?? null
        body.confirmationNo = (booking as any).confirmationNo ?? null
      }
    }
  })

  // bookings: cascade-delete all stays when a booking is deleted; push costCentre/salesInvoice on upsert
  registerCrossEntitySync('bookings', async (op, savedDoc, previousDoc) => {
    if (op === 'delete') {
      try {
        if (!previousDoc) return
        const bookingId = typeof previousDoc._id === 'object'
          ? (previousDoc._id.$oid ?? previousDoc._id.toString())
          : String(previousDoc._id)
        const stays = await stayService.findByField('bookingId', bookingId)
        for (const stay of stays) {
          const stayId = typeof (stay as any)._id === 'object'
            ? ((stay as any)._id.$oid ?? (stay as any)._id.toString())
            : String((stay as any)._id)
          await stayService.delete(stayId)
        }
      } catch (err) {
        console.error('[crossEntitySync] bookings → stays cascade delete failed:', err)
      }
      return
    }

    // On upsert, push denormalized booking fields onto all child stays
    if (op === 'upsert' && savedDoc) {
      try {
        const bookingId = typeof savedDoc._id === 'object'
          ? ((savedDoc._id as any).$oid ?? savedDoc._id.toString())
          : String(savedDoc._id)
        const costCentre = (savedDoc as any).costCentre ?? null
        const salesInvoice = (savedDoc as any).salesInvoice ?? null
        const bookerName = (savedDoc as any).bookerName ?? null
        const companyName = (savedDoc as any).companyName ?? null
        const confirmationNo = (savedDoc as any).confirmationNo ?? null

        let stays = await stayService.findByField('bookingId', bookingId)
        if (stays.length === 0) {
          const summaryIds: string[] = ((savedDoc as any).staySummaries ?? [])
            .map((s: any) => s.stayId).filter(Boolean)
          if (summaryIds.length > 0) {
            stays = await stayService.getByIds(summaryIds)
          }
        }
        for (const stay of stays) {
          const stayId = typeof (stay as any)._id === 'object'
            ? ((stay as any)._id.$oid ?? (stay as any)._id.toString())
            : String((stay as any)._id)
          await stayService.update(stayId, { costCentre, salesInvoice, bookerName, companyName, confirmationNo } as any)
        }
      } catch (err) {
        console.error('[crossEntitySync] bookings → stays sync failed:', err)
      }
    }
  })

  // stays: sync staySummaries + booking status on every stay write
  registerCrossEntitySync('stays', async (op, savedDoc, previousDoc) => {
    try {
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
        nextSummaries = currentSummaries.filter((s: any) => s.stayId !== stayId)
      } else {
        const existingIndex = currentSummaries.findIndex((s: any) => s.stayId === stayId)
        const summary = buildStaySummary(stayDoc)
        if (existingIndex >= 0) {
          nextSummaries = [...currentSummaries]
          nextSummaries[existingIndex] = summary
        } else {
          nextSummaries = [...currentSummaries, summary]
        }
      }

      const timestamps = nextSummaries
        .flatMap((s: any) => [s.checkInDate, s.checkOutDate])
        .filter(Boolean)
        .map((d: string) => new Date(d).getTime())
        .filter((t: number) => !isNaN(t))

      const travelPeriodStart = timestamps.length
        ? new Date(Math.min(...timestamps)).toISOString().slice(0, 10)
        : null
      const travelPeriodEnd = timestamps.length
        ? new Date(Math.max(...timestamps)).toISOString().slice(0, 10)
        : null

      let allStays = await stayService.findByField('bookingId', bookingId)
      if (allStays.length === 0) {
        const summaryIds: string[] = nextSummaries.map((s: any) => s.stayId).filter(Boolean)
        if (summaryIds.length > 0) {
          allStays = await stayService.getByIds(summaryIds)
        }
      }

      const updatedBookingData = {
        ...(booking as any),
        staySummaries: nextSummaries,
        ...(travelPeriodStart !== null ? { travelPeriodStart } : {}),
        ...(travelPeriodEnd !== null ? { travelPeriodEnd } : {}),
      }
      const { status: bookingStatus, subStatus: bookingSubStatus } =
        computeBookingStatus(updatedBookingData, allStays)

      await bookingService.update(bookingId, {
        staySummaries: nextSummaries,
        ...(travelPeriodStart !== null ? { travelPeriodStart } : {}),
        ...(travelPeriodEnd !== null ? { travelPeriodEnd } : {}),
        status: bookingStatus,
        subStatus: bookingSubStatus,
      } as any)
    } catch (err) {
      console.error('[crossEntitySync] stays → bookings sync failed:', err)
    }
  })

  console.log('✅ Miceflow entity hooks registered')
}
