package com.induport.risk;

import static com.induport.common.BusinessException.*;
import static com.induport.common.CanonicalJson.*;
import static com.induport.common.Inputs.*;
import static com.induport.risk.RiskRepository.*;

import com.induport.auth.AuthService;
import com.induport.common.*;
import com.induport.trade.TradeService;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class RiskService {
  private final RiskRepository r;
  private final RiskMath math;
  private final MonitorService monitor;

  public RiskService(RiskRepository r, RiskMath math, MonitorService monitor) {
    this.r = r;
    this.math = math;
    this.monitor = monitor;
  }

  public Doc evaluation(Doc t) {
    Doc p = r.get(t.get("profileId")),
        c = monitor.control(t),
        policy = t.b("isDemo") ? DEFAULT_RULES.with("demoScenario", true) : r.rules();
    Doc e =
        t.b("isDemo") && t.l("demoSetVersion") == 2
            ? math.demoEvaluation(t, p)
            : math.evaluate(
                t, p, policy, r.get(accountId(t.get("profileId"), t.get("currency"))), c);
    return e.with(
        "dimensions",
        monitor.dimensions(t, p, e),
        "security",
        monitor.security(t, c),
        "reviewSnapshot",
        t.b("isDemo") ? null : monitor.review(p));
  }

  public Doc saveEvaluation(Doc u, Doc t) {
    Doc row =
        evaluation(t)
            .with(
                "id",
                id("EVAL-"),
                "kind",
                "evaluation",
                "ownerId",
                t.get("ownerId"),
                "tradeId",
                t.get("id"));
    r.insert(row);
    r.audit(u, t.s("ownerId"), "evaluation", row.s("id"), row);
    return row;
  }

  public Doc view(Doc u) {
    List<Doc> rows =
        r.rows().stream()
            .filter(
                x ->
                    u.b("isDemo")
                        ? x.b("isDemo")
                            && x.same("ownerId", u, "id")
                            && x.l("demoSetVersion") == u.l("demoSeedVersion")
                        : owns(u, x) && !x.b("isDemo"))
            .toList();
    List<Doc> assessments = new ArrayList<>();
    for (Doc t : rows)
      if (t.eq("kind", "trade")) assessments.add(evaluation(t).with("tradeId", t.get("id")));
    List<Doc> audit =
        r.db.all("risk_audit").stream()
            .filter(
                x ->
                    u.b("isDemo")
                        ? x.b("isDemo") && x.same("ownerId", u, "id")
                        : !x.b("isDemo") && (owns(u, x) || x.eq("ownerId", "*")))
            .sorted(Comparator.comparingLong((Doc x) -> x.l("sequence")).reversed())
            .toList();
    List<Doc> assignees =
        r.db.all("users").stream()
            .filter(
                x ->
                    u.b("isDemo")
                        ? x.same("id", u, "id")
                        : x.same("id", u, "id") || x.eq("role", "admin"))
            .map(x -> Doc.of("id", x.get("id"), "displayName", x.get("displayName")))
            .toList();
    return Doc.of(
        "reviews",
        u.b("isDemo")
            ? List.of()
            : rows.stream()
                .filter(p -> p.eq("kind", "profile") && real(p.get("source")))
                .map(monitor::review)
                .toList(),
        "rules",
        u.b("isDemo") ? DEFAULT_RULES.with("demoScenario", true) : r.rules(),
        "demo",
        u.b("isDemo"),
        "records",
        rows,
        "assessments",
        assessments,
        "audit",
        audit,
        "assignees",
        assignees);
  }

  public Doc profile(Doc u, Doc b, String method) {
    Doc input = math.profileInput(b);
    String id = key("profile", u.get("id"), input.get("businessKey"));
    Doc old = r.get(id);
    if (old != null) {
      require(
          old.eq("inputHash", digest(input))
              || input.get("platformAccountId") == null
                  && old.eq("inputHash", digest(input.without("platformAccountId"))),
          409,
          "档案业务唯一键已用于不同内容");
      return old;
    }
    Doc row =
        input.with(
            "id",
            id,
            "kind",
            "profile",
            "inputMethod",
            method,
            "ownerId",
            u.get("id"),
            "createdBy",
            u.get("id"),
            "version",
            1,
            "inputHash",
            digest(input),
            "createdAt",
            now());
    r.insert(row);
    r.audit(u, u.s("id"), "profile.create", id, row);
    return row;
  }

  public Doc patchProfile(Doc u, String id, Doc b) {
    Doc old = r.accessible(u, id, "profile");
    require(b.l("version") == old.l("version"), 409, "资料已更新，请刷新");
    Doc input = math.profileInput(old.withExtra(b));
    require(
        input.same("source", old, "source")
            && input.same("businessKey", old, "businessKey")
            && input.same("partyType", old, "partyType")
            && (old.get("platformAccountId") == null
                || input.same("platformAccountId", old, "platformAccountId")),
        400,
        "来源、业务唯一键和类型不可修改，请新建档案");
    String reason = text(b.get("reason"), "修改理由", 1000);
    Doc result =
        old.withExtra(input)
            .with("version", old.l("version") + 1, "updatedBy", u.get("id"), "updatedAt", now());
    r.put(result);
    r.audit(
        u,
        old.s("ownerId"),
        "profile.update",
        id,
        Doc.of("before", old, "after", result, "reason", reason));
    return result;
  }

  public Doc trade(Doc u, Doc b, String method) {
    Doc input = math.tradeInput(b), p = r.accessible(u, input.get("profileId"), "profile");
    require(
        input.eq("direction", "sale")
            ? p.eq("partyType", "customer")
            : p.eq("partyType", "supplier"),
        400,
        "销售合同须关联客户，采购合同须关联供应商");
    String id = key("trade", p.get("ownerId"), input.get("businessKey"));
    Doc old = r.get(id);
    if (old != null) {
      require(old.eq("inputHash", digest(input)), 409, "订单业务唯一键已用于不同内容");
      return old;
    }
    if (input.get("platformOrderId") != null) {
      require(real(input.get("source")) && real(p.get("source")), 400, "预估或示例合同不能绑定真实平台订单");
      Doc order = r.db.get("orders", input.get("platformOrderId")),
          supplier = order == null ? null : r.db.get("suppliers", order.get("supplierId"));
      boolean authorized =
          input.eq("direction", "purchase")
              ? order != null && order.same("ownerId", p, "ownerId")
              : supplier != null && supplier.same("ownerId", p, "ownerId");
      require(order != null && !order.b("isSample") && authorized, 404, "只能关联本账号有权管理的真实平台订单");
      if (input.eq("direction", "sale"))
        require(p.same("platformAccountId", order, "ownerId"), 400, "客户档案须绑定该订单买家的平台账号");
      require(
          input.eq("currency", "USD")
              && input.l("amountMinor") == round(order.n("total") * 100)
              && input.n("quantity") == order.n("quantity")
              && input.eq("unit", TradeService.unit(order))
              && input.same("term", order, "term"),
          400,
          "关联订单的币种、金额、数量、单位和条款必须一致");
      require(
          r.rows().stream()
              .noneMatch(
                  x ->
                      x.eq("kind", "trade")
                          && !x.b("cancelled")
                          && x.same("platformOrderId", input, "platformOrderId")
                          && x.same("direction", input, "direction")),
          409,
          "该方向的平台订单已有风控合同，不能重复敞口");
    }
    Doc row =
        input.with(
            "id",
            id,
            "kind",
            "trade",
            "inputMethod",
            method,
            "ownerId",
            p.get("ownerId"),
            "version",
            1,
            "reserved",
            false,
            "receivedMinor",
            0,
            "releasedMinor",
            0,
            "cancelled",
            false,
            "createdAt",
            now(),
            "inputHash",
            digest(input));
    r.insert(row);
    r.audit(u, p.s("ownerId"), "trade.create", id, row);
    saveEvaluation(u, row);
    return row;
  }

  public Doc archive(Doc u, String id, Doc b) {
    Doc t = r.accessible(u, id, "trade"), p = r.get(t.get("profileId"));
    require(
        !(real(t.get("source")) && real(p.get("source")))
            && !t.b("reserved")
            && t.l("receivedMinor") == 0
            && t.l("releasedMinor") == 0,
        409,
        "真实财务合同须经过取消或冲销审批");
    Doc result = t.with("cancelled", true, "version", t.l("version") + 1);
    r.put(result);
    r.audit(
        u,
        t.s("ownerId"),
        "trade.archive_estimate",
        id,
        Doc.of("before", t, "after", result, "reason", text(b.get("reason"), "归档理由", 1000)));
    return result;
  }

  public Doc request(Doc u, String type, Doc b) {
    require(List.of("credit", "reserve", "release").contains(type), 404, "接口不存在");
    Doc t = type.equals("credit") ? null : r.accessible(u, b.get("tradeId"), "trade"),
        p =
            type.equals("credit")
                ? r.accessible(u, b.get("profileId"), "profile")
                : r.get(t.get("profileId"));
    require(
        real(p.get("source")) && (t == null || real(t.get("source"))), 400, "预估或示例不可授信、占额或收款核销");
    Doc input =
        Doc.of(
            "type",
            type,
            "profileId",
            p.get("id"),
            "tradeId",
            t == null ? null : t.get("id"),
            "businessKey",
            text(b.get("businessKey"), "操作业务唯一键", 100),
            "reason",
            text(b.get("reason"), "申请理由", 1000),
            "acknowledgeMissing",
            b.b("acknowledgeMissing"));
    if (type.equals("credit")) {
      require(p.eq("partyType", "customer"), 400, "赊销授信仅适用于客户");
      String currency = choice(b.get("currency"), RiskMath.CURRENCIES, "授信币种"),
          valid = day(b.get("validUntil"));
      require(valid != null && valid.compareTo(today()) >= 0, 400, "授信有效期无效");
      double term = number(b.get("maxTermDays"), "最长账期", 1, 365);
      require(term == Math.rint(term), 400, "最长账期须为整数");
      Doc account = r.get(accountId(p.get("id"), currency));
      input.putAll(
          Doc.of(
              "currency",
              currency,
              "amountMinor",
              minor(b.get("amount"), "授信额度", false),
              "accountVersion",
              account == null ? 0 : account.get("version"),
              "validUntil",
              valid,
              "maxTermDays",
              term,
              "maxSingleMinor",
              minor(b.get("maxSingleAmount"), "单笔上限"),
              "conditions",
              text(b.get("conditions"), "授信条件", 1000)));
    } else input.put("currency", t.get("currency"));
    String id = key("approval", p.get("ownerId"), List.of(type, input.get("businessKey"))),
        hash = digest(input.without("accountVersion"));
    Doc old = r.get(id);
    if (old != null) {
      require(old.eq("inputHash", hash), 409, "操作业务唯一键已用于不同内容");
      return old;
    }
    if (t != null) {
      if (type.equals("reserve")) require(!t.b("reserved") && !t.b("cancelled"), 409, "订单已占额或已取消");
      else require(!t.b("cancelled"), 409, "订单已取消");
    }
    Doc row =
        input.with(
            "id",
            id,
            "kind",
            "approval",
            "ownerId",
            p.get("ownerId"),
            "requestedBy",
            u.get("id"),
            "controlVersion",
            2,
            "status",
            "pending",
            "createdAt",
            now(),
            "inputHash",
            hash,
            "rulesSnapshot",
            r.rules(),
            "profileSnapshot",
            p,
            "evaluationSnapshot",
            t == null ? null : evaluation(t));
    r.insert(row);
    r.audit(u, p.s("ownerId"), "approval.request", id, row);
    return row;
  }

  @com.induport.integration.BusinessEvent("credit.decided")
  public Doc decide(Doc u, String id, Doc b) {
    AuthService.admin(u);
    Doc a = r.accessible(u, id, "approval");
    String decision = choice(b.get("decision"), List.of("approved", "rejected"), "审批决定"),
        reason = text(b.get("reason"), "审批理由", 1000);
    if (!a.eq("status", "pending")) {
      require(a.eq("status", decision) && a.eq("decisionReason", reason), 409, "申请已处理，不可覆盖历史审批");
      return a;
    }
    require(!a.same("requestedBy", u, "id"), 403, "申请人与审批人必须分离，请由另一位管理员复核");
    require(!a.eq("type", "receipt"), 409, "旧收款申请须改为到账登记、独立确认和分配核销流程");
    Doc p = r.get(a.get("profileId")), decisionEvaluation = null;
    if (decision.equals("approved")) {
      require(real(p.get("source")), 400, "预估/示例档案不可进入真实额度账");
      if (a.eq("type", "credit")) {
        Doc review = monitor.review(p);
        require(review.strings("hard").isEmpty(), 409, String.join("；", review.strings("hard")));
        require(
            a.get("validUntil") != null
                && a.s("validUntil").compareTo(today()) >= 0
                && a.l("maxTermDays") > 0
                && !blank(a.get("conditions")),
            409,
            "授信有效期或条件已失效，请重新申请");
        require(
            !blank(p.get("registration"))
                    && !blank(p.get("country"))
                    && !blank(p.get("financialEvidence"))
                    && !blank(p.get("performanceEvidence"))
                || a.b("acknowledgeMissing"),
            400,
            "资料待补齐；申请须明确确认缺失资料，并由管理员说明审批理由");
        String accountId = accountId(p.get("id"), a.get("currency"));
        Doc c = r.get(accountId);
        require((c == null ? 0 : c.l("version")) == a.l("accountVersion"), 409, "授信已变更，请重新提交申请");
        require(a.l("amountMinor") >= (c == null ? 0 : c.l("occupiedMinor")), 409, "授信额度不能低于当前占用");
        r.put(
            Doc.of(
                "id",
                accountId,
                "kind",
                "credit",
                "profileId",
                p.get("id"),
                "ownerId",
                p.get("ownerId"),
                "currency",
                a.get("currency"),
                "limitMinor",
                a.get("amountMinor"),
                "occupiedMinor",
                c == null ? 0 : c.get("occupiedMinor"),
                "version",
                (c == null ? 0 : c.l("version")) + 1,
                "approvalId",
                id,
                "validUntil",
                a.get("validUntil"),
                "maxTermDays",
                a.get("maxTermDays"),
                "maxSingleMinor",
                a.get("maxSingleMinor"),
                "conditions",
                a.get("conditions"),
                "frozen",
                false,
                "controlVersion",
                2,
                "profileVersion",
                p.get("version")));
      } else {
        Doc t = r.get(a.get("tradeId"));
        decisionEvaluation = evaluation(t);
        Doc c = r.get(accountId(p.get("id"), t.get("currency")));
        if (a.eq("type", "reserve")) {
          require(!t.b("reserved") && !t.b("cancelled"), 409, "订单已占额或取消");
          require(
              t.eq("direction", "sale")
                  && t.eq("paymentMode", "credit")
                  && t.get("dueDate") != null
                  && t.get("currency") != null
                  && t.l("amountMinor") > 0,
              400,
              "占额需要销售赊销合同、到期日及明确金额币种");
          long amount = balance(t);
          require(amount > 0, 409, "本单已全额核销，无需新增占用");
          List<String> issues = new ArrayList<>(creditProblems(c, t, p));
          issues.addAll(monitor.review(p).strings("hard"));
          require(issues.isEmpty(), 409, String.join("；", issues));
          require(t.s("dueDate").compareTo(today()) >= 0, 409, "逾期合同不能通过新订单预占授信");
          require(
              decisionEvaluation.strings("missing").isEmpty() || a.b("acknowledgeMissing"),
              400,
              "资料待补齐，须明确确认缺失资料后申请人工审批");
          require(
              c != null && amount <= c.l("limitMinor") - c.l("occupiedMinor"),
              409,
              "未获批足够授信，不能占用额度");
          r.put(
              c.with(
                  "occupiedMinor",
                  new Money(t.s("currency"), c.l("occupiedMinor"))
                      .add(new Money(t.s("currency"), amount))
                      .minor()));
          r.put(t.with("reserved", true, "reservedAt", now(), "reserveApprovalId", id));
          r.insert(
              Doc.of(
                  "id",
                  key("ledger", t.get("ownerId"), id),
                  "kind",
                  "ledger",
                  "ownerId",
                  t.get("ownerId"),
                  "profileId",
                  p.get("id"),
                  "tradeId",
                  t.get("id"),
                  "currency",
                  t.get("currency"),
                  "amountMinor",
                  amount,
                  "action",
                  "reserve",
                  "approvalId",
                  id,
                  "createdAt",
                  now()));
        } else {
          require(
              r.rows().stream()
                  .noneMatch(
                      x ->
                          x.eq("kind", "receivable")
                                  && x.same("tradeId", t, "id")
                                  && !x.eq("status", "voided")
                              || x.eq("kind", "flow_approval")
                                  && x.eq("type", "shipment")
                                  && x.same("tradeId", t, "id")
                                  && x.get("consumedAt") != null),
              409,
              "存在应收或已发货记录，须先办理财务冲销，不能直接取消释放");
          if (!t.b("reserved") && !t.b("cancelled"))
            r.put(t.with("cancelled", true, "version", t.l("version") + 1));
          else {
            require(t.b("reserved") && !t.b("cancelled") && c != null, 409, "订单未占额或已经取消");
            long amount = balance(t);
            require(amount > 0 && amount <= c.l("occupiedMinor"), 409, "释放金额超出未结清敞口，或订单已经结清");
            r.put(c.with("occupiedMinor", c.l("occupiedMinor") - amount));
            r.put(
                t.with(
                    "releasedMinor",
                    t.l("releasedMinor") + amount,
                    "cancelled",
                    true,
                    "version",
                    t.l("version") + 1));
            r.insert(
                Doc.of(
                    "id",
                    key("ledger", t.get("ownerId"), id),
                    "kind",
                    "ledger",
                    "ownerId",
                    t.get("ownerId"),
                    "profileId",
                    p.get("id"),
                    "tradeId",
                    t.get("id"),
                    "currency",
                    t.get("currency"),
                    "amountMinor",
                    -amount,
                    "action",
                    "release",
                    "source",
                    t.get("source"),
                    "sourceNote",
                    a.get("reason"),
                    "approvalId",
                    id,
                    "createdAt",
                    now()));
          }
        }
      }
    }
    Doc result =
        a.with(
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
            "decisionEvaluation",
            decisionEvaluation,
            "decisionProfileSnapshot",
            p,
            "decisionReviewSnapshot",
            monitor.review(p));
    r.put(result);
    r.audit(u, a.s("ownerId"), "approval." + decision, id, result);
    return result;
  }

  public Doc rules(Doc u, Doc b) {
    AuthService.admin(u);
    Doc old = r.rules();
    require(b.l("version") == old.l("version"), 409, "规则已更新，请刷新");
    Doc input = new Doc();
    for (String k :
        List.of("overdueWarningDays", "overdueEscalationDays", "marketDataMaxAgeDays")) {
      double d = number(b.getOrDefault(k, old.get(k)), k, 1, 365);
      require(d == Math.rint(d), 400, "天数须为整数");
      input.put(k, d);
    }
    require(input.n("overdueEscalationDays") >= input.n("overdueWarningDays"), 400, "升级天数不能早于预警");
    for (String k : List.of("steelShockPct", "fxShockPct", "freightShockPct"))
      input.put(k, number(b.get(k), k, 0, 99));
    Doc result =
        old.withExtra(input)
            .with("version", old.l("version") + 1, "updatedAt", now(), "updatedBy", u.get("id"));
    r.put(result);
    r.audit(
        u,
        "*",
        "rules.update",
        "rules",
        Doc.of("before", old, "after", result, "reason", text(b.get("reason"), "规则调整理由", 1000)));
    return result;
  }

  public Doc scan(Doc u) {
    int created = 0;
    for (Doc t : r.rows())
      if (t.eq("kind", "trade") && !t.b("isDemo") && owns(u, t) && !t.b("cancelled")) {
        Doc e = evaluation(t);
        List<String> codes = new ArrayList<>(e.strings("warnings"));
        if (!e.strings("missing").isEmpty()) codes.add(0, "资料待补齐");
        for (String code : codes) {
          String id = key("ticket", t.get("ownerId"), List.of(t.get("id"), code));
          if (r.get(id) != null) continue;
          Doc ticket =
              Doc.of(
                  "id",
                  id,
                  "kind",
                  "ticket",
                  "ownerId",
                  t.get("ownerId"),
                  "tradeId",
                  t.get("id"),
                  "source",
                  t.get("source"),
                  "title",
                  code,
                  "severity",
                  code.equals("逾期升级") ? "high" : "warning",
                  "status",
                  "open",
                  "assigneeId",
                  t.get("ownerId"),
                  "version",
                  1,
                  "createdAt",
                  now(),
                  "evaluationSnapshot",
                  e);
          r.insert(ticket);
          r.audit(u, t.s("ownerId"), "ticket.create", id, ticket);
          created++;
        }
      }
    return Doc.of("created", created);
  }

  public Doc ticket(Doc u, String id, Doc b) {
    Doc old = r.accessible(u, id, "ticket");
    require(old.l("version") == b.l("version"), 409, "工单已更新，请刷新");
    Doc a = r.db.get("users", text(b.get("assigneeId"), "负责人", 100));
    require(
        a != null && (a.same("id", old, "ownerId") || a.eq("role", "admin")),
        400,
        "负责人须为资料所属账号或平台管理员");
    String reason = text(b.get("reason"), "处理说明", 1000);
    Doc result =
        old.with(
            "status",
            choice(b.get("status"), List.of("open", "in_progress", "resolved"), "处理状态"),
            "assigneeId",
            a.get("id"),
            "version",
            old.l("version") + 1,
            "updatedAt",
            now(),
            "resolution",
            reason);
    r.put(result);
    r.audit(
        u,
        old.s("ownerId"),
        "ticket.update",
        id,
        Doc.of("before", old, "after", result, "reason", reason));
    return result;
  }

  public Doc importRows(Doc u, Doc b) {
    String kind = choice(b.get("kind"), List.of("profiles", "trades"), "导入类型"),
        batch = text(b.get("batchKey"), "批次唯一键", 100),
        source = text(b.get("sourceNote"), "来源说明", 1000),
        dataClass = choice(b.get("dataClass"), List.of("real", "estimate", "example"), "导入数据性质");
    String
        hash =
            digest(
                Doc.of(
                    "kind",
                    kind,
                    "format",
                    b.get("format"),
                    "content",
                    b.get("content"),
                    "sourceNote",
                    source,
                    "dataClass",
                    dataClass)),
        id = key("import", u.get("id"), batch);
    Doc old = r.get(id);
    if (old != null) {
      require(old.eq("fingerprint", hash), 409, "批次唯一键已用于不同文件");
      return old;
    }
    List<Doc> rows = math.parseRows(b.s("format"), b.s("content"));
    require(!rows.isEmpty() && rows.size() <= 200, 400, "每批须为 1–200 条记录");
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < rows.size(); i++) {
      Doc row = rows.get(i);
      try {
        fields(row, kind.equals("profiles") ? RiskMath.PROFILE_FIELDS : RiskMath.TRADE_FIELDS);
        Doc input =
            row.with(
                "source",
                dataClass.equals("real") ? "import" : dataClass,
                "sourceNote",
                source + " · 批次 " + batch + " · 行 " + (i + 1));
        ids.add(
            (kind.equals("profiles") ? profile(u, input, "import") : trade(u, input, "import"))
                .s("id"));
      } catch (BusinessException e) {
        throw fail(e.status(), "第 " + (i + 1) + " 行：" + e.getMessage());
      }
    }
    Doc result =
        Doc.of(
            "id",
            id,
            "kind",
            "import",
            "ownerId",
            u.get("id"),
            "batchKey",
            batch,
            "fingerprint",
            hash,
            "sourceNote",
            source,
            "dataClass",
            dataClass,
            "recordIds",
            ids,
            "createdAt",
            now());
    r.insert(result);
    r.audit(u, u.s("id"), "import", id, result);
    return result;
  }

  public Doc verify(Doc u) {
    AuthService.admin(u);
    List<Doc> rows =
        r.db.all("risk_audit").stream()
            .sorted(Comparator.comparingLong(x -> x.l("sequence")))
            .toList();
    String previous = null;
    long sequence = 0;
    for (Doc row : rows) {
      sequence++;
      if (!Objects.equals(row.get("previousHash"), previous)
          || row.l("sequence") != sequence
          || !row.eq("hash", digest(row.without("hash"))))
        return Doc.of("ok", false, "sequence", sequence);
      previous = row.s("hash");
    }
    Doc root = r.db.get("risk_locks", "operations");
    return Doc.of(
        "ok",
        Objects.equals(previous, root.get("headHash")) && sequence == root.l("sequence"),
        "count",
        sequence,
        "headHash",
        previous,
        "scope",
        "应用追加式哈希链；不替代数据库权限隔离和外部备份");
  }
}
