import { context,ownerName } from './backend.js';
import { defaultTimeZone,formatDeadline } from './deadlines.js';
import { monthlyReport,reportMonth,reportScope } from './report-data.js';
import { reportWorkbook } from './report-excel.js';
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createReports(getData,refresh,onOpenTask,notify) {
  const month=document.querySelector('#report-month'),basis=document.querySelector('#report-basis'),root=document.querySelector('#report-content'),button=document.querySelector('#report-download');
  month.value=reportMonth(new Date().toISOString());
  function current(){return monthlyReport(getData(),{month:month.value,basis:basis.value});}
  function render(){
    if(!context.user)return;
    document.querySelector('#report-scope').textContent=reportScope(context.member.role)+' · '+defaultTimeZone();
    try{
      const report=current();
      root.innerHTML='<div class="report-metrics">'+[['Tasks',report.total],['Completed',report.completed],['Open',report.open],['Overdue now',report.overdue],['Completion',report.completionRate+'%']].map(([label,value])=>'<div><span>'+label+'</span><strong>'+value+'</strong></div>').join('')+'</div><div class="report-owner-panel"><h3>By primary owner</h3><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Owner</th><th>Tasks</th><th>Completed</th><th>Open</th><th>Overdue</th></tr></thead><tbody>'+report.owners.map(row=>'<tr><td>'+safe(ownerName(row.owner))+'</td><td>'+row.total+'</td><td>'+row.completed+'</td><td>'+(row.total-row.completed)+'</td><td>'+row.overdue+'</td></tr>').join('')+'</tbody></table></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Task</th><th>Primary owner</th><th>Status</th><th>Due date/time</th><th>Collaborators</th></tr></thead><tbody>'+report.tasks.slice(0,200).map(task=>'<tr><td><button class="text-button" data-report-task="'+safe(task.id)+'">'+safe(task.title)+'</button></td><td>'+safe(ownerName(task.owner))+'</td><td>'+safe(task.status)+'</td><td>'+safe(formatDeadline(task))+'</td><td>'+safe((task.collaborators||[]).map(ownerName).join(', ')||'—')+'</td></tr>').join('')+'</tbody></table></div>'+(report.total?'':'<p class="report-empty">No tasks match this month and date basis.</p>')+(report.total>200?'<p class="muted">Showing the first 200 tasks. Excel includes all '+report.total+' tasks.</p>':'')+'<p class="report-note">Shared tasks count once. Statuses and overdue counts reflect the current data, not a historical month-end snapshot. Tasks without the selected date are excluded.</p>';
    }catch(error){root.textContent=error.message;}
  }
  month.addEventListener('change',render);basis.addEventListener('change',render);
  root.addEventListener('click',event=>{const task=event.target.closest('[data-report-task]');if(task)onOpenTask(task.dataset.reportTask);});
  button.addEventListener('click',async()=>{
    if(!context.user)return;
    const user=context.user.id;
    button.disabled=true;button.textContent='Preparing Excel…';
    try{
      await refresh();
      if(context.user?.id!==user||!document.body.classList.contains('signed-in'))return;
      render();const data=getData(),report=current();
      const blob=await reportWorkbook(report,{workspace:context.workspace.name,scope:reportScope(context.member.role),nameFor:ownerName,projectFor:id=>data.projects.find(p=>p.id===id)?.name||''});
      if(context.user?.id!==user||!document.body.classList.contains('signed-in'))return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='teamflow-'+report.month+'-'+report.basis+'.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Excel report downloaded.');
    }catch(error){notify(error.message||'Could not download this report.');}
    finally{button.disabled=false;button.textContent='↓ Download Excel';}
  });
  return {render,clear(){root.replaceChildren();}};
}
