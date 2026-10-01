-- ============================================================================
-- SPENDY — quota giornaliera di Spendy AI (tabella ai_usage)
-- ============================================================================
-- Da incollare nell'SQL Editor di Supabase DOPO schema.sql, e PRIMA di
-- ridistribuire la Edge Function `spendy-ai` (la funzione, senza questa
-- tabella, rifiuta ogni chiamata AI invece di lasciarla passare).
-- È idempotente: rilanciarlo non distrugge dati. Non tocca nessuna delle
-- tabelle di schema.sql.
--
-- Cosa protegge: il costo delle chiamate al modello. Il limite nell'app
-- (3 al giorno in localStorage) resta, ma è solo un primo filtro: questo
-- è quello che il client non può aggirare.
--
-- Chi scrive: SOLO la Edge Function, con la chiave service_role che vive
-- tra i secret di Supabase. L'app (anon / authenticated) può al massimo
-- LEGGERE le proprie righe: non può inserirle, modificarle, cancellarle,
-- né chiamare le due funzioni qui sotto.
--
-- Giornata = data UTC, calcolata dalla Edge Function. Per l'Italia la
-- quota riparte all'01:00 (ora solare) o alle 02:00 (ora legale).
-- ============================================================================

create table if not exists public.ai_usage (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  usage_date  date        not null,
  call_count  integer     not null default 0 check (call_count >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Una sola riga per utente e giorno: è la chiave su cui si appoggia
  -- l'incremento atomico (on conflict) di spendy_ai_reserve.
  primary key (user_id, usage_date)
);

alter table public.ai_usage enable row level security;

-- Lettura delle proprie righe (utile per mostrare in futuro "ti restano N
-- frasi oggi"). Nessuna policy di insert/update/delete: con la RLS attiva,
-- per anon e authenticated ogni scrittura è negata.
drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated using (auth.uid() = user_id);

-- Seconda barriera, indipendente dalla RLS: niente permessi di scrittura
-- per i ruoli dell'app.
revoke insert, update, delete, truncate on public.ai_usage from anon, authenticated;

-- ------------------------------------------------------------ prenotazione

-- Prenota UNA chiamata per (utente, giorno) se il limite non è raggiunto.
-- Controllo e incremento sono la stessa istruzione: con due richieste
-- contemporanee, la seconda aspetta il lock sulla riga della prima e
-- rivaluta `call_count < p_limit` sul valore già incrementato. Non esiste
-- un momento in cui entrambe "leggono 2" e passano tutte e due.
create or replace function public.spendy_ai_reserve(p_user_id uuid, p_usage_date date, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_usage_date is null or p_limit is null or p_limit < 1 then
    raise exception 'spendy_ai_reserve: argomenti non validi';
  end if;

  insert into public.ai_usage as u (user_id, usage_date, call_count)
  values (p_user_id, p_usage_date, 1)
  on conflict (user_id, usage_date) do update
    set call_count = u.call_count + 1,
        updated_at = now()
    where u.call_count < p_limit
  returning u.call_count into v_count;

  if v_count is not null then
    return query select true, v_count;
    return;
  end if;

  -- Limite raggiunto: nessuna riga toccata.
  select u.call_count into v_count
  from public.ai_usage u
  where u.user_id = p_user_id and u.usage_date = p_usage_date;
  return query select false, coalesce(v_count, 0);
end;
$$;

-- --------------------------------------------------------------- rilascio

-- Restituisce la chiamata prenotata quando è certo che il provider non ha
-- fatturato nulla: errore prima dell'invio, oppure rifiuto esplicito con
-- HTTP 400, 401, 403, 404, 429 o 529 (decide la Edge Function, vedi quota.js). Timeout,
-- rete e 5xx NON la restituiscono. Mai sotto zero.
create or replace function public.spendy_ai_release(p_user_id uuid, p_usage_date date)
returns integer
language sql
set search_path = ''
as $$
  update public.ai_usage
  set call_count = greatest(call_count - 1, 0),
      updated_at = now()
  where user_id = p_user_id and usage_date = p_usage_date
  returning call_count;
$$;

-- Solo la Edge Function (service_role) può chiamarle. Senza questi revoke,
-- Supabase le esporrebbe via /rest/v1/rpc anche all'app — e spendy_ai_release
-- permetterebbe a chiunque di azzerarsi il contatore.
revoke all on function public.spendy_ai_reserve(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.spendy_ai_release(uuid, date) from public, anon, authenticated;
grant execute on function public.spendy_ai_reserve(uuid, date, integer) to service_role;
grant execute on function public.spendy_ai_release(uuid, date) to service_role;

-- ============================================================================
-- VERSIONE 2 — limite mensile, tetto globale giornaliero, misura dei token
-- ============================================================================
-- Tutto quello che segue è AGGIUNTO: spendy_ai_reserve e spendy_ai_release qui
-- sopra restano com'erano (la Edge Function già pubblicata continua a
-- funzionare finché non viene ridistribuita, e tornare indietro = ridistribuire
-- la versione precedente). Idempotente, come il resto del file.
--
-- Ordine: eseguire questo file nell'SQL Editor PRIMA di ridistribuire la
-- funzione `spendy-ai`.
--
--  1. Colonne per i token: SOLO numeri (token e conteggi, più l'id del
--     modello che ha risposto). Mai prompt, risposte, email, importi.
--       input_tokens, output_tokens  somma dei token FATTURATI, quelli che
--                                    Anthropic restituisce in `usage`
--       usage_calls                  quante chiamate hanno restituito `usage`
--                                    (call_count - usage_calls = chiamate
--                                    consumate di cui non conosciamo i token,
--                                    per esempio un timeout: quelle sono le
--                                    uniche da STIMARE, mai mescolate qui)
--       models                       { "<id modello>": { calls, input_tokens,
--                                    output_tokens } }: il modello che ha
--                                    DAVVERO risposto (con i fallback del
--                                    server può non essere quello configurato)
alter table public.ai_usage add column if not exists input_tokens  bigint  not null default 0;
alter table public.ai_usage add column if not exists output_tokens bigint  not null default 0;
alter table public.ai_usage add column if not exists usage_calls   integer not null default 0;
alter table public.ai_usage add column if not exists models        jsonb   not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_usage_usage_nonnegative' and conrelid = 'public.ai_usage'::regclass) then
    alter table public.ai_usage
      add constraint ai_usage_usage_nonnegative
      check (input_tokens >= 0 and output_tokens >= 0 and usage_calls >= 0);
  end if;
end
$$;

-- Serve alla somma del giorno (limite globale) e alla somma del mese.
create index if not exists ai_usage_usage_date_idx on public.ai_usage (usage_date);

-- ------------------------------------------------- prenotazione, versione 2

-- Prenota UNA chiamata se TUTTI e tre i limiti lo consentono:
--   daily    chiamate di questo utente in questa giornata (UTC)
--   monthly  chiamate di questo utente nel mese di calendario (UTC) della giornata
--   global   chiamate di TUTTI gli utenti in questa giornata
-- Se uno è raggiunto non tocca niente e dice quale (reason):
--   'daily' | 'monthly' | 'global'   (in quest'ordine, se ne scattano più d'uno)
--
-- Concorrenza: l'intera valutazione avviene sotto un lock di transazione
-- (pg_advisory_xact_lock) che serializza le prenotazioni di TUTTI. Due richieste
-- contemporanee, dello stesso utente o di utenti diversi, non possono quindi
-- leggere entrambe "29 usate" e passare tutte e due. Il lock dura quanto la
-- funzione (millisecondi). Se un giorno le prenotazioni dovessero essere molte
-- al secondo, la somma globale va sostituita da una tabella contatore: finché
-- si parla di migliaia di chiamate al giorno, serializzare è la soluzione
-- più semplice e sicura.
--
-- Il mese e il totale giornaliero sono SEMPRE derivati dalle righe di ai_usage:
-- il rimborso (spendy_ai_release) li corregge da solo, senza altro stato.
create or replace function public.spendy_ai_reserve_v2(
  p_user_id uuid,
  p_usage_date date,
  p_daily_limit integer,
  p_monthly_limit integer,
  p_global_daily_limit integer
)
returns table (allowed boolean, reason text, daily_used integer, monthly_used integer, global_used integer)
language plpgsql
set search_path = ''
as $$
declare
  v_first   date;
  v_next    date;
  v_daily   integer;
  v_monthly integer;
  v_global  integer;
begin
  if p_user_id is null or p_usage_date is null
     or p_daily_limit is null or p_daily_limit < 1
     or p_monthly_limit is null or p_monthly_limit < 1
     or p_global_daily_limit is null or p_global_daily_limit < 1 then
    raise exception 'spendy_ai_reserve_v2: argomenti non validi';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('spendy_ai_reserve', 0));

  -- Primo giorno del mese e del mese dopo, in aritmetica di date (nessun fuso).
  v_first := p_usage_date - (extract(day from p_usage_date)::integer - 1);
  v_next  := (v_first + interval '1 month')::date;

  select coalesce(sum(u.call_count), 0)::integer into v_global
  from public.ai_usage u
  where u.usage_date = p_usage_date;

  select coalesce(sum(u.call_count), 0)::integer into v_monthly
  from public.ai_usage u
  where u.user_id = p_user_id and u.usage_date >= v_first and u.usage_date < v_next;

  select coalesce(max(u.call_count), 0)::integer into v_daily
  from public.ai_usage u
  where u.user_id = p_user_id and u.usage_date = p_usage_date;

  if v_daily >= p_daily_limit then
    return query select false, 'daily'::text, v_daily, v_monthly, v_global;
    return;
  end if;
  if v_monthly >= p_monthly_limit then
    return query select false, 'monthly'::text, v_daily, v_monthly, v_global;
    return;
  end if;
  if v_global >= p_global_daily_limit then
    return query select false, 'global'::text, v_daily, v_monthly, v_global;
    return;
  end if;

  insert into public.ai_usage as u (user_id, usage_date, call_count)
  values (p_user_id, p_usage_date, 1)
  on conflict (user_id, usage_date) do update
    set call_count = u.call_count + 1,
        updated_at = now();

  return query select true, null::text, v_daily + 1, v_monthly + 1, v_global + 1;
end;
$$;

-- ----------------------------------------------------- registrazione token

-- Aggiunge ai conteggi del giorno i token FATTURATI di UNA chiamata andata a
-- buon fine (i numeri di `usage` della risposta di Anthropic) e il modello che
-- ha risposto. Solo numeri: l'id del modello viene ripulito e accorciato.
-- Chiamata dalla Edge Function dopo la risposta del modello, mai dall'app.
create or replace function public.spendy_ai_record_usage(
  p_user_id uuid,
  p_usage_date date,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_model text;
begin
  if p_user_id is null or p_usage_date is null
     or p_input_tokens is null or p_input_tokens < 0 or p_input_tokens > 100000000
     or p_output_tokens is null or p_output_tokens < 0 or p_output_tokens > 100000000 then
    raise exception 'spendy_ai_record_usage: argomenti non validi';
  end if;

  v_model := left(regexp_replace(coalesce(p_model, ''), '[^A-Za-z0-9._:/-]', '', 'g'), 80);
  if v_model = '' then
    v_model := 'unknown';
  end if;

  insert into public.ai_usage as u (user_id, usage_date, call_count, input_tokens, output_tokens, usage_calls, models)
  values (
    p_user_id, p_usage_date, 0, p_input_tokens, p_output_tokens, 1,
    jsonb_build_object(v_model, jsonb_build_object('calls', 1, 'input_tokens', p_input_tokens, 'output_tokens', p_output_tokens))
  )
  on conflict (user_id, usage_date) do update
    set input_tokens  = u.input_tokens + p_input_tokens,
        output_tokens = u.output_tokens + p_output_tokens,
        usage_calls   = u.usage_calls + 1,
        models = jsonb_set(
          u.models,
          array[v_model],
          jsonb_build_object(
            'calls',         coalesce((u.models -> v_model ->> 'calls')::bigint, 0) + 1,
            'input_tokens',  coalesce((u.models -> v_model ->> 'input_tokens')::bigint, 0) + p_input_tokens,
            'output_tokens', coalesce((u.models -> v_model ->> 'output_tokens')::bigint, 0) + p_output_tokens
          ),
          true
        ),
        updated_at = now();
end;
$$;

-- Solo la Edge Function (service_role), come per le funzioni di sopra.
revoke all on function public.spendy_ai_reserve_v2(uuid, date, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.spendy_ai_record_usage(uuid, date, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.spendy_ai_reserve_v2(uuid, date, integer, integer, integer) to service_role;
grant execute on function public.spendy_ai_record_usage(uuid, date, text, bigint, bigint) to service_role;

-- Verifica (dopo l'esecuzione):
--   select column_name from information_schema.columns
--   where table_name = 'ai_usage' and column_name in ('input_tokens','output_tokens','usage_calls','models');  -- 4 righe
--   select grantee from information_schema.routine_privileges
--   where routine_name in ('spendy_ai_reserve_v2','spendy_ai_record_usage');   -- service_role (+ owner), MAI anon/authenticated
--   -- somma dei token per mese (i prezzi si applicano FUORI da qui, per modello):
--   --   select date_trunc('month', usage_date) m, sum(call_count) chiamate, sum(usage_calls) con_usage,
--   --          sum(input_tokens) tok_in, sum(output_tokens) tok_out
--   --   from public.ai_usage group by 1 order by 1;

-- ------------------------------------------------------------- verifica
--   select relrowsecurity from pg_class where oid = 'public.ai_usage'::regclass;  -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'ai_usage' and grantee in ('anon', 'authenticated');       -- solo SELECT (o niente)
--   select grantee from information_schema.routine_privileges
--   where routine_name like 'spendy_ai_%';                                         -- service_role (+ owner)
