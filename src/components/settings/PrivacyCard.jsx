import { LEGAL_DOCUMENTS } from '../../legal/legal.js'
import './SettingsCards.css'

// "Privacy" in Impostazioni: i documenti pubblici e dove esercitare i
// diritti già disponibili nell'app (esportazione ed eliminazione). Non
// duplica nessuna funzione: rimanda alle card che le fanno già.
export function PrivacyCard() {
  return (
    <div className="settings-screen__card settings-cards">
      <p className="settings-screen__label">🔒 Privacy</p>
      <ul className="settings-cards__links">
        <li>
          <a href={LEGAL_DOCUMENTS.privacy.url} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
        </li>
        <li>
          <a href={LEGAL_DOCUMENTS.terms.url} target="_blank" rel="noopener noreferrer">Termini di utilizzo</a>
        </li>
      </ul>
      <p className="settings-screen__hint">
        <strong>Esporta i miei dati:</strong> usa &quot;Esporta backup&quot; nella card &quot;Backup dei dati&quot; qui
        sotto, che salva tutti i tuoi dati in un file JSON.
      </p>
      <p className="settings-screen__hint">
        <strong>Elimina account:</strong> in fondo a questa pagina, con il tuo account attivo.
      </p>
    </div>
  )
}
