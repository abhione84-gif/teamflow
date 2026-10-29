import { client, INITIAL_ADMINS, SITE_URL, context, clearContext, isAdmin, canManageTeam, canManageMember, loadWorkspace, inviteMember, recordLoginActivity, loadLoginActivity, configureMember } from './backend.js';

const $ = selector => document.querySelector(selector);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let authMode = 'login';
let pendingPassword = ['invite', 'reset'].includes(new URLSearchParams(location.search).get('flow')) || /type=(invite|recovery)/.test(location.hash);
let revision = 0;
let loading = false;
let pendingEntry = false;
let auditedUser = '';
let auditPending = false;
let deliverData;
let hideData;

function message(text, error = false) {
  $('#auth-message').textContent = text;
  $('#auth-message').classList.toggle('error', error);
  $('#auth-message').hidden = !text;
}

function mode(next, email = '') {
  authMode = next;
  const modes = {
    login: ['Sign in', 'Sign in with the email your admin invited.', 'Sign in'],
    setup: ['Admin account setup', 'Use one of the two configured admin email addresses. Verify the email to activate your account.', 'Create admin account'],
    reset: ['Reset password.', 'Enter your invited email. We’ll send a secure password reset link if an account exists.', 'Send reset link'],
    password: ['Set your password.', 'Set a password for the verified email below. Your email is fixed to the account from the link.', 'Save password & continue']
  };
  $('#auth-heading').textContent = modes[next][0];
  $('#auth-subtitle').textContent = modes[next][1];
  $('#auth-submit').textContent = modes[next][2];
  $('#auth-password-wrap').hidden = next === 'reset';
  $('#auth-confirm-wrap').hidden = !['setup', 'password'].includes(next);
  $('#auth-password').required = next !== 'reset';
  $('#auth-confirm').required = ['setup', 'password'].includes(next);
  $('#auth-password').minLength = ['setup', 'password'].includes(next) ? 8 : 1;
  $('#auth-password').autocomplete = ['setup', 'password'].includes(next) ? 'new-password' : 'current-password';
  $('#auth-email').readOnly = next === 'password';
  if (email) $('#auth-email').value = email;
  $('#auth-password').value = '';
  $('#auth-confirm').value = '';
  $('#auth-login-link').hidden = next === 'login';
  $('#auth-setup-link').hidden = next !== 'login';
  $('#auth-reset-link').hidden = next !== 'login';
  $('#auth-password-help').hidden = !['setup', 'password'].includes(next);
  message('');
}

function lockWorkspace() {
  revision++;
  pendingEntry=false;
  clearContext();
  auditedUser = '';
  hideData?.();
  document.body.classList.remove('signed-in');
  document.body.classList.add('signed-out');
  $('#auth-gate').hidden = false;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}

async function enterWorkspace() {
  if (loading) { pendingEntry=true; return; }
  loading = true;
  const current = ++revision;
  try {
    const state = await loadWorkspace();
    if (current !== revision) { clearContext(); return; }
    deliverData(state);
    document.body.classList.remove('signed-out');
    document.body.classList.add('signed-in');
    $('#auth-gate').hidden = true;
    const url = new URL(location.href);
    url.searchParams.delete('flow');
    url.hash = '';
    history.replaceState(null, '', url);
    renderTeam();
    if(auditedUser!==context.user?.id&&!auditPending){
      auditPending=true;
      const id=context.user.id;
      void recordLoginActivity().then(()=>{if(context.user?.id===id)auditedUser=id;}).catch(()=>{}).finally(()=>{auditPending=false;});
    }
  } catch (error) {
    if (current !== revision) return;
    lockWorkspace();
    mode('login');
    message(error.message || 'Could not open your workspace.', true);
  } finally { loading = false; if(pendingEntry){pendingEntry=false;setTimeout(()=>void enterWorkspace(),0);} }
}

function renderTeam() {
  if (!canManageTeam()) return;
  const visible=context.members.filter(m=>m.id===context.member.id||canManageMember(m));
  $('#team-roster').innerHTML = visible.map(member => `<div class="team-person"><span class="avatar">${safe(member.display_name.slice(0, 1).toUpperCase())}</span><span><strong>${safe(member.display_name)}</strong><small>${safe(member.email)}</small></span><span class="team-role ${member.role === 'Admin' ? 'admin' : ''}">${member.role === 'Admin' ? 'Admin' : member.role==='Supervisor' ? 'Supervisor' : 'Teammate'}</span><span class="team-status">${member.user_id ? 'Joined' : 'Invited'}</span>${canManageMember(member)?'<button type="button" class="button secondary member-manage" data-manage-member="'+safe(member.id)+'">Manage</button>':''}</div>`).join('');
  $('#team-member-count').textContent = isAdmin()?context.members.length+' / 20 people':visible.length+' people in your management scope';
  for(const option of $('#invite-form').elements.namedItem('role').options)option.hidden=option.value==='Admin'&&!isAdmin();
}

export function refreshTeamUI() { renderTeam(); }

export async function startAuth(onData, onSignedOut) {
  deliverData = onData;
  hideData = onSignedOut;
  mode('login');
  $('#auth-setup-link').addEventListener('click', () => mode('setup'));
  $('#auth-reset-link').addEventListener('click', () => mode('reset'));
  $('#auth-login-link').addEventListener('click', async () => {
    if (authMode === 'password') { pendingPassword = false; await client.auth.signOut({ scope: 'local' }); lockWorkspace(); }
    mode('login');
  });
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#auth-email').value.trim().toLowerCase();
    const password = $('#auth-password').value;
    const confirm = $('#auth-confirm').value;
    const currentMode = authMode;
    const submit = $('#auth-submit');
    submit.disabled = true;
    message('');
    try {
      if (['setup', 'password'].includes(currentMode) && (password.length < 8 || password !== confirm)) throw new Error('Use at least eight characters and make sure both passwords match.');
      if (currentMode === 'setup') {
        if (!INITIAL_ADMINS.includes(email)) throw new Error('This setup is reserved for the two configured admins. Teammates need an invitation.');
        const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL + '/?flow=confirm' } });
        if (error) throw error;
        $('#auth-password').value = '';
        $('#auth-confirm').value = '';
        message('Check this email for the verification link. If you already have an account, return to sign in or reset your password.');
      } else if (currentMode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL + '/?flow=reset' });
        if (error) throw error;
        message('If this email has an account, a reset link is on its way. Check your inbox and spam folder.');
      } else if (currentMode === 'password') {
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError || !userData.user || userData.user.email?.toLowerCase() !== email) throw new Error('Open a fresh invitation or password reset link for this email.');
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        pendingPassword = false;
        $('#auth-password').value = '';
        $('#auth-confirm').value = '';
        await enterWorkspace();
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        $('#auth-password').value = '';
        await enterWorkspace();
      }
    } catch (error) {
      const text = error.message || 'Could not complete this request.';
      message(/authorized|SMTP/i.test(text) ? 'Email delivery is not configured for this address. The project owner must configure custom SMTP in Supabase Auth.' : text, true);
    } finally { submit.disabled = false; }
  });

  $('#logout-button').addEventListener('click', async () => {
    pendingPassword = false;
    lockWorkspace();
    mode('login');
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) message('Your workspace is locked. Sign-out could not be confirmed; retry when your connection is restored.', true);
  });
  $('#team-button').addEventListener('click', () => {
    if (!canManageTeam()) return;
    renderTeam();
    $('#invite-message').textContent = '';
    $('#team-dialog').showModal();
  });
  $('#team-roster').addEventListener('click',event=>{
    const button=event.target.closest('[data-manage-member]');if(!button)return;
    const member=context.members.find(m=>m.id===button.dataset.manageMember);if(!canManageMember(member))return;
    const form=$('#member-access-form');form.elements.namedItem('member').value=member.id;form.elements.namedItem('role').value=member.role;
    form.elements.namedItem('role').disabled=member.user_id===context.user.id||INITIAL_ADMINS.includes(member.email);
    for(const option of form.elements.namedItem('role').options)option.hidden=option.value==='Admin'&&!isAdmin();
    $('#member-access-name').textContent=member.display_name+' · '+member.email;
    $('#member-supervisor').innerHTML='<option value="">No supervisor</option>'+context.members.filter(m=>m.role==='Supervisor'&&m.id!==member.id).map(m=>'<option value="'+safe(m.id)+'">'+safe(m.display_name)+'</option>').join('');
    $('#member-supervisor').value=context.supervision.find(s=>s.member_id===member.id)?.supervisor_id||'';
    $('#member-supervisor').disabled=!isAdmin()||member.role!=='Member';$('#member-access-message').textContent='';$('#member-access-dialog').showModal();
  });
  $('#member-access-form').elements.namedItem('role').addEventListener('change',event=>{$('#member-supervisor').disabled=!isAdmin()||event.target.value!=='Member';if(event.target.value!=='Member')$('#member-supervisor').value='';});
  $('#member-access-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!canManageTeam())return;const form=event.currentTarget,submit=$('#member-access-save');submit.disabled=true;
    const current=revision;
    try{await configureMember(form.elements.namedItem('member').value,form.elements.namedItem('role').value,$('#member-supervisor').value);if(current!==revision)return;const state=await loadWorkspace();if(current!==revision)return;deliverData(state);renderTeam();$('#member-access-dialog').close();}
    catch(error){$('#member-access-message').textContent=error.message||'Could not save access.';}finally{submit.disabled=false;}
  });
  $('#invite-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const current=revision;
    const submit = $('#invite-submit');
    submit.disabled = true;
    $('#invite-message').textContent = 'Sending invitation…';
    try {
      const form = new FormData(formElement);
      const result = await inviteMember({ email: form.get('email'), name: form.get('name'), role: form.get('role') });
      if(current!==revision)return;
      const state = await loadWorkspace();
      if(current!==revision)return;
      deliverData(state);
      renderTeam();
      formElement.reset();
      $('#invite-message').textContent = result.message;
    } catch (error) { $('#invite-message').textContent = error.message || 'The invitation could not be sent.'; }
    finally { submit.disabled = false; }
  });

  const history=async()=>{
    if(!isAdmin()) return;
    const generation=revision;
    $('#login-history-rows').textContent='Loading…';
    if(!$('#login-history-dialog').open) $('#login-history-dialog').showModal();
    try {
      const rows=await loadLoginActivity();
      if(generation!==revision||!isAdmin()) return;
      $('#login-history-rows').innerHTML=rows.length?'<table class="login-history-table"><thead><tr><th>User</th><th>Login time</th><th>IP address</th><th>Approximate location</th></tr></thead><tbody>'+rows.map(row=>{
        const location=[row.city,row.region,row.country].filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join(', ');
        return '<tr><td><strong>'+safe(row.display_name)+'</strong><small>'+safe(row.email)+'</small></td><td>'+safe(new Date(row.logged_in_at).toLocaleString())+'</td><td title="'+safe(row.user_agent||'')+'">'+safe(row.ip_address||'Unavailable')+'</td><td>'+safe(location||(row.location_status==='pending'?'Lookup pending':'Unavailable'))+'</td></tr>';
      }).join('')+'</tbody></table>':'<p class="muted">No login records.</p>';
    } catch { $('#login-history-rows').textContent='Could not load login history. Try again.'; }
  };
  $('#login-history-button').addEventListener('click',history);
  $('#login-history-refresh').addEventListener('click',history);

  client.auth.onAuthStateChange((event, session) => {
    // Supabase API calls run outside the auth callback to avoid its session lock.
    if (event === 'SIGNED_OUT') { lockWorkspace(); mode('login'); return; }
    if (event === 'PASSWORD_RECOVERY') pendingPassword = true;
    if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session) setTimeout(() => {
      if(context.user&&context.user.id!==session.user.id)lockWorkspace();
      if (pendingPassword) { lockWorkspace(); mode('password', session.user.email || ''); }
      else if (!context.user) void enterWorkspace();
    }, 0);
  });
  const { data, error } = await client.auth.getSession();
  if (error) message(error.message, true);
  else if (data.session) {
    if (pendingPassword) mode('password', data.session.user.email || '');
    else await enterWorkspace();
  }
  const parameters = new URLSearchParams(location.hash.slice(1));
  if (parameters.get('error_description')) message(parameters.get('error_description'), true);
  const refresh = async () => {
    if (!context.user || !document.body.classList.contains('signed-in') || loading || document.hidden || document.querySelector('dialog[open]') || document.body.dataset.saving === 'true') return;
    await enterWorkspace();
  };
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
}
