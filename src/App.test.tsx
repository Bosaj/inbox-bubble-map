import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

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
    expect(screen.getByRole('link', { name: /^Unsubscribe$/ })).toHaveAttribute('href', expect.stringMatching(/^https:\/\//))
    expect(screen.getByRole('link', { name: /Find in Gmail/ })).toHaveAttribute('href', expect.stringContaining('mail.google.com'))
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
})
