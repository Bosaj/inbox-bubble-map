/// <reference lib="webworker" />
import { MboxParser, parseEml } from './mbox'
import type { MessageMeta } from './headers'

export type WorkerIn = { files: File[] }
export type WorkerOut =
  | { type: 'progress'; bytes: number; total: number; messages: number }
  | { type: 'done'; messages: MessageMeta[] }
  | { type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<WorkerIn>) => {
  try {
    const { files } = e.data
    const total = files.reduce((n, f) => n + f.size, 0)
    let bytes = 0
    const all: MessageMeta[] = []
    let lastReport = 0
    for (const file of files) {
      if (/\.eml$/i.test(file.name)) {
        const m = parseEml(await file.text())
        if (m) all.push(m)
        bytes += file.size
        continue
      }
      const parser = new MboxParser()
      const reader = file.stream().pipeThrough(new TextDecoderStream('utf-8')).getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        parser.push(value)
        bytes += value.length // chars ≈ bytes for headers/ASCII bodies; progress only
        const now = performance.now()
        if (now - lastReport > 120) {
          lastReport = now
          ctx.postMessage({ type: 'progress', bytes: Math.min(bytes, total), total, messages: all.length + parser.messages.length } satisfies WorkerOut)
        }
      }
      all.push(...parser.end())
      bytes = Math.max(bytes, files.slice(0, files.indexOf(file) + 1).reduce((n, f) => n + f.size, 0))
    }
    ctx.postMessage({ type: 'done', messages: all } satisfies WorkerOut)
  } catch (err) {
    ctx.postMessage({ type: 'error', message: (err as Error).message } satisfies WorkerOut)
  }
}
