import { createReports } from './reports.js';
import { defaultTimeZone, makeDeadline, formatDeadline, isOverdue, isDueToday, calendarDate, calendarTime, deadlineInstant, timeZoneOptions } from './deadlines.js';
import { createDeadlineAlerts } from './alerts.js';
import { context, clearContext, isAdmin, isSupervisor, canManageTeam, canAssignMember, canManageTaskPeople, ownerName, loadWorkspace, saveChanges } from './backend.js';
import { startAuth, refreshTeamUI } from './auth-ui.js';
'use strict';

const STORAGE_KEY = 'teamflow-v1';
const STATUSES = ['To do', 'In progress', 'Waiting', 'Done'];
const COLORS = ['#a891d3', '#80abc5', '#d6a57e', '#88b49b', '#c88fba', '#9b9ed0'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const uid = () => crypto.randomUUID();
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => dateKey(new Date());
const offsetDate = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return dateKey(date); };
const validDate = value => value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T12:00:00').valueOf()) && dateKey(new Date(value + 'T12:00:00')) === value);
const dateLabel = value => !value ? 'No due date' : value === today() ? 'Today' : new Date(value + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const initials = value => (value || '?').split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
let data = { version: 1, sample: false, projects: [], tasks: [] };
let saving = false;

let section = 'overview';
let projectFilter = '';
let statFilter = '';
let view = 'board';
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let toastTimer;
let deleteArmed = false;
const deadlineAlerts=createDeadlineAlerts(async id=>{
  const user=context.user?.id;
  try{const state=await loadWorkspace();if(context.user?.id!==user||!document.body.classList.contains('signed-in'))return;data=state;render();applyIdentity();if(data.tasks.some(task=>task.id===id))openTask(id);else toast('This task is no longer available.');}
  catch{toast('Could not load this task.');}
});

const reports=createReports(()=>data,async()=>{const user=context.user?.id;const state=await loadWorkspace();if(context.user?.id!==user||!document.body.classList.contains('signed-in')){clearContext();throw new Error('Sign in again.');}data=state;render();applyIdentity();},openTask,toast);

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}

async function commit(nextData, message) {
  if (saving) { toast('Please wait for the current change to finish.'); return false; }
  if (!context.user) { toast('Sign in before saving changes.'); return false; }
  saving = true;
  document.body.dataset.saving = 'true';
  $('#save-state').textContent = 'Saving to your workspace…';
  try {
    const state = await saveChanges(data, nextData);
    if (!document.body.classList.contains('signed-in')) { clearContext(); return false; }
    data = state;
    render();
    applyIdentity();
    $('#save-state').innerHTML = '<i></i> Saved to cloud';
    if (message) toast(message);
    return true;
  } catch (error) {
    $('#save-state').textContent = 'Change was not saved';
    toast(error.message || 'Could not save this change.');
    try { if (document.body.classList.contains('signed-in')) { data = await loadWorkspace(); render(); applyIdentity(); } } catch { /* Auth refresh will lock an expired session. */ }
    return false;
  } finally { saving = false; document.body.dataset.saving = 'false'; }
}

function applyIdentity() {
  const member = context.member;
  if (!member) return;
  $('#workspace-name').textContent = context.workspace.name;
  $('#profile-name').textContent = member.display_name;
  $('#profile-role').textContent = isAdmin() ? 'Workspace admin' : isSupervisor() ? 'Supervisor' : 'Teammate';
  $('#momentum-label').textContent = isAdmin() ? 'Workspace progress' : isSupervisor() ? 'Your team’s progress' : 'Your progress';
  $$('[data-user-avatar]').forEach(element => element.textContent = initials(member.display_name));
  document.body.dataset.role = isAdmin() ? 'admin' : isSupervisor() ? 'supervisor' : 'member';
  for (const id of ['add-project', 'new-project-shortcut', 'legacy-export', 'login-history-button']) document.getElementById(id).hidden = !isAdmin();
  $('#team-button').hidden=!canManageTeam();
  $('#new-task').disabled = !data.projects.length;
  $('#save-state').innerHTML = '<i></i> Saved to cloud';
  refreshTeamUI();
}

function filteredTasks() {
  const search = $('#search').value.trim().toLowerCase();
  const owner = $('#owner-filter').value;
  const priority = $('#priority-filter').value;
  const filtered = data.tasks.filter(task => {
    const active = task.status !== 'Done';
    if (projectFilter && task.project !== projectFilter) return false;
    if (section === 'today' && (!active || (!isDueToday(task) && task.followup !== today()))) return false;
    if (section === 'followups' && (!active || !task.followup)) return false;
    if (section === 'completed' && active) return false;
    if (statFilter === 'active' && !active) return false;
    if (statFilter === 'overdue' && (!active || !isOverdue(task))) return false;
    if (owner && task.owner !== owner) return false;
    if (priority && task.priority !== priority) return false;
    const project = data.projects.find(item => item.id === task.project);
    return !search || `${task.title} ${task.notes} ${task.owner} ${ownerName(task.owner)} ${project?.name || ''}`.toLowerCase().includes(search);
  });
  const sort = $('#sort-filter').value;
  if (sort === 'due') filtered.sort((a, b) => (deadlineInstant(a) || '9999').localeCompare(deadlineInstant(b) || '9999'));
  if (sort === 'priority') { const ranks = { High: 0, Medium: 1, Low: 2 }; filtered.sort((a, b) => ranks[a.priority] - ranks[b.priority]); }
  if (sort === 'title') filtered.sort((a, b) => a.title.localeCompare(b.title));
  return filtered;
}

function navigate(next, project = '', stat = '') {
  section = next;
  projectFilter = project;
  statFilter = stat;
  $('#search').value = '';
  $('#owner-filter').value = '';
  $('#priority-filter').value = '';
  $('#sidebar').classList.remove('open');
  $('#menu-button').setAttribute('aria-expanded', 'false');
  render();
}

function render() {
  const active = data.tasks.filter(task => task.status !== 'Done');
  const dueToday = active.filter(task => isDueToday(task));
  const followups = active.filter(task => task.followup);
  const done = data.tasks.length - active.length;
  renderInsights(active, dueToday, done);
  $('#stat-active').textContent = active.length;
  $('#stat-today').textContent = dueToday.length;
  $('#stat-overdue').textContent = active.filter(task => isOverdue(task)).length;
  $('#stat-done').textContent = done;
  $('#today-count').textContent = active.filter(task => isDueToday(task) || task.followup === today()).length;
  $('#task-count').textContent = data.tasks.length;
  $('#followup-count').textContent = followups.length;
  $('#current-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  document.body.dataset.section = section;
  const project = data.projects.find(item => item.id === projectFilter);
  const headings = {
    reports: ['Monthly reports','Review tasks by month and download Excel','Monthly reports','Reports'],
    overview: ['Overview','Tasks and projects','Tasks','Overview'],
    today: ['My day','Tasks and follow-ups due today','Today’s tasks','My day'],
    tasks: ['All tasks','Manage your tasks','All tasks','All tasks'],
    followups: ['Follow-ups','Tasks with a follow-up date','Follow-ups','Follow-ups'],
    completed: ['Completed','Completed tasks','Completed tasks','Completed']
  };
  let [title, subtitle, tasksTitle, breadcrumb] = headings[section];
  if (project) { title = project.name; subtitle = 'Project tasks'; tasksTitle = 'Project tasks'; breadcrumb = project.name; }
  if (statFilter === 'overdue') { title = 'Overdue'; subtitle = 'Open tasks past their due time'; tasksTitle = 'Overdue tasks'; breadcrumb = 'Overdue'; }
  if (statFilter === 'active') tasksTitle = 'Active tasks';
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#tasks-heading').textContent = tasksTitle;
  $('#breadcrumb-title').textContent = breadcrumb;
  $$('[data-section]').forEach(button => button.classList.toggle('active', !projectFilter && button.dataset.section === section));
  $('#project-nav').innerHTML = data.projects.map(item => `<button class="nav-item ${projectFilter === item.id ? 'active' : ''}" data-project="${escapeHTML(item.id)}"><span class="project-dot" style="background:${item.color}"></span><span class="project-title">${escapeHTML(item.name)}</span><span class="nav-count">${active.filter(task => task.project === item.id).length}</span></button>`).join('');
  const selectedOwner = $('#owner-filter').value;
  const owners = [...new Set(data.tasks.map(task => task.owner).filter(Boolean))].sort();
  $('#owner-filter').innerHTML = '<option value="">All owners</option>' + owners.map(owner => `<option value="${escapeHTML(owner)}">${escapeHTML(ownerName(owner))}</option>`).join('');
  if (owners.includes(selectedOwner)) $('#owner-filter').value = selectedOwner;
  $('#owner-options').innerHTML = owners.map(owner => `<option value="${escapeHTML(owner)}"></option>`).join('');
  const reporting=section==='reports';
  $('#reports-page').hidden=!reporting;
  for(const selector of ['.stats','.task-workspace','.project-snapshot']){const element=$(selector);if(element)element.hidden=reporting;}
  if(reporting)reports.render();
  const tasks = filteredTasks();
  $('#visible-count').textContent = tasks.length;
  $$('[data-view]').forEach(button => { const selected = button.dataset.view === view; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  if (view === 'calendar') renderCalendar(tasks);
  else if (view === 'list') renderList(tasks);
  else renderBoard(tasks);
}

function renderInsights(active, dueToday, done) {
  const total = data.tasks.length;
  const percent = total ? Math.round(done / total * 100) : 0;
  $('#momentum-percent').textContent = percent + '%';
  $('#momentum-summary').textContent = total ? done + ' of ' + total + ' tasks completed.' : 'No tasks yet.';
  $('#momentum-projects').textContent = data.projects.length + (data.projects.length === 1 ? ' project' : ' projects') + ' in your workspace';
  $('#progress-ring').setAttribute('aria-label', percent + ' percent of tasks complete');
  $('#ring-fill').style.strokeDashoffset = String(257.61 * (1 - percent / 100));
  const overdue = active.filter(task => isOverdue(task)).length;
  for (const [id, count] of [['active-meter', active.length], ['today-meter', dueToday.length], ['overdue-meter', overdue], ['done-meter', done]]) document.getElementById(id).style.width = (total ? count / total * 100 : 0) + '%';
  $('#project-total').textContent = data.projects.length;
  $('#project-overview').innerHTML = data.projects.slice(0, 3).map(project => {
    const tasks = data.tasks.filter(task => task.project === project.id);
    const completed = tasks.filter(task => task.status === 'Done').length;
    const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
    const owners = [...new Set(tasks.map(task => task.owner).filter(Boolean))].slice(0, 3);
    return '<button class="project-summary" data-open-project="' + escapeHTML(project.id) + '" style="--project-color:' + project.color + '"><span class="project-summary-top"><span class="project-summary-icon">' + icon('folder') + '</span><strong>' + escapeHTML(project.name) + '</strong>' + icon('follow') + '</span><span class="project-summary-progress"><span>' + completed + ' of ' + tasks.length + ' tasks complete</span><strong>' + progress + '%</strong></span><span class="project-progress-track"><i style="width:' + progress + '%"></i></span><span class="project-summary-bottom"><span class="avatar-stack">' + (owners.length ? owners.map(owner => '<span class="avatar" title="' + escapeHTML(ownerName(owner)) + '">' + escapeHTML(initials(ownerName(owner))) + '</span>').join('') : '<span class="unassigned-project">Ready for your first task</span>') + '</span><span>' + (tasks.length - completed) + ' active</span></span></button>';
  }).join('');
}

function card(task) {
  const project = data.projects.find(item => item.id === task.project);
  const overdue = task.status !== 'Done' && isOverdue(task);
  const dueClass = overdue ? 'overdue' : isDueToday(task) ? 'today' : '';
  return `<article class="task-card ${task.status === 'Done' ? 'done' : ''}" data-task="${escapeHTML(task.id)}">
    <div class="card-top"><span class="project-tag" style="--project-color:${project.color}">${icon('folder')}${escapeHTML(project.name)}</span><button class="icon-button card-menu" data-edit="${escapeHTML(task.id)}" aria-label="Edit ${escapeHTML(task.title)}">${icon('more')}</button></div>
    <h3><button class="task-title" data-edit="${escapeHTML(task.id)}">${escapeHTML(task.title)}</button></h3>${task.notes ? `<p class="card-notes">${escapeHTML(task.notes)}</p>` : ''}
    <div class="card-tags"><span class="priority ${task.priority.toLowerCase()}"><i></i>${task.priority}</span>${task.collaborators?.length ? '<span class="collaboration-tag" title="'+escapeHTML(task.collaborators.map(ownerName).join(', '))+'">'+(task.collaborators.length+1)+' people</span>':''}${task.followup ? `<span class="followup-tag">${icon('follow')}Follow up ${dateLabel(task.followup)}</span>` : ''}</div>
    <div class="card-footer"><span class="due-label ${dueClass}">${icon('calendar')}${overdue ? 'Overdue · ' : ''}${escapeHTML(formatDeadline(task))}</span><span class="card-owner"><span class="avatar" title="${escapeHTML(ownerName(task.owner))}">${escapeHTML(initials(ownerName(task.owner)))}</span><button class="complete-check ${task.status === 'Done' ? 'checked' : ''}" data-complete="${escapeHTML(task.id)}" aria-label="${task.status === 'Done' ? 'Reopen' : 'Complete'} ${escapeHTML(task.title)}">${icon('check')}</button></span></div>
  </article>`;
}

function renderBoard(tasks) {
  const names = ['todo', 'progress', 'waiting', 'done'];
  const symbols = ['tasks', 'clock', 'follow', 'circle'];
  const statuses = section === 'completed' ? ['Done'] : STATUSES;
  $('#task-view').innerHTML = `<div class="board ${statuses.length === 1 ? 'single-column' : ''}">${statuses.map(status => {
    const group = tasks.filter(task => task.status === status);
    return `<section class="column ${names[STATUSES.indexOf(status)]}" aria-label="${status}"><div class="column-header"><span class="column-icon">${icon(symbols[STATUSES.indexOf(status)])}</span><span class="column-name">${status}</span><span class="column-count">${group.length}</span><button class="icon-button" data-add-status="${status}" aria-label="Add task to ${status}">${icon('plus')}</button></div>${group.map(card).join('') || '<div class="empty-column">' + icon('spark') + '<span>No tasks</span></div>'}<button class="add-column" data-add-status="${status}">${icon('plus')} Add a task</button></section>`;
  }).join('')}</div>`;
}

function renderList(tasks) {
  if (!tasks.length) { renderEmpty(); return; }
  $('#task-view').innerHTML = `<div class="table-scroll"><table class="list-table"><thead><tr><th aria-label="Complete"></th><th>Task</th><th>Project</th><th>Status</th><th>Priority</th><th>Owner</th><th>Due date</th></tr></thead><tbody>${tasks.map(task => {
    const project = data.projects.find(item => item.id === task.project);
    return `<tr class="task-row" data-task="${escapeHTML(task.id)}"><td><button class="complete-check ${task.status === 'Done' ? 'checked' : ''}" data-complete="${escapeHTML(task.id)}" aria-label="${task.status === 'Done' ? 'Reopen' : 'Complete'} ${escapeHTML(task.title)}">${task.status === 'Done' ? '✓' : ''}</button></td><td><button class="list-title" data-edit="${escapeHTML(task.id)}">${escapeHTML(task.title)}</button></td><td><span class="project-tag" style="--project-color:${project.color}">${escapeHTML(project.name)}</span></td><td><select class="status-select" data-status-id="${escapeHTML(task.id)}" aria-label="Status for ${escapeHTML(task.title)}">${STATUSES.map(status => `<option ${status === task.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td><td><span class="priority ${task.priority.toLowerCase()}">${task.priority}</span></td><td>${escapeHTML(ownerName(task.owner))}${task.collaborators?.length?'<small class="list-collaborators">+ '+escapeHTML(task.collaborators.map(ownerName).join(', '))+'</small>':''}</td><td>${escapeHTML(formatDeadline(task))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderEmpty() {
  $('#task-view').innerHTML = '<div class="empty-state"><h3>No tasks</h3><p>No tasks match your filters.</p><button class="button secondary" data-add-status="To do">+ Create a task</button></div>';
}

function renderCalendar(tasks) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = dateKey(date);
    const dayTasks = tasks.filter(task => calendarDate(task) === key);
    cells.push(`<div class="calendar-day ${date.getMonth() !== month ? 'outside' : ''} ${key === today() ? 'is-today' : ''}"><button class="day-number" data-add-date="${key}" aria-label="Add task on ${key}">${date.getDate()}</button>${dayTasks.map(task => `<button class="calendar-task" data-edit="${escapeHTML(task.id)}" title="${escapeHTML(task.title)} · ${escapeHTML(formatDeadline(task))}">${task.status === 'Done' ? '✓ ' : ''}${escapeHTML(task.title)}<span class="calendar-task-time">${escapeHTML(calendarTime(task))}</span></button>`).join('')}</div>`);
  }
  $('#task-view').innerHTML = `<div class="calendar-heading"><span>${calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}<small>${escapeHTML(defaultTimeZone())}</small></span><div><button class="icon-button" data-month="-1" aria-label="Previous month">‹</button><button class="button secondary" data-current-month>Today</button><button class="icon-button" data-month="1" aria-label="Next month">›</button></div></div><div class="calendar-wrap"><div class="calendar-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${cells.join('')}</div></div><p class="calendar-unscheduled">${tasks.filter(task => !task.due).length} tasks without a due date. Add a due date to place them on the calendar.</p>`;
}

function openTask(id, defaults = {}) {
  if (!context.user || !data.projects.length) { toast('Ask your admin to add you to a project first.'); return; }
  const task = id ? data.tasks.find(item => item.id === id) : null;
  if (id && !task) return;
  const form = $('#task-form');
  form.reset();
  $('#form-project').innerHTML = data.projects.map(project => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`).join('');
  if(task&&!task.personal)$('#form-project option[value="__personal"]')?.remove();
  $('#form-owner').innerHTML = context.members.map(member => '<option value="' + escapeHTML(member.email) + '">' + escapeHTML(member.display_name) + ' · ' + escapeHTML(member.email) + '</option>').join('');
  $('#form-owner').disabled = !canManageTaskPeople(task) || Boolean(task?.personal);
  if(!task||canManageTaskPeople(task))for(const option of $('#form-owner').options){const person=context.members.find(m=>m.email===option.value);if(!canAssignMember(person)&&option.value!==task?.owner)option.remove();}
  $('#form-project').disabled = !isAdmin() && Boolean(task) || Boolean(task?.personal);
  $('#due-timezone').innerHTML=timeZoneOptions(task?.dueTimezone||defaultTimeZone()).map(zone=>'<option>'+escapeHTML(zone)+'</option>').join('');
  const values = task || { id: '', title: '', notes: '', project: projectFilter || data.projects[0].id, owner: context.member.email, priority: 'Medium', status: section === 'followups' ? 'Waiting' : section === 'completed' ? 'Done' : 'To do', due: section === 'today' ? today() : '', dueTime: '', dueTimezone: defaultTimeZone(), followup: section === 'followups' ? today() : '', ...defaults };
  if(values.due&&!values.dueTime)values.dueTime='17:00';
  for (const [name, value] of Object.entries(values)) if (form.elements.namedItem(name)) form.elements.namedItem(name).value = value;
  form.elements.namedItem('dueTime').disabled=!values.due;
  form.elements.namedItem('dueTime').required=Boolean(values.due);
  renderCollaborators(task?.collaborators||[],task);
  $('#dialog-title').textContent = task ? 'Edit task' : 'Create a task';
  $('#delete-task').hidden = !task || !isAdmin();
  $('#delete-task').textContent = 'Delete task';
  deleteArmed = false;
  $('#task-dialog').showModal();
  form.elements.namedItem('title').focus();
}

function renderCollaborators(selected=[],task=null) {
  const personal=$('#form-project').value==='__personal';
  $('#form-owner').disabled=personal||!canManageTaskPeople(task);
  if(personal)$('#form-owner').value=task?.owner||context.member.email;
  const owner=$('#form-owner').value;
  $('#collaborators-field').hidden=personal;
  $('#task-collaborators').innerHTML=context.members.filter(m=>m.email!==owner).map(m=>'<label><input type="checkbox" name="collaborator" value="'+escapeHTML(m.email)+'" '+(selected.includes(m.email)?'checked ':'')+(!canManageTaskPeople(task)||!canAssignMember(m)?'disabled':'')+'><span>'+escapeHTML(m.display_name)+'<small>'+escapeHTML(m.email)+'</small></span></label>').join('')||'<p class="muted">No additional teammates available.</p>';
}
$('#form-owner').addEventListener('change',()=>{const id=$('#task-form').elements.namedItem('id').value;renderCollaborators($$('#task-collaborators input:checked').map(input=>input.value),data.tasks.find(t=>t.id===id));});
$('#form-project').addEventListener('change',()=>{const id=$('#task-form').elements.namedItem('id').value;renderCollaborators($$('#task-collaborators input:checked').map(input=>input.value),data.tasks.find(t=>t.id===id));});
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.owner = event.currentTarget.elements.namedItem('owner').value;
  values.project = event.currentTarget.elements.namedItem('project').value;
  values.title = values.title.trim();
  values.owner = values.owner.trim();
  values.dueTime=event.currentTarget.elements.namedItem('dueTime').value;
  try{makeDeadline(values.due,values.dueTime,values.dueTimezone);}catch(error){toast(error.message);return;}
  if (!values.title) { toast('Give your task a name.'); return; }
  if (!validDate(values.due) || !validDate(values.followup)) { toast('Choose a valid date.'); return; }
  const existing = data.tasks.find(task => task.id === values.id);
  values.collaborators=$$('#task-collaborators input:checked').map(input=>input.value);
  const task = { ...existing, ...values, id: existing?.id || uid(), createdAt: existing?.createdAt || new Date().toISOString() };
  const next = { ...data, tasks: existing ? data.tasks.map(item => item.id === task.id ? task : item) : [...data.tasks, task] };
  if (await commit(next, existing ? 'Task updated.' : 'Task created.')) $('#task-dialog').close();
});

$('#delete-task').addEventListener('click', async () => {
  if (!deleteArmed) { deleteArmed = true; $('#delete-task').textContent = 'Click again to delete'; return; }
  const id = $('#task-form').elements.namedItem('id').value;
  if (await commit({ ...data, tasks: data.tasks.filter(task => task.id !== id) }, 'Task deleted.')) $('#task-dialog').close();
});
$('#task-form').elements.namedItem('due').addEventListener('change',event=>{
  const time=$('#task-form').elements.namedItem('dueTime');
  time.disabled=!event.target.value;time.required=Boolean(event.target.value);
  if(!event.target.value)time.value='';else if(!time.value)time.value='17:00';
});
$('#new-task').addEventListener('click', () => openTask());
$$('[data-section]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.section)));
$$('[data-stat]').forEach(button => button.addEventListener('click', () => {
  const stat = button.dataset.stat;
  navigate(stat === 'completed' ? 'completed' : stat === 'today' ? 'today' : 'tasks', '', stat === 'active' || stat === 'overdue' ? stat : '');
}));
$('#focus-button').addEventListener('click', () => navigate('today'));

$('#new-project-shortcut').addEventListener('click', () => $('#add-project').click());
$('#quick-settings').addEventListener('click', () => $('#settings-button').click());
$('#quick-search').addEventListener('click', () => { $('#search').scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); $('#search').focus({ preventScroll: true }); });
$('#brand-home').addEventListener('click', event => { event.preventDefault(); navigate('overview'); window.scrollTo({ top: 0, behavior: 'auto' }); });
$('#project-overview').addEventListener('click', event => { const button = event.target.closest('[data-open-project]'); if (button) navigate('tasks', button.dataset.openProject); });
$('#mobile-backdrop').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded', 'false'); });
$('#project-nav').addEventListener('click', event => { const button = event.target.closest('[data-project]'); if (button) navigate('tasks', button.dataset.project); });
$$('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
$('#search').addEventListener('input', render);
$('#owner-filter').addEventListener('change', render);
$('#priority-filter').addEventListener('change', render);
$('#sort-filter').addEventListener('change', render);
$('#clear-filters').addEventListener('click', () => { $('#search').value = ''; $('#owner-filter').value = ''; $('#priority-filter').value = ''; $('#sort-filter').value = 'manual'; statFilter = ''; render(); });

$('#task-view').addEventListener('click', async event => {
  const complete = event.target.closest('[data-complete]');
  if (complete) {
    const task = data.tasks.find(item => item.id === complete.dataset.complete);
    if (task) await commit({ ...data, tasks: data.tasks.map(item => item.id === task.id ? { ...item, status: task.status === 'Done' ? 'To do' : 'Done' } : item) }, task.status === 'Done' ? 'Task reopened.' : 'Task completed.');
    return;
  }
  if (event.target.closest('[data-status-id]')) return;
  const add = event.target.closest('[data-add-status]');
  if (add) { openTask(null, { status: add.dataset.addStatus }); return; }
  const date = event.target.closest('[data-add-date]');
  if (date) { openTask(null, { due: date.dataset.addDate }); return; }
  const month = event.target.closest('[data-month]');
  if (month) { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(month.dataset.month), 1); render(); return; }
  if (event.target.closest('[data-current-month]')) { calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); render(); return; }
  const edit = event.target.closest('[data-edit]');
  const cardElement = event.target.closest('[data-task]');
  if (edit || cardElement) openTask(edit?.dataset.edit || cardElement.dataset.task);
});
$('#task-view').addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('article[data-task]')) { event.preventDefault(); openTask(event.target.dataset.task); }
});
$('#task-view').addEventListener('change', async event => {
  const select = event.target.closest('[data-status-id]');
  if (select) await commit({ ...data, tasks: data.tasks.map(task => task.id === select.dataset.statusId ? { ...task, status: select.value } : task) }, 'Status updated.');
});

$('#add-project').addEventListener('click', () => { if (!isAdmin()) return; $('#project-form').reset(); $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get('name').trim();
  if (!name) return;
  if (data.projects.some(project => project.name.toLowerCase() === name.toLowerCase())) { toast('There’s already a project with that name.'); return; }
  if (data.projects.length >= 200) { toast('This workspace has reached the 200-project limit.'); return; }
  const project = { id: uid(), name, color: COLORS[data.projects.length % COLORS.length] };
  if (await commit({ ...data, projects: [...data.projects, project] }, 'Project created.')) { $('#project-dialog').close(); navigate('tasks', project.id); }
});
$$('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#settings-button').addEventListener('click', () => $('#settings-dialog').showModal());
$('#excel-report-shortcut').addEventListener('click',()=>{$('#settings-dialog').close();navigate('reports');});
$('#export-button').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `teamflow-backup-${today()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Workspace exported. Keep your backup somewhere safe.');
});
$('#legacy-export').addEventListener('click', () => {
  if (!isAdmin()) return;
  const previous = localStorage.getItem(STORAGE_KEY);
  if (!previous) { toast('No previous browser workspace was found on this device.'); return; }
  const url = URL.createObjectURL(new Blob([previous], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'teamflow-previous-browser-workspace.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#menu-button').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#menu-button').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', event => { if (window.innerWidth <= 900 && !event.target.closest('#sidebar, #menu-button')) { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded', 'false'); }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, select, dialog')) { event.preventDefault(); $('#search').focus(); }
});
void startAuth(state => {
  data = state;
  render();
  applyIdentity();
  deadlineAlerts.activate();
}, () => {
  data = { version: 1, sample: false, projects: [], tasks: [] };
  $('#task-view').replaceChildren();
  $('#project-nav').replaceChildren();
  $('#project-overview').replaceChildren();
  $('#team-roster').replaceChildren();
  $('#login-history-rows').replaceChildren();
  deadlineAlerts.clear();
  reports.clear();
});
