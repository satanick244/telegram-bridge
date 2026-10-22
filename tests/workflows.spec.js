import { test, expect } from '@playwright/test';

test('all workspace pages render without browser errors', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for (const [route,title] of [['overview','业务总览'],['market','好钢材，不止于国界。'],['products','我的商品'],['inquiries','询价与报价'],['orders','订单管理'],['profit','每一吨利润，都心中有数。'],['logistics','跨越山海，交付信任。'],['documents','贸易单证，一处协作。'],['suppliers','与好供应商，一起走向全球。'],['onboarding','你的好钢材，值得被世界看见。'],['settings','企业设置']]) {
    await page.goto('/#'+route); await expect(page.locator('h1')).toHaveText(title);
  }
  expect(errors).toEqual([]);
});

test('supplier applies, is approved and publishes a new product',async({page})=>{
  await page.goto('/#onboarding');
  await page.getByLabel('企业名称 *',{exact:true}).fill('瀚海测试钢铁有限公司');
  await page.getByLabel('统一社会信用代码 *',{exact:true}).fill('91310000E2E0000001');
  await page.getByLabel('企业所在地 *',{exact:true}).fill('中国 · 江苏');
  await page.getByLabel('联系人 *',{exact:true}).fill('张经理');
  await page.getByLabel('企业联系邮箱 *',{exact:true}).fill('export@example.com');
  await page.getByLabel('年产能（吨）*',{exact:true}).fill('500000');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'提交入驻申请'}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'入驻申请已提交'}).first()).toBeVisible();
  await page.getByRole('button',{name:'查看记录'}).click();
  const row=page.locator('tr').filter({hasText:'瀚海测试钢铁有限公司'});
  await row.getByRole('button',{name:'通过',exact:true}).click();
  await expect(row.getByText('已通过',{exact:true})).toBeVisible();
  await page.goto('/#products');await page.getByRole('button',{name:'发布商品',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('商品名称 *',{exact:true}).fill('出口测试钢卷');
  await dialog.getByLabel('英文名称',{exact:true}).fill('Export Test Coil');
  await dialog.getByLabel('所属供应商 *',{exact:true}).selectOption({label:'瀚海测试钢铁有限公司'});
  await dialog.getByLabel('钢种牌号 *',{exact:true}).fill('Q355B');
  await dialog.getByLabel('产品规格 *',{exact:true}).fill('3 × 1250 mm');
  await dialog.getByLabel('出口单价（USD / 吨）*',{exact:true}).fill('580');
  await dialog.getByLabel('采购成本（CNY / 吨）*',{exact:true}).fill('3200');
  await dialog.getByLabel('可售库存（吨）*',{exact:true}).fill('1000');
  await dialog.getByLabel('最小起订量（吨）*',{exact:true}).fill('25');
  await dialog.getByRole('button',{name:'确认发布商品'}).click();
  await expect(dialog.getByRole('heading',{name:'商品已成功上架'}).first()).toBeVisible();
  await dialog.getByRole('button',{name:'查看记录'}).click();
  await expect(page.locator('tr').filter({hasText:'出口测试钢卷'})).toBeVisible();
  await page.reload();await expect(page.locator('tr').filter({hasText:'出口测试钢卷'})).toBeVisible();
});

test('buyer filters, favorites, inquires and purchases; order progresses and invoice downloads',async({page})=>{
  await page.goto('/#market');
  await page.getByPlaceholder('搜索钢材、牌号或规格').fill('热轧钢卷');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('button',{name:'收藏商品',exact:true}).click();
  await page.getByRole('button',{name:/我的收藏/}).click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('button',{name:'优质热轧钢卷',exact:true}).click();
  await page.getByRole('button',{name:'联系供应商 / 询价'}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('买方企业名称 *').fill('Ocean Test Buyer');
  await dialog.getByLabel('联系邮箱 *').fill('buy@example.com');
  await dialog.getByLabel('目的国家 / 地区 *').selectOption('越南');
  await dialog.getByLabel('采购要求 *').fill('请提供 SGS 认证以及 30 天内装运报价。');
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'发送采购询价'}).click();
  await expect(dialog.getByRole('heading',{name:'采购询价已发送'}).first()).toBeVisible();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.goto('/#market');await page.getByRole('button',{name:'优质热轧钢卷',exact:true}).click();
  await page.getByRole('button',{name:'创建采购订单',exact:true}).click();
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('买方企业名称 *').fill('Ocean Test Buyer');
  await dialog.getByLabel('联系邮箱 *').fill('buy@example.com');
  await dialog.getByLabel('目的国家 / 地区 *').selectOption('越南');
  await dialog.getByLabel('采购数量（吨）*').fill('50');
  await dialog.getByLabel('目的港口 *').fill('胡志明港');
  await expect(dialog.locator('.order-estimate')).toContainText('$26,400.00');
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'提交采购订单'}).click();
  await expect(dialog.getByRole('heading',{name:'采购订单已创建'}).first()).toBeVisible();
  await dialog.getByRole('button',{name:'查看记录'}).click();
  const row=page.locator('tr').filter({hasText:'Ocean Test Buyer'});await expect(row).toBeVisible();
  await row.getByRole('button').first().click();
  await page.getByRole('button',{name:'演示推进：合同确认'}).click();
  await expect(page.getByRole('button',{name:'演示推进：生产备货'})).toBeVisible();
  await page.getByRole('button',{name:'查看贸易单证'}).click();
  const dl=page.waitForEvent('download');await page.getByRole('button',{name:'导出形式发票草稿'}).click();
  expect((await dl).suggestedFilename()).toMatch(/^PI-SF-.*\.csv$/);
});

test('profit changes are calculated and uncalculated exports are prevented',async({page})=>{
  await page.goto('/#profit');
  await page.getByLabel('出口单价',{exact:true}).fill('600');
  await page.getByLabel('采购成本',{exact:true}).fill('3500');
  await page.getByLabel('订单数量',{exact:true}).fill('100');
  await page.getByLabel('结算汇率',{exact:true}).fill('7');
  await page.getByLabel('运费与港杂费',{exact:true}).fill('20');
  await page.getByLabel('其他固定费用',{exact:true}).fill('500');
  await expect(page.getByRole('button',{name:'导出测算'})).toBeDisabled();
  await page.getByRole('button',{name:'重新测算利润'}).click();
  await expect(page.locator('.profit-result-card h2')).toHaveText('$6,300.00');
  await expect(page.getByRole('button',{name:'导出测算'})).toBeEnabled();
});

test('mobile routes fit viewport and navigation works',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  for(const route of ['overview','market','products','inquiries','orders','profit','logistics','documents','suppliers','onboarding','settings']) {
    await page.goto('/#'+route);await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button',{name:'打开导航'}).click();
  await page.locator('nav').getByRole('link',{name:'全球采购市场'}).click();
  await expect(page.locator('h1')).toHaveText('好钢材，不止于国界。');
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  await page.screenshot({path:'test-results/mobile-market.png',fullPage:true,animations:'disabled'});
});

test('keyboard global search opens and finds a product',async({page})=>{
  await page.goto('/');await expect(page.locator('h1')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('输入商品名称、钢种、订单号或买家…').fill('A106');
  await page.getByRole('dialog').getByRole('button',{name:/无缝碳钢管/}).click();
  await expect(page.getByRole('dialog').getByRole('heading',{name:'无缝碳钢管'})).toBeVisible();
});

test('supplier directory filters marketplace to the selected supplier',async({page})=>{
  await page.goto('/#suppliers');
  await page.locator('.supplier-card').filter({hasText:'华东钢铁集团'}).getByRole('button',{name:'发现产品'}).click();
  await expect(page.locator('h1')).toHaveText('好钢材，不止于国界。');
  await expect(page.getByLabel('筛选供应商')).toHaveValue('s1');
  await expect(page.locator('.product-card')).toHaveCount(2);
});
