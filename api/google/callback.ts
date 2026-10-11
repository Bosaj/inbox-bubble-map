/** GET /api/google/callback: finish Google sign-in (see api/_lib/google.ts). */
import { callbackHandler } from '../_lib/google.js'

export function GET(request: Request): Promise<Response> {
  return callbackHandler(request)
}
