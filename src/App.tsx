import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BoxSelect, ChevronDown, Download, FileCode2, Filter, Image as ImageIcon, Map as MapIcon, Moon, Palette, RotateCcw, Search, Sheet, SlidersHorizontal, Sun, SunMoon, Table2, Target, Undo2, X } from 'lucide-react'
import { activeFilterCount, NO_FILTERS, passes, selectPreset, type ColorBy, type Filters, type LayoutMode } from './lib/display'
import { DisplayMenu, FiltersMenu, GroupBar, Legend, SelectMenu } from './components/MapControls'
import { aggregate, CATEGORIES, cleanupScore, inRange, insights, summarize, toCsv, toGmailFilters, toSieve, type Category, type GroupBy } from './lib/aggregate'
import { fetchViaImap, imapMailbox, type Provider } from './lib/providers'
import { fetchOutlookMetadata, msClientId, outlookMailbox, requestOutlookToken } from './lib/outlook'
import { svgToPng } from './lib/exportImage'
import { ConnectDialog, type ImapForm } from './components/ConnectDialog'
import { Insights } from './components/Insights'
import type { MessageMeta } from './lib/headers'
import { demoMessages } from './lib/demo'
import { fetchGmailMetadata, gmailClientId, gmailMailbox, requestGmailToken } from './lib/gmail'
import { applyToMessages, cleanSender, demoMailbox, type MailAction, type Mailbox } from './lib/mailbox'
import type { WorkerOut } from './lib/parse.worker'
import { ImportScreen, type Progress } from './components/ImportScreen'
import { BubbleMap } from './components/BubbleMap'
import { CleanupIcon, SenderDetail, SenderList } from './components/SidePanel'
import { SenderTable } from './components/SenderTable'
import { Button, Dot, num, pct, setLocale } from './components/ui'
import { ConfirmAction, errorText, type BulkAction } from './components/MailUI'
import { LangSwitch } from './components/LangSwitch'
import { I18nContext, initialLang, STRINGS, type Lang } from './i18n'

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

const RANGES: (number | null)[] = [30, 90, 365, null]

/** Where the map came from, rendered in the current language. */
type Source = { kind: 'demo' } | { kind: 'file'; name: string } | { kind: 'live'; name: string; count: number }

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(initialLang)
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    try {
      localStorage.setItem('ibm:lang', lang)
    } catch {
      /* ignore */
    }
  }, [lang])
  return [lang, setLang]
}

function download(name: string, data: string | Blob, type = 'text/plain;charset=utf-8') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function App() {
  const [theme, cycleTheme] = useTheme()
  const [lang, setLang] = useLang()
  setLocale(lang)
  const t = STRINGS[lang]
  const i18n = useMemo(() => ({ lang, t: STRINGS[lang], setLang }), [lang, setLang])
  const [messages, setMessages] = useState<MessageMeta[] | null>(null)
  const messagesRef = useRef<MessageMeta[]>([])
  messagesRef.current = messages ?? []
  const [source, setSource] = useState<Source>({ kind: 'demo' })
  const [mailbox, setMailbox] = useState<Mailbox | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [groupAction, setGroupAction] = useState<{ action: BulkAction; keys: string[] } | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupProgress, setGroupProgress] = useState<string | null>(null)
  const [stream, setStream] = useState<{ done: number; total: number } | null>(null)
  const streamRef = useRef<AbortController | null>(null)
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
  const [colorBy, setColorBy] = useState<ColorBy>('type')
  const [layout, setLayout] = useState<LayoutMode>('orbit')
  const [logos, setLogos] = useState(true)
  const [multi, setMulti] = useState<Set<string>>(new Set())
  const [tool, setTool] = useState<'pan' | 'select'>('pan')
  const [unpinToken, setUnpinToken] = useState(0)
  const [pinnedCount, setPinnedCount] = useState(0)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [menu, setMenu] = useState<'display' | 'filters' | 'select' | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(id)
  }, [notice])

  const load = useCallback((msgs: MessageMeta[], src: Source, box: Mailbox | null = null) => {
    if (!msgs.length) {
      setError('noSenders')
      setProgress(null)
      return
    }
    setMessages(msgs)
    setSource(src)
    setMailbox(box)
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
      const label = files.length === 1 ? files[0]!.name : t.nFiles(files.length)
      setProgress({ label: t.reading(label), done: 0, total: 1, messages: 0 })
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const d = e.data
        if (d.type === 'progress') setProgress({ label: t.reading(label), done: d.bytes, total: d.total, messages: d.messages })
        else if (d.type === 'done') {
          load(d.messages, { kind: 'file', name: label })
          w.terminate()
        } else {
          setError(t.readFailed(d.message))
          setProgress(null)
          w.terminate()
        }
      }
      w.postMessage({ files })
    },
    [load, t],
  )

  /** Shared wrapper for every live connection: progress, errors, load. */
  const connect = useCallback(
    async (label: string, run: () => Promise<{ msgs: MessageMeta[]; box: Mailbox }>) => {
      setConnectError(null)
      setConnecting(true)
      try {
        const { msgs, box } = await run()
        if (!msgs.length) throw new Error(t.emptyMailbox)
        load(msgs, { kind: 'live', name: label, count: msgs.length }, box)
      } catch (err) {
        setConnectError(errorText(err, t))
        setProgress(null)
      } finally {
        setConnecting(false)
      }
    },
    [load, t],
  )

  /** Gmail streams: the map opens after the first ~200 messages and keeps growing while the rest load. */
  const onGoogle = gmailClientId
    ? async (limit: number) => {
        setConnectError(null)
        setConnecting(true)
        streamRef.current?.abort()
        const ctrl = new AbortController()
        streamRef.current = ctrl
        let shown = false
        try {
          setProgress({ label: t.waitGoogle, done: 0, total: 1, messages: 0 })
          const token = await requestGmailToken(gmailClientId!)
          const box = gmailMailbox(token, gmailClientId!)
          const all = await fetchGmailMetadata(token, {
            limit,
            signal: ctrl.signal,
            onProgress: (p) => (shown ? setStream(p) : setProgress({ label: t.readingGmail, done: p.done, total: p.total, messages: p.done })),
            onChunk: (msgs, p) => {
              if (ctrl.signal.aborted) return
              if (!shown) {
                shown = true
                load(msgs, { kind: 'live', name: 'Gmail', count: msgs.length }, box)
                setStream(p)
                setConnecting(false)
              } else setMessages((prev) => (prev ? [...prev, ...msgs] : msgs))
            },
          })
          if (ctrl.signal.aborted) return
          if (!all.length) throw new Error(t.emptyMailbox)
          if (!shown) load(all, { kind: 'live', name: 'Gmail', count: all.length }, box)
          setSource({ kind: 'live', name: 'Gmail', count: all.length })
        } catch (err) {
          if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) return
          if (shown) setNotice(t.stoppedAt(num(messagesRef.current.length), errorText(err, t)))
          else {
            setConnectError(errorText(err, t))
            setProgress(null)
          }
        } finally {
          setConnecting(false)
          setStream(null)
          if (streamRef.current === ctrl) streamRef.current = null
        }
      }
    : undefined

  const onMicrosoft = msClientId
    ? (limit: number) =>
        connect('Outlook', async () => {
          setProgress({ label: t.waitMicrosoft, done: 0, total: 1, messages: 0 })
          const { token, getToken } = await requestOutlookToken(msClientId!)
          const msgs = await fetchOutlookMetadata(token, { limit, onProgress: (p) => setProgress({ label: t.readingOutlook, done: p.done, total: p.total, messages: p.done }) })
          return { msgs, box: outlookMailbox(getToken) }
        })
    : undefined

  const onImap = (f: ImapForm) =>
    connect((provider && (t.providerName[provider.id] ?? provider.name)) || f.host, async () => {
      setProgress({ label: t.readingHost(f.host), done: 0, total: 1, messages: 0 })
      const opts = { host: f.host, email: f.email, password: f.password, mailbox: f.mailbox }
      const msgs = await fetchViaImap({ ...opts, limit: f.limit })
      return { msgs, box: imapMailbox(opts) }
    })

  const onDemo = () => {
    const msgs = demoMessages().map((m, i) => ({ ...m, id: `demo-${i}` }))
    load(msgs, { kind: 'demo' }, demoMailbox(() => messagesRef.current))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMulti(new Set())
        setMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  /** After the provider confirmed an action: update the loaded headers, pop emptied senders. */
  const onApplied = (key: string, label: string, action: MailAction, emails: string[], count: number, ids?: string[]) => {
    setNotice(t.doneAction(action, num(count)))
    const removes = action === 'archive' || action === 'trash' || action === 'spam'
    if (ids || !removes) {
      setMessages((prev) => (prev ? applyToMessages(prev, emails, action, ids ? new Set(ids) : undefined) : prev))
      return
    }
    void label
    setSelected((sel) => (sel === key ? null : sel))
    setPopping((p) => new Set(p).add(key))
    setTimeout(() => {
      setPopping((p) => {
        const n = new Set(p)
        n.delete(key)
        return n
      })
      setMessages((prev) => (prev ? applyToMessages(prev, emails, action) : prev))
    }, 460)
  }

  const runGroup = async () => {
    if (!groupAction || !mailbox) return
    const { action, keys } = groupAction
    setGroupBusy(true)
    let total = 0
    try {
      for (let i = 0; i < keys.length; i++) {
        const s = all.find((x) => x.key === keys[i])
        if (!s) continue
        setGroupProgress(t.groupWorking(i + 1, keys.length))
        const done = await cleanSender(mailbox, s.emails, action, (d, n) => setGroupProgress(`${t.groupWorking(i + 1, keys.length)} ${t.working(num(d), num(n))}`))
        total += done
        onApplied(s.key, s.label, action, s.emails, done)
      }
      setNotice(t.doneAction(action, num(total)))
      setMulti(new Set())
    } catch (err) {
      setNotice(t.failed(errorText(err, t)))
    } finally {
      setGroupBusy(false)
      setGroupProgress(null)
      setGroupAction(null)
    }
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
  const refTime = useMemo(() => all.reduce((m, s) => Math.max(m, s.last), 0), [all])
  const filtered = useMemo(() => all.filter((s) => cats.has(s.category) && !cleaned.has(s.key) && passes(s, filters, refTime)), [all, cats, cleaned, filters, refTime])
  const gmailTabs = useMemo(() => [...new Set(all.map((s) => s.gmailCategory).filter((x): x is string => Boolean(x)))].sort(), [all])
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
      <I18nContext.Provider value={i18n}>
        <ImportScreen
          onFiles={onFiles}
          onDemo={onDemo}
          onProvider={(p) => {
            setConnectError(null)
            setProvider(p)
          }}
          progress={connecting ? null : progress}
          error={error === 'noSenders' ? t.noSenders : error}
        />
        <ConnectDialog
          provider={provider}
          onClose={() => !connecting && setProvider(null)}
          onImap={onImap}
          onGoogle={onGoogle}
          onMicrosoft={onMicrosoft}
          busy={connecting}
          error={connectError ?? (connecting && progress ? `${progress.label} ${progress.messages ? t.soFar(num(progress.messages)) : ''}` : null)}
        />
      </I18nContext.Provider>
    )
  }

  const tableRows = q ? filtered.filter((s) => matches?.has(s.key)) : filtered

  const sourceText = source.kind === 'demo' ? t.demoInbox : source.kind === 'file' ? source.name : t.newest(source.name, num(source.count))

  return (
    <I18nContext.Provider value={i18n}>
    <div className="aurora flex min-h-dvh flex-col lg:h-dvh">
      <header className="glass relative z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9 rounded-xl" />
          <div className="min-w-0">
            <p className="font-display text-[22px] leading-none">
              {t.brand.before}
              <em className="text-accent">{t.brand.em}</em>
              {t.brand.after}
            </p>
            <p className="truncate text-[12px] text-ink-3">
              {stream ? (
                <span role="status" className="tabular inline-flex items-center gap-1.5 text-accent">
                  <span className="inline-block size-2 animate-pulse rounded-full bg-accent" /> {t.loadingMore(num(stream.done), num(stream.total))}
                </span>
              ) : (
                sourceText
              )}
            </p>
          </div>
        </div>
        <dl className="tabular order-3 flex w-full gap-6 overflow-x-auto text-[13px] sm:order-none sm:w-auto">
          {[
            [t.stats.messages, num(summary.messages)],
            [t.stats.senders, num(summary.senders)],
            [t.stats.lists, pct(summary.bulkShare)],
            [t.stats.unsub, num(summary.unsubscribable)],
            [t.stats.unread, pct(summary.messages ? summary.unread / summary.messages : 0)],
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
              <Download size={15} /> <span className="hidden sm:inline">{t.export}</span> <ChevronDown size={14} />
            </Button>
            {exportOpen && (
              <div role="menu" className="enter absolute end-0 top-11 z-30 w-72 rounded-2xl border border-line bg-surface p-1.5 shadow-pop" onMouseLeave={() => setExportOpen(false)}>
                {[
                  { icon: <Sheet size={15} />, label: t.exportItems.csv, hint: cleanupList.length ? t.exportItems.csvCleanup : t.exportItems.csvAll, disabled: false, run: () => download('inbox-senders.csv', toCsv(cleanupList.length ? cleanupList : filtered), 'text/csv;charset=utf-8') },
                  { icon: <Filter size={15} />, label: t.exportItems.gmail, hint: cleanupList.length ? t.exportItems.gmailHint : t.exportItems.needsCleanup, disabled: !cleanupList.length, run: () => download('gmail-filters.xml', toGmailFilters(cleanupList), 'application/xml') },
                  { icon: <FileCode2 size={15} />, label: t.exportItems.sieve, hint: cleanupList.length ? t.exportItems.sieveHint : t.exportItems.needsCleanup, disabled: !cleanupList.length, run: () => download('cleanup.sieve', toSieve(cleanupList)) },
                  { icon: <ImageIcon size={15} />, label: t.exportItems.png, hint: view === 'map' ? t.exportItems.pngHint : t.exportItems.pngNeedsMap, disabled: view !== 'map', run: async () => { if (svgRef.current) download('inbox-bubble-map.png', await svgToPng(svgRef.current)) } },
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
                      <span className="block text-[12px] text-ink-3">{item.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              streamRef.current?.abort()
              setStream(null)
              setMessages(null)
              setMailbox(null)
            }}
            title={t.newImportHint}
          >
            <RotateCcw size={15} /> <span className="hidden sm:inline">{t.newImport}</span>
          </Button>
          <LangSwitch />
          <button type="button" onClick={cycleTheme} aria-label={t.theme} title={`${t.theme}: ${t.themeName[theme]}`} className="press grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink">
            {theme === 'system' ? <SunMoon size={17} /> : theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <div className="glass relative z-10 flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-line px-4 py-2.5 [scrollbar-width:none] sm:px-6 lg:flex-wrap lg:overflow-visible">
        <label className="relative flex min-w-[180px] flex-1 shrink-0 items-center sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute start-3 text-ink-3" />
          <span className="sr-only">{t.searchLabel}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            className="min-h-10 w-full rounded-xl border border-line-strong bg-surface-2 ps-9 pe-9 text-[13.5px] outline-none focus:border-accent"
          />
          {query && (
            <button type="button" aria-label={t.clearSearch} onClick={() => setQuery('')} className="absolute end-1 grid size-8 place-items-center rounded-lg text-ink-3 hover:text-ink">
              <X size={14} />
            </button>
          )}
        </label>

        <div role="radiogroup" aria-label={t.timeRange} className="flex shrink-0 rounded-xl border border-line-strong p-0.5 text-[13px]">
          {RANGES.map((d) => (
            <button key={String(d)} type="button" role="radio" aria-checked={range === d} onClick={() => setRange(d)} className={`press min-h-9 rounded-lg px-2.5 font-medium ${range === d ? 'bg-ink text-surface' : 'text-ink-2 hover:text-ink'}`}>
              {t.ranges[d === null ? 'all' : String(d)]}
            </button>
          ))}
        </div>

        <div role="group" aria-label={t.typeFilter} className="flex shrink-0 gap-1.5 lg:flex-wrap">
          {CATEGORIES.map((c) => {
            const on = cats.has(c)
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                title={t.cat[c].hint}
                onClick={() => toggleCat(c)}
                className={`press inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium ${on ? 'border-line-strong bg-surface text-ink' : 'border-dashed border-line text-ink-3 line-through'}`}
              >
                <Dot category={c} size={9} />
                {t.cat[c].label}
                <span className="tabular text-ink-3">{counts[c]}</span>
              </button>
            )
          })}
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setMenu(menu === 'filters' ? null : 'filters')} aria-expanded={menu === 'filters'} className="press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-[13px] font-medium hover:border-ink-3">
              <SlidersHorizontal size={15} /> {t.filters}
              {activeFilterCount(filters) > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-[11px] text-accent-ink">{activeFilterCount(filters)}</span>}
            </button>
            {menu === 'filters' && <FiltersMenu filters={filters} onChange={setFilters} tabs={gmailTabs} onClose={() => setMenu(null)} />}
          </div>
          {view === 'map' && (
            <>
              <div className="relative">
                <button type="button" onClick={() => setMenu(menu === 'display' ? null : 'display')} aria-expanded={menu === 'display'} className="press inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-[13px] font-medium hover:border-ink-3">
                  <Palette size={15} /> {t.display}
                </button>
                {menu === 'display' && (
                  <DisplayMenu
                    colorBy={colorBy}
                    onColorBy={setColorBy}
                    layout={layout}
                    onLayout={setLayout}
                    logos={logos}
                    onLogos={setLogos}
                    pinned={pinnedCount}
                    onUnpinAll={() => setUnpinToken((n) => n + 1)}
                    onClose={() => setMenu(null)}
                  />
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenu(menu === 'select' ? null : 'select')}
                  aria-expanded={menu === 'select'}
                  className={`press inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium ${tool === 'select' || multi.size ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-ink-3'}`}
                >
                  <BoxSelect size={15} /> {t.select}
                  {multi.size ? <span className="tabular rounded-full bg-accent px-1.5 text-[11px] text-accent-ink">{multi.size}</span> : null}
                </button>
                {menu === 'select' && (
                  <SelectMenu
                    tool={tool}
                    onTool={(x) => {
                      setTool(x)
                      setMenu(null)
                    }}
                    onPreset={(preset) => {
                      setMulti(selectPreset(shown, preset))
                      setMenu(null)
                    }}
                    onClear={() => setMulti(new Set())}
                    count={multi.size}
                    onClose={() => setMenu(null)}
                  />
                )}
              </div>
            </>
          )}
          <div role="radiogroup" aria-label={t.groupBy} className="flex rounded-xl border border-line-strong p-0.5 text-[13px]">
            {(['domain', 'sender'] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={groupBy === g} onClick={() => setGroupBy(g)} className={`press min-h-9 rounded-lg px-3 font-medium ${groupBy === g ? 'bg-ink text-surface' : 'text-ink-2 hover:text-ink'}`}>
                {g === 'domain' ? t.byCompany : t.byAddress}
              </button>
            ))}
          </div>
          {view === 'map' && (
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              {t.show}
              <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink">
                <option value={50}>{t.top(50)}</option>
                <option value={120}>{t.top(120)}</option>
                <option value={250}>{t.top(250)}</option>
                <option value={100000}>{t.all}</option>
              </select>
            </label>
          )}
          <div role="radiogroup" aria-label={t.view} className="flex rounded-xl border border-line-strong p-0.5">
            <button type="button" role="radio" aria-checked={view === 'map'} aria-label={t.mapView} title={t.mapView} onClick={() => setView('map')} className={`press grid size-9 place-items-center rounded-lg ${view === 'map' ? 'bg-ink text-surface' : 'text-ink-2'}`}>
              <MapIcon size={16} />
            </button>
            <button type="button" role="radio" aria-checked={view === 'table'} aria-label={t.tableView} title={t.tableView} onClick={() => setView('table')} className={`press grid size-9 place-items-center rounded-lg ${view === 'table' ? 'bg-ink text-surface' : 'text-ink-2'}`}>
              <Table2 size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <main className="relative h-[min(100vw,640px)] min-h-[380px] border-line lg:h-auto lg:border-e">
          {view === 'map' ? (
            <>
              <BubbleMap
                senders={shown}
                selected={selected}
                onSelect={setSelected}
                matches={matches}
                popping={popping}
                svgRef={svgRef}
                colorBy={colorBy}
                layout={layout}
                logos={logos}
                multi={multi}
                onMulti={setMulti}
                tool={tool}
                unpinToken={unpinToken}
                onPinned={setPinnedCount}
              />
              <div className="glass pointer-events-none absolute bottom-3 start-3 max-w-[calc(100%-80px)] rounded-xl border border-line px-3 py-2 text-[11.5px] text-ink-2">
                <Legend colorBy={colorBy} />
                <p className="mt-1 hidden text-ink-3 sm:block">{t.mapFooter(layout === 'orbit')}</p>
              </div>
              {multi.size > 0 && (
                <GroupBar
                  count={multi.size}
                  onCleanup={() => {
                    setCleanup((c) => new Set([...c, ...multi]))
                    setTab('cleanup')
                    setMulti(new Set())
                  }}
                  onPop={() => {
                    const keys = [...multi]
                    setMulti(new Set())
                    keys.forEach((k, i) => setTimeout(() => popSender(k, keys.length > 1 ? t.nSenders(keys.length) : (all.find((x) => x.key === k)?.label ?? k)), i * 60))
                  }}
                  onMail={mailbox ? (action) => setGroupAction({ action, keys: [...multi] }) : undefined}
                  onClear={() => setMulti(new Set())}
                />
              )}
            </>
          ) : (
            <div className="absolute inset-0 bg-surface">
              <SenderTable senders={tableRows} selected={selected} onSelect={setSelected} cleanup={cleanup} />
            </div>
          )}
          {view === 'map' && filtered.length > shown.length && (
            <p className="pointer-events-none absolute end-3 top-3 rounded-lg bg-surface/85 px-2.5 py-1.5 text-[12px] text-ink-3 backdrop-blur">
              {t.showing(num(shown.length), num(filtered.length))}
            </p>
          )}
        </main>

        <aside className="glass min-h-0 overflow-y-auto p-5">
          {selectedSender ? (
            <SenderDetail
              key={selectedSender.key}
              sender={selectedSender}
              inCleanup={cleanup.has(selectedSender.key)}
              onToggleCleanup={() => toggleCleanup(selectedSender.key)}
              onCleaned={() => popSender(selectedSender.key, selectedSender.label)}
              onBack={() => setSelected(null)}
              refTime={summary.to || Date.now()}
              mailbox={mailbox}
              onApplied={(action, emails, count, ids) => onApplied(selectedSender.key, selectedSender.label, action, emails, count, ids)}
            />
          ) : (
            <>
              <Insights data={stats} cleaned={cleaned.size} onSelect={(x) => setSelected(x.key)} />
              <div role="tablist" aria-label={t.panel} className="mb-4 flex rounded-xl bg-surface-2 p-1 text-[13px]">
                <button type="button" role="tab" aria-selected={tab === 'candidates'} onClick={() => setTab('candidates')} className={`press min-h-9 flex-1 rounded-lg font-medium ${tab === 'candidates' ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
                  {t.tabPicks}
                </button>
                <button type="button" role="tab" aria-selected={tab === 'cleanup'} onClick={() => setTab('cleanup')} className={`press min-h-9 flex-1 rounded-lg font-medium ${tab === 'cleanup' ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
                  {t.tabCleanup} {cleanup.size > 0 && <span className="tabular ms-1 rounded-full bg-accent px-1.5 text-[11px] text-accent-ink">{cleanup.size}</span>}
                </button>
              </div>
              {tab === 'candidates' ? (
                <SenderList
                  title={t.picksTitle}
                  icon={<Target size={16} className="text-accent" />}
                  senders={candidates}
                  empty={t.picksEmpty}
                  onSelect={setSelected}
                  cleanup={cleanup}
                  onToggleCleanup={toggleCleanup}
                />
              ) : (
                <SenderList
                  title={t.cleanupTitle}
                  icon={<CleanupIcon size={16} className="text-accent" />}
                  senders={cleanupList}
                  empty={t.cleanupEmpty(<strong>+</strong>)}
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
          <span className="truncate">{t.popped(toast.label)}</span>
          <button type="button" onClick={() => undoPop(toast.key)} className="press inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-[var(--c-people)] hover:bg-white/10">
            <Undo2 size={14} /> {t.undo}
          </button>
          <button type="button" aria-label={t.dismiss} onClick={() => setToast(null)} className="press grid size-8 place-items-center rounded-lg opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && !toast && (
        <div role="status" className="enter fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit max-w-[calc(100vw-24px)] items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-[13.5px] text-surface shadow-pop">
          <span>{notice}</span>
          <button type="button" aria-label={t.dismiss} onClick={() => setNotice(null)} className="press grid size-8 place-items-center rounded-lg opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}
      <ConfirmAction
        open={groupAction !== null}
        title={groupAction ? t.groupConfirm(groupAction.action, groupAction.keys.length) : ''}
        body={t.groupBody}
        note={groupAction && groupAction.action !== 'read' ? t.confirmPopNote : undefined}
        confirmLabel={groupAction ? t.bulk[groupAction.action] : ''}
        danger={groupAction?.action === 'trash' || groupAction?.action === 'spam'}
        busy={groupBusy}
        progress={groupProgress}
        onConfirm={runGroup}
        onClose={() => setGroupAction(null)}
      />
    </div>
    </I18nContext.Provider>
  )
}
