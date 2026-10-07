import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore.js'
import { startTodayWatcher } from './store/todayWatcher.js'
import { bootstrapSync } from './sync/spendySync.js'
import { mockNavItems } from './data/mockData.js'
import { Header } from './components/Header/Header.jsx'
import { BottomNavigation } from './components/BottomNavigation/BottomNavigation.jsx'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.jsx'
import { AddTransactionTypeModal } from './components/modals/AddTransactionTypeModal.jsx'
import { QuickAddScreen } from './components/modals/QuickAddScreen.jsx'
import { EditExpenseModal } from './components/modals/EditExpenseModal.jsx'
import { EditIncomeModal } from './components/modals/EditIncomeModal.jsx'
import { NewGoalModal } from './components/modals/NewGoalModal.jsx'
import { ContributeToGoalModal } from './components/modals/ContributeToGoalModal.jsx'
import { RadarScreen } from './components/radar/RadarScreen.jsx'
import { AndamentoScreen } from './components/andamento/AndamentoScreen.jsx'
import { AffordabilityScreen } from './components/affordability/AffordabilityScreen.jsx'
import { EmergencyFundScreen } from './components/goals/EmergencyFundScreen.jsx'
import { SettingsScreen } from './components/modals/SettingsScreen.jsx'
import { NotificationsScreen } from './components/notifications/NotificationsScreen.jsx'
import { startNotificationWatcher } from './notifications/notificationWatcher.js'
import { unreadCount } from './notifications/notificationState.js'
import { PasswordRecoveryScreen } from './components/settings/PasswordRecoveryScreen.jsx'
import { LegalGateScreen } from './components/legal/LegalGateScreen.jsx'
import { HomePage } from './pages/HomePage.jsx'
import { ExpensesPage } from './pages/ExpensesPage.jsx'
import { IncomesPage } from './pages/IncomesPage.jsx'
import { AnalyticsPage } from './pages/AnalyticsPage.jsx'
import { GoalsPage } from './pages/GoalsPage.jsx'
import { SpendyPage } from './pages/SpendyPage.jsx'
import './App.css'

const PAGES = {
  home: HomePage,
  expenses: ExpensesPage,
  incomes: IncomesPage,
  analytics: AnalyticsPage,
  goals: GoalsPage,
  spendy: SpendyPage,
}

// The shell: Header + active page + BottomNavigation, plus whichever
// modal/overlay the store says is open. Adding a real router later means
// changing PAGES and how activeTab is read — nothing about how pages or
// modals are written needs to change.
function App() {
  const activeTab = useAppStore((state) => state.activeTab)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const modal = useAppStore((state) => state.modal)
  const modalPayload = useAppStore((state) => state.modalPayload)
  const openModal = useAppStore((state) => state.openModal)
  const closeModal = useAppStore((state) => state.closeModal)
  const refreshToday = useAppStore((state) => state.refreshToday)
  // L'ambito dei dati locali (guest o account). Cambiandolo ogni schermata
  // viene ricreata da zero: nessuno stato di componente (campi di un form,
  // messaggi, cache di una pagina) può sopravvivere da un account all'altro.
  const scopeId = useAppStore((state) => state.scopeId)
  // Un numero (primitivo): il badge si aggiorna solo quando cambia davvero.
  const unread = useAppStore((state) => unreadCount(state.notifications))

  // `today` is set once when the store is created — refresh it on mount
  // so a tab reopened days later (or left open across midnight) reads
  // the real current date, not a stale one from whenever this session
  // started. Poi resta allineato finché l'app è aperta (todayWatcher):
  // ritorno in primo piano, focus e un controllo al minuto.
  useEffect(() => {
    refreshToday()
    return startTodayWatcher(useAppStore)
  }, [refreshToday])

  // Accende la sincronizzazione se c'e' gia' una sessione salvata. Se
  // Supabase non e' configurato non fa assolutamente nulla e l'app resta
  // quella di sempre, tutta locale: nessuna schermata di login davanti
  // alle spese, nessun blocco all'avvio.
  useEffect(() => bootstrapSync(), [])

  // Centro notifiche: un solo watcher dello store, fermato allo smontaggio.
  useEffect(() => startNotificationWatcher(useAppStore), [])

  const ActivePage = PAGES[activeTab] ?? HomePage

  // The only bottom-nav "action" item today is the central "+" — opens
  // the transaction-type picker in place, without navigating away from
  // whatever tab is currently open.
  const handleNavAction = (id) => {
    if (id === 'addTransaction') openModal('addTransaction')
  }

  return (
    <>
    <div className="app-shell" key={scopeId}>
      <div className="app-shell__header">
        <Header onOpenSettings={() => openModal('settings')} onOpenNotifications={() => openModal('notifications')} unreadCount={unread} />
      </div>

      {/* Se una pagina va in errore si rompe solo il suo contenuto: intestazione
          e menu restano fuori dal boundary e quindi utilizzabili. key={activeTab}
          lo riporta a zero cambiando sezione. */}
      <main className="app-shell__content">
        <ErrorBoundary variant="page" key={activeTab}>
          <ActivePage />
        </ErrorBoundary>
      </main>

      <BottomNavigation
        items={mockNavItems}
        activeId={activeTab}
        onSelect={setActiveTab}
        onAction={handleNavAction}
      />

      {modal === 'addTransaction' && <AddTransactionTypeModal onClose={closeModal} />}
      {modal === 'quickAdd' && modalPayload && (
        <QuickAddScreen type={modalPayload.type} initialCategoryId={modalPayload.categoryId} onClose={closeModal} />
      )}
      {modal === 'editExpense' && modalPayload && (
        <EditExpenseModal expense={modalPayload} onClose={closeModal} />
      )}
      {modal === 'editIncome' && modalPayload && (
        <EditIncomeModal income={modalPayload} onClose={closeModal} />
      )}
      {modal === 'newGoal' && <NewGoalModal onClose={closeModal} />}
      {modal === 'contributeGoal' && modalPayload && (
        <ContributeToGoalModal goal={modalPayload} onClose={closeModal} />
      )}
      {modal === 'radar' && <RadarScreen onClose={closeModal} />}
      {modal === 'andamento' && <AndamentoScreen onClose={closeModal} />}
      {modal === 'affordability' && <AffordabilityScreen onClose={closeModal} />}
      {modal === 'emergencyFund' && <EmergencyFundScreen onClose={closeModal} />}
      {modal === 'settings' && <SettingsScreen onClose={closeModal} />}
      {modal === 'notifications' && <NotificationsScreen onClose={closeModal} />}
    </div>
    {/* Fuori dalla schermata a chiave: sopravvivono al cambio di ambito. */}
    <LegalGateScreen />
    <PasswordRecoveryScreen />
    </>
  )
}

export default App
