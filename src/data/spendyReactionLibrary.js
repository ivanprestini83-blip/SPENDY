// Spendy's approved reaction phrase library — the ONLY source of text
// for the expense-reaction engine (see utils/expenseReactionEngine.js).
//
// ⚠️ VINCOLO ASSOLUTO: queste frasi sono il contenuto ufficiale approvato.
// Non vanno inventate, modificate, riscritte o generate dall'AI — ogni
// riga qui sotto è trascritta esattamente come fornita. La logica di
// SELEZIONE (quale gruppo usare, quale frase scegliere, come evitare le
// ripetizioni) vive interamente in expenseReactionEngine.js; questo file
// è puro contenuto, senza alcuna logica.
//
// Nuove frasi vanno aggiunte qui manualmente in futuro — mai generate
// automaticamente.

// 🛍️ 1. SPESA >100 € — SORPRESA IMMEDIATA
export const SPESA_100 = [
  'Ops. Sono spariti più di 100 €. Li hai visti?',
  'Oltre 100 €? Così, senza nemmeno avvisarmi?',
  'Aspetta… quanto hai appena speso?!',
  '100 € superati. Il tuo conto ha appena deglutito.',
  'E niente, oggi il conto corrente non festeggia.',
  'Questa non è più una piccola spesa. È una dichiarazione.',
  'Più di 100 €? Abbiamo perso il senso della misura?',
  'Io avrei almeno chiesto il permesso al portafoglio.',
  'Interessante… avevamo proprio deciso di spendere così tanto?',
  'Questa cifra merita almeno una spiegazione.',
]

// 🛒 2. SPESA APPARENTEMENTE INUTILE
export const SPESA_INUTILE = [
  'Scusa, ma questa cosa ci serviva davvero?',
  'Hai appena comprato qualcosa che cinque minuti fa non sapevi nemmeno esistesse.',
  'Il bisogno è nato dopo aver visto il prezzo, vero?',
  'Complimenti: hai trasformato soldi veri in una cosa.',
  'Non giudico. Però sto giudicando.',
  'Dimmi che almeno la userai più di due volte.',
  'Questa spesa ha una domanda importante: perché?',
  'Il tuo conto avrebbe preferito non conoscerla.',
  'Era un bisogno o un colpo di fulmine?',
  'Bella. Ma necessaria? Questa è un’altra storia.',
]

// 🍕 3. TROPPI SOLDI IN UNA CATEGORIA
export const CATEGORIA_ECCESSIVA_RISTORANTI = [
  'A questo punto il ristorante potrebbe intestarti un tavolo.',
  'Mangiare bene sì. Mangiare il budget no.',
  'Il tuo delivery conosce meglio te di me.',
  'In questo ciclo hai finanziato più ristoranti che il tuo futuro.',
  'Il cuoco ti ringrazia. Il conto un po’ meno.',
]

export const CATEGORIA_ECCESSIVA_SHOPPING = [
  'L’armadio sta facendo gli straordinari.',
  'Hai ancora spazio nell’armadio o compriamo direttamente un armadio nuovo?',
  'Un altro acquisto. La carta ormai ti conosce per nome.',
  'Il problema non è comprare. È che non sembra tu voglia smettere.',
]

export const CATEGORIA_ECCESSIVA_AUTO = [
  'La macchina è contenta. Il tuo conto molto meno.',
  'Con questa cifra almeno dovrebbe lavarti anche la macchina.',
]

// 🚨 4. BUDGET SUPERATO
export const BUDGET_SUPERATO = [
  'Houston, abbiamo un problema.',
  'Budget superato. Io l’avevo detto.',
  'Il budget era un limite, non una sfida.',
  'Abbiamo appena attraversato quella linea rossa.',
  'Tecnicamente puoi continuare. Ma io non lo farei.',
  'Il tuo budget ti sta mandando segnali di fumo.',
  'Ecco perché avevamo messo un budget.',
  'Il budget è finito. Le spese invece sembrano stare benissimo.',
]

// 🔥 5. SPESA ENORME — €500–999
export const SPESA_ENORME_500 = [
  '500 €?! Aspetta, mi devo sedere.',
  'Questa non è una spesa. È un evento.',
  'Il conto corrente ha appena chiesto una pausa.',
  '500 € evaporati. Almeno salutali.',
  'Ok. Questa la voglio proprio capire.',
  'Per questa cifra pretendo almeno una bella storia.',
]

// 🔥 5. SPESA ENORME — €1.000+
export const SPESA_ENORME_1000 = [
  '1.000 €?! Io sono una volpe, non un investigatore.',
  'FERMO. Qui dobbiamo parlarne.',
  'Mille euro?! Il tuo conto ha appena visto la luce.',
  'Questa spesa ha bisogno di una conferenza stampa.',
  'Io non giudico. Ma questa cifra si giudica da sola.',
  'Dimmi che è una spesa importante. Ti prego.',
  'Per un attimo ho pensato fosse un errore di battitura.',
]

// 🔁 6. SPESA RIPETUTA
export const SPESA_RIPETUTA = [
  'Ancora? Questa categoria ormai ti sta diventando familiare.',
  'Ci rivediamo. Di nuovo.',
  'Non era già successo?',
  'Comincio a pensare che questa spesa ti piaccia.',
  'La prima volta era una spesa. La seconda è una tradizione.',
  'Ancora questa? Almeno siete felici insieme.',
  'Ok, questa ormai è una relazione seria.',
]

// 📈 7. STAI SPENDENDO PIÙ DEL SOLITO
export const AUMENTO_ANOMALO = [
  'Ehi… ultimamente stai spendendo un po’ più del solito.',
  'Ho notato una cosa. Le tue spese stanno accelerando.',
  'In questo ciclo il ritmo è diverso. Tutto bene?',
  'Non voglio allarmarti, ma il tuo conto sta correndo.',
  'Ultimamente la carta sta lavorando parecchio.',
  'Mi sa che in questo ciclo siamo un po’ più generosi del solito.',
]

// 🎯 8. HAI DANNEGGIATO UN OBIETTIVO
// NB: "La vacanza si è appena allontanata di qualche giorno." va usata
// SOLO quando l'obiettivo in questione è effettivamente una vacanza —
// vedi VACATION_ONLY_PHRASE più sotto e come expenseReactionEngine.js
// la filtra.
export const OBIETTIVO_DANNEGGIATO = [
  'Questa spesa ha appena fatto un passo indietro verso il tuo obiettivo.',
  'Eravamo più vicini. Adesso un pochino meno.',
  'La vacanza si è appena allontanata di qualche giorno.',
  'Il tuo obiettivo ti sta guardando.',
  'Quei soldi potevano avvicinarti al traguardo.',
  'Niente panico. Ma il tuo obiettivo ha sicuramente notato questa spesa.',
]

// Only this one phrase in OBIETTIVO_DANNEGGIATO names a vacation —
// excluded from the pool unless the actual goal is vacation-related.
export const VACATION_ONLY_PHRASE = 'La vacanza si è appena allontanata di qualche giorno.'

// 💚 9. BUONA SCELTA
export const BUONA_SCELTA = [
  'Ecco. Questa mi piace.',
  'Finalmente una spesa con un senso.',
  'Bravissimo. Il conto approva.',
  'Questa volta hai pensato prima di spendere.',
  'Così si fa.',
  'Il tuo futuro te stesso ti ringrazia.',
  'Questa è una decisione che mi piace.',
  'Vedi? Non sono qui solo per romperti le scatole.',
]

// 🏆 10. RISPARMIO
export const RISPARMIO = [
  'Hai speso meno del previsto. Mi sto emozionando.',
  'Oggi il portafoglio può dormire tranquillo.',
  'Soldi rimasti nel conto: incredibile.',
  'Questa volta abbiamo resistito.',
  'Un piccolo risparmio oggi, una bella sorpresa domani.',
  'Bravi noi.',
  'Questa volta non ho niente da rimproverarti. Strano.',
]

// 😂 11. FRASI RARE / SPECIALI — bassa probabilità, per l'effetto sorpresa.
export const RARE_SPECIALI = [
  'Non sono arrabbiata. Sono solo delusa.',
  'Parliamone.',
  'Metti giù la carta.',
  'No.',
  'Io non ho parole. E sono una volpe.',
  'Questa me la devi spiegare.',
  'Fingi che non sia successo. Io non posso.',
  'Ok… facciamo finta di niente.',
  'Abbiamo perso il controllo. Elegantemente, ma l’abbiamo perso.',
  'Bene. Ora torniamo a comportarci da adulti.',
]

// --- Le stesse reazioni in inglese, spagnolo e francese ----------------------
//
// Autorizzate da Ivan l'8 ottobre 2026 (Fase 4A del multilingue): l'italiano
// qui sopra resta il testo ufficiale e non cambia. Ogni gruppo ha le stesse
// frasi NELLO STESSO ORDINE dell'italiano: expenseReactionEngine.js sceglie
// per posizione, quindi la stessa scelta dà la stessa reazione in ogni lingua.
// Spendy parla di sé al femminile ("delusa", "arrabbiata"), come in italiano.

const IT = {
  SPESA_100, SPESA_INUTILE, CATEGORIA_ECCESSIVA_RISTORANTI, CATEGORIA_ECCESSIVA_SHOPPING, CATEGORIA_ECCESSIVA_AUTO,
  BUDGET_SUPERATO, SPESA_ENORME_500, SPESA_ENORME_1000, SPESA_RIPETUTA, AUMENTO_ANOMALO,
  OBIETTIVO_DANNEGGIATO, VACATION_ONLY_PHRASE, BUONA_SCELTA, RISPARMIO, RARE_SPECIALI,
}

const EN_GOAL_DAMAGED = [
  'This expense just took a step back from your goal.',
  'We were closer. Now a little less.',
  'Your holiday just moved a few days further away.',
  'Your goal is watching you.',
  'That money could have brought you closer to the finish line.',
  'No panic. But your goal definitely noticed this one.',
]

const EN = {
  SPESA_100: [
    'Oops. Over 100 € just vanished. Did you see them go?',
    'Over 100 €? Just like that, without even warning me?',
    'Wait… how much did you just spend?!',
    '100 € and counting. Your account just gulped.',
    'Well, your bank account isn’t celebrating today.',
    'This isn’t a small purchase anymore. It’s a statement.',
    'More than 100 €? Have we lost all sense of proportion?',
    'I’d have at least asked your wallet for permission.',
    'Interesting… did we really decide to spend that much?',
    'This amount deserves at least an explanation.',
  ],
  SPESA_INUTILE: [
    'Sorry, but did we really need this?',
    'You just bought something you didn’t know existed five minutes ago.',
    'The need showed up after you saw the price, right?',
    'Congratulations: you turned real money into a thing.',
    'I’m not judging. Okay, I’m judging.',
    'Tell me you’ll at least use it more than twice.',
    'This purchase raises one big question: why?',
    'Your account would rather not have met it.',
    'Was it a need or love at first sight?',
    'Lovely. But necessary? That’s another story.',
  ],
  CATEGORIA_ECCESSIVA_RISTORANTI: [
    'At this point the restaurant could name a table after you.',
    'Eating well, yes. Eating the budget, no.',
    'Your delivery app knows you better than I do.',
    'This cycle you’ve funded more restaurants than your future.',
    'The chef thanks you. Your account, a bit less.',
  ],
  CATEGORIA_ECCESSIVA_SHOPPING: [
    'Your wardrobe is working overtime.',
    'Is there still room in your wardrobe, or do we just buy a new wardrobe?',
    'Another purchase. Your card knows you by name now.',
    'Buying isn’t the problem. It’s that you don’t seem to want to stop.',
  ],
  CATEGORIA_ECCESSIVA_AUTO: [
    'Your car is happy. Your account, much less so.',
    'For that amount, it should at least wash itself too.',
  ],
  BUDGET_SUPERATO: [
    'Houston, we have a problem.',
    'Budget blown. I did warn you.',
    'The budget was a limit, not a challenge.',
    'We just crossed that red line.',
    'Technically you can keep going. But I wouldn’t.',
    'Your budget is sending smoke signals.',
    'This is exactly why we set a budget.',
    'The budget’s gone. The spending, on the other hand, seems to be doing great.',
  ],
  SPESA_ENORME_500: [
    '500 €?! Hang on, I need to sit down.',
    'This isn’t a purchase. It’s an event.',
    'Your bank account just asked for a break.',
    '500 € evaporated. At least wave goodbye.',
    'Okay. This one I really want to understand.',
    'For that amount, I expect at least a good story.',
  ],
  SPESA_ENORME_1000: [
    '1.000 €?! I’m a fox, not a detective.',
    'STOP. We need to talk about this.',
    'A thousand euros?! Your account just saw its life flash before its eyes.',
    'This purchase needs a press conference.',
    'I’m not judging. But this amount speaks for itself.',
    'Tell me it’s something important. Please.',
    'For a second I thought it was a typo.',
  ],
  SPESA_RIPETUTA: [
    'Again? This category is starting to feel like family.',
    'Here we are again. Again.',
    'Hasn’t this happened before?',
    'I’m starting to think you like this one.',
    'The first time it was a purchase. The second time, it’s a tradition.',
    'This again? At least you two are happy together.',
    'Okay, this is officially a serious relationship.',
  ],
  AUMENTO_ANOMALO: [
    'Hey… lately you’ve been spending a bit more than usual.',
    'I noticed something. Your spending is picking up speed.',
    'The pace is different this cycle. Everything okay?',
    'I don’t want to alarm you, but your account is running.',
    'Your card has been working pretty hard lately.',
    'Looks like we’re a little more generous than usual this cycle.',
  ],
  OBIETTIVO_DANNEGGIATO: EN_GOAL_DAMAGED,
  VACATION_ONLY_PHRASE: EN_GOAL_DAMAGED[2],
  BUONA_SCELTA: [
    'There we go. I like this one.',
    'Finally, a purchase that makes sense.',
    'Well done. Your account approves.',
    'This time you thought before spending.',
    'That’s how it’s done.',
    'Future you says thanks.',
    'Now that’s a decision I like.',
    'See? I’m not just here to nag you.',
  ],
  RISPARMIO: [
    'You spent less than expected. I’m getting emotional.',
    'Your wallet can sleep soundly tonight.',
    'Money still in the account: incredible.',
    'This time we held out.',
    'A little saving today, a nice surprise tomorrow.',
    'Go us.',
    'This time I’ve got nothing to scold you about. Weird.',
  ],
  RARE_SPECIALI: [
    'I’m not angry. I’m just disappointed.',
    'Let’s talk.',
    'Put the card down.',
    'No.',
    'I’m speechless. And I’m a fox.',
    'You’re going to have to explain this one.',
    'Pretend it didn’t happen. I can’t.',
    'Okay… let’s act like nothing happened.',
    'We lost control. Elegantly, but we lost it.',
    'Right. Now let’s go back to behaving like adults.',
  ],
}

const ES_GOAL_DAMAGED = [
  'Este gasto acaba de dar un paso atrás en tu objetivo.',
  'Estábamos más cerca. Ahora un poquito menos.',
  'Las vacaciones se acaban de alejar unos días.',
  'Tu objetivo te está mirando.',
  'Ese dinero podía acercarte a la meta.',
  'Que no cunda el pánico. Pero tu objetivo se ha dado cuenta de este gasto.',
]

const ES = {
  SPESA_100: [
    'Ups. Han desaparecido más de 100 €. ¿Los has visto?',
    '¿Más de 100 €? ¿Así, sin avisarme siquiera?',
    'Espera… ¡¿cuánto acabas de gastar?!',
    '100 € superados. Tu cuenta acaba de tragar saliva.',
    'Pues nada, hoy la cuenta corriente no está de fiesta.',
    'Esto ya no es un gasto pequeño. Es una declaración de intenciones.',
    '¿Más de 100 €? ¿Hemos perdido el sentido de la medida?',
    'Yo al menos le habría pedido permiso a la cartera.',
    'Interesante… ¿de verdad habíamos decidido gastar tanto?',
    'Esta cifra merece al menos una explicación.',
  ],
  SPESA_INUTILE: [
    'Perdona, pero ¿de verdad nos hacía falta esto?',
    'Acabas de comprar algo que hace cinco minutos ni sabías que existía.',
    'La necesidad apareció después de ver el precio, ¿verdad?',
    'Enhorabuena: has convertido dinero de verdad en una cosa.',
    'No juzgo. Bueno, sí estoy juzgando.',
    'Dime que al menos lo usarás más de dos veces.',
    'Este gasto plantea una gran pregunta: ¿por qué?',
    'Tu cuenta habría preferido no conocerlo.',
    '¿Era una necesidad o un flechazo?',
    'Bonito. ¿Pero necesario? Eso ya es otra historia.',
  ],
  CATEGORIA_ECCESSIVA_RISTORANTI: [
    'A estas alturas el restaurante podría ponerle tu nombre a una mesa.',
    'Comer bien, sí. Comerse el presupuesto, no.',
    'Tu app de comida a domicilio te conoce mejor que yo.',
    'Este ciclo has financiado más restaurantes que tu futuro.',
    'El cocinero te da las gracias. Tu cuenta, un poco menos.',
  ],
  CATEGORIA_ECCESSIVA_SHOPPING: [
    'El armario está haciendo horas extra.',
    '¿Aún te cabe algo en el armario o compramos directamente un armario nuevo?',
    'Otra compra. La tarjeta ya te llama por tu nombre.',
    'El problema no es comprar. Es que no parece que quieras parar.',
  ],
  CATEGORIA_ECCESSIVA_AUTO: [
    'El coche está contento. Tu cuenta, mucho menos.',
    'Por esa cifra, al menos debería lavarse solo.',
  ],
  BUDGET_SUPERATO: [
    'Houston, tenemos un problema.',
    'Presupuesto superado. Yo ya lo había dicho.',
    'El presupuesto era un límite, no un reto.',
    'Acabamos de cruzar la línea roja.',
    'Técnicamente puedes seguir. Pero yo no lo haría.',
    'Tu presupuesto te está enviando señales de humo.',
    'Por esto pusimos un presupuesto.',
    'El presupuesto se ha acabado. Los gastos, en cambio, están estupendamente.',
  ],
  SPESA_ENORME_500: [
    '¡¿500 €?! Espera, que me tengo que sentar.',
    'Esto no es un gasto. Es un acontecimiento.',
    'La cuenta corriente acaba de pedir un descanso.',
    '500 € evaporados. Al menos diles adiós.',
    'Vale. Este sí que lo quiero entender.',
    'Por esta cifra exijo al menos una buena historia.',
  ],
  SPESA_ENORME_1000: [
    '¡¿1.000 €?! Soy una raposa, no una detective.',
    'ALTO. Aquí tenemos que hablar.',
    '¡¿Mil euros?! Tu cuenta acaba de ver la luz al final del túnel.',
    'Este gasto necesita una rueda de prensa.',
    'No juzgo. Pero esta cifra se juzga sola.',
    'Dime que es un gasto importante. Te lo ruego.',
    'Por un momento pensé que era una errata.',
  ],
  SPESA_RIPETUTA: [
    '¿Otra vez? Esta categoría ya empieza a ser de la familia.',
    'Nos volvemos a ver. Otra vez.',
    '¿No había pasado ya esto?',
    'Empiezo a pensar que este gasto te gusta.',
    'La primera vez fue un gasto. La segunda, una tradición.',
    '¿Otra vez esto? Al menos sois felices juntos.',
    'Vale, esto ya es una relación seria.',
  ],
  AUMENTO_ANOMALO: [
    'Oye… últimamente estás gastando un poco más de lo habitual.',
    'He notado algo. Tus gastos están acelerando.',
    'En este ciclo el ritmo es distinto. ¿Todo bien?',
    'No quiero alarmarte, pero tu cuenta va a toda velocidad.',
    'Últimamente la tarjeta está trabajando mucho.',
    'Me parece que en este ciclo estamos un poco más generosos de lo habitual.',
  ],
  OBIETTIVO_DANNEGGIATO: ES_GOAL_DAMAGED,
  VACATION_ONLY_PHRASE: ES_GOAL_DAMAGED[2],
  BUONA_SCELTA: [
    'Eso es. Esto me gusta.',
    'Por fin un gasto con sentido.',
    'Muy bien. La cuenta lo aprueba.',
    'Esta vez has pensado antes de gastar.',
    'Así se hace.',
    'Tu yo del futuro te lo agradece.',
    'Esta es una decisión que me gusta.',
    '¿Ves? No estoy aquí solo para darte la lata.',
  ],
  RISPARMIO: [
    'Has gastado menos de lo previsto. Me estoy emocionando.',
    'Hoy la cartera puede dormir tranquila.',
    'Dinero que se queda en la cuenta: increíble.',
    'Esta vez hemos resistido.',
    'Un pequeño ahorro hoy, una bonita sorpresa mañana.',
    'Bien por nosotros.',
    'Esta vez no tengo nada que reprocharte. Qué raro.',
  ],
  RARE_SPECIALI: [
    'No estoy enfadada. Solo decepcionada.',
    'Hablemos.',
    'Suelta la tarjeta.',
    'No.',
    'Me he quedado sin palabras. Y eso que soy una raposa.',
    'Esto me lo tienes que explicar.',
    'Haz como si no hubiera pasado. Yo no puedo.',
    'Vale… hagamos como si nada.',
    'Hemos perdido el control. Con elegancia, pero lo hemos perdido.',
    'Bien. Ahora volvamos a comportarnos como adultos.',
  ],
}

const FR_GOAL_DAMAGED = [
  'Cette dépense vient de faire reculer votre objectif d’un pas.',
  'On était plus près. Maintenant, un peu moins.',
  'Les vacances viennent de s’éloigner de quelques jours.',
  'Votre objectif vous regarde.',
  'Cet argent aurait pu vous rapprocher de la ligne d’arrivée.',
  'Pas de panique. Mais votre objectif a forcément remarqué cette dépense.',
]

const FR = {
  SPESA_100: [
    'Oups. Plus de 100 € viennent de disparaître. Vous les avez vus ?',
    'Plus de 100 € ? Comme ça, sans même me prévenir ?',
    'Attendez… vous venez de dépenser combien ?!',
    '100 € dépassés. Votre compte vient d’avaler de travers.',
    'Bon, aujourd’hui le compte courant ne fait pas la fête.',
    'Ce n’est plus une petite dépense. C’est une déclaration.',
    'Plus de 100 € ? On a perdu le sens de la mesure ?',
    'Moi, j’aurais au moins demandé la permission au portefeuille.',
    'Intéressant… on avait vraiment décidé de dépenser autant ?',
    'Ce montant mérite au moins une explication.',
  ],
  SPESA_INUTILE: [
    'Pardon, mais on en avait vraiment besoin ?',
    'Vous venez d’acheter un truc dont vous ignoriez l’existence il y a cinq minutes.',
    'Le besoin est apparu après avoir vu le prix, non ?',
    'Félicitations : vous avez transformé de l’argent bien réel en objet.',
    'Je ne juge pas. Bon, si, je juge.',
    'Dites-moi que vous allez au moins vous en servir plus de deux fois.',
    'Cette dépense pose une grande question : pourquoi ?',
    'Votre compte aurait préféré ne jamais la croiser.',
    'C’était un besoin ou un coup de foudre ?',
    'Joli. Mais nécessaire ? Ça, c’est une autre histoire.',
  ],
  CATEGORIA_ECCESSIVA_RISTORANTI: [
    'À ce stade, le restaurant pourrait donner votre nom à une table.',
    'Bien manger, oui. Manger le budget, non.',
    'Votre appli de livraison vous connaît mieux que moi.',
    'Ce cycle-ci, vous avez financé plus de restaurants que votre avenir.',
    'Le chef vous remercie. Votre compte, un peu moins.',
  ],
  CATEGORIA_ECCESSIVA_SHOPPING: [
    'Votre armoire fait des heures sup.',
    'Il reste de la place dans l’armoire, ou on achète directement une nouvelle armoire ?',
    'Encore un achat. Votre carte vous appelle par votre prénom, maintenant.',
    'Le problème, ce n’est pas d’acheter. C’est que vous n’avez pas l’air de vouloir arrêter.',
  ],
  CATEGORIA_ECCESSIVA_AUTO: [
    'La voiture est contente. Votre compte, beaucoup moins.',
    'À ce prix-là, elle devrait au moins se laver toute seule.',
  ],
  BUDGET_SUPERATO: [
    'Houston, on a un problème.',
    'Budget dépassé. Je l’avais bien dit.',
    'Le budget était une limite, pas un défi.',
    'On vient de franchir la ligne rouge.',
    'Techniquement, vous pouvez continuer. Mais moi, je ne le ferais pas.',
    'Votre budget vous envoie des signaux de fumée.',
    'Voilà pourquoi on avait fixé un budget.',
    'Le budget est épuisé. Les dépenses, elles, ont l’air de très bien se porter.',
  ],
  SPESA_ENORME_500: [
    '500 € ?! Attendez, il faut que je m’assoie.',
    'Ce n’est pas une dépense. C’est un événement.',
    'Le compte courant vient de demander une pause.',
    '500 € envolés. Faites-leur au moins un signe de la main.',
    'D’accord. Celle-là, je veux vraiment la comprendre.',
    'Pour ce montant, j’exige au moins une belle histoire.',
  ],
  SPESA_ENORME_1000: [
    '1.000 € ?! Je suis une renarde, pas une détective.',
    'STOP. Là, il faut qu’on en parle.',
    'Mille euros ?! Votre compte vient de voir sa vie défiler.',
    'Cette dépense mérite une conférence de presse.',
    'Je ne juge pas. Mais ce montant se juge tout seul.',
    'Dites-moi que c’est une dépense importante. Je vous en prie.',
    'Un instant, j’ai cru à une faute de frappe.',
  ],
  SPESA_RIPETUTA: [
    'Encore ? Cette catégorie commence à faire partie de la famille.',
    'On se revoit. Encore.',
    'Ce n’était pas déjà arrivé ?',
    'Je commence à croire que cette dépense vous plaît.',
    'La première fois, c’était une dépense. La deuxième, c’est une tradition.',
    'Encore celle-là ? Au moins, vous êtes heureux ensemble.',
    'Bon, là, c’est une relation sérieuse.',
  ],
  AUMENTO_ANOMALO: [
    'Dites… ces derniers temps, vous dépensez un peu plus que d’habitude.',
    'J’ai remarqué quelque chose. Vos dépenses accélèrent.',
    'Ce cycle-ci, le rythme est différent. Tout va bien ?',
    'Je ne veux pas vous alarmer, mais votre compte file à toute allure.',
    'Ces derniers temps, la carte travaille beaucoup.',
    'J’ai l’impression que ce cycle-ci, on est un peu plus généreux que d’habitude.',
  ],
  OBIETTIVO_DANNEGGIATO: FR_GOAL_DAMAGED,
  VACATION_ONLY_PHRASE: FR_GOAL_DAMAGED[2],
  BUONA_SCELTA: [
    'Voilà. Celle-là, elle me plaît.',
    'Enfin une dépense qui a du sens.',
    'Bravo. Le compte approuve.',
    'Cette fois, vous avez réfléchi avant de dépenser.',
    'C’est comme ça qu’on fait.',
    'Votre vous du futur vous remercie.',
    'Ça, c’est une décision qui me plaît.',
    'Vous voyez ? Je ne suis pas là que pour vous embêter.',
  ],
  RISPARMIO: [
    'Vous avez dépensé moins que prévu. Je suis émue.',
    'Aujourd’hui, le portefeuille peut dormir tranquille.',
    'De l’argent resté sur le compte : incroyable.',
    'Cette fois, on a résisté.',
    'Une petite économie aujourd’hui, une belle surprise demain.',
    'Bravo à nous.',
    'Cette fois, je n’ai rien à vous reprocher. Bizarre.',
  ],
  RARE_SPECIALI: [
    'Je ne suis pas fâchée. Je suis juste déçue.',
    'Parlons-en.',
    'Posez cette carte.',
    'Non.',
    'Je n’ai pas de mots. Et pourtant, je suis une renarde.',
    'Celle-là, il va falloir me l’expliquer.',
    'Faites comme si ça n’était pas arrivé. Moi, je ne peux pas.',
    'Bon… on fait comme si de rien n’était.',
    'On a perdu le contrôle. Avec élégance, mais on l’a perdu.',
    'Bien. Maintenant, on recommence à se comporter en adultes.',
  ],
}

// Tutte le lingue: expenseReactionEngine.js sceglie quella corrente
// (italiano per una lingua sconosciuta).
export const REACTION_LIBRARY = { it: IT, en: EN, es: ES, fr: FR }
