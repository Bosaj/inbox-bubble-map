/**
 * On-device cache of a signed-in mailbox's headers (IndexedDB), so the map
 * opens instantly and only new or changed mail is fetched on the next visit.
 * Nothing leaves the device; logging out deletes it. Falls back to memory
 * when IndexedDB is unavailable (private windows, tests).
 */
import type { MessageMeta } from './headers'

export interface CachedAccount {
  id: string // e.g. "gmail:me@example.com"
  kind: 'gmail'
  email: string
  name?: string
  historyId?: string // Gmail history checkpoint for incremental sync
  limit: number // how many of the newest messages the cache covers
  messages: MessageMeta[]
  syncedAt: number
}

const DB = 'inbox-bubble-map'
const STORE = 'accounts'
const LAST = 'ibm:account'
const memory = new Map<string, CachedAccount>()

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    } finally {
      db.close()
    }
  })
}

export const accountId = (kind: 'gmail', email: string) => `${kind}:${email.toLowerCase()}`

export async function loadAccount(id: string): Promise<CachedAccount | null> {
  const hit = await tx<CachedAccount>('readonly', (s) => s.get(id) as IDBRequest<CachedAccount>)
  return hit ?? memory.get(id) ?? null
}

export async function saveAccount(acc: CachedAccount): Promise<void> {
  memory.set(acc.id, acc)
  await tx('readwrite', (s) => s.put(acc))
  try {
    localStorage.setItem(LAST, acc.id)
  } catch {
    /* storage blocked */
  }
}

export async function deleteAccount(id: string): Promise<void> {
  memory.delete(id)
  await tx('readwrite', (s) => s.delete(id))
  try {
    if (localStorage.getItem(LAST) === id) localStorage.removeItem(LAST)
  } catch {
    /* storage blocked */
  }
}

export function lastAccountId(): string | null {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}
