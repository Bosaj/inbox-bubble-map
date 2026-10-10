import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, FileCode2, Filter, Image as ImageIcon, Map as MapIcon, Moon, RotateCcw, Search, Sheet, Sun, SunMoon, Table2, Target, Undo2, X } from 'lucide-react'
import { aggregate, CATEGORIES, cleanupScore, inRange, insights, summarize, toCsv, toGmailFilters, toSieve, type Category, type GroupBy } from './lib/aggregate'
import { fetchViaImap, type Provider } from './lib/providers'
import { fetchOutlookMetadata, msClientId, requestOutlookToken } from './lib/outlook'
import { svgToPng } from './lib/exportImage'
import { ConnectDialog, type ImapForm } from './components/ConnectDialog'
import { Insights } from './components/Insights'
import type { MessageMeta } from './lib/headers'
import { demoMessages } from './lib/demo'
import { fetchGmailMetadata, gmailClientId, requestGmailToken } from './lib/gmail'
import type { WorkerOut } from './lib/parse.worker'
import { ImportScreen, type Progress } from './components/ImportScreen'
import { BubbleMap } from './components/BubbleMap'
import { CleanupIcon, SenderDetail, SenderList } from './components/SidePanel'
import { SenderTable } from './components/SenderTable'
import { Button, CATEGORY_META, Dot, num, pct } from './components/ui'

type Theme = 'system' | 'light' | 'dark'
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('ibm:theme') as Theme) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('ibm:theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, () => setTheme((t) => NEXT_THEME[t])]
}

const RANGES: { days: number | null; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: null, label: 'All' },
]

function download(name: string, data: string | Blob, type = 'text/plain;charset=utf-8') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function App() {
  const [theme, cycleTheme] = useTheme()
  const [messages, setMessages] = useState<MessageMeta[] | null>(null)
  const [source, setSource] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null)

  const [groupBy, setGroupBy] = useState<GroupBy>('domain')
  const [cats, setCats] = useState<Set<Category>>(new Set(CATEGORIES))
  const [query, setQuery] = useState('')
  const [topN, setTopN] = useState(120)
  const [view, setView] = useState<'map' | 'table'>('map')
  const [selected, setSelected] = useState<string | null>(null)
  const [cleanup, setCleanup] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'candidates' | 'cleanup'>('candidates')
  const [range, setRange] = useState<number | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [cleaned, setCleaned] = useState<Set<string>>(new Set())
  const [popping, setPopping] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ key: string; label: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  const load = useCallback((msgs: MessageMeta[], label: string) => {
    if (!msgs.length) {
      setError('No messages with a sender were found in that file. Is it an .mbox export?')
      setProgress(null)
      return
    }
    setMessages(msgs)
    setSource(label)
    setProgress(null)
    setError(null)
    setSelected(null)
    setCleanup(new Set())
    setCleaned(new Set())
    setProvider(null)
  }, [])

  const onFiles = useCallback(
    (files: File[]) => {
      setError(null)
      worker.current?.terminate()
      const w = new Worker(new URL('./lib/parse.worker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      const label = files.length === 1 ? files[0]!.name : `${files.length} files`
      setProgress({ label: `Reading ${label}…`, done: 0, total: 1, messages: 0 })
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const d = e.data
        if (d.type === 'progress') setProgress({ label: `Reading ${label}…`, done: d.bytes, total: d.total, messages: d.messages })
        else if (d.type === 'done') {
          load(d.messages, label)
          w.terminate()
        } else {
          setError(`Could not read the file: ${d.message}`)
          setProgress(null)
          w.terminate()
        }
      }
      w.postMessage({ files })
    },
    [load],
  )

  /** Shared wrapper for every live connection: progress, errors, load. */
  const connect = useCallback(
    async (label: string, run: () => Promise<MessageMeta[]>) => {
      setConnectError(null)
      setConnecting(true)
      try {
        const msgs = await run()
        if (!msgs.length) throw new Error('That mailbox looks empty.')
        load(msgs, `${label} · newest ${num(msgs.length)}`)
      } catch (err) {
        setConnectError((err as Error).message)
        setProgress(null)
      } finally {
        setConnecting(false)
      }
    },
    [load],
  )

  const onGoogle = gmailClientId
    ? (limit: number) =>
        connect('Gmail', async () => {
          setProgress({ label: 'Waiting for Google sign-in…', done: 0, total: 1, messages: 0 })
          const token = await requestGmailToken(gmailClientId!)
          return fetchGmailMetadata(token, { limit, onProgress: (p) => setProgress({ label: 'Reading headers from Gmail…', done: p.done, total: p.total, messages: p.done }) })
        })
    : undefined

  const onMicrosoft = msClientId
    ? (limit: number) =>
        connect('Outlook', async () => {
          setProgress({ label: 'Waiting for Microsoft sign-in…', done: 0, total: 1, messages: 0 })
          const token = await requestOutlookToken(msClientId!)
          return fetchOutlookMetadata(token, { limit, onProgress: (p) => setProgress({ label: 'Reading headers from Outlook…', done: p.done, total: p.total, messages: p.done }) })
        })
    : undefined

  const onImap = (f: ImapForm) =>
    connect(provider?.name ?? f.host, async () => {
      setProgress({ label: `Reading headers from ${f.host}…`, done: 0, total: 1, messages: 0 })
      return fetchViaImap({ host: f.host, email: f.email, password: f.password, limit: f.limit, mailbox: f.mailbox })
    })

  const popSender = (key: string, label: string) => {
    setSelected(null)
    setPopping((p) => new Set(p).add(key))
    setTimeout(() => {
      setPopping((p) => {
        const n = new Set(p)
        n.delete(key)
        return n
      })
      setCleaned((c) => new Set(c).add(key))
      setToast({ key, label })
    }, 460)
  }
  const undoPop = (key: string) => {
    setCleaned((c) => {
      const n = new Set(c)
      n.delete(key)
      return n
    })
    setToast(null)
  }

  const scoped = useMemo(() => (messages ? inRange(messages, range) : []), [messages, range])
  const all = useMemo(() => aggregate(scoped, groupBy), [scoped, groupBy])
  const summary = useMemo(() => summarize(all), [all])
  const counts = useMemo(() => {
    const c: Record<Category, number> = { bulk: 0, automated: 0, people: 0 }
    for (const s of all) c[s.category]++
    return c
  }, [all])
  const filtered = useMemo(() => all.filter((s) => cats.has(s.category) && !cleaned.has(s.key)), [all, cats, cleaned])
  const stats = useMemo(() => insights(all.filter((s) => !cleaned.has(s.key)), cleanup), [all, cleaned, cleanup])
  const shown = useMemo(() => filtered.slice(0, topN), [filtered, topN])
  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? new Set(filtered.filter((s) => s.label.toLowerCase().includes(q) || s.domain.includes(q) || s.emails.some((e) => e.includes(q))).map((s) => s.key)) : null),
    [filtered, q],
  )
  const candidates = useMemo(() => [...filtered].filter((s) => s.category !== 'people').sort((a, b) => cleanupScore(b) - cleanupScore(a)).filter((s) => cleanupScore(s) > 0.5).slice(0, 12), [filtered])
  const cleanupList = useMemo(() => all.filter((s) => cleanup.has(s.key)), [all, cleanup])
  const selectedSender = selected ? all.find((s) => s.key === selected) ?? null : null

  const toggleCleanup = (key: string) =>
    setCleanup((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleCat = (c: Category) =>
    setCats((prev) => {
      const next = new Set(prev)
      if (next.has(c) && next.size > 1) next.delete(c)
      else next.add(c)
      return next
    })

  if (!messages) {
    return (
      <>
        <ImportScreen
          onFiles={onFiles}
          onDemo={() => load(demoMessages(), 'Demo inbox')}
          onProvider={(p) => {
            setConnectError(null)
            setProvider(p)
          }}
          progress={connecting ? null : progress}
          error={error}
        />
        <ConnectDialog
          provider={provider}
          onClose={() => !connecting && setProvider(null)}
          onImap={onImap}
          onGoogle={onGoogle}
          onMicrosoft={onMicrosoft}
          busy={connecting}
          error={connectError ?? (connecting && progress ? `${progress.label} ${progress.messages ? `${num(progress.messages)} so far` : ''}` : null)}
        />
      </>
    )
  }

  const tableRows = q ? filtered.filter((s) => matches?.has(s.key)) : filtered

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9 rounded-xl" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight">Inbox Bubble Map</p>
            <p className="truncate text-[12px] text-ink-3">{source}</p>
          </div>
        </div>
        <dl className="tabular order-3 flex w-full gap-6 overflow-x-auto text-[13px] sm:order-none sm:w-auto">
          {[
            ['Messages', num(summary.messages)],
            ['Senders', num(summary.senders)],
            ['From mailing lists', pct(summary.bulkShare)],
            ['Can unsubscribe', num(summary.unsubscribable)],
            ['Unread', pct(summary.messages ? summary.unread / summary.messages : 0)],
          ].map(([k, v]) => (
            <div key={k} className="shrink-0">
              <dt className="text-[11.5px] text-ink-3">{k}</dt>
              <dd className="text-[16px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="ms-auto flex items-center gap-1.5">
          <div className="relative">
            <Button size="sm" variant="ghost" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} aria-haspopup="menu">
              <Download size={15} /> <span className="hidden sm:inline">Export</span> <ChevronDown size={14} />
            </Button>
            {exportOpen && (
              <div role="menu" className="enter absolute end-0 top-11 z-30 w-72 rounded-2xl border border-line bg-surface p-1.5 shadow-pop" onMouseLeave={() => setExportOpen(false)}>
                {[
                  { icon: <Sheet size={15} />, label: 'Spreadsheet (CSV)', hint: cleanupList.length ? 'Your cleanup list' : 'All shown senders', disabled: false, run: () => download('inbox-senders.csv', toCsv(cleanupList.length ? cleanupList : filtered), 'text/csv;charset=utf-8') },
                  { icon: <Filter size={15} />, label: 'Gmail filters (.xml)', hint: 'Skip inbox + mark read for your cleanup list', disabled: !cleanupList.length, run: () => download('gmail-filters.xml', toGmailFilters(cleanupList), 'application/xml') },
                  { icon: <FileCode2 size={15} />, label: 'Sieve rules (.sieve)', hint: 'Fastmail, Proton, Posteo, cPanel…', disabled: !cleanupList.length, run: () => download('cleanup.sieve', toSieve(cleanupList)) },
                  { icon: <ImageIcon size={15} />, label: 'Map image (.png)', hint: view === 'map' ? 'Share your bubble map' : 'Switch to the map view first', disabled: view !== 'map', run: async () => { if (svgRef.current) download('inbox-bubble-map.png', await svgToPng(svgRef.current)) } },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setExportOpen(false)
                      void item.run()
                    }}
                    className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-surface-2 disabled:opacity-45"
                  >
                    <span className="mt-0.5 text-accent">{item.icon}</span>
                    <span>
                      <span className="block text-[13.5px] font-medium">{item.label}</span>
                      <span className="block text-[12px] text-ink-3">{item.disabled && item.label.startsWith('Gmail') || item.disabled && item.label.startsWith('Sieve') ? 'Add senders to your cleanup list first' : item.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setMessages(null)} title="Import another inbox">
            <RotateCcw size={15} /> <span className="hidden sm:inline">New import</span>
          </Button>
          <button type="button" onClick={cycleTheme} aria-label="Toggle theme" title={`Theme: ${theme}`} className="press grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
            {theme === 'system' ? <SunMoon size={17} /> : theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2.5 [scrollbar-width:none] sm:px-6 lg:flex-wrap lg:overflow-visible">
        <label className="relative flex min-w-[180px] flex-1 shrink-0 items-center sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute start-3 text-ink-3" />
          <span className="sr-only">Search senders</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search senders…"
            className="min-h-10 w-full rounded-xl border border-line-strong bg-surface-2 ps-9 pe-9 text-[13.5px] outline-none focus:border-accent"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute end-1 grid size-8 place-items-center rounded-lg text-ink-3 hover:text-ink">
              <X size={14} />
            </button>
          )}
        </label>

        <div role="radiogroup" aria-label="Time range" className="flex shrink-0 rounded-xl border border-line-strong p-0.5 text-[13px]">
          {RANGES.map((r) => (
            <button key={r.label} type="button" role="radio" aria-checked={range === r.days} onClick={() => setRange(r.days)} className={`press min-h-9 rounded-lg px-2.5 font-medium ${range === r.days ? 'bg-ink text-surface' : 'text-ink-2 hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Filter by type (legend)" className="flex shrink-0 gap-1.5 lg:flex-wrap">
          {CATEGORIES.map((c) => {
            const on = cats.has(c)
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                title={CATEGORY_META[c].hint}
                onClick={() => toggleCat(c)}
                className={`press inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium ${on ? 'border-line-strong bg-surface text-ink' : 'border-dashed border-line text-ink-3 line-through'}`}
              >
                <Dot category={c} size={9} />
                {CATEGORY_META[c].label}
                <span className="tabular text-ink-3">{counts[c]}</span>
              </button>
            )
          })}
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-2">
          <div role="radiogroup" aria-label="Group by" className="flex rounded-xl border border-line-strong p-0.5 text-[13px]">
            {(['domain', 'sender'] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={groupBy === g} onClick={() => setGroupBy(g)} className={`press min-h-9 rounded-lg px-3 font-medium ${groupBy === g ? 'bg-ink text-surface' : 'text-ink-2 hover:text-ink'}`}>
                {g === 'domain' ? 'By company' : 'By address'}
              </button>
            ))}
          </div>
          {view === 'map' && (
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              Show
              <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
                <option value={50}>top 50</option>
                <option value={120}>top 120</option>
                <option value={250}>top 250</option>
                <option value={100000}>all</option>
              </select>
            </label>
          )}
          <div role="radiogroup" aria-label="View" className="flex rounded-xl border border-line-strong p-0.5">
            <button type="button" role="radio" aria-checked={view === 'map'} aria-label="Map view" title="Map view" onClick={() => setView('map')} className={`press grid size-9 place-items-center rounded-lg ${view === 'map' ? 'bg-ink text-surface' : 'text-ink-2'}`}>
              <MapIcon size={16} />
            </button>
            <button type="button" role="radio" aria-checked={view === 'table'} aria-label="Table view" title="Table view" onClick={() => setView('table')} className={`press grid size-9 place-items-center rounded-lg ${view === 'table' ? 'bg-ink text-surface' : 'text-ink-2'}`}>
              <Table2 size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <main className="relative h-[min(100vw,640px)] min-h-[380px] border-line bg-bg lg:h-auto lg:border-e">
          {view === 'map' ? (
            <BubbleMap senders={shown} selected={selected} onSelect={setSelected} matches={matches} popping={popping} svgRef={svgRef} />
          ) : (
            <div className="absolute inset-0 bg-surface">
              <SenderTable senders={tableRows} selected={selected} onSelect={setSelected} cleanup={cleanup} />
            </div>
          )}
          {view === 'map' && filtered.length > shown.length && (
            <p className="pointer-events-none absolute end-3 top-3 rounded-lg bg-surface/85 px-2.5 py-1.5 text-[12px] text-ink-3 backdrop-blur">
              Showing the {num(shown.length)} biggest of {num(filtered.length)} senders
            </p>
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto bg-surface p-5">
          {selectedSender ? (
            <SenderDetail
              key={selectedSender.key}
              sender={selectedSender}
              inCleanup={cleanup.has(selectedSender.key)}
              onToggleCleanup={() => toggleCleanup(selectedSender.key)}
              onCleaned={() => popSender(selectedSender.key, selectedSender.label)}
              onBack={() => setSelected(null)}
              refTime={summary.to || Date.now()}
            />
          ) : (
            <>
              <Insights data={stats} cleaned={cleaned.size} onSelect={(x) => setSelected(x.key)} />
              <div role="tablist" aria-label="Panel" className="mb-4 flex rounded-xl bg-surface-2 p-1 text-[13px]">
                <button type="button" role="tab" aria-selected={tab === 'candidates'} onClick={() => setTab('candidates')} className={`press min-h-9 flex-1 rounded-lg font-medium ${tab === 'candidates' ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
                  Top cleanup picks
                </button>
                <button type="button" role="tab" aria-selected={tab === 'cleanup'} onClick={() => setTab('cleanup')} className={`press min-h-9 flex-1 rounded-lg font-medium ${tab === 'cleanup' ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
                  Cleanup list {cleanup.size > 0 && <span className="tabular ms-1 rounded-full bg-accent px-1.5 text-[11px] text-accent-ink">{cleanup.size}</span>}
                </button>
              </div>
              {tab === 'candidates' ? (
                <SenderList
                  title="Lots of mail, mostly unread"
                  icon={<Target size={16} className="text-accent" />}
                  senders={candidates}
                  empty="Nothing stands out — your inbox looks tidy."
                  onSelect={setSelected}
                  cleanup={cleanup}
                  onToggleCleanup={toggleCleanup}
                />
              ) : (
                <SenderList
                  title="Senders to unsubscribe from"
                  icon={<CleanupIcon size={16} className="text-accent" />}
                  senders={cleanupList}
                  empty={
                    <>
                      Tap <strong>+</strong> on a sender to collect it here, then work through the list or export it as CSV.
                    </>
                  }
                  onSelect={setSelected}
                  cleanup={cleanup}
                  onToggleCleanup={toggleCleanup}
                />
              )}
            </>
          )}
        </aside>
      </div>
      {toast && (
        <div role="status" className="enter fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit max-w-[calc(100vw-24px)] items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-[13.5px] text-surface shadow-pop">
          <span className="truncate">Popped {toast.label} 🎉</span>
          <button type="button" onClick={() => undoPop(toast.key)} className="press inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-[var(--c-people)] hover:bg-white/10">
            <Undo2 size={14} /> Undo
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="press grid size-8 place-items-center rounded-lg opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
