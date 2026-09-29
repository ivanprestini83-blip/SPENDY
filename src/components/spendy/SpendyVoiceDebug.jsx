import './SpendyVoiceDebug.css'

const SOURCE_LABEL = { ai: 'AI', local: 'locale' }

// Solo sviluppo (?spendyDebug=1, vedi src/ai/devTools.js): mostra da dove
// arriva la frase che Spendy sta dicendo e perché, così il flusso
// dati → evento → contesto → AI → Hero si verifica a occhio.
export function SpendyVoiceDebug({ voice, debug }) {
  if (!debug) return null
  const { decision, events, meta, mode, failure, calls, pending, context } = debug
  const primary = events[0]

  return (
    <details className="spendy-voice-debug">
      <summary>
        <strong>{pending ? 'AI in arrivo…' : `fonte: ${SOURCE_LABEL[voice.source]}`}</strong>
        {' · '}
        {decision.reason}
        {' · AI: '}
        {mode}
      </summary>
      <dl>
        <dt>evento</dt>
        <dd>{primary ? `${primary.id} (${primary.importance})${primary.categoryId ? ` · ${primary.categoryId}` : ''}` : 'nessuno'}</dd>
        <dt>altri</dt>
        <dd>{events.slice(1, 3).map((event) => `${event.id} (${event.importance})`).join(', ') || '—'}</dd>
        <dt>stato / tono</dt>
        <dd>{voice.state} / {voice.tone} / {voice.animation}{voice.layout ? ` / ${voice.layout}` : ''}</dd>
        <dt>chiamate oggi</dt>
        <dd>{calls.day === context.today ? calls.count : 0}</dd>
        {failure && (
          <>
            <dt>ultimo errore</dt>
            <dd>{failure.error}</dd>
          </>
        )}
        <dt>impronta</dt>
        <dd className="spendy-voice-debug__mono">{meta.fingerprint}</dd>
      </dl>
      <pre className="spendy-voice-debug__context">{JSON.stringify(context, null, 2)}</pre>
    </details>
  )
}
