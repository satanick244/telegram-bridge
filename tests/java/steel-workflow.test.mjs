import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import mysql from "mysql2/promise";
const future = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test(
  "company steel operations preserve funds, stock and debt across real MySQL transactions",
  { timeout: 180000 },
  async (t) => {
    const server = spawn(process.execPath, ["scripts/java-test-server.mjs"], {
      env: { ...process.env, PORT: "3012" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    server.stdout.on("data", (x) => (logs += x));
    server.stderr.on("data", (x) => (logs += x));
    let db;
    try {
      let ready = false;
      for (let i = 0; i < 300; i++) {
        try {
          if ((await fetch("http://127.0.0.1:3012/api/health")).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      assert(ready, logs.slice(-2000));
      const cookies = {};
      const api = async (path, body = null, who = "owner") => {
        const r = await fetch("http://127.0.0.1:3012/api" + path, {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            ...(cookies[who] ? { Cookie: cookies[who] } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (r.headers.get("set-cookie"))
          cookies[who] = r.headers.get("set-cookie").split(";")[0];
        return { status: r.status, body: await r.json() };
      };
      const ok = async (...args) => {
        const r = await api(...args);
        assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r));
        return r.body;
      };
      for (const who of ["owner", "business", "finance", "warehouse", "other"])
        await ok(
          "/auth/register",
          {
            username: "steel_" + who,
            password: "Steel-isolated-fixture9!",
            role: who === "owner" || who === "other" ? "supplier" : "buyer",
          },
          who,
        );
      const company = await ok("/steel/company", {
        name: "Independent steel fixture",
        dataClass: "test",
      });
      const root = "/steel/" + company.id + "/";
      const command = (
        name,
        body = {},
        who = "owner",
        key = crypto.randomUUID(),
      ) => ok(root + name, { ...body, businessKey: key }, who);
      const raw = (name, body = {}, who = "owner", key = crypto.randomUUID()) =>
        api(root + name, { ...body, businessKey: key }, who);
      const state = () =>
        ok("/steel?companyId=" + encodeURIComponent(company.id));
      const get = async (id) =>
        (await state()).records.find((x) => x.id === id);
      for (const who of ["business", "finance", "warehouse"])
        await command("members", {
          userId: "steel_" + who,
          roles: [who],
          reason: "Explicit fixture role grant",
        });
      await command("bank_account", {
        number: "BANK001",
        name: "Fixture own bank account",
        evidence: "Isolated account ownership fixture",
        checked: true,
      });
      const customer = await command(
        "customer",
        {
          number: "C001",
          name: "Fixture customer A",
          registration: "Fixture identity evidence",
          sourceNote: "Isolated test documents",
        },
        "business",
      );
      const otherCustomer = await command(
        "customer",
        {
          number: "C002",
          name: "Fixture customer B",
          registration: "Fixture identity evidence",
          sourceNote: "Isolated test documents",
        },
        "business",
      );
      const stock = await command(
        "stock",
        {
          number: "LOT1",
          warehouse: "Fixture warehouse",
          name: "Rebar",
          spec: "HRB400E D20",
          quantity: "20",
          pricingMode: "weighed",
          costPerTon: "3500",
          costTaxBasis: "inclusive",
          costSource: "manual",
          evidence: "Fixture stock ownership and quality",
          checked: true,
        },
        "warehouse",
      );
      const terms = {
        customerId: customer.id,
        stockId: stock.id,
        quantity: "10",
        unitPrice: "4000",
        paymentMode: "credit",
        termDays: 30,
        taxBasis: "inclusive",
        taxRateBps: 1300,
        fees: [],
        contractEvidence: "Fixture signed contract",
      };
      const approve = (a, who = "owner") =>
        command(
          "decide",
          {
            approvalId: a.id,
            decision: "approved",
            reason: "Independent fixture review",
            checked: true,
          },
          who,
        );
      const grant = async (limit) =>
        approve(
          await command(
            "request",
            {
              type: "credit",
              customerId: customer.id,
              limit,
              validUntil: future(180),
              maxTermDays: 60,
              conditions: "Fixture independently verified credit",
              reason: "Fixture credit request",
            },
            "business",
          ),
        );
      let creditOrder, creditBatch, cashOrder, cashBatch, allocation;
      await t.test(
        "membership isolates companies and a finance account cannot release stock",
        async () => {
          assert.equal(
            (
              await api(
                "/steel?companyId=" + encodeURIComponent(company.id),
                null,
                "other",
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await raw(
                "release",
                { batchId: "foreign", checked: true },
                "finance",
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await raw(
                "customer",
                { number: "bad", name: "bad", ownerId: "foreign" },
                "business",
              )
            ).status,
            400,
          );
          assert.equal(
            (await raw("order", { ...terms, number: "NO-CREDIT" }, "warehouse"))
              .status,
            403,
          );
        },
      );
      await t.test(
        "credit must be independently approved before order confirmation",
        async () => {
          creditOrder = await command(
            "order",
            { ...terms, number: "CREDIT-1" },
            "business",
          );
          assert.equal(
            (
              await raw(
                "order_confirm",
                { orderId: creditOrder.id, version: creditOrder.version },
                "business",
              )
            ).status,
            409,
          );
          const a = await command(
            "request",
            {
              type: "credit",
              customerId: customer.id,
              limit: "100000",
              validUntil: future(180),
              maxTermDays: 60,
              conditions: "Fixture credit evidence",
              reason: "Fixture request",
            },
            "business",
          );
          assert.equal(
            (
              await raw(
                "decide",
                {
                  approvalId: a.id,
                  decision: "approved",
                  reason: "self",
                  checked: true,
                },
                "business",
              )
            ).status,
            403,
          );
          await approve(a);
          await command(
            "order_confirm",
            { orderId: creditOrder.id, version: creditOrder.version },
            "business",
          );
          assert.equal((await get(customer.id)).occupiedMinor, 4000000);
          assert.equal((await get(stock.id)).lockedGram, 10000000);
        },
      );
      await t.test(
        "two concurrent orders cannot reserve the same remaining stock",
        async () => {
          const orders = await Promise.all(
            ["RACE-A", "RACE-B"].map((number) =>
              command(
                "order",
                {
                  ...terms,
                  number,
                  quantity: "6",
                  paymentMode: "cash",
                  termDays: 0,
                },
                "business",
              ),
            ),
          );
          const attempts = await Promise.all(
            orders.map((o) =>
              raw(
                "order_confirm",
                { orderId: o.id, version: o.version },
                "business",
              ),
            ),
          );
          assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
          const winner = orders[attempts.findIndex((x) => x.status === 200)];
          await command(
            "order_cancel",
            { orderId: winner.id, reason: "Fixture releases remaining stock" },
            "business",
          );
        },
      );
      await t.test(
        "partial release turns commitment into debt without double occupation or duplicate stock movement",
        async () => {
          creditBatch = await command(
            "batch",
            { orderId: creditOrder.id, quantity: "3" },
            "business",
          );
          await command(
            "weigh",
            {
              batchId: creditBatch.id,
              quantity: "3",
              scaleWeight: "3",
              evidence: "Fixture weighbridge slip",
              checked: true,
            },
            "warehouse",
          );
          const key = crypto.randomUUID(),
            body = {
              batchId: creditBatch.id,
              evidence: "Fixture actual departure",
              checked: true,
            };
          const results = await Promise.all([
            command("release", body, "warehouse", key),
            command("release", body, "warehouse", key),
          ]);
          assert.equal(results[0].id, results[1].id);
          assert.equal((await get(stock.id)).onHandGram, 17000000);
          assert.equal((await get(customer.id)).occupiedMinor, 4000000);
          assert.equal((await get(creditOrder.id)).debtMinor, 1200000);
          assert.equal((await raw("release", body, "warehouse")).status, 409);
        },
      );
      await t.test(
        "import and confirmation remain distinct; manual receipt requires another finance reviewer",
        async () => {
          const r = await command(
            "receipt",
            {
              customerId: customer.id,
              bankAccount: "BANK001",
              bankReference: "MANUAL-CHECK",
              payer: "Fixture customer",
              amount: "1",
              receivedOn: future(0),
              evidence: "Fixture manual bank evidence",
            },
            "finance",
          );
          assert.equal(
            (
              await raw(
                "receipt_confirm",
                { receiptId: r.id, evidence: "Self check", checked: true },
                "finance",
              )
            ).status,
            403,
          );
          const input = {
            customerNumber: "C001",
            bankAccount: "BANK001",
            bankReference: "FLOW-1",
            payer: "Fixture customer",
            amount: "8000",
            receivedOn: future(0),
            evidence: "Fixture imported original bank record",
          };
          const batch = await command(
            "receipt_import",
            { format: "json", content: JSON.stringify([input]) },
            "business",
          );
          const id = batch.receiptIds[0];
          assert.equal(
            (
              await raw(
                "allocate",
                { receiptId: id, orderId: creditOrder.id, amount: "1" },
                "finance",
              )
            ).status,
            409,
          );
          await command(
            "receipt_confirm",
            {
              receiptId: id,
              evidence: "Fixture original statement checked",
              checked: true,
            },
            "finance",
          );
          const attempts = await Promise.all([
            raw(
              "allocate",
              { receiptId: id, orderId: creditOrder.id, amount: "8000" },
              "finance",
            ),
            raw(
              "allocate",
              { receiptId: id, orderId: creditOrder.id, amount: "8000" },
              "finance",
            ),
          ]);
          assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
          allocation = attempts.find((x) => x.status === 200).body;
          assert.equal((await get(creditOrder.id)).debtMinor, 400000);
          assert.equal((await get(customer.id)).occupiedMinor, 3200000);
          assert.equal((await get(id)).availableMinor, 0);
          const duplicate = await command(
            "receipt_import",
            { format: "json", content: JSON.stringify([input]) },
            "business",
          );
          assert.equal(duplicate.receiptIds[0], id);
          const before = (await state()).records.filter(
            (x) => x.kind === "receipt",
          ).length;
          const bad = await raw(
            "receipt_import",
            {
              format: "json",
              content: JSON.stringify([
                { ...input, bankReference: "ROLLBACK" },
                { ...input, customerNumber: "UNKNOWN", bankReference: "BAD" },
              ]),
            },
            "business",
          );
          assert.equal(bad.status, 404);
          assert.equal(
            (await state()).records.filter((x) => x.kind === "receipt").length,
            before,
          );
        },
      );
      await t.test(
        "funds are reserved per batch; two batches cannot spend the same advance",
        async () => {
          cashOrder = await command(
            "order",
            {
              ...terms,
              number: "CASH-1",
              quantity: "2",
              paymentMode: "cash",
              termDays: 0,
            },
            "business",
          );
          await command(
            "order_confirm",
            { orderId: cashOrder.id, version: cashOrder.version },
            "business",
          );
          const r = await command(
            "receipt",
            {
              customerId: customer.id,
              bankAccount: "BANK001",
              bankReference: "CASH-FUNDS",
              payer: "Fixture customer",
              amount: "4000",
              receivedOn: future(0),
              evidence: "Fixture actual bank record",
            },
            "business",
          );
          await command(
            "receipt_confirm",
            {
              receiptId: r.id,
              orderId: cashOrder.id,
              amount: "4000",
              evidence: "Independent original checked",
              checked: true,
            },
            "finance",
          );
          assert.equal(
            (
              await raw(
                "allocate",
                { receiptId: r.id, orderId: "foreign", amount: "1" },
                "finance",
              )
            ).status,
            404,
          );
          const bs = [];
          for (let i = 0; i < 2; i++) {
            const p = await command(
              "batch",
              { orderId: cashOrder.id, quantity: "1" },
              "business",
            );
            await command(
              "weigh",
              {
                batchId: p.id,
                quantity: "1",
                scaleWeight: "1",
                evidence: "Fixture weighing " + i,
                checked: true,
              },
              "warehouse",
            );
            bs.push(p);
          }
          const attempts = await Promise.all(
            bs.map((p) =>
              raw(
                "release",
                {
                  batchId: p.id,
                  evidence: "Actual fixture departure",
                  checked: true,
                },
                "warehouse",
              ),
            ),
          );
          assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
          cashBatch = attempts.find((x) => x.status === 200).body;
          assert.equal((await get(cashOrder.id)).cashAvailableMinor, 0);
          assert.equal((await get(cashOrder.id)).debtMinor, 0);
          await command(
            "batch_cancel",
            {
              batchId: bs[attempts.findIndex((x) => x.status === 409)].id,
              reason: "Fixture pending batch cancelled",
            },
            "business",
          );
        },
      );
      await t.test(
        "returns stay quarantined until inspection, then restore stock and release overpaid funds",
        async () => {
          const before = (await get(stock.id)).onHandGram;
          const a = await command(
            "request",
            {
              type: "return",
              batchId: cashBatch.id,
              quantity: "0.25",
              reason: "Fixture quality return",
            },
            "business",
          );
          await approve(a);
          await command(
            "return_receive",
            {
              approvalId: a.id,
              evidence: "Fixture goods physically received",
              checked: true,
            },
            "warehouse",
          );
          assert.equal((await get(stock.id)).onHandGram, before);
          assert.equal((await get(stock.id)).quarantineGram, 250000);
          await command("return_inspect", {
            approvalId: a.id,
            decision: "accepted",
            evidence: "Fixture independent quality acceptance",
            checked: true,
          });
          assert.equal((await get(stock.id)).onHandGram, before + 250000);
          assert.equal((await get(stock.id)).quarantineGram, 0);
          assert.equal((await get(cashOrder.id)).cashAvailableMinor, 100000);
          const refund = await command(
            "request",
            {
              type: "refund",
              orderId: cashOrder.id,
              amount: "1000",
              payee: "Fixture original payer account",
              reason: "Fixture return overpayment",
            },
            "finance",
          );
          await approve(refund);
          assert.equal(
            (
              await raw(
                "refund_pay",
                {
                  approvalId: refund.id,
                  evidence: "Wrong role",
                  checked: true,
                },
                "warehouse",
              )
            ).status,
            403,
          );
          const key = crypto.randomUUID();
          await command(
            "refund_pay",
            {
              approvalId: refund.id,
              evidence: "Fixture original account bank transfer",
              checked: true,
            },
            "finance",
            key,
          );
          await command(
            "refund_pay",
            {
              approvalId: refund.id,
              evidence: "Fixture original account bank transfer",
              checked: true,
            },
            "finance",
            key,
          );
          assert.equal((await get(cashOrder.id)).cashAvailableMinor, 0);
          assert.equal((await get(cashBatch.id)).netMinor, 300000);
        },
      );
      await t.test(
        "reversal restores actual debt even after a credit reduction, then holds new business",
        async () => {
          await grant("35000");
          const a = await command(
            "request",
            {
              type: "reverse_allocation",
              allocationId: allocation.id,
              reason: "Fixture original assignment correction",
            },
            "finance",
          );
          await approve(a);
          assert.equal((await get(creditOrder.id)).debtMinor, 1200000);
          assert.equal((await get(customer.id)).occupiedMinor, 4000000);
          assert.equal((await get(customer.id)).held, true);
          const p = await command(
            "batch",
            { orderId: creditOrder.id, quantity: "1" },
            "business",
          );
          await command(
            "weigh",
            {
              batchId: p.id,
              quantity: "1",
              scaleWeight: "1",
              evidence: "Fixture weight",
              checked: true,
            },
            "warehouse",
          );
          assert.equal(
            (
              await raw(
                "release",
                {
                  batchId: p.id,
                  evidence: "Attempt while held",
                  checked: true,
                },
                "warehouse",
              )
            ).status,
            409,
          );
          await command(
            "batch_cancel",
            { batchId: p.id, reason: "Fixture cleanup" },
            "business",
          );
          await grant("100000");
          await approve(
            await command(
              "request",
              {
                type: "hold",
                customerId: customer.id,
                held: false,
                reason: "Fixture debt and new credit reviewed",
              },
              "business",
            ),
          );
        },
      );
      await t.test(
        "overdue and weight exceptions are batch-bound and invalidated by rule changes",
        async () => {
          db = await mysql.createConnection(
            JSON.parse(fs.readFileSync("/tmp/induport-java-test-3012.json")),
          );
          const old = await get(creditBatch.id);
          const rawBatch = { ...old };
          for (const field of [
            "paidMinor",
            "netMinor",
            "debtMinor",
            "overdueDays",
            "gate",
          ])
            delete rawBatch[field];
          rawBatch.dueDate = future(-8);
          await db.execute("UPDATE ip_steel_records SET data=? WHERE id=?", [
            JSON.stringify(rawBatch),
            old.id,
          ]);
          const p = await command(
            "batch",
            { orderId: creditOrder.id, quantity: "1" },
            "business",
          );
          await command(
            "weigh",
            {
              batchId: p.id,
              quantity: "1.1",
              scaleWeight: "1.1",
              evidence: "Fixture overweight within contract remainder",
              checked: true,
            },
            "warehouse",
          );
          assert.equal(
            (
              await raw(
                "release",
                { batchId: p.id, evidence: "Blocked", checked: true },
                "warehouse",
              )
            ).status,
            409,
          );
          await approve(
            await command(
              "request",
              {
                type: "exception",
                batchId: p.id,
                reason: "Fixture temporary overdue arrangement",
                measures: "Fixture responsible person and repayment deadline",
              },
              "business",
            ),
          );
          const view = await state();
          assert((await get(p.id)).gate.exceptionApproved);
          await command("rules", {
            overdueWarningDays: view.company.rules.overdueWarningDays,
            overdueEscalationDays: view.company.rules.overdueEscalationDays,
            weightToleranceBps: view.company.rules.weightToleranceBps,
            steelShockPct: view.company.rules.steelShockPct,
            freightShockPct: view.company.rules.freightShockPct,
            version: view.company.version,
            reason: "Fixture policy revision",
          });
          assert.equal((await get(p.id)).gate.exceptionApproved, false);
          assert.equal(
            (
              await raw(
                "release",
                { batchId: p.id, evidence: "Stale approval", checked: true },
                "warehouse",
              )
            ).status,
            409,
          );
          await approve(
            await command(
              "request",
              {
                type: "exception",
                batchId: p.id,
                reason: "Fixture renewed exact batch review",
                measures: "Updated controlled arrangement",
              },
              "business",
            ),
          );
          await command(
            "release",
            {
              batchId: p.id,
              evidence: "Fixture actual approved release",
              checked: true,
            },
            "warehouse",
          );
          assert(
            (await state()).tasks.some(
              (x) => x.type === "overdue" && x.level === "escalated",
            ),
          );
        },
      );
      await t.test(
        "unknown costs stay unknown, taxes and fee responsibility do not double count",
        async () => {
          const s = await command(
            "stock",
            {
              number: "UNKNOWN-COST",
              warehouse: "Fixture warehouse",
              name: "Beam",
              spec: "Q235B",
              quantity: "10",
              pricingMode: "theoretical",
              costSource: "estimate",
              costTaxBasis: "unknown",
              evidence: "Fixture inventory evidence",
              checked: true,
            },
            "warehouse",
          );
          const o = await command(
            "order",
            {
              ...terms,
              number: "FEE-TAX",
              customerId: otherCustomer.id,
              stockId: s.id,
              quantity: "1",
              unitPrice: "1000",
              taxBasis: "exclusive",
              taxRateBps: 1300,
              paymentMode: "cash",
              termDays: 0,
              fees: [
                {
                  name: "Own freight",
                  amount: "50",
                  payer: "company",
                  included: false,
                  beforeShipping: true,
                },
                {
                  name: "Included charge",
                  amount: "80",
                  payer: "customer",
                  included: true,
                  beforeShipping: true,
                },
                {
                  name: "Separate processing",
                  amount: "100",
                  payer: "customer",
                  included: false,
                  beforeShipping: true,
                },
              ],
            },
            "business",
          );
          const actual = await get(o.id);
          assert.equal(actual.totalMinor, 123000);
          assert.equal(actual.priceSpreadMinor, null);
          assert.equal(actual.stressedSpreadMinor, null);
          assert.equal(
            (
              await raw(
                "order",
                {
                  ...terms,
                  number: "BAD-FEE",
                  paymentMode: "cash",
                  fees: [
                    {
                      name: "postpaid",
                      amount: "100",
                      payer: "customer",
                      included: false,
                      beforeShipping: false,
                    },
                  ],
                },
                "business",
              )
            ).status,
            400,
          );
          await command(
            "order_cancel",
            { orderId: o.id, reason: "Fixture canceled draft" },
            "business",
          );
          await command(
            "order_cancel",
            {
              orderId: cashOrder.id,
              reason: "Fixture remaining ton cancelled",
            },
            "business",
          );
          await command("close", { orderId: cashOrder.id }, "business");
        },
      );
      await t.test(
        "approved refunds reserve funds and can be withdrawn before execution",
        async () => {
          const o = await command(
            "order",
            {
              ...terms,
              number: "REFUND-RESERVE",
              customerId: otherCustomer.id,
              quantity: "1",
              paymentMode: "cash",
              termDays: 0,
            },
            "business",
          );
          await command(
            "order_confirm",
            { orderId: o.id, version: o.version },
            "business",
          );
          const r = await command(
            "receipt",
            {
              customerId: otherCustomer.id,
              bankAccount: "BANK001",
              bankReference: "RESERVED-REFUND",
              payer: "Fixture customer B",
              amount: "1000",
              receivedOn: future(0),
              evidence: "Fixture bank original",
            },
            "business",
          );
          await command(
            "receipt_confirm",
            {
              receiptId: r.id,
              orderId: o.id,
              amount: "1000",
              evidence: "Fixture independent check",
              checked: true,
            },
            "finance",
          );
          const a = await command(
            "request",
            {
              type: "refund",
              orderId: o.id,
              amount: "600",
              payee: "Fixture original payer",
              reason: "Fixture reserved refund",
            },
            "finance",
          );
          await approve(a);
          assert.equal((await get(o.id)).cashAvailableMinor, 40000);
          const second = await command(
            "request",
            {
              type: "refund",
              orderId: o.id,
              amount: "400",
              payee: "Fixture original payer",
              reason: "Fixture second refund",
            },
            "finance",
          );
          await approve(second);
          assert.equal((await get(o.id)).cashAvailableMinor, 0);
          assert.equal(
            (
              await raw(
                "request",
                {
                  type: "refund",
                  orderId: o.id,
                  amount: "1",
                  payee: "Fixture original payer",
                  reason: "Over-reserve attempt",
                },
                "finance",
              )
            ).status,
            409,
          );
          const p = await command(
            "batch",
            { orderId: o.id, quantity: "0.2" },
            "business",
          );
          await command(
            "weigh",
            {
              batchId: p.id,
              quantity: "0.2",
              scaleWeight: "0.2",
              evidence: "Fixture actual weight",
              checked: true,
            },
            "warehouse",
          );
          assert.equal((await get(p.id)).gate.canRelease, false);
          const task = (await state()).tasks.find(
            (t) => t.batchId === p.id && t.title.includes("收款"),
          );
          assert(task);
          await command("task", {
            taskId: task.id,
            assignee: "steel_finance",
            state: "handling",
            reason: "Fixture assigned funding gap",
          });
          await command("approval_cancel", {
            approvalId: a.id,
            reason: "Fixture bank transfer not executed",
          });
          const changed = (await state()).tasks.find((t) => t.id === task.id);
          assert(changed);
          assert.equal(changed.assignee, "steel_finance");
          assert.equal(changed.state, "handling");
          await command("approval_cancel", {
            approvalId: second.id,
            reason: "Fixture bank transfer not executed",
          });
          assert.equal((await get(o.id)).cashAvailableMinor, 100000);
          assert.equal((await get(p.id)).gate.canRelease, true);
          await command(
            "batch_cancel",
            { batchId: p.id, reason: "Fixture cleanup" },
            "business",
          );
        },
      );
      await t.test(
        "pending bank entries can be corrected with approval; unallocated money can be refunded independently of orders",
        async () => {
          await command("members", {
            userId: "steel_owner",
            roles: ["manager", "business", "finance"],
            reason: "Fixture independent finance reviewer",
          });
          const r = (await state()).records.find(
            (x) => x.kind === "receipt" && x.bankReference === "MANUAL-CHECK",
          );
          const a = await command(
            "request",
            {
              type: "receipt_correction",
              receiptId: r.id,
              customerId: customer.id,
              payer: "Corrected fixture customer",
              amount: "1000",
              receivedOn: future(0),
              evidence: "Corrected original statement",
              reason: "Fixture input correction",
            },
            "finance",
          );
          await approve(a);
          assert.equal((await get(r.id)).status, "pending");
          assert.equal(
            (
              await raw(
                "receipt_confirm",
                {
                  receiptId: r.id,
                  evidence: "Self review denied",
                  checked: true,
                },
                "finance",
              )
            ).status,
            403,
          );
          await command("receipt_confirm", {
            receiptId: r.id,
            evidence: "Independent original statement review",
            checked: true,
          });
          const refund = await command(
            "request",
            {
              type: "receipt_refund",
              receiptId: r.id,
              amount: "1000",
              payee: "Fixture original bank payer",
              reason: "Fixture mistaken payment return",
            },
            "finance",
          );
          await approve(refund);
          assert.equal((await get(r.id)).availableMinor, 0);
          assert.equal(
            (
              await raw(
                "allocate",
                { receiptId: r.id, orderId: creditOrder.id, amount: "1" },
                "finance",
              )
            ).status,
            409,
          );
          const key = crypto.randomUUID();
          const body = {
            approvalId: refund.id,
            evidence: "Fixture verified original-route transfer",
            checked: true,
          };
          await command("refund_pay", body, "finance", key);
          await command("refund_pay", body, "finance", key);
          const result = await get(r.id);
          assert.equal(result.refundedMinor, 100000);
          assert.equal(result.availableMinor, 0);
        },
      );
      await t.test(
        "stock count records shortages honestly and blocks release; closed orders can reopen controlled aftersales",
        async () => {
          const s = await command(
            "stock",
            {
              number: "COUNT-ZERO",
              warehouse: "Fixture count warehouse",
              name: "Rebar",
              spec: "Q235",
              quantity: "2",
              pricingMode: "weighed",
              costSource: "manual",
              costTaxBasis: "unknown",
              evidence: "Fixture count opening",
              checked: true,
            },
            "warehouse",
          );
          const o = await command(
            "order",
            {
              ...terms,
              number: "COUNT-ORDER",
              stockId: s.id,
              customerId: otherCustomer.id,
              quantity: "1",
              paymentMode: "cash",
              termDays: 0,
            },
            "business",
          );
          await command(
            "order_confirm",
            { orderId: o.id, version: o.version },
            "business",
          );
          const count = await command(
            "request",
            {
              type: "stock_count",
              stockId: s.id,
              quantity: "0",
              evidence: "Fixture physical zero count",
              reason: "Fixture inventory discrepancy",
            },
            "warehouse",
          );
          await approve(count);
          await command(
            "stock_adjust",
            {
              approvalId: count.id,
              evidence: "Approved count posted",
              checked: true,
            },
            "warehouse",
          );
          assert.equal((await get(s.id)).onHandGram, 0);
          assert.equal((await get(s.id)).shortageGram, 1000000);
          const p = await command(
            "batch",
            { orderId: o.id, quantity: "1" },
            "business",
          );
          await command(
            "weigh",
            {
              batchId: p.id,
              quantity: "1",
              scaleWeight: "1",
              evidence: "Fixture weighing",
              checked: true,
            },
            "warehouse",
          );
          assert(
            (await get(p.id)).gate.hard.some((x) => x.includes("库存不足")),
          );
          assert.equal(
            (
              await raw(
                "request",
                {
                  type: "exception",
                  batchId: p.id,
                  reason: "Cannot bypass missing stock",
                  measures: "No bypass",
                },
                "business",
              )
            ).status,
            409,
          );
          assert.equal((await get(cashOrder.id)).status, "closed");
          const reopen = await command(
            "request",
            {
              type: "reopen",
              orderId: cashOrder.id,
              reason: "Fixture post-settlement aftersales",
            },
            "business",
          );
          await approve(reopen);
          assert.equal((await get(cashOrder.id)).status, "cancelled");
        },
      );
      await t.test(
        "temporary credit is bound to one contract and cannot fund a different order",
        async () => {
          const s = await command(
            "stock",
            {
              number: "TEMP-STOCK",
              warehouse: "Fixture warehouse",
              name: "Beam",
              spec: "Q235",
              quantity: "30",
              pricingMode: "theoretical",
              costSource: "manual",
              costTaxBasis: "unknown",
              evidence: "Fixture stock",
              checked: true,
            },
            "warehouse",
          );
          const o = await command(
            "order",
            { ...terms, number: "TEMP-ORDER", stockId: s.id, quantity: "20" },
            "business",
          );
          assert.equal(
            (
              await raw(
                "order_confirm",
                { orderId: o.id, version: o.version },
                "business",
              )
            ).status,
            409,
          );
          const scope = await command(
            "request",
            {
              type: "temporary_credit",
              orderId: o.id,
              amount: "30000",
              validUntil: future(90),
              conditions: "Only this fixture order, controlled maturity",
              reason: "Fixture bounded temporary credit",
            },
            "business",
          );
          await approve(scope);
          await command(
            "order_confirm",
            { orderId: o.id, version: o.version },
            "business",
          );
          assert.equal(
            (await get(customer.id)).temporaryOccupiedMinor,
            3000000,
          );
          const foreign = await command(
            "order",
            {
              ...terms,
              number: "TEMP-CANNOT-BORROW",
              stockId: s.id,
              quantity: "3",
            },
            "business",
          );
          assert.equal(
            (
              await raw(
                "order_confirm",
                { orderId: foreign.id, version: foreign.version },
                "business",
              )
            ).status,
            409,
          );
          const revoke = await command(
            "request",
            {
              type: "temporary_credit",
              orderId: o.id,
              amount: "0",
              validUntil: future(90),
              conditions: "Fixture scope revoked after review",
              reason: "Fixture revoke without hiding debt",
            },
            "business",
          );
          await approve(revoke);
          assert.equal((await get(customer.id)).temporaryOccupiedMinor, 0);
          assert(
            (await get(o.id)).creditIssues.some((x) => x.includes("额度不足")),
          );
          await command(
            "order_cancel",
            { orderId: o.id, reason: "Fixture release unused commitments" },
            "business",
          );
        },
      );
      await t.test(
        "credit sales still require contractually prepaid fees and keep forecast costs separate from receivables",
        async () => {
          const s = await command(
            "stock",
            {
              number: "FEE-STOCK",
              warehouse: "Fixture warehouse",
              name: "Beam",
              spec: "Q235",
              quantity: "3",
              pricingMode: "theoretical",
              costPerTon: "3500",
              costTaxBasis: "inclusive",
              costSource: "estimate",
              evidence: "Fixture source inventory",
              checked: true,
            },
            "warehouse",
          );
          await approve(
            await command(
              "request",
              {
                type: "credit",
                customerId: otherCustomer.id,
                limit: "10000",
                validUntil: future(180),
                maxTermDays: 30,
                conditions: "Fixture fee scenario credit",
                reason: "Fixture independent grant",
              },
              "business",
            ),
          );
          const o = await command(
            "order",
            {
              ...terms,
              number: "CREDIT-PREPAID-FEE",
              customerId: otherCustomer.id,
              stockId: s.id,
              quantity: "1",
              fees: [
                {
                  name: "运费",
                  amount: "100",
                  payer: "customer",
                  included: false,
                  beforeShipping: true,
                  actualCost: "80",
                  costSource: "estimate",
                  costTaxBasis: "inclusive",
                },
              ],
            },
            "business",
          );
          await command(
            "order_confirm",
            { orderId: o.id, version: o.version },
            "business",
          );
          assert.equal((await get(o.id)).totalMinor, 410000);
          assert.equal((await get(o.id)).freightStressExtraMinor, 800);
          const p = await command(
            "batch",
            { orderId: o.id, quantity: "1" },
            "business",
          );
          await command(
            "weigh",
            {
              batchId: p.id,
              quantity: "1",
              evidence: "Fixture theoretical quantity",
              checked: true,
            },
            "warehouse",
          );
          assert(
            (await get(p.id)).gate.hard.some((x) => x.includes("先付费用")),
          );
          const r = await command(
            "receipt",
            {
              customerId: otherCustomer.id,
              bankAccount: "BANK001",
              bankReference: "FEE-PAYMENT",
              payer: "Fixture B",
              amount: "100",
              receivedOn: future(0),
              evidence: "Fixture fee payment",
            },
            "business",
          );
          await command(
            "receipt_confirm",
            {
              receiptId: r.id,
              orderId: o.id,
              amount: "100",
              evidence: "Independent fee original checked",
              checked: true,
            },
            "finance",
          );
          await command(
            "release",
            {
              batchId: p.id,
              evidence: "Fixture physical departure",
              checked: true,
            },
            "warehouse",
          );
          assert.equal((await get(p.id)).debtMinor, 400000);
        },
      );
      await t.test(
        "fractional weights round once per posted amount and the final batch preserves the contract total",
        async () => {
          const s = await command(
            "stock",
            {
              number: "ROUND-STOCK",
              warehouse: "Fixture warehouse",
              name: "Precision fixture",
              spec: "Test",
              quantity: "1",
              pricingMode: "theoretical",
              costSource: "manual",
              costTaxBasis: "unknown",
              evidence: "Fixture stock",
              checked: true,
            },
            "warehouse",
          );
          const o = await command(
            "order",
            {
              ...terms,
              number: "ROUND-CENTS",
              customerId: otherCustomer.id,
              stockId: s.id,
              quantity: "1",
              unitPrice: "0.01",
              paymentMode: "cash",
              termDays: 0,
            },
            "business",
          );
          await command(
            "order_confirm",
            { orderId: o.id, version: o.version },
            "business",
          );
          const r = await command(
            "receipt",
            {
              customerId: otherCustomer.id,
              bankAccount: "BANK001",
              bankReference: "ROUND-PAYMENT",
              payer: "Fixture B",
              amount: "0.01",
              receivedOn: future(0),
              evidence: "Fixture penny payment",
            },
            "business",
          );
          await command(
            "receipt_confirm",
            {
              receiptId: r.id,
              orderId: o.id,
              amount: "0.01",
              evidence: "Independent penny check",
              checked: true,
            },
            "finance",
          );
          for (const weight of ["0.333333", "0.333333", "0.333334"]) {
            const p = await command(
              "batch",
              { orderId: o.id, quantity: weight },
              "business",
            );
            await command(
              "weigh",
              {
                batchId: p.id,
                quantity: weight,
                evidence: "Fixture precise theoretical weight",
                checked: true,
              },
              "warehouse",
            );
            await command(
              "release",
              {
                batchId: p.id,
                evidence: "Fixture actual departure",
                checked: true,
              },
              "warehouse",
            );
          }
          const result = await get(o.id);
          assert.equal(result.remainingGram, 0);
          assert.equal(result.paidMinor, 1);
          assert.equal(result.debtMinor, 0);
          assert.equal(result.cashAvailableMinor, 0);
          await command("close", { orderId: o.id }, "business");
        },
      );
      await t.test(
        "mistaken confirmations can be revoked only after every funding destination is cleared",
        async () => {
          const r = await command(
            "receipt",
            {
              customerId: otherCustomer.id,
              bankAccount: "BANK001",
              bankReference: "REVOKE-CHECK",
              payer: "Fixture B",
              amount: "50",
              receivedOn: future(0),
              evidence: "Fixture source",
            },
            "business",
          );
          await command(
            "receipt_confirm",
            { receiptId: r.id, evidence: "Independent check", checked: true },
            "finance",
          );
          const a = await command(
            "request",
            {
              type: "receipt_unconfirm",
              receiptId: r.id,
              reason: "Fixture mistaken verification",
            },
            "finance",
          );
          await approve(a);
          const result = await get(r.id);
          assert.equal(result.status, "pending");
          assert.equal(result.availableMinor, 0);
          assert.equal(result.confirmationHistory.length, 1);
          assert.equal(result.confirmedBy, null);
          const correction = await command(
            "request",
            {
              type: "receipt_correction",
              receiptId: r.id,
              customerId: otherCustomer.id,
              payer: "Correct fixture B",
              amount: "40",
              receivedOn: future(0),
              evidence: "Corrected fixture source",
              reason: "Correct after revocation",
            },
            "business",
          );
          await approve(correction);
          await command(
            "receipt_confirm",
            {
              receiptId: r.id,
              evidence: "Rechecked corrected source",
              checked: true,
            },
            "finance",
          );
          assert.equal((await get(r.id)).availableMinor, 4000);
          const used = (await state()).records.find(
            (x) => x.kind === "receipt" && x.bankReference === "FEE-PAYMENT",
          );
          assert.equal(
            (
              await raw(
                "request",
                {
                  type: "receipt_unconfirm",
                  receiptId: used.id,
                  reason: "Cannot hide consumed money",
                },
                "finance",
              )
            ).status,
            409,
          );
        },
      );
      await t.test(
        "audit chain includes new business records and demo workbench remains read-only",
        async () => {
          await ok(
            "/auth/login",
            { username: "e2e_admin", password: "E2E-local-only-Password9!" },
            "admin",
          );
          assert.equal(
            (await ok("/risk/audit/verify", null, "admin")).ok,
            true,
          );
          await ok("/auth/demo", { role: "supplier" }, "demo");
          const d = await ok("/steel", null, "demo");
          assert.equal(d.company.dataClass, "example");
          assert.equal(d.records.filter((x) => x.kind === "order").length, 3);
          assert.equal(
            (
              await api(
                root + "order",
                { ...terms, businessKey: "demo-write" },
                "demo",
              )
            ).status,
            403,
          );
        },
      );
    } finally {
      if (db) await db.end();
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await once(server, "exit");
      }
    }
  },
);
