// Italiano: la lingua di riferimento. Ogni chiave nuova nasce qui; le altre
// lingue possono restare indietro (si ricade su questa, vedi translate.js).
export default {
  settings: {
    language: {
      title: 'Lingua',
      hint: 'La lingua di Spendy su questo dispositivo, per questo account. Non cambia nessun dato.',
      current: 'Lingua attuale: {language}',
      partial: 'La traduzione dell’app è in corso: alcune schermate restano per ora in italiano.',
    },
  },
  // Fase 2: la Home e la cornice che la circonda (intestazione, barra in basso).
  home: {
    header: {
      settings: 'Impostazioni',
      notifications: {
        none: 'Notifiche, nessuna nuova notifica',
        unread: 'Notifiche, {count} non lette',
      },
    },
    nav: {
      home: 'Home',
      analytics: 'Analisi',
      add: 'Aggiungi',
      goals: 'Obiettivi',
    },
    hero: {
      label: '{name} ti dice',
      cta: 'Radar',
      score: 'Punteggio battuta: {score}/100',
    },
    emergency: 'Fondo emergenza',
    goals: {
      moreone: 'e un altro obiettivo →',
      moremany: 'e altri {count} obiettivi →',
    },
    affordability: {
      title: 'Posso permettermelo?',
      subtitle: 'Chiedi a {name} prima di fare un acquisto.',
    },
  },
  budget: {
    available: 'Disponibile',
    show: 'Mostra importo',
    hide: 'Nascondi importo',
    monthly: 'Budget mensile {amount}',
    nosalary: 'Stipendio di questo ciclo non ancora inserito',
    spentof: '{spent} spesi di {budget}',
    status: {
      ok: 'Sei in linea con il tuo budget!',
      near: 'Attenzione, ti stai avvicinando al limite.',
      over: 'Hai superato il budget disponibile.',
    },
    cycle: {
      label: 'Il tuo ciclo',
      legacy: {
        title: 'Stipendio dei cicli precedenti',
        cycles: '{count} cicli precedenti',
        explainone: "Prima dell'aggiornamento SPENDY usava un unico stipendio, senza salvarlo come entrata di un ciclo: per questo in Andamento {cycles} risulta senza entrate.",
        explainmany: "Prima dell'aggiornamento SPENDY usava un unico stipendio, senza salvarlo come entrata di un ciclo: per questo in Andamento {cycles} risultano senza entrate.",
        askone: "Per conservarlo nello storico, scrivi lo stipendio che avevi ricevuto in quel ciclo. Non viene proposto l'ultimo stipendio salvato, perché può essere già quello di un ciclo successivo.",
        askmany: "Per conservarlo nello storico, scrivi lo stipendio che avevi ricevuto in ciascun ciclo. Non viene proposto l'ultimo stipendio salvato, perché può essere già quello di un ciclo successivo.",
        field: 'Stipendio di {cycle}',
        placeholder: 'Importo',
        keep: 'Conserva nello storico',
        skip: 'Non conservare',
      },
      fresh: {
        title: 'È iniziato un nuovo ciclo',
        previous: 'Il ciclo {cycle} resta salvato in Andamento: entrate {income}, spese {spent}.',
        current: 'Il nuovo ciclo ({cycle}) parte da 0 €: entrate e disponibile restano a zero finché non inserisci il nuovo stipendio.',
        addsalary: 'Inserisci il nuovo stipendio',
        startzero: 'Inizia il ciclo da 0 €',
      },
    },
  },
  expenses: {
    summary: {
      today: 'Spese di oggi',
      cycle: 'Spese di questo mese',
      countone: '{count} transazione',
      countmany: '{count} transazioni',
      of: 'su {amount}',
    },
  },
  goals: {
    eta: 'Se continui così, lo raggiungi in circa {months} mesi.',
    confirmdelete: 'Confermi?',
    contribute: '+ Aggiungi',
  },
  radar: {
    preview: {
      title: 'Il mio Radar',
      all: 'Vedi tutto',
      allcount: 'Vedi tutti ({count})',
      usual: 'rispetto al solito',
      learning: '🔍 Sto ancora imparando le tue abitudini ({seen}/{needed} cicli).',
      quiet: 'Nessuna anomalia da segnalare al momento.',
    },
  },
}
