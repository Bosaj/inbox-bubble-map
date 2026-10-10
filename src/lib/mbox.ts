import { metaFromHeaders, type MessageMeta } from './headers'

const WANTED = new Set(['from', 'date', 'subject', 'list-unsubscribe', 'list-unsubscribe-post', 'list-id', 'precedence', 'x-gmail-labels'])

/**
 * Incremental mbox reader. Feed it text chunks of any size; it only keeps the
 * header block of the current message and skips bodies, so multi-GB Google
 * Takeout exports stream in constant memory.
 */
export class MboxParser {
  private buffer = ''
  private inHeaders = false
  private headers: Record<string, string> = {}
  private lastKey = ''
  private started = false
  readonly messages: MessageMeta[] = []
  onMessage?: (m: MessageMeta) => void

  push(chunk: string) {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      this.line(line)
    }
  }

  end(): MessageMeta[] {
    if (this.buffer) this.line(this.buffer.replace(/\r$/, ''))
    this.buffer = ''
    this.flush()
    return this.messages
  }

  private line(line: string) {
    if (line.startsWith('From ') && (!this.started || !this.inHeaders)) {
      this.flush()
      this.started = true
      this.inHeaders = true
      this.headers = {}
      this.lastKey = ''
      return
    }
    if (!this.inHeaders) return
    if (line === '') {
      this.inHeaders = false
      this.emit()
      return
    }
    if (/^[ \t]/.test(line)) {
      if (this.lastKey) this.headers[this.lastKey] += ' ' + line.trim()
      return
    }
    const colon = line.indexOf(':')
    if (colon <= 0) return
    const key = line.slice(0, colon).trim().toLowerCase()
    if (!WANTED.has(key) || key in this.headers) {
      this.lastKey = ''
      return
    }
    this.headers[key] = line.slice(colon + 1).trim()
    this.lastKey = key
  }

  private emitted = true

  private emit() {
    if (this.emitted) return
    this.emitted = true
    if (!this.headers['from']) return
    const meta = metaFromHeaders(this.headers)
    if (!meta.fromEmail.includes('@')) return
    this.messages.push(meta)
    this.onMessage?.(meta)
  }

  private flush() {
    if (this.inHeaders) this.emit() // file ended inside a header block
    this.emitted = false
  }
}

export function parseMbox(text: string): MessageMeta[] {
  const p = new MboxParser()
  p.push(text)
  return p.end()
}

/** Parse a single .eml (RFC 822) file. */
export function parseEml(text: string): MessageMeta | null {
  const p = new MboxParser()
  p.push('From import\n' + text)
  return p.end()[0] ?? null
}
