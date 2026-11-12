package com.induport.risk;

import static com.induport.common.BusinessException.*;
import static com.induport.common.CanonicalJson.*;
import static com.induport.common.Inputs.*;
import static com.induport.risk.RiskRepository.*;

import com.induport.auth.AuthService;
import com.induport.common.*;
import com.induport.trade.TradeService;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

@Service
public class RiskFlowService {
  private final RiskRepository r;
  private final MonitorService monitor;
  private final RiskMath math;

  public RiskFlowService(RiskRepository r, MonitorService monitor, RiskMath math) {
    this.r = r;
    this.monitor = monitor;
    this.math = math;
  }

  private Doc realTrade(Doc u, Object id) {
    Doc t = r.accessible(u, id, "trade"), p = r.get(t.get("profileId"));
    require(
        !t.b("isDemo")
            && !p.b("isDemo")
            && real(t.get("source"))
            && real(p.get("source"))
            && t.eq("direction", "sale")
            && !t.b("cancelled")
            && t.l("amountMinor") > 0
            && t.get("currency") != null,
        400,
        "仅支持未取消、金额币种明确的真实销售合同");
    return t;
  }

  private Doc operation(
      Doc u, String owner, String kind, Object businessKey, Doc input, Supplier<Doc> build) {
    String id = key(kind, owner, businessKey), hash = digest(input);
    Doc old = r.get(id);
    if (old != null) {
      require(old.eq("inputHash", hash), 409, "业务唯一键已用于不同内容");
      return old;
    }
    Doc row =
        build
            .get()
            .with(
                "id",
                id,
                "kind",
                kind,
                "controlVersion",
                2,
                "ownerId",
                owner,
                "businessKey",
                businessKey,
                "inputHash",
                hash,
                "createdAt",
                now());
    r.insert(row);
    r.audit(u, owner, kind + ".create", id, row);
    return row;
  }

  private static List<Doc> invoices(List<Doc> rows, Doc t) {
    return rows.stream()
        .filter(
            x ->
                x.eq("kind", "receivable")
                    && x.same("tradeId", t, "id")
                    && !x.eq("status", "voided"))
        .toList();
  }

  private static List<String> ids(List<Doc> rows) {
    return rows.stream().map(x -> x.s("id")).sorted().toList();
  }

  public Doc gate(Doc t, Doc order) {
    Doc p = r.get(t.get("profileId")),
        rules = r.rules(),
        account = r.get(accountId(t.get("profileId"), t.get("currency")));
    List<Doc> rows = r.rows(), invoices = invoices(rows, t);
    long billed = invoices.stream().mapToLong(x -> x.l("amountMinor")).sum(),
        paid = invoices.stream().mapToLong(x -> x.l("paidMinor")).sum();
    List<String> hard = new ArrayList<>(), soft = new ArrayList<>();
    long remaining = balance(t) == null ? 0 : balance(t);
    if (t.b("isDemo") || p.b("isDemo") || !real(t.get("source")) || !real(p.get("source")))
      hard.add("仅允许真实合同和客户档案");
    if (!t.eq("direction", "sale")
        || t.b("cancelled")
        || t.l("amountMinor") <= 0
        || t.get("currency") == null) hard.add("销售合同已取消或金额币种无效");
    if (blank(p.get("registration")) || blank(p.get("country"))) hard.add("客户主体身份资料未齐备");
    if (blank(p.get("financialEvidence")) || blank(p.get("performanceEvidence")))
      soft.add("客户财务或履约依据待复核");
    if (order == null
        || order.b("isSample")
        || !Objects.equals(t.get("platformOrderId"), order.get("id"))) hard.add("未关联真实平台销售订单");
    if (order != null) {
      if (!p.same("platformAccountId", order, "ownerId")) hard.add("客户档案未绑定该订单买家账号");
      if (List.of("运输中", "已完成").contains(order.s("status", ""))) hard.add("该订单已发货");
      if (t.l("amountMinor") != round(order.n("total") * 100)
          || !t.eq("currency", "USD")
          || t.n("quantity") != order.n("quantity")
          || !t.eq("unit", TradeService.unit(order))
          || !t.same("term", order, "term")) hard.add("风控合同与交易订单金额、币种、数量、单位或条款不一致");
    }
    if (t.l("receivedMinor") > paid) hard.add("历史核销尚未与应收逐笔对齐，须办理期初核销对账");
    if (billed != t.l("amountMinor")) hard.add("已登记应收金额须覆盖本单完整本金");
    if (t.eq("paymentMode", "credit")) {
      if (remaining > 0) {
        hard.addAll(creditProblems(account, t, p));
        if (!t.b("reserved")) hard.add("赊销合同尚未完成占额审批");
      } else if (account != null && account.b("frozen")) hard.add("客户授信已冻结");
      if (remaining > 0 && account != null && account.l("occupiedMinor") < remaining)
        hard.add("当前占额不足以覆盖未结清本金");
    } else if (t.eq("paymentMode", "cash")) {
      if (paid < t.l("amountMinor")) hard.add("现款合同尚未由已确认到账资金全额核销");
    } else hard.add("付款方式未明确");
    List<Doc> uncovered = new ArrayList<>(),
        overdueInvoices = new ArrayList<>(),
        overdueContracts = new ArrayList<>();
    for (Doc x : rows) {
      if (x.b("isDemo")
          || !x.same("ownerId", t, "ownerId")
          || !x.same("profileId", t, "profileId")
          || !x.same("currency", t, "currency")) continue;
      if (x.eq("kind", "trade")
          && !x.same("id", t, "id")
          && x.eq("direction", "sale")
          && x.eq("paymentMode", "credit")
          && !x.b("cancelled")
          && !x.b("reserved")
          && balance(x) != null
          && balance(x) > 0
          && !invoices(rows, x).isEmpty()) uncovered.add(x);
      if (x.eq("kind", "receivable")
          && !x.eq("status", "voided")
          && x.l("amountMinor") > x.l("paidMinor")
          && x.s("dueDate").compareTo(today()) < 0) overdueInvoices.add(x);
      if (x.eq("kind", "trade")
          && x.eq("paymentMode", "credit")
          && !x.b("cancelled")
          && balance(x) != null
          && balance(x) > 0
          && x.get("dueDate") != null
          && x.s("dueDate").compareTo(today()) < 0) overdueContracts.add(x);
    }
    if (!uncovered.isEmpty()) hard.add("同客户存在尚未获授信覆盖的其他应收");
    long overdueMax = 0;
    for (Doc x : overdueInvoices) overdueMax = Math.max(overdueMax, days(x.s("dueDate"), today()));
    for (Doc x : overdueContracts) overdueMax = Math.max(overdueMax, days(x.s("dueDate"), today()));
    if (overdueMax > 0) soft.add("该客户存在逾期余额，最长" + overdueMax + "天");
    Doc control = monitor.control(t),
        review = monitor.review(rows, p),
        security = monitor.security(t, control);
    if (t.eq("paymentMode", "credit") && remaining > 0) hard.addAll(review.strings("hard"));
    if (rows.stream()
        .anyMatch(
            x ->
                List.of("control_change", "security_change").contains(x.s("kind", ""))
                    && x.same("tradeId", t, "id")
                    && x.eq("status", "pending"))) hard.add("实货或保障台账变更待独立复核");
    if (control != null) {
      Doc product = order == null ? null : r.db.get("products", order.get("productId"));
      if (control.get("grade") != null
          && product != null
          && product.get("grade") != null
          && !normalize(control.s("grade")).equals(normalize(product.s("grade"))))
        hard.add("实货台账牌号与平台商品不一致");
      if (control.get("inventoryQuantity") != null
          && control.n("inventoryQuantity") < t.n("quantity")) hard.add("登记库存数量不足本次整单装运");
      if (control.get("minPrepaymentPct") != null
          && paid < Math.ceil(t.n("amountMinor") * control.n("minPrepaymentPct") / 100))
        hard.add("实际核销回款未达到约定预付比例");
      if (blank(control.get("titleEvidence")) || blank(control.get("qualityEvidence")))
        soft.add("实货台账的货权或质检依据待补齐");
      if (control.eq("securityMode", "instruments")
          && (security.get("securedMinor") == null
              || security.l("securedMinor") < security.l("exposureMinor")))
        soft.add("保障未完整覆盖剩余敞口，需复核期限及可执行性");
    }
    Doc evaluation = math.evaluate(t, p, rules, account, control);
    if (!evaluation.strings("missing").isEmpty())
      soft.add("测算输入待补齐：" + String.join("、", evaluation.strings("missing")));
    if (evaluation.get("stressedMarginMinor") != null && evaluation.l("stressedMarginMinor") < 0)
      soft.add("压力测算出现亏损");
    List<Doc> allocations =
        rows.stream()
            .filter(
                x ->
                    x.eq("kind", "flow_approval")
                        && x.eq("type", "allocation")
                        && x.eq("status", "approved")
                        && x.get("reversedBy") == null
                        && x.rows("items").stream()
                            .anyMatch(
                                i -> invoices.stream().anyMatch(v -> v.same("id", i, "invoiceId"))))
            .toList();
    Doc state =
        Doc.of(
            "workflowPolicy",
            WORKFLOW,
            "overdueMaxDays",
            overdueMax,
            "control",
            control,
            "review",
            review,
            "security",
            security,
            "trade",
            Doc.of(
                "id",
                t.get("id"),
                "version",
                t.get("version"),
                "reserved",
                t.b("reserved"),
                "cancelled",
                t.b("cancelled"),
                "receivedMinor",
                t.get("receivedMinor"),
                "releasedMinor",
                t.get("releasedMinor")),
            "profile",
            p,
            "account",
            account,
            "policy",
            rules,
            "invoices",
            invoices.stream()
                .sorted(Comparator.comparing(x -> x.s("id")))
                .map(
                    x ->
                        Doc.of(
                            "id",
                            x.get("id"),
                            "amountMinor",
                            x.get("amountMinor"),
                            "paidMinor",
                            x.get("paidMinor"),
                            "version",
                            x.get("version"),
                            "status",
                            x.get("status")))
                .toList(),
            "allocations",
            ids(allocations),
            "order",
            order == null
                ? null
                : Doc.of(
                    "id",
                    order.get("id"),
                    "status",
                    order.get("status"),
                    "total",
                    order.get("total"),
                    "quantity",
                    order.get("quantity"),
                    "unit",
                    TradeService.unit(order),
                    "term",
                    order.get("term")),
            "uncoveredOther",
            ids(uncovered),
            "overdueInvoices",
            ids(overdueInvoices),
            "overdueContracts",
            ids(overdueContracts));
    return Doc.of(
        "hard",
        new ArrayList<>(new LinkedHashSet<>(hard)),
        "soft",
        new ArrayList<>(new LinkedHashSet<>(soft)),
        "billedMinor",
        billed,
        "paidMinor",
        paid,
        "remainingMinor",
        balance(t),
        "currency",
        t.get("currency"),
        "state",
        state,
        "fingerprint",
        digest(state),
        "checkedAt",
        now(),
        "assessment",
        evaluation);
  }

  public Doc consumeShipment(Doc u, Doc order, String id) {
    require(id != null && !id.isBlank(), 409, "进入运输中前须选择有效的独立发货审批");
    Doc a = r.accessible(u, id, "flow_approval");
    require(
        a.eq("type", "shipment")
            && a.eq("status", "approved")
            && a.same("orderId", order, "id")
            && a.get("consumedAt") == null,
        409,
        "发货审批无效、已使用或不属于该订单");
    require(Instant.parse(a.s("expiresAt")).isAfter(Instant.now()), 409, "发货审批已到期，请重新申请");
    Doc t = r.accessible(u, a.get("tradeId"), "trade"),
        supplier = r.db.get("suppliers", order.get("supplierId"));
    require(supplier != null && supplier.same("ownerId", t, "ownerId"), 409, "发货合同所属账号必须为该订单供应商");
    Doc gate = gate(t, order);
    require(gate.strings("hard").isEmpty(), 409, String.join("；", gate.strings("hard")));
    require(
        gate.eq("fingerprint", a.d("gateSnapshot").get("fingerprint")),
        409,
        "余额、规则、档案或订单已变化，须重新申请发货复核");
    require(gate.strings("soft").isEmpty() || a.b("exceptionApproved"), 409, "存在未处理风险提示，须重新复核");
    Doc result = a.with("consumedAt", now(), "consumedBy", u.get("id"));
    r.put(result);
    r.audit(
        u,
        t.s("ownerId"),
        "shipment.consume",
        id,
        Doc.of("approvalId", id, "orderId", order.get("id"), "gateSnapshot", gate));
    return result;
  }

  public boolean shipped(Doc t) {
    Doc o = r.db.get("orders", t.get("platformOrderId"));
    return o != null && List.of("运输中", "已完成").contains(o.s("status", ""));
  }

  public Doc view(Doc u) {
    List<Doc> rows = r.rows().stream().filter(x -> !x.b("isDemo") && owns(u, x)).toList(),
        exposures = new ArrayList<>();
    for (Doc t : rows)
      if (t.eq("kind", "trade")
          && t.eq("direction", "sale")
          && real(t.get("source"))
          && rows.stream().anyMatch(p -> p.same("id", t, "profileId") && real(p.get("source")))) {
        List<Doc> invoices = invoices(rows, t);
        long billed = invoices.stream().mapToLong(x -> x.l("amountMinor")).sum(),
            paid = invoices.stream().mapToLong(x -> x.l("paidMinor")).sum();
        exposures.add(
            Doc.of(
                "tradeId",
                t.get("id"),
                "profileId",
                t.get("profileId"),
                "currency",
                t.get("currency"),
                "contractMinor",
                t.get("amountMinor"),
                "unbilledMinor",
                unbilled(t, billed),
                "receivableMinor",
                billed - paid,
                "allocatedMinor",
                paid,
                "uncoveredMinor",
                t.b("reserved") ? Long.valueOf(0) : balance(t),
                "legacyReceivedMinor",
                Math.max(0, t.l("receivedMinor") - paid),
                "occupiedMinor",
                t.b("reserved") ? balance(t) : Long.valueOf(0),
                "stage",
                t.b("cancelled") ? "已取消" : shipped(t) ? "已发货" : "发货前承诺",
                "note",
                "未开票承诺转为应收不新增占额；成本和压力损失不重复加入本金"));
      }
    return Doc.of(
        "exposures",
        exposures,
        "receipts",
        rows.stream().filter(x -> x.eq("kind", "cash_receipt")).toList(),
        "invoices",
        rows.stream()
            .filter(x -> x.eq("kind", "receivable"))
            .map(
                x ->
                    x.with(
                        "remainingMinor",
                        x.eq("status", "voided") ? 0 : x.l("amountMinor") - x.l("paidMinor"),
                        "overdueDays",
                        !x.eq("status", "voided") && x.l("amountMinor") > x.l("paidMinor")
                            ? Math.max(0, days(x.s("dueDate"), today()))
                            : 0))
            .toList(),
        "approvals",
        rows.stream().filter(x -> x.eq("kind", "flow_approval")).toList(),
        "cashLedger",
        rows.stream().filter(x -> x.eq("kind", "cash_ledger")).toList());
  }

  public Doc invoice(Doc u, Doc b) {
    Doc t = realTrade(u, b.get("tradeId"));
    String number = normalize(text(b.get("invoiceNumber"), "应收编号", 100)),
        issued = pastDay(b.get("issuedDate"), "开票日期"),
        due = day(b.get("dueDate"));
    long amount = positive(b.get("amount"));
    require(due != null && due.compareTo(issued) >= 0, 400, "到期日须不早于开票日期");
    Doc input =
        Doc.of(
            "tradeId",
            t.get("id"),
            "invoiceNumber",
            number,
            "amountMinor",
            amount,
            "issuedDate",
            issued,
            "dueDate",
            due,
            "evidenceRef",
            text(b.get("evidenceRef"), "应收依据索引", 1000));
    return operation(
        u,
        t.s("ownerId"),
        "receivable",
        number,
        input,
        () -> {
          long billed = invoices(r.rows(), t).stream().mapToLong(x -> x.l("amountMinor")).sum();
          require(billed + amount <= t.l("amountMinor"), 409, "应收登记总额不能超过合同本金");
          return input.with(
              "profileId",
              t.get("profileId"),
              "currency",
              t.get("currency"),
              "paidMinor",
              0,
              "status",
              "open",
              "version",
              1,
              "source",
              "manual",
              "createdBy",
              u.get("id"));
        });
  }

  public Doc receipt(Doc u, Doc b) {
    Doc p = r.real(u, b.get("profileId"), "profile");
    require(p.eq("partyType", "customer"), 400, "到账记录须关联真实客户");
    String account = normalize(text(b.get("bankAccountRef"), "本方收款账户别名", 100)),
        reference = normalize(text(b.get("bankReference"), "银行唯一流水号", 150));
    Doc input =
        Doc.of(
            "profileId",
            p.get("id"),
            "bankAccountRef",
            account,
            "bankReference",
            reference,
            "amountMinor",
            positive(b.get("amount")),
            "currency",
            choice(b.get("currency"), RiskMath.CURRENCIES, "到账币种"),
            "receivedDate",
            pastDay(b.get("receivedDate"), "到账日期"),
            "payerName",
            text(b.get("payerName"), "付款方名称", 150),
            "evidenceRef",
            text(b.get("evidenceRef"), "到账凭据索引", 1000),
            "source",
            choice(b.get("source"), List.of("manual", "import"), "来源"));
    return operation(
        u,
        p.s("ownerId"),
        "cash_receipt",
        List.of(account, reference),
        input,
        () ->
            input.with(
                "status", "pending", "allocatedMinor", 0, "version", 1, "recordedBy", u.get("id")));
  }

  public Doc confirm(Doc u, String id, Doc b) {
    AuthService.admin(u);
    Doc receipt = r.accessible(u, id, "cash_receipt");
    String reason = text(b.get("reason"), "到账确认理由", 1000),
        evidence = text(b.get("evidenceRef"), "独立核验凭据索引", 1000);
    require(!receipt.same("recordedBy", u, "id"), 403, "到账录入人与确认人必须分离");
    require(b.b("fundsVerified"), 400, "须明确确认资金已到账，并核对付款主体和币种");
    if (receipt.eq("status", "confirmed")) {
      require(
          receipt.eq("confirmationReason", reason) && receipt.eq("confirmationEvidence", evidence),
          409,
          "到账确认记录不可覆盖");
      return receipt;
    }
    require(receipt.eq("status", "pending"), 409, "该到账记录不可确认");
    Doc result =
        receipt.with(
            "status",
            "confirmed",
            "confirmedBy",
            u.get("id"),
            "confirmedAt",
            now(),
            "confirmationReason",
            reason,
            "confirmationEvidence",
            evidence,
            "version",
            receipt.l("version") + 1);
    r.put(result);
    r.audit(u, receipt.s("ownerId"), "cash_receipt.confirm", id, result);
    return result;
  }

  private List<Doc> items(Doc b) {
    List<Doc> input = b.rows("items");
    require(!input.isEmpty() && input.size() <= 50, 400, "每批须分配到1–50笔应收");
    List<Doc> out = new ArrayList<>();
    Set<String> ids = new HashSet<>();
    for (Doc x : input) {
      String id = text(x.get("invoiceId"), "应收编号", 191);
      require(ids.add(id), 400, "同一应收请合并分配金额");
      out.add(Doc.of("invoiceId", id, "amountMinor", positive(x.get("amount"))));
    }
    return out;
  }

  public Doc request(Doc u, String type, Doc b) {
    require(
        List.of(
                "allocation",
                "opening_match",
                "reversal",
                "receipt_void",
                "invoice_void",
                "shipment")
            .contains(type),
        404,
        "接口不存在");
    Doc input = Doc.of("type", type, "reason", text(b.get("reason"), "申请理由", 1000));
    String owner;
    switch (type) {
      case "opening_match" -> {
        Doc t = realTrade(u, b.get("tradeId"));
        require(t.b("reserved"), 409, "期初对账仅适用于已占额的历史赊销合同");
        owner = t.s("ownerId");
        List<Doc> items = items(b);
        for (Doc i : items)
          require(
              r.accessible(u, i.get("invoiceId"), "receivable").same("tradeId", t, "id"),
              400,
              "期初对账须关联同一合同");
        input.putAll(
            Doc.of(
                "tradeId",
                t.get("id"),
                "evidenceRef",
                text(b.get("evidenceRef"), "历史对账依据", 1000),
                "items",
                items));
      }
      case "allocation" -> {
        Doc receipt = r.accessible(u, b.get("receiptId"), "cash_receipt");
        require(receipt.eq("status", "confirmed"), 409, "请先完成到账独立确认");
        owner = receipt.s("ownerId");
        List<Doc> items = items(b);
        for (Doc i : items) {
          Doc inv = r.accessible(u, i.get("invoiceId"), "receivable");
          require(
              inv.eq("ownerId", owner)
                  && inv.same("profileId", receipt, "profileId")
                  && inv.same("currency", receipt, "currency"),
              400,
              "不允许跨账号、客户或币种核销");
        }
        input.putAll(Doc.of("receiptId", receipt.get("id"), "items", items));
      }
      case "reversal" -> {
        Doc a = r.accessible(u, b.get("allocationId"), "flow_approval");
        require(
            List.of("allocation", "opening_match").contains(a.s("type", ""))
                && a.eq("status", "approved")
                && a.get("reversedBy") == null,
            409,
            "原核销批次不可冲销");
        owner = a.s("ownerId");
        input.put("allocationId", a.get("id"));
      }
      case "receipt_void" -> {
        Doc a = r.accessible(u, b.get("receiptId"), "cash_receipt");
        owner = a.s("ownerId");
        input.put("receiptId", a.get("id"));
      }
      case "invoice_void" -> {
        Doc a = r.accessible(u, b.get("invoiceId"), "receivable");
        owner = a.s("ownerId");
        input.put("invoiceId", a.get("id"));
      }
      default -> {
        Doc t = realTrade(u, b.get("tradeId")),
            order = r.db.get("orders", t.get("platformOrderId"));
        require(order != null && order.eq("status", "待装运"), 409, "须关联处于待装运状态的真实销售订单");
        owner = t.s("ownerId");
        input.putAll(
            Doc.of(
                "tradeId",
                t.get("id"),
                "orderId",
                order.get("id"),
                "contractRef",
                text(b.get("contractRef"), "合同确认凭据", 1000),
                "titleRef",
                text(b.get("titleRef"), "货权凭据", 1000),
                "qualityRef",
                text(b.get("qualityRef"), "质检与装运依据", 1000),
                "requestGate",
                gate(t, order)));
      }
    }
    String business = text(b.get("businessKey"), "业务唯一键", 100);
    return operation(
        u,
        owner,
        "flow_approval",
        List.of(type, business),
        input.without("requestGate"),
        () ->
            input.with(
                "requestedBy", u.get("id"), "status", "pending", "rulesSnapshot", r.rules()));
  }

  private void allocation(Doc u, Doc a) {
    Doc receipt = r.accessible(u, a.get("receiptId"), "cash_receipt");
    require(receipt.eq("status", "confirmed"), 409, "到账记录未经独立确认或已作废");
    long total = a.rows("items").stream().mapToLong(x -> x.l("amountMinor")).sum();
    require(total <= receipt.l("amountMinor") - receipt.l("allocatedMinor"), 409, "超过该笔到账的未分配金额");
    Map<String, Long> byTrade = new LinkedHashMap<>();
    for (Doc item : a.rows("items")) {
      Doc inv = r.accessible(u, item.get("invoiceId"), "receivable");
      long amount = item.l("amountMinor");
      require(
          !inv.eq("status", "voided")
              && inv.same("profileId", receipt, "profileId")
              && inv.same("currency", receipt, "currency")
              && inv.same("ownerId", receipt, "ownerId")
              && amount <= inv.l("amountMinor") - inv.l("paidMinor"),
          409,
          "应收归属、客户、币种不符或分配超额");
      Doc t = realTrade(u, inv.get("tradeId"));
      require(amount <= balance(t), 409, "核销超出合同剩余本金");
      long paid = inv.l("paidMinor") + amount;
      r.put(
          inv.with(
              "paidMinor",
              paid,
              "status",
              paid == inv.l("amountMinor") ? "settled" : "open",
              "version",
              inv.l("version") + 1));
      r.put(t.with("receivedMinor", t.l("receivedMinor") + amount, "version", t.l("version") + 1));
      byTrade.merge(t.s("id"), amount, Math::addExact);
    }
    for (var entry : byTrade.entrySet()) {
      Doc t = r.get(entry.getKey());
      long amount = entry.getValue();
      if (t.b("reserved")) {
        Doc c = r.get(accountId(t.get("profileId"), t.get("currency")));
        require(c != null && c.l("occupiedMinor") >= amount, 409, "额度余额不一致，请先对账");
        r.put(
            c.with(
                "occupiedMinor",
                new Money(t.s("currency"), c.l("occupiedMinor"))
                    .subtract(new Money(t.s("currency"), amount))
                    .minor()));
        r.insert(
            Doc.of(
                "id",
                key("ledger", a.get("id"), t.get("id")),
                "kind",
                "ledger",
                "ownerId",
                t.get("ownerId"),
                "profileId",
                t.get("profileId"),
                "tradeId",
                t.get("id"),
                "currency",
                t.get("currency"),
                "amountMinor",
                -amount,
                "action",
                "allocation",
                "approvalId",
                a.get("id"),
                "receiptId",
                receipt.get("id"),
                "createdAt",
                now()));
      }
    }
    r.put(
        receipt.with(
            "allocatedMinor",
            receipt.l("allocatedMinor") + total,
            "version",
            receipt.l("version") + 1));
    cashLedger(
        a,
        "allocation",
        total,
        receipt.s("currency"),
        Doc.of("receiptId", receipt.get("id"), "items", a.get("items")));
  }

  private void cashLedger(Doc a, String action, long amount, String currency, Doc extra) {
    r.insert(
        Doc.of(
                "id",
                key("cash_ledger", a.get("ownerId"), a.get("id")),
                "kind",
                "cash_ledger",
                "ownerId",
                a.get("ownerId"),
                "approvalId",
                a.get("id"),
                "action",
                action,
                "amountMinor",
                amount,
                "currency",
                currency,
                "createdAt",
                now())
            .withExtra(extra));
  }

  private void reverse(Doc u, Doc a) {
    Doc original = r.accessible(u, a.get("allocationId"), "flow_approval");
    require(
        List.of("allocation", "opening_match").contains(original.s("type", ""))
            && original.eq("status", "approved")
            && original.get("reversedBy") == null,
        409,
        "仅能完整冲销尚未冲销的已批准核销批次");
    long total = original.rows("items").stream().mapToLong(x -> x.l("amountMinor")).sum();
    if (original.eq("type", "opening_match")) {
      for (Doc i : original.rows("items")) {
        Doc inv = r.accessible(u, i.get("invoiceId"), "receivable");
        require(inv.l("paidMinor") >= i.l("amountMinor"), 409, "期初核销余额不一致");
        r.put(
            inv.with(
                "paidMinor",
                inv.l("paidMinor") - i.l("amountMinor"),
                "status",
                "open",
                "version",
                inv.l("version") + 1));
      }
      r.put(original.with("reversedBy", a.get("id")));
      cashLedger(
          a,
          "legacy_opening_unmatch",
          -total,
          original.s("currency"),
          Doc.of("originalApprovalId", original.get("id")));
      return;
    }
    Doc receipt = r.accessible(u, original.get("receiptId"), "cash_receipt");
    require(receipt.eq("status", "confirmed"), 409, "原到账状态异常，须先对账");
    Map<String, Long> byTrade = new LinkedHashMap<>();
    for (Doc item : original.rows("items")) {
      Doc inv = r.accessible(u, item.get("invoiceId"), "receivable"),
          t = r.accessible(u, inv.get("tradeId"), "trade");
      long amount = item.l("amountMinor");
      require(inv.l("paidMinor") >= amount && t.l("receivedMinor") >= amount, 409, "原核销余额不一致");
      r.put(
          inv.with(
              "paidMinor",
              inv.l("paidMinor") - amount,
              "status",
              "open",
              "version",
              inv.l("version") + 1));
      r.put(t.with("receivedMinor", t.l("receivedMinor") - amount, "version", t.l("version") + 1));
      byTrade.merge(t.s("id"), amount, Math::addExact);
    }
    require(receipt.l("allocatedMinor") >= total, 409, "到账分配余额不一致");
    for (var entry : byTrade.entrySet()) {
      Doc t = r.get(entry.getKey());
      long amount = entry.getValue();
      if (t.b("reserved")) {
        Doc c = r.get(accountId(t.get("profileId"), t.get("currency")));
        require(c != null, 409, "原授信账不存在");
        long occupied = Math.addExact(c.l("occupiedMinor"), amount);
        r.put(
            c.with(
                "occupiedMinor",
                occupied,
                "frozen",
                c.b("frozen") || occupied > c.l("limitMinor")));
        r.insert(
            Doc.of(
                "id",
                key("ledger", a.get("id"), t.get("id")),
                "kind",
                "ledger",
                "ownerId",
                t.get("ownerId"),
                "profileId",
                t.get("profileId"),
                "tradeId",
                t.get("id"),
                "currency",
                t.get("currency"),
                "amountMinor",
                amount,
                "action",
                "allocation_reversal",
                "approvalId",
                a.get("id"),
                "originalApprovalId",
                original.get("id"),
                "createdAt",
                now()));
      }
    }
    r.put(
        receipt.with(
            "allocatedMinor",
            receipt.l("allocatedMinor") - total,
            "version",
            receipt.l("version") + 1));
    r.put(original.with("reversedBy", a.get("id")));
    cashLedger(
        a,
        "allocation_reversal",
        -total,
        receipt.s("currency"),
        Doc.of("receiptId", receipt.get("id"), "originalApprovalId", original.get("id")));
  }

  @com.induport.integration.BusinessEvent("cash.allocated")
  public Doc decide(Doc u, String id, Doc b) {
    AuthService.admin(u);
    Doc a = r.accessible(u, id, "flow_approval");
    String decision = choice(b.get("decision"), List.of("approved", "rejected"), "审批决定"),
        reason = text(b.get("reason"), "审批理由", 1000);
    if (!a.eq("status", "pending")) {
      require(a.eq("status", decision) && a.eq("decisionReason", reason), 409, "审批已处理，不可覆盖");
      return a;
    }
    require(!a.same("requestedBy", u, "id"), 403, "申请人与审批人必须分离");
    Doc extra = new Doc();
    if (decision.equals("approved"))
      switch (a.s("type")) {
        case "allocation" -> allocation(u, a);
        case "reversal" -> reverse(u, a);
        case "opening_match" -> {
          Doc t = realTrade(u, a.get("tradeId"));
          long paid = invoices(r.rows(), t).stream().mapToLong(x -> x.l("paidMinor")).sum(),
              total = a.rows("items").stream().mapToLong(x -> x.l("amountMinor")).sum();
          require(t.b("reserved") && total <= t.l("receivedMinor") - paid, 409, "对账金额超过历史未关联核销");
          for (Doc i : a.rows("items")) {
            Doc inv = r.accessible(u, i.get("invoiceId"), "receivable");
            require(
                inv.same("tradeId", t, "id")
                    && !inv.eq("status", "voided")
                    && i.l("amountMinor") <= inv.l("amountMinor") - inv.l("paidMinor"),
                409,
                "期初应收余额不符");
            long current = inv.l("paidMinor") + i.l("amountMinor");
            r.put(
                inv.with(
                    "paidMinor",
                    current,
                    "status",
                    current == inv.l("amountMinor") ? "settled" : "open",
                    "version",
                    inv.l("version") + 1));
          }
          cashLedger(
              a, "legacy_opening_match", total, t.s("currency"), Doc.of("items", a.get("items")));
          extra.put("currency", t.get("currency"));
        }
        case "receipt_void" -> {
          Doc receipt = r.accessible(u, a.get("receiptId"), "cash_receipt");
          require(
              receipt.l("allocatedMinor") == 0 && !receipt.eq("status", "voided"),
              409,
              "须先完整冲销分配，到账记录才能作废");
          r.put(
              receipt.with(
                  "status", "voided", "voidApprovalId", id, "version", receipt.l("version") + 1));
        }
        case "invoice_void" -> {
          Doc inv = r.accessible(u, a.get("invoiceId"), "receivable"),
              t = r.accessible(u, inv.get("tradeId"), "trade");
          require(
              inv.l("paidMinor") == 0 && !inv.eq("status", "voided") && !shipped(t),
              409,
              "已收款或已发货应收不能直接作废，须办理退货/贷项流程");
          r.put(
              inv.with("status", "voided", "voidApprovalId", id, "version", inv.l("version") + 1));
        }
        case "shipment" -> {
          Doc t = realTrade(u, a.get("tradeId")), order = r.db.get("orders", a.get("orderId"));
          require(order != null && order.eq("status", "待装运"), 409, "订单已不处于待装运状态");
          Doc gate = gate(t, order);
          require(gate.strings("hard").isEmpty(), 409, String.join("；", gate.strings("hard")));
          require(
              b.b("counterpartyVerified") && b.b("titleVerified") && b.b("qualityVerified"),
              400,
              "须分别核验客户主体、货权和质检装运依据");
          boolean exception = b.b("exceptionApproved");
          require(
              gate.strings("soft").isEmpty() || exception,
              409,
              "存在风险提示，须明确例外审批并记录补偿措施：" + String.join("；", gate.strings("soft")));
          extra =
              Doc.of(
                  "gateSnapshot",
                  gate,
                  "exceptionApproved",
                  exception,
                  "exceptionReason",
                  exception ? text(b.get("exceptionReason"), "例外依据", 1000) : null,
                  "compensatingControls",
                  exception ? text(b.get("compensatingControls"), "补偿控制措施", 1000) : null,
                  "verificationEvidence",
                  text(b.get("verificationEvidence"), "审批核验依据", 1000),
                  "expiresAt",
                  Instant.now().plusSeconds(24 * 3600).toString());
        }
        default -> throw fail(400, "审批类型无效");
      }
    Doc result =
        a.withExtra(extra)
            .with(
                "status",
                decision,
                "decidedBy",
                u.get("id"),
                "decidedAt",
                now(),
                "decisionReason",
                reason,
                "decisionRulesSnapshot",
                r.rules(),
                "decisionWorkflowPolicy",
                WORKFLOW);
    r.put(result);
    r.audit(u, a.s("ownerId"), "flow_approval." + decision, id, result);
    return result;
  }

  public Doc freeze(Doc u, String id, Doc b) {
    AuthService.admin(u);
    Doc c = r.accessible(u, id, "credit");
    String reason = text(b.get("reason"), "冻结理由", 1000);
    Doc result =
        c.with(
            "frozen",
            true,
            "freezeReason",
            reason,
            "frozenAt",
            now(),
            "version",
            c.l("version") + 1);
    r.put(result);
    r.audit(
        u,
        c.s("ownerId"),
        "credit.freeze",
        id,
        Doc.of("before", c, "after", result, "reason", reason));
    return result;
  }

  public Doc releaseView(Doc u, String id) {
    Doc order = r.db.get("orders", id),
        supplier = order == null ? null : r.db.get("suppliers", order.get("supplierId"));
    require(order != null && !order.b("isSample") && owns(u, supplier), 404, "订单不存在或无权访问供应商发货依据");
    Doc t =
        r.rows().stream()
            .filter(
                x ->
                    x.eq("kind", "trade")
                        && !x.b("isDemo")
                        && !x.b("cancelled")
                        && x.eq("direction", "sale")
                        && x.same("platformOrderId", order, "id")
                        && supplier != null
                        && x.same("ownerId", supplier, "ownerId"))
            .findFirst()
            .orElse(null);
    if (t == null)
      return Doc.of("gate", null, "approvals", List.of(), "message", "请在风控工作台以供应商账号关联本单销售合同");
    Doc gate = gate(t, order);
    List<Doc> approvals =
        r.rows().stream()
            .filter(
                x ->
                    x.eq("kind", "flow_approval")
                        && x.eq("type", "shipment")
                        && x.same("tradeId", t, "id")
                        && x.eq("status", "approved")
                        && x.get("consumedAt") == null
                        && Instant.parse(x.s("expiresAt")).isAfter(Instant.now()))
            .map(
                x ->
                    Doc.of(
                        "id",
                        x.get("id"),
                        "requestReference",
                        x.get("businessKey") instanceof List<?> l ? l.get(1) : x.get("businessKey"),
                        "expiresAt",
                        x.get("expiresAt"),
                        "decidedBy",
                        x.get("decidedBy"),
                        "valid",
                        x.d("gateSnapshot").eq("fingerprint", gate.get("fingerprint"))))
            .toList();
    return Doc.of("tradeId", t.get("id"), "gate", gate, "approvals", approvals);
  }

  private static Long unbilled(Doc t, long billed) {
    if (t.b("cancelled")) return 0L;
    if (t.get("amountMinor") == null) return null;
    return t.l("amountMinor") - billed;
  }

  private static String normalize(String s) {
    return Normalizer.normalize(s, Normalizer.Form.NFKC).trim().toUpperCase(Locale.ROOT);
  }
}
