-- ============================================================================
-- SPENDY — Termini, Privacy e preferenza Spendy AI
-- ============================================================================
-- Da eseguire UNA volta nel SQL Editor di Supabase, DOPO schema.sql e
-- ai_usage.sql. Idempotente: rilanciarlo non distrugge dati e non duplica
-- niente. Non modifica né cancella righe esistenti.
--
-- 1. legal_acceptances: quale versione di Termini e Privacy Policy ogni
--    utente ha accettato / preso visione, e quando (orario del SERVER).
--    Si scrive solo dal trigger qui sotto, alla creazione dell'utente:
--    nessuna scrittura dal client (RLS + revoke), lettura solo della propria
--    riga. Sta in una tabella sua e non in `profiles` perché:
--      - alla registrazione con conferma email non c'è ancora una sessione,
--        quindi il client non potrebbe scrivere in profiles;
--      - una riga profiles creata qui con client_updated_at = now() farebbe
--        scartare dal trigger LWW il primo invio dello stipendio impostato
--        prima della registrazione.
--    Si elimina con l'account (ON DELETE CASCADE, come tutte le altre).
--
-- 2. profiles.spendy_ai_enabled: la scelta dell'utente di usare Spendy AI.
--    Default false: chi non l'ha attivata esplicitamente non la usa. Vale
--    anche per gli account già esistenti (va riattivata dalle Impostazioni).
-- ============================================================================

create table if not exists public.legal_acceptances (
  user_id                 uuid        primary key references auth.users(id) on delete cascade,
  terms_version           text        not null,
  terms_accepted_at       timestamptz not null default now(),
  privacy_version         text        not null,
  privacy_acknowledged_at timestamptz not null default now(),
  -- Gli orari dichiarati dal dispositivo, solo come riscontro.
  client_terms_accepted_at       text,
  client_privacy_acknowledged_at text,
  created_at              timestamptz not null default now()
);

alter table public.legal_acceptances enable row level security;

drop policy if exists legal_acceptances_select_own on public.legal_acceptances;
create policy legal_acceptances_select_own on public.legal_acceptances
  for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete, truncate on public.legal_acceptances from anon, authenticated;

-- Copia i metadati della registrazione (supabase.auth.signUp → options.data,
-- vedi src/legal/legal.js) in legal_acceptances. Senza metadati (utenti creati
-- dalla dashboard, vecchie versioni dell'app) non scrive niente e NON blocca
-- la creazione dell'utente.
create or replace function public.spendy_record_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Versioni presenti e non vuote: altrimenti non si scrive niente (un valore
  -- null violerebbe il not null e farebbe fallire la registrazione).
  if nullif(btrim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '') is not null
     and nullif(btrim(coalesce(new.raw_user_meta_data ->> 'privacy_version', '')), '') is not null then
    insert into public.legal_acceptances (
      user_id, terms_version, privacy_version,
      client_terms_accepted_at, client_privacy_acknowledged_at
    ) values (
      new.id,
      left(new.raw_user_meta_data ->> 'terms_version', 100),
      left(new.raw_user_meta_data ->> 'privacy_version', 100),
      left(new.raw_user_meta_data ->> 'terms_accepted_at', 40),
      left(new.raw_user_meta_data ->> 'privacy_acknowledged_at', 40)
    )
    on conflict (user_id) do nothing;
  end if;
  return new;
-- Qualunque errore imprevisto qui NON deve impedire la registrazione: resta
-- un avviso nei log di Postgres e l'utente viene creato (senza riga).
exception when others then
  raise warning 'spendy_record_legal_acceptance: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.spendy_record_legal_acceptance() from public, anon, authenticated;

drop trigger if exists spendy_on_auth_user_created_legal on auth.users;
create trigger spendy_on_auth_user_created_legal
  after insert on auth.users
  for each row execute function public.spendy_record_legal_acceptance();

alter table public.profiles add column if not exists spendy_ai_enabled boolean not null default false;

-- Verifica (facoltativa), dopo l'esecuzione:
--   select column_name, data_type, column_default from information_schema.columns
--   where table_schema = 'public' and table_name in ('legal_acceptances', 'profiles');
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'legal_acceptances' and grantee in ('anon', 'authenticated');  -- solo SELECT
