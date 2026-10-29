# Teamflow

A task and follow-up dashboard with invitation-only team access, Supabase email/password sign-in, and database-enforced permissions.

## Due times and alerts

Tasks can have a due date, time, and IANA time zone. The database stores an absolute UTC instant plus the selected zone. Cards and task details show the selected zone; the calendar groups tasks by the viewer's local date and shows their local time. Nonexistent or ambiguous daylight-saving times must be changed before saving. Older date-only tasks were migrated to 17:00 in Asia/Bangkok.

The app checks overdue, unfinished tasks every 15 seconds while it is open and visible. Teammates receive alerts for their own tasks; admins receive alerts for all workspace tasks. A dialog waits until any open editor is closed. Users may snooze for five minutes or dismiss the current alerts. Dismissal is saved separately for each user and each deadline, so a teammate's dismissal does not hide an admin's alert. Rescheduling a task creates a new alert for its new deadline.

These are in-app pop-ups. A closed browser does not receive push notifications; overdue alerts appear when the user returns. Each check shows up to 50 pending alerts.

## Login history

**Login history** is visible only to admins and shows the latest 100 workspace sign-ins: name/email, login time, IP address, and approximate city/region/country. Database row policies enforce this access. Browser clients cannot insert or rewrite audit records. One record is retained per successful Supabase Auth session that enters the workspace; refreshes and page reloads do not create duplicates. Failed sign-in attempts remain in Supabase Auth's own logs.

The IP address and browser agent come from the verified native Auth session, not values submitted by the browser. Login time is the session creation time. History remains if the authentication session is later removed. The sign-in page discloses this collection.

With the workspace owner's explicit permission, the deployed `record-login` Edge Function sends each new public login IP over HTTPS to **ipwho.is** and stores its approximate location. It does not request GPS access or store coordinates. Private/local IPs are not sent. Network failures and provider limits leave location unavailable and do not block login; the server has already stored the IP and time. A VPN or mobile network may produce a location different from the user's actual location.

`supabase/deadlines-and-login-audit.sql` documents the applied database change, and `supabase/record-login.ts` contains the deployed function. Supabase supplies its private service-role credential at runtime; no private credential is bundled in the upload. The function verifies the caller with Auth before accessing any audit record.

## Access model

| Role | Access |
| --- | --- |
| Admin | View all workspace tasks and members; create projects; create, assign, edit, and delete tasks; send invitations. |
| Supervisor | View/edit own and assigned-team project tasks, including shared tasks involving assigned teammates. Create and assign tasks within that team; manage collaborators on tasks owned by that team. Read only their own personal tasks. Invite normal users or supervisors; manage those roles within their team. |
| Teammate | View/edit tasks where they are the primary owner or an additional collaborator, plus their own personal tasks. Create tasks for themselves in accessible projects. |
| Signed-out visitor or uninvited account | No workspace task data. |

Normal users cannot view unrelated coworkers’ tasks, see the full member roster, change task assignments or participants, change roles, invite people, or delete tasks. They can see the names and emails of people on their shared tasks. Supervisors can invite normal users or supervisors and change those roles only for their assigned/invited people. They cannot create or modify Admin accounts, change global supervisor assignments, create projects, move existing tasks between projects, view login history, or delete tasks. Admins retain those controls. Database RLS and column permissions enforce these boundaries using verified user IDs and protected memberships, never editable browser metadata.

## Monthly reports and Excel

Open **Monthly reports** from the sidebar. Choose the month and whether to include tasks due, created, or completed in that month. Month boundaries use the displayed local report time zone. The report shows unique task totals, current completion/open/overdue counts, task details, and totals by primary owner. Tasks without the selected date are excluded. A shared task counts once; primary-owner grouping does not count each collaborator as a separate task.

Every signed-in role can download a genuine `.xlsx` workbook with **Summary**, **Tasks**, and **By owner** sheets. Admins export workspace data, supervisors export their permitted team and own data, and normal users export only their own/shared tasks. The app refreshes server-authorized data before export. Export is not a way to request another user's hidden records. Statuses reflect current data, not immutable historical month-end snapshots. Up to 200 task rows are previewed; Excel contains all matching loaded rows.

## Supervisor setup and shared tasks

Admins open **Team & invitations → Manage** beside a teammate. Select **Supervisor** to promote them. For each normal user, select their assigned supervisor. A normal user may have one task supervisor. Supervisors may manage roles for supervisors they invited or promoted, but this does not expose the invited supervisor’s task team. Admins remain protected. Removing an assignment takes effect on the next database request. The two configured initial admins and a signed-in admin cannot demote themselves through this control.

Tasks keep one primary owner and support additional collaborators, up to 20 participants total. Admins can select any workspace member; supervisors can add/remove only members in their assigned scope on tasks owned by that scope. Existing collaborators outside a supervisor's scope stay protected. Normal users can update a shared task but cannot change participants. Personal tasks cannot be shared. Everyone with task access receives due alerts under the existing per-user dismissal rules.

Task fields and collaborator changes are saved in one transaction with an `updated_at` check to reject stale writes. Native database policy tests verify team boundaries, collaborators' access, permission changes, audit restrictions, and transaction behavior. `supabase/supervisors-and-collaboration.sql` documents the installed schema and functions; the smaller `*-part.sql` files are implementation records of the staged deployment. `verify-supervision-and-collaboration.sql` runs rollback-only fixtures. `write-excel-file@4.1.1` generates the workbook and `read-excel-file@9.3.13` independently verifies its worksheets in tests.

## Initial admins

The protected backend allowlist contains:

- `abhilash@cartafella.com`
- `abhione84@gmail.com`

After publishing the updated app, each admin uses **First-time admin setup**, chooses a password of at least eight characters, and verifies their email. Both admins join the same workspace. Neither account nor a password is pre-created by the source files. The requested five-character password is not hardcoded or stored in this repository.

## Supabase email configuration

Existing project: `ziemlsjdvqxujndaludh`.

In **Authentication → URL Configuration**, set the Site URL to `https://teamflow-fawn.vercel.app/` and allow the production URL plus `https://teamflow-fawn.vercel.app/**` as redirect URLs. This is required for confirmation, invitation, and password-reset callbacks. Email confirmations must stay enabled. They were verified as enabled during implementation.

Configure **custom SMTP** in Supabase Auth for reliable invitations to teammates outside the Supabase organization. Supabase’s default email sender is for testing and has recipient and rate restrictions. Configure an appropriate minimum password length in Auth settings; the app requires at least eight characters for setup and password changes.

The deployed `invite-team-member` Edge Function verifies the caller with Supabase Auth, checks their current admin or supervisor membership, and sends a password-setup invitation to the supplied email. The redirect destination is fixed to the production app. Role changes and mail delivery use Supabase’s server-side service-role environment variable. That key is never downloaded or included in the browser files. The function performs its own verified JWT authentication before any privileged action; gateway JWT verification is disabled to support this explicit authentication path.

## Invite flow

1. An admin or supervisor opens **Team & invitations**, enters a name, email, and role, and sends an invitation.
2. The recipient opens the link in that email and sets their own password.
3. The backend links membership only to the authenticated account with that exact verified email.
4. The teammate signs in with that email and password on subsequent visits.

No invitation emails were sent during automated verification. Actual email delivery, first-account setup, and the full invite-to-inbox journey still need testing after SMTP/redirect configuration and deployment.

## Run and build

```sh
npm ci
npm run check
npm run build
npm test
npm run dev
```

Open `http://localhost:4318/`. Browser JavaScript lives in `src/`; `build.mjs` bundles it and the pinned Supabase client into `dist/app.js`. Edit source files and run the build before uploading. The browser needs only `index.html`, `styles.css`, and the bundled `app.js`.

## Publish

This GitHub repository retains its existing Vercel configuration, which serves the repository root. The three root browser files match `dist/`. After a local build, copy the updated three files from `dist/` to the repository root before committing, or deliberately configure Vercel to serve `dist`. For manual GitHub uploads, copy the built three browser files to `D:\Codex\teamflow-upload`; its separate `vercel.json` serves the repository root. Upload all four files together, then redeploy Vercel. The manual upload contains no server secret and does not need a Node server in production.

## Data and verification

Workspace tasks now live in Supabase. A login is required; there is no local demo fallback. Old `teamflow-v1` browser data is retained on the device and is not automatically uploaded. Admins can download that previous browser backup in Settings. Exporting the current workspace includes only rows visible to the logged-in user.

Updates compare `updated_at` to detect stale writes. Background refresh pauses while a dialog is open or a save is in progress. Logging out hides the workspace and clears task data from the page.

`supabase/teamflow-access.sql` records the changes made to the existing database. It assumes the original Teamflow tables already exist and is not a fresh-database setup script. `verify-access.sql` and `verify-admin-setup.sql` exercise the live RLS rules inside transactions that roll back all fixture users and data. The bootstrap verification is intended only before real admin accounts exist. Do not run it against an active workspace.

`verify-deadlines-and-audit.sql` verifies alert filtering and isolation, per-user dismissal, rescheduled deadlines, native-session IP binding, and admin-only immutable login history using rollback-only fixtures. `npm test` runs browser-DOM auth/deadline tests and time-zone unit tests. These tests use mock browser requests and transaction-local database fixtures; they do not replace a real email-to-inbox sign-in test.

## Expanded QA

See `QA-REPORT.md` for coverage, fixes, and remaining deployment/email checks. `npm run test:e2e` runs Chrome desktop, mobile Chrome emulation, and Edge desktop with isolated API fixtures. `npm run test:live-api` exercises the deployed public endpoints without sending email or creating accounts. The Supervisor-specific database update is recorded in `supabase/supervisor-invitation-management.sql`, and its rollback-only verification is `verify-supervisor-role-management.sql`.
