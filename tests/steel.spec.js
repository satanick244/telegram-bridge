import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  test.skip(
    h.backend !== "java",
    "The steel workbench runs on the Java backend",
  );
});

test("steel order UI carries funds, weighs and releases a partial batch across desktop and phone", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const owner = "steel_ui_owner",
    business = "steel_ui_clerk";
  const check = async (r) => {
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  await check(
    await page.request.post("/api/auth/register", {
      data: {
        username: owner,
        password: "Isolated-ui-fixture9!",
        role: "supplier",
      },
    }),
  );
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:3001" });
  try {
    await check(
      await other.request.post("/api/auth/register", {
        data: {
          username: business,
          password: "Isolated-ui-fixture9!",
          role: "buyer",
        },
      }),
    );
    const company = await check(
      await page.request.post("/api/steel/company", {
        data: { name: "钢贸页面测试企业", dataClass: "test" },
      }),
    );
    const cmd = async (name, body = {}, request = page.request) =>
      check(
        await request.post("/api/steel/" + company.id + "/" + name, {
          data: { ...body, businessKey: crypto.randomUUID() },
        }),
      );
    await cmd("members", {
      userId: owner,
      roles: ["manager", "business", "finance", "warehouse"],
      reason: "Isolated UI role setup",
    });
    await cmd("members", {
      userId: business,
      roles: ["business"],
      reason: "Independent source fixture",
    });
    await cmd("bank_account", {
      number: "BANK001",
      name: "测试收款账户",
      evidence: "本方账户凭据",
      checked: true,
    });
    const customer = await cmd("customer", {
      number: "UI-C001",
      name: "页面测试客户",
      registration: "独立测试身份凭据",
      sourceNote: "隔离页面测试资料",
    });
    const stock = await cmd("stock", {
      number: "UI-LOT1",
      warehouse: "页面测试仓",
      name: "螺纹钢",
      spec: "HRB400E Φ20",
      quantity: "10",
      pricingMode: "weighed",
      costPerTon: "3500",
      costTaxBasis: "inclusive",
      costSource: "manual",
      evidence: "页面测试库存凭据",
      checked: true,
    });
    await page.goto("/#steel");
    await expect(
      page.getByRole("heading", { name: "钢贸业务工作台", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("页面不存在", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "新建订单", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "业务操作" });
    await dialog.getByLabel("企业订单号").fill("UI-CASH-1");
    await dialog.getByLabel("客户", { exact: true }).selectOption(customer.id);
    await dialog.getByLabel("库存批次", { exact: true }).selectOption(stock.id);
    await dialog.getByLabel("合同数量（吨）").fill("2");
    await dialog.getByLabel("商品单价 CNY / 吨").fill("4000");
    await dialog.getByLabel("合同及计重依据").fill("页面测试合同凭据");
    await dialog.getByLabel("运费（不发生填0，未知需核实）").fill("0");
    await dialog.getByLabel("加工费（不发生填0，未知需核实）").fill("0");
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .locator(".steel-order-card")
      .filter({ hasText: "UI-CASH-1" })
      .click();
    await page.getByRole("button", { name: "确认订单并锁定库存" }).click();
    await expect(page.getByRole("status")).toContainText("订单已生效");
    const view = await check(
      await page.request.get("/api/steel?companyId=" + company.id),
    );
    const order = view.records.find(
      (x) => x.kind === "order" && x.number === "UI-CASH-1",
    );
    const receipt = await cmd(
      "receipt",
      {
        customerId: customer.id,
        bankAccount: "BANK001",
        bankReference: "UI-FLOW-1",
        payer: "页面测试客户",
        amount: "4000",
        receivedOn: new Date().toISOString().slice(0, 10),
        evidence: "原始测试流水",
      },
      other.request,
    );
    await page.getByRole("button", { name: "收款与应收", exact: true }).click();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByRole("button", { name: "核验到账并选择分配" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("同时分配到订单（可选）").selectOption(order.id);
    await dialog.getByLabel("本次分配金额 CNY").fill("4000");
    await dialog
      .getByLabel("核验依据（银行原始记录等）")
      .fill("独立核验页面测试原始流水");
    await dialog
      .getByRole("checkbox", { name: "我已核对原始凭据与业务事实" })
      .check();
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "订单与提货", exact: true }).click();
    await page
      .locator(".steel-order-card")
      .filter({ hasText: "UI-CASH-1" })
      .click();
    await page.getByRole("button", { name: "安排本批提货" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("本次计价重量（吨）").fill("1");
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "登记 / 修正本批计重" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("实际磅重（吨）", { exact: true }).fill("1");
    await dialog.getByLabel("计重及出库凭据").fill("页面测试磅单");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".steel-gate")).toContainText("条件满足");
    await page.getByRole("button", { name: "确认实际放行" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("实际放行凭据").fill("页面测试出门登记");
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".steel-batch")).toContainText("已出库");
    const final = await check(
      await page.request.get("/api/steel?companyId=" + company.id),
    );
    const actual = final.records.find((x) => x.id === order.id);
    expect(actual.remainingGram).toBe(1000000);
    expect(actual.debtMinor).toBe(0);
    expect(final.records.find((x) => x.id === stock.id).onHandGram).toBe(
      9000000,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of [
      "订单与提货",
      "收款与应收",
      "库存",
      "客户与授信",
      "待办与审批",
      "企业与规则",
    ]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
    }
    await page.getByRole("button", { name: "登记本方收款账户" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
  }
});

test("new steel demo provides three linked cases and keeps all actions read-only", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await page.request.post("/api/auth/demo", {
    data: { role: "supplier" },
  });
  expect(r.ok()).toBe(true);
  await page.goto("/#steel");
  await expect(page.locator(".steel-order-card")).toHaveCount(3);
  await expect(page.getByText("页面不存在", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("只读演示提示")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建订单", exact: true }),
  ).toBeDisabled();
  await page.locator(".steel-order-card").first().click();
  await expect(page.locator(".steel-gate")).toContainText(
    "等待仓管人工确认放行",
  );
  await expect(
    page.getByRole("button", { name: "确认实际放行" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of [
    "订单与提货",
    "收款与应收",
    "库存",
    "客户与授信",
    "待办与审批",
    "企业与规则",
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  }
  expect(errors).toEqual([]);
});
