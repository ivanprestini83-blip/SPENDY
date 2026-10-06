-- ============================================================================
-- SPENDY — voci cancellate: sul cloud resta solo un marcatore tecnico
-- ============================================================================
-- Da incollare a mano nell'SQL Editor di Supabase, leggendolo. Idempotente:
-- rilanciarlo non duplica trigger e non tocca dati già salvati.
--
-- Questo file installa SOLO la funzione e i trigger. Non modifica né cancella
-- nessuna riga esistente: la pulizia delle voci già cancellate è un passo
-- separato (in fondo, commentato) da eseguire solo dopo una verifica.
--
-- Cosa fa: in ogni INSERT o UPDATE di una riga con deleted_at non nullo, il
-- contenuto della voce (importo, descrizione, categoria, data, nome…) è
-- sostituito da valori neutri. Restano id, user_id, deleted_at,
-- client_updated_at, created_at, updated_at: quanto serve perché la
-- cancellazione raggiunga gli altri dispositivi. Vale anche per i client
-- vecchi che mandano ancora la riga completa.
--
-- Non cambia: RLS, policy, colonne, spendy_touch_row (last-write-wins su
-- client_updated_at e updated_at del server), realtime. I trigger BEFORE
-- partono in ordine alfabetico: <tabella>_scrub_tombstone prima di
-- <tabella>_touch. Se poi spendy_touch_row scarta un aggiornamento più
-- vecchio (return old), la riga salvata resta quella esistente, com'era.
--
-- I valori neutri sono gli stessi di src/sync/tombstones.js (client) e di
-- src/sync/memoryRemote.mjs (database finto dei test): un test li confronta.
-- ============================================================================

create or replace function public.spendy_scrub_tombstone()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is null then
    return new;
  end if;

  if tg_table_name in ('expenses', 'incomes') then
    new.amount := 0;
    new.category_id := 'altro';
    new.subcategory := null;
    new.description := '';
    new.date := date '1970-01-01';
  elsif tg_table_name = 'goals' then
    new.emoji := '🎯';
    new.label := '';
    new.target := 0;
    new.eta_months := 6;
  elsif tg_table_name = 'goal_contributions' then
    new.goal_id := '';
    new.amount := 0;
    new.date := date '1970-01-01';
  elsif tg_table_name = 'emergency_fund_contributions' then
    new.amount := 0;
    new.date := date '1970-01-01';
  elsif tg_table_name = 'custom_categories' then
    new.label := '';
    new.emoji := '🏷️';
    new.type := 'expense';
    new.pinned := false;
    new.subcategories := '[]'::jsonb;
  end if;

  return new;
end;
$$;

drop trigger if exists expenses_scrub_tombstone on public.expenses;
create trigger expenses_scrub_tombstone before insert or update on public.expenses
  for each row execute function public.spendy_scrub_tombstone();

drop trigger if exists incomes_scrub_tombstone on public.incomes;
create trigger incomes_scrub_tombstone before insert or update on public.incomes
  for each row execute function public.spendy_scrub_tombstone();

drop trigger if exists goals_scrub_tombstone on public.goals;
create trigger goals_scrub_tombstone before insert or update on public.goals
  for each row execute function public.spendy_scrub_tombstone();

drop trigger if exists goal_contributions_scrub_tombstone on public.goal_contributions;
create trigger goal_contributions_scrub_tombstone before insert or update on public.goal_contributions
  for each row execute function public.spendy_scrub_tombstone();

drop trigger if exists emergency_fund_contributions_scrub_tombstone on public.emergency_fund_contributions;
create trigger emergency_fund_contributions_scrub_tombstone before insert or update on public.emergency_fund_contributions
  for each row execute function public.spendy_scrub_tombstone();

drop trigger if exists custom_categories_scrub_tombstone on public.custom_categories;
create trigger custom_categories_scrub_tombstone before insert or update on public.custom_categories
  for each row execute function public.spendy_scrub_tombstone();

-- ------------------------------------------------------------- verifica

-- Deve restituire 6 righe, una per tabella, tutte abilitate (tgenabled = 'O'):
--   select tgrelid::regclass as tabella, tgname, tgenabled
--   from pg_trigger where tgname like '%_scrub_tombstone' order by 1;
--
-- Voci cancellate che conservano ancora contenuto (sola lettura):
--   select 'expenses' as t, count(*) from public.expenses
--     where deleted_at is not null and (amount <> 0 or description <> '' or category_id <> 'altro' or subcategory is not null or date <> date '1970-01-01')
--   union all select 'incomes', count(*) from public.incomes
--     where deleted_at is not null and (amount <> 0 or description <> '' or category_id <> 'altro' or subcategory is not null or date <> date '1970-01-01')
--   union all select 'goals', count(*) from public.goals
--     where deleted_at is not null and (label <> '' or target <> 0 or emoji <> '🎯' or eta_months <> 6)
--   union all select 'goal_contributions', count(*) from public.goal_contributions
--     where deleted_at is not null and (goal_id <> '' or amount <> 0 or date <> date '1970-01-01')
--   union all select 'emergency_fund_contributions', count(*) from public.emergency_fund_contributions
--     where deleted_at is not null and (amount <> 0 or date <> date '1970-01-01')
--   union all select 'custom_categories', count(*) from public.custom_categories
--     where deleted_at is not null and (label <> '' or emoji <> '🏷️' or type <> 'expense' or pinned or subcategories <> '[]'::jsonb);

-- ------------------------------------------- pulizia delle voci già cancellate
-- NON eseguire insieme al resto. Solo dopo che i 6 trigger risultano
-- installati e solo dopo un OK esplicito. Riscrive deleted_at con sé stesso:
-- il trigger qui sopra azzera il contenuto. Non cancella righe, non tocca le
-- voci attive (deleted_at is null), non cambia deleted_at né
-- client_updated_at; updated_at diventa now(), quindi i dispositivi
-- riscaricano questi marcatori e li ignorano (la voce è già sparita).
--
--   begin;
--   update public.expenses                     set deleted_at = deleted_at where deleted_at is not null;
--   update public.incomes                      set deleted_at = deleted_at where deleted_at is not null;
--   update public.goals                        set deleted_at = deleted_at where deleted_at is not null;
--   update public.goal_contributions           set deleted_at = deleted_at where deleted_at is not null;
--   update public.emergency_fund_contributions set deleted_at = deleted_at where deleted_at is not null;
--   update public.custom_categories            set deleted_at = deleted_at where deleted_at is not null;
--   -- rieseguire la query "Voci cancellate che conservano ancora contenuto":
--   -- tutte le righe devono essere 0, poi:
--   commit;
