import mysql from 'mysql2/promise';
import {createHash} from 'node:crypto';
import {createDatabase} from './db.js';
import {estimateRange} from '../shared/pricing.js';
const buckets=['products','suppliers','orders','inquiries','applications','users','sessions','meta'];
const table=name=>{if(!buckets.includes(name))throw new Error('Invalid database table');return '`ip_'+name+'`'};
export async function createMysqlDatabase(config){
 const pool=mysql.createPool({...config,waitForConnections:true,connectionLimit:8,charset:'utf8mb4',connectTimeout:10000});
 const adapter=(executor,locking=false)=>({
  engine:'mysql',
  async all(bucket){const [rows]=await executor.query(`SELECT data FROM ${table(bucket)} ORDER BY id`);return rows.map(r=>typeof r.data==='string'?JSON.parse(r.data):r.data)},
  async get(bucket,id){const [rows]=await executor.execute(`SELECT data FROM ${table(bucket)} WHERE id=?${locking?' FOR UPDATE':''}`,[id]);return rows.length?(typeof rows[0].data==='string'?JSON.parse(rows[0].data):rows[0].data):null},
  async put(bucket,item){await executor.execute(`INSERT INTO ${table(bucket)} (id,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)`,[item.id,JSON.stringify(item)]);return item},
  async insert(bucket,item){await executor.execute(`INSERT INTO ${table(bucket)} (id,data) VALUES (?,?)`,[item.id,JSON.stringify(item)]);return item},
  async remove(bucket,id){await executor.execute(`DELETE FROM ${table(bucket)} WHERE id=?`,[id])},
 });
 const store=adapter(pool);
 store.transaction=async fn=>{const c=await pool.getConnection();try{await c.beginTransaction();const result=await fn(adapter(c,true));await c.commit();return result}catch(e){await c.rollback();throw e}finally{c.release()}};
 store.close=()=>pool.end();store.probe=()=>pool.query('SELECT 1');
 try{
  for(const bucket of buckets)await pool.query(`CREATE TABLE IF NOT EXISTS ${table(bucket)} (id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [columns]=await pool.query("SHOW COLUMNS FROM ip_applications LIKE 'registration'");
  if(!columns.length)try{await pool.query("ALTER TABLE ip_applications ADD COLUMN registration VARCHAR(18) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.registration'))) STORED, ADD UNIQUE KEY ip_application_registration (registration)")}catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e}
  const c=await pool.getConnection();const lockName='induport-init-'+createHash('sha256').update(config.database).digest('hex').slice(0,32);
  try{
   const [[lock]]=await c.execute('SELECT GET_LOCK(?,30) AS acquired',[lockName]);if(lock.acquired!==1)throw new Error('Database initialization lock timed out');
   await c.beginTransaction();const tx=adapter(c,true);
   if(!await tx.get('meta','catalog-v1')){
    const seed=createDatabase(':memory:');try{for(const p of seed.all('products'))if(!await tx.get('products',p.id))await tx.insert('products',p)}finally{seed.close()}
    await tx.insert('meta',{id:'catalog-v1',createdAt:new Date().toISOString()});
   }
   for(const p of await tx.all('products'))if(p.catalogOnly&&!p.priceRange)await tx.put('products',{...p,priceRange:estimateRange(p)});
   await c.commit();
  }catch(e){await c.rollback();throw e}finally{await c.execute('SELECT RELEASE_LOCK(?)',[lockName]);c.release()}
  return store;
 }catch(e){await pool.end();throw e}
}
export async function openDatabase(){
 const client=process.env.DATABASE_CLIENT||(process.env.MYSQL_HOST?'mysql':'sqlite');
 if(client==='sqlite')return createDatabase();
 if(client!=='mysql')throw new Error('DATABASE_CLIENT must be mysql or sqlite');
 for(const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'])if(!process.env[key])throw new Error('Missing database setting: '+key);
 const port=Number(process.env.MYSQL_PORT||3306);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid MYSQL_PORT');
 const config={host:process.env.MYSQL_HOST,port,database:process.env.MYSQL_DATABASE,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD};
 if(process.env.MYSQL_SSL&&!['true','false'].includes(process.env.MYSQL_SSL))throw new Error('MYSQL_SSL must be true or false');
 const useSsl=process.env.MYSQL_SSL?process.env.MYSQL_SSL==='true':!['127.0.0.1','localhost','::1'].includes(config.host);
 if(useSsl)config.ssl={rejectUnauthorized:true,verifyIdentity:true,...(process.env.MYSQL_SSL_CA?{ca:process.env.MYSQL_SSL_CA.replaceAll('\\n','\n')}:{})};
 return createMysqlDatabase(config);
}
