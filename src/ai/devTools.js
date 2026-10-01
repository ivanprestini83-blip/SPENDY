// Interruttori per provare Spendy AI nel browser. Funzionano SOLO in
// sviluppo (`npm run dev`): in una build di produzione vengono ignorati.
//
//   ?spendyAI=remote     la vera AI (Edge Function), se Supabase è configurato
//   ?spendyAI=mock       l'AI finta della Fase A
//   ?spendyAI=<guasto>   mock che simula: offline | timeout | error |
//                        rate_limited | invalid | hallucinate
//   ?spendyDebug=1       mostra sotto Spendy da dove viene la frase e perché
//   ?spendyLimits=off    niente limite giornaliero / intervallo / cooldown
//   ?spendyReset=1       svuota SOLO la memoria di Spendy AI ('spendy-ai-voice')
//
// Senza ?spendyAI si usa il provider configurato (spendyAIConfig.js).
import { createSpendyAI } from './spendyAI.js'
import { createMockProvider, MOCK_MODES } from './providers/mockProvider.js'
import { appSpendyAI, createConfiguredSpendyAI } from './spendyAIConfig.js'
import { VOICE_LIMITS, NO_LIMITS } from './spendyVoicePolicy.js'
import { clearVoiceCache } from './spendyVoiceCache.js'
import { useAppStore } from '../store/useAppStore.js'

function devParams() {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search)
}

let resetDone = false

function aiFor(requested) {
  if (requested === 'remote' || requested === 'mock') {
    // Il nome vero del provider: "remote" senza Supabase configurato
    // ripiega sul mock, e il pannello di debug deve dirlo.
    const ai = createConfiguredSpendyAI(requested)
    return { ai, mode: ai.providerName }
  }
  if (MOCK_MODES.includes(requested) && requested !== 'normal') {
    return { ai: createSpendyAI({ provider: createMockProvider({ mode: requested }) }), mode: `mock:${requested}` }
  }
  return { ai: appSpendyAI, mode: appSpendyAI.providerName }
}

export function getSpendyVoiceDevConfig() {
  const params = devParams()
  if (!params) return { ai: appSpendyAI, limits: VOICE_LIMITS, debug: false, mode: appSpendyAI.providerName }

  if (params.get('spendyReset') === '1' && !resetDone) {
    clearVoiceCache(undefined, useAppStore.getState().scopeId)
    resetDone = true
  }

  const { ai, mode } = aiFor(params.get('spendyAI'))
  return {
    ai,
    limits: params.get('spendyLimits') === 'off' ? NO_LIMITS : VOICE_LIMITS,
    debug: params.get('spendyDebug') === '1',
    mode,
  }
}
