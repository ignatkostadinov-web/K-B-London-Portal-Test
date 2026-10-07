create table if not exists public.projects (
  id text primary key,
  title text not null,
  client_name text not null default '',
  reference text not null default '',
  kind text not null default 'bathroom' check (kind in ('bathroom', 'kitchen')),
  status text not null default 'progress'
    check (status in ('progress', 'finishing', 'completed')),
  project_note text not null default '',
  start_date date,
  duration text not null default '',
  created_at timestamptz not null default now()
);

alter table public.projects add column if not exists client_name text not null default '';
alter table public.projects add column if not exists reference text not null default '';
alter table public.projects add column if not exists kind text not null default 'bathroom';
alter table public.projects add column if not exists project_note text not null default '';
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists duration text not null default '';
alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects add constraint projects_kind_check check (kind in ('bathroom', 'kitchen'));

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('staff', 'client')),
  project_id text references public.projects (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint client_must_have_project check (role <> 'client' or project_id is not null),
  constraint staff_must_not_have_project check (role <> 'staff' or project_id is null)
);

create table if not exists public.stage_updates (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  stage_number smallint not null check (stage_number between 1 and 8),
  stage_name text not null,
  status text not null default 'not-started'
    check (status in ('not-started', 'in-progress', 'complete')),
  note text not null default '',
  planned_date date,
  client_visible boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (project_id, stage_number)
);

create table if not exists public.internal_issues (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  title text not null,
  status text not null default 'open'
    check (status in ('open', 'awaiting-supplier', 'in-progress', 'resolved')),
  problem text not null,
  plan text not null default '',
  correspondence text not null default '',
  client_update text not null default '',
  share_with_client boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  title text not null,
  proposed_option text not null,
  cost_impact text not null default '',
  schedule_impact text not null default '',
  client_note text not null default '',
  status text not null default 'awaiting-response'
    check (status in ('awaiting-response', 'approved', 'discussion-requested')),
  client_visible boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.decision_responses (
  decision_id uuid primary key references public.project_decisions (id) on delete cascade,
  project_id text not null references public.projects (id) on delete cascade,
  response text not null check (response in ('approved', 'discussion-requested')),
  responded_by uuid not null references auth.users (id) on delete cascade,
  responded_at timestamptz not null default now()
);

create table if not exists public.client_updates (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  title text not null,
  message text not null,
  source_issue_id uuid unique references public.internal_issues (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

alter table public.client_updates add column if not exists source_issue_id uuid unique references public.internal_issues (id) on delete cascade;

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  category text not null default 'stage-photo'
    check (category in ('stage-photo', 'design-document', 'internal-attachment', 'project-document')),
  stage_number smallint check (stage_number between 1 and 8),
  client_visible boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_file_path_matches_project
    check (split_part(storage_path, '/', 1) = project_id)
);

alter table public.project_files add column if not exists category text not null default 'stage-photo';
alter table public.project_files add column if not exists stage_number smallint;
alter table public.project_files drop constraint if exists project_files_category_check;
alter table public.project_files add constraint project_files_category_check
  check (category in ('stage-photo', 'design-document', 'internal-attachment', 'project-document'));
alter table public.project_files drop constraint if exists project_files_stage_number_check;
alter table public.project_files add constraint project_files_stage_number_check
  check (stage_number between 1 and 8);
alter table public.internal_issues add column if not exists attachment_file_id uuid references public.project_files (id) on delete set null;

create or replace function public.current_portal_role()
returns text
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

create or replace function public.current_portal_project_id()
returns text
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select p.project_id
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.role = 'client'
$$;

create or replace function public.respond_to_decision(
  p_decision_id uuid,
  p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_project_id text;
begin
  if p_response not in ('approved', 'discussion-requested') then
    raise exception 'Invalid decision response';
  end if;

  v_project_id := public.current_portal_project_id();
  if v_project_id is null then
    raise exception 'Client project access required';
  end if;

  if not exists (
    select 1
    from public.project_decisions as d
    where d.id = p_decision_id
      and d.project_id = v_project_id
      and d.client_visible
      and d.status = 'awaiting-response'
  ) then
    raise exception 'Decision is unavailable for response';
  end if;

  insert into public.decision_responses (
    decision_id, project_id, response, responded_by, responded_at
  )
  values (
    p_decision_id, v_project_id, p_response, (select auth.uid()), now()
  )
  on conflict (decision_id) do update
    set response = excluded.response,
        responded_by = excluded.responded_by,
        responded_at = excluded.responded_at;
end;
$$;

revoke all on function public.current_portal_role() from public, anon;
revoke all on function public.current_portal_project_id() from public, anon;
revoke all on function public.respond_to_decision(uuid, text) from public, anon;
grant execute on function public.current_portal_role() to authenticated;
grant execute on function public.current_portal_project_id() to authenticated;
grant execute on function public.respond_to_decision(uuid, text) to authenticated;

alter table public.projects enable row level security;
alter table public.profiles enable row level security;
alter table public.stage_updates enable row level security;
alter table public.internal_issues enable row level security;
alter table public.project_decisions enable row level security;
alter table public.decision_responses enable row level security;
alter table public.client_updates enable row level security;
alter table public.project_files enable row level security;

drop policy if exists "staff read all projects" on public.projects;
create policy "staff read all projects"
  on public.projects for select to authenticated
  using (public.current_portal_role() = 'staff');
drop policy if exists "clients read own project" on public.projects;
create policy "clients read own project"
  on public.projects for select to authenticated
  using (id = public.current_portal_project_id());
drop policy if exists "staff manage projects" on public.projects;
create policy "staff manage projects"
  on public.projects for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists "staff read profiles" on public.profiles;
create policy "staff read profiles"
  on public.profiles for select to authenticated
  using (public.current_portal_role() = 'staff');
drop policy if exists "staff manage profiles" on public.profiles;
create policy "staff manage profiles"
  on public.profiles for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');

drop policy if exists "staff manage stage updates" on public.stage_updates;
create policy "staff manage stage updates"
  on public.stage_updates for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');
drop policy if exists "clients read visible stage updates" on public.stage_updates;
create policy "clients read visible stage updates"
  on public.stage_updates for select to authenticated
  using (client_visible and project_id = public.current_portal_project_id());

drop policy if exists "staff manage internal issues" on public.internal_issues;
create policy "staff manage internal issues"
  on public.internal_issues for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');

drop policy if exists "staff manage decisions" on public.project_decisions;
create policy "staff manage decisions"
  on public.project_decisions for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');
drop policy if exists "clients read visible decisions" on public.project_decisions;
create policy "clients read visible decisions"
  on public.project_decisions for select to authenticated
  using (client_visible and project_id = public.current_portal_project_id());

drop policy if exists "clients read own decision responses" on public.decision_responses;
create policy "clients read own decision responses"
  on public.decision_responses for select to authenticated
  using (project_id = public.current_portal_project_id());
drop policy if exists "staff read decision responses" on public.decision_responses;
create policy "staff read decision responses"
  on public.decision_responses for select to authenticated
  using (public.current_portal_role() = 'staff');
drop policy if exists "staff manage decision responses" on public.decision_responses;
create policy "staff manage decision responses"
  on public.decision_responses for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');

drop policy if exists "staff manage client updates" on public.client_updates;
create policy "staff manage client updates"
  on public.client_updates for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');
drop policy if exists "clients read own updates" on public.client_updates;
create policy "clients read own updates"
  on public.client_updates for select to authenticated
  using (project_id = public.current_portal_project_id());

drop policy if exists "staff manage project files" on public.project_files;
create policy "staff manage project files"
  on public.project_files for all to authenticated
  using (public.current_portal_role() = 'staff')
  with check (public.current_portal_role() = 'staff');
drop policy if exists "clients read shared project files" on public.project_files;
create policy "clients read shared project files"
  on public.project_files for select to authenticated
  using (
    client_visible
    and project_id = public.current_portal_project_id()
  );

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.stage_updates to authenticated;
grant select, insert, update, delete on public.internal_issues to authenticated;
grant select, insert, update, delete on public.project_decisions to authenticated;
grant select, insert, update, delete on public.decision_responses to authenticated;
grant select, insert, update, delete on public.client_updates to authenticated;
revoke all on public.project_files from public, anon;
grant select, insert, update, delete on public.project_files to authenticated;

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do update set public = false;

drop policy if exists "staff access project files" on storage.objects;
create policy "staff access project files"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'project-files'
    and public.current_portal_role() = 'staff'
  )
  with check (
    bucket_id = 'project-files'
    and public.current_portal_role() = 'staff'
  );
drop policy if exists "clients read own project files" on storage.objects;
drop policy if exists "clients read shared project files" on storage.objects;
create policy "clients read shared project files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-files'
    and (storage.foldername(name))[1] = public.current_portal_project_id()
    and exists (
      select 1
      from public.project_files as project_file
      where project_file.storage_path = name
        and project_file.project_id = public.current_portal_project_id()
        and project_file.client_visible
    )
  );
