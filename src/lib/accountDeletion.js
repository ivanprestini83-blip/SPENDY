// Eliminazione dell'account — la richiesta al backend.
//
// Il client non decide CHI cancellare: chiama la Edge Function
// "delete-account" con la propria sessione (functions.invoke allega da sé il
// token) e il server cancella l'utente a cui quel token appartiene. Nessun
// id viene inviato, e la service_role non esiste in questo lato dell'app.
//
// Successo SOLO se il server risponde esplicitamente { deleted: true }:
// qualunque altra risposta è un errore, così la UI non può mai dire
// "eliminato" se l'account è ancora lì.

import { tr } from '../i18n/currentLanguage.js'

export const DELETE_ACCOUNT_FUNCTION = 'delete-account'

// Nella lingua dell'app, letti nel momento in cui servono.
export const DELETE_ACCOUNT_MESSAGES = {
  get offline() { return tr('settings.delete.error.offline') },
  get unauthenticated() { return tr('settings.delete.error.unauthenticated') },
  get failed() { return tr('settings.delete.error.failed') },
  get noSession() { return tr('settings.delete.error.nosession') },
}

const statusOf = (error) => error?.context?.status ?? error?.status ?? null

export async function requestAccountDeletion(client) {
  if (!client?.functions?.invoke) return { ok: false, message: DELETE_ACCOUNT_MESSAGES.failed }
  try {
    const { data, error } = await client.functions.invoke(DELETE_ACCOUNT_FUNCTION, { method: 'POST', body: {} })
    if (error) {
      if (statusOf(error) === 401) return { ok: false, message: DELETE_ACCOUNT_MESSAGES.unauthenticated }
      if (error?.name === 'FunctionsFetchError') return { ok: false, message: DELETE_ACCOUNT_MESSAGES.offline }
      return { ok: false, message: DELETE_ACCOUNT_MESSAGES.failed }
    }
    return data?.deleted === true ? { ok: true } : { ok: false, message: DELETE_ACCOUNT_MESSAGES.failed }
  } catch {
    return { ok: false, message: DELETE_ACCOUNT_MESSAGES.failed }
  }
}
