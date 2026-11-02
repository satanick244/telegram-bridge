import {randomUUID} from 'node:crypto';
import {fail} from './auth.js';
import {defaultRiskRules} from './risk-schema.js';
import {digest,key} from './risk-domain.js';
export const workflowPolicy=Object.freeze({version:2,makerChecker:true,shipmentValidityHours:24,automaticPayment:false,automaticWarehouseRelease:false});
export const accountId=(profileId,currency)=>key('credit',profileId,currency);
export const riskTransaction=(store,fn)=>store.transaction(async tx=>{const lock=await tx.get('risk_locks','operations');if(!lock)throw Error('Risk lock is not initialized');return fn(tx,lock)});
export async function accessible(tx,user,id,kind){const row=await tx.get('risk_records',id);if(!row||(user.role!=='admin'&&row.ownerId!==user.id)||row.kind!==kind||row.isDemo&&!user.isDemo)throw fail(404,'记录不存在或无权访问');return row}
export async function audit(tx,user,ownerId,action,entityId,payload){const root=await tx.get('risk_locks','operations');const row={id:'AUD-'+randomUUID(),sequence:(root.sequence||0)+1,ownerId,actorId:user.id,action,entityId,at:new Date().toISOString(),payload,previousHash:root.headHash};row.hash=digest(row);await tx.insert('risk_audit',row);await tx.put('risk_locks',{...root,sequence:row.sequence,headHash:row.hash});}
export async function rules(tx){return await tx.get('risk_records','rules')||{...defaultRiskRules}}
export function creditProblems(account,trade,now=new Date(),profile=null){
 const issues=[];const today=now.toISOString().slice(0,10);
 if(!account)return ['未获批授信'];
 if(profile&&account.profileVersion!==profile.version)issues.push('客户档案已更新或未复核，须重新审批授信');
 if(account.frozen)issues.push('授信已冻结');
 if(!account.validUntil)issues.push('历史授信未设置有效期，须重新审批');else if(account.validUntil<today)issues.push('授信已到期');
 if(account.occupiedMinor>account.limitMinor)issues.push('当前占用超过授信额度');
 if(trade){if(trade.dueDate&&account.validUntil&&trade.dueDate>account.validUntil)issues.push('合同到期日超出授信有效期');if(account.maxSingleMinor!==null&&account.maxSingleMinor!==undefined&&trade.amountMinor-(trade.receivedMinor||0)-(trade.releasedMinor||0)>account.maxSingleMinor)issues.push('超出单笔授信上限');if(!account.maxTermDays)issues.push('授信账期条件未确认');else if(trade.dueDate&&Math.ceil((Date.parse(trade.dueDate+'T00:00:00Z')-Date.parse((trade.createdAt||now.toISOString()).slice(0,10)+'T00:00:00Z'))/86400000)>account.maxTermDays)issues.push('超出获批账期');}
 return issues;
}
