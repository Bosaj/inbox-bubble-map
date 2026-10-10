import { useRef, useState } from 'react'
import { ChevronDown, FileUp, Lock, Sparkles } from 'lucide-react'
import { PROVIDERS, type Provider } from '../lib/providers'
import { Button, num } from './ui'

export interface Progress {
  label: string
  done: number
  total: number
  messages: number
}

interface Props {
  onFiles: (files: File[]) => void
  onDemo: () => void
  onProvider: (p: Provider) => void
  progress: Progress | null
  error: string | null
}

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="size-full" aria-hidden>
      <g stroke="var(--surface)" strokeWidth="2">
        <circle cx="25" cy="27" r="13" fill="var(--c-bulk)" />
        <circle cx="44" cy="22" r="8" fill="var(--c-automated)" />
        <circle cx="42" cy="42" r="10" fill="var(--c-people)" />
        <circle cx="22" cy="46" r="6" fill="var(--accent)" />
      </g>
      <circle cx="33" cy="33" r="4.5" fill="var(--ink)" />
    </svg>
  )
}

export function ImportScreen({ onFiles, onDemo, onProvider, progress, error }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  return (
    <div
      className={`min-h-dvh ${drag ? 'drop-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(files)
      }}
    >
      <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-10 px-5 py-12 lg:flex-row lg:items-center lg:gap-16">
        <section className="enter flex-1">
          <div className="mb-6 flex items-center gap-3">
            <span className="size-12">
              <Logo />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Inbox Bubble Map</span>
          </div>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-[52px]">See who’s filling your inbox.</h1>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink-2">
            Every sender becomes a bubble: bigger means more mail, closer to you means more recent. Spot the newsletters you never open and unsubscribe in a click.
          </p>
          <ul className="mt-6 space-y-2 text-[14px] text-ink-2">
            <li className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full bg-bulk" /> Newsletters & promos
            </li>
            <li className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full bg-automated" /> Automated: receipts, alerts
            </li>
            <li className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full bg-people" /> People
            </li>
          </ul>
          <p className="mt-8 flex max-w-md items-start gap-2.5 rounded-2xl border border-line bg-surface p-3.5 text-[13.5px] text-ink-2 shadow-card">
            <Lock size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <strong className="font-semibold text-ink">Private by design.</strong> Only headers are read, never message bodies, and nothing is saved when you close the tab. Files, Google and Microsoft sign-ins stay in your browser; app-password connections pass once through a relay that stores nothing.
            </span>
          </p>
        </section>

        <section className="enter w-full lg:w-[440px]" style={{ animationDelay: '80ms' }}>
          <div className="rounded-[28px] border border-line bg-surface p-5 shadow-pop sm:p-6">
            {progress ? (
              <div aria-live="polite" className="py-6">
                <p className="text-[15px] font-semibold">{progress.label}</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 5}%` }} />
                </div>
                <p className="tabular mt-3 text-[13px] text-ink-3">{num(progress.messages)} messages read</p>
              </div>
            ) : (
              <>
                <p className="mb-3 text-[14px] font-semibold">Connect your inbox</p>
                <div className="grid grid-cols-2 gap-2">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onProvider(p)}
                      className="press flex min-h-12 items-center gap-2.5 rounded-2xl border border-line bg-surface-2 px-3 text-start hover:border-ink-3"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl text-[13px] font-bold text-white" style={{ background: p.color }}>
                        {p.name.charAt(0)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold">{p.name}</span>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="my-4 flex items-center gap-3 text-[12px] text-ink-3">
                  <span className="h-px flex-1 bg-line" /> or use a file <span className="h-px flex-1 bg-line" />
                </div>

                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="press flex w-full items-center gap-3 rounded-[20px] border-2 border-dashed border-line-strong bg-surface-2 px-4 py-4 text-start hover:border-accent"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink shadow-card">
                    <FileUp size={20} />
                  </span>
                  <span>
                    <span className="block text-[14px] font-semibold">Drop an export here</span>
                    <span className="block text-[12.5px] text-ink-3">.mbox (Google Takeout, Thunderbird, Apple Mail) or .eml</span>
                  </span>
                </button>
                <input
                  ref={input}
                  type="file"
                  accept=".mbox,.eml,.txt,application/mbox,message/rfc822"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])]
                    if (files.length) onFiles(files)
                    e.target.value = ''
                  }}
                />

                <details className="group mt-3 rounded-xl px-1 text-[13px] text-ink-2">
                  <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-medium text-ink-2 hover:text-ink">
                    <ChevronDown size={15} className="transition-transform group-open:rotate-180" /> How do I get my .mbox?
                  </summary>
                  <ol className="mt-1 list-decimal space-y-1 ps-6 pb-2">
                    <li>
                      Open{' '}
                      <a href="https://takeout.google.com/" target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                        Google Takeout
                      </a>{' '}
                      and click <em>Deselect all</em>.
                    </li>
                    <li>Tick only <em>Mail</em>, then <em>Next step</em> → <em>Create export</em>.</li>
                    <li>Download the zip, unzip it and drop the <code>.mbox</code> file here.</li>
                  </ol>
                </details>

                <div className="mt-3 grid gap-2">
                  <Button variant="ghost" onClick={onDemo} className="border border-line">
                    <Sparkles size={16} className="text-accent" /> Explore a demo inbox
                  </Button>
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--c-bulk)_14%,transparent)] px-3 py-2 text-[13px] text-ink">
                {error}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
