'use strict';

const STORAGE_KEY = 'teamflow-v1';
const STATUSES = ['To do', 'In progress', 'Waiting', 'Done'];
const COLORS = ['#a891d3', '#80abc5', '#d6a57e', '#88b49b', '#c88fba', '#9b9ed0'];
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const uid = () => crypto.randomUUID();
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => dateKey(new Date());
const offsetDate = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return dateKey(date); };
const validDate = value => value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T12:00:00').valueOf()) && dateKey(new Date(value + 'T12:00:00')) === value);
const dateLabel = value => !value ? 'No due date' : value === today() ? 'Today' : new Date(value + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const initials = value => (value || '?').split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase();
const newTask = (title, project, owner, priority, status, due, notes, followup = '') => ({ id: uid(), title, project, owner, priority, status, due, notes, followup, createdAt: new Date().toISOString() });

function sampleWorkspace() {
  return {
    version: 1,
    sample: true,
    projects: [{ id: 'launch', name: 'Brand launch', color: COLORS[0] }, { id: 'clients', name: 'Client projects', color: COLORS[1] }, { id: 'personal', name: 'Personal', color: COLORS[2] }],
    tasks: [
      newTask('Put together the launch moodboard', 'launch', 'Hary', 'High', 'To do', offsetDate(0), 'Gather visual references and find a direction that feels right.'),
      newTask('Plan next week’s priorities', 'personal', 'Hary', 'Medium', 'To do', offsetDate(2), 'A little planning now makes more space later.'),
      newTask('Outline the client proposal', 'clients', 'Hary', 'Medium', 'To do', offsetDate(3), 'Define the scope, timeline, and next steps.'),
      newTask('Bring the landing page to life', 'launch', 'Hary', 'High', 'In progress', offsetDate(0), 'Refine the first impression. Keep it clear and simple.'),
      newTask('Review the content calendar', 'launch', 'Alex', 'Medium', 'In progress', offsetDate(1), 'Make sure every post has a purpose.'),
      newTask('Follow up on proposal feedback', 'clients', 'Hary', 'High', 'Waiting', offsetDate(-1), 'Waiting for the client’s thoughts on the updated direction.', offsetDate(0)),
      newTask('Get approval on the final assets', 'launch', 'Alex', 'Low', 'Waiting', offsetDate(4), 'Send a gentle reminder if there’s no update.', offsetDate(2)),
      newTask('Set the project direction', 'launch', 'Hary', 'Medium', 'Done', offsetDate(-2), 'One clear brief. A shared starting point.'),
      newTask('Organize the project files', 'personal', 'Hary', 'Low', 'Done', offsetDate(-1), 'Everything in its place. Ready for what’s next.')
    ]
  };
}

function validateWorkspace(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.tasks) || !Array.isArray(data.projects) || data.tasks.length > 10000 || data.projects.length > 200 || data.projects.length === 0) throw new Error('Choose a valid Teamflow backup with at least one project.');
  const ids = new Set();
  const projects = data.projects.map(project => {
    if (!project || typeof project.id !== 'string' || !project.id || project.id.length > 100 || ids.has(project.id) || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 60) throw new Error('The backup contains an invalid project.');
    ids.add(project.id);
    return { id: project.id, name: project.name.trim(), color: /^#[0-9a-f]{6}$/i.test(project.color) ? project.color : COLORS[0] };
  });
  const taskIds = new Set();
  const tasks = data.tasks.map(task => {
    if (!task || typeof task.id !== 'string' || !task.id || task.id.length > 100 || taskIds.has(task.id) || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 160 || !ids.has(task.project) || !STATUSES.includes(task.status) || !['High', 'Medium', 'Low'].includes(task.priority) || typeof task.owner !== 'string' || task.owner.length > 60 || typeof task.notes !== 'string' || task.notes.length > 4000 || !validDate(task.due) || !validDate(task.followup)) throw new Error('The backup contains an invalid task.');
    taskIds.add(task.id);
    return { id: task.id, title: task.title.trim(), project: task.project, owner: task.owner, notes: task.notes, status: task.status, priority: task.priority, due: task.due, followup: task.followup, createdAt: typeof task.createdAt === 'string' ? task.createdAt : new Date().toISOString() };
  });
  return { version: 1, sample: data.sample === true, projects, tasks };
}

let data;
let initialWarning = '';
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  data = raw ? validateWorkspace(JSON.parse(raw)) : sampleWorkspace();
} catch {
  data = sampleWorkspace();
  initialWarning = 'Your saved workspace could not be read. Sample data is shown; the saved data has not been overwritten.';
}
let section = 'overview';
let projectFilter = '';
let statFilter = '';
let view = 'board';
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let toastTimer;
let deleteArmed = false;
let emptyArmed = false;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}

function commit(nextData, message) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextData));
  } catch {
    $('#save-state').textContent = 'Unable to save on this device';
    toast('Storage is unavailable or full. Your change was not saved. Export a backup from Settings.');
    return false;
  }
  data = nextData;
  $('#save-state').innerHTML = '<i></i> All changes saved';
  render();
  if (message) toast(message);
  return true;
}

function filteredTasks() {
  const search = $('#search').value.trim().toLowerCase();
  const owner = $('#owner-filter').value;
  const priority = $('#priority-filter').value;
  return data.tasks.filter(task => {
    const active = task.status !== 'Done';
    if (projectFilter && task.project !== projectFilter) return false;
    if (section === 'today' && (!active || (task.due !== today() && task.followup !== today()))) return false;
    if (section === 'followups' && (!active || !task.followup)) return false;
    if (section === 'completed' && active) return false;
    if (statFilter === 'active' && !active) return false;
    if (statFilter === 'overdue' && (!active || !task.due || task.due >= today())) return false;
    if (owner && task.owner !== owner) return false;
    if (priority && task.priority !== priority) return false;
    const project = data.projects.find(item => item.id === task.project);
    return !search || `${task.title} ${task.notes} ${task.owner} ${project?.name || ''}`.toLowerCase().includes(search);
  });
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
  const dueToday = active.filter(task => task.due === today());
  const followups = active.filter(task => task.followup);
  const done = data.tasks.length - active.length;
  $('#stat-active').textContent = active.length;
  $('#stat-today').textContent = dueToday.length;
  $('#stat-overdue').textContent = active.filter(task => task.due && task.due < today()).length;
  $('#stat-done').textContent = done;
  $('#today-count').textContent = active.filter(task => task.due === today() || task.followup === today()).length;
  $('#task-count').textContent = data.tasks.length;
  $('#followup-count').textContent = followups.length;
  $('#sample-label').hidden = !data.sample;
  $('#current-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#focus-copy').textContent = dueToday.length ? `${dueToday.length} ${dueToday.length === 1 ? 'task is' : 'tasks are'} due today. Start with one small step.` : 'A little breathing room. Choose something you’d love to move forward.';
  const project = data.projects.find(item => item.id === projectFilter);
  const headings = {
    overview: ['Your work, in flow', 'A clear view of what’s next. A little space to focus.', 'Your tasks', 'Overview'],
    today: ['Make today count', 'Your tasks and follow-ups for today, all in one place.', 'Today’s priorities', 'My day'],
    tasks: ['Everything, in one place', 'A little clarity for every project and every next step.', 'All tasks', 'All tasks'],
    followups: ['Keep things moving', 'A gentle nudge can make all the difference.', 'Your follow-ups', 'Follow-ups'],
    completed: ['Look how far you’ve come', 'Every finished task is a little more space to breathe.', 'Completed tasks', 'Completed']
  };
  let [title, subtitle, tasksTitle, breadcrumb] = headings[section];
  if (project) { title = project.name; subtitle = 'A shared direction. One next step at a time.'; tasksTitle = 'Project tasks'; breadcrumb = project.name; }
  if (statFilter === 'overdue') { title = 'A little attention needed'; subtitle = 'Revisit these tasks and choose your next move.'; tasksTitle = 'Overdue tasks'; breadcrumb = 'Overdue'; }
  if (statFilter === 'active') tasksTitle = 'Active tasks';
  $('#page-title').innerHTML = `${escapeHTML(title)}<span>.</span>`;
  $('#page-subtitle').textContent = subtitle;
  $('#tasks-heading').textContent = tasksTitle;
  $('#breadcrumb-title').textContent = breadcrumb;
  $$('[data-section]').forEach(button => button.classList.toggle('active', !projectFilter && button.dataset.section === section));
  $('#project-nav').innerHTML = data.projects.map(item => `<button class="nav-item ${projectFilter === item.id ? 'active' : ''}" data-project="${escapeHTML(item.id)}"><span class="project-dot" style="background:${item.color}"></span><span class="project-title">${escapeHTML(item.name)}</span><span class="nav-count">${active.filter(task => task.project === item.id).length}</span></button>`).join('');
  const selectedOwner = $('#owner-filter').value;
  const owners = [...new Set(data.tasks.map(task => task.owner).filter(Boolean))].sort();
  $('#owner-filter').innerHTML = '<option value="">All owners</option>' + owners.map(owner => `<option>${escapeHTML(owner)}</option>`).join('');
  if (owners.includes(selectedOwner)) $('#owner-filter').value = selectedOwner;
  $('#owner-options').innerHTML = owners.map(owner => `<option value="${escapeHTML(owner)}"></option>`).join('');
  const tasks = filteredTasks();
  $('#visible-count').textContent = tasks.length;
  $$('[data-view]').forEach(button => { const selected = button.dataset.view === view; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  if (view === 'calendar') renderCalendar(tasks);
  else if (view === 'list') renderList(tasks);
  else renderBoard(tasks);
}

function card(task) {
  const project = data.projects.find(item => item.id === task.project);
  const dueClass = task.status !== 'Done' && task.due && task.due < today() ? 'overdue' : task.due === today() ? 'today' : '';
  return `<article class="task-card ${task.status === 'Done' ? 'done' : ''}" tabindex="0" role="button" aria-label="Edit ${escapeHTML(task.title)}" data-task="${escapeHTML(task.id)}">
    <div class="card-top"><span class="project-tag" style="background:${project.color}18;color:${project.color}">${escapeHTML(project.name)}</span><span class="more-dots" aria-hidden="true">···</span></div>
    <h3>${escapeHTML(task.title)}</h3>${task.notes ? `<p>${escapeHTML(task.notes)}</p>` : ''}
    <div class="card-tags"><span class="priority ${task.priority.toLowerCase()}">${task.priority === 'High' ? '⚑' : '•'} ${task.priority}</span>${task.followup ? `<span class="followup-tag">↗ ${dateLabel(task.followup)}</span>` : ''}</div>
    <div class="card-footer"><span class="due-label ${dueClass}">◷ ${dateLabel(task.due)}</span><span class="avatar" title="${escapeHTML(task.owner || 'Unassigned')}">${escapeHTML(initials(task.owner))}</span><button class="complete-check ${task.status === 'Done' ? 'checked' : ''}" data-complete="${escapeHTML(task.id)}" aria-label="${task.status === 'Done' ? 'Reopen' : 'Complete'} ${escapeHTML(task.title)}">${task.status === 'Done' ? '✓' : ''}</button></div>
  </article>`;
}

function renderBoard(tasks) {
  const names = ['todo', 'progress', 'waiting', 'done'];
  const statuses = section === 'completed' ? ['Done'] : STATUSES;
  $('#task-view').innerHTML = `<div class="board">${statuses.map(status => {
    const group = tasks.filter(task => task.status === status);
    return `<section class="column" data-drop-status="${status}" aria-label="${status}"><div class="column-header"><span class="status-dot ${names[STATUSES.indexOf(status)]}"></span>${status}<span class="column-count">${group.length}</span><button data-add-status="${status}" aria-label="Add task to ${status}">+</button></div>${group.map(card).join('') || '<div class="empty-column">A little room for what’s next.</div>'}<button class="add-column" data-add-status="${status}">+ Add a task</button></section>`;
  }).join('')}</div>`;
}

function renderList(tasks) {
  if (!tasks.length) { renderEmpty(); return; }
  $('#task-view').innerHTML = `<div class="table-scroll"><table class="list-table"><thead><tr><th aria-label="Complete"></th><th>Task</th><th>Project</th><th>Status</th><th>Priority</th><th>Owner</th><th>Due date</th></tr></thead><tbody>${tasks.map(task => {
    const project = data.projects.find(item => item.id === task.project);
    return `<tr class="task-row" data-task="${escapeHTML(task.id)}"><td><button class="complete-check ${task.status === 'Done' ? 'checked' : ''}" data-complete="${escapeHTML(task.id)}" aria-label="${task.status === 'Done' ? 'Reopen' : 'Complete'} ${escapeHTML(task.title)}">${task.status === 'Done' ? '✓' : ''}</button></td><td><button class="list-title" data-edit="${escapeHTML(task.id)}">${escapeHTML(task.title)}</button></td><td><span class="project-tag" style="color:${project.color};background:${project.color}18">${escapeHTML(project.name)}</span></td><td><select class="status-select" data-status-id="${escapeHTML(task.id)}" aria-label="Status for ${escapeHTML(task.title)}">${STATUSES.map(status => `<option ${status === task.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td><td><span class="priority ${task.priority.toLowerCase()}">${task.priority}</span></td><td>${escapeHTML(task.owner || 'Unassigned')}</td><td>${dateLabel(task.due)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderEmpty() {
  $('#task-view').innerHTML = '<div class="empty-state"><h3>A little breathing room.</h3><p>No tasks match this view. Change your filters or make a fresh start.</p><button class="button secondary" data-add-status="To do">+ Create a task</button></div>';
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
    const dayTasks = tasks.filter(task => task.due === key);
    cells.push(`<div class="calendar-day ${date.getMonth() !== month ? 'outside' : ''} ${key === today() ? 'is-today' : ''}"><button class="day-number" data-add-date="${key}" aria-label="Add task on ${key}">${date.getDate()}</button>${dayTasks.map(task => `<button class="calendar-task" data-edit="${escapeHTML(task.id)}" title="${escapeHTML(task.title)}">${task.status === 'Done' ? '✓ ' : ''}${escapeHTML(task.title)}</button>`).join('')}</div>`);
  }
  $('#task-view').innerHTML = `<div class="calendar-heading"><span>${calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><div><button class="icon-button" data-month="-1" aria-label="Previous month">‹</button><button class="button secondary" data-current-month>Today</button><button class="icon-button" data-month="1" aria-label="Next month">›</button></div></div><div class="calendar-wrap"><div class="calendar-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${cells.join('')}</div></div><p class="calendar-unscheduled">${tasks.filter(task => !task.due).length} tasks without a due date. Add a due date to place them on the calendar.</p>`;
}

function openTask(id, defaults = {}) {
  const task = id ? data.tasks.find(item => item.id === id) : null;
  if (id && !task) return;
  const form = $('#task-form');
  form.reset();
  $('#form-project').innerHTML = data.projects.map(project => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`).join('');
  const values = task || { id: '', title: '', notes: '', project: projectFilter || data.projects[0].id, owner: 'Hary', priority: 'Medium', status: section === 'followups' ? 'Waiting' : section === 'completed' ? 'Done' : 'To do', due: section === 'today' ? today() : '', followup: section === 'followups' ? today() : '', ...defaults };
  for (const [name, value] of Object.entries(values)) if (form.elements.namedItem(name)) form.elements.namedItem(name).value = value;
  $('#dialog-title').textContent = task ? 'A little more clarity' : 'Create a task';
  $('#delete-task').hidden = !task;
  $('#delete-task').textContent = 'Delete task';
  deleteArmed = false;
  $('#task-dialog').showModal();
  form.elements.namedItem('title').focus();
}

$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.title = values.title.trim();
  values.owner = values.owner.trim();
  if (!values.title) { toast('Give your task a name.'); return; }
  if (!validDate(values.due) || !validDate(values.followup)) { toast('Choose a valid date.'); return; }
  const existing = data.tasks.find(task => task.id === values.id);
  const task = { ...values, id: existing?.id || uid(), createdAt: existing?.createdAt || new Date().toISOString() };
  const next = { ...data, tasks: existing ? data.tasks.map(item => item.id === task.id ? task : item) : [...data.tasks, task] };
  if (commit(next, existing ? 'Task updated. A little clearer.' : 'Task created. One step forward.')) $('#task-dialog').close();
});

$('#delete-task').addEventListener('click', () => {
  if (!deleteArmed) { deleteArmed = true; $('#delete-task').textContent = 'Click again to delete'; return; }
  const id = $('#task-form').elements.namedItem('id').value;
  if (commit({ ...data, tasks: data.tasks.filter(task => task.id !== id) }, 'Task deleted.')) $('#task-dialog').close();
});
$('#new-task').addEventListener('click', () => openTask());
$$('[data-section]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.section)));
$$('[data-stat]').forEach(button => button.addEventListener('click', () => {
  const stat = button.dataset.stat;
  navigate(stat === 'completed' ? 'completed' : stat === 'today' ? 'today' : 'tasks', '', stat === 'active' || stat === 'overdue' ? stat : '');
}));
$('#focus-button').addEventListener('click', () => navigate('today'));
$('#project-nav').addEventListener('click', event => { const button = event.target.closest('[data-project]'); if (button) navigate('tasks', button.dataset.project); });
$$('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
$('#search').addEventListener('input', render);
$('#owner-filter').addEventListener('change', render);
$('#priority-filter').addEventListener('change', render);
$('#clear-filters').addEventListener('click', () => { $('#search').value = ''; $('#owner-filter').value = ''; $('#priority-filter').value = ''; statFilter = ''; render(); });

$('#task-view').addEventListener('click', event => {
  const complete = event.target.closest('[data-complete]');
  if (complete) {
    const task = data.tasks.find(item => item.id === complete.dataset.complete);
    if (task) commit({ ...data, tasks: data.tasks.map(item => item.id === task.id ? { ...item, status: task.status === 'Done' ? 'To do' : 'Done' } : item) }, task.status === 'Done' ? 'Task reopened.' : 'A little win. Task completed!');
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
$('#task-view').addEventListener('change', event => {
  const select = event.target.closest('[data-status-id]');
  if (select) commit({ ...data, tasks: data.tasks.map(task => task.id === select.dataset.statusId ? { ...task, status: select.value } : task) }, 'Status updated.');
});

$('#add-project').addEventListener('click', () => { $('#project-form').reset(); $('#project-dialog').showModal(); });
$('#project-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get('name').trim();
  if (!name) return;
  if (data.projects.some(project => project.name.toLowerCase() === name.toLowerCase())) { toast('There’s already a project with that name.'); return; }
  if (data.projects.length >= 200) { toast('This workspace has reached the 200-project limit.'); return; }
  const project = { id: uid(), name, color: COLORS[data.projects.length % COLORS.length] };
  if (commit({ ...data, projects: [...data.projects, project] }, 'A new project. A fresh start.')) { $('#project-dialog').close(); navigate('tasks', project.id); }
});
$$('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#settings-button').addEventListener('click', () => { emptyArmed = false; $('#empty-workspace').textContent = 'Start with an empty workspace'; $('#settings-dialog').showModal(); });
$('#export-button').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `teamflow-backup-${today()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Workspace exported. Keep your backup somewhere safe.');
});
$('#import-button').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.');
    const imported = validateWorkspace(JSON.parse(await file.text()));
    if (!confirm(`Replace this workspace with ${imported.tasks.length} tasks from “${file.name}”? Export a backup first if you want to keep your current tasks.`)) return;
    if (commit(imported, 'Workspace imported. Welcome back.')) { $('#settings-dialog').close(); navigate('overview'); }
  } catch (error) { toast(error instanceof SyntaxError ? 'This file is not a valid JSON backup.' : error.message); }
  finally { event.target.value = ''; }
});
$('#empty-workspace').addEventListener('click', () => {
  if (!emptyArmed) { emptyArmed = true; $('#empty-workspace').textContent = 'Confirm: remove all tasks and projects'; toast('Export a backup first if you want to keep this workspace.'); return; }
  const clean = { version: 1, sample: false, tasks: [], projects: [{ id: uid(), name: 'Personal', color: COLORS[0] }] };
  if (commit(clean, 'A fresh page. Make it yours.')) { $('#settings-dialog').close(); navigate('overview'); }
});
$('#menu-button').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#menu-button').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', event => { if (window.innerWidth <= 740 && !event.target.closest('#sidebar, #menu-button')) { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input, textarea, select, dialog')) { event.preventDefault(); $('#search').focus(); }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try { data = validateWorkspace(JSON.parse(event.newValue)); render(); toast('Workspace updated in another tab.'); } catch { toast('Could not read the update from another tab.'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();
if (initialWarning) setTimeout(() => toast(initialWarning), 400);
