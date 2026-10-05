// Supabase Edge Function "delete-account" — la logica, testata in Node.
//
// Elimina DEFINITIVAMENTE l'account di chi la chiama, e solo quello:
//   1. il token della richiesta (Authorization: Bearer …) viene verificato
//      chiedendo a Supabase Auth di chi è (stesso verificatore di spendy-ai);
//   2. l'id da cancellare è SOLO quello restituito da Auth. Il corpo della
//      richiesta non viene nemmeno letto: uno user_id mandato dal client,
//      in qualunque forma, non conta niente;
//   3. la cancellazione dell'utente (Auth admin, con la service_role che vive
//      solo nei secret della funzione) fa sparire a cascata tutte le sue righe
//      (ON DELETE CASCADE verso auth.users su ogni tabella, ai_usage compresa).
//
// Nei log solo l'esito: mai token, id o email.

export const DELETE_ACCOUNT_ERRORS = {
  unauthenticated: 'unauthenticated',
  notConfigured: 'not_configured',
  deleteFailed: 'delete_failed',
  methodNotAllowed: 'method_not_allowed',
}

function bearerToken(request) {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get('origin')
  const allowAll = allowedOrigins.includes('*')
  const allowed = allowAll ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? 'null'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...(allowAll ? {} : { Vary: 'Origin' }),
  }
}

// → (request: Request) => Promise<Response>
//   verifyUser   async (token) => { id } | null   (spendy-ai/auth.js)
//   deleteUser   async (userId) => void, lancia se non riesce (admin.js);
//                null se la funzione non è configurata → 503, mai un falso successo
//   allowedOrigins  ['*'] di default, come spendy-ai
//   log          (entry) => void — solo metadati
export function createDeleteAccountHandler({ verifyUser, deleteUser, allowedOrigins = ['*'], log = () => {} }) {
  return async function handle(request) {
    const cors = corsHeaders(request, allowedOrigins)
    const json = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return json(405, { error: DELETE_ACCOUNT_ERRORS.methodNotAllowed })

    const token = bearerToken(request)
    const user = token ? await verifyUser(token).catch(() => null) : null
    if (!user?.id) {
      log({ outcome: DELETE_ACCOUNT_ERRORS.unauthenticated })
      return json(401, { error: DELETE_ACCOUNT_ERRORS.unauthenticated })
    }

    if (typeof deleteUser !== 'function') {
      log({ outcome: DELETE_ACCOUNT_ERRORS.notConfigured })
      return json(503, { error: DELETE_ACCOUNT_ERRORS.notConfigured })
    }

    try {
      await deleteUser(user.id)
    } catch (error) {
      log({ outcome: DELETE_ACCOUNT_ERRORS.deleteFailed, reason: String(error?.message ?? 'unknown').slice(0, 80) })
      return json(502, { error: DELETE_ACCOUNT_ERRORS.deleteFailed })
    }

    log({ outcome: 'deleted' })
    return json(200, { deleted: true })
  }
}
