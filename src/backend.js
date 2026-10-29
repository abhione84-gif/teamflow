import { makeDeadline, deadlineParts, defaultTimeZone } from './deadlines.js';
import { createClient } from '@supabase/supabase-js';

export const INITIAL_ADMINS = ['abhilash@cartafella.com', 'abhione84@gmail.com'];
export const SITE_URL = 'https://teamflow-fawn.vercel.app';
export const client = createClient('https://ziemlsjdvqxujndaludh.supabase.co', 'sb_publishable_uxFtyRtqnn9R0QqXHf01Eg_NX9sDUjR', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'teamflow-auth-v1' }
});
export const context = { user: null, member: null, workspace: null, members: [], supervision: [] };
let contextVersion=0;
function assertContextVersion(version) {
  if(version!==contextVersion)throw new Error('Your session changed. Sign in again.');
}
const databaseStatus = { 'To do': 'To Do', 'In progress': 'In Progress', Waiting: 'Waiting', Done: 'Done' };
const browserStatus = { 'To Do': 'To do', 'In Progress': 'In progress', Waiting: 'Waiting', Done: 'Done' };
const unwrap = result => { if (result.error) throw result.error; return result.data; };
export const isAdmin = () => context.member?.role === 'Admin';
export const isSupervisor = () => context.member?.role === 'Supervisor';
export const canManageTeam = () => isAdmin()||isSupervisor();
export const canManageMember = member => Boolean(member&&(isAdmin()||(isSupervisor()&&member.id!==context.member.id&&member.role!=='Admin'&&((member.role==='Member'&&context.supervision.some(row=>row.member_id===member.id&&row.supervisor_id===context.member.id))||(member.role==='Supervisor'&&member.managed_by_member_id===context.member.id)))));
export const canAssignMember = member => Boolean(member&&(isAdmin()||member.id===context.member?.id||(isSupervisor()&&member.role==='Member'&&context.supervision.some(row=>row.member_id===member.id&&row.supervisor_id===context.member.id))));
export const canManageTaskPeople = task => isAdmin()||(isSupervisor()&&!task?.personal&&(!task||canAssignMember(context.members.find(m=>m.email===task.owner))));
export const ownerName = email => context.members.find(member => member.email === email)?.display_name || email || 'Unassigned';

async function readRows(table, workspaceId) {
  const rows = [];
  for (let start = 0; start < 20000; start += 500) {
    const page = unwrap(await client.from(table).select('*').eq('workspace_id', workspaceId).order('created_at').order('id').range(start, start + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  throw new Error('This workspace is too large for this dashboard. Contact your admin.');
}

export function clearContext() {
  contextVersion++;
  context.user = null;
  context.member = null;
  context.workspace = null;
  context.members = [];
  context.supervision = [];
}

export async function loadWorkspace() {
  const version=contextVersion;
  const identity = unwrap(await client.auth.getUser());
  if (!identity.user?.email_confirmed_at) throw new Error('Verify your invited email before accessing this workspace.');
  const email = identity.user.email.toLowerCase();
  if (INITIAL_ADMINS.includes(email)) unwrap(await client.rpc('initialize_admin'));
  unwrap(await client.rpc('accept_team_invites'));
  const member = unwrap(await client.from('team_members').select('*').eq('user_id', identity.user.id).order('created_at').limit(1).maybeSingle());
  if (!member) throw new Error('This email has not been invited to Teamflow. Ask an admin to invite the exact address you used to sign in.');
  const workspace = unwrap(await client.from('workspaces').select('id,name').eq('id', member.workspace_id).single());
  const [projects, tasks, members, collaborations, supervision] = await Promise.all([
    readRows('projects', workspace.id), readRows('tasks', workspace.id),
    client.from('team_members').select('id,email,display_name,role,user_id,created_at,managed_by_member_id').eq('workspace_id', workspace.id).order('created_at').then(unwrap),
    readRows('task_collaborators',workspace.id),
    client.from('supervisor_assignments').select('supervisor_id,member_id').eq('workspace_id',workspace.id).then(unwrap)
  ]);
  assertContextVersion(version);
  context.user = identity.user;
  context.member = member;
  context.workspace = workspace;
  context.members = members;
  context.supervision = supervision;
  const allProjects = projects.map(project => ({ id: project.id, name: project.name, color: project.color }));
  if (tasks.some(task => task.personal)) allProjects.push({ id: '__personal', name: 'Personal tasks', color: '#94bba6' });
  return {
    version: 1, sample: false, projects: allProjects,
    tasks: tasks.map(task => ({
      id: task.id, title: task.title, notes: task.description, project: task.project_id || '__personal',
      owner: members.find(m => task.personal ? m.user_id === task.creator_id : m.id === task.assignee_member_id)?.email || '',
      priority: task.priority, status: browserStatus[task.status], due: task.due_date || '', followup: task.followup_date || '',
      dueAt: task.due_at || null, dueTime: deadlineParts(task.due_at, task.due_timezone || 'Asia/Bangkok').time, dueTimezone: task.due_timezone || 'Asia/Bangkok',
      collaborators: collaborations.filter(c=>c.task_id===task.id).map(c=>members.find(m=>m.id===c.member_id)?.email).filter(Boolean),
      personal: task.personal, completedAt: task.completed_at || null, createdAt: task.created_at, updatedAt: task.updated_at
    }))
  };
}

function payload(task, previous) {
  const personal = previous?.personal || task.project === '__personal';
  const member = context.members.find(person => person.email === task.owner);
  if (!personal && !member) throw new Error('Choose an invited teammate as the task owner.');
  if (!databaseStatus[task.status]) throw new Error('Invalid task status.');
  const timeZone=task.dueTimezone || previous?.dueTimezone || defaultTimeZone();
  const time=task.dueTime ?? previous?.dueTime ?? '';
  let dueAt=makeDeadline(task.due || '',time,timeZone);
  if(previous?.dueAt && task.due===previous.due && time===previous.dueTime && timeZone===previous.dueTimezone) dueAt=previous.dueAt;
  return {
    due_at: dueAt, due_timezone: timeZone,
    title: task.title.trim(), description: task.notes || '', status: databaseStatus[task.status],
    priority: task.priority, due_date: task.due || null, followup_date: task.followup || null,
    project_id: personal ? null : task.project, assignee_member_id: personal ? null : member.id
  };
}

async function ensureProjectMember(projectId, memberId) {
  if (!isAdmin() || !projectId || !memberId) return;
  unwrap(await client.from('project_members').upsert({ workspace_id: context.workspace.id, project_id: projectId, member_id: memberId }, { ignoreDuplicates: true }));
}

export async function saveChanges(previous, next) {
  if (!context.user || !context.workspace) throw new Error('Sign in before saving changes.');
  const version=contextVersion;
  const workspaceId = context.workspace.id;
  for (const project of next.projects) {
    assertContextVersion(version);
    if (project.id === '__personal' || previous.projects.some(item => item.id === project.id)) continue;
    if (!isAdmin()) throw new Error('Only admins can create projects.');
    unwrap(await client.from('projects').insert({ id: project.id, workspace_id: workspaceId, name: project.name, color: project.color, created_by: context.user.id }));
    assertContextVersion(version);
    await ensureProjectMember(project.id, context.member.id);
  }
  for (const oldTask of previous.tasks) {
    assertContextVersion(version);
    if (next.tasks.some(task => task.id === oldTask.id)) continue;
    if (!isAdmin()) throw new Error('Only admins can delete tasks.');
    const result = unwrap(await client.from('tasks').delete().eq('id', oldTask.id).eq('workspace_id', workspaceId).eq('updated_at', oldTask.updatedAt).select('id'));
    if (result.length !== 1) throw new Error('This task changed in another session. The latest workspace has been reloaded.');
  }
  for (const task of next.tasks) {
    assertContextVersion(version);
    const oldTask = previous.tasks.find(item => item.id === task.id);
    if (oldTask && JSON.stringify(oldTask) === JSON.stringify(task)) continue;
    const fields = payload(task, oldTask);
    if (!oldTask&&!isAdmin()&&!isSupervisor()&&task.owner!==context.member.email) throw new Error('Teammates can create tasks only for themselves.');
    const collaborators=(task.collaborators??oldTask?.collaborators??[]).filter(email=>email!==task.owner).map(email=>{
      const member=context.members.find(m=>m.email===email);if(!member)throw new Error('Choose invited collaborators.');return member.id;
    });
    unwrap(await client.rpc('save_team_task',{p_task:task.id,p_values:{...fields,workspace_id:workspaceId,personal:task.project==='__personal'},p_expected_updated_at:oldTask?.updatedAt||null,p_collaborators:collaborators}));
  }
  assertContextVersion(version);
  return loadWorkspace();
}

export async function inviteMember({ email, name, role }) {
  if (!canManageTeam()) throw new Error('An admin or supervisor must send invitations.');
  if(isSupervisor()&&role==='Admin')throw new Error('Only admins can invite Admin accounts.');
  const { data, error } = await client.functions.invoke('invite-team-member', { body: { workspaceId: context.workspace.id, email, name, role } });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* No JSON response. */ }
    throw new Error(message);
  }
  if (data.error) throw new Error(data.error);
  return data;
}

export async function getDueAlerts() {
  if(!context.user||!context.workspace) return [];
  return unwrap(await client.rpc('get_due_task_alerts',{p_workspace:context.workspace.id})) || [];
}
export async function acknowledgeDueAlerts(alerts) {
  if(!context.user) throw new Error('Sign in first.');
  const rows=alerts.map(item=>({user_id:context.user.id,task_id:item.task_id,due_at:item.due_at}));
  unwrap(await client.from('task_alert_receipts').upsert(rows,{ignoreDuplicates:true}));
}
export async function recordLoginActivity() {
  const {error}=await client.functions.invoke('record-login',{body:{}});
  if(error) throw error;
}
export async function loadLoginActivity() {
  if(!isAdmin()) throw new Error('Only admins can view login history.');
  return unwrap(await client.from('login_activity').select('id,email,display_name,logged_in_at,ip_address,user_agent,country,region,city,location_status').eq('workspace_id',context.workspace.id).order('logged_in_at',{ascending:false}).limit(100));
}
export async function configureMember(member,role,supervisor) {
  if(!canManageMember(context.members.find(m=>m.id===member)))throw new Error('Manage only members assigned to you.');
  if(isSupervisor()&&role==='Admin')throw new Error('Only admins can assign the Admin role.');
  unwrap(await client.rpc('configure_member',{p_member:member,p_role:role,p_supervisor:supervisor||null}));
}
