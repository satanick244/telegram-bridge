import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDemoScenarios,evaluateDemoScenario} from '../server/demo-scenarios.js';
import {evaluate} from '../server/risk-domain.js';
import {defaultRiskRules} from '../server/risk-schema.js';
const asOf=new Date('2026-10-31T00:00:00Z');
const rows=buildDemoScenarios({id:'demo_fixture',role:'buyer'},asOf),evaluations=rows.filter(x=>x.kind==='evaluation');
const scenario=key=>evaluations.find(e=>e.tradeSnapshot.businessKey.startsWith('SCENARIO-'+key+' '));
test('nine complete forecast cases retain unverified identity, provenance, units and immutable as-of inputs',()=>{
 assert.equal(evaluations.length,9);assert.ok(evaluations.every(e=>e.status==='情景输入完整'&&e.missing.length===0));assert.ok(evaluations.every(e=>e.verificationMissing.length===3&&e.profileSnapshot.registration===null&&e.profileSnapshot.financialEvidence===null));assert.ok(rows.every(r=>r.source==='estimate'&&r.isDemo&&r.demoSetVersion===2));
 assert.equal(rows.filter(r=>['credit','ledger','approval'].includes(r.kind)).length,0);assert.equal(rows.filter(r=>r.kind==='demo_case').length,9);assert.equal(rows.filter(r=>r.kind==='demo_review').length,9);
 assert.ok(rows.filter(r=>r.kind==='profile').every(p=>p.scenarioAssumptions.annualRevenueCnyMinor>0&&p.scenarioAssumptions.paymentTerms&&p.scenarioAssumptions.currentRatio>0));
 for(const e of evaluations){assert.equal(e.forecast.actualLedger,false);assert.equal(e.creditSnapshot,null);assert.equal(e.evaluationAsOf,asOf.toISOString());assert.equal(e.automaticRelease,false);assert.ok(!e.status.includes('低风险'));}
});
test('positive margin, pressure loss, capacity shortfall, overdue stages and settled debt differ arithmetically',()=>{
 const a=scenario('A');assert.equal(a.baseMarginMinor,7115200);assert.equal(a.stressedMarginMinor,4555744);assert.equal(a.forecast.occupiedMinor,5472000);assert.equal(a.forecast.availableMinor,4528000);assert.equal(a.forecast.outcome,'压力后仍有毛差');
 const b=scenario('B');assert.equal(b.baseMarginMinor,3000000);assert.equal(b.stressedMarginMinor,-2606000);assert.equal(b.forecast.outcome,'压力后预计亏损');
 const c=scenario('C');assert.equal(c.forecast.overLimitMinor,3912000);assert.equal(c.forecast.availableMinor,-3912000);assert.equal(c.forecast.outcome,'授信容量不足');
 assert.equal(scenario('D').overdueDays,3);assert.ok(scenario('D').warnings.includes('逾期预警'));assert.equal(scenario('D').outstandingMinor,1770000);
 assert.equal(scenario('E').overdueDays,12);assert.ok(scenario('E').warnings.includes('逾期升级'));
 const f=scenario('F');assert.equal(f.tradeSnapshot.term,'CFR');assert.equal(f.tradeSnapshot.freightCurrency,'USD');assert.ok(f.baseMarginMinor>0&&f.stressedMarginMinor<0);
 const h=scenario('H');assert.equal(h.forecast.limitMinor,0);assert.equal(h.forecast.utilizationPct,null);assert.equal(h.profileSnapshot.scenarioAssumptions.onTimePerformancePct,null);assert.equal(h.forecast.outcome,'新客未授信');
 const i=scenario('I');assert.equal(i.outstandingMinor,0);assert.equal(i.overdueDays,0);assert.ok(!i.warnings.some(w=>w.includes('逾期')));assert.equal(i.forecast.occupiedMinor,1000000);
});
test('procurement prepayment and kilograms do not become receivables, customer credit or sales profit',()=>{
 const g=scenario('G');assert.equal(g.tradeSnapshot.quantity,30000);assert.equal(g.tradeSnapshot.unit,'千克');assert.equal(g.baseCostMinor,11100000);assert.equal(g.stressedCostMinor,11670000);assert.equal(g.baseMarginMinor,null);assert.equal(g.forecast.proposedOccupationMinor,0);assert.equal(g.forecast.supplierPrepaymentExposureMinor,2160000);assert.equal(g.outstandingMinor,8640000);
});
test('forecast status cannot change real evaluation completeness or substitute for missing numeric inputs',()=>{
 const a=scenario('A');const real=evaluate({...a.tradeSnapshot,isDemo:false,source:'manual'},a.profileSnapshot,defaultRiskRules,null,asOf);assert.equal(real.status,'资料待补齐');assert.ok(real.missing.includes('企业注册资料'));
 const incomplete=evaluateDemoScenario({...a.tradeSnapshot,steelUnitCostMinor:null},a.profileSnapshot);assert.equal(incomplete.status,'情景输入待补齐');assert.ok(incomplete.missing.includes('钢材单位成本及同单位数量'));assert.equal(incomplete.stressedMarginMinor,null);const unknown=evaluateDemoScenario({...a.tradeSnapshot,amountMinor:null},a.profileSnapshot);assert.equal(unknown.outstandingMinor,null);assert.equal(unknown.forecast.availableMinor,null);assert.equal(unknown.overdueDays,null);assert.equal(unknown.status,'情景输入待补齐');
 const recomputed=evaluateDemoScenario(a.tradeSnapshot,a.profileSnapshot);assert.equal(recomputed.overdueDays,0);assert.equal(recomputed.evaluationAsOf,asOf.toISOString());
});
