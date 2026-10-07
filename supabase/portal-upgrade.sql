alter table public.projects add column if not exists client_name text not null default '';
alter table public.projects add column if not exists reference text not null default '';
alter table public.projects add column if not exists kind text not null default 'bathroom';
alter table public.projects add column if not exists project_note text not null default '';
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists duration text not null default '';
alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects add constraint projects_kind_check check (kind in ('bathroom', 'kitchen'));

alter table public.project_files add column if not exists category text not null default 'stage-photo';
alter table public.project_files add column if not exists stage_number smallint;
alter table public.project_files drop constraint if exists project_files_category_check;
alter table public.project_files add constraint project_files_category_check
  check (category in ('stage-photo', 'design-document', 'internal-attachment', 'project-document'));
alter table public.project_files drop constraint if exists project_files_stage_number_check;
alter table public.project_files add constraint project_files_stage_number_check
  check (stage_number between 1 and 8);

alter table public.internal_issues add column if not exists attachment_file_id uuid references public.project_files (id) on delete set null;
alter table public.client_updates add column if not exists source_issue_id uuid unique references public.internal_issues (id) on delete cascade;

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
