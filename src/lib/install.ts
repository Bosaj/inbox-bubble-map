import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** "Install app" when the browser offers it (Chrome, Edge, Android); null otherwise. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    const installed = () => setEvent(null)
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])
  if (!event) return null
  return async () => {
    await event.prompt()
    await event.userChoice
    setEvent(null)
  }
}
