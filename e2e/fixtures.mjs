import {expect} from '@playwright/test';
export function fixtureFor(role='Member') {
 const uid='00000000-0000-4000-8000-000000000011',workspace='00000000-0000-4000-8000-000000000012',project='00000000-0000-4000-8000-000000000013';
 const member={id:'00000000-0000-4000-8000-000000000014',workspace_id:workspace,user_id:uid,email:role.toLowerCase()+'@example.invalid',display_name:'QA '+role,role,created_at:new Date().toISOString()};
 const exp=Math.floor(Date.now()/1000)+3600;
 const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,exp,role:'authenticated'})).toString('base64url')+'.fixture-signature';
 const session={access_token:token,refresh_token:'fixture-only',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:uid,email:member.email,email_confirmed_at:new Date().toISOString(),user_metadata:{role:'Admin'},app_metadata:{}}};
 const task={id:'00000000-0000-4000-8000-000000000015',workspace_id:workspace,project_id:project,assignee_member_id:member.id,creator_id:uid,personal:false,title:'QA assigned task',description:'Task notes',status:'To Do',priority:'Medium',due_at:'2026-10-29T10:00:00Z',due_date:'2026-10-29',due_timezone:'Asia/Bangkok',followup_date:null,created_at:'2026-10-01T10:00:00Z',updated_at:'2026-10-01T10:00:00Z',completed_at:null};
 return {workspace,project,member,members:[member],session,tasks:[task],projects:[{id:project,name:'General',color:'#7350d6',created_at:task.created_at}],collaborations:[],supervision:[],alerts:[],requests:[],errors:[],downloads:[],unexpected:[]};
}
export function addMember(fixture,name,email,role='Member') {
 const member={...fixture.member,id:crypto.randomUUID(),user_id:crypto.randomUUID(),display_name:name,email,role};fixture.members.push(member);return member;
}
export async function boot(page,fixture,{signedIn=true,url='/',expectLocked=false}={}) {
 page.on('pageerror',error=>fixture.errors.push(error.message));page.on('download',download=>fixture.downloads.push(download));
 await page.route('https://ziemlsjdvqxujndaludh.supabase.co/**',async route=>{
  const request=route.request(),parsed=new URL(request.url()),path=parsed.pathname,method=request.method(),body=request.postDataJSON();fixture.requests.push({path,method});
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(method==='OPTIONS')return route.fulfill({status:204});
  if(path==='/auth/v1/logout')return json({});
  if(path==='/auth/v1/token')return fixture.badLogin?json({error:'invalid_grant',error_description:'Invalid login credentials'},400):json(fixture.session);
  if(path==='/auth/v1/recover')return json({});
  if(path==='/auth/v1/signup')return json({user:fixture.session.user,session:null});
  if(path==='/auth/v1/user')return json(fixture.session.user);
  if(path.endsWith('/rpc/accept_team_invites')||path.endsWith('/rpc/initialize_admin'))return json(0);
  if(path.endsWith('/functions/v1/record-login'))return json({recorded:true});
  if(path.endsWith('/functions/v1/invite-team-member')){fixture.invite=body;return json({message:'Invitation sent.'});}
  if(path.endsWith('/rpc/get_due_task_alerts'))return json(fixture.alerts);
  if(path.endsWith('/task_alert_receipts')){fixture.receipts=body;fixture.alerts=[];return json(null);}
  if(path.endsWith('/login_activity'))return json(fixture.logins||[]);
  if(path.endsWith('/supervisor_assignments'))return json(fixture.supervision);
  if(path.endsWith('/task_collaborators'))return json(fixture.collaborations);
  if(path.endsWith('/team_members'))return json(parsed.searchParams.has('user_id')?(fixture.noMembership?[]:[fixture.member]):fixture.members);
  if(path.endsWith('/workspaces'))return json({id:fixture.workspace,name:"Abhi's workspace"});
  if(path.endsWith('/project_members'))return json(null);
  if(path.endsWith('/projects')){if(method==='POST'){fixture.projects.push(body);return json(null);}return json(fixture.projects);}
  if(path.endsWith('/rpc/configure_member')){fixture.configured=body;const member=fixture.members.find(m=>m.id===body.p_member);member.role=body.p_role;if(fixture.member.role==='Supervisor')member.managed_by_member_id=fixture.member.id;fixture.supervision=fixture.supervision.filter(s=>s.member_id!==body.p_member);const boss=fixture.member.role==='Supervisor'&&body.p_role==='Member'?fixture.member.id:body.p_supervisor;if(boss)fixture.supervision.push({supervisor_id:boss,member_id:body.p_member});return json(null);}
  if(path.endsWith('/rpc/save_team_task')){
   if(fixture.saveError)return json({code:'40001',message:'Task changed. Reload and try again.'},409);
   fixture.saved=body;const index=fixture.tasks.findIndex(t=>t.id===body.p_task);
   const task={...fixture.tasks[index],...body.p_values,id:body.p_task,creator_id:fixture.session.user.id,created_at:fixture.tasks[index]?.created_at||new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:body.p_values.status==='Done'?new Date().toISOString():null};
   if(index<0)fixture.tasks.push(task);else fixture.tasks[index]=task;
   fixture.collaborations=fixture.collaborations.filter(c=>c.task_id!==body.p_task).concat(body.p_collaborators.map(member_id=>({id:crypto.randomUUID(),task_id:body.p_task,member_id})));
   return json(body.p_task);
  }
  if(path.endsWith('/tasks')){
   if(fixture.holdTasks){fixture.tasksPending=true;await fixture.holdTasks;}
   if(method==='DELETE'){const id=parsed.searchParams.get('id')?.replace('eq.','');fixture.tasks=fixture.tasks.filter(t=>t.id!==id);return json([{id}]);}
   const offset=Number(parsed.searchParams.get('offset')||0),limit=Number(parsed.searchParams.get('limit')||500);return json(fixture.tasks.slice(offset,offset+limit));
  }
  fixture.unexpected.push(path);return json({message:'Unexpected test request'},500);
 });
 if(signedIn)await page.addInitScript(session=>localStorage.setItem('teamflow-auth-v1',JSON.stringify(session)),fixture.session);
 await page.goto(url);if(signedIn&&!expectLocked&&!url.includes('flow=invite'))await expect(page.locator('body')).toHaveClass(/signed-in/);else await expect(page.locator('#auth-gate')).toBeVisible();
}
export async function nav(page,section){if(await page.locator('#menu-button').isVisible())await page.locator('#menu-button').click();await page.locator('[data-section="'+section+'"]').click();}
export function checkErrors(fixture){expect(fixture.errors).toEqual([]);expect(fixture.unexpected).toEqual([]);}
