import { defaultTimeZone, deadlineInstant, isOverdue } from './deadlines.js';

export function reportMonth(instant,zone=defaultTimeZone()) {
  if(!instant)return '';
  const date=new Date(instant);if(!Number.isFinite(date.valueOf()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit'}).formatToParts(date);
  return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
}
export function monthlyReport(data,{month,basis='due',zone=defaultTimeZone(),now=Date.now()}={}) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw new Error('Choose a valid report month.');
  if(!['due','created','completed'].includes(basis))throw new Error('Choose a report date basis.');
  const seen=new Set();
  const tasks=data.tasks.filter(task=>{
    const instant=basis==='due'?deadlineInstant(task):basis==='created'?task.createdAt:task.completedAt;
    if(basis==='completed'&&task.status!=='Done')return false;
    if(seen.has(task.id)||reportMonth(instant,zone)!==month)return false;
    seen.add(task.id);return true;
  }).sort((a,b)=>(deadlineInstant(a)||'9999').localeCompare(deadlineInstant(b)||'9999')||a.title.localeCompare(b.title));
  const total=tasks.length,completed=tasks.filter(t=>t.status==='Done').length,overdue=tasks.filter(t=>isOverdue(t,now)).length;
  const timedCompleted=tasks.filter(t=>t.status==='Done'&&t.completedAt&&deadlineInstant(t));
  const onTime=timedCompleted.filter(t=>Date.parse(t.completedAt)<=Date.parse(deadlineInstant(t))).length;
  const owners=[...new Set(tasks.map(t=>t.owner))].sort().map(owner=>{
    const owned=tasks.filter(t=>t.owner===owner);
    return {owner,total:owned.length,completed:owned.filter(t=>t.status==='Done').length,overdue:owned.filter(t=>isOverdue(t,now)).length};
  });
  return {month,basis,zone,generatedAt:new Date(now).toISOString(),tasks,total,completed,open:total-completed,overdue,completionRate:total?Math.round(completed/total*100):0,onTime,timedCompleted:timedCompleted.length,owners};
}
export const reportScope=role=>role==='Admin'?'All workspace tasks':role==='Supervisor'?'Your tasks and assigned team tasks':'Your assigned, shared, and personal tasks';
