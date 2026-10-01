import { storage } from '@/lib/storage'

/**
 * What this device knows about one studio:
 *   - the device key of the client profile (garage + history), created by the server;
 *   - capability tokens of individual bookings (links shared by the studio, bookings made
 *     before a profile existed).
 * Nothing here is a password; losing it only means losing quick access on this device.
 */
const k = (slug: string, name: string) => `${slug}:${name}`

export const device = {
  clientKey(slug: string): string | null {
    return storage.get(k(slug, 'client-key'))
  },
  setClientKey(slug: string, key: string): void {
    storage.set(k(slug, 'client-key'), key)
  },
  bookingToken(slug: string, bookingId: string): string | null {
    return storage.getJson<Record<string, string>>(k(slug, 'tokens'), {})[bookingId] ?? null
  },
  setBookingToken(slug: string, bookingId: string, token: string): void {
    const all = storage.getJson<Record<string, string>>(k(slug, 'tokens'), {})
    all[bookingId] = token
    storage.setJson(k(slug, 'tokens'), all)
  },
  contact(slug: string): { name: string; phone: string; email: string } | null {
    return storage.getJson(k(slug, 'contact'), null)
  },
  setContact(slug: string, c: { name: string; phone: string; email: string }): void {
    storage.setJson(k(slug, 'contact'), c)
  },
  /** "Forget this device": everything this app stored for the studio, appearance excluded. */
  forget(slug: string): void {
    for (const name of ['client-key', 'tokens', 'contact', 'draft']) storage.remove(k(slug, name))
  },
}
