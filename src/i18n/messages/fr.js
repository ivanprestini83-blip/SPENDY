export default {
  settings: {
    language: {
      title: 'Langue',
      hint: 'La langue de Spendy sur cet appareil, pour ce compte. Elle ne modifie aucune de vos données.',
      current: 'Langue actuelle : {language}',
      partial: 'La traduction de l’app est en cours : certains écrans restent pour l’instant en italien.',
    },
  },
  // Espaces insécables (\u00a0) devant ? ! : pour que le signe ne passe
  // jamais seul à la ligne sur un petit écran.
  home: {
    header: {
      settings: 'Paramètres',
      notifications: {
        none: 'Notifications, aucune nouvelle notification',
        unread: 'Notifications, {count} non lues',
      },
    },
    nav: {
      home: 'Accueil',
      analytics: 'Analyse',
      add: 'Ajouter',
      goals: 'Objectifs',
    },
    hero: {
      label: '{name} vous dit',
      cta: 'Radar',
      score: 'Score de la blague\u00a0: {score}/100',
    },
    emergency: 'Fonds d’urgence',
    goals: {
      moreone: 'et un autre objectif →',
      moremany: 'et {count} autres objectifs →',
    },
    affordability: {
      title: 'Puis-je me le permettre\u00a0?',
      subtitle: 'Demandez à {name} avant de faire un achat.',
    },
  },
  budget: {
    available: 'Disponible',
    show: 'Afficher le montant',
    hide: 'Masquer le montant',
    monthly: 'Budget mensuel {amount}',
    nosalary: 'Salaire de ce cycle pas encore saisi',
    spentof: '{spent} dépensés sur {budget}',
    status: {
      ok: 'Vous respectez votre budget\u00a0!',
      near: 'Attention, vous approchez de la limite.',
      over: 'Vous avez dépassé le budget disponible.',
    },
    cycle: {
      label: 'Votre cycle',
      legacy: {
        title: 'Salaire des cycles précédents',
        cycles: '{count} cycles précédents',
        explainone: 'Avant la mise à jour, SPENDY utilisait un salaire unique, sans l’enregistrer comme revenu d’un cycle\u00a0: c’est pourquoi, dans Évolution, {cycles} apparaît sans revenus.',
        explainmany: 'Avant la mise à jour, SPENDY utilisait un salaire unique, sans l’enregistrer comme revenu d’un cycle\u00a0: c’est pourquoi, dans Évolution, {cycles} apparaissent sans revenus.',
        askone: 'Pour le conserver dans l’historique, saisissez le salaire que vous avez reçu pendant ce cycle. Le dernier salaire enregistré n’est pas proposé, car il peut déjà correspondre à un cycle suivant.',
        askmany: 'Pour le conserver dans l’historique, saisissez le salaire que vous avez reçu pendant chaque cycle. Le dernier salaire enregistré n’est pas proposé, car il peut déjà correspondre à un cycle suivant.',
        field: 'Salaire de {cycle}',
        placeholder: 'Montant',
        keep: 'Conserver dans l’historique',
        skip: 'Ne pas conserver',
      },
      fresh: {
        title: 'Un nouveau cycle a commencé',
        previous: 'Le cycle {cycle} reste enregistré dans Évolution\u00a0: revenus {income}, dépenses {spent}.',
        current: 'Le nouveau cycle ({cycle}) part de 0\u00a0€\u00a0: les revenus et le disponible restent à zéro jusqu’à ce que vous saisissiez le nouveau salaire.',
        addsalary: 'Saisir le nouveau salaire',
        startzero: 'Commencer le cycle à 0\u00a0€',
      },
    },
  },
  expenses: {
    summary: {
      today: 'Dépenses du jour',
      cycle: 'Dépenses du mois',
      countone: '{count} transaction',
      countmany: '{count} transactions',
      of: 'sur {amount}',
    },
    page: {
      periods: 'Période',
      today: 'Aujourd’hui',
      cycle: 'Cycle',
      prev: 'Cycle précédent',
      next: 'Cycle suivant',
      pastcycle: 'Dépenses du cycle {cycle}',
      incomes: 'Voir les revenus',
      add: '+ Ajouter une dépense',
      emptytoday: 'Aucune dépense aujourd’hui.',
      emptycycle: 'Aucune dépense pendant ce cycle.',
    },
    edit: {
      close: 'Fermer',
      title: 'Modifier la dépense',
      amount: 'Montant',
      date: 'Date',
      save: 'Enregistrer',
      delete: '🗑️ Supprimer la dépense',
      confirm: 'Touchez à nouveau pour confirmer',
    },
    limit: 'Montant maximum\u00a0: 1.000.000\u00a0€',
  },
  goals: {
    eta: 'À ce rythme, vous l’atteindrez dans environ {months} mois.',
    confirmdelete: 'Confirmer\u00a0?',
    contribute: '+ Ajouter',
  },
  radar: {
    preview: {
      title: 'Mon Radar',
      all: 'Tout voir',
      allcount: 'Tout voir ({count})',
      usual: 'par rapport à d’habitude',
      learning: '🔍 J’apprends encore vos habitudes ({seen}/{needed} cycles).',
      quiet: 'Rien d’inhabituel à signaler pour le moment.',
    },
  },
}
