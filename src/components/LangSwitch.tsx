import { LANGS, useI18n } from '../i18n'

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
