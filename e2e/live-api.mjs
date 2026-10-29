// Public-client checks only. Never sends email or creates accounts.
import assert from 'node:assert/strict';
const base='https://ziemlsjdvqxujndaludh.supabase.co';
const key='sb_publishable_uxFtyRtqnn9R0QqXHf01Eg_NX9sDUjR';
const results=[];
async function request(path,options={}){
 const response=await fetch(base+path,{...options,headers:{apikey:key,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
 let body;try{body=await response.json();}catch{body=null;}
 return {response,body};
}
for(const table of ['tasks','projects','team_members','task_collaborators','supervisor_assignments','login_activity']){
 const {response,body}=await request('/rest/v1/'+table+'?select=*&limit=1');
 assert.ok([200,401,403].includes(response.status),'Unexpected protected table response: '+table);
 if(response.status===200)assert.deepEqual(body,[],'Anonymous read disclosed protected rows: '+table);
 results.push({check:'Anonymous '+table,status:response.status,pass:true});
}
const rpc={save_team_task:{p_task:crypto.randomUUID(),p_values:{},p_expected_updated_at:null,p_collaborators:[]},configure_member:{p_member:crypto.randomUUID(),p_role:'Admin',p_supervisor:null},get_due_task_alerts:{p_workspace:crypto.randomUUID()},capture_login_activity:{},initialize_admin:{},accept_team_invites:{}};
for(const [name,body] of Object.entries(rpc)){
 const {response}=await request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body)});assert.ok([401,403].includes(response.status),'Anonymous RPC not denied: '+name+' '+response.status);results.push({check:'Anonymous '+name,status:response.status,pass:true});
}
for(const name of ['record-login','invite-team-member']){
 for(const authorization of ['', 'Bearer invalid-test-token']){
  const {response}=await request('/functions/v1/'+name,{method:'POST',headers:authorization?{Authorization:authorization}:{},body:'{}'});assert.equal(response.status,401,name+' accepted invalid authentication');results.push({check:name+(authorization?' invalid token':' missing token'),status:response.status,pass:true});
 }
 const {response}=await request('/functions/v1/'+name,{method:'POST',headers:{Origin:'https://untrusted.example.invalid'},body:'{}'});assert.equal(response.status,403);results.push({check:name+' untrusted origin',status:response.status,pass:true});
 const {response:preflight}=await request('/functions/v1/'+name,{method:'OPTIONS',headers:{Origin:'https://teamflow-fawn.vercel.app'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://teamflow-fawn.vercel.app');results.push({check:name+' allowed origin preflight',status:204,pass:true});
}
const {response:signin}=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:'teamflow-nonexistent-qa@example.invalid',password:crypto.randomUUID()+'!Aa9'})});assert.ok([400,401].includes(signin.status));results.push({check:'Real Auth rejects nonexistent account',status:signin.status,pass:true});
console.log(JSON.stringify({passed:results.length,results},null,2));
