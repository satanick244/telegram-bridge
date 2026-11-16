import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Package,
  Wallet,
  ClipboardCheck,
  Users,
  ShieldCheck,
  Truck,
  FileText,
  X,
} from "lucide-react";
import "./steel.css";

const roles = {
  business: "业务",
  finance: "财务",
  warehouse: "仓管",
  manager: "负责人",
};
const statuses = {
  draft: "待确认",
  active: "执行中",
  cancelled: "已取消剩余",
  closed: "已结清",
  planned: "待计重",
  weighed: "待放行",
  shipped: "已出库",
  pending: "待确认",
  confirmed: "已确认",
  approved: "已批准",
  rejected: "已驳回",
  received: "待验收",
  accepted: "已验收",
  inspection_rejected: "验收未通过",
  paid: "已退款",
  reversed: "已冲销",
  applied: "已入账",
};
const types = {
  credit: "授信调整",
  exception: "本批例外",
  amend: "合同变更",
  reverse_allocation: "核销冲销",
  return: "退货",
  refund: "退款",
  adjustment: "应收减免",
  hold: "客户暂停 / 恢复",
  stock_count: "库存盘点调整",
  reopen: "重新开启售后",
  receipt_refund: "退回未分配款",
  receipt_correction: "到账资料更正",
  receipt_unconfirm: "撤销误核验",
  temporary_credit: "本单临时授信",
};
const actionNames = {
  "order.confirm": "订单生效并锁定库存",
  "batch.weigh": "确认本批计重",
  "receipt.confirm": "确认到账",
  "receipt.allocate": "分配收款",
  "batch.release": "实际出库",
  "approval.approved": "独立审批通过",
  "approval.rejected": "申请驳回",
  "allocation.reverse": "核销冲销",
  "return.quarantine": "退货进入待检库存",
  "return.inspect": "确认退货验收",
  "refund.paid": "确认订单余额退款",
  "receipt.refund": "确认未分配款退款",
  "stock.count": "盘点调整入账",
  "order.cancel_remaining": "取消未提部分",
  "order.close": "订单结清",
};
const cash = (n) =>
  n == null
    ? "资料待补齐"
    : "¥" +
      (n / 100).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const tons = (n) =>
  n == null
    ? "资料待补齐"
    : (n / 1000000).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) +
      " 吨";
const val = (n) => (n == null ? "" : String(n / 100));
const qty = (n) => (n == null ? "" : String(n / 1000000));
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
function F({ label, children, hint }) {
  const id = React.useId();
  return (
    <label className="steel-field">
      <span id={id}>{label}</span>
      {React.isValidElement(children) && typeof children.type === "string"
        ? React.cloneElement(children, { "aria-labelledby": id })
        : children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Input({
  label,
  name,
  required = true,
  type = "text",
  value,
  step,
  ...rest
}) {
  return (
    <F label={label}>
      <input
        name={name}
        required={required}
        type={type}
        defaultValue={value}
        step={step}
        {...rest}
      />
    </F>
  );
}
function Select({ label, name, items, required = true, value, ...rest }) {
  return (
    <F label={label}>
      <select
        name={name}
        required={required}
        defaultValue={value ?? ""}
        {...rest}
      >
        <option value="">请选择</option>
        {items.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </F>
  );
}
function Money({ label, name, value, required = true }) {
  return (
    <Input
      label={label}
      name={name}
      value={value}
      required={required}
      type="number"
      min="0"
      step="0.01"
    />
  );
}
function Weight({ label = "本次计价重量（吨）", name = "quantity", value }) {
  return (
    <Input
      label={label}
      name={name}
      value={value}
      type="number"
      min="0.000001"
      step="0.000001"
    />
  );
}
function Empty({ children = "尚无记录，请先完成必要资料。" }) {
  return <div className="steel-empty">{children}</div>;
}
function Check({ label = "我已核对原始凭据与业务事实", name = "checked" }) {
  return (
    <label className="steel-check">
      <input type="checkbox" name={name} required />
      {label}
    </label>
  );
}
function Tag({ children, bad = false }) {
  return <span className={"steel-tag " + (bad ? "bad" : "")}>{children}</span>;
}
function Detail({ title = "查看凭据及规则快照", value }) {
  return (
    <details className="steel-json">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export default function SteelWorkspace({ user, openLogin }) {
  const [data, setData] = useState(null),
    [company, setCompany] = useState(""),
    [tab, setTab] = useState("orders"),
    [orderId, setOrder] = useState(""),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const keys = useRef(new Map()),
    dialogRef = useRef(null),
    readSeq = useRef(0);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const key = (e) => {
      if (e.key === "Escape" && !busy) setModal(null);
      if (e.key === "Tab") {
        const items = [
          ...(dialogRef.current?.querySelectorAll(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          ) || []),
        ].filter((el) => el.getClientRects().length && el.type !== "hidden");
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === dialogRef.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [modal, busy]);
  const read = async (id = company) => {
    const seq = ++readSeq.current;
    const r = await fetch(
      "/api/steel" + (id ? "?companyId=" + encodeURIComponent(id) : ""),
    );
    const b = await r.json();
    if (!r.ok) throw Error(b.error || "读取失败");
    if (seq === readSeq.current) {
      setData(b);
      if (b.company && !company) setCompany(b.company.id);
    }
    return b;
  };
  useEffect(() => {
    setData(null);
    if (user) read().catch((e) => setError(e.message));
  }, [user?.id, company]);
  const act = async (command, body = {}, success = "操作已完成") => {
    if (user?.isDemo) {
      setError("演示账号只读，请使用自己的测试企业操作");
      return;
    }
    const k = command + JSON.stringify(body);
    if (!keys.current.has(k)) keys.current.set(k, crypto.randomUUID());
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const url =
        command === "company"
          ? "/api/steel/company"
          : "/api/steel/" + encodeURIComponent(company) + "/" + command;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, businessKey: keys.current.get(k) }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error || "提交失败");
      keys.current.delete(k);
      setModal(null);
      setMessage(success);
      if (command === "company") setCompany(b.id);
      else
        try {
          await read();
        } catch {
          setError("提交已完成，但刷新失败，请重新读取状态，勿重复操作。");
        }
      return b;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const records = data?.records || [],
    list = (kind) => records.filter((x) => x.kind === kind),
    find = (id) => records.find((x) => x.id === id),
    customerName = (id) => find(id)?.name || "客户资料待补齐",
    orderName = (id) => find(id)?.number || "未关联订单";
  const can = (...names) => names.some((r) => (data?.roles || []).includes(r)),
    disabled = busy || user?.isDemo;
  const open = (kind, item = {}) => {
    setError("");
    setModal({ kind, item });
  };
  const order = find(orderId),
    members = list("member"),
    customers = list("customer"),
    stocks = list("stock");
  const tabs = [
    ["orders", "订单与提货", FileText],
    ["finance", "收款与应收", Wallet],
    ["inventory", "库存", Package],
    ["customers", "客户与授信", Users],
    ["tasks", "待办与审批", ClipboardCheck],
    ["settings", "企业与规则", ShieldCheck],
  ];
  if (!user)
    return (
      <section className="steel-workspace">
        <Empty>
          登录后可进入钢贸业务工作台。
          <button className="btn primary" onClick={openLogin}>
            登录账号
          </button>
        </Empty>
      </section>
    );
  if (!data)
    return (
      <section className="steel-workspace">
        {error ? <p role="alert">{error}</p> : <p>正在加载钢贸业务…</p>}
        <button
          className="btn outline"
          onClick={() => read().catch((e) => setError(e.message))}
        >
          重新读取
        </button>
      </section>
    );
  const form = async (e) => {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget)),
      b = { ...raw };
    for (const k of ["checked", "held"])
      if (k in b) b[k] = b[k] === "on" || b[k] === "true";
    if (modal?.kind === "members") {
      b.roles = new FormData(e.currentTarget).getAll("roles");
      b.active = raw.active !== "false";
    }
    if ("taxRatePercent" in b) {
      b.taxRateBps = Math.round(Number(b.taxRatePercent) * 100);
      delete b.taxRatePercent;
    }
    if ("weightTolerancePercent" in b) {
      b.weightToleranceBps = Math.round(Number(b.weightTolerancePercent) * 100);
      delete b.weightTolerancePercent;
    }
    if (modal.kind === "weigh" && modal.item.pricingMode === "weighed")
      b.scaleWeight = b.quantity;
    let command = modal.kind;
    if (
      [
        "credit",
        "exception",
        "amend",
        "reverse_allocation",
        "return",
        "refund",
        "adjustment",
        "hold",
        "stock_count",
        "reopen",
        "receipt_refund",
        "receipt_correction",
        "receipt_unconfirm",
        "temporary_credit",
      ].includes(command)
    ) {
      b.type = command;
      command = "request";
    }
    for (const k of [
      "customerId",
      "orderId",
      "batchId",
      "receiptId",
      "allocationId",
      "approvalId",
    ])
      if (
        modal.kind !== "order" &&
        modal.item[k] &&
        !(modal.kind === "receipt_correction" && k === "customerId")
      )
        b[k] = modal.item[k];
    if (modal.kind === "order" || modal.kind === "amend") {
      b.fees = [];
      for (const prefix of ["freight", "processing"]) {
        if (raw[prefix + "Amount"] !== "") {
          b.fees.push({
            name: prefix === "freight" ? "运费" : "加工费",
            amount: raw[prefix + "Amount"],
            payer: raw[prefix + "Payer"],
            included: raw[prefix + "Included"] === "true",
            beforeShipping: raw[prefix + "Before"] === "true",
            actualCost: raw[prefix + "Cost"],
            costSource: raw[prefix + "CostSource"],
            costTaxBasis: raw[prefix + "CostTaxBasis"],
          });
        }
        for (const key of Object.keys(b))
          if (key.startsWith(prefix)) delete b[key];
      }
    }
    await act(
      command,
      b,
      command === "request" ? "申请已提交，等待独立审批" : "操作已完成",
    );
  };
  const customerOptions = customers.map((c) => [
    c.id,
    c.number + " · " + c.name,
  ]);
  const orderOptions = list("order")
    .filter((o) => ["active", "cancelled"].includes(o.status))
    .map((o) => [o.id, o.number + " · " + customerName(o.customerId)]);
  const approvalSummary = (a) => {
    const entries = [];
    if (a.orderId) entries.push(["关联订单", orderName(a.orderId)]);
    if (a.batchId)
      entries.push(["提货批次", find(a.batchId)?.number || a.batchId]);
    if (a.limitMinor != null) entries.push(["申请总额度", cash(a.limitMinor)]);
    if (a.amountMinor != null)
      entries.push([
        a.type === "temporary_credit" ? "本单临时额度" : "申请金额",
        cash(a.amountMinor),
      ]);
    if (a.quantityGram != null)
      entries.push(["申请数量", tons(a.quantityGram)]);
    if (a.previousGram != null)
      entries.push(["原库存数量", tons(a.previousGram)]);
    if (a.validUntil) entries.push(["有效期至", a.validUntil]);
    if (a.maxTermDays) entries.push(["最长账期", a.maxTermDays + " 天"]);
    if (a.maxSingleMinor != null)
      entries.push(["单笔上限", cash(a.maxSingleMinor)]);
    if (a.conditions) entries.push(["条件与依据", a.conditions]);
    if (a.measures) entries.push(["补偿措施", a.measures]);
    if (a.gateSnapshot?.soft?.length)
      entries.push(["例外事项", a.gateSnapshot.soft.join("；")]);
    if (a.type === "hold")
      entries.push(["申请操作", a.held ? "暂停新增业务" : "恢复业务"]);
    if (a.payee) entries.push(["退款目标", a.payee]);
    if (a.type === "amend") {
      entries.push(
        [
          "原数量 / 单价",
          tons(a.contractSnapshot.quantityGram) +
            " / " +
            cash(a.contractSnapshot.unitPriceMinor),
        ],
        [
          "新数量 / 单价",
          tons(a.payload.quantityGram) + " / " + cash(a.payload.unitPriceMinor),
        ],
        [
          "原 / 新总额",
          cash(a.previousTotalMinor) + " / " + cash(a.proposedTotalMinor),
        ],
        [
          "新付款方式",
          a.payload.paymentMode === "cash"
            ? "先款后货"
            : "赊销 " + a.payload.termDays + " 天",
        ],
      );
    }
    if (a.type === "receipt_correction") {
      entries.push(
        ["更正后客户", customerName(a.payload.customerId)],
        ["更正后金额", cash(a.payload.amountMinor)],
        ["更正后付款人", a.payload.payer],
        ["到账日期", a.payload.receivedOn],
      );
    }
    if (a.decisionReason) entries.push(["审批意见", a.decisionReason]);
    return (
      <dl className="steel-approval-summary">
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  };
  const approvalButtons = (a) => (
    <>
      {a.status === "pending" && can("manager") && (
        <button
          disabled={disabled || a.requestedBy === user.id}
          className="btn primary"
          onClick={() => open("decide", { approvalId: a.id })}
        >
          独立审批
        </button>
      )}
      {a.type === "return" && a.status === "approved" && can("warehouse") && (
        <button
          disabled={disabled}
          className="btn primary"
          onClick={() => open("return_receive", { approvalId: a.id })}
        >
          登记退回实物
        </button>
      )}
      {a.type === "return" && a.status === "received" && can("manager") && (
        <button
          disabled={disabled || a.receivedBy === user.id}
          className="btn primary"
          onClick={() => open("return_inspect", { approvalId: a.id })}
        >
          确认验收结果
        </button>
      )}
      {["refund", "receipt_refund"].includes(a.type) &&
        a.status === "approved" &&
        can("finance") && (
          <button
            disabled={disabled || a.decidedBy === user.id}
            className="btn primary"
            onClick={() => open("refund_pay", { approvalId: a.id })}
          >
            确认实际退款
          </button>
        )}
      {a.type === "stock_count" &&
        a.status === "approved" &&
        can("warehouse") && (
          <button
            disabled={disabled}
            className="btn primary"
            onClick={() => open("stock_adjust", { approvalId: a.id })}
          >
            确认盘点入账
          </button>
        )}
      {(a.status === "pending" ||
        (a.status === "approved" &&
          [
            "return",
            "refund",
            "receipt_refund",
            "exception",
            "stock_count",
          ].includes(a.type) &&
          !a.consumed)) &&
        ((a.status === "pending" && a.requestedBy === user.id) ||
          can("manager")) && (
          <button
            disabled={disabled}
            className="btn outline"
            onClick={() => open("approval_cancel", { approvalId: a.id })}
          >
            撤回未执行申请
          </button>
        )}
    </>
  );
  return (
    <section className="steel-workspace">
      <header className="steel-heading">
        <div>
          <span className="eyebrow">INDUPORT · STEEL OPERATIONS</span>
          <h1>钢贸业务工作台</h1>
          <p>订单、收款、提货放在一起，异常直接交给对应岗位。</p>
        </div>
        <button
          className="btn outline"
          disabled={busy}
          onClick={() => read().catch((e) => setError(e.message))}
        >
          <RefreshCw size={16} />
          刷新
        </button>
      </header>
      {error && (
        <p className="steel-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="steel-success" role="status">
          {message}
        </p>
      )}
      {!data.company ? (
        <div className="steel-card steel-onboard">
          <h2>建立独立企业工作空间</h2>
          <p>
            人民币核算、钢材现货、分批提货。企业创建人默认获得业务和负责人岗位，员工先注册独立账号，再由创建人授权。申请人不能审批自己的申请。
          </p>
          {user.role === "buyer" ? (
            <p>请由供应商或管理员账号建立企业，再授权你的账号加入。</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await act(
                  "company",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <Input label="本方公司名称" name="name" />
              <Select
                label="企业数据性质"
                name="dataClass"
                value="test"
                items={[
                  ["test", "测试企业 · 用于独立操作验收"],
                  ["real", "真实企业 · 仅录入有依据的业务"],
                ]}
              />
              <button className="btn primary" disabled={busy}>
                创建企业
              </button>
            </form>
          )}
        </div>
      ) : (
        <>
          <div className="steel-context">
            <div>
              <strong>{data.company.name}</strong>
              <Tag>
                {data.company.dataClass === "test"
                  ? "测试企业"
                  : data.company.dataClass === "example"
                    ? "演示企业"
                    : "真实企业"}
              </Tag>
              <span>
                人民币 · {data.company.currency || "CNY"}　
                {(data.roles || []).map((r) => roles[r]).join(" / ")}
              </span>
            </div>
            {data.companies?.length > 1 && (
              <select
                aria-label="切换企业"
                value={company}
                onChange={(e) => {
                  setOrder("");
                  setCompany(e.target.value);
                }}
              >
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {data.company.dataClass === "test" && (
            <p className="steel-hint">
              当前为测试企业，资料与账务独立保存。真实使用应另建真实企业，不能把测试记录改成真实记录。
            </p>
          )}
          <div className="steel-summary">
            {[
              ["订单", data.summary.orderCount + " 笔"],
              ["待收应收", cash(data.summary.receivableMinor)],
              ["未分配到账", cash(data.summary.unallocatedMinor)],
              ["待审批", data.summary.pendingApprovals + " 项"],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <nav className="steel-tabs" aria-label="钢贸业务导航">
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                aria-label={label}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => {
                  setTab(id);
                  setOrder("");
                }}
              >
                <Icon size={16} />
                {label}
                {id === "tasks" && data.tasks.length > 0 && (
                  <span>{data.tasks.length}</span>
                )}
              </button>
            ))}
          </nav>
          {tab === "orders" && !order && (
            <>
              <div className="steel-section-head">
                <div>
                  <h2>销售订单</h2>
                  <p>先选客户和库存，后续金额、收款与可提量自动带出。</p>
                </div>
                {can("business") && (
                  <button
                    className="btn primary"
                    disabled={disabled || !customers.length || !stocks.length}
                    onClick={() => open("order")}
                  >
                    <Plus size={16} />
                    新建订单
                  </button>
                )}
              </div>
              {!customers.length || !stocks.length ? (
                <Empty>
                  开始前先建立客户和经确认的库存。
                  <div className="steel-actions">
                    <button
                      className="btn outline"
                      onClick={() => setTab("customers")}
                    >
                      客户与授信
                    </button>
                    <button
                      className="btn outline"
                      onClick={() => setTab("inventory")}
                    >
                      查看库存
                    </button>
                  </div>
                </Empty>
              ) : !list("order").length ? (
                <Empty />
              ) : (
                <div className="steel-grid">
                  {list("order").map((o) => (
                    <button
                      className="steel-card steel-order-card"
                      key={o.id}
                      onClick={() => setOrder(o.id)}
                    >
                      <div className="steel-section-head">
                        <strong>{o.number}</strong>
                        <Tag>{statuses[o.status]}</Tag>
                      </div>
                      <h3>{customerName(o.customerId)}</h3>
                      <p>
                        {find(o.stockId)?.name} · {find(o.stockId)?.spec}
                      </p>
                      <dl>
                        <div>
                          <dt>本单金额</dt>
                          <dd>{cash(o.totalMinor)}</dd>
                        </div>
                        <div>
                          <dt>剩余可提</dt>
                          <dd>{tons(o.remainingGram)}</dd>
                        </div>
                        <div>
                          <dt>待收应收</dt>
                          <dd>{cash(o.debtMinor)}</dd>
                        </div>
                        <div>
                          <dt>已分配预收</dt>
                          <dd>{cash(o.cashAvailableMinor)}</dd>
                        </div>
                      </dl>
                      <span>
                        {o.paymentMode === "credit" ? "授信赊销" : "先款后货"} ·{" "}
                        {o.pricingMode === "weighed" ? "磅计" : "理计"}
                        　查看订单 →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "orders" && order && (
            <>
              <button className="steel-back" onClick={() => setOrder("")}>
                <ArrowLeft size={16} />
                返回订单
              </button>
              <div className="steel-section-head">
                <div>
                  <h2>
                    {order.number} <Tag>{statuses[order.status]}</Tag>
                  </h2>
                  <p>
                    {customerName(order.customerId)} ·{" "}
                    {find(order.stockId)?.warehouse} ·{" "}
                    {find(order.stockId)?.name} {find(order.stockId)?.spec}
                  </p>
                </div>
                <div className="steel-actions">
                  {can("business") && (
                    <button
                      disabled={disabled}
                      className="btn outline"
                      onClick={() => open("order", { ...order, copied: true })}
                    >
                      参照本单新建
                    </button>
                  )}
                  {order.paymentMode === "credit" &&
                    ["draft", "active"].includes(order.status) &&
                    can("business", "finance") && (
                      <button
                        disabled={disabled}
                        className="btn outline"
                        onClick={() =>
                          open("temporary_credit", { orderId: order.id })
                        }
                      >
                        申请本单临时授信
                      </button>
                    )}
                  {order.status === "draft" && can("business") && (
                    <button
                      disabled={disabled}
                      className="btn primary"
                      onClick={() =>
                        act(
                          "order_confirm",
                          { orderId: order.id, version: order.version },
                          "订单已生效，库存及额度已联动",
                        )
                      }
                    >
                      确认订单并锁定库存
                    </button>
                  )}
                  {order.status === "active" &&
                    can("business", "warehouse") && (
                      <button
                        disabled={disabled || order.unplannedGram <= 0}
                        className="btn primary"
                        onClick={() =>
                          open("batch", {
                            orderId: order.id,
                            quantity: qty(order.unplannedGram),
                          })
                        }
                      >
                        安排本批提货
                      </button>
                    )}
                  {["active", "draft"].includes(order.status) &&
                    can("business") && (
                      <>
                        <button
                          disabled={disabled}
                          className="btn outline"
                          onClick={() =>
                            open("amend", { ...order, orderId: order.id })
                          }
                        >
                          变更合同
                        </button>
                        <button
                          disabled={disabled || order.remainingGram <= 0}
                          className="btn outline"
                          onClick={() =>
                            open("order_cancel", { orderId: order.id })
                          }
                        >
                          取消未提部分
                        </button>
                      </>
                    )}
                  {order.status === "closed" && can("business", "finance") && (
                    <button
                      disabled={disabled}
                      className="btn outline"
                      onClick={() => open("reopen", { orderId: order.id })}
                    >
                      申请重新开启售后
                    </button>
                  )}
                  {["active", "cancelled"].includes(order.status) &&
                    can("business") && (
                      <button
                        disabled={disabled}
                        className="btn outline"
                        onClick={() =>
                          act(
                            "close",
                            { orderId: order.id },
                            "订单已完成结清检查",
                          )
                        }
                      >
                        检查并结清
                      </button>
                    )}
                </div>
              </div>
              <div className="steel-grid three">
                <article className="steel-card">
                  <h3>订单与付款条件</h3>
                  <dl>
                    <div>
                      <dt>合同总量</dt>
                      <dd>{tons(order.quantityGram)}</dd>
                    </div>
                    <div>
                      <dt>剩余可提</dt>
                      <dd>{tons(order.remainingGram)}</dd>
                    </div>
                    <div>
                      <dt>商品单价</dt>
                      <dd>{cash(order.unitPriceMinor)} / 吨</dd>
                    </div>
                    <div>
                      <dt>含税口径</dt>
                      <dd>
                        {order.taxBasis === "inclusive"
                          ? "含税单价"
                          : "未税单价，税额另计"}
                      </dd>
                    </div>
                    <div>
                      <dt>付款方式</dt>
                      <dd>
                        {order.paymentMode === "cash"
                          ? "先款后货"
                          : `赊销 ${order.termDays} 天`}
                      </dd>
                    </div>
                    <div>
                      <dt>计重</dt>
                      <dd>
                        {order.pricingMode === "weighed"
                          ? "实际过磅"
                          : "合同理计"}
                      </dd>
                    </div>
                  </dl>
                  <Detail title="查看合同、费用与版本" value={order} />
                </article>
                <article className="steel-card">
                  <h3>收款进度</h3>
                  <dl>
                    <div>
                      <dt>本单总额</dt>
                      <dd>{cash(order.totalMinor)}</dd>
                    </div>
                    <div>
                      <dt>已核销收款</dt>
                      <dd>{cash(order.paidMinor)}</dd>
                    </div>
                    <div>
                      <dt>可用预收</dt>
                      <dd>{cash(order.cashAvailableMinor)}</dd>
                    </div>
                    <div>
                      <dt>批次预留</dt>
                      <dd>{cash(order.cashReservedMinor)}</dd>
                    </div>
                    <div>
                      <dt>退款预留</dt>
                      <dd>{cash(order.refundReservedMinor ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>待收应收</dt>
                      <dd>{cash(order.debtMinor)}</dd>
                    </div>
                    <div>
                      <dt>额度占用</dt>
                      <dd>{cash(order.occupiedMinor)}</dd>
                    </div>
                  </dl>
                  <div className="steel-actions">
                    <button
                      className="btn outline"
                      onClick={() => setTab("finance")}
                    >
                      处理收款
                    </button>
                    {can("finance") && (
                      <button
                        disabled={disabled || order.cashAvailableMinor <= 0}
                        className="btn outline"
                        onClick={() => open("refund", { orderId: order.id })}
                      >
                        申请退回余额
                      </button>
                    )}
                  </div>
                </article>
                <article className="steel-card">
                  <h3>商品价差参考</h3>
                  <p className="steel-big">{cash(order.priceSpreadMinor)}</p>
                  <p>压力后商品价差：{cash(order.stressedSpreadMinor)}</p>
                  <p>运费压力增加支出：{cash(order.freightStressExtraMinor)}</p>
                  <p className="steel-hint">
                    按同税口径商品价与材料成本计算，未扣运费、加工、税负差及经营费用，不等于利润。成本不明时保留空值。
                  </p>
                  {order.creditIssues?.map((issue) => (
                    <p className="steel-warning" key={issue}>
                      {issue}
                    </p>
                  ))}
                </article>
              </div>
              <h3>本单提货批次</h3>
              {!list("batch").some((b) => b.orderId === order.id) ? (
                <Empty>安排提货后，仓管在这里计重并确认放行。</Empty>
              ) : (
                list("batch")
                  .filter((b) => b.orderId === order.id)
                  .map((b) => (
                    <article className="steel-card steel-batch" key={b.id}>
                      <div className="steel-section-head">
                        <h3>{b.number}</h3>
                        <Tag bad={b.overdueDays > 0}>
                          {statuses[b.status]}
                          {b.overdueDays > 0
                            ? " · 逾期 " + b.overdueDays + " 天"
                            : ""}
                        </Tag>
                      </div>
                      <div className="steel-inline-metrics">
                        <span>计划 {tons(b.plannedGram)}</span>
                        <span>本次计价 {tons(b.quantityGram)}</span>
                        <span>
                          应收 {cash(b.netMinor ?? b.gate?.amountMinor)}
                        </span>
                        <span>
                          已覆盖 {cash(b.gate?.coveredMinor ?? b.paidMinor)}
                        </span>
                        <span>到期 {b.dueDate || "出库时生成"}</span>
                      </div>
                      {b.gate && (
                        <div className="steel-gate">
                          <strong>
                            {b.gate.canRelease
                              ? "条件满足，等待仓管人工确认放行"
                              : "还需处理"}
                          </strong>
                          {b.gate.hard.map((x) => (
                            <p key={x}>
                              <AlertCircle size={15} />
                              {x}
                            </p>
                          ))}
                          {b.gate.soft.map((x) => (
                            <p key={x}>
                              {x}
                              {b.gate.exceptionApproved
                                ? " · 本次例外已批准"
                                : ""}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="steel-actions">
                        {["planned", "weighed"].includes(b.status) &&
                          can("warehouse") && (
                            <button
                              disabled={disabled}
                              className="btn outline"
                              onClick={() =>
                                open("weigh", {
                                  batchId: b.id,
                                  quantity: qty(
                                    b.quantityGram ??
                                      (order.pricingMode === "theoretical"
                                        ? b.plannedGram
                                        : null),
                                  ),
                                  pricingMode: order.pricingMode,
                                })
                              }
                            >
                              登记 / 修正本批计重
                            </button>
                          )}
                        {b.status === "weighed" && can("warehouse") && (
                          <button
                            disabled={disabled || !b.gate?.canRelease}
                            className="btn primary"
                            onClick={() => open("release", { batchId: b.id })}
                          >
                            <Truck size={16} />
                            确认实际放行
                          </button>
                        )}
                        {b.gate?.soft.length > 0 &&
                          !b.gate.hard.length &&
                          !b.gate.exceptionApproved && (
                            <button
                              disabled={disabled}
                              className="btn outline"
                              onClick={() =>
                                open("exception", { batchId: b.id })
                              }
                            >
                              申请本批例外
                            </button>
                          )}
                        {["planned", "weighed"].includes(b.status) &&
                          can("business") && (
                            <button
                              disabled={disabled}
                              className="btn outline"
                              onClick={() =>
                                open("batch_cancel", { batchId: b.id })
                              }
                            >
                              取消本批计划
                            </button>
                          )}
                        {b.status === "shipped" && (
                          <>
                            <button
                              disabled={disabled}
                              className="btn outline"
                              onClick={() => open("return", { batchId: b.id })}
                            >
                              申请退货
                            </button>
                            <button
                              disabled={disabled}
                              className="btn outline"
                              onClick={() =>
                                open("adjustment", { batchId: b.id })
                              }
                            >
                              申请质量 / 费用减免
                            </button>
                          </>
                        )}
                      </div>
                      <Detail value={b} />
                    </article>
                  ))
              )}
            </>
          )}
          {tab === "finance" && (
            <>
              <div className="steel-section-head">
                <div>
                  <h2>到账与收款分配</h2>
                  <p>
                    登记与核验账号分离。已确认到账按客户归属分配，本单已有应收优先核销。
                  </p>
                </div>
                <div className="steel-actions">
                  {can("business", "finance") && (
                    <button
                      className="btn outline"
                      disabled={disabled || !customers.length}
                      onClick={() => open("receipt")}
                    >
                      手工登记到账
                    </button>
                  )}
                  {can("business", "finance") && (
                    <button
                      className="btn primary"
                      disabled={disabled}
                      onClick={() => open("receipt_import")}
                    >
                      导入 CSV / JSON 流水
                    </button>
                  )}
                </div>
              </div>
              {!list("receipt").length ? (
                <Empty />
              ) : (
                list("receipt").map((r) => (
                  <article className="steel-card" key={r.id}>
                    <div className="steel-section-head">
                      <h3>
                        {customerName(r.customerId)} · {cash(r.amountMinor)}
                      </h3>
                      <Tag>{statuses[r.status]}</Tag>
                    </div>
                    <p>
                      {r.receivedOn} · {r.payer} · {r.bankReference}
                    </p>
                    <p>
                      未分配余额：{cash(r.availableMinor)} ·{" "}
                      {r.source === "import" ? "文件导入" : "手工录入"}
                    </p>
                    <div className="steel-actions">
                      {r.status === "pending" && can("finance") && (
                        <button
                          disabled={disabled || r.recordedBy === user.id}
                          className="btn primary"
                          onClick={() =>
                            open("receipt_confirm", {
                              receiptId: r.id,
                              customerId: r.customerId,
                            })
                          }
                        >
                          核验到账并选择分配
                        </button>
                      )}
                      {r.status === "pending" && can("business", "finance") && (
                        <button
                          disabled={disabled}
                          className="btn outline"
                          onClick={() =>
                            open("receipt_correction", {
                              receiptId: r.id,
                              ...r,
                            })
                          }
                        >
                          申请更正到账资料
                        </button>
                      )}
                      {r.status === "confirmed" && can("finance") && (
                        <button
                          disabled={disabled}
                          className="btn outline"
                          onClick={() =>
                            open("receipt_unconfirm", { receiptId: r.id })
                          }
                        >
                          申请撤销误核验
                        </button>
                      )}
                      {r.status === "confirmed" &&
                        r.availableMinor > 0 &&
                        can("finance") && (
                          <button
                            disabled={disabled}
                            className="btn outline"
                            onClick={() =>
                              open("receipt_refund", { receiptId: r.id })
                            }
                          >
                            退回未分配款
                          </button>
                        )}
                      {r.status === "confirmed" &&
                        r.availableMinor > 0 &&
                        can("finance") && (
                          <button
                            disabled={disabled}
                            className="btn primary"
                            onClick={() =>
                              open("allocate", {
                                receiptId: r.id,
                                customerId: r.customerId,
                                amount: val(r.availableMinor),
                              })
                            }
                          >
                            分配到本客户订单
                          </button>
                        )}
                    </div>
                    <Detail value={r} />
                  </article>
                ))
              )}
              <h3>分配记录</h3>
              {list("allocation").map((a) => (
                <div className="steel-card" key={a.id}>
                  <strong>
                    {orderName(a.orderId)} · {cash(a.amountMinor)}
                  </strong>
                  <p>
                    {statuses[a.status]} · 已退款 {cash(a.refundedMinor)}
                  </p>
                  {a.status === "active" && can("finance") && (
                    <button
                      className="btn outline"
                      disabled={disabled || a.refundedMinor > 0}
                      onClick={() =>
                        open("reverse_allocation", { allocationId: a.id })
                      }
                    >
                      申请冲销本次分配
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
          {tab === "inventory" && (
            <>
              <div className="steel-section-head">
                <div>
                  <h2>可售库存与待检退货</h2>
                  <p>理计、磅计分别管理，退货验收前不会恢复可售。</p>
                </div>
                {can("warehouse") && (
                  <button
                    className="btn primary"
                    disabled={disabled}
                    onClick={() => open("stock")}
                  >
                    登记入库 / 期初库存
                  </button>
                )}
              </div>
              <div className="steel-grid">
                {!stocks.length ? (
                  <Empty />
                ) : (
                  stocks.map((s) => (
                    <article className="steel-card" key={s.id}>
                      <h3>
                        {s.name} · {s.spec}
                      </h3>
                      <p>
                        {s.warehouse} · 批次 {s.number} ·{" "}
                        {s.pricingMode === "weighed" ? "磅计" : "理计"}
                      </p>
                      <dl>
                        {[
                          ["账面库存", s.onHandGram],
                          ["已锁定", s.lockedGram],
                          ["可售", s.availableGram],
                          ["退货待检", s.quarantineGram],
                          ["已承诺缺口", s.shortageGram ?? 0],
                        ].map(([l, n]) => (
                          <div key={l}>
                            <dt>{l}</dt>
                            <dd>{tons(n)}</dd>
                          </div>
                        ))}
                      </dl>
                      <p>
                        单位成本：{cash(s.costPerTonMinor)} / 吨 ·{" "}
                        {
                          {
                            manual: "凭据录入",
                            import: "资料导入",
                            estimate: "估算",
                          }[s.costSource]
                        }
                      </p>
                      {can("warehouse") && (
                        <button
                          className="btn outline"
                          disabled={disabled}
                          onClick={() => open("stock_count", { stockId: s.id })}
                        >
                          申请盘点调整
                        </button>
                      )}
                      <Detail value={s} />
                    </article>
                  ))
                )}
              </div>
            </>
          )}
          {tab === "customers" && (
            <>
              <div className="steel-section-head">
                <div>
                  <h2>客户与已批准授信</h2>
                  <p>
                    默认额度为未授信，不能直接赊销。占用随订单与收款自动计算。
                  </p>
                </div>
                {can("business", "finance", "manager") && (
                  <button
                    className="btn primary"
                    disabled={disabled}
                    onClick={() => open("customer")}
                  >
                    建立客户
                  </button>
                )}
              </div>
              <div className="steel-grid">
                {!customers.length ? (
                  <Empty />
                ) : (
                  customers.map((c) => (
                    <article className="steel-card" key={c.id}>
                      <h3>
                        {c.name} {c.held && <Tag bad>已暂停</Tag>}
                      </h3>
                      <p>客户编号 {c.number}</p>
                      <dl>
                        <div>
                          <dt>批准额度</dt>
                          <dd>
                            {c.credit ? cash(c.credit.limitMinor) : "尚未授信"}
                          </dd>
                        </div>
                        <div>
                          <dt>当前占用</dt>
                          <dd>{cash(c.occupiedMinor)}</dd>
                        </div>
                        <div>
                          <dt>基础可用额度</dt>
                          <dd>
                            {c.credit
                              ? cash(
                                  c.credit.limitMinor -
                                    c.occupiedMinor +
                                    (c.temporaryOccupiedMinor ?? 0),
                                )
                              : "尚未授信"}
                          </dd>
                        </div>
                        <div>
                          <dt>临时额度占用</dt>
                          <dd>{cash(c.temporaryOccupiedMinor ?? 0)}</dd>
                        </div>
                        <div>
                          <dt>最长逾期</dt>
                          <dd>{c.overdueDays} 天</dd>
                        </div>
                        <div>
                          <dt>授信有效期</dt>
                          <dd>{c.credit?.validUntil || "尚未授信"}</dd>
                        </div>
                      </dl>
                      <div className="steel-actions">
                        {can("business", "finance") && (
                          <button
                            disabled={disabled}
                            className="btn outline"
                            onClick={() => open("credit", { customerId: c.id })}
                          >
                            申请 / 调整授信
                          </button>
                        )}
                        <button
                          disabled={disabled}
                          className="btn outline"
                          onClick={() =>
                            open("hold", { customerId: c.id, held: !c.held })
                          }
                        >
                          {c.held ? "申请恢复业务" : "申请暂停业务"}
                        </button>
                      </div>
                      <Detail value={c} />
                    </article>
                  ))
                )}
              </div>
            </>
          )}
          {tab === "tasks" && (
            <>
              <h2>业务待办</h2>
              <p className="steel-hint">
                逾期、收款缺口和出库阻断自动生成；完成实际业务处理后解除，不靠手工关闭隐藏风险。
              </p>
              {!data.tasks.length ? (
                <Empty>当前没有待处理提醒。</Empty>
              ) : (
                data.tasks.map((t) => (
                  <article className="steel-card steel-task" key={t.id}>
                    <div>
                      <Tag bad={t.level === "escalated"}>
                        {roles[t.role]}处理
                      </Tag>
                      <strong>{t.title}</strong>
                      {t.amountMinor != null && (
                        <span>{cash(t.amountMinor)}</span>
                      )}
                    </div>
                    {!user.isDemo && (
                      <button
                        className="btn outline"
                        onClick={() =>
                          open("task", {
                            taskId: t.id,
                            role: t.role,
                            assignee: t.assignee,
                            state: t.state,
                          })
                        }
                      >
                        分配 / 更新进度
                      </button>
                    )}
                    {t.assignee && (
                      <small>
                        负责人：{t.assignee} ·{" "}
                        {
                          {
                            open: "待处理",
                            handling: "处理中",
                            waiting: "等待补充",
                          }[t.state]
                        }
                      </small>
                    )}
                    {t.orderId && (
                      <button
                        className="btn outline"
                        onClick={() => {
                          setOrder(t.orderId);
                          setTab("orders");
                        }}
                      >
                        查看订单
                      </button>
                    )}
                  </article>
                ))
              )}
              {list("task_state").length > 0 && (
                <details className="steel-card">
                  <summary>查看待办处理记录</summary>
                  {list("task_state").map((t) => (
                    <div key={t.id}>
                      <p>
                        {t.title} · {t.assignee} ·{" "}
                        {data.tasks.some((x) => x.id === t.taskId)
                          ? {
                              open: "待处理",
                              handling: "处理中",
                              waiting: "等待补充",
                            }[t.state]
                          : "当前规则下不再触发"}
                      </p>
                      <small>{t.reason}</small>
                    </div>
                  ))}
                </details>
              )}
              {list("alert").length > 0 && (
                <details className="steel-card">
                  <summary>查看自动预警记录</summary>
                  {list("alert")
                    .slice()
                    .reverse()
                    .slice(0, 100)
                    .map((a) => (
                      <div key={a.id}>
                        <p>
                          {a.title} ·{" "}
                          {a.status === "open"
                            ? "仍在触发"
                            : "当前规则下不再触发"}
                        </p>
                        <small>
                          规则 v{a.rulesSnapshot?.version} ·{" "}
                          {new Date(a.updatedAt || a.createdAt).toLocaleString(
                            "zh-CN",
                          )}
                        </small>
                      </div>
                    ))}
                </details>
              )}
              <h2>审批与执行</h2>
              {!list("approval").length ? (
                <Empty />
              ) : (
                list("approval")
                  .slice()
                  .reverse()
                  .map((a) => (
                    <article className="steel-card" key={a.id}>
                      <div className="steel-section-head">
                        <h3>
                          {types[a.type]} · {customerName(a.customerId)}
                        </h3>
                        <Tag>
                          {a.status === "cancelled"
                            ? "已撤回"
                            : statuses[a.status] || a.status}
                        </Tag>
                      </div>
                      <p>{a.reason}</p>
                      {approvalSummary(a)}
                      <p>
                        申请：{a.requestedBy}　审批：
                        {a.decidedBy || "等待独立复核"}　
                        {a.amountMinor != null && cash(a.amountMinor)}
                      </p>
                      <div className="steel-actions">{approvalButtons(a)}</div>
                      <Detail value={a} />
                    </article>
                  ))
              )}
              <h2>业务流水</h2>
              {list("ledger")
                .slice()
                .reverse()
                .slice(0, 100)
                .map((l) => (
                  <article className="steel-card" key={l.id}>
                    <p>
                      {new Date(l.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {actionNames[l.action] || "业务处理"} · {l.createdBy}
                    </p>
                    <Detail title="查看业务流水及规则版本" value={l} />
                  </article>
                ))}
            </>
          )}
          {tab === "settings" && (
            <>
              <div className="steel-actions" style={{ marginBottom: 16 }}>
                {!user.isDemo && user.role !== "buyer" && (
                  <button
                    className="btn outline"
                    onClick={() => open("company")}
                  >
                    建立另一数据性质的企业
                  </button>
                )}
                {can("manager") && (
                  <button
                    className="btn outline"
                    disabled={disabled}
                    onClick={() => open("bank_account")}
                  >
                    登记本方收款账户
                  </button>
                )}
              </div>
              <div className="steel-card">
                <h3>本方收款账户</h3>
                {list("bank_account").length ? (
                  list("bank_account").map((a) => (
                    <p key={a.id}>
                      {a.number} · {a.name}
                    </p>
                  ))
                ) : (
                  <p>
                    先由负责人确认账户归属，流水导入与手工登记统一使用此编号去重。
                  </p>
                )}
              </div>
              <div className="steel-grid">
                <article className="steel-card">
                  <h2>岗位授权</h2>
                  <p>
                    同一企业内明确授权协作。员工先用原有注册入口建立独立账号；申请人与审批人不能相同。
                  </p>
                  {members.map((m) => (
                    <div key={m.id}>
                      <strong>{m.displayName || m.userId}</strong>
                      <p>
                        {m.userId} ·{" "}
                        {m.active
                          ? m.roles.map((r) => roles[r]).join(" / ")
                          : "已停用"}
                      </p>
                    </div>
                  ))}
                  {data.company.accountOwner === user.id && (
                    <button
                      className="btn primary"
                      disabled={disabled}
                      onClick={() => open("members")}
                    >
                      授权 / 修改员工岗位
                    </button>
                  )}
                </article>
                <article className="steel-card">
                  <h2>试运行规则 v{data.company.rules.version}</h2>
                  <dl>
                    {[
                      [
                        "逾期预警",
                        data.company.rules.overdueWarningDays + " 天",
                      ],
                      [
                        "逾期升级",
                        data.company.rules.overdueEscalationDays + " 天",
                      ],
                      [
                        "重量容差",
                        data.company.rules.weightToleranceBps / 100 + "%",
                      ],
                      ["钢价压力", data.company.rules.steelShockPct + "%"],
                      ["运费压力", data.company.rules.freightShockPct + "%"],
                    ].map(([l, v]) => (
                      <div key={l}>
                        <dt>{l}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="steel-hint">
                    初始参数未用真实历史损失校准。容差不能绕过库存、合同量或收款条件。系统不自动付款或实际放货。
                  </p>
                  {can("manager") && (
                    <button
                      className="btn outline"
                      disabled={disabled}
                      onClick={() => open("rules")}
                    >
                      修改规则并记录理由
                    </button>
                  )}
                </article>
              </div>
            </>
          )}
        </>
      )}
      {modal && (
        <div
          className="steel-modal-shade"
          onMouseDown={(e) =>
            e.target === e.currentTarget && !busy && setModal(null)
          }
        >
          <section
            ref={dialogRef}
            tabIndex="-1"
            className="steel-modal"
            role="dialog"
            aria-modal="true"
            aria-label="业务操作"
          >
            <div className="steel-section-head">
              <h2>
                {
                  {
                    order: "新建订单",
                    customer: "建立客户",
                    stock: "确认库存",
                    batch: "安排本批提货",
                    weigh: "登记本批计重",
                    release: "确认实际放行",
                    receipt: "手工登记到账",
                    receipt_import: "导入银行流水",
                    receipt_confirm: "核验到账",
                    allocate: "分配到订单",
                    members: "岗位授权",
                    rules: "修改规则",
                    decide: "独立审批",
                    return_receive: "登记退货实物",
                    return_inspect: "退货验收",
                    refund_pay: "确认实际退款",
                    order_cancel: "取消未提部分",
                    batch_cancel: "取消本批计划",
                    company: "建立独立企业",
                    bank_account: "确认本方收款账户",
                    task: "处理业务待办",
                    stock_adjust: "确认盘点入账",
                    approval_cancel: "撤回未执行申请",
                    ...types,
                  }[modal.kind]
                }
              </h2>
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                onClick={() => setModal(null)}
                aria-label="关闭业务操作"
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <p className="steel-error" role="alert">
                {error}
              </p>
            )}
            <form key={modal.kind} onSubmit={form}>
              <fieldset disabled={disabled} className="steel-form-grid">
                {modal.kind === "company" && (
                  <>
                    <Input label="本方公司名称" name="name" />
                    <Select
                      label="企业数据性质"
                      name="dataClass"
                      items={[
                        ["test", "测试企业"],
                        ["real", "真实企业"],
                      ]}
                    />
                  </>
                )}
                {modal.kind === "bank_account" && (
                  <>
                    <Input label="收款账户编号（如 BANK001）" name="number" />
                    <Input label="账户名称" name="name" />
                    <Input label="账户归属核验依据" name="evidence" />
                    <Check />
                  </>
                )}
                {modal.kind === "task" && (
                  <>
                    <input
                      type="hidden"
                      name="taskId"
                      value={modal.item.taskId}
                    />
                    <Select
                      label="负责人"
                      name="assignee"
                      items={members
                        .filter(
                          (m) => m.active && m.roles.includes(modal.item.role),
                        )
                        .map((m) => [m.userId, m.displayName || m.userId])}
                      value={modal.item.assignee || ""}
                    />
                    <Select
                      label="处理状态"
                      name="state"
                      value={modal.item.state || "handling"}
                      items={[
                        ["open", "待处理"],
                        ["handling", "处理中"],
                        ["waiting", "等待补充"],
                      ]}
                    />
                    <Input label="处理说明" name="reason" />
                  </>
                )}
                {modal.kind === "customer" && (
                  <>
                    <Input label="客户编号" name="number" />
                    <Input label="客户名称" name="name" />
                    <Input
                      label="客户身份凭据 / 核验索引"
                      name="registration"
                    />
                    <Input label="资料来源说明" name="sourceNote" />
                  </>
                )}
                {modal.kind === "stock" && (
                  <>
                    <Input label="库存批次号" name="number" />
                    <Input label="仓库" name="warehouse" />
                    <Input label="品名" name="name" />
                    <Input label="规格及材质" name="spec" />
                    <Select
                      label="计重口径"
                      name="pricingMode"
                      items={[
                        ["weighed", "磅计"],
                        ["theoretical", "理计"],
                      ]}
                    />
                    <Weight label="已确认可售库存（吨）" />
                    <Money
                      label="单位成本 CNY / 吨（未知留空）"
                      name="costPerTon"
                      required={false}
                    />
                    <Select
                      label="成本来源"
                      name="costSource"
                      value="manual"
                      items={[
                        ["manual", "凭据录入"],
                        ["import", "资料导入"],
                        ["estimate", "估算成本"],
                      ]}
                    />
                    <Select
                      label="成本税口径"
                      name="costTaxBasis"
                      value="unknown"
                      items={[
                        ["unknown", "待补齐"],
                        ["inclusive", "含税"],
                        ["exclusive", "未税"],
                      ]}
                    />
                    <Input label="库存、货权及质量依据" name="evidence" />
                    <Check />
                  </>
                )}
                {["order", "amend"].includes(modal.kind) && (
                  <>
                    {modal.kind === "order" && (
                      <>
                        <Input label="企业订单号" name="number" />
                        {modal.item.copied && (
                          <>
                            <input
                              type="hidden"
                              name="copyFrom"
                              value={modal.item.id}
                            />
                            <p className="steel-hint">
                              已带出历史合同条款作为参考，请核对本次价格、数量及费用；新单单独确认和占用库存。
                            </p>
                          </>
                        )}
                      </>
                    )}
                    <Select
                      label="客户"
                      name="customerId"
                      items={customerOptions}
                      value={modal.item.customerId}
                    />
                    <Select
                      label="库存批次"
                      name="stockId"
                      items={stocks.map((s) => [
                        s.id,
                        s.number +
                          " · " +
                          s.name +
                          " " +
                          s.spec +
                          " · 可售 " +
                          tons(s.availableGram),
                      ])}
                      value={modal.item.stockId}
                    />
                    <Weight
                      label="合同数量（吨）"
                      value={qty(modal.item.quantityGram)}
                    />
                    <Money
                      label="商品单价 CNY / 吨"
                      name="unitPrice"
                      value={val(modal.item.unitPriceMinor)}
                    />
                    <Select
                      label="单价税口径"
                      name="taxBasis"
                      value={modal.item.taxBasis || "inclusive"}
                      items={[
                        ["inclusive", "含税单价"],
                        ["exclusive", "未税单价，税额另计"],
                      ]}
                    />
                    <Input
                      label="增值税率（%）"
                      name="taxRatePercent"
                      type="number"
                      min="0"
                      max="30"
                      step="0.01"
                      value={(modal.item.taxRateBps ?? 1300) / 100}
                    />
                    <Select
                      label="付款方式"
                      name="paymentMode"
                      value={modal.item.paymentMode || "cash"}
                      items={[
                        ["cash", "先款后货"],
                        ["credit", "已审批授信内赊销"],
                      ]}
                    />
                    <Input
                      label="赊销账期（天，现款填0）"
                      name="termDays"
                      type="number"
                      min="0"
                      max="365"
                      value={modal.item.termDays ?? 0}
                    />
                    <Input
                      label="固定到期日（未约定留空）"
                      name="fixedDueDate"
                      type="date"
                      required={false}
                      value={modal.item.fixedDueDate || ""}
                    />
                    <Input
                      label="合同及计重依据"
                      name="contractEvidence"
                      value={modal.item.contractEvidence}
                    />
                    {["freight", "processing"].map((p, i) => (
                      <React.Fragment key={p}>
                        <Money
                          label={
                            (i === 0 ? "运费" : "加工费") +
                            "（不发生填0，未知需核实）"
                          }
                          name={p + "Amount"}
                          value={val(modal.item.fees?.[i]?.amountMinor)}
                        />
                        <Select
                          label={(i === 0 ? "运费" : "加工费") + "承担方"}
                          name={p + "Payer"}
                          value={modal.item.fees?.[i]?.payer || "company"}
                          items={[
                            ["company", "本方承担"],
                            ["customer", "客户承担"],
                          ]}
                        />
                        <Select
                          label="是否已含在商品单价"
                          name={p + "Included"}
                          value={String(
                            modal.item.fees?.[i]?.included ?? false,
                          )}
                          items={[
                            ["false", "未包含"],
                            ["true", "已经包含，不重复计收"],
                          ]}
                        />
                        <Select
                          label="另收费用的支付时间"
                          name={p + "Before"}
                          value={String(
                            modal.item.fees?.[i]?.beforeShipping ?? true,
                          )}
                          items={[
                            ["true", "本批发货前"],
                            ["false", "随赊销账期支付"],
                          ]}
                        />
                        <details className="steel-cost-extra">
                          <summary>补充费用成本测算（可选）</summary>
                          <Money
                            label="本方实际支出 CNY（未知留空）"
                            name={p + "Cost"}
                            value={val(modal.item.fees?.[i]?.actualCostMinor)}
                            required={false}
                          />
                          <Select
                            label="费用成本来源"
                            name={p + "CostSource"}
                            value={modal.item.fees?.[i]?.costSource || "manual"}
                            items={[
                              ["manual", "凭据录入"],
                              ["import", "资料导入"],
                              ["estimate", "估算成本"],
                            ]}
                          />
                          <Select
                            label="费用成本税口径"
                            name={p + "CostTaxBasis"}
                            value={
                              modal.item.fees?.[i]?.costTaxBasis || "inclusive"
                            }
                            items={[
                              ["inclusive", "含税"],
                              ["exclusive", "未税"],
                            ]}
                          />
                        </details>
                      </React.Fragment>
                    ))}
                  </>
                )}
                {modal.kind === "temporary_credit" && (
                  <>
                    <Money
                      label="仅供本单使用的临时额度 CNY（0为撤销）"
                      name="amount"
                    />
                    <Input
                      label="临时授信有效期"
                      name="validUntil"
                      type="date"
                      min={today()}
                    />
                    <Input label="临时授信条件及责任人" name="conditions" />
                  </>
                )}
                {modal.kind === "credit" && (
                  <>
                    <Money label="批准总额度（非追加额）" name="limit" />
                    <Input
                      label="授信有效期"
                      name="validUntil"
                      type="date"
                      min={today()}
                    />
                    <Input
                      label="最长账期（天）"
                      name="maxTermDays"
                      type="number"
                      min="1"
                      max="365"
                      value="30"
                    />
                    <Money
                      label="单笔上限（可选）"
                      name="maxSingle"
                      required={false}
                    />
                    <Input label="授信条件及核验依据" name="conditions" />
                  </>
                )}
                {modal.kind === "hold" && (
                  <input
                    type="hidden"
                    name="held"
                    value={String(modal.item.held)}
                  />
                )}
                {["batch", "return"].includes(modal.kind) && (
                  <Weight value={modal.item.quantity} />
                )}
                {modal.kind === "weigh" && (
                  <>
                    <Weight
                      label={
                        modal.item.pricingMode === "theoretical"
                          ? "本批理计重量（吨）"
                          : "实际磅重（吨）"
                      }
                      value={modal.item.quantity}
                    />
                    {modal.item.pricingMode === "theoretical" && (
                      <Input
                        label="实际磅重（吨，可选）"
                        name="scaleWeight"
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        required={false}
                      />
                    )}
                    <Input label="计重及出库凭据" name="evidence" />
                    <Check />
                  </>
                )}
                {modal.kind === "stock_count" && (
                  <>
                    <input
                      type="hidden"
                      name="stockId"
                      value={modal.item.stockId}
                    />
                    <Input
                      label="实盘可售数量（吨，可填0）"
                      name="quantity"
                      type="number"
                      min="0"
                      step="0.000001"
                    />
                    <Input label="盘点凭据" name="evidence" />
                  </>
                )}
                {modal.kind === "receipt_correction" && (
                  <>
                    <Select
                      label="客户"
                      name="customerId"
                      items={customerOptions}
                      value={modal.item.customerId}
                    />
                    <Input
                      label="付款人"
                      name="payer"
                      value={modal.item.payer}
                    />
                    <Money
                      label="更正后金额 CNY"
                      name="amount"
                      value={val(modal.item.amountMinor)}
                    />
                    <Input
                      label="到账日期"
                      name="receivedOn"
                      type="date"
                      value={modal.item.receivedOn}
                    />
                    <Input label="更正依据" name="evidence" />
                  </>
                )}
                {modal.kind === "receipt" && (
                  <>
                    <Select
                      label="客户"
                      name="customerId"
                      items={customerOptions}
                    />
                    <Select
                      label="本方收款账户"
                      name="bankAccount"
                      items={list("bank_account").map((a) => [
                        a.number,
                        a.number + " · " + a.name,
                      ])}
                    />
                    <Input label="银行流水号" name="bankReference" />
                    <Input label="付款人" name="payer" />
                    <Money label="到账金额 CNY" name="amount" />
                    <Input
                      label="到账日期"
                      name="receivedOn"
                      type="date"
                      value={today()}
                    />
                    <Input label="银行凭据索引" name="evidence" />
                    <p className="steel-hint">
                      手工登记后须另一名财务核验，不会立即增加可用资金。
                    </p>
                  </>
                )}
                {modal.kind === "receipt_import" && (
                  <>
                    <Select
                      label="文件格式"
                      name="format"
                      value="csv"
                      items={[
                        ["csv", "CSV"],
                        ["json", "JSON"],
                      ]}
                    />
                    <F label="读取文件">
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 80000) {
                              setError("文件超过80KB，请拆分");
                              return;
                            }
                            const text = await file.text();
                            e.target.form.elements.content.value = text;
                          }
                        }}
                      />
                    </F>
                    <F label="流水内容">
                      <textarea
                        name="content"
                        required
                        rows="9"
                        placeholder={
                          "customerNumber,bankAccount,bankReference,payer,amount,receivedOn,evidence\n"
                        }
                      />
                    </F>
                    <p className="steel-hint">
                      按客户编号匹配本企业客户。每批最多200行、80KB；相同账户和流水号自动去重，任一行错误整批回滚。导入后由另一账号的财务核验。
                    </p>
                  </>
                )}
                {["receipt_confirm", "allocate"].includes(modal.kind) && (
                  <>
                    <Select
                      label={
                        modal.kind === "receipt_confirm"
                          ? "同时分配到订单（可选）"
                          : "本客户订单"
                      }
                      name="orderId"
                      required={modal.kind === "allocate"}
                      items={orderOptions.filter(
                        ([id]) =>
                          find(id)?.customerId === modal.item.customerId,
                      )}
                    />
                    <Money
                      label="本次分配金额 CNY"
                      name="amount"
                      value={modal.item.amount}
                      required={modal.kind === "allocate"}
                    />
                    <Select
                      label="款项用途"
                      name="purpose"
                      value="oldest_due"
                      items={[
                        ["oldest_due", "优先清偿本单已有应收"],
                        ["advance", "按客户约定保留为本单预收"],
                      ]}
                    />
                    <Input
                      label="专项预收约定依据（选择专项预收时填写）"
                      name="purposeReason"
                      required={false}
                    />
                    {modal.kind === "receipt_confirm" && (
                      <>
                        <Input
                          label="核验依据（银行原始记录等）"
                          name="evidence"
                        />
                        <Check />
                      </>
                    )}
                  </>
                )}
                {modal.kind === "exception" && (
                  <Input label="补偿措施、责任人及处理期限" name="measures" />
                )}
                {["refund", "receipt_refund", "adjustment"].includes(
                  modal.kind,
                ) && (
                  <Money
                    label={
                      modal.kind === "refund"
                        ? "退款金额 CNY"
                        : "应收减免金额 CNY"
                    }
                    name="amount"
                  />
                )}
                {["refund", "receipt_refund"].includes(modal.kind) && (
                  <Input label="原付款方收款账户标识" name="payee" />
                )}
                {modal.kind === "adjustment" && (
                  <Input label="质量扣款 / 费用调整凭据" name="evidence" />
                )}
                {modal.kind === "decide" && (
                  <>
                    <Select
                      label="审批决定"
                      name="decision"
                      items={[
                        ["approved", "批准"],
                        ["rejected", "驳回"],
                      ]}
                    />
                    <Check label="我已独立复核申请、凭据与相关风险" />
                  </>
                )}
                {modal.kind === "return_inspect" && (
                  <Select
                    label="验收结果"
                    name="decision"
                    items={[
                      ["accepted", "验收通过，恢复可售并记减应收"],
                      ["rejected", "验收未通过，保留待检库存"],
                    ]}
                  />
                )}
                {[
                  "release",
                  "return_receive",
                  "return_inspect",
                  "refund_pay",
                  "stock_adjust",
                ].includes(modal.kind) && (
                  <>
                    <Input
                      label={
                        {
                          release: "实际放行凭据",
                          return_receive: "退回实物凭据",
                          return_inspect: "验收凭据",
                          refund_pay: "实际退款流水及原路账户核验",
                          stock_adjust: "盘点入账凭据",
                        }[modal.kind]
                      }
                      name="evidence"
                    />
                    <Check />
                  </>
                )}
                {modal.kind === "members" && (
                  <>
                    <Input label="已注册员工账号" name="userId" />
                    <div className="steel-role-options">
                      {Object.entries(roles).map(([id, label]) => (
                        <label key={id}>
                          <input type="checkbox" name="roles" value={id} />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Select
                      label="授权状态"
                      name="active"
                      value="true"
                      items={[
                        ["true", "启用"],
                        ["false", "停用"],
                      ]}
                    />
                  </>
                )}
                {modal.kind === "rules" && (
                  <>
                    <input
                      type="hidden"
                      name="version"
                      value={data.company.version}
                    />
                    {[
                      ["overdueWarningDays", "逾期预警天数"],
                      ["overdueEscalationDays", "逾期升级天数"],
                      ["weightTolerancePercent", "重量容差（%）"],
                      ["steelShockPct", "钢价不利变动（%）"],
                      ["freightShockPct", "运费增加（%）"],
                    ].map(([k, label]) => (
                      <Input
                        key={k}
                        label={label}
                        name={k}
                        type="number"
                        value={
                          k === "weightTolerancePercent"
                            ? data.company.rules.weightToleranceBps / 100
                            : data.company.rules[k]
                        }
                        min="0"
                        step={
                          k.includes("Pct") || k === "weightTolerancePercent"
                            ? "0.01"
                            : "1"
                        }
                      />
                    ))}
                  </>
                )}
                {[
                  "credit",
                  "exception",
                  "amend",
                  "reverse_allocation",
                  "return",
                  "refund",
                  "adjustment",
                  "hold",
                  "decide",
                  "order_cancel",
                  "batch_cancel",
                  "members",
                  "rules",
                  "stock_count",
                  "reopen",
                  "receipt_refund",
                  "receipt_correction",
                  "receipt_unconfirm",
                  "approval_cancel",
                  "temporary_credit",
                ].includes(modal.kind) && (
                  <Input label="处理理由" name="reason" />
                )}
                <div className="steel-form-footer">
                  <button
                    className="btn outline"
                    type="button"
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={disabled}
                  >
                    {busy ? "处理中…" : "确认提交"}
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
