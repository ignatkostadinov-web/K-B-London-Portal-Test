# K&B (Kitchens & Bathrooms) London Limited

Staff and customer portal for renovation project updates. Private project data is read from Supabase, and project files are stored in a private Supabase Storage bucket.

- `staff.html` and `staff-portal.js` provide the staff dashboard, searchable project register, and project workspace.
- `index.html` and `client-portal.js` provide the customer project dashboard, progress, shared files, and approvals.
- `projects.js` contains only the shared bathroom/kitchen stage labels.
- `supabase/portal.js` checks the signed-in role before either private page is shown.

Authorization is enforced by Supabase Row Level Security (RLS), not by JavaScript filtering. Staff accounts can access all projects. A customer account can access only the project assigned to its profile.

## Supabase setup

The sign-in page is `login.html`, with separate **Staff login** and **Customer login** choices. The browser uses only the Supabase project URL and public publishable key in `supabase/config.js`; never put a `service_role` or secret key in browser code. Disable public sign-ups and create/invite users through **Authentication → Users**.

Run [`supabase/schema.sql`](./supabase/schema.sql) for a new project. Since the initial version has already been run in the configured project, run [`supabase/portal-upgrade.sql`](./supabase/portal-upgrade.sql) in the SQL Editor to add the portal fields and tighten file access. Run [`supabase/realtime-upgrade.sql`](./supabase/realtime-upgrade.sql) once to enable project changes to reach signed-in customers in real time. Confirm the selected Supabase project and take an appropriate backup before running production SQL.

Create a project record before assigning customer accounts. For example:

```sql
insert into public.projects
  (id, title, client_name, reference, kind, status, project_note, start_date, duration)
values
  ('PROJECT-ID', 'Bathroom renovation', 'Customer name', 'Job reference',
   'bathroom', 'progress', '', null, '');
```

Create/invite accounts in Supabase Authentication, then create their profiles using their Auth UUID:

```sql
-- Staff account; staff can access all projects.
insert into public.profiles (id, role)
values ('00000000-0000-0000-0000-000000000000', 'staff');

-- Customer account; use only the project assigned to this customer.
insert into public.profiles (id, role, project_id)
values ('00000000-0000-0000-0000-000000000000', 'client', 'PROJECT-ID');
```

Replace the example UUIDs before running either statement. Never run both examples with the same placeholder UUID. Give each customer only their own project assignment. Keep sign-up invite-only, and set Supabase Site URL and allowed redirect URLs to the actual website origins, including `login.html` for password resets.

## Project data and files

Stage updates, issues, decisions, customer-safe updates, profiles, projects, and file metadata are stored in Supabase. Staff stage updates, photos, and project documents default to private. Staff must explicitly mark a stage update or file visible to the customer. Internal issues, correspondence, and attachments are staff-only; only the separate customer-safe update text is published. The client portal subscribes to Realtime changes for the customer's assigned project, reloads its RLS-filtered data, and shows an in-portal alert for visible project, stage, decision, update, and shared-file changes. Customers need to be signed in with the portal open to receive live alerts; email and offline push notifications are not configured.

The `project-files` Storage bucket is private. The app uses short-lived signed URLs for permitted files, and storage access is checked against both the project assignment and a matching `project_files` record. Never put customer photos/documents in a public bucket or website `assets/` folder.

The staff portal requires a staff profile. The customer portal requires a client profile with a project assignment. If the database contains no project records or profiles, the pages will remain empty until those records are added. Messaging is not connected yet.

Before inviting customers:

1. Run the upgrade SQL and confirm `project-files` is private.
2. Create project rows and user profiles; assign each customer only their own project.
3. Sign in as staff and upload photos/documents through the staff portal.
4. Test signed-out access, staff access, a customer's own project, another customer's project, shared files, and internal files, including opening a copied file URL after sign-out.
5. Sign in to a customer's portal in a second browser, update that project as staff, and verify shared changes appear with an in-portal alert. Confirm private stage updates, issues, and internal attachments do not appear.
6. Confirm backups, account access, and the real website origin/redirect allow-list.

## Existing development preview and repository assets

The Pages workflow publishes only a privacy notice placeholder and does not deploy the portal or assets. This code change does not run that workflow and cannot erase prior deployments. The repository's `assets/` folder still contains legacy project media; do not serve or reuse those paths for customer files. After those originals have been migrated securely and verified, remove them from the repository and consider repository visibility and Git history separately.
