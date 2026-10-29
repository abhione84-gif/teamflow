import { context, getDueAlerts, acknowledgeDueAlerts } from './backend.js';
import { formatDeadline } from './deadlines.js';

const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createDeadlineAlerts(onOpenTask) {
  const dialog=document.querySelector('#due-alert-dialog');
  const list=document.querySelector('#due-alert-list');
  const count=document.querySelector('#due-alert-count');
  const error=document.querySelector('#due-alert-error');
  let queue=[];
  let generation=0;
  let userId='';
  let snoozedUntil=0;
  let checking=false;
  function render() {
    count.textContent=String(queue.length);
    count.hidden=queue.length===0;
    list.innerHTML=queue.length?queue.map(item=>`<div class="due-alert-item"><div><strong>${escape(item.title)}</strong><small>${escape(item.owner_name||item.owner_email||'Unassigned')} · ${escape(formatDeadline({dueAt:item.due_at,dueTimezone:item.due_timezone}))}</small></div><button class="button secondary" data-open-alert-task="${escape(item.task_id)}">Open task</button></div>`).join(''):'<p class="muted">No pending due alerts.</p>';
  }
  function open() {
    if(!context.user||document.querySelector('dialog[open]')||document.body.dataset.saving==='true') return;
    error.textContent='';
    render();
    dialog.showModal();
  }
  async function check() {
    if(checking||!context.user||context.user.id!==userId||document.hidden||!document.body.classList.contains('signed-in')) return;
    checking=true;
    const current=generation;
    try {
      const result=await getDueAlerts();
      if(current!==generation||context.user?.id!==userId) return;
      queue=result;
      render();
      if(queue.length&&Date.now()>=snoozedUntil) open();
    } catch { /* A temporary network error retries on the next check. */ }
    finally { checking=false; }
  }
  document.querySelector('#due-alert-button').addEventListener('click',async()=>{await check();open();});
  document.querySelector('#due-alert-snooze').addEventListener('click',()=>{snoozedUntil=Date.now()+300000;dialog.close();});
  dialog.addEventListener('close',()=>{if(queue.length&&context.user?.id===userId)snoozedUntil=Date.now()+300000;});
  document.querySelector('#due-alert-dismiss').addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try {
      if(queue.length) await acknowledgeDueAlerts(queue);
      queue=[]; render(); dialog.close();
      setTimeout(check,0);
    } catch { error.textContent='Could not save the dismissal. Try again.'; }
    finally { button.disabled=false; }
  });
  list.addEventListener('click',async event=>{
    const button=event.target.closest('[data-open-alert-task]');
    if(!button) return;
    dialog.close();
    await onOpenTask(button.dataset.openAlertTask);
  });
  setInterval(check,15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});
  return {
    activate() { if(userId!==context.user?.id){generation++;queue=[];userId=context.user?.id||'';snoozedUntil=0;render();}setTimeout(check,0); },
    clear() { generation++;queue=[];userId='';snoozedUntil=0;render();if(dialog.open)dialog.close(); },
    check
  };
}
