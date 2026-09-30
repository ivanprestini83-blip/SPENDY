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

-- Restituisce la chiamata prenotata quando il provider non ha risposto
-- (timeout, rete, 5xx, limite del provider): un errore temporaneo non deve
-- bruciare una delle 3 frasi del giorno. Mai sotto zero.
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

-- ------------------------------------------------------------- verifica
--   select relrowsecurity from pg_class where oid = 'public.ai_usage'::regclass;  -- true
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'ai_usage' and grantee in ('anon', 'authenticated');       -- solo SELECT (o niente)
--   select grantee from information_schema.routine_privileges
--   where routine_name like 'spendy_ai_%';                                         -- service_role (+ owner)
