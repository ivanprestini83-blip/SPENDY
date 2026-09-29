// PERSONALITÀ DI SPENDY — chi è, come parla, cosa non deve ripetere.
//
// Il contenuto vero sta in supabase/functions/_shared/spendyAIRules.js,
// l'unico file che l'app e la Supabase Edge Function condividono: il
// prompt che il server manda al modello e le regole di struttura che il
// guard applica devono essere le stesse, sempre.
//
// Il problema che le regole di struttura risolvono: una frase può
// cambiare tutte le parole e restare la stessa frase. "Ecco una categoria
// che non si vedeva da un po'", "Si vede che lo svago è tornato",
// "Rieccolo, lo shopping" sono tre modi di dire "questa categoria è
// tornata"; il controllo sulle parole non se ne accorge, quello sullo
// schema narrativo sì.
export {
  SPENDY_PERSONALITY,
  STYLE_EXAMPLES,
  SPENDY_RESPONSE_SCHEMA,
  buildSpendyPrompt,
  narrativeFrames,
  openingOf,
  hasStaleStructure,
  structureProblems,
} from '../../supabase/functions/_shared/spendyAIRules.js'
