import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const site = 'https://teamflow-fawn.vercel.app';
const allowedOrigins = new Set([site, 'http://localhost:4318', 'http://127.0.0.1:4318']);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowedOrigins.has(origin)) return reply(403, { error: 'This origin is not allowed.' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in before inviting anyone.' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const caller = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
  // This verifies the JWT with Supabase Auth, even when gateway verification is off.
  const { data: identity, error: identityError } = await caller.auth.getUser(authorization.slice(7));
  if (identityError || !identity.user || !identity.user.email_confirmed_at) return reply(401, { error: 'Your verified session is required.' });
  let input;
  try {
    const text = await req.text();
    if (text.length > 4096) return reply(413, { error: 'Request too large.' });
    input = JSON.parse(text);
  } catch { return reply(400, { error: 'Invalid JSON.' }); }
  const { workspaceId } = input;
  if (typeof workspaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(workspaceId)) return reply(400, { error: 'Choose a valid workspace.' });
  const { data: membership, error: membershipError } = await caller.from('team_members').select('id,role,email').eq('workspace_id', workspaceId).eq('user_id', identity.user.id).maybeSingle();
  if (membershipError || !membership || !['Admin','Supervisor'].includes(membership.role) || membership.email !== identity.user.email?.toLowerCase()) return reply(403, { error: 'An admin or supervisor must send invitations.' });
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const role = input.role || 'Member';
  if(!['Admin','Supervisor','Member'].includes(role)) return reply(400,{error:'Choose a valid role.'});
  if(membership.role==='Supervisor'&&role==='Admin')return reply(403,{error:'Only admins can invite Admin accounts.'});
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 80) return reply(400, { error: 'Enter a valid email and a name of up to 80 characters.' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let createdId: string | null = null;
  try {
    const { data: existing, error: lookupError } = await admin.from('team_members').select('id,user_id,role,managed_by_member_id').eq('workspace_id', workspaceId).eq('email', email).maybeSingle();
    if (lookupError) throw lookupError;
    if(membership.role==='Supervisor'&&existing){
      let managed=existing.role==='Supervisor'&&existing.managed_by_member_id===membership.id;
      if(existing.role==='Member'){
        const {data:assignment,error:scopeError}=await caller.from('supervisor_assignments').select('member_id').eq('workspace_id',workspaceId).eq('supervisor_id',membership.id).eq('member_id',existing.id).maybeSingle();
        if(scopeError)throw scopeError;managed=Boolean(assignment);
      }
      if(!managed)return reply(403,{error:'Resend invitations only within your managed team.'});
    }
    if (existing?.user_id) return reply(409, { error: 'This person already has access to the workspace.' });
    let memberId = existing?.id;
    if (!memberId) {
      const { data: added, error } = await admin.from('team_members').insert({ workspace_id: workspaceId, email, display_name: name, role, managed_by_member_id:membership.role==='Supervisor'?membership.id:null }).select('id').single();
      if (error) throw error;
      memberId = added.id;
      createdId = memberId;
      if(membership.role==='Supervisor'&&role==='Member'){
        const {error:assignmentError}=await admin.from('supervisor_assignments').insert({workspace_id:workspaceId,supervisor_id:membership.id,member_id:memberId});
        if(assignmentError)throw assignmentError;
      }
    }
    // Pending invitations retain their original role on resend.
    const { data: project, error: projectError } = await admin.from('projects').select('id').eq('workspace_id', workspaceId).eq('name', 'General').order('created_at').limit(1).maybeSingle();
    if (projectError) throw projectError;
    if (project) {
      const { error } = await admin.from('project_members').upsert({ workspace_id: workspaceId, project_id: project.id, member_id: memberId }, { ignoreDuplicates: true });
      if (error) throw error;
    }
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: site + '/?flow=invite', data: { display_name: name } });
    if (inviteError) {
      if (['email_exists', 'user_already_exists'].includes(inviteError.code || '')) {
        const { error: recoveryError } = await caller.auth.resetPasswordForEmail(email, { redirectTo: site + '/?flow=reset' });
        if (recoveryError) throw recoveryError;
      } else throw inviteError;
    }
    return reply(200, { message: 'Invitation sent. They must use this email address to set their password and join.', email });
  } catch (error) {
    if (createdId) {
      await admin.from('project_members').delete().eq('workspace_id', workspaceId).eq('member_id', createdId);
      await admin.from('team_members').delete().eq('workspace_id', workspaceId).eq('id', createdId).is('user_id', null);
    }
    const message = error instanceof Error ? error.message : 'Invitation could not be sent.';
    return reply(400, { error: message.includes('authorized') || message.includes('SMTP') ? 'Email delivery is not configured for this recipient. Configure custom SMTP in Supabase Auth, then retry.' : message });
  }
});
