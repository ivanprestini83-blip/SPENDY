// Quale "AI" usa l'app — l'unico punto che legge la configurazione.
//
//   remote  la vera AI, tramite la Supabase Edge Function "spendy-ai"
//           (default quando Supabase è configurato)
//   mock    il provider locale della Fase A (default senza Supabase;
//           sempre disponibile per sviluppo e test)
//
// VITE_SPENDY_AI_PROVIDER ("remote" | "mock") permette di forzarlo. È
// una scelta, non un segreto: può stare in .env. La chiave del modello
// NON passa mai di qui — sta solo tra i secret della Edge Function.
//
// In ogni caso, se la chiamata fallisce la Home mostra la frase locale
// (HumorEngine / reaction library): il mock non è un ripiego della
// produzione, è l'AI finta per provare il flusso.
import { supabase, isSupabaseConfigured } from '../lib/supabase.js'
import { createSpendyAI, chooseSpendyProvider } from './spendyAI.js'
import { createMockProvider } from './providers/mockProvider.js'
import { createRemoteProvider, functionsUrl } from './providers/remoteProvider.js'

function remoteProvider() {
  return createRemoteProvider({
    url: functionsUrl(import.meta.env.VITE_SUPABASE_URL),
    publicKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession()
      return data?.session?.access_token ?? null
    },
  })
}

export const configuredProviderName = chooseSpendyProvider({
  requested: import.meta.env.VITE_SPENDY_AI_PROVIDER,
  remoteAvailable: isSupabaseConfigured,
})

export function createConfiguredSpendyAI(name = configuredProviderName) {
  const provider = name === 'remote' && isSupabaseConfigured ? remoteProvider() : createMockProvider()
  return createSpendyAI({ provider })
}

export const appSpendyAI = createConfiguredSpendyAI()
