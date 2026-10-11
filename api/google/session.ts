/** /api/google/session: status (GET), access token (POST), log out (DELETE). */
import { sessionHandler } from '../_lib/google.js'

export const GET = (request: Request) => sessionHandler(request)
export const POST = (request: Request) => sessionHandler(request)
export const DELETE = (request: Request) => sessionHandler(request)
