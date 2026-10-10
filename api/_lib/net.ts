/** Network guards shared by the relay functions. Files under api/_lib are not routes. */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const HOSTNAME = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i

export function isPublicHostname(host: string): boolean {
  return HOSTNAME.test(host) && !isIP(host)
}

/** True for addresses a public server can't have (SSRF guard). */
export function isPrivateAddress(addr: string): boolean {
  if (isIP(addr) === 4) {
    const [a, b] = addr.split('.').map(Number) as [number, number]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = addr.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>
const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true })

/** First address of `host` if every address it resolves to is public, else null. */
export async function resolvePublic(host: string, resolve: Resolver = defaultResolver): Promise<string | null> {
  try {
    const addrs = await resolve(host)
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return null
    return addrs[0]!.address
  } catch {
    return null
  }
}
