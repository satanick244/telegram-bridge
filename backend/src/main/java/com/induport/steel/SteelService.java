package com.induport.steel;

import static com.induport.common.BusinessException.*;
import static com.induport.common.CanonicalJson.*;
import static com.induport.common.Inputs.*;

import com.induport.common.*;
import com.induport.persistence.DocumentStore;
import com.induport.risk.RiskRepository;
import java.math.*;
import java.time.*;
import java.util.*;
import java.util.stream.*;
import org.springframework.stereotype.Service;

/** Company-scoped steel sales. All calls run inside Transactions.write's database lock. */
@Service
public class SteelService {
  private static final String BUCKET = "steel_records";
  private static final long MAX = 9007199254740991L;
  private final DocumentStore db;
  private final SteelMapper mapper;
  private final RiskRepository audit;

  public SteelService(DocumentStore db, SteelMapper mapper, RiskRepository audit) {
    this.db = db;
    this.mapper = mapper;
    this.audit = audit;
  }

  private static String date() {
    return LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
  }

  private static String ref(String kind, Object company, Object key) {
    return CanonicalJson.key("steel-" + kind, company, key);
  }

  private static long sum(List<Doc> rows, String field) {
    long n = 0;
    for (Doc d : rows) n = Math.addExact(n, d.l(field));
    require(Math.abs(n) <= MAX, 409, "合计超出支持精度");
    return n;
  }

  private static long quantity(Object value) {
    String s =
        value instanceof Number
            ? new BigDecimal(value.toString()).stripTrailingZeros().toPlainString()
            : String.valueOf(value);
    require(s.matches("\\d{1,7}(\\.\\d{1,6})?"), 400, "吨数须为非负数，最多六位小数");
    long n = new BigDecimal(s).movePointRight(6).longValueExact();
    require(n > 0, 400, "吨数须大于零");
    return n;
  }

  private static long price(long grams, long unitPrice) {
    BigDecimal n =
        BigDecimal.valueOf(grams)
            .multiply(BigDecimal.valueOf(unitPrice))
            .divide(BigDecimal.valueOf(1000000), 0, RoundingMode.HALF_UP);
    require(n.signum() >= 0 && n.compareTo(BigDecimal.valueOf(MAX)) <= 0, 400, "金额超出支持精度");
    return n.longValueExact();
  }

  private static long fraction(long amount, long qty, long total) {
    return BigDecimal.valueOf(amount)
        .multiply(BigDecimal.valueOf(qty))
        .divide(BigDecimal.valueOf(total), 0, RoundingMode.HALF_UP)
        .longValueExact();
  }

  private static long integer(Doc b, String k, int min, int max) {
    double n = number(b.get(k), k, min, max);
    require(n == Math.rint(n), 400, k + "须为整数");
    return (long) n;
  }

  private static String reason(Doc b) {
    return text(b.get("reason"), "处理理由", 1000);
  }

  private static void checked(Doc b) {
    require(b.b("checked"), 400, "请明确确认已核验原始凭据与业务事实");
  }

  public Doc createCompany(Doc user, Doc b) {
    require(user != null && !user.b("isDemo"), 403, "请使用独立业务账号创建企业");
    fields(b, List.of("name", "dataClass", "businessKey"));
    String mode = choice(b.get("dataClass"), List.of("test", "real"), "企业数据性质");
    String id = ref("company", user.s("id"), mode);
    Doc old = db.get(BUCKET, id);
    if (old != null) {
      require(old.eq("name", text(b.get("name"), "本方公司名称", 120)), 409, "已有同性质企业，请切换使用");
      return old;
    }
    require(!user.eq("role", "buyer"), 403, "请使用供应商或管理员账号建立内部企业；员工由负责人授权加入");
    Doc company =
        Doc.of(
            "id",
            id,
            "ownerId",
            id,
            "kind",
            "company",
            "name",
            text(b.get("name"), "本方公司名称", 120),
            "accountOwner",
            user.get("id"),
            "dataClass",
            choice(b.get("dataClass"), List.of("test", "real"), "企业数据性质"),
            "currency",
            "CNY",
            "version",
            1,
            "createdAt",
            now(),
            "rules",
            Doc.of(
                "version",
                1,
                "overdueWarningDays",
                1,
                "overdueEscalationDays",
                7,
                "steelShockPct",
                5,
                "fxShockPct",
                3,
                "freightShockPct",
                10,
                "weightToleranceBps",
                0,
                "calibrated",
                false,
                "automaticPayment",
                false,
                "automaticRelease",
                false));
    db.insert(BUCKET, company);
    db.insert(
        BUCKET,
        Doc.of(
            "id",
            ref("member", id, user.s("id")),
            "ownerId",
            id,
            "kind",
            "member",
            "userId",
            user.get("id"),
            "displayName",
            user.get("displayName"),
            "roles",
            List.of("business", "manager"),
            "active",
            true,
            "createdAt",
            now()));
    audit.audit(user, user.s("id"), "steel.company.create", id, company);
    return company;
  }

  public Doc view(Doc user, String companyId) {
    require(user != null, 401, "请先登录");
    if (user.b("isDemo")) return demo();
    List<Doc> companies =
        mapper.memberships(user.s("id")).stream()
            .map(Doc::parse)
            .filter(x -> x.b("active"))
            .map(m -> db.get(BUCKET, m.s("ownerId")))
            .filter(Objects::nonNull)
            .map(c -> c.without("rules"))
            .toList();
    if (companyId == null && companies.isEmpty())
      return Doc.of("companies", companies, "company", null, "records", List.of());
    if (companyId == null) companyId = companies.get(0).s("id");
    Context c = new Context(user, companyId);
    c.syncAlerts();
    List<Doc> records = new ArrayList<>();
    for (Doc d : c.rows.values()) {
      if (d.eq("kind", "order")) records.add(c.orderView(d));
      else if (d.eq("kind", "stock"))
        records.add(
            d.with(
                "lockedGram",
                c.locked(d.s("id")),
                "availableGram",
                Math.max(0, d.l("onHandGram") - c.locked(d.s("id"))),
                "shortageGram",
                Math.max(0, c.locked(d.s("id")) - d.l("onHandGram"))));
      else if (d.eq("kind", "customer"))
        records.add(
            d.with(
                "occupiedMinor",
                c.occupied(d.s("id")),
                "overdueDays",
                c.overdue(d.s("id")),
                "credit",
                c.credit(d.s("id")),
                "temporaryOccupiedMinor",
                c.temporaryOccupied(d.s("id"))));
      else if (d.eq("kind", "batch")) records.add(c.batchView(d));
      else if (d.eq("kind", "receipt")) records.add(d.with("availableMinor", c.receiptFree(d)));
      else if (!List.of("command", "company", "payment").contains(d.s("kind"))) records.add(d);
    }
    records.addAll(mapper.recentLedger(c.company.s("id")).stream().map(Doc::parse).toList());
    List<Doc> suggestions =
        c.kind("receipt").stream()
            .filter(r -> r.eq("status", "confirmed") && c.receiptFree(r) > 0)
            .map(
                r ->
                    Doc.of(
                        "receiptId",
                        r.s("id"),
                        "orders",
                        c.kind("order").stream()
                            .filter(
                                o ->
                                    o.same("customerId", r, "customerId")
                                        && o.eq("status", "active"))
                            .sorted(Comparator.comparing(o -> o.s("createdAt")))
                            .map(
                                o ->
                                    Doc.of(
                                        "id",
                                        o.s("id"),
                                        "number",
                                        o.s("number"),
                                        "outstandingMinor",
                                        c.debt(o.s("id"))))
                            .toList()))
            .toList();
    List<Doc> tasks =
        c.tasks().stream()
            .map(
                t -> {
                  Doc state = c.rows.get(ref("task", c.company.s("id"), t.s("id")));
                  return t.with(
                      "state",
                      state == null ? "open" : state.s("state"),
                      "assignee",
                      state == null ? null : state.get("assignee"));
                })
            .toList();
    return Doc.of(
        "companies",
        companies,
        "company",
        c.company,
        "roles",
        c.member.get("roles"),
        "records",
        records,
        "suggestions",
        suggestions,
        "tasks",
        tasks,
        "summary",
        Doc.of(
            "orderCount",
            c.kind("order").size(),
            "receivableMinor",
            sum(
                c.kind("batch").stream()
                    .filter(x -> x.eq("status", "shipped"))
                    .map(x -> Doc.of("n", c.batchDebt(x)))
                    .toList(),
                "n"),
            "pendingApprovals",
            c.kind("approval").stream().filter(x -> x.eq("status", "pending")).count(),
            "unallocatedMinor",
            c.kind("receipt").stream()
                .filter(x -> x.eq("status", "confirmed"))
                .mapToLong(c::receiptFree)
                .sum()));
  }

  /** Called by the scheduled job inside the same transaction/lock as normal business writes. */
  public void scan() {
    for (String json : mapper.companies()) {
      Doc company = Doc.parse(json);
      Context context = new Context(Doc.of("id", company.s("accountOwner")), company.s("id"));
      context.syncAlerts();
    }
  }

  public Doc execute(Doc user, String company, String command, Doc b) {
    require(user != null && !user.b("isDemo"), 403, "演示账号只读");
    for (String forbidden :
        List.of(
            "ownerId", "actorId", "createdBy", "status", "amountMinor", "dataClass", "currency"))
      require(!b.containsKey(forbidden), 400, "不能指定系统所属、状态、币种或记账金额字段");
    String allowed =
        switch (command) {
          case "members" -> "userId roles active";
          case "rules" ->
              "version overdueWarningDays overdueEscalationDays weightToleranceBps steelShockPct"
                  + " freightShockPct";
          case "customer" -> "number name registration sourceNote";
          case "bank_account" -> "number name evidence";
          case "stock" ->
              "number warehouse name spec quantity pricingMode costPerTon costSource costTaxBasis"
                  + " evidence";
          case "order" ->
              "copyFrom number customerId stockId quantity unitPrice paymentMode termDays"
                  + " fixedDueDate taxBasis taxRateBps fees contractEvidence";
          case "order_confirm" -> "orderId version";
          case "order_cancel", "close" -> "orderId";
          case "batch" -> "orderId quantity";
          case "batch_cancel" -> "batchId";
          case "weigh" -> "batchId quantity scaleWeight evidence";
          case "release" -> "batchId evidence";
          case "receipt" -> "customerId bankAccount bankReference payer amount receivedOn evidence";
          case "receipt_import" -> "format content";
          case "receipt_confirm" ->
              "receiptId customerId orderId amount purpose purposeReason evidence";
          case "allocate" -> "receiptId customerId orderId amount purpose purposeReason";
          case "request" ->
              "type customerId orderId batchId receiptId stockId allocationId amount quantity limit"
                  + " validUntil maxTermDays maxSingle conditions measures held number unitPrice"
                  + " pricingMode paymentMode termDays fixedDueDate taxBasis taxRateBps fees"
                  + " contractEvidence payer receivedOn evidence payee";
          case "decide" -> "approvalId decision";
          case "return_receive", "return_inspect", "refund_pay", "stock_adjust" ->
              "approvalId evidence decision";
          case "approval_cancel" -> "approvalId";
          case "task" -> "taskId assignee state";
          default -> throw fail(404, "操作不存在");
        };
    Set<String> accepted = new HashSet<>(List.of(allowed.split(" ")));
    accepted.addAll(List.of("businessKey", "reason", "checked"));
    fields(b, accepted);
    Context c = new Context(user, company);
    c.permission(command);
    String businessKey = text(b.get("businessKey"), "业务唯一键", 100),
        id = ref("command", company, List.of(user.s("id"), command, businessKey));
    Doc old = db.get(BUCKET, id);
    String hash = digest(b);
    if (old != null) {
      require(old.eq("inputHash", hash), 409, "相同业务键不能提交不同内容");
      return old.d("result");
    }
    Doc result =
        switch (command) {
          case "members" -> c.members(b);
          case "bank_account" -> c.bankAccount(b);
          case "task" -> c.task(b);
          case "rules" -> c.rules(b);
          case "customer" -> c.customer(b);
          case "stock" -> c.stock(b);
          case "order" -> c.order(b);
          case "order_confirm" -> c.confirmOrder(b);
          case "order_cancel" -> c.cancelOrder(b);
          case "batch" -> c.plan(b);
          case "batch_cancel" -> c.cancelBatch(b);
          case "weigh" -> c.weigh(b);
          case "release" -> c.release(b);
          case "receipt" -> c.receipt(b, "manual");
          case "receipt_import" -> c.importReceipts(b);
          case "receipt_confirm" -> c.confirmReceipt(b);
          case "allocate" -> c.allocate(b);
          case "request" -> c.request(b);
          case "decide" -> c.decide(b);
          case "return_receive" -> c.receiveReturn(b);
          case "return_inspect" -> c.inspectReturn(b);
          case "refund_pay" -> c.payRefund(b);
          case "close" -> c.close(b);
          case "approval_cancel" -> c.cancelApproval(b);
          case "stock_adjust" -> c.adjustStock(b);
          default -> throw fail(404, "操作不存在");
        };
    c.insert(
        Doc.of(
            "id", id, "kind", "command", "inputHash", hash, "command", command, "result", result));
    audit.audit(
        user,
        c.company.s("accountOwner"),
        "steel." + command,
        result.s("id", id),
        Doc.of(
            "companyId",
            company,
            "dataClass",
            c.company.get("dataClass"),
            "businessKey",
            businessKey,
            "input",
            b,
            "result",
            result,
            "rulesSnapshot",
            c.company.get("rules")));
    return result;
  }

  private class Context {
    final Doc user, company, member;
    final LinkedHashMap<String, Doc> rows = new LinkedHashMap<>();

    Context(Doc actor, String companyId) {
      user = actor;
      company = db.get(BUCKET, companyId);
      member = db.get(BUCKET, ref("member", companyId, actor.s("id")));
      require(
          company != null && company.eq("kind", "company") && member != null && member.b("active"),
          404,
          "企业不存在或未获授权");
      mapper.company(companyId).stream().map(Doc::parse).forEach(d -> rows.put(d.s("id"), d));
    }

    void role(String... roles) {
      require(
          Arrays.stream(roles).anyMatch(r -> member.strings("roles").contains(r)),
          403,
          "当前岗位无权执行此操作");
    }

    void permission(String command) {
      switch (command) {
        case "members", "rules", "decide", "return_inspect", "bank_account" -> role("manager");
        case "task", "approval_cancel" -> role("business", "finance", "warehouse", "manager");
        case "stock", "weigh", "release", "return_receive", "stock_adjust" -> role("warehouse");
        case "receipt_confirm", "allocate", "refund_pay" -> role("finance");
        case "receipt_import" -> role("business", "finance");
        case "customer", "receipt", "request" ->
            role("business", "finance", "warehouse", "manager");
        case "order", "order_confirm", "order_cancel", "batch_cancel", "close" -> role("business");
        case "batch" -> role("business", "warehouse");
        default -> throw fail(404, "操作不存在");
      }
    }

    Doc get(Object id, String kind) {
      Doc d = rows.get(String.valueOf(id));
      require(d != null && d.eq("kind", kind), 404, "记录不存在或不属于本企业");
      return d;
    }

    List<Doc> kind(String kind) {
      return rows.values().stream().filter(x -> x.eq("kind", kind)).toList();
    }

    List<Doc> related(String kind, String key, Object id) {
      return kind(kind).stream().filter(x -> x.eq(key, id)).toList();
    }

    Doc insert(Doc d) {
      Doc row =
          d.with(
              "ownerId",
              company.get("id"),
              "dataClass",
              company.get("dataClass"),
              "createdBy",
              user.get("id"),
              "createdAt",
              now(),
              "version",
              1);
      db.insert(BUCKET, row);
      rows.put(row.s("id"), row);
      return row;
    }

    Doc save(Doc d) {
      require(!d.eq("kind", "ledger"), 409, "流水只能追加");
      Doc row =
          d.with("updatedAt", now(), "updatedBy", user.get("id"), "version", d.l("version") + 1);
      db.put(BUCKET, row);
      rows.put(row.s("id"), row);
      return row;
    }

    void ledger(String action, Doc d, Object details) {
      insert(
          Doc.of(
              "id",
              Inputs.id("SL-"),
              "kind",
              "ledger",
              "action",
              action,
              "entityId",
              d.get("id"),
              "customerId",
              d.get("customerId"),
              "orderId",
              d.get("orderId"),
              "details",
              details,
              "rulesSnapshot",
              company.get("rules")));
    }

    Doc bankAccount(Doc b) {
      checked(b);
      String number = text(b.get("number"), "本方收款账户编号", 80).toUpperCase(Locale.ROOT);
      require(number.matches("[A-Z0-9_-]{1,80}"), 400, "账户编号限字母、数字、短横线和下划线");
      String id = ref("bank-account", company.s("id"), number);
      require(!rows.containsKey(id), 409, "账户编号已经存在");
      return insert(
          Doc.of(
              "id",
              id,
              "kind",
              "bank_account",
              "number",
              number,
              "name",
              text(b.get("name"), "账户名称", 120),
              "evidence",
              text(b.get("evidence"), "本方账户归属核验依据", 1000),
              "confirmedBy",
              user.get("id")));
    }

    Doc task(Doc b) {
      String taskId = text(b.get("taskId"), "待办标识", 500);
      Doc current =
          tasks().stream()
              .filter(t -> t.eq("id", taskId))
              .findFirst()
              .orElseThrow(() -> fail(409, "风险已消除或待办不存在"));
      String assignee = text(b.get("assignee"), "负责人账号", 40);
      Doc target = get(ref("member", company.s("id"), assignee), "member");
      require(
          target.b("active") && target.strings("roles").contains(current.s("role")),
          400,
          "负责人须具有对应岗位权限");
      require(
          member.strings("roles").contains("manager") || assignee.equals(user.s("id")),
          403,
          "仅负责人可分配他人任务");
      String state = choice(b.get("state"), List.of("open", "handling", "waiting"), "处理状态");
      String id = ref("task", company.s("id"), taskId);
      Doc old = rows.get(id);
      Doc data =
          Doc.of(
              "id",
              id,
              "kind",
              "task_state",
              "taskId",
              taskId,
              "assignee",
              assignee,
              "state",
              state,
              "reason",
              reason(b),
              "orderId",
              current.get("orderId"),
              "title",
              current.s("title"));
      return old == null ? insert(data) : save(old.withExtra(data));
    }

    Doc members(Doc b) {
      require(company.same("accountOwner", user, "id"), 403, "仅企业创建人可以授权或停用岗位");
      String uid = text(b.get("userId"), "员工账号", 40);
      Doc account = db.get("users", uid);
      require(account != null && !account.b("isDemo"), 400, "员工须先注册独立账号");
      List<String> roles = b.strings("roles");
      require(
          !roles.isEmpty()
              && List.of("business", "finance", "warehouse", "manager").containsAll(roles),
          400,
          "岗位无效");
      require(
          !uid.equals(company.s("accountOwner"))
              || (roles.contains("manager") && !Boolean.FALSE.equals(b.get("active"))),
          409,
          "不能移除创建人的管理权限");
      String id = ref("member", company.s("id"), uid);
      Doc d = rows.get(id);
      Doc p =
          Doc.of(
              "id",
              id,
              "kind",
              "member",
              "userId",
              uid,
              "displayName",
              account.get("displayName"),
              "roles",
              roles,
              "active",
              !Boolean.FALSE.equals(b.get("active")),
              "reason",
              reason(b));
      return d == null ? insert(p) : save(d.withExtra(p));
    }

    Doc rules(Doc b) {
      require(
          company.l("version") == integer(b, "version", 1, Integer.MAX_VALUE), 409, "配置已变化，请刷新");
      Doc r =
          company
              .d("rules")
              .with(
                  "version",
                  company.d("rules").l("version") + 1,
                  "overdueWarningDays",
                  integer(b, "overdueWarningDays", 1, 90),
                  "overdueEscalationDays",
                  integer(b, "overdueEscalationDays", 1, 365),
                  "weightToleranceBps",
                  integer(b, "weightToleranceBps", 0, 1000),
                  "steelShockPct",
                  number(b.get("steelShockPct"), "钢价压力", 0, 100),
                  "freightShockPct",
                  number(b.get("freightShockPct"), "运费压力", 0, 100),
                  "reason",
                  reason(b));
      require(r.l("overdueEscalationDays") >= r.l("overdueWarningDays"), 400, "升级天数不能早于预警");
      return save(company.with("rules", r));
    }

    Doc customer(Doc b) {
      String number = text(b.get("number"), "客户编号", 80);
      String id = ref("customer", company.s("id"), number);
      require(!rows.containsKey(id), 409, "客户编号已存在");
      return insert(
          Doc.of(
              "id",
              id,
              "kind",
              "customer",
              "number",
              number,
              "name",
              text(b.get("name"), "客户名称", 120),
              "registration",
              text(b.get("registration"), "客户身份凭据", 1000),
              "sourceNote",
              text(b.get("sourceNote"), "资料来源", 1000),
              "source",
              "manual",
              "held",
              false));
    }

    Doc stock(Doc b) {
      checked(b);
      String code = text(b.get("number"), "库存批次号", 80), id = ref("stock", company.s("id"), code);
      require(!rows.containsKey(id), 409, "库存批次已存在");
      return insert(
          Doc.of(
              "id",
              id,
              "kind",
              "stock",
              "number",
              code,
              "warehouse",
              text(b.get("warehouse"), "仓库", 120),
              "name",
              text(b.get("name"), "品名", 120),
              "spec",
              text(b.get("spec"), "规格及材质", 180),
              "pricingMode",
              choice(b.get("pricingMode"), List.of("theoretical", "weighed"), "计重口径"),
              "onHandGram",
              quantity(b.get("quantity")),
              "quarantineGram",
              0,
              "costPerTonMinor",
              minor(b.get("costPerTon"), "单位成本"),
              "costSource",
              choice(b.get("costSource"), List.of("manual", "import", "estimate"), "成本来源"),
              "costTaxBasis",
              choice(b.get("costTaxBasis"), List.of("inclusive", "exclusive", "unknown"), "成本税口径"),
              "evidence",
              text(b.get("evidence"), "库存与货权凭据", 1000),
              "source",
              "manual",
              "confirmedBy",
              user.get("id")));
    }

    long remaining(Doc o) {
      return o.l("quantityGram")
          - sum(
              related("batch", "orderId", o.s("id")).stream()
                  .filter(x -> x.eq("status", "shipped"))
                  .toList(),
              "quantityGram")
          - o.l("cancelledGram");
    }

    long locked(String stock) {
      return kind("order").stream()
          .filter(o -> o.eq("stockId", stock) && o.eq("status", "active"))
          .mapToLong(this::remaining)
          .sum();
    }

    Doc credit(String customer) {
      return rows.get(ref("credit", company.s("id"), customer));
    }

    long feeTotal(Doc o) {
      return o.rows("fees").stream()
          .filter(x -> x.eq("payer", "customer") && !x.b("included"))
          .mapToLong(x -> x.l("amountMinor"))
          .sum();
    }

    long total(Doc o) {
      long n = Math.addExact(goodsTotal(o), feeTotal(o));
      require(n <= MAX, 400, "合同金额超出支持精度");
      return n;
    }

    long allocated(Doc o) {
      return related("allocation", "orderId", o.s("id")).stream()
          .filter(x -> x.eq("status", "active"))
          .mapToLong(x -> x.l("amountMinor") - x.l("refundedMinor"))
          .sum();
    }

    long allocationUsed(Doc a) {
      return related("payment", "allocationId", a.s("id")).stream()
          .mapToLong(x -> x.l("amountMinor") - x.l("reversedMinor"))
          .sum();
    }

    long cash(Doc o) {
      return related("allocation", "orderId", o.s("id")).stream()
          .filter(x -> x.eq("status", "active"))
          .mapToLong(x -> x.l("amountMinor") - x.l("refundedMinor") - allocationUsed(x))
          .sum();
    }

    long paid(Doc batch) {
      return related("payment", "batchId", batch.s("id")).stream()
          .mapToLong(x -> x.l("amountMinor") - x.l("reversedMinor"))
          .sum();
    }

    long net(Doc batch) {
      return batch.l("amountMinor") - batch.l("returnMinor") - batch.l("adjustmentMinor");
    }

    long batchDebt(Doc batch) {
      return Math.max(0, net(batch) - paid(batch));
    }

    long debt(String order) {
      return related("batch", "orderId", order).stream()
          .filter(x -> x.eq("status", "shipped"))
          .mapToLong(this::batchDebt)
          .sum();
    }

    long cancelledValue(Doc o) {
      return o.l("cancelledMinor");
    }

    long orderExposure(Doc o) {
      if (!List.of("active", "cancelled", "closed").contains(o.s("status"))) return 0;
      if (o.eq("paymentMode", "cash")) return debt(o.s("id"));
      long credits =
          related("batch", "orderId", o.s("id")).stream()
              .filter(x -> x.eq("status", "shipped"))
              .mapToLong(x -> x.l("returnMinor") + x.l("adjustmentMinor"))
              .sum();
      return Math.max(0, total(o) - cancelledValue(o) - credits - allocated(o));
    }

    long occupied(String customer) {
      return related("order", "customerId", customer).stream().mapToLong(this::orderExposure).sum();
    }

    String contractHash(Doc o) {
      return digest(
          Doc.of(
              "orderId",
              o.s("id"),
              "customerId",
              o.get("customerId"),
              "stockId",
              o.get("stockId"),
              "quantityGram",
              o.get("quantityGram"),
              "unitPriceMinor",
              o.get("unitPriceMinor"),
              "paymentMode",
              o.get("paymentMode"),
              "termDays",
              o.get("termDays"),
              "fixedDueDate",
              o.get("fixedDueDate"),
              "taxBasis",
              o.get("taxBasis"),
              "taxRateBps",
              o.get("taxRateBps"),
              "fees",
              o.get("fees")));
    }

    Doc temporary(Doc o) {
      Doc t = rows.get(ref("temporary-credit", company.s("id"), o.s("id")));
      return t != null
              && t.eq("contractHash", contractHash(o))
              && t.s("validUntil").compareTo(date()) >= 0
          ? t
          : null;
    }

    long temporaryOccupied(String customer) {
      return related("order", "customerId", customer).stream()
          .mapToLong(
              o -> {
                Doc t = temporary(o);
                return t == null ? 0 : Math.min(orderExposure(o), t.l("amountMinor"));
              })
          .sum();
    }

    long overdue(String customer) {
      return kind("batch").stream()
          .filter(
              x ->
                  x.eq("customerId", customer)
                      && x.eq("status", "shipped")
                      && batchDebt(x) > 0
                      && x.get("dueDate") != null)
          .mapToLong(x -> Math.max(0, Inputs.days(x.s("dueDate"), date())))
          .max()
          .orElse(0);
    }

    long refundReserved(Doc o, String except) {
      return related("approval", "orderId", o.s("id")).stream()
          .filter(a -> a.eq("type", "refund") && a.eq("status", "approved") && !a.eq("id", except))
          .mapToLong(a -> a.l("amountMinor"))
          .sum();
    }

    String fundingFingerprint(Doc o) {
      return digest(
          related("allocation", "orderId", o.s("id")).stream()
              .map(
                  a ->
                      Doc.of(
                          "id", a.s("id"), "receiptId", a.s("receiptId"), "status", a.s("status")))
              .toList());
    }

    long receiptFree(Doc r) {
      if (!r.eq("status", "confirmed")) return 0;
      long used =
          related("allocation", "receiptId", r.s("id")).stream()
              .filter(x -> x.eq("status", "active"))
              .mapToLong(x -> x.l("amountMinor"))
              .sum();
      long reserved =
          related("approval", "receiptId", r.s("id")).stream()
              .filter(a -> a.eq("type", "receipt_refund") && a.eq("status", "approved"))
              .mapToLong(a -> a.l("amountMinor"))
              .sum();
      return r.l("amountMinor") - r.l("refundedMinor") - used - reserved;
    }

    List<String> creditIssues(Doc o) {
      List<String> issues = new ArrayList<>();
      Doc p = get(o.get("customerId"), "customer"), c = credit(p.s("id"));
      if (p.b("held")) issues.add("客户已暂停新增发货，请负责人复核");
      if (c == null) {
        issues.add("客户尚无已批准授信，请申请授信");
        return issues;
      }
      if (c.s("validUntil").compareTo(date()) < 0) issues.add("授信已过期，请续批");
      if (c.l("maxTermDays") < o.l("termDays")
          || o.get("fixedDueDate") != null
              && Inputs.days(date(), o.s("fixedDueDate")) > c.l("maxTermDays"))
        issues.add("订单账期超过授信条件");
      if (occupied(p.s("id")) - temporaryOccupied(p.s("id")) > c.l("limitMinor"))
        issues.add("客户额度不足，请收款或申请调整授信");
      if (c.get("maxSingleMinor") != null && orderExposure(o) > c.l("maxSingleMinor"))
        issues.add("本单超过单笔授信上限");
      return issues;
    }

    Doc contract(Doc b) {
      Doc customer = get(b.get("customerId"), "customer"), stock = get(b.get("stockId"), "stock");
      long qty = quantity(b.get("quantity")), unit = positive(b.get("unitPrice"));
      String payment = choice(b.get("paymentMode"), List.of("cash", "credit"), "付款方式");
      long term = payment.equals("credit") ? integer(b, "termDays", 1, 365) : 0;
      String fixed = day(b.get("fixedDueDate"));
      require(fixed == null || fixed.compareTo(date()) >= 0, 400, "固定到期日不能早于今天");
      List<Doc> fees = new ArrayList<>();
      require(b.rows("fees").size() <= 10, 400, "费用最多十项");
      for (Doc f : b.rows("fees")) {
        fields(
            f,
            List.of(
                "name",
                "amount",
                "payer",
                "included",
                "beforeShipping",
                "actualCost",
                "costSource",
                "costTaxBasis"));
        String payer = choice(f.get("payer"), List.of("customer", "company"), "费用承担方");
        Boolean included = bool(f.get("included"), "费用是否已含"),
            before = bool(f.get("beforeShipping"), "是否发货前收取");
        require(included != null && before != null, 400, "费用承担、包含及付款时间须明确");
        require(
            !payment.equals("cash") || !payer.equals("customer") || included || before,
            400,
            "另收费用后付请选赊销，并纳入授信");
        fees.add(
            Doc.of(
                "name",
                text(f.get("name"), "费用名称", 80),
                "amountMinor",
                minor(f.get("amount"), "费用金额", false),
                "payer",
                payer,
                "included",
                included,
                "beforeShipping",
                before,
                "actualCostMinor",
                minor(f.get("actualCost"), "费用实际成本"),
                "costSource",
                blank(f.get("actualCost"))
                    ? null
                    : choice(
                        f.get("costSource"), List.of("manual", "import", "estimate"), "费用成本来源"),
                "costTaxBasis",
                blank(f.get("actualCost"))
                    ? null
                    : choice(f.get("costTaxBasis"), List.of("inclusive", "exclusive"), "费用成本税口径")));
      }
      return Doc.of(
          "customerId",
          customer.s("id"),
          "stockId",
          stock.s("id"),
          "quantityGram",
          qty,
          "unitPriceMinor",
          unit,
          "pricingMode",
          stock.get("pricingMode"),
          "paymentMode",
          payment,
          "termDays",
          term,
          "fixedDueDate",
          fixed,
          "taxBasis",
          choice(b.get("taxBasis"), List.of("inclusive", "exclusive"), "含税口径"),
          "taxRateBps",
          integer(b, "taxRateBps", 0, 3000),
          "fees",
          fees,
          "contractEvidence",
          text(b.get("contractEvidence"), "合同及计重依据", 1000));
    }

    long goodsTotal(Doc o) {
      long base = price(o.l("quantityGram"), o.l("unitPriceMinor"));
      return o.eq("taxBasis", "exclusive") ? base + fraction(base, o.l("taxRateBps"), 10000) : base;
    }

    long totalWithTax(Doc o) {
      long n = Math.addExact(goodsTotal(o), feeTotal(o));
      require(n <= MAX, 400, "合同金额超出支持精度");
      return n;
    }

    Doc order(Doc b) {
      String code = text(b.get("number"), "订单号", 80), id = ref("order", company.s("id"), code);
      require(!rows.containsKey(id), 409, "订单号已存在");
      Doc p = contract(b);
      if (!blank(b.get("copyFrom")))
        p = p.with("copyFrom", get(b.get("copyFrom"), "order").s("id"));
      total(p);
      return insert(
          p.with(
              "id",
              id,
              "kind",
              "order",
              "number",
              code,
              "status",
              "draft",
              "cancelledGram",
              0,
              "cancelledMinor",
              0,
              "rulesSnapshot",
              company.get("rules")));
    }

    Doc confirmOrder(Doc b) {
      Doc o = get(b.get("orderId"), "order");
      require(o.eq("status", "draft"), 409, "订单不是待确认状态");
      require(o.l("version") == integer(b, "version", 1, Integer.MAX_VALUE), 409, "订单已变化，请刷新");
      Doc s = get(o.get("stockId"), "stock"), p = get(o.get("customerId"), "customer");
      require(!p.b("held"), 409, "客户已暂停新增业务");
      require(
          s.l("onHandGram") - locked(s.s("id")) >= o.l("quantityGram"), 409, "可售库存不足，请调整数量或核实入库");
      o = save(o.with("status", "active", "confirmedBy", user.s("id"), "confirmedAt", now()));
      if (o.eq("paymentMode", "credit")) {
        List<String> issues = creditIssues(o);
        require(issues.isEmpty(), 409, String.join("；", issues));
      }
      ledger(
          "order.confirm",
          o,
          Doc.of("lockedGram", o.get("quantityGram"), "creditOccupiedMinor", orderExposure(o)));
      return o;
    }

    Doc cancelOrder(Doc b) {
      Doc o = get(b.get("orderId"), "order");
      require(List.of("draft", "active").contains(o.s("status")), 409, "订单不可取消剩余部分");
      require(
          related("batch", "orderId", o.s("id")).stream()
              .noneMatch(x -> List.of("planned", "weighed").contains(x.s("status"))),
          409,
          "请先取消尚未执行的出库批次");
      long quantity = remaining(o);
      require(quantity > 0, 409, "没有未出库数量");
      long shipped =
          related("batch", "orderId", o.s("id")).stream()
              .filter(x -> x.eq("status", "shipped"))
              .mapToLong(x -> x.l("amountMinor"))
              .sum();
      Doc result =
          save(
              o.with(
                  "cancelledGram",
                  o.l("cancelledGram") + quantity,
                  "cancelledMinor",
                  total(o) - shipped,
                  "status",
                  "cancelled",
                  "cancelReason",
                  reason(b)));
      ledger("order.cancel_remaining", o, result);
      return result;
    }

    long plannedQty(Doc o, String except) {
      return related("batch", "orderId", o.s("id")).stream()
          .filter(x -> !x.eq("id", except) && List.of("planned", "weighed").contains(x.s("status")))
          .mapToLong(x -> x.get("quantityGram") == null ? x.l("plannedGram") : x.l("quantityGram"))
          .sum();
    }

    long batchAmount(Doc o, long qty) {
      List<Doc> shipped =
          related("batch", "orderId", o.s("id")).stream()
              .filter(x -> x.eq("status", "shipped"))
              .toList();
      if (qty == remaining(o))
        return total(o) - o.l("cancelledMinor") - sum(shipped, "amountMinor");
      return fraction(total(o), qty, o.l("quantityGram"));
    }

    long beforeShipping(Doc o, long qty) {
      if (o.eq("paymentMode", "cash")) return batchAmount(o, qty);
      long required =
          o.rows("fees").stream()
              .filter(f -> f.eq("payer", "customer") && !f.b("included") && f.b("beforeShipping"))
              .mapToLong(f -> f.l("amountMinor"))
              .sum();
      if (qty == remaining(o))
        return required
            - fraction(required, o.l("cancelledGram"), o.l("quantityGram"))
            - related("batch", "orderId", o.s("id")).stream()
                .filter(p -> p.eq("status", "shipped"))
                .mapToLong(p -> p.l("beforeShippingMinor"))
                .sum();
      return fraction(required, qty, o.l("quantityGram"));
    }

    List<Doc> plans(Doc o) {
      return related("batch", "orderId", o.s("id")).stream()
          .filter(x -> List.of("planned", "weighed").contains(x.s("status")))
          .sorted(Comparator.comparing((Doc x) -> x.s("createdAt")).thenComparing(x -> x.s("id")))
          .toList();
    }

    Map<String, Long> reservations(Doc o) {
      Map<String, Long> result = new LinkedHashMap<>();
      long left = Math.max(0, cash(o) - refundReserved(o, null));
      for (Doc p : plans(o)) {
        long amount =
            p.get("quantityGram") != null
                ? batchAmount(o, p.l("quantityGram"))
                : batchAmount(o, p.l("plannedGram"));
        long n = Math.min(left, amount);
        result.put(p.s("id"), n);
        left -= n;
      }
      return result;
    }

    Doc plan(Doc b) {
      Doc o = get(b.get("orderId"), "order");
      require(o.eq("status", "active"), 409, "请先确认订单");
      long qty = quantity(b.get("quantity"));
      require(qty <= remaining(o) - plannedQty(o, null), 409, "本次计划超过未安排的剩余可提数量");
      return insert(
          Doc.of(
              "id",
              Inputs.id("SB-"),
              "kind",
              "batch",
              "orderId",
              o.s("id"),
              "customerId",
              o.s("customerId"),
              "status",
              "planned",
              "plannedGram",
              qty,
              "orderVersion",
              o.l("version"),
              "number",
              o.s("number") + " / " + (related("batch", "orderId", o.s("id")).size() + 1),
              "returnMinor",
              0,
              "adjustmentMinor",
              0));
    }

    Doc cancelBatch(Doc b) {
      Doc d = get(b.get("batchId"), "batch");
      require(List.of("planned", "weighed").contains(d.s("status")), 409, "已出库批次须走退货流程");
      return save(d.with("status", "cancelled", "reason", reason(b)));
    }

    Doc weigh(Doc b) {
      checked(b);
      Doc p = get(b.get("batchId"), "batch"), o = get(p.get("orderId"), "order");
      require(List.of("planned", "weighed").contains(p.s("status")), 409, "批次不可登记重量");
      long qty = quantity(b.get("quantity"));
      Long scale = blank(b.get("scaleWeight")) ? null : quantity(b.get("scaleWeight"));
      if (o.eq("pricingMode", "weighed")) {
        require(scale != null && scale == qty, 400, "磅计结算重量须与实磅重量一致");
      }
      require(qty <= remaining(o) - plannedQty(o, p.s("id")), 409, "本次重量超过合同剩余可提量，不能挤占其他批次");
      Doc result =
          save(
              p.with(
                  "quantityGram",
                  qty,
                  "scaleGram",
                  scale,
                  "status",
                  "weighed",
                  "weighEvidence",
                  text(b.get("evidence"), "计重及出库凭据", 1000),
                  "weighedBy",
                  user.s("id"),
                  "weighedAt",
                  now()));
      ledger("batch.weigh", result, result);
      return result;
    }

    Doc gate(Doc p) {
      Doc o = get(p.get("orderId"), "order"),
          s = get(o.get("stockId"), "stock"),
          customer = get(o.get("customerId"), "customer");
      List<String> hard = new ArrayList<>(), soft = new ArrayList<>();
      if (!o.eq("status", "active")) hard.add("订单尚未生效或已停止执行");
      if (!p.eq("status", "weighed")) hard.add("仓管尚未确认本批计重凭据");
      long qty = p.get("quantityGram") == null ? p.l("plannedGram") : p.l("quantityGram"),
          amount = batchAmount(o, qty);
      if (qty > remaining(o) - plannedQty(o, p.s("id"))) hard.add("超过合同剩余可提量");
      if (qty > s.l("onHandGram") || s.l("onHandGram") - locked(s.s("id")) + remaining(o) < qty)
        hard.add("实际可用库存不足");
      if (customer.b("held")) hard.add("客户已暂停业务，须先复核解除");
      Map<String, Long> reserved = reservations(o);
      long others =
          reserved.entrySet().stream()
              .filter(e -> !e.getKey().equals(p.s("id")))
              .mapToLong(Map.Entry::getValue)
              .sum();
      long cover = Math.min(amount, Math.max(0, cash(o) - refundReserved(o, null) - others));
      if (o.eq("paymentMode", "cash") && cover < amount)
        hard.add("本批还需收款 ¥" + BigDecimal.valueOf(amount - cover, 2) + "，请确认并分配到账，或审批改为赊销");
      if (o.eq("paymentMode", "credit")) {
        long required = beforeShipping(o, qty);
        if (cover < required) hard.add("本批约定先付费用还需收款 ¥" + BigDecimal.valueOf(required - cover, 2));
        hard.addAll(creditIssues(o));
        Doc temporary = temporary(o);
        if (temporary != null && temporary.s("validUntil").compareTo(dueDate(o, date())) < 0)
          hard.add("本批到期日超过临时授信期限，请先续批或补款");
        Doc credit = credit(o.s("customerId"));
        String due = dueDate(o, date());
        if (due.compareTo(date()) < 0) hard.add("约定到期日已过，请先审批调整账期");
        if (credit != null && credit.s("validUntil").compareTo(due) < 0) hard.add("本批到期日超过授信有效期");
      }
      if (overdue(o.s("customerId")) > 0) soft.add("客户存在逾期未收款");
      if (BigDecimal.valueOf(qty)
              .multiply(BigDecimal.valueOf(10000))
              .compareTo(
                  BigDecimal.valueOf(p.l("plannedGram"))
                      .multiply(
                          BigDecimal.valueOf(10000 + company.d("rules").l("weightToleranceBps"))))
          > 0) soft.add("本批重量超过计划容差");
      String hash =
          digest(
              Doc.of(
                  "companyVersion",
                  company.l("version"),
                  "order",
                  o,
                  "stock",
                  s,
                  "stockLockedGram",
                  locked(s.s("id")),
                  "customerBatches",
                  related("batch", "customerId", o.s("customerId")),
                  "batch",
                  p,
                  "customer",
                  customer,
                  "credit",
                  credit(o.s("customerId")),
                  "temporaryCredit",
                  temporary(o),
                  "occupied",
                  occupied(o.s("customerId")),
                  "overdue",
                  overdue(o.s("customerId")),
                  "cash",
                  cash(o),
                  "reservations",
                  reserved,
                  "allocations",
                  related("allocation", "orderId", o.s("id")),
                  "date",
                  date()));
      boolean exception =
          related("approval", "batchId", p.s("id")).stream()
              .anyMatch(
                  a ->
                      a.eq("type", "exception")
                          && a.eq("status", "approved")
                          && a.eq("stateHash", hash)
                          && a.s("expiresAt").compareTo(now()) > 0
                          && !a.b("consumed"));
      return Doc.of(
          "hard",
          hard.stream().distinct().toList(),
          "soft",
          soft,
          "amountMinor",
          amount,
          "coveredMinor",
          cover,
          "shortfallMinor",
          Math.max(0, amount - cover),
          "stateHash",
          hash,
          "exceptionApproved",
          exception,
          "canRelease",
          hard.isEmpty() && (soft.isEmpty() || exception),
          "currency",
          "CNY");
    }

    String dueDate(Doc o, String shipped) {
      if (o.get("fixedDueDate") != null) return o.s("fixedDueDate");
      return LocalDate.parse(shipped).plusDays(o.l("termDays")).toString();
    }

    Doc release(Doc b) {
      checked(b);
      Doc p = get(b.get("batchId"), "batch"),
          o = get(p.get("orderId"), "order"),
          s = get(o.get("stockId"), "stock");
      require(!p.eq("status", "shipped"), 409, "批次已出库，请查询原业务键，不能重复执行");
      Doc g = gate(p);
      require(g.strings("hard").isEmpty(), 409, String.join("；", g.strings("hard")));
      require(
          g.strings("soft").isEmpty() || g.b("exceptionApproved"),
          409,
          "须先完成本批例外审批：" + String.join("；", g.strings("soft")));
      require(p.l("orderVersion") == o.l("version"), 409, "订单已变更，请重新安排批次");
      long qty = p.l("quantityGram"), amount = g.l("amountMinor");
      long goods = batchGoods(o, qty);
      Doc result =
          save(
              p.with(
                  "status",
                  "shipped",
                  "amountMinor",
                  amount,
                  "goodsMinor",
                  goods,
                  "beforeShippingMinor",
                  beforeShipping(o, qty),
                  "feeMinor",
                  amount - goods,
                  "shippedOn",
                  date(),
                  "dueDate",
                  dueDate(o, date()),
                  "releasedBy",
                  user.get("id"),
                  "releaseEvidence",
                  text(b.get("evidence"), "实际放行凭据", 1000),
                  "rulesSnapshot",
                  company.get("rules"),
                  "gateSnapshot",
                  g,
                  "contractSnapshot",
                  o));
      save(s.with("onHandGram", s.l("onHandGram") - qty));
      payBatch(result, g.l("coveredMinor"), null);
      for (Doc a : related("approval", "batchId", p.s("id")))
        if (a.eq("type", "exception")
            && a.eq("status", "approved")
            && a.eq("stateHash", g.get("stateHash"))) save(a.with("consumed", true));
      ledger(
          "batch.release",
          result,
          Doc.of(
              "quantityGram",
              qty,
              "amountMinor",
              amount,
              "paidMinor",
              paid(result),
              "dueDate",
              result.get("dueDate"),
              "stockAfter",
              get(s.s("id"), "stock").l("onHandGram")));
      return batchView(result);
    }

    long batchGoods(Doc o, long qty) {
      List<Doc> previous =
          related("batch", "orderId", o.s("id")).stream()
              .filter(x -> x.eq("status", "shipped"))
              .toList();
      return qty == remaining(o)
          ? goodsTotal(o)
              - fraction(goodsTotal(o), o.l("cancelledGram"), o.l("quantityGram"))
              - sum(previous, "goodsMinor")
          : fraction(goodsTotal(o), qty, o.l("quantityGram"));
    }

    Doc receipt(Doc b, String source) {
      Doc customer = get(b.get("customerId"), "customer");
      String account = text(b.get("bankAccount"), "本方收款账户编号", 80).toUpperCase(Locale.ROOT),
          reference = text(b.get("bankReference"), "银行流水号", 150);
      get(ref("bank-account", company.s("id"), account), "bank_account");
      String id = ref("receipt", company.s("id"), List.of(account, reference));
      Doc input =
          Doc.of(
              "customerId",
              customer.get("id"),
              "bankAccount",
              account,
              "bankReference",
              reference,
              "payer",
              text(b.get("payer"), "付款人", 150),
              "amountMinor",
              positive(b.get("amount")),
              "receivedOn",
              Objects.requireNonNullElse(day(b.get("receivedOn")), date()),
              "evidence",
              text(b.get("evidence"), "到账凭据", 1000),
              "source",
              source);
      require(input.s("receivedOn").compareTo(date()) <= 0, 400, "到账日期不能晚于今天");
      Doc old = rows.get(id);
      if (old != null) {
        require(old.eq("inputHash", digest(input.without("source"))), 409, "流水号已存在，内容不一致，不能覆盖");
        return old;
      }
      return insert(
          input.with(
              "id",
              id,
              "kind",
              "receipt",
              "status",
              "pending",
              "recordedBy",
              user.get("id"),
              "inputHash",
              digest(input.without("source"))));
    }

    Doc importReceipts(Doc b) {
      role("business", "finance");
      String format = choice(b.get("format"), List.of("json", "csv"), "导入格式");
      String content = text(b.get("content"), "导入内容", 80000);
      List<Doc> inputs = new com.induport.risk.RiskMath().parseRows(format, content);
      require(!inputs.isEmpty() && inputs.size() <= 200, 400, "每批须有1至200行");
      List<Doc> added = new ArrayList<>();
      for (Doc input : inputs) {
        fields(
            input,
            List.of(
                "customerNumber",
                "customerId",
                "bankAccount",
                "bankReference",
                "payer",
                "amount",
                "receivedOn",
                "evidence"));
        if (input.get("customerNumber") != null)
          input =
              input.with("customerId", ref("customer", company.s("id"), input.s("customerNumber")));
        added.add(receipt(input, "import"));
      }
      return Doc.of(
          "id",
          Inputs.id("IMPORT-"),
          "count",
          added.size(),
          "receiptIds",
          added.stream().map(x -> x.s("id")).toList());
    }

    Doc confirmReceipt(Doc b) {
      checked(b);
      Doc r = get(b.get("receiptId"), "receipt");
      require(r.eq("status", "pending"), 409, "流水已处理，不能重复确认");
      require(!r.same("recordedBy", user, "id"), 403, "到账登记与核验须由不同账号执行，导入文件不能代替独立核验");
      Doc result =
          save(
              r.with(
                  "status",
                  "confirmed",
                  "confirmedBy",
                  user.s("id"),
                  "confirmationEvidence",
                  text(b.get("evidence"), "核验依据", 1000),
                  "confirmedAt",
                  now()));
      ledger("receipt.confirm", result, result);
      if (!blank(b.get("orderId")))
        allocate(
            Doc.of(
                "receiptId",
                result.get("id"),
                "orderId",
                b.get("orderId"),
                "amount",
                b.get("amount"),
                "purpose",
                b.getOrDefault("purpose", "oldest_due"),
                "purposeReason",
                b.get("purposeReason")));
      return result;
    }

    Doc allocate(Doc b) {
      role("finance");
      Doc r = get(b.get("receiptId"), "receipt"), o = get(b.get("orderId"), "order");
      require(List.of("active", "cancelled").contains(o.s("status")), 409, "请先确认订单，已结清订单不可再分配");
      require(o.same("customerId", r, "customerId"), 403, "不能跨客户分配资金");
      require(r.eq("status", "confirmed"), 409, "到账尚未核实");
      String purpose =
          choice(b.getOrDefault("purpose", "oldest_due"), List.of("oldest_due", "advance"), "收款用途");
      String purposeReason =
          purpose.equals("advance") ? text(b.get("purposeReason"), "专项预收约定依据", 1000) : null;
      long amount = positive(b.get("amount"));
      require(amount <= receiptFree(r), 409, "流水可分配余额不足");
      Doc a =
          insert(
              Doc.of(
                  "id",
                  Inputs.id("SA-"),
                  "kind",
                  "allocation",
                  "receiptId",
                  r.s("id"),
                  "orderId",
                  o.s("id"),
                  "customerId",
                  o.s("customerId"),
                  "amountMinor",
                  amount,
                  "refundedMinor",
                  0,
                  "status",
                  "active",
                  "purpose",
                  purpose,
                  "purposeReason",
                  purposeReason));
      long left = amount;
      List<Doc> debts =
          related("batch", "orderId", o.s("id")).stream()
              .filter(x -> x.eq("status", "shipped") && batchDebt(x) > 0)
              .sorted(Comparator.comparing(x -> x.s("dueDate")))
              .toList();
      for (Doc batch : purpose.equals("advance") ? List.<Doc>of() : debts) {
        long part = Math.min(left, batchDebt(batch));
        payBatch(batch, part, a);
        left -= part;
        if (left == 0) break;
      }
      ledger(
          "receipt.allocate",
          a,
          Doc.of("amountMinor", amount, "paidDebtMinor", amount - left, "advanceMinor", left));
      return a;
    }

    void payBatch(Doc batch, long amount, Doc specific) {
      long left = amount;
      List<Doc> available =
          specific == null
              ? related("allocation", "orderId", batch.s("orderId")).stream()
                  .filter(x -> x.eq("status", "active"))
                  .sorted(Comparator.comparing(x -> x.s("createdAt")))
                  .toList()
              : List.of(specific);
      for (Doc a : available) {
        long free = a.l("amountMinor") - a.l("refundedMinor") - allocationUsed(a),
            part = Math.min(free, left);
        if (part > 0) {
          insert(
              Doc.of(
                  "id",
                  Inputs.id("SP-"),
                  "kind",
                  "payment",
                  "batchId",
                  batch.s("id"),
                  "orderId",
                  batch.s("orderId"),
                  "customerId",
                  batch.s("customerId"),
                  "allocationId",
                  a.s("id"),
                  "amountMinor",
                  part,
                  "reversedMinor",
                  0));
          left -= part;
        }
        if (left == 0) break;
      }
      require(left == 0, 409, "资金被其他业务占用，请刷新重试");
    }

    Doc request(Doc b) {
      String type =
          choice(
              b.get("type"),
              List.of(
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
                  "temporary_credit"),
              "申请类型");
      Doc p =
          Doc.of(
              "id",
              Inputs.id("SAP-"),
              "kind",
              "approval",
              "type",
              type,
              "status",
              "pending",
              "requestedBy",
              user.s("id"),
              "reason",
              reason(b),
              "rulesSnapshot",
              company.get("rules"));
      switch (type) {
        case "receipt_unconfirm" -> {
          role("finance");
          Doc r = get(b.get("receiptId"), "receipt");
          require(
              r.eq("status", "confirmed")
                  && r.l("refundedMinor") == 0
                  && related("allocation", "receiptId", r.s("id")).stream()
                      .noneMatch(a -> a.eq("status", "active"))
                  && related("approval", "receiptId", r.s("id")).stream()
                      .noneMatch(a -> a.eq("type", "receipt_refund") && a.eq("status", "approved")),
              409,
              "须先冲销全部分配，且不得存在实际退款或待执行退款");
          p =
              p.with(
                  "receiptId",
                  r.s("id"),
                  "customerId",
                  r.s("customerId"),
                  "amountMinor",
                  r.l("amountMinor"),
                  "expectedVersion",
                  r.l("version"));
        }

        case "temporary_credit" -> {
          role("business", "finance");
          Doc o = get(b.get("orderId"), "order");
          require(
              o.eq("paymentMode", "credit") && List.of("draft", "active").contains(o.s("status")),
              409,
              "临时授信仅支持未结清的赊销订单");
          Doc base = credit(o.s("customerId"));
          require(base != null, 409, "须先建立客户基础授信");
          String until = day(b.get("validUntil"));
          require(
              until != null
                  && until.compareTo(date()) >= 0
                  && until.compareTo(base.s("validUntil")) <= 0,
              400,
              "临时授信期限须位于基础授信有效期内");
          Doc old = rows.get(ref("temporary-credit", company.s("id"), o.s("id")));
          p =
              p.with(
                  "orderId",
                  o.s("id"),
                  "customerId",
                  o.s("customerId"),
                  "amountMinor",
                  minor(b.get("amount"), "本单临时额度", false),
                  "validUntil",
                  until,
                  "contractHash",
                  contractHash(o),
                  "expectedVersion",
                  old == null ? 0 : old.l("version"),
                  "baseCreditVersion",
                  base.l("version"),
                  "conditions",
                  text(b.get("conditions"), "临时授信条件及责任人", 1000));
        }

        case "stock_count" -> {
          role("warehouse");
          Doc stock = get(b.get("stockId"), "stock");
          long count =
              blank(b.get("quantity"))
                  ? -1
                  : (String.valueOf(b.get("quantity")).matches("0([.]0+)?")
                      ? 0
                      : quantity(b.get("quantity")));
          require(count >= 0, 400, "盘点数量须明确，可填0");
          p =
              p.with(
                  "stockId",
                  stock.s("id"),
                  "quantityGram",
                  count,
                  "previousGram",
                  stock.l("onHandGram"),
                  "expectedVersion",
                  stock.l("version"),
                  "evidence",
                  text(b.get("evidence"), "盘点凭据", 1000));
        }
        case "reopen" -> {
          role("business", "finance");
          Doc order = get(b.get("orderId"), "order");
          require(order.eq("status", "closed"), 409, "仅支持已结清订单重新开启售后");
          p =
              p.with(
                  "orderId",
                  order.s("id"),
                  "customerId",
                  order.s("customerId"),
                  "expectedVersion",
                  order.l("version"));
        }
        case "receipt_refund" -> {
          role("finance");
          Doc receipt = get(b.get("receiptId"), "receipt");
          long amount = positive(b.get("amount"));
          require(amount <= receiptFree(receipt), 409, "未分配款项不足或已预留退款");
          p =
              p.with(
                  "receiptId",
                  receipt.s("id"),
                  "customerId",
                  receipt.s("customerId"),
                  "amountMinor",
                  amount,
                  "payee",
                  text(b.get("payee"), "原付款方收款账户", 200));
        }
        case "receipt_correction" -> {
          role("business", "finance");
          Doc receipt = get(b.get("receiptId"), "receipt");
          require(receipt.eq("status", "pending"), 409, "仅可更正尚未核验的流水，已确认款项需走冲销及对账");
          Doc customer = get(b.get("customerId"), "customer");
          String received = day(b.get("receivedOn"));
          require(received != null && received.compareTo(date()) <= 0, 400, "到账日期无效");
          p =
              p.with(
                  "receiptId",
                  receipt.s("id"),
                  "customerId",
                  customer.s("id"),
                  "expectedVersion",
                  receipt.l("version"),
                  "previousReceipt",
                  receipt,
                  "payload",
                  Doc.of(
                      "customerId",
                      customer.s("id"),
                      "payer",
                      text(b.get("payer"), "付款人", 150),
                      "amountMinor",
                      positive(b.get("amount")),
                      "receivedOn",
                      received,
                      "evidence",
                      text(b.get("evidence"), "更正依据", 1000)));
        }

        case "credit" -> {
          role("business", "finance");
          Doc customer = get(b.get("customerId"), "customer");
          long limit = minor(b.get("limit"), "授信总额", false);
          String valid = day(b.get("validUntil"));
          require(valid != null && valid.compareTo(date()) >= 0, 400, "授信有效期无效");
          p =
              p.with(
                  "customerId",
                  customer.s("id"),
                  "limitMinor",
                  limit,
                  "validUntil",
                  valid,
                  "maxTermDays",
                  integer(b, "maxTermDays", 1, 365),
                  "maxSingleMinor",
                  minor(b.get("maxSingle"), "单笔上限"),
                  "conditions",
                  text(b.get("conditions"), "授信条件及依据", 1000),
                  "expectedVersion",
                  Optional.ofNullable(credit(customer.s("id")))
                      .map(x -> x.l("version"))
                      .orElse(0L));
        }
        case "exception" -> {
          Doc batch = get(b.get("batchId"), "batch");
          Doc gate = gate(batch);
          require(
              gate.strings("hard").isEmpty() && !gate.strings("soft").isEmpty(),
              409,
              "仅支持事实和硬性条件满足后的例外；请先处理补款、授信或库存问题");
          p =
              p.with(
                  "batchId",
                  batch.s("id"),
                  "orderId",
                  batch.s("orderId"),
                  "customerId",
                  batch.s("customerId"),
                  "stateHash",
                  gate.get("stateHash"),
                  "gateSnapshot",
                  gate,
                  "measures",
                  text(b.get("measures"), "补偿措施及责任人", 1000));
        }
        case "amend" -> {
          role("business");
          Doc o = get(b.get("orderId"), "order");
          require(o.eq("status", "active") || o.eq("status", "draft"), 409, "订单不可变更");
          require(
              related("batch", "orderId", o.s("id")).stream()
                  .noneMatch(x -> !x.eq("status", "cancelled")),
              409,
              "请先取消未执行批次；已实际出库的订单请取消剩余部分后建立关联新单");
          Doc payload = contract(b);
          require(payload.same("customerId", o, "customerId"), 409, "客户不可直接变更，请新建订单并重新分配资金");
          p =
              p.with(
                  "orderId",
                  o.s("id"),
                  "customerId",
                  o.s("customerId"),
                  "expectedVersion",
                  o.l("version"),
                  "payload",
                  payload,
                  "proposedTotalMinor",
                  total(payload),
                  "previousTotalMinor",
                  total(o),
                  "contractSnapshot",
                  o);
        }
        case "reverse_allocation" -> {
          role("finance");
          Doc a = get(b.get("allocationId"), "allocation");
          require(a.eq("status", "active") && a.l("refundedMinor") == 0, 409, "已冲销或已退款的分配不能直接撤销");
          p =
              p.with(
                  "allocationId",
                  a.s("id"),
                  "orderId",
                  a.s("orderId"),
                  "customerId",
                  a.s("customerId"),
                  "expectedVersion",
                  a.l("version"));
        }
        case "return" -> {
          Doc batch = get(b.get("batchId"), "batch");
          require(batch.eq("status", "shipped"), 409, "只有已出库批次可申请退货");
          long qty = quantity(b.get("quantity"));
          long pending =
              related("approval", "batchId", batch.s("id")).stream()
                  .filter(
                      x ->
                          x.eq("type", "return")
                              && !List.of("rejected", "inspection_rejected")
                                  .contains(x.s("status")))
                  .mapToLong(x -> x.l("quantityGram"))
                  .sum();
          require(qty <= batch.l("quantityGram") - pending, 409, "退货数量超过尚可退数量");
          p =
              p.with(
                  "batchId",
                  batch.s("id"),
                  "orderId",
                  batch.s("orderId"),
                  "customerId",
                  batch.s("customerId"),
                  "quantityGram",
                  qty);
        }
        case "refund" -> {
          role("finance");
          Doc o = get(b.get("orderId"), "order");
          long amount = positive(b.get("amount"));
          require(amount <= cash(o) - refundReserved(o, null), 409, "本单未使用余额不足或已被其他退款预留");
          require(plans(o).isEmpty(), 409, "请先取消待执行出库批次，释放预留资金");
          require(debt(o.s("id")) == 0, 409, "本单仍有未清应收，请先核对");
          p =
              p.with(
                  "orderId",
                  o.s("id"),
                  "customerId",
                  o.s("customerId"),
                  "amountMinor",
                  amount,
                  "payee",
                  text(b.get("payee"), "原付款方收款账户标识", 200),
                  "fundingHash",
                  fundingFingerprint(o));
        }
        case "adjustment" -> {
          Doc batch = get(b.get("batchId"), "batch");
          require(batch.eq("status", "shipped"), 409, "请对已出库批次申请减免调整");
          require(
              !get(batch.get("orderId"), "order").eq("status", "closed"), 409, "订单已结清，请先申请重新开启售后");
          long amount = positive(b.get("amount"));
          require(amount <= net(batch), 409, "调整不能使应收为负数");
          p =
              p.with(
                  "batchId",
                  batch.s("id"),
                  "orderId",
                  batch.s("orderId"),
                  "customerId",
                  batch.s("customerId"),
                  "amountMinor",
                  amount,
                  "expectedVersion",
                  batch.l("version"),
                  "evidence",
                  text(b.get("evidence"), "质量扣款或费用调整依据", 1000));
        }
        case "hold" -> {
          Doc customer = get(b.get("customerId"), "customer");
          require(b.get("held") instanceof Boolean, 400, "须明确暂停或恢复");
          p =
              p.with(
                  "customerId",
                  customer.s("id"),
                  "held",
                  b.b("held"),
                  "expectedVersion",
                  customer.l("version"));
        }
        default -> throw fail(400, "申请类型无效");
      }
      return insert(p);
    }

    Doc decide(Doc b) {
      checked(b);
      Doc a = get(b.get("approvalId"), "approval");
      require(a.eq("status", "pending"), 409, "申请已处理，请查询原业务键");
      require(!a.same("requestedBy", user, "id"), 403, "申请人不能审批自己的申请");
      String decision = choice(b.get("decision"), List.of("approved", "rejected"), "审批决定");
      String explanation = reason(b);
      if (decision.equals("approved")) {
        switch (a.s("type")) {
          case "receipt_unconfirm" -> {
            Doc r = get(a.get("receiptId"), "receipt");
            require(
                r.eq("status", "confirmed")
                    && r.l("version") == a.l("expectedVersion")
                    && r.l("refundedMinor") == 0
                    && related("allocation", "receiptId", r.s("id")).stream()
                        .noneMatch(x -> x.eq("status", "active"))
                    && related("approval", "receiptId", r.s("id")).stream()
                        .noneMatch(
                            x -> x.eq("type", "receipt_refund") && x.eq("status", "approved")),
                409,
                "原流水已有资金去向或状态变化");
            List<Doc> history = new ArrayList<>(r.rows("confirmationHistory"));
            history.add(
                Doc.of(
                    "confirmedBy",
                    r.get("confirmedBy"),
                    "confirmedAt",
                    r.get("confirmedAt"),
                    "evidence",
                    r.get("confirmationEvidence"),
                    "revokeApprovalId",
                    a.s("id")));
            save(
                r.with(
                    "status",
                    "pending",
                    "confirmedBy",
                    null,
                    "confirmedAt",
                    null,
                    "confirmationEvidence",
                    null,
                    "confirmationHistory",
                    history));
          }

          case "temporary_credit" -> {
            Doc o = get(a.get("orderId"), "order"), base = credit(o.s("customerId"));
            require(
                !o.eq("status", "closed")
                    && a.eq("contractHash", contractHash(o))
                    && base != null
                    && base.l("version") == a.l("baseCreditVersion"),
                409,
                "合同或基础授信已变化，请重新申请");
            Doc old = rows.get(ref("temporary-credit", company.s("id"), o.s("id")));
            require((old == null ? 0 : old.l("version")) == a.l("expectedVersion"), 409, "临时授信已变化");
            Doc value =
                Doc.of(
                    "id",
                    ref("temporary-credit", company.s("id"), o.s("id")),
                    "kind",
                    "temporary_credit",
                    "orderId",
                    o.s("id"),
                    "customerId",
                    o.s("customerId"),
                    "amountMinor",
                    a.l("amountMinor"),
                    "validUntil",
                    a.get("validUntil"),
                    "contractHash",
                    a.get("contractHash"),
                    "approvalId",
                    a.s("id"),
                    "conditions",
                    a.get("conditions"));
            if (old == null) insert(value);
            else save(old.withExtra(value));
          }

          case "stock_count" -> {
            Doc stock = get(a.get("stockId"), "stock");
            require(stock.l("version") == a.l("expectedVersion"), 409, "盘点后库存已变化，请重新盘点");
          }
          case "reopen" -> {
            Doc order = get(a.get("orderId"), "order");
            require(
                order.eq("status", "closed") && order.l("version") == a.l("expectedVersion"),
                409,
                "订单状态已变化");
            save(
                order.with(
                    "status",
                    order.l("cancelledGram") > 0 ? "cancelled" : "active",
                    "reopenApprovalId",
                    a.s("id")));
          }
          case "receipt_refund" -> {
            Doc receipt = get(a.get("receiptId"), "receipt");
            require(receiptFree(receipt) >= a.l("amountMinor"), 409, "未分配可退余额已变化");
          }
          case "receipt_correction" -> {
            Doc receipt = get(a.get("receiptId"), "receipt");
            require(
                receipt.eq("status", "pending") && receipt.l("version") == a.l("expectedVersion"),
                409,
                "原流水已核验或发生变化");
            Doc revised =
                receipt
                    .withExtra(a.d("payload"))
                    .with("recordedBy", a.get("requestedBy"), "correctionApprovalId", a.s("id"));
            Doc input =
                Doc.of(
                    "customerId",
                    revised.get("customerId"),
                    "bankAccount",
                    revised.get("bankAccount"),
                    "bankReference",
                    revised.get("bankReference"),
                    "payer",
                    revised.get("payer"),
                    "amountMinor",
                    revised.get("amountMinor"),
                    "receivedOn",
                    revised.get("receivedOn"),
                    "evidence",
                    revised.get("evidence"));
            save(revised.with("inputHash", digest(input)));
          }

          case "credit" -> {
            Doc old = credit(a.s("customerId"));
            require(
                (old == null ? 0 : old.l("version")) == a.l("expectedVersion"), 409, "授信已变化，请重新申请");
            Doc credit =
                Doc.of(
                    "id",
                    ref("credit", company.s("id"), a.s("customerId")),
                    "kind",
                    "credit",
                    "customerId",
                    a.s("customerId"),
                    "limitMinor",
                    a.l("limitMinor"),
                    "validUntil",
                    a.get("validUntil"),
                    "maxTermDays",
                    a.get("maxTermDays"),
                    "maxSingleMinor",
                    a.get("maxSingleMinor"),
                    "conditions",
                    a.get("conditions"),
                    "approvalId",
                    a.s("id"),
                    "approvedBy",
                    user.s("id"));
            if (old == null) insert(credit);
            else save(old.withExtra(credit));
          }
          case "exception" -> {
            Doc gate = gate(get(a.get("batchId"), "batch"));
            require(
                gate.strings("hard").isEmpty() && gate.eq("stateHash", a.get("stateHash")),
                409,
                "出库条件已变化，请重新提交例外申请");
            a = a.with("expiresAt", Instant.now().plusSeconds(86400).toString(), "consumed", false);
          }
          case "amend" -> {
            Doc o = get(a.get("orderId"), "order");
            require(
                o.l("version") == a.l("expectedVersion")
                    && related("batch", "orderId", o.s("id")).stream()
                        .noneMatch(x -> !x.eq("status", "cancelled")),
                409,
                "订单已经执行或变化");
            Doc revised =
                save(
                    o.withExtra(a.d("payload"))
                        .with("rulesSnapshot", company.get("rules"), "amendApprovalId", a.s("id")));
            if (revised.eq("status", "active")) {
              Doc stock = get(revised.get("stockId"), "stock");
              require(locked(stock.s("id")) <= stock.l("onHandGram"), 409, "变更后库存不足");
              if (revised.eq("paymentMode", "credit")) {
                List<String> issues = creditIssues(revised);
                require(issues.isEmpty(), 409, String.join("；", issues));
              }
            }
          }
          case "reverse_allocation" -> reverse(a);
          case "return" -> {
            Doc batch = get(a.get("batchId"), "batch");
            require(
                !get(a.get("orderId"), "order").eq("status", "closed"), 409, "订单已结清，请重新开启经授权的售后流程");
            require(batch.eq("status", "shipped"), 409, "原出库不存在");
          }
          case "refund" -> {
            Doc o = get(a.get("orderId"), "order");
            if (o.eq("paymentMode", "credit")) {
              Doc credit = credit(o.s("customerId"));
              require(
                  credit != null
                      && occupied(o.s("customerId"))
                              - temporaryOccupied(o.s("customerId"))
                              + a.l("amountMinor")
                          <= credit.l("limitMinor"),
                  409,
                  "退款将使授信占用超额，请先调整授信或减少退款");
            }
            require(
                plans(o).isEmpty()
                    && debt(o.s("id")) == 0
                    && cash(o) - refundReserved(o, a.s("id")) >= a.l("amountMinor"),
                409,
                "退款可用余额已变化");
            require(a.eq("fundingHash", fundingFingerprint(o)), 409, "资金来源变化，请重新申请");
          }
          case "adjustment" -> {
            Doc batch = get(a.get("batchId"), "batch");
            require(
                batch.l("version") == a.l("expectedVersion") && a.l("amountMinor") <= net(batch),
                409,
                "应收已变化");
            Doc changed =
                save(
                    batch.with("adjustmentMinor", batch.l("adjustmentMinor") + a.l("amountMinor")));
            releaseOverpayment(changed);
          }
          case "hold" -> {
            Doc customer = get(a.get("customerId"), "customer");
            require(customer.l("version") == a.l("expectedVersion"), 409, "客户状态已变化");
            if (!a.b("held"))
              require(
                  related("order", "customerId", customer.s("id")).stream()
                      .noneMatch(o -> o.eq("paymentMode", "cash") && debt(o.s("id")) > 0),
                  409,
                  "现款业务仍有未清债务，须先补款或审批调整付款条件");
            save(customer.with("held", a.b("held"), "holdReason", explanation));
          }
          default -> throw fail(400, "审批类型无效");
        }
      }
      Doc result =
          save(
              a.with(
                  "status",
                  decision,
                  "decidedBy",
                  user.s("id"),
                  "decidedAt",
                  now(),
                  "decisionReason",
                  explanation,
                  "decisionRulesSnapshot",
                  company.get("rules")));
      ledger("approval." + decision, result, result);
      return result;
    }

    void reverse(Doc a) {
      Doc allocation = get(a.get("allocationId"), "allocation");
      require(
          allocation.eq("status", "active")
              && allocation.l("refundedMinor") == 0
              && allocation.l("version") == a.l("expectedVersion"),
          409,
          "原分配已变化或已退款");
      Doc order = get(allocation.get("orderId"), "order");
      require(refundReserved(order, null) == 0, 409, "本单已有批准待执行退款，不能冲销其资金来源");
      require(!order.eq("status", "closed"), 409, "已结清订单不可直接冲销");
      for (Doc payment : related("payment", "allocationId", allocation.s("id")))
        save(
            payment.with(
                "reversedMinor", payment.l("amountMinor"), "reversalApprovalId", a.s("id")));
      save(allocation.with("status", "reversed", "reversalApprovalId", a.s("id")));
      Doc customer = get(order.get("customerId"), "customer"), credit = credit(customer.s("id"));
      if (order.eq("paymentMode", "cash") && debt(order.s("id")) > 0
          || occupied(customer.s("id")) - temporaryOccupied(customer.s("id"))
              > (credit == null ? 0 : credit.l("limitMinor")))
        save(customer.with("held", true, "holdReason", "冲销恢复债务，暂停新增业务等待复核"));
      ledger(
          "allocation.reverse",
          allocation,
          Doc.of(
              "approvalId",
              a.s("id"),
              "restoredDebtMinor",
              debt(order.s("id")),
              "creditOccupiedMinor",
              occupied(customer.s("id"))));
    }

    Doc receiveReturn(Doc b) {
      checked(b);
      Doc a = get(b.get("approvalId"), "approval");
      require(a.eq("type", "return") && a.eq("status", "approved"), 409, "退货尚未批准或已收回");
      Doc batch = get(a.get("batchId"), "batch"),
          order = get(batch.get("orderId"), "order"),
          stock = get(order.get("stockId"), "stock");
      save(stock.with("quarantineGram", stock.l("quarantineGram") + a.l("quantityGram")));
      Doc result =
          save(
              a.with(
                  "status",
                  "received",
                  "receivedBy",
                  user.s("id"),
                  "receivedAt",
                  now(),
                  "returnEvidence",
                  text(b.get("evidence"), "退回实物凭据", 1000)));
      ledger("return.quarantine", result, Doc.of("quantityGram", a.l("quantityGram")));
      return result;
    }

    Doc inspectReturn(Doc b) {
      checked(b);
      Doc a = get(b.get("approvalId"), "approval");
      require(a.eq("type", "return") && a.eq("status", "received"), 409, "退货尚未收到或已验收");
      require(!a.same("receivedBy", user, "id"), 403, "收货与验收确认须分离");
      String decision = choice(b.get("decision"), List.of("accepted", "rejected"), "验收结果");
      if (decision.equals("accepted")) {
        Doc batch = get(a.get("batchId"), "batch"),
            order = get(batch.get("orderId"), "order"),
            stock = get(order.get("stockId"), "stock");
        long prior =
            related("approval", "batchId", batch.s("id")).stream()
                .filter(x -> x.eq("type", "return") && x.eq("status", "accepted"))
                .mapToLong(x -> x.l("quantityGram"))
                .sum();
        require(a.l("quantityGram") <= batch.l("quantityGram") - prior, 409, "累计退货超过实际出库");
        long amount =
            a.l("quantityGram") + prior == batch.l("quantityGram")
                ? batch.l("goodsMinor") - batch.l("returnMinor")
                : fraction(batch.l("goodsMinor"), a.l("quantityGram"), batch.l("quantityGram"));
        require(amount <= net(batch), 409, "该批次已有减免调整，请先核对退货金额，不能重复减记应收");
        require(stock.l("quarantineGram") >= a.l("quantityGram"), 409, "待检库存不足");
        save(
            stock.with(
                "quarantineGram",
                stock.l("quarantineGram") - a.l("quantityGram"),
                "onHandGram",
                stock.l("onHandGram") + a.l("quantityGram")));
        Doc changed = save(batch.with("returnMinor", batch.l("returnMinor") + amount));
        releaseOverpayment(changed);
        a = a.with("creditedMinor", amount);
      }
      Doc result =
          save(
              a.with(
                  "status",
                  decision.equals("accepted") ? "accepted" : "inspection_rejected",
                  "inspectedBy",
                  user.s("id"),
                  "inspectionEvidence",
                  text(b.get("evidence"), "验收凭据", 1000),
                  "inspectedAt",
                  now()));
      ledger("return.inspect", result, result);
      return result;
    }

    void releaseOverpayment(Doc batch) {
      long excess = Math.max(0, paid(batch) - net(batch));
      List<Doc> payments = new ArrayList<>(related("payment", "batchId", batch.s("id")));
      Collections.reverse(payments);
      for (Doc payment : payments) {
        long part = Math.min(excess, payment.l("amountMinor") - payment.l("reversedMinor"));
        if (part > 0) {
          save(payment.with("reversedMinor", payment.l("reversedMinor") + part));
          excess -= part;
        }
        if (excess == 0) break;
      }
      require(excess == 0, 409, "退回资金核对失败");
    }

    Doc payRefund(Doc b) {
      checked(b);
      Doc a = get(b.get("approvalId"), "approval");
      if (a.eq("type", "receipt_refund")) return payReceiptRefund(a, b);
      require(a.eq("type", "refund") && a.eq("status", "approved"), 409, "退款尚未批准或已执行");
      require(!a.same("decidedBy", user, "id"), 403, "退款批准与执行须分离");
      Doc o = get(a.get("orderId"), "order");
      require(
          plans(o).isEmpty()
              && debt(o.s("id")) == 0
              && cash(o) - refundReserved(o, a.s("id")) >= a.l("amountMinor"),
          409,
          "退款前资金或订单状态已变化");
      require(a.eq("fundingHash", fundingFingerprint(o)), 409, "退款资金来源已变化，请重新申请");
      long left = a.l("amountMinor");
      List<Doc> details = new ArrayList<>();
      for (Doc allocation : related("allocation", "orderId", o.s("id"))) {
        if (!allocation.eq("status", "active")) continue;
        long
            free =
                allocation.l("amountMinor")
                    - allocation.l("refundedMinor")
                    - allocationUsed(allocation),
            part = Math.min(left, free);
        if (part > 0) {
          save(allocation.with("refundedMinor", allocation.l("refundedMinor") + part));
          details.add(
              Doc.of(
                  "allocationId",
                  allocation.s("id"),
                  "receiptId",
                  allocation.s("receiptId"),
                  "amountMinor",
                  part));
          left -= part;
        }
        if (left == 0) break;
      }
      require(left == 0, 409, "退款余额不足");
      Doc result =
          save(
              a.with(
                  "status",
                  "paid",
                  "paidBy",
                  user.s("id"),
                  "paidAt",
                  now(),
                  "paymentEvidence",
                  text(b.get("evidence"), "实际退款流水及原路账户核验", 1000),
                  "funding",
                  details));
      Doc customer = get(o.get("customerId"), "customer"), credit = credit(customer.s("id"));
      if (occupied(customer.s("id")) - temporaryOccupied(customer.s("id"))
          > (credit == null ? 0 : credit.l("limitMinor")))
        save(customer.with("held", true, "holdReason", "退款后额度覆盖不足，暂停新增业务等待复核"));
      ledger("refund.paid", result, result);
      return result;
    }

    Doc cancelApproval(Doc b) {
      Doc a = get(b.get("approvalId"), "approval");
      require(
          a.eq("status", "pending")
              || a.eq("status", "approved")
                  && List.of("return", "refund", "receipt_refund", "exception", "stock_count")
                      .contains(a.s("type"))
                  && !a.b("consumed"),
          409,
          "申请已经执行，须走对应纠错流程");
      if (a.eq("status", "approved")) role("manager");
      else
        require(
            a.same("requestedBy", user, "id") || member.strings("roles").contains("manager"),
            403,
            "仅申请人或负责人可以撤回");
      return save(
          a.with("status", "cancelled", "cancelReason", reason(b), "cancelledBy", user.s("id")));
    }

    Doc adjustStock(Doc b) {
      checked(b);
      Doc a = get(b.get("approvalId"), "approval");
      require(a.eq("type", "stock_count") && a.eq("status", "approved"), 409, "盘点尚未批准或已入账");
      Doc stock = get(a.get("stockId"), "stock");
      require(stock.l("version") == a.l("expectedVersion"), 409, "盘点后库存已经变化，请重新盘点");
      save(stock.with("onHandGram", a.l("quantityGram")));
      Doc result =
          save(
              a.with(
                  "status",
                  "applied",
                  "postedBy",
                  user.s("id"),
                  "postingEvidence",
                  text(b.get("evidence"), "盘点入账凭据", 1000)));
      ledger(
          "stock.count",
          result,
          Doc.of(
              "beforeGram",
              stock.l("onHandGram"),
              "afterGram",
              a.l("quantityGram"),
              "lockedGram",
              locked(stock.s("id"))));
      return result;
    }

    Doc payReceiptRefund(Doc a, Doc b) {
      require(a.eq("status", "approved"), 409, "退款尚未批准或已执行");
      require(!a.same("decidedBy", user, "id"), 403, "退款审批与执行须分离");
      Doc receipt = get(a.get("receiptId"), "receipt");
      require(
          receipt.eq("status", "confirmed")
              && receiptFree(receipt) + a.l("amountMinor") >= a.l("amountMinor"),
          409,
          "原流水可退余额不足");
      save(receipt.with("refundedMinor", receipt.l("refundedMinor") + a.l("amountMinor")));
      Doc result =
          save(
              a.with(
                  "status",
                  "paid",
                  "paidBy",
                  user.s("id"),
                  "paidAt",
                  now(),
                  "paymentEvidence",
                  text(b.get("evidence"), "实际原路退款凭据", 1000)));
      ledger("receipt.refund", result, result);
      return result;
    }

    Doc close(Doc b) {
      Doc o = get(b.get("orderId"), "order");
      require(List.of("active", "cancelled").contains(o.s("status")), 409, "订单不可结清");
      require(remaining(o) == 0 && plans(o).isEmpty(), 409, "仍有未出库、未取消或待执行的数量");
      require(debt(o.s("id")) == 0 && cash(o) == 0, 409, "仍有未清应收或待处理预收余额");
      require(
          related("approval", "orderId", o.s("id")).stream()
              .noneMatch(
                  x ->
                      List.of("pending", "received", "approved").contains(x.s("status"))
                          && (!x.eq("status", "approved")
                              || List.of("return", "refund").contains(x.s("type")))),
          409,
          "仍有未完成的审批、退货或退款");
      Doc result = save(o.with("status", "closed", "closedBy", user.s("id"), "closedAt", now()));
      ledger("order.close", result, result);
      return result;
    }

    Doc orderView(Doc o) {
      Doc stock = get(o.get("stockId"), "stock");
      Long cost =
          stock.get("costPerTonMinor") == null
              ? null
              : price(o.l("quantityGram"), stock.l("costPerTonMinor"));
      // A material price spread is not accounting profit; taxes, overhead and fees are excluded.
      Long gap =
          cost == null || !stock.eq("costTaxBasis", o.get("taxBasis"))
              ? null
              : price(o.l("quantityGram"), o.l("unitPriceMinor")) - cost;
      Long stressed =
          gap == null
              ? null
              : price(o.l("quantityGram"), o.l("unitPriceMinor"))
                  - BigDecimal.valueOf(cost)
                      .multiply(
                          BigDecimal.ONE.add(
                              BigDecimal.valueOf(company.d("rules").n("steelShockPct"))
                                  .movePointLeft(2)))
                      .setScale(0, RoundingMode.HALF_UP)
                      .longValueExact();
      List<Doc> freight = o.rows("fees").stream().filter(f -> f.eq("name", "运费")).toList();
      Long freightExtra =
          freight.isEmpty()
              ? null
              : freight.stream().anyMatch(f -> f.get("actualCostMinor") == null)
                  ? null
                  : BigDecimal.valueOf(sum(freight, "actualCostMinor"))
                      .multiply(BigDecimal.valueOf(company.d("rules").n("freightShockPct")))
                      .movePointLeft(2)
                      .setScale(0, RoundingMode.HALF_UP)
                      .longValueExact();
      return o.with(
          "freightStressExtraMinor",
          freightExtra,
          "totalMinor",
          total(o),
          "remainingGram",
          remaining(o),
          "unplannedGram",
          remaining(o) - plannedQty(o, null),
          "paidMinor",
          related("batch", "orderId", o.s("id")).stream()
              .filter(x -> x.eq("status", "shipped"))
              .mapToLong(this::paid)
              .sum(),
          "cashAvailableMinor",
          Math.max(0, cash(o) - refundReserved(o, null)),
          "refundReservedMinor",
          refundReserved(o, null),
          "cashReservedMinor",
          reservations(o).values().stream().mapToLong(x -> x).sum(),
          "debtMinor",
          debt(o.s("id")),
          "occupiedMinor",
          orderExposure(o),
          "priceSpreadMinor",
          gap,
          "stressedSpreadMinor",
          stressed,
          "costSource",
          stock.get("costSource"),
          "temporaryCredit",
          temporary(o),
          "creditIssues",
          o.eq("paymentMode", "credit") ? creditIssues(o) : List.of());
    }

    Doc batchView(Doc b) {
      return b.with(
          "paidMinor",
          paid(b),
          "netMinor",
          b.eq("status", "shipped") ? net(b) : null,
          "debtMinor",
          b.eq("status", "shipped") ? batchDebt(b) : null,
          "overdueDays",
          b.get("dueDate") == null || batchDebt(b) == 0
              ? 0
              : Math.max(0, Inputs.days(b.s("dueDate"), date())),
          "gate",
          List.of("planned", "weighed").contains(b.s("status")) ? gate(b) : null);
    }

    void syncAlerts() {
      Doc system = Doc.of("id", "system:steel-monitor");
      List<Doc> current = tasks();
      Set<String> active = new HashSet<>();
      for (Doc task : current) {
        String id = ref("alert", company.s("id"), task.s("id"));
        active.add(id);
        Doc old = rows.get(id);
        String fingerprint = digest(task.with("rulesVersion", company.d("rules").l("version")));
        if (old != null && old.eq("status", "open") && old.eq("inputHash", fingerprint)) continue;
        Doc source = rows.get(task.s("id"));
        if (task.get("batchId") != null) source = get(task.get("batchId"), "batch");
        else if (task.s("id").startsWith("overdue:"))
          source = get(task.s("id").substring(8), "batch");
        else if (task.s("id").startsWith("stock-shortage:"))
          source = get(task.s("id").substring(15), "stock");
        if (source != null && source.eq("kind", "batch"))
          source =
              source.with(
                  "calculatedPaidMinor", paid(source), "calculatedDebtMinor", batchDebt(source));
        Doc record =
            task.with(
                "inputSnapshot",
                Doc.of(
                    "trigger",
                    task,
                    "sourceRecord",
                    source,
                    "orderRecord",
                    task.get("orderId") == null ? null : get(task.get("orderId"), "order")),
                "id",
                id,
                "taskId",
                task.s("id"),
                "kind",
                "alert",
                "ownerId",
                company.s("id"),
                "dataClass",
                company.get("dataClass"),
                "status",
                "open",
                "inputHash",
                fingerprint,
                "evaluatedAt",
                now(),
                "rulesSnapshot",
                company.get("rules"));
        if (old == null) {
          record = record.with("createdAt", now(), "createdBy", system.s("id"), "version", 1);
          db.insert(BUCKET, record);
        } else {
          record =
              old.withExtra(record)
                  .with(
                      "updatedAt",
                      now(),
                      "updatedBy",
                      system.s("id"),
                      "version",
                      old.l("version") + 1);
          db.put(BUCKET, record);
        }
        rows.put(id, record);
        audit.audit(system, company.s("accountOwner"), "steel.alert.open_or_update", id, record);
      }
      for (Doc old : new ArrayList<>(kind("alert")))
        if (old.eq("status", "open") && !active.contains(old.s("id"))) {
          Doc resolved =
              old.with(
                  "status",
                  "resolved",
                  "resolvedAt",
                  now(),
                  "updatedBy",
                  system.s("id"),
                  "version",
                  old.l("version") + 1,
                  "resolutionReason",
                  "当前规则及业务状态下不再触发",
                  "resolutionRulesSnapshot",
                  company.get("rules"));
          db.put(BUCKET, resolved);
          rows.put(resolved.s("id"), resolved);
          audit.audit(
              system,
              company.s("accountOwner"),
              "steel.alert.resolved",
              resolved.s("id"),
              resolved);
        }
    }

    List<Doc> tasks() {
      List<Doc> tasks = new ArrayList<>();
      for (Doc stock : kind("stock"))
        if (locked(stock.s("id")) > stock.l("onHandGram"))
          tasks.add(
              Doc.of(
                  "id",
                  "stock-shortage:" + stock.s("id"),
                  "type",
                  "stock",
                  "title",
                  "库存批次 " + stock.s("number") + " 的可售库存少于已承诺数量",
                  "role",
                  "warehouse",
                  "quantityGram",
                  locked(stock.s("id")) - stock.l("onHandGram")));
      for (Doc a : kind("approval"))
        if (a.eq("status", "pending"))
          tasks.add(
              Doc.of(
                  "id",
                  a.s("id"),
                  "type",
                  "approval",
                  "title",
                  "待负责人审批：" + approvalName(a.s("type")),
                  "role",
                  "manager",
                  "orderId",
                  a.get("orderId")));
      for (Doc r : kind("receipt"))
        if (r.eq("status", "pending"))
          tasks.add(
              Doc.of(
                  "id",
                  r.s("id"),
                  "type",
                  "receipt",
                  "title",
                  "待核验到账：" + r.s("bankReference"),
                  "role",
                  "finance"));
      for (Doc batch : kind("batch")) {
        if (List.of("planned", "weighed").contains(batch.s("status"))) {
          Doc gate = gate(batch);
          for (String issue :
              Stream.concat(gate.strings("hard").stream(), gate.strings("soft").stream()).toList())
            tasks.add(
                Doc.of(
                    "id",
                    batch.s("id")
                        + ":"
                        + CanonicalJson.sha256(issue.replaceAll("[0-9]+([.][0-9]+)?", "#")),
                    "type",
                    "shipping",
                    "title",
                    issue,
                    "role",
                    issue.contains("收款")
                        ? "finance"
                        : issue.contains("库存") || issue.contains("计重") ? "warehouse" : "business",
                    "orderId",
                    batch.get("orderId"),
                    "batchId",
                    batch.s("id")));
        }
        if (batch.eq("status", "shipped") && batchDebt(batch) > 0) {
          long days = Math.max(0, Inputs.days(batch.s("dueDate"), date()));
          if (days >= company.d("rules").l("overdueWarningDays"))
            tasks.add(
                Doc.of(
                    "id",
                    "overdue:" + batch.s("id"),
                    "type",
                    "overdue",
                    "title",
                    batch.s("number") + " 逾期 " + days + " 天",
                    "level",
                    days >= company.d("rules").l("overdueEscalationDays") ? "escalated" : "warning",
                    "role",
                    "business",
                    "orderId",
                    batch.get("orderId"),
                    "amountMinor",
                    batchDebt(batch)));
        }
      }
      for (Doc a : kind("approval"))
        if (a.eq("type", "return") && a.eq("status", "received"))
          tasks.add(
              Doc.of(
                  "id",
                  "inspect:" + a.s("id"),
                  "type",
                  "inspection",
                  "title",
                  "退货已收到，待验收",
                  "role",
                  "manager",
                  "orderId",
                  a.get("orderId")));
      return tasks;
    }
  }

  private static String approvalName(String type) {
    return switch (type) {
      case "credit" -> "授信调整";
      case "temporary_credit" -> "本单临时授信";
      case "exception" -> "本批例外";
      case "amend" -> "合同变更";
      case "reverse_allocation" -> "核销冲销";
      case "return" -> "退货";
      case "refund", "receipt_refund" -> "退款";
      case "adjustment" -> "应收减免";
      case "hold" -> "客户暂停或恢复";
      case "stock_count" -> "库存盘点";
      case "reopen" -> "重新开启售后";
      case "receipt_correction" -> "到账资料更正";
      case "receipt_unconfirm" -> "撤销误核验";
      default -> "业务申请";
    };
  }

  private Doc demo() {
    try (var in = getClass().getResourceAsStream("/steel-demo.json")) {
      return Doc.JSON.readValue(in, Doc.class);
    } catch (Exception e) {
      throw new IllegalStateException("Demo resource unavailable", e);
    }
  }
}
