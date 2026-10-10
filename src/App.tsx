import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Map as MapIcon, Moon, RotateCcw, Search, Sun, SunMoon, Table2, Target, X } from 'lucide-react'
import { aggregate, CATEGORIES, cleanupScore, summarize, toCsv, type Category, type GroupBy } from './lib/aggregate'
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

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
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

  const onGmail = useMemo(() => {
    const clientId = gmailClientId
    return clientId
        ? async (limit: number) => {
            setError(null)
            try {
              setProgress({ label: 'Waiting for Google sign-in…', done: 0, total: 1, messages: 0 })
              const token = await requestGmailToken(clientId)
              const msgs = await fetchGmailMetadata(token, {
                limit,
                onProgress: (p) => setProgress({ label: 'Reading message headers from Gmail…', done: p.done, total: p.total, messages: p.done }),
              })
              load(msgs, `Gmail · newest ${num(msgs.length)}`)
            } catch (err) {
              setError((err as Error).message)
              setProgress(null)
            }
          }
        : undefined
  }, [load])

  const all = useMemo(() => (messages ? aggregate(messages, groupBy) : []), [messages, groupBy])
  const summary = useMemo(() => summarize(all), [all])
  const counts = useMemo(() => {
    const c: Record<Category, number> = { bulk: 0, automated: 0, people: 0 }
    for (const s of all) c[s.category]++
    return c
  }, [all])
  const filtered = useMemo(() => all.filter((s) => cats.has(s.category)), [all, cats])
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
    return <ImportScreen onFiles={onFiles} onDemo={() => load(demoMessages(), 'Demo inbox')} onGmail={onGmail} progress={progress} error={error} />
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
          <Button size="sm" variant="ghost" onClick={() => download('inbox-cleanup.csv', toCsv(cleanupList.length ? cleanupList : filtered))} title={cleanupList.length ? 'Export your cleanup list' : 'Export all shown senders'}>
            <Download size={15} /> <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMessages(null)} title="Import another inbox">
            <RotateCcw size={15} /> <span className="hidden sm:inline">New import</span>
          </Button>
          <button type="button" onClick={cycleTheme} aria-label="Toggle theme" title={`Theme: ${theme}`} className="press grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
            {theme === 'system' ? <SunMoon size={17} /> : theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <label className="relative flex min-w-[200px] flex-1 items-center sm:max-w-xs">
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

        <div role="group" aria-label="Filter by type (legend)" className="flex flex-wrap gap-1.5">
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

        <div className="ms-auto flex flex-wrap items-center gap-2">
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
            <BubbleMap senders={shown} selected={selected} onSelect={setSelected} matches={matches} layoutKey={`${source}|${groupBy}`} />
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
            <SenderDetail key={selectedSender.key} sender={selectedSender} inCleanup={cleanup.has(selectedSender.key)} onToggleCleanup={() => toggleCleanup(selectedSender.key)} onBack={() => setSelected(null)} />
          ) : (
            <>
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
    </div>
  )
}
