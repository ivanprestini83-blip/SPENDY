import { Component } from 'react'
import { spendyStates } from '../spendy/spendyStates.js'
import './ErrorBoundary.css'

// Rete di sicurezza globale: se un componente lancia un errore MENTRE VIENE
// DISEGNATO, React smonta l'intero albero e la pagina resta bianca. Questo
// boundary intercetta l'errore e mostra una schermata sobria con un pulsante
// per riaprire l'app, invece del vuoto.
//
// Vale solo per gli errori di rendering (e degli hook/lifecycle): React non
// passa dai boundary per gli errori dentro un onClick o un fetch. Quelli che
// poi cambiano lo stato e rompono il rendering — come è successo a "Sincronizza
// ora" — sì.
//
// Non tocca lo stato, il localStorage né la sincronizzazione: i dati restano
// quelli di prima. Il fallback è volutamente autonomo (niente store, niente
// hook, niente rete), perché deve poter funzionare proprio quando il resto
// dell'app è rotto.
//
// Due usi (prop `variant`):
//   - 'app' (default): attorno a tutta l'app, schermata intera, "Riapri SPENDY"
//     ricarica la pagina (main.jsx);
//   - 'page': attorno al contenuto di una sola pagina (App.jsx), così
//     intestazione e menu in basso restano utilizzabili. Il fallback sta nello
//     spazio della pagina e "Riprova" ridisegna solo quella.
const reloadApp = () => window.location.reload()

export function ErrorFallback({ variant = 'app', onReload = reloadApp, onRetry }) {
  if (variant === 'page') {
    return (
      <section className="error-fallback error-fallback--page" role="alert">
        <img className="error-fallback__mascot" src={spendyStates.concerned} alt="" draggable="false" />
        <h2 className="error-fallback__title">Ops, qualcosa non è andato come previsto.</h2>
        <p className="error-fallback__text">
          Prova a riaprire questa schermata o scegli un&apos;altra sezione dal menu. I tuoi dati non sono stati toccati.
        </p>
        <button type="button" className="error-fallback__button" onClick={onRetry}>
          Riprova
        </button>
      </section>
    )
  }

  return (
    <main className="error-fallback" role="alert">
      <img className="error-fallback__mascot" src={spendyStates.concerned} alt="" draggable="false" />
      <h1 className="error-fallback__title">Ops, qualcosa non è andato come previsto.</h1>
      <p className="error-fallback__text">Prova a riaprire SPENDY. I tuoi dati non sono stati toccati.</p>
      <button type="button" className="error-fallback__button" onClick={onReload}>
        Riapri SPENDY
      </button>
    </main>
  )
}

export class ErrorBoundary extends Component {
  // `hasError` e non solo `error`: si può lanciare anche null o undefined.
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  // Il punto in cui un domani si collegherà un servizio di segnalazione degli
  // errori (per ora solo la console, con la pila dei componenti).
  componentDidCatch(error, info) {
    console.error('[SPENDY] errore di rendering:', error, info?.componentStack ?? '')
  }

  // Solo per 'page': ridisegna il contenuto. Se l'errore c'è ancora, il
  // boundary lo riprende e ricompare il fallback.
  retry = () => this.setState({ hasError: false })

  render() {
    if (this.state.hasError) {
      return <ErrorFallback variant={this.props.variant} onReload={this.props.onReload} onRetry={this.retry} />
    }
    return this.props.children
  }
}
