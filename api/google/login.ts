/** GET /api/google/login: start Google sign-in (see api/_lib/google.ts). */
import { loginHandler } from '../_lib/google.js'

export function GET(request: Request): Response {
  return loginHandler(request)
}
