-- ============================================================================
-- SPENDY — schema, indici, trigger, RLS e realtime
-- ============================================================================
-- Da incollare una volta sola nell'SQL Editor di Supabase.
-- È idempotente: rilanciarlo non distrugge dati e non duplica policy.
--
-- MAI eseguito automaticamente da un'app o da uno script: si applica a
-- mano, leggendolo.
--
-- Modello dati, in breve:
--   * `id` è TEXT, non UUID: i nuovi record usano un UUID generato dal
--     client, ma gli id storici di localStorage ('e-1789123456789') entrano
--     nella stessa colonna SENZA essere riscritti. La migrazione diventa
--     così un semplice upsert idempotente — rilanciarla dieci volte non
--     crea un solo duplicato, perché la chiave primaria è già quella che
--     il dispositivo aveva in locale.
--   * DUE timestamp per riga, e la distinzione è il cuore del sync:
--       - client_updated_at: orologio del DISPOSITIVO. Decide chi vince
--         un conflitto (last-write-wins).
--       - updated_at: orologio del SERVER, messo da un trigger. È il
--         cursore del pull incrementale, immune allo sfasamento degli
--         orologi dei dispositivi.
--   * deleted_at: soft delete. Una cancellazione deve poter VIAGGIARE
--     fino agli altri dispositivi; una riga sparita e basta non sarebbe
--     distinguibile da una riga mai vista, e al primo pull tornerebbe viva.
-- ============================================================================

-- ---------------------------------------------------------------- funzioni

-- Ogni scrittura passa di qui. Due compiti:
--  1. timbra updated_at con l'ora del SERVER (mai quella del client);
--  2. applica il last-write-wins lato database: se l'aggiornamento in
--     arrivo è più VECCHIO di quello già salvato, viene ignorato
--     restituendo la riga esistente. È la protezione contro il caso
--     "telefono rimasto offline tre giorni che si risveglia e sovrascrive
--     una modifica più recente fatta dal Mac": senza questo, basterebbe
--     un outbox vecchio per perdere un dato.
create or replace function public.spendy_touch_row()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- tabelle

-- Impostazioni: una sola riga per utente, chiave = l'utente stesso.
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  monthly_budget    numeric(12,2) not null default 0,
  currency          text          not null default '€',
  cycle_start_day   smallint      check (cycle_start_day between 1 and 31),
  amount_hidden     boolean       not null default false,
  created_at        timestamptz   not null default now(),
  client_updated_at timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create table if not exists public.expenses (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount            numeric(12,2) not null,
  category_id       text not null default 'altro',
  subcategory       text,
  description       text not null default '',
  date              date not null,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.incomes (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount            numeric(12,2) not null,
  category_id       text not null default 'altro',
  subcategory       text,
  description       text not null default '',
  date              date not null,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- Nessuna colonna `saved`: il risparmiato è la SOMMA di goal_contributions.
-- Se fosse un numero aggiornato per incrementi, due versamenti fatti nello
-- stesso momento da due dispositivi diversi si sovrascriverebbero a vicenda
-- e uno dei due sparirebbe. Come righe separate si sommano entrambi.
create table if not exists public.goals (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji             text not null default '🎯',
  label             text not null,
  target            numeric(12,2) not null,
  eta_months        smallint not null default 6,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.goal_contributions (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Volutamente NESSUNA foreign key verso goals: i record arrivano da
  -- dispositivi diversi e in ordine non garantito (un contributo può
  -- essere sincronizzato prima del suo obiettivo). Un vincolo qui
  -- farebbe fallire quel push invece di lasciarlo ricomporre da solo.
  goal_id           text not null,
  amount            numeric(12,2) not null,
  date              date not null,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.emergency_fund_contributions (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount            numeric(12,2) not null,
  date              date not null,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table if not exists public.custom_categories (
  id                text primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label             text not null,
  emoji             text not null default '🏷️',
  type              text not null default 'expense' check (type in ('expense', 'income')),
  pinned            boolean not null default false,
  subcategories     jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- ---------------------------------------------------------------- indici

-- L'indice che conta: il pull incrementale è sempre
-- "where user_id = … and updated_at > cursore order by updated_at".
create index if not exists expenses_sync_idx on public.expenses (user_id, updated_at);
create index if not exists incomes_sync_idx on public.incomes (user_id, updated_at);
create index if not exists goals_sync_idx on public.goals (user_id, updated_at);
create index if not exists goal_contributions_sync_idx on public.goal_contributions (user_id, updated_at);
create index if not exists emergency_fund_contributions_sync_idx on public.emergency_fund_contributions (user_id, updated_at);
create index if not exists custom_categories_sync_idx on public.custom_categories (user_id, updated_at);

-- Le pagine filtrano per periodo: utile appena le spese crescono.
create index if not exists expenses_date_idx on public.expenses (user_id, date);
create index if not exists incomes_date_idx on public.incomes (user_id, date);
create index if not exists goal_contributions_goal_idx on public.goal_contributions (user_id, goal_id);

-- ---------------------------------------------------------------- trigger

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.spendy_touch_row();

drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before insert or update on public.expenses
  for each row execute function public.spendy_touch_row();

drop trigger if exists incomes_touch on public.incomes;
create trigger incomes_touch before insert or update on public.incomes
  for each row execute function public.spendy_touch_row();

drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before insert or update on public.goals
  for each row execute function public.spendy_touch_row();

drop trigger if exists goal_contributions_touch on public.goal_contributions;
create trigger goal_contributions_touch before insert or update on public.goal_contributions
  for each row execute function public.spendy_touch_row();

drop trigger if exists emergency_fund_contributions_touch on public.emergency_fund_contributions;
create trigger emergency_fund_contributions_touch before insert or update on public.emergency_fund_contributions
  for each row execute function public.spendy_touch_row();

drop trigger if exists custom_categories_touch on public.custom_categories;
create trigger custom_categories_touch before insert or update on public.custom_categories
  for each row execute function public.spendy_touch_row();

-- ------------------------------------------------------------------- RLS

alter table public.profiles                     enable row level security;
alter table public.expenses                     enable row level security;
alter table public.incomes                      enable row level security;
alter table public.goals                        enable row level security;
alter table public.goal_contributions           enable row level security;
alter table public.emergency_fund_contributions enable row level security;
alter table public.custom_categories            enable row level security;

-- profiles: la chiave È l'utente.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Le altre tabelle: stesso schema di policy, generato in un ciclo per non
-- scriverlo sei volte a mano e sbagliarne una.
--
-- Il `with check` sull'UPDATE è la parte che si dimentica più spesso:
-- senza, un utente autenticato potrebbe prendere una propria riga e
-- riassegnarla a un altro user_id. Il `using` da solo controlla la riga
-- PRIMA della modifica, non quella dopo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'expenses', 'incomes', 'goals', 'goal_contributions',
    'emergency_fund_contributions', 'custom_categories'
  ] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select using (auth.uid() = user_id)', t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (auth.uid() = user_id)', t, t);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);

    -- La DELETE fisica resta possibile solo sulle proprie righe, ma l'app
    -- non la usa mai: cancella scrivendo deleted_at (vedi sopra).
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete using (auth.uid() = user_id)', t, t);
  end loop;
end;
$$;

-- -------------------------------------------------------------- realtime

-- Serve perché il Mac aperto veda comparire una spesa inserita dal
-- Samsung senza aspettare il pull successivo.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'expenses', 'incomes', 'goals', 'goal_contributions',
    'emergency_fund_contributions', 'custom_categories'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ------------------------------------------------------------- verifica

-- Dopo l'esecuzione, questa query deve restituire 7 righe tutte con
-- rowsecurity = true. Se una è false, quella tabella è esposta.
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
