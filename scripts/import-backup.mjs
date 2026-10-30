import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {openDatabase} from '../server/storage.js';
import {digest} from '../server/risk-domain.js';
const path=process.argv[2];
if(!path)throw new Error('Usage: node --env-file-if-exists=.env scripts/import-backup.mjs /private/path/induport.backup.json');
if(fs.statSync(path).size>32*1024*1024)throw new Error('Backup is too large');
const input=JSON.parse(fs.readFileSync(path,'utf8'));
if(input.format!=='induport-backup-v1'||!input.tables)throw new Error('Invalid InduPort backup');
// Risk snapshots must be restored as a complete chain, never as arbitrary audit rows.
const hasRisk=['risk_records','risk_audit','risk_locks'].some(k=>k in input.tables);
if(hasRisk){
 for(const k of ['risk_records','risk_audit','risk_locks'])if(!Array.isArray(input.tables[k])||input.tables[k].length>50000)throw new Error('Incomplete risk backup');
 const roots=input.tables.risk_locks;if(roots.length!==1||roots[0].id!=='operations')throw new Error('Invalid risk audit root');
 let previousHash=null,sequence=0;
 for(const row of [...input.tables.risk_audit].sort((a,b)=>a.sequence-b.sequence)){const {hash,...body}=row;if(row.sequence!==++sequence||row.previousHash!==previousHash||digest(body)!==hash)throw new Error('Risk audit chain integrity check failed');previousHash=hash;}
 if(roots[0].headHash!==previousHash||(roots[0].sequence||0)!==sequence)throw new Error('Risk audit root mismatch');
}
const store=await openDatabase();
if(store.engine!=='mysql'){await store.close();throw new Error('Set DATABASE_CLIENT=mysql and connect the target database before import')}
try{const counts=await store.transaction(async tx=>{const counts={};for(const bucket of ['users','suppliers','products','applications','inquiries','orders',...(hasRisk?['risk_records','risk_audit','risk_locks']:[])]){const rows=input.tables[bucket]||[];if(!Array.isArray(rows)||rows.length>50000)throw new Error('Invalid backup table');counts[bucket]=0;for(const row of rows){if(!row||typeof row.id!=='string'||row.id.length>191)throw new Error('Invalid record id');const existing=await tx.get(bucket,row.id);if(existing){if(bucket==='risk_locks'&&!existing.headHash&&!(existing.sequence||0)){await tx.put(bucket,row);counts[bucket]++;continue}if(bucket==='products'&&existing.catalogOnly&&row.catalogOnly)continue;if(bucket==='users'&&existing.role==='admin'&&row.role==='admin')continue;if(isDeepStrictEqual(existing,row))continue;throw new Error('Record conflict in '+bucket+'; no data imported')}await tx.insert(bucket,row);counts[bucket]++}}return counts});console.log('Backup imported:',counts)}finally{await store.close()}
