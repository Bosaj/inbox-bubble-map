// MSAL v5 popup bridge: hands the Microsoft sign-in response back to the app window.
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge'

broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'Sign-in could not be completed. You can close this window.'
})
