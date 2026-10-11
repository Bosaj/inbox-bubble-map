import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { saveAccount } from './lib/store'
import { demoMessages } from './lib/demo'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.dir = 'ltr'
})

async function openDemo() {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /Explore a demo inbox/ }))
}

describe('App', () => {
  it('starts on the private import screen', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /See who’s filling your inbox/ })).toBeInTheDocument()
    expect(screen.getByText(/Private by design/)).toBeInTheDocument()
  })

  it('opens the demo inbox with a map, summary and cleanup picks', async () => {
    await openDemo()
    expect(screen.getByRole('img', { name: /Bubble map of 29 senders/ })).toBeInTheDocument()
    expect(screen.getByText('Senders').nextSibling).toHaveTextContent('29')
    expect(screen.getByRole('heading', { name: /Lots of mail, mostly unread/ })).toBeInTheDocument()
  })

  it('shows sender details with unsubscribe actions and builds a cleanup list', async () => {
    await openDemo()
    await userEvent.click(screen.getAllByRole('button', { name: /Souk Deals/ })[0]!)
    expect(screen.getByRole('button', { name: /Unsubscribe in one click/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add to cleanup list/ }))
    await userEvent.click(screen.getByRole('button', { name: /All senders/ }))
    await userEvent.click(screen.getByRole('tab', { name: /Cleanup list/ }))
    expect(screen.getByRole('heading', { name: /Senders to unsubscribe from/ }).parentElement).toHaveTextContent('Souk Deals')
  })

  it('filters by type and offers an accessible table view', async () => {
    await openDemo()
    await userEvent.click(screen.getByRole('button', { name: /People/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'Table view' }))
    const table = screen.getByRole('table')
    expect(within(table).queryByText('Yassine B.')).toBeNull()
    expect(within(table).getByText('Souk Deals')).toBeInTheDocument()
  })

  it('reads a message in a sandboxed frame and marks it read', async () => {
    await openDemo()
    await userEvent.click(screen.getAllByRole('button', { name: /Souk Deals/ })[0]!)
    const section = screen.getByRole('region', { name: /Emails from this sender/ })
    await waitFor(() => expect(within(section).getAllByRole('listitem').length).toBeGreaterThan(0))
    await userEvent.click(within(section).getAllByRole('listitem')[0]!.querySelector('button')!)
    const frame = await screen.findByTitle('Email')
    expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
    expect(frame.getAttribute('srcdoc')).toContain("img-src data: cid:")
    expect(screen.getByText(/tracking pixels never fire/)).toBeInTheDocument()
  })

  it('archives every email from a sender after a confirmation and pops the bubble', async () => {
    await openDemo()
    await userEvent.click(screen.getAllByRole('button', { name: /Souk Deals/ })[0]!)
    const section = screen.getByRole('region', { name: /Emails from this sender/ })
    await waitFor(() => expect(within(section).getAllByRole('listitem').length).toBeGreaterThan(0))
    await userEvent.click(within(section).getByRole('button', { name: 'Archive all' }))
    const dialog = await screen.findByRole('dialog', { name: /Archive these emails/ })
    await waitFor(() => expect(dialog).toHaveTextContent(/emails from Souk Deals will leave your inbox/))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive all' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/emails archived/), { timeout: 4000 })
    await waitFor(() => expect(screen.getByRole('img', { name: /Bubble map of 28 senders/ })).toBeInTheDocument(), { timeout: 4000 })
  })

  it('switches to Arabic (right to left) and French', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('radio', { name: 'العربية' }))
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    expect(screen.getByRole('heading', { name: /اكتشف من يملأ صندوق بريدك/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Français' }))
    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByRole('heading', { name: /Voyez qui remplit votre boîte/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Explorer une boîte de démonstration/ }))
    expect(screen.getByRole('img', { name: /Carte de 29 expéditeurs/ })).toBeInTheDocument()
    expect(localStorage.getItem('ibm:lang')).toBe('fr')
  })

  it('offers to resume a cached account and can remove it from the device', async () => {
    await saveAccount({ id: 'gmail:me@gmail.com', kind: 'gmail', email: 'me@gmail.com', historyId: '1', limit: 2000, messages: demoMessages().slice(0, 50), syncedAt: Date.now() })
    render(<App />)
    expect(await screen.findByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue as me@gmail.com/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Remove from this device/ }))
    await waitFor(() => expect(screen.queryByText('Welcome back')).toBeNull())
  })
})
