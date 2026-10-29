import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

async function page(t, session, fixture) {
  const errors = [];
  const requests = [];
  const window = new Window({ url: 'http://localhost:4318/', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  t.after(() => window.happyDOM.close());
  window.addEventListener('error', event => errors.push(event.error || event.message));
  window.addEventListener('unhandledrejection', event => errors.push(event.reason));
  window.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (fixture) {
      const parsed = new URL(String(url));
      const method = options.method || 'GET';
      const response = body => new window.Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (parsed.pathname === '/auth/v1/user') return response(fixture.session.user);
      if (parsed.pathname.endsWith('/rpc/accept_team_invites')) return response(0);
      if (parsed.pathname.endsWith('/task_collaborators')) return response(fixture.collaborations||[]);
      if (parsed.pathname.endsWith('/supervisor_assignments')) return response(fixture.supervision||[]);
      if (parsed.pathname.endsWith('/rpc/configure_member')) {
        fixture.configured=JSON.parse(options.body);
        fixture.members.find(m=>m.id===fixture.configured.p_member).role=fixture.configured.p_role;
        fixture.supervision=(fixture.supervision||[]).filter(s=>s.member_id!==fixture.configured.p_member);
        if(fixture.configured.p_supervisor)fixture.supervision.push({supervisor_id:fixture.configured.p_supervisor,member_id:fixture.configured.p_member});
        return response(null);
      }
      if (parsed.pathname.endsWith('/rpc/save_team_task')) {
        const saved=fixture.saved=JSON.parse(options.body);
        fixture.inserted={...saved.p_values,id:saved.p_task,creator_id:fixture.session.user.id};
        const index=fixture.tasks.findIndex(task=>task.id===saved.p_task);
        const row={...fixture.tasks[index],...fixture.inserted,created_at:fixture.tasks[index]?.created_at||new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:saved.p_values.status==='Done'?new Date().toISOString():null};
        if(index>=0)fixture.tasks[index]=row;else fixture.tasks.push(row);
        fixture.collaborations=(fixture.collaborations||[]).filter(c=>c.task_id!==saved.p_task).concat(saved.p_collaborators.map(member_id=>({id:member_id,task_id:saved.p_task,member_id})));
        return response(saved.p_task);
      }
      if (parsed.pathname.endsWith('/rpc/get_due_task_alerts')) return response(fixture.alerts || []);
      if (parsed.pathname.endsWith('/functions/v1/record-login')) return response({ recorded:true });
      if (parsed.pathname.endsWith('/login_activity')) return response(fixture.logins || []);
      if (parsed.pathname.endsWith('/task_alert_receipts') && method === 'POST') {
        fixture.receipts=JSON.parse(options.body);
        fixture.alerts=(fixture.alerts||[]).filter(alert=>!fixture.receipts.some(receipt=>receipt.task_id===alert.task_id&&receipt.due_at===alert.due_at));
        return response(null);
      }
      if (parsed.pathname.endsWith('/team_members')) return response(parsed.searchParams.has('user_id') ? [fixture.member] : fixture.members);
      if (parsed.pathname.endsWith('/workspaces')) return response({ id: fixture.workspace, name: "Abhi's workspace" });
      if (parsed.pathname.endsWith('/projects')) return response([{ id: fixture.project, name: 'General', color: '#7350d6' }]);
      if (parsed.pathname.endsWith('/tasks') && method === 'POST') {
        fixture.inserted = JSON.parse(options.body);
        fixture.tasks.push({ ...fixture.inserted, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        return response(null);
      }
      if (parsed.pathname.endsWith('/tasks')) return response(fixture.tasks);
      throw new Error('Unexpected request: ' + parsed.pathname);
    }
    return new window.Response(JSON.stringify({ code: 'bad_jwt', message: 'Invalid JWT' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  };
  if (session) window.localStorage.setItem('teamflow-auth-v1', JSON.stringify(session));
  window.document.write(html);
  const style = window.document.createElement('style'); style.textContent = css; window.document.head.append(style);
  window.eval(bundle);
  await pause();
  assert.deepEqual(errors, [], 'the account screen must initialize without runtime errors');
  return { window, document: window.document, requests, errors };
}

test('signed-out visitors see sign-in and no workspace data', async t => {
  const { window, document, requests } = await page(t);
  assert.equal(document.body.classList.contains('signed-out'), true);
  assert.equal(document.querySelector('#auth-gate').hidden, false);
  assert.equal(window.getComputedStyle(document.querySelector('.app-shell')).display, 'none');
  assert.equal(window.getComputedStyle(document.querySelector('.sidebar')).display, 'none');
  assert.equal(document.querySelector('#task-view').children.length, 0);
  assert.equal(document.querySelector('#team-button').hidden, true);
  assert.equal(requests.length, 0, 'signed-out startup must not fetch workspace rows');
});

function authenticatedFixture(role) {
  const id = '00000000-0000-4000-8000-000000000011';
  const workspace = '00000000-0000-4000-8000-000000000012';
  const project = '00000000-0000-4000-8000-000000000013';
  const email = role.toLowerCase() + '@example.invalid';
  const member = { id: '00000000-0000-4000-8000-000000000014', workspace_id: workspace, user_id: id, email, role, display_name: 'Fixture User', created_at: new Date().toISOString() };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: id, exp, role: 'authenticated' })).toString('base64url') + '.fixture-signature';
  const session = { access_token: token, refresh_token: 'fixture-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user: { id, email, email_confirmed_at: new Date().toISOString(), user_metadata: { role: 'Admin' }, app_metadata: {} } };
  return { workspace, project, member, members: [member], session, tasks: [{ id: '00000000-0000-4000-8000-000000000015', workspace_id: workspace, project_id: project, assignee_member_id: member.id, creator_id: id, personal: false, title: 'My assigned task', description: 'Visible to its assignee', status: 'To Do', priority: 'Medium', due_date: null, followup_date: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] };
}

test('member UI follows protected membership rather than editable user metadata', async t => {
  const fixture = authenticatedFixture('Member');
  const { document, errors } = await page(t, fixture.session, fixture);
  await pause();
  assert.deepEqual(errors, []);
  assert.equal(document.body.classList.contains('signed-in'), true);
  assert.match(document.querySelector('#task-view').textContent, /My assigned task/);
  assert.equal(document.querySelector('#team-button').hidden, true);
  assert.equal(document.querySelector('#add-project').hidden, true);
  document.querySelector('#new-task').click();
  assert.equal(document.querySelector('#form-owner').disabled, true);
  assert.equal(document.querySelector('#form-owner').value, fixture.member.email);
  assert.equal(document.querySelector('#delete-task').hidden, true);
});

test('member task creation sends the authenticated owner and persists through reload', async t => {
  const fixture = authenticatedFixture('Member');
  const { document, errors, window } = await page(t, fixture.session, fixture);
  await pause();
  document.querySelector('#new-task').click();
  document.querySelector('#task-form').elements.namedItem('title').value = 'New fixture task';
  document.querySelector('#task-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await pause();
  assert.deepEqual(errors, []);
  assert.equal(fixture.inserted.assignee_member_id, fixture.member.id);
  assert.equal('creator_id' in fixture.saved.p_values,false,'task creator must be determined by the verified backend session');
  assert.equal(fixture.inserted.workspace_id, fixture.workspace);
  assert.match(document.querySelector('#task-view').textContent, /New fixture task/);
  assert.equal(document.querySelector('#task-dialog').open, false);
});

test('admin UI exposes invitation controls after backend role verification', async t => {
  const fixture = authenticatedFixture('Admin');
  const { document, errors } = await page(t, fixture.session, fixture);
  await pause();
  assert.deepEqual(errors, []);
  assert.equal(document.body.dataset.role, 'admin');
  assert.equal(document.querySelector('#team-button').hidden, false);
  document.querySelector('#team-button').click();
  assert.equal(document.querySelector('#team-dialog').open, true);
  assert.match(document.querySelector('#team-roster').textContent, /Fixture User/);
});

test('task creation persists the selected due time and time zone',async t=>{
  const fixture=authenticatedFixture('Member');
  const {document,window,errors}=await page(t,fixture.session,fixture);
  await pause();
  document.querySelector('#new-task').click();
  const form=document.querySelector('#task-form');
  form.elements.namedItem('title').value='Timed task';
  form.elements.namedItem('due').value='2026-12-01';
  form.elements.namedItem('due').dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(form.elements.namedItem('dueTime').required,true);
  form.elements.namedItem('dueTime').value='15:45';
  form.elements.namedItem('dueTimezone').value='Asia/Bangkok';
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await pause();
  assert.deepEqual(errors,[]);
  assert.equal(fixture.inserted.due_at,'2026-12-01T08:45:00Z');
  assert.equal(fixture.inserted.due_timezone,'Asia/Bangkok');
  assert.equal(fixture.inserted.due_date,'2026-12-01');
});

function dueFixture(role) {
  const fixture=authenticatedFixture(role);
  const due=new Date(Date.now()-3600000).toISOString();
  fixture.tasks[0].due_at=due;
  fixture.tasks[0].due_date=due.slice(0,10);
  fixture.tasks[0].due_timezone='UTC';
  fixture.alerts=[{task_id:fixture.tasks[0].id,title:fixture.tasks[0].title,due_at:due,due_timezone:'UTC',owner_name:fixture.member.display_name,owner_email:fixture.member.email}];
  return fixture;
}

test('due tasks show a pop-up and dismissals are written for the signed-in user',async t=>{
  const fixture=dueFixture('Member');
  const {document,errors}=await page(t,fixture.session,fixture);
  await pause();
  assert.deepEqual(errors,[]);
  assert.equal(document.querySelector('#due-alert-dialog').open,true);
  assert.match(document.querySelector('#due-alert-list').textContent,/My assigned task/);
  document.querySelector('#due-alert-dismiss').click();
  await pause();
  assert.equal(fixture.receipts.length,1);
  assert.equal(fixture.receipts[0].user_id,fixture.session.user.id);
  assert.equal(document.querySelector('#due-alert-dialog').open,false);
});

test('admins also receive due pop-ups and teammates cannot open login history',async t=>{
  const fixture=dueFixture('Admin');
  const {document}=await page(t,fixture.session,fixture);
  await pause();
  assert.equal(document.querySelector('#due-alert-dialog').open,true);
  assert.equal(document.querySelector('#login-history-button').hidden,false);
});

test('member accounts cannot fetch admin login history even by clicking a hidden control',async t=>{
  const fixture=authenticatedFixture('Member');
  const {document,requests}=await page(t,fixture.session,fixture);
  await pause();
  assert.equal(document.querySelector('#login-history-button').hidden,true);
  document.querySelector('#login-history-button').click();
  await pause();
  assert.equal(document.querySelector('#login-history-dialog').open,false);
  assert.equal(requests.some(request=>request.url.includes('/rest/v1/login_activity')),false);
});

test('an incoming alert waits until the task editor is closed and can be snoozed',async t=>{
  const fixture=dueFixture('Member');
  const alerts=fixture.alerts;
  fixture.alerts=[];
  const {document,window}=await page(t,fixture.session,fixture);
  document.querySelector('#new-task').click();
  fixture.alerts=alerts;
  document.dispatchEvent(new window.Event('visibilitychange'));
  await pause();
  assert.equal(document.querySelector('#task-dialog').open,true);
  assert.equal(document.querySelector('#due-alert-dialog').open,false);
  assert.equal(document.querySelector('#due-alert-count').textContent,'1');
  document.querySelector('#task-dialog').close();
  document.dispatchEvent(new window.Event('visibilitychange'));
  await pause();
  assert.equal(document.querySelector('#due-alert-dialog').open,true);
  document.querySelector('#due-alert-snooze').click();
  document.dispatchEvent(new window.Event('visibilitychange'));
  await pause();
  assert.equal(document.querySelector('#due-alert-dialog').open,false);
  assert.equal(fixture.receipts,undefined,'snoozing must not permanently dismiss an alert');
});

test('admin history displays IP/location values as text',async t=>{
  const fixture=authenticatedFixture('Admin');
  fixture.logins=[{display_name:'Fixture User',email:'member@example.invalid',logged_in_at:'2026-10-29T10:00:00Z',ip_address:'203.0.113.10',city:'<img src=x onerror=alert(1)>',region:'Test region',country:'Test country',user_agent:'QA Browser',location_status:'resolved'}];
  const {document,errors}=await page(t,fixture.session,fixture);
  document.querySelector('#login-history-button').click();
  await pause();
  assert.equal(document.querySelector('#login-history-dialog').open,true);
  const history=document.querySelector('#login-history-rows');
  assert.match(history.textContent,/203\.0\.113\.10/);
  assert.match(history.textContent,/Test region, Test country/);
  assert.equal(history.querySelector('img'),null);
  assert.deepEqual(errors,[]);
});

test('normal users can open monthly reports and download a genuine Excel file',async t=>{
  const fixture=authenticatedFixture('Member');
  const now=new Date().toISOString();fixture.tasks[0].due_at=now;fixture.tasks[0].due_date=now.slice(0,10);fixture.tasks[0].due_timezone='UTC';
  const {document,window,errors}=await page(t,fixture.session,fixture);
  let downloaded;
  window.URL.createObjectURL=blob=>{downloaded=blob;return 'blob:fixture-report';};window.URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){};
  document.querySelector('#reports-button').click();
  assert.equal(document.querySelector('#reports-page').hidden,false);
  assert.equal(document.querySelector('.stats').hidden,true);
  assert.equal(document.querySelector('.task-workspace').hidden,true);
  assert.match(document.querySelector('#report-content').textContent,/My assigned task/);
  assert.match(document.querySelector('#report-scope').textContent,/Your assigned, shared, and personal tasks/);
  document.querySelector('#report-download').click();
  await pause();await pause();
  assert.equal(downloaded?.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(errors,[]);
});

test('supervisors can assign tasks to their team and add a collaborator without admin controls',async t=>{
  const fixture=authenticatedFixture('Supervisor');
  const teammate={...fixture.member,id:'00000000-0000-4000-8000-000000000021',user_id:'00000000-0000-4000-8000-000000000022',display_name:'Assigned teammate',email:'assigned@example.invalid',role:'Member'};
  fixture.members.push(teammate);fixture.supervision=[{supervisor_id:fixture.member.id,member_id:teammate.id}];
  const {document,window,errors}=await page(t,fixture.session,fixture);
  assert.equal(document.querySelector('#profile-role').textContent,'Supervisor');
  assert.equal(document.querySelector('#team-button').hidden,false);
  assert.equal(document.querySelector('#login-history-button').hidden,true);
  document.querySelector('#new-task').click();
  const form=document.querySelector('#task-form');form.elements.namedItem('title').value='Shared team task';
  form.elements.namedItem('owner').value=teammate.email;
  form.elements.namedItem('owner').dispatchEvent(new window.Event('change'));
  const collaborator=document.querySelector('#task-collaborators input[value="supervisor@example.invalid"]');
  assert.equal(collaborator.disabled,false);collaborator.checked=true;
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await pause();
  assert.equal(fixture.saved.p_values.assignee_member_id,teammate.id);
  assert.deepEqual(fixture.saved.p_collaborators,[fixture.member.id]);assert.deepEqual(errors,[]);
});

test('a shared-task participant can edit the task but participant controls stay locked',async t=>{
  const fixture=authenticatedFixture('Member');
  const owner={...fixture.member,id:'00000000-0000-4000-8000-000000000031',user_id:'00000000-0000-4000-8000-000000000032',email:'owner@example.invalid',display_name:'Primary owner'};
  fixture.members.push(owner);fixture.tasks[0].assignee_member_id=owner.id;
  fixture.collaborations=[{id:'00000000-0000-4000-8000-000000000033',task_id:fixture.tasks[0].id,member_id:fixture.member.id}];
  const {document,window}=await page(t,fixture.session,fixture);
  document.querySelector('[data-edit]').click();
  assert.equal(document.querySelector('#form-owner').disabled,true);
  const input=document.querySelector('#task-collaborators input[value="member@example.invalid"]');
  assert.equal(input.checked,true);assert.equal(input.disabled,true);
  const form=document.querySelector('#task-form');form.elements.namedItem('notes').value='Collaborator update';
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await pause();
  assert.equal(fixture.saved.p_values.description,'Collaborator update');assert.deepEqual(fixture.saved.p_collaborators,[fixture.member.id]);
});

test('admins can change a teammate role to Supervisor',async t=>{
  const fixture=authenticatedFixture('Admin');
  const target={...fixture.member,id:'00000000-0000-4000-8000-000000000041',user_id:'00000000-0000-4000-8000-000000000042',email:'target@example.invalid',display_name:'Future supervisor',role:'Member'};fixture.members.push(target);
  const {document,window,errors}=await page(t,fixture.session,fixture);
  document.querySelector('#team-button').click();document.querySelector('[data-manage-member="'+target.id+'"]').click();
  const form=document.querySelector('#member-access-form');form.elements.namedItem('role').value='Supervisor';form.elements.namedItem('role').dispatchEvent(new window.Event('change'));
  form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await pause();
  assert.equal(fixture.configured.p_role,'Supervisor');assert.equal(fixture.configured.p_member,target.id);
  assert.equal(document.querySelector('#member-access-dialog').open,false);assert.deepEqual(errors,[]);
});

test('admin setup requires a new confirmed password of eight characters', async t => {
  const { document, requests, window } = await page(t);
  document.querySelector('#auth-setup-link').click();
  assert.equal(document.querySelector('#auth-password').minLength, 8);
  assert.equal(document.querySelector('#auth-confirm-wrap').hidden, false);
  document.querySelector('#auth-email').value = 'abhilash@cartafella.com';
  document.querySelector('#auth-password').value = 'short';
  document.querySelector('#auth-confirm').value = 'short';
  document.querySelector('#auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await pause();
  assert.match(document.querySelector('#auth-message').textContent, /at least eight/);
  assert.equal(requests.length, 0, 'invalid setup must not create an account or send email');
});

test('unconfigured emails cannot use the initial-admin setup form', async t => {
  const { document, requests, window } = await page(t);
  document.querySelector('#auth-setup-link').click();
  document.querySelector('#auth-email').value = 'not-an-admin@example.invalid';
  document.querySelector('#auth-password').value = 'fixture-passphrase-42';
  document.querySelector('#auth-confirm').value = 'fixture-passphrase-42';
  document.querySelector('#auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await pause();
  assert.match(document.querySelector('#auth-message').textContent, /reserved for the two configured admins/);
  assert.equal(requests.length, 0);
});

test('forgot-password and back-to-login update field requirements', async t => {
  const { document } = await page(t);
  document.querySelector('#auth-reset-link').click();
  assert.equal(document.querySelector('#auth-password-wrap').hidden, true);
  assert.equal(document.querySelector('#auth-password').required, false);
  assert.equal(document.querySelector('#auth-confirm').required, false);
  document.querySelector('#auth-login-link').click();
  assert.equal(document.querySelector('#auth-password-wrap').hidden, false);
  assert.equal(document.querySelector('#auth-password').required, true);
});

test('a forged browser session cannot unlock the workspace or read rows', async t => {
  const sub = '00000000-0000-4000-8000-000000000099';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub, exp, role: 'authenticated' })).toString('base64url') + '.invalid-signature';
  const session = { access_token: token, refresh_token: 'invalid-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user: { id: sub, email: 'abhilash@cartafella.com', email_confirmed_at: new Date().toISOString(), app_metadata: { role: 'Admin' }, user_metadata: { role: 'Admin' } } };
  const { document, requests } = await page(t, session);
  await pause();
  assert.equal(document.body.classList.contains('signed-out'), true);
  assert.equal(document.querySelector('#task-view').children.length, 0);
  assert.equal(requests.some(request => request.url.includes('/rest/v1/')), false);
});
