import { useEffect, useRef, useState } from 'react'
import { prepareSpendyVoice } from './spendyVoice.js'
import { decideSpendyVoice, requestSpendyVoice, resolveSpendyVoice } from './spendyVoicePolicy.js'
import { loadVoiceCache, recordShown, saveVoiceCache } from './spendyVoiceCache.js'
import { getSpendyVoiceDevConfig } from './devTools.js'

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
  const [cache, setCache] = useState(() => loadVoiceCache())
  const cacheRef = useRef(cache)
  cacheRef.current = cache
  const inFlight = useRef(null)

  const { events, context, meta } = prepareSpendyVoice({
    coach, financialData, expenses, today, monthlyBudget, cycleStartDay, goals,
  })
  const decision = decideSpendyVoice({ coach, meta, today, cache, limits: dev.limits })
  const voice = resolveSpendyVoice({ decision, coach, cache })

  const shouldCallAI = decision.action === 'ai'
  const { fingerprint } = meta

  useEffect(() => {
    if (!shouldCallAI || inFlight.current === fingerprint) return
    inFlight.current = fingerprint
    requestSpendyVoice({ ai: dev.ai, context, meta, cache: cacheRef.current, today }).then(({ cache: next }) => {
      saveVoiceCache(next)
      setCache(next)
      inFlight.current = null
    })
    // `context`/`meta` sono ricalcolati a ogni render: l'impronta è ciò
    // che dice se sono cambiati davvero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldCallAI, fingerprint, today, dev])

  // Ricorda la frase rimasta sullo schermo (non quella di passaggio mentre
  // l'AI sta rispondendo): sarà la "frase precedente" della prossima volta.
  useEffect(() => {
    if (shouldCallAI) return
    const next = recordShown(cacheRef.current, { message: voice.message, day: today })
    if (next === cacheRef.current) return
    saveVoiceCache(next)
    setCache(next)
  }, [shouldCallAI, voice.message, today])

  return {
    voice,
    debug: dev.debug
      ? { decision, events, context, meta, mode: dev.mode, failure: cache.failure, calls: cache.calls, pending: shouldCallAI }
      : null,
  }
}
