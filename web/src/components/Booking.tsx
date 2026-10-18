import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ensureSession } from '../lib/session'

type Slot = { id: string; starts_at: string; duration_minutes: number }
type BookingRow = { id: string; slot_id: string }
const format = (date: string) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Helsinki',
}).format(new Date(date))

export default function Booking() {
  const [slots, setSlots] = useState<Slot[]>([])
  const [booked, setBooked] = useState<Set<string>>(new Set())
  const [mine, setMine] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')

  async function refresh() {
    await ensureSession()
    const [slotResult, bookedResult, myResult] = await Promise.all([
      supabase.from('clientflow_slots').select('id, starts_at, duration_minutes').gt('starts_at', new Date().toISOString()).order('starts_at'),
      supabase.from('clientflow_available_slots').select('slot_id'),
      supabase.from('clientflow_bookings').select('id, slot_id'),
    ])
    if (slotResult.error) throw slotResult.error
    if (bookedResult.error) throw bookedResult.error
    if (myResult.error) throw myResult.error
    setSlots(slotResult.data ?? [])
    setBooked(new Set((slotResult.data ?? []).filter((slot) => !(bookedResult.data ?? []).some((row) => row.slot_id === slot.id)).map((slot) => slot.id)))
    setMine(myResult.data ?? [])
  }
  useEffect(() => { let active = true; async function start() {
    try { await refresh() } catch (err) {
      if (active) setError(err instanceof Error ? err.message : 'Could not load slots')
    } finally { if (active) setLoading(false) }
  } void start(); return () => { active = false } }, [])

  async function book(slot: Slot) {
    if (pending) return
    setPending(slot.id); setError(''); setConfirmation('')
    try {
      await ensureSession()
      const result = await supabase.rpc('clientflow_book_slot', { p_slot_id: slot.id })
      if (result.error || !result.data) throw result.error ?? new Error('Booking was not saved')
      await refresh()
      setConfirmation(`Booked ${format(slot.starts_at)} (Helsinki time).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book the slot')
      await refresh().catch(() => undefined)
    } finally { setPending(null) }
  }

  return <section className="panel booking-panel" aria-labelledby="booking-title">
    <div className="panel-heading"><span className="eyebrow">02 / BOOKING</span><h2 id="booking-title">Book a consultation</h2>
      <p>Fixed 30-minute demo appointments · Helsinki time</p></div>
    {loading ? <p className="muted">Loading appointments…</p> : slots.length === 0 ? <p className="empty-state">No future appointments are configured.</p> :
      <div className="slot-list">{slots.map((slot) => {
        const myBooking = mine.find((row) => row.slot_id === slot.id)
        return <div className="slot" key={slot.id}><div><strong>{format(slot.starts_at)}</strong>
          <span>{myBooking ? 'Your booking' : booked.has(slot.id) ? 'Taken' : 'Available'}</span></div>
          <button type="button" disabled={!!pending || booked.has(slot.id) || !!myBooking} onClick={() => void book(slot)}>
            {pending === slot.id ? 'Booking…' : myBooking ? 'Booked' : booked.has(slot.id) ? 'Unavailable' : 'Book slot'}</button></div>
      })}</div>}
    {confirmation && <p className="success" role="status">{confirmation}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
