do $$
declare
  table_name text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication does not exist.';
  end if;

  foreach table_name in array array[
    'projects',
    'stage_updates',
    'project_decisions',
    'client_updates',
    'project_files'
  ] loop
    if not exists (
      select 1
      from pg_tables
      where schemaname = 'public'
        and tablename = table_name
    ) then
      raise exception 'Required public table "%" does not exist.', table_name;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
