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
