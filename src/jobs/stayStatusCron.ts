import cron from 'node-cron'
import { getMongoClient } from '../services/mongoService.js'
import { computeStayStatus, computeBookingStatus } from '../config/entityHooks.js'

async function runStayStatusUpdate(): Promise<void> {
  const db = getMongoClient().db(process.env.MONGOCOLLECTION!)
  const staysCol = db.collection('stays')
  const bookingsCol = db.collection('bookings')

  // Fetch all non-cancelled stays
  const stays = await staysCol
    .find({ cancelledReason: { $exists: false } })
    .toArray()

  let staysUpdated = 0
  const affectedBookingIds = new Set<string>()

  for (const stay of stays) {
    if ((stay as any).cancelledReason) continue

    const { status, subStatus } = computeStayStatus(stay)

    if (stay.status === status && (stay as any).subStatus === (subStatus ?? null)) continue

    await staysCol.updateOne(
      { _id: stay._id },
      { $set: { status, subStatus: subStatus ?? null } }
    )
    staysUpdated++

    // Track which bookings need recomputation via bookingId field
    const bookingId: string | undefined = (stay as any).bookingId
    if (bookingId) affectedBookingIds.add(bookingId)
  }

  // Also recompute ALL bookings (covers legacy stays without bookingId)
  const { ObjectId } = await import('mongodb')
  const bookings = await bookingsCol.find({}).toArray()
  let bookingsUpdated = 0

  for (const booking of bookings) {
    try {
      const bookingId = booking._id.toString()

      // Fetch stays by bookingId field first, then fall back to staySummaries
      let allStays = await staysCol.find({ $or: [{ bookingId }, { bookingId: new ObjectId(bookingId) }] }).toArray()
      if (allStays.length === 0) {
        const summaryIds: string[] = ((booking as any).staySummaries ?? []).map((s: any) => s.stayId).filter(Boolean)
        if (summaryIds.length > 0) {
          allStays = await staysCol.find({
            _id: { $in: summaryIds.map((id) => { try { return new ObjectId(id) } catch { return id } }) }
          }).toArray()
        }
      }

      const { status, subStatus } = computeBookingStatus(booking, allStays)

      if (booking.status === status && (booking as any).subStatus === (subStatus ?? null)) continue

      await bookingsCol.updateOne(
        { _id: booking._id },
        { $set: { status, subStatus: subStatus ?? null } }
      )
      bookingsUpdated++
    } catch (err) {
      console.error(`[stayStatusCron] Failed to update booking ${booking._id}:`, err)
    }
  }

  console.log(`[stayStatusCron] Stays: ${staysUpdated} / ${stays.length} updated. Bookings: ${bookingsUpdated} / ${bookings.length} updated`)
}

export function initStayStatusCron(): void {
  if (process.env.STAY_STATUS_CRON_ENABLED !== 'true') return

  cron.schedule('0 0 * * *', async () => {
    console.log('[stayStatusCron] Running nightly stay status update...')
    try {
      await runStayStatusUpdate()
    } catch (err) {
      console.error('[stayStatusCron] Error during status update:', err)
    }
  })

  console.log('⏰ Stay status cron scheduled (nightly at midnight UTC)')
}
