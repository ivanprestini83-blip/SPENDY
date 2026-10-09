import { useEffect, useRef, useState } from 'react'
import { prepareSpendyVoice } from './spendyVoice.js'
import { decideSpendyVoiceFor, resolveSpendyVoice } from './spendyVoicePolicy.js'
import { loadVoiceCache, recordShown, saveVoiceCache } from './spendyVoiceCache.js'
import { requestAndStoreVoice } from './spendyVoiceRequest.js'
import { getSpendyVoiceDevConfig } from './devTools.js'
import { useAppStore } from '../store/useAppStore.js'
import { aiNotification } from '../notifications/notificationRules.js'

// Il ponte tra il flusso di Spendy AI e la Home.
//
// Riceve il risultato di getSpendyCoach (già calcolato dalla pagina) e i
// dati da cui è nato, restituisce la "voce" da dare a SpendyHero:
// { source, message, secondaryText, state, tone, layout, animation }.
//
// Non blocca mai il render: la decisione è sincrona, la frase locale è
// subito pronta, e se serve l'AI la chiamata parte in un effect — quando
// torna, la cache si aggiorna e la voce passa a quella generata.
export function useSpendyVoice({ coach, financialData, expenses, today, monthlyBudget, cycleStartDay, goals }) {
  const [dev] = useState(getSpendyVoiceDevConfig)
  // La memoria di Spendy AI è dell'ambito (guest o account) in uso.
  const scopeId = useAppStore((state) => state.scopeId)
  const [cache, setCache] = useState(() => loadVoiceCache(undefined, scopeId))
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const inFlight = useRef(null)
  // La lingua dell'app: Spendy AI risponde in questa lingua (il server la
  // ricontrolla; una lingua non prevista vale l'italiano).
  const language = useAppStore((state) => state.language)

  const { events, context, meta } = prepareSpendyVoice({
    coach, financialData, expenses, today, monthlyBudget, cycleStartDay, goals, locale: language,
  })
  // Spendy AI spenta (scelta dell'utente, default): solo frasi locali.
  const aiEnabled = useAppStore((state) => state.spendyAIEnabled === true)
  const decision = decideSpendyVoiceFor({ aiEnabled, coach, meta, today, cache, limits: dev.limits })
  const voice = resolveSpendyVoice({ decision, coach, cache })

  const shouldCallAI = decision.action === 'ai'
  const { fingerprint } = meta

  useEffect(() => {
    if (!shouldCallAI || inFlight.current === fingerprint) return
    inFlight.current = fingerprint
    // L'ambito della richiesta si fissa ORA: la risposta arriva dopo secondi e
    // nel frattempo si può cambiare account. requestAndStoreVoice la salva nel
    // contenitore di chi l'ha richiesta; lo schermo si aggiorna solo se è ancora lui.
    const requestScope = scopeId
    requestAndStoreVoice({ ai: dev.ai, context, meta, cache: cacheRef.current, today, scope: requestScope }).then(({ cache: next, result }) => {
      if (useAppStore.getState().scopeId === requestScope) setCache(next)
      // Una risposta importante resta ritrovabile nel centro notifiche. Lo store
      // la scarta se nel frattempo l'ambito attivo non è più quello della richiesta.
      const notification = aiNotification({ result, meta, today, lang: useAppStore.getState().language })
      if (notification) useAppStore.getState().addNotification(requestScope, notification)
      inFlight.current = null
    })
    // `context`/`meta` sono ricalcolati a ogni render: l'impronta è ciò
    // che dice se sono cambiati davvero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldCallAI, fingerprint, today, dev, scopeId])

  // Ricorda la frase rimasta sullo schermo (non quella di passaggio mentre
  // l'AI sta rispondendo): sarà la "frase precedente" della prossima volta.
  useEffect(() => {
    if (shouldCallAI) return
    const next = recordShown(cacheRef.current, { message: voice.message, day: today })
    if (next === cacheRef.current) return
    saveVoiceCache(next, undefined, scopeId)
    setCache(next)
  }, [shouldCallAI, voice.message, today, scopeId])

  return {
    voice,
    debug: dev.debug
      ? { decision, events, context, meta, mode: dev.mode, failure: cache.failure, calls: cache.calls, pending: shouldCallAI }
      : null,
  }
}
