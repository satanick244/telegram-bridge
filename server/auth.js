import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {demoAccountNames,getDemoAccount} from './demo.js';
const scrypt=promisify(scryptCallback),days=14,COOKIE='induport_session';
export const fail=(status,message)=>Object.assign(new Error(message),{status});
export const publicUser=u=>u?{id:u.id,username:u.username,displayName:u.displayName,role:u.role,...(u.isDemo?{isDemo:true}:{})}:null;
export function usernameKey(value){if(typeof value!=='string')throw fail(400,'请输入账号');const id=value.normalize('NFKC').trim().toLowerCase();if(!/^[\p{L}\p{N}_.-]{3,40}$/u.test(id))throw fail(400,'账号须为 3–40 位文字、数字、下划线、点或短横线');return id}
export async function hashPassword(password){if(typeof password!=='string'||password.length<8||password.length>128)throw fail(400,'密码须为 8–128 位');const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return 'scrypt$'+salt+'$'+hash.toString('hex')}
async function checkPassword(password,encoded){if(typeof password!=='string'||password.length>128||!encoded)return false;const [algorithm,salt,hex]=encoded.split('$');if(algorithm!=='scrypt'||!salt||!hex)return false;const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});const expected=Buffer.from(hex,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)}
export async function createAccount(store,{username,password,displayName,role='buyer'}){
 const id=usernameKey(username);if(Object.values(demoAccountNames).includes(id))throw fail(400,'该账号名保留给只读演示，请选择其他账号');if(!['buyer','supplier','admin'].includes(role))throw fail(400,'账户类型无效');
 const name=typeof displayName==='string'?displayName.trim():id;if(!name||name.length>80)throw fail(400,'显示名称须为 1–80 字符');
 const passwordHash=await hashPassword(password);const user={id,username:id,displayName:name,role,passwordHash,createdAt:new Date().toISOString()};
 try{await store.insert('users',user)}catch(e){if(e.code==='ER_DUP_ENTRY'||[1555,2067].includes(e.errcode)||String(e.code).startsWith('SQLITE_CONSTRAINT'))throw fail(409,'该账号已存在');throw e}return user;
}
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export function installAuth(app,store,{secureCookies=process.env.NODE_ENV==='production'&&process.env.COOKIE_SECURE!=='false'}={}){
 const cookieOptions={httpOnly:true,sameSite:'lax',secure:secureCookies,path:'/',maxAge:days*86400000};
 const sessionId=req=>{const parts=(req.headers.cookie||'').split(';').map(s=>s.trim());const entry=parts.find(s=>s.startsWith(COOKIE+'='));const token=entry?.slice(COOKIE.length+1);return token&&/^[a-f0-9]{64}$/.test(token)?tokenHash(token):null};
 app.use('/api',async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.get('origin');const expected=process.env.APP_ORIGIN||req.protocol+'://'+req.get('host');
   if((origin&&origin!==expected)||req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'请求来源无效'});
  }
  const id=sessionId(req);if(id){const session=await store.get('sessions',id);if(session&&session.expiresAt>Date.now()){req.user=await store.get('users',session.userId);req.sessionId=id}else if(session)await store.remove('sessions',id)}
  if(req.user?.isDemo){
   const readable=['/health','/auth/me','/bootstrap','/risk'];
   const authActions=['/auth/logout','/auth/login','/auth/register','/auth/demo'];
   if(!(['GET','HEAD'].includes(req.method)&&readable.includes(req.path))&&!(req.method==='POST'&&authActions.includes(req.path)))return res.status(403).json({error:'演示账号为只读，不能提交真实业务、导入、授信或审批。请退出演示后使用自己的账号。'});
  }
  next();
 });
 const attempts=new Map();
 app.use(['/api/auth/login','/api/auth/register','/api/auth/demo'],(req,res,next)=>{if(req.method!=='POST')return next();const key=req.ip;const now=Date.now();const a=attempts.get(key);if(!a||a.until<now){attempts.set(key,{count:1,until:now+15*60000})}else if(++a.count>30){res.set('Retry-After',String(Math.ceil((a.until-now)/1000)));return res.status(429).json({error:'尝试过于频繁，请稍后再试'})}if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);next()});
 const login=async(req,res,user)=>{
  if(req.sessionId)await store.remove('sessions',req.sessionId);
  const ttl=user.isDemo?3600000:days*86400000;const token=randomBytes(32).toString('hex');await store.put('sessions',{id:tokenHash(token),userId:user.id,expiresAt:Date.now()+ttl,...(user.isDemo?{isDemo:true}:{})});res.cookie(COOKIE,token,{...cookieOptions,maxAge:ttl});return res.json({user:publicUser(user)});
 };
 app.post('/api/auth/demo',async(req,res)=>{
  if(req.user&&!req.user.isDemo)throw fail(409,'请先退出当前真实账号，再进入只读演示');
  const user=await getDemoAccount(store,req.body.role,hashPassword);
  for(const session of await store.all('sessions'))if(session.isDemo&&session.expiresAt<=Date.now())await store.remove('sessions',session.id);
  return login(req,res,user);
 });
 app.get('/api/auth/me',(req,res)=>res.json({user:publicUser(req.user)}));
 app.post('/api/auth/register',async(req,res)=>{const b=req.body;if(!['buyer','supplier'].includes(b.role||'buyer'))throw fail(400,'账户类型无效');const user=await createAccount(store,{username:b.username,password:b.password,displayName:b.displayName||b.username,role:b.role||'buyer'});res.status(201);return login(req,res,user)});
 app.post('/api/auth/login',async(req,res)=>{let id;try{id=usernameKey(req.body.username)}catch{throw fail(401,'账号或密码错误')}const user=await store.get('users',id);if(!user||!await checkPassword(req.body.password,user.passwordHash))throw fail(401,'账号或密码错误');return login(req,res,user)});
 app.post('/api/auth/logout',async(req,res)=>{if(req.sessionId)await store.remove('sessions',req.sessionId);res.clearCookie(COOKIE,{httpOnly:true,sameSite:'lax',secure:secureCookies,path:'/'});res.json({ok:true})});
}
export const requireUser=(req,res,next)=>req.user?next():res.status(401).json({error:'请先登录账号'});
export const requireAdmin=(req,res,next)=>req.user?.role==='admin'?next():res.status(403).json({error:'此操作需要管理员权限'});
export async function ensureAdmin(store){
 const username=process.env.ADMIN_USERNAME,password=process.env.ADMIN_PASSWORD;
 if(!username&&!password)return;
 if(!username||!password)throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must both be set');
 const existing=await store.get('users',usernameKey(username));
 if(existing){if(existing.role!=='admin')throw new Error('Configured admin username belongs to another account; choose a different admin username');return}
 await createAccount(store,{username,password,displayName:'平台管理员',role:'admin'});
}
