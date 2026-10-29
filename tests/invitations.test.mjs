import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';
const source=readFileSync(new URL('../supabase/invite-member.ts',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'');
const code=(await transform(source,{loader:'ts',target:'es2022'})).code;
const workspace='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',added='00000000-0000-4000-8000-000000000003';
function harness(role='Supervisor',settings={}){
 const state={calls:[],mails:[],privilegedClients:0,existing:null,assigned:false,...settings};let handler;
 function client(privileged){
  return {auth:{getUser:async()=>({data:{user:{id:'verified-user-id',email:'sender@example.invalid',email_confirmed_at:new Date().toISOString()}},error:null}),admin:{inviteUserByEmail:async(email,options)=>{state.mails.push({email,options});return {error:state.mailError||null};}},resetPasswordForEmail:async()=>({error:null})},from(table){
   let operation='select',payload,filters=[];const chain={select(){return chain;},insert(value){operation='insert';payload=value;return chain;},upsert(value){operation='upsert';payload=value;return chain;},delete(){operation='delete';return chain;},eq(key,value){filters.push([key,value]);return chain;},is(key,value){filters.push([key,value]);return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){return execute();},single(){return execute();},then(resolve,reject){return execute().then(resolve,reject);}};
   async function execute(){state.calls.push({privileged,table,operation,payload,filters});let data=null;
    if(table==='team_members'&&operation==='select')data=privileged?state.existing:{id:actor,role,email:'sender@example.invalid'};
    if(table==='team_members'&&operation==='insert')data={id:added};
    if(table==='projects')data={id:'00000000-0000-4000-8000-000000000004'};
    if(table==='supervisor_assignments'&&operation==='select')data=state.assigned?{member_id:state.existing?.id}:null;
    return {data,error:null};
   }return chain;
  }};
 }
 runInNewContext(code,{Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'service-test-only':'anon-test-only'},serve:fn=>{handler=fn;}},createClient:(_url,key)=>{if(key==='service-test-only')state.privilegedClients++;return client(key==='service-test-only');},Response,Request,Error});
 return {state,async invite(role='Member') {const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-token','Content-Type':'application/json'},body:JSON.stringify({workspaceId:workspace,name:'New teammate',email:'new.member@example.invalid',role})}));return {status:response.status,body:await response.json()};}};
}
test('Supervisor invitation assigns a normal user to the inviting supervisor',async()=>{
 const h=harness();assert.equal((await h.invite()).status,200);
 const member=h.state.calls.find(c=>c.table==='team_members'&&c.operation==='insert');assert.equal(member.payload.role,'Member');assert.equal(member.payload.managed_by_member_id,actor);
 const assignment=h.state.calls.find(c=>c.table==='supervisor_assignments'&&c.operation==='insert');assert.equal(assignment.payload.supervisor_id,actor);assert.equal(assignment.payload.member_id,added);
 assert.equal(h.state.mails[0].options.redirectTo,'https://teamflow-fawn.vercel.app/?flow=invite');
});
test('Supervisor can invite another Supervisor without inheriting their task team',async()=>{
 const h=harness();assert.equal((await h.invite('Supervisor')).status,200);const member=h.state.calls.find(c=>c.table==='team_members'&&c.operation==='insert');assert.equal(member.payload.managed_by_member_id,actor);assert.equal(member.payload.role,'Supervisor');assert.equal(h.state.calls.some(c=>c.table==='supervisor_assignments'&&c.operation==='insert'),false);
});
test('Supervisor cannot invite an Admin even with a forged request body',async()=>{
 const h=harness();assert.equal((await h.invite('Admin')).status,403);assert.equal(h.state.privilegedClients,0);assert.equal(h.state.mails.length,0);
});
test('normal users cannot invite people',async()=>{
 const h=harness('Member');assert.equal((await h.invite()).status,403);assert.equal(h.state.privilegedClients,0);
});
test('Supervisor cannot resend invitations outside their assigned team',async()=>{
 const h=harness('Supervisor',{existing:{id:added,user_id:null,role:'Member',managed_by_member_id:'another-supervisor'},assigned:false});assert.equal((await h.invite()).status,403);assert.equal(h.state.mails.length,0);
});
test('resending a supervised pending invitation does not silently promote its role',async()=>{
 const h=harness('Supervisor',{existing:{id:added,user_id:null,role:'Member',managed_by_member_id:actor},assigned:true});assert.equal((await h.invite('Supervisor')).status,200);assert.equal(h.state.calls.some(c=>c.table==='team_members'&&c.operation==='insert'),false);assert.equal(h.state.existing.role,'Member');
});
test('Admin invitation rights still include creating another Admin',async()=>{
 const h=harness('Admin');assert.equal((await h.invite('Admin')).status,200);assert.equal(h.state.calls.find(c=>c.table==='team_members'&&c.operation==='insert').payload.role,'Admin');
});
test('failed mail delivery cleans up a newly pending invitation',async()=>{
 const h=harness('Supervisor',{mailError:new Error('SMTP unavailable')});assert.equal((await h.invite()).status,400);const removal=h.state.calls.find(c=>c.table==='team_members'&&c.operation==='delete');assert.ok(removal);assert.deepEqual(removal.filters,[['workspace_id',workspace],['id',added],['user_id',null]]);
});
