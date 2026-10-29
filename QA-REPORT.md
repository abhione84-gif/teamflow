# Teamflow QA report — 29 October 2026

The current source passes **105 automated checks**: 36 unit/DOM/function-contract tests, 48 browser checks, and 21 live API checks. The real Postgres permission suites also passed. Security advisors reported no findings, and the dependency audit reported zero vulnerabilities.

## Coverage

| Layer | Result | Coverage |
| --- | --- | --- |
| Unit, DOM, and invitation contracts | 36 passed | Verified-role UI, password requirements, shared tasks, due times/DST, monthly totals, empty/Unicode/literal-formula Excel values, Supervisor invitation scope, Admin protection, invitation failure cleanup. |
| Chrome desktop, mobile Chrome emulation, Edge desktop | 48 passed | Sign-in gates, invalid credentials, uninvited accounts, invitation password setup, task creation/completion/views, failed-save retry, shared assignments, team controls, reports, 520-row Excel export, due-alert snooze/dismiss, sign-out and account-switch races. |
| Live public-client API checks | 21 passed | Protected-table access, privileged RPC denial, missing/invalid Edge tokens, allowed/untrusted origins, and real Auth rejection of a nonexistent account. No accounts or emails are created by this suite. |
| Real Postgres tests | Passed | Admin/normal-user/supervisor scope, cross-workspace isolation, personal-task privacy, collaboration, role changes, no Admin escalation, revoked team access, stale writes, rollback of failed updates, server timestamps, login IP/session binding, admin-only audit history, per-person alerts. |
| Accessibility | Passed for tested screens | No serious/critical WCAG A/AA violations on sign-in and monthly report screens; report layout fits desktop/mobile widths. This is not a whole-product accessibility certification. |

The database suites are `verify-access.sql`, `verify-admin-setup.sql`, `verify-deadlines-and-audit.sql`, and `verify-supervisor-role-management.sql`. They run fixtures inside transactions that roll back. The initial-admin suite was run before any real accounts existed. Test fixtures were checked as removed afterward.

## Issues found and fixed

1. An overdue-alert request finishing after sign-out could restore old task data and reopen its editor. Workspace loads and writes now reject stale session generations, and UI callbacks check the current account.
2. Cross-tab account switches could retain the previous account until refresh. A changed account now locks the old workspace and reloads the new account, including when another load is still pending.
3. Signed-in clients could backdate `created_at` through the database API. Server timestamps now prevent this from distorting monthly reports; update/completion times remain server-controlled.
4. Personal-task assignment controls could imply that an admin could create another person's personal task. New personal tasks now fix their owner to the creator, and existing team tasks no longer offer an unsupported conversion to personal.
5. Several labels and notices had insufficient contrast. Text colors were corrected while retaining the existing backgrounds and purple palette.

## Supervisor permissions implemented

Supervisors can invite normal users or supervisors and change those two roles for people they manage. Newly invited normal users join the inviting supervisor's team. An invited or promoted supervisor remains manageable for role changes, but their team data is not inherited by the inviting supervisor. Supervisors cannot create Admin accounts, change existing Admins, manage unrelated people, or grant themselves Admin access. Creating projects, deleting tasks, assigning team supervisors globally, and reading login history remain admin-only.

## Limits and deployment state

Browser tests use isolated fresh browser profiles and controlled API fixtures. Their successful invitation messages do not prove SMTP delivery. Real email verification, invitation arrival, and password-reset inbox delivery still require a real inbox test after Supabase SMTP/redirect setup. No invitation emails were sent by this QA pass. Mobile Chrome was emulated; Safari and physical phones were not tested.

The live Vercel root returned HTTP 200 but did not contain the new monthly-report or collaborator controls. The tested frontend must still be uploaded and redeployed. Backend permission changes and invitation function version 3 are deployed. `teamflow-complete-upload.zip` contains the four files for the manual GitHub workflow.

## Repeatable checks

```sh
npm ci
npm run check
npm run build
npm test
npm run test:e2e
npm run test:live-api
npm audit
```

The browser suite uses installed Google Chrome and Microsoft Edge in separate temporary profiles and starts/reuses the localhost preview. Do not run the initial-admin bootstrap SQL against an active workspace.
