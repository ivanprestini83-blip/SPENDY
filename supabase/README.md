# Configurazione manuale di Supabase

Tutto quello che va fatto a mano, in ordine. Nessuno di questi passi
viene eseguito automaticamente dall'app o da uno script.

## 1. Creare il progetto

1. [supabase.com](https://supabase.com) → **New project**
2. Regione: **EU Central (Frankfurt)**
3. Salvare la password del database in un posto sicuro (serve solo per
   accessi diretti al DB, non all'app)

## 2. Applicare lo schema

1. Aprire **SQL Editor** nel progetto
2. Incollare tutto il contenuto di [`schema.sql`](./schema.sql) ed eseguirlo
3. Verificare che sia andato a buon fine:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Devono comparire **7 righe, tutte con `rowsecurity = true`**:
`custom_categories`, `emergency_fund_contributions`, `expenses`,
`goal_contributions`, `goals`, `incomes`, `profiles`.
Se una è `false`, quella tabella è leggibile da chiunque: non proseguire.

## 3. Autenticazione

**Authentication → Providers → Email**: deve essere attivo (lo è di default).

**Authentication → Providers → Email → Confirm email**: decidere se
tenerlo acceso. Acceso è più sicuro ma richiede di aprire la mail prima
del primo accesso; spento rende la creazione dell'account immediata.
Per un'app personale con un solo utente, spento va bene.

**Authentication → URL Configuration → Site URL**: mettere l'indirizzo
di Vercel una volta fatto il deploy.

## 4. Collegare l'app

**Project Settings → API**, copiare due valori in un file `.env.local`
nella radice del progetto (già ignorato da git grazie a `*.local`):

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Poi **riavviare il dev server**: Vite legge le variabili d'ambiente solo
all'avvio.

> La chiave `anon` è pubblica per progetto: finisce nel bundle ed è
> normale che sia così. A proteggere i dati sono le policy RLS del punto
> 2, non la segretezza della chiave.
>
> La chiave **`service_role` non va mai** in `.env.local`, nel codice o
> su Vercel come variabile del frontend: scavalca tutte le RLS.

## 5. Verificare l'isolamento fra utenti

Prima di usare l'app con dati veri, creare **due** account di prova e
controllare che il secondo non veda niente del primo. Il test automatico
(`npm test`, sezione 10) verifica la stessa cosa contro un database
simulato, ma la configurazione reale va provata sul progetto reale.

## 6. Deploy su Vercel

1. Caricare il progetto su GitHub
2. Vercel → **Add New → Project** → importare il repository
3. Framework: **Vite** (rilevato in automatico); build `npm run build`,
   output `dist`
4. **Environment Variables**: inserire `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` con gli stessi valori di `.env.local`
5. Dopo il deploy, tornare su Supabase → **Authentication → URL
   Configuration** e mettere l'URL di Vercel come *Site URL*

Da quel momento l'indirizzo dell'app è **sempre lo stesso** su Mac e
Samsung, e il problema che ha fatto "sparire" i dati (IP di rete che
cambia, porta del dev server diversa) non può più ripresentarsi.

## 7. Spendy AI (Edge Function `spendy-ai`)

La vera AI di Spendy passa da una Edge Function: l'app manda solo il
**contesto sintetico** (budget, evento, categoria, eventuale obiettivo)
con la sessione dell'utente; la funzione chiama il modello con la
chiave che sta **solo** tra i secret di Supabase, valida la risposta e
la rimanda all'app. Se qualcosa va storto, l'app mostra la frase locale.

Codice: [`functions/spendy-ai/`](./functions/spendy-ai/) (collegamento
in `index.ts`, logica in `handler.js`), regole condivise con l'app in
[`functions/_shared/spendyAIRules.js`](./functions/_shared/spendyAIRules.js).

### Secret da configurare

**Project Settings → Edge Functions → Secrets** (oppure da terminale,
sotto). Nessuno di questi va in `.env.local`, su Vercel o in una
variabile `VITE_*`.

| Nome | Obbligatorio | Valore |
|---|---|---|
| `AI_PROVIDER` | sì | `anthropic` (l'unico supportato per ora) |
| `AI_MODEL` | sì | l'id del modello; consigliato `claude-opus-5` |
| `AI_API_KEY` | sì | la chiave dell'API Anthropic, creata **dentro un workspace** (es. *Default*): la funzione non invia l'header `anthropic-workspace-id` |
| `AI_EFFORT` | no | `low` consigliato: frasi brevi, più rapide ed economiche |
| `AI_TIMEOUT_MS` | no | default `12000` |
| `AI_MAX_TOKENS` | no | default `2048` |
| `ALLOWED_ORIGINS` | no | es. `https://spendy.vercel.app` (default: tutti, l'accesso è comunque solo con sessione) |

`SUPABASE_URL` e la chiave pubblica li fornisce Supabase da solo.
`ANTHROPIC_WORKSPACE_ID` non è più usato: se è ancora tra i secret viene
ignorato e si può rimuovere con
`npx supabase secrets unset --project-ref riflsimbbajfvxublovr ANTHROPIC_WORKSPACE_ID`.

### Deploy

Serve Node (già installato). Il progetto è `riflsimbbajfvxublovr`.

```bash
npx supabase login
npx supabase secrets set --project-ref riflsimbbajfvxublovr AI_PROVIDER=anthropic AI_MODEL=claude-opus-5 AI_EFFORT=low
npx supabase secrets set --project-ref riflsimbbajfvxublovr AI_API_KEY=la-tua-chiave
npx supabase functions deploy spendy-ai --project-ref riflsimbbajfvxublovr
```

La chiave va digitata solo nel terzo comando, nel tuo terminale: non
salvarla in nessun file del progetto.

> Se il deploy chiede Docker, aggiungere `--use-api`. Se la funzione
> rispondesse 401 anche con la sessione valida (progetti con le nuove
> chiavi di firma JWT), rifare il deploy con `--no-verify-jwt`: la
> funzione verifica comunque l'utente da sola con Supabase Auth.

### Verifica

1. **La funzione è online e rifiuta chi non è autenticato** (deve
   rispondere `401` e `{"error":"unauthenticated"}`):

```bash
curl -i -X POST https://riflsimbbajfvxublovr.supabase.co/functions/v1/spendy-ai -H "Content-Type: application/json" -d '{}'
```

2. **La vera AI risponde nell'app**: fare login in Impostazioni →
   Sincronizzazione, poi aprire la Home con
   `?spendyDebug=1&spendyAI=remote&spendyLimits=off&spendyReset=1`
   (solo con `npm run dev`). Il pannello sotto Spendy deve dire
   **fonte: AI · … · AI: remote**.
3. **Cosa ha ricevuto il modello**: Supabase → Edge Functions →
   `spendy-ai` → **Logs**. Ogni chiamata registra solo metadati, per
   esempio `{"outcome":"ok","event":"big_expense","contextFields":[...]}`:
   mai frasi, importi o nomi.

### Costi e abusi

- L'app chiama la funzione al massimo 3 volte al giorno per dispositivo,
  a distanza di almeno 30 minuti (tranne gli eventi urgenti), e mai due
  volte per la stessa situazione.
- La funzione risponde solo a utenti con una sessione Supabase valida.
  **Se sul progetto la registrazione è aperta, chiunque crei un account
  può usarla**: dopo aver creato il proprio account, disattivare
  *Authentication → Sign In / Providers → Allow new users to sign up*.
- **Quota sul server (la vera protezione)**: massimo 3 chiamate al modello
  al giorno (giornata UTC) per utente, contate nella tabella `ai_usage`
  da [`ai_usage.sql`](./ai_usage.sql). Il limite dell'app resta, ma è solo
  un primo filtro. Oltre la quota la funzione risponde `429` con
  `{"error":"AI_DAILY_LIMIT_REACHED"}` senza chiamare il modello; se il
  provider non risponde (timeout, 5xx, suo rate limit) la chiamata viene
  restituita. Se il database della quota non risponde, niente AI (503).

  **Ordine obbligatorio**: prima incollare `ai_usage.sql` nell'SQL Editor,
  POI rifare il deploy della funzione. Al contrario, la funzione nuova
  troverebbe la tabella mancante e rifiuterebbe tutte le chiamate AI
  (l'app mostrerebbe le frasi locali). La funzione scrive su `ai_usage`
  con la service_role che Supabase le fornisce da solo: nessun secret da
  aggiungere.
