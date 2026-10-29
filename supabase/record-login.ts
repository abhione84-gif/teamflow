import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { isIP } from 'node:net';

const allowed = new Set(['https://teamflow-fawn.vercel.app','http://localhost:4318','http://127.0.0.1:4318']);
function publicAddress(ip: string): boolean {
  if (isIP(ip)===4) {
    const [a,b] = ip.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||ip.startsWith('192.0.2.')||ip.startsWith('198.51.100.')||ip.startsWith('203.0.113.'));
  }
  return isIP(ip)===6 && /^[23][0-9a-f]{0,3}:/i.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');
}

Deno.serve(async (req: Request) => {
  const origin=req.headers.get('origin');
  const headers: Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(origin&&allowed.has(origin)) headers['Access-Control-Allow-Origin']=origin;
  const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!allowed.has(origin)) return reply(403,{error:'Origin not allowed.'});
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(req.method!=='POST') return reply(405,{error:'Use POST.'});
  const token=req.headers.get('Authorization')||'';
  if(!token.startsWith('Bearer ')) return reply(401,{error:'Sign in first.'});
  const url=Deno.env.get('SUPABASE_URL')!;
  const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:token}}});
  const {data:identity,error:authError}=await caller.auth.getUser(token.slice(7));
  if(authError||!identity.user?.email_confirmed_at) return reply(401,{error:'A verified session is required.'});
  // No IP, location, identity, or session ID is accepted from the request body.
  const {data:audit,error}=await caller.rpc('capture_login_activity');
  if(error||!audit) return reply(403,{error:'Could not verify this workspace login.'});
  if(!audit.needs_location) return reply(200,{recorded:true});
  const server=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  let location: Record<string,string|null>={location_status:'unavailable',location_source:'ipwho.is'};
  if(!audit.ip_address||!publicAddress(audit.ip_address)) location={location_status:'not_public',location_source:null};
  else {
    try {
      const response=await fetch('https://ipwho.is/'+encodeURIComponent(audit.ip_address)+'?fields=success,country,region,city',{signal:AbortSignal.timeout(3500),redirect:'error'});
      if(response.ok){
        const result=await response.json();
        if(result.success===true) {
          const field=(value:unknown)=>typeof value==='string'?value.slice(0,128):null;
          location={location_status:'resolved',location_source:'ipwho.is',country:field(result.country),region:field(result.region),city:field(result.city)};
        }
      }
    } catch { /* IP and login time are already recorded; location is best effort. */ }
  }
  const {error:updateError}=await server.from('login_activity').update(location).eq('id',audit.id).eq('user_id',identity.user.id);
  return reply(200,{recorded:true,locationAvailable:!updateError&&location.location_status==='resolved'});
});
