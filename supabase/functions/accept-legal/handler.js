// Supabase Edge Function "accept-legal" — la logica, testata in Node.
//
// Registra che l'utente autenticato ha accettato i Termini e preso visione
// della Privacy Policy nella versione CORRENTE. Serve agli account che non
// hanno una riga in legal_acceptances (creati prima della migration) o che
// hanno una versione precedente; i nuovi utenti la ricevono già alla
// registrazione dal trigger su auth.users (supabase/privacy_consent.sql).
//
//   1. il token (Authorization: Bearer …) viene verificato chiedendo a
//      Supabase Auth di chi è (stesso verificatore di spendy-ai);
//   2. l'utente è SOLO quello del token: nessun id del client conta;
//   3. sono accettate solo le versioni correnti (_shared/legalVersions.js):
//      qualunque altra versione → 400, niente scritto;
//   4. data e ora sono quelle del server della funzione, mai del client;
//   5. successo SOLO dopo la conferma del database: { accepted: true, … }.
//
// Nei log solo l'esito: mai token, id o email.

export const MAX_BODY_BYTES = 1024

export const ACCEPT_LEGAL_ERRORS = {
  unauthenticated: 'unauthenticated',
  notConfigured: 'not_configured',
  badRequest: 'bad_request',
  versionMismatch: 'version_mismatch',
  recordFailed: 'record_failed',
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
//   verifyUser        async (token) => { id } | null   (spendy-ai/auth.js)
//   recordAcceptance  async ({ userId, termsVersion, privacyVersion, at }) => void,
//                     lancia se non riesce (store.js); null → 503
//   currentVersions   { terms, privacy } (_shared/legalVersions.js)
//   now               () => ms, l'orologio del SERVER
export function createAcceptLegalHandler({
  verifyUser,
  recordAcceptance,
  currentVersions,
  now = () => Date.now(),
  allowedOrigins = ['*'],
  log = () => {},
}) {
  return async function handle(request) {
    const cors = corsHeaders(request, allowedOrigins)
    const json = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return json(405, { error: ACCEPT_LEGAL_ERRORS.methodNotAllowed })

    const token = bearerToken(request)
    const user = token ? await verifyUser(token).catch(() => null) : null
    if (!user?.id) {
      log({ outcome: ACCEPT_LEGAL_ERRORS.unauthenticated })
      return json(401, { error: ACCEPT_LEGAL_ERRORS.unauthenticated })
    }

    if (typeof recordAcceptance !== 'function' || !currentVersions?.terms || !currentVersions?.privacy) {
      log({ outcome: ACCEPT_LEGAL_ERRORS.notConfigured })
      return json(503, { error: ACCEPT_LEGAL_ERRORS.notConfigured })
    }

    const raw = await request.text().catch(() => '')
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: ACCEPT_LEGAL_ERRORS.badRequest })
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return json(400, { error: ACCEPT_LEGAL_ERRORS.badRequest })
    }

    // Solo le versioni correnti: il client dichiara COSA ha letto, ma non può
    // registrare una versione diversa da quella pubblicata.
    if (body?.terms_version !== currentVersions.terms || body?.privacy_version !== currentVersions.privacy) {
      log({ outcome: ACCEPT_LEGAL_ERRORS.versionMismatch })
      return json(400, { error: ACCEPT_LEGAL_ERRORS.versionMismatch })
    }

    const at = new Date(now()).toISOString()
    try {
      await recordAcceptance({ userId: user.id, termsVersion: currentVersions.terms, privacyVersion: currentVersions.privacy, at })
    } catch (error) {
      log({ outcome: ACCEPT_LEGAL_ERRORS.recordFailed, reason: String(error?.message ?? 'unknown').slice(0, 80) })
      return json(502, { error: ACCEPT_LEGAL_ERRORS.recordFailed })
    }

    log({ outcome: 'accepted' })
    return json(200, {
      accepted: true,
      terms_version: currentVersions.terms,
      privacy_version: currentVersions.privacy,
      accepted_at: at,
    })
  }
}
