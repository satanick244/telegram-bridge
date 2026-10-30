import {test,expect} from '@playwright/test';
test('risk workspace preserves unknown data, supports imports, manual approval and auditable credit',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=await page.request.post('/api/auth/login',{data:{username:'e2e_admin',password:'E2E-local-only-Password9!'}});expect(login.status()).toBe(200);
 await page.goto('/#risk');await expect(page.getByRole('heading',{name:'钢贸风控',exact:true})).toBeVisible();await expect(page.getByText('试运行 · 尚未经历史数据校准')).toBeVisible();
 await page.getByLabel('企业名称',{exact:true}).fill('E2E risk customer');await page.getByLabel('业务唯一键',{exact:true}).fill('e2e-customer');await page.getByLabel('来源说明 / 凭据索引',{exact:true}).fill('Isolated browser fixture');await page.getByRole('button',{name:'保存档案',exact:true}).click();await expect(page.getByRole('heading',{name:/E2E risk customer/})).toBeVisible();
 const card=page.locator('article').filter({has:page.getByRole('heading',{name:/E2E risk customer/})});await expect(card.getByText('资料待补齐',{exact:true})).toHaveCount(4);
 await page.getByRole('button',{name:'授信与收款',exact:true}).click();const creditForm=page.locator('form').filter({has:page.getByRole('heading',{name:'申请授信 / 调整总额度',exact:true})});
 await creditForm.getByLabel('申请总额度（非追加值）').fill('1000');await creditForm.getByLabel('审批申请业务唯一键').fill('e2e-grant');await creditForm.getByLabel('申请理由',{exact:true}).fill('Explicit trial fixture approval');await creditForm.getByRole('checkbox').check();await creditForm.getByRole('button',{name:'提交授信审批'}).click();
 await page.getByRole('button',{name:/^人工审批/}).click();const approval=page.locator('article').filter({has:page.getByRole('heading',{name:'授信额度 · 待审批'})});await approval.getByLabel('审批决定').selectOption('approved');await approval.getByLabel('审批理由 / 风险接受依据').fill('Missing evidence acknowledged for local fixture');await approval.getByRole('button',{name:'确认人工审批'}).click();await expect(page.getByRole('heading',{name:'授信额度 · 已批准'})).toBeVisible();
 await page.getByRole('button',{name:'授信与收款',exact:true}).click();await expect(page.locator('.risk-credit')).toContainText('可用 USD 1,000.00');
 await page.getByRole('button',{name:'数据导入',exact:true}).click();await page.getByLabel('文件格式').selectOption('json');await page.getByLabel('导入数据性质').selectOption('example');await page.getByLabel('批次唯一键').fill('e2e-import');await page.getByLabel('文件来源 / 核验索引').fill('Explicit example file');await page.getByLabel('文件内容（可粘贴或编辑）').fill(JSON.stringify([{businessKey:'e2e-example',name:'Example supplier',partyType:'supplier'}]));await page.getByRole('button',{name:'校验并导入整批'}).click();await expect(page.getByText(/e2e-import · 1 条/)).toBeVisible();
 await page.getByRole('button',{name:'审计记录',exact:true}).click();await page.getByRole('button',{name:'校验审计链完整性'}).click();await expect(page.getByRole('status')).toContainText('审计链校验通过');
 await page.setViewportSize({width:390,height:844});for(const tab of ['风险档案','订单与压力测算','授信与收款','人工审批','预警工单','数据导入','试运行参数','审计记录']){await page.getByRole('navigation',{name:'风控工作台'}).getByRole('button',{name:new RegExp('^'+tab)}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)}
 expect(errors).toEqual([]);
});
test('risk workspace buyer sees no other account records or administrator approval controls',async({page})=>{
 const reg=await page.request.post('/api/auth/register',{data:{username:'risk_browser_buyer',password:'Browser-risk-password9!',displayName:'Risk Buyer'}});expect(reg.status()).toBe(201);await page.goto('/#risk');await expect(page.getByText('尚无记录；请录入或导入真实资料。')).toBeVisible();await expect(page.getByText('E2E risk customer',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'试运行参数',exact:true}).click();await expect(page.getByText('仅管理员可修改规则。')).toBeVisible();
 const deny=await page.request.put('/api/risk/rules',{data:{version:1}});expect(deny.status()).toBe(403);
});
