import { Download } from 'lucide-react'
import { LANGS, useI18n } from '../i18n'
import { useInstallPrompt } from '../lib/install'

/** Installs the web app (home screen / desktop) when the browser supports it. */
export function InstallButton() {
  const { t } = useI18n()
  const install = useInstallPrompt()
  if (!install) return null
  return (
    <button type="button" onClick={() => void install()} className="press glass inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink hover:border-ink-3">
      <Download size={14} className="text-accent" /> {t.install}
    </button>
  )
}

/** العربية / FR / EN segmented switch. */
export function LangSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="radiogroup" aria-label={t.lang} className="glass flex rounded-xl border border-line p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={lang === l.id}
          aria-label={l.label}
          title={l.label}
          lang={l.id}
          onClick={() => setLang(l.id)}
          className={`press min-h-8 min-w-9 rounded-lg px-2 text-[12.5px] font-semibold ${lang === l.id ? 'bg-ink text-surface' : 'text-ink-2 hover:text-ink'}`}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}
