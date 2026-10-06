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
