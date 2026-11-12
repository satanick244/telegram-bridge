package com.induport.risk;

import static com.induport.common.BusinessException.*;
import static com.induport.common.CanonicalJson.*;
import static com.induport.common.Inputs.*;

import com.induport.auth.AuthService;
import com.induport.common.*;
import java.text.Normalizer;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class MonitorService {
  public static final Doc POLICY =
      Doc.of(
          "version",
          1,
          "scanIntervalMinutes",
          15,
          "initialReview",
          "manual-approval-warning",
          "securityReleasesCredit",
          false);
  private final RiskRepository repo;

  public MonitorService(RiskRepository repo) {
    this.repo = repo;
  }

  public Doc control(Doc t) {
    return repo.get("trade-control:" + t.s("id"));
  }

  public Doc review(Doc p) {
    return review(repo.rows(), p);
  }

  public Doc review(List<Doc> rows, Doc p) {
    List<Doc> cases =
        rows.stream()
            .filter(
                x -> x.eq("kind", "review_case") && x.same("profileId", p, "id") && !x.b("isDemo"))
            .toList();
    Doc
        last =
            cases.stream()
                .filter(x -> x.eq("status", "completed"))
                .max(Comparator.comparingLong(x -> x.l("sequence")))
                .orElse(null),
        open = cases.stream().filter(x -> x.eq("status", "open")).findFirst().orElse(null);
    long overdue = 0;
    for (Doc x : rows) {
      if (!x.same("profileId", p, "id") || x.b("isDemo")) continue;
      boolean debt =
          x.eq("kind", "trade")
                  && real(x.get("source"))
                  && x.eq("direction", "sale")
                  && x.eq("paymentMode", "credit")
                  && !x.b("cancelled")
                  && RiskRepository.balance(x) != null
                  && RiskRepository.balance(x) > 0
              || x.eq("kind", "receivable")
                  && !x.eq("status", "voided")
                  && x.l("amountMinor") > x.l("paidMinor");
      if (debt && x.get("dueDate") != null)
        overdue = Math.max(overdue, days(x.s("dueDate"), today()));
    }
    List<String> triggers = new ArrayList<>(), hard = new ArrayList<>();
    if (last == null) triggers.add("首次复审待建立");
    if (last != null) {
      if (last.eq("conclusion", "restricted")) hard.add("复审限制新增赊销");
      if (last.l("profileVersion") != p.l("version")) hard.add("档案变更须重新复审");
      if (last.get("nextReviewDate") != null && last.s("nextReviewDate").compareTo(today()) < 0)
        hard.add("定期复审已到期");
    }
    if (overdue >= repo.rules().l("overdueEscalationDays")) hard.add("严重逾期须复审，暂停新增赊销");
    if (open != null && open.b("blocking")) hard.add("客户复审处理中");
    triggers.addAll(hard);
    return Doc.of(
        "profileId",
        p.get("id"),
        "status",
        !hard.isEmpty() ? "restricted" : last != null ? "current" : "missing",
        "label",
        !hard.isEmpty() ? "需复审 · 限制新增赊销" : last != null ? "复审有效" : "复审待建立",
        "hard",
        hard,
        "triggers",
        triggers,
        "overdueDays",
        overdue,
        "lastReview",
        last,
        "openCase",
        open,
        "nextReviewDate",
        last == null ? null : last.get("nextReviewDate"),
        "verification",
        last == null ? null : last.get("verification"),
        "policy",
        POLICY);
  }

  public Doc security(Doc t, Doc c) {
    Long exposure;
    if (t.b("isDemo") && t.get("forecast") != null) {
      exposure =
          t.eq("direction", "purchase")
              ? Long.valueOf(t.d("forecast").l("prepaymentMinor"))
              : Long.valueOf(t.l("amountMinor") - t.d("forecast").l("receivedMinor"));
    } else if (t.eq("direction", "purchase")) {
      exposure =
          c == null || c.get("supplierPrepaymentMinor") == null
              ? null
              : Long.valueOf(c.l("supplierPrepaymentMinor"));
    } else exposure = RiskRepository.balance(t);
    List<Doc> details = new ArrayList<>();
    long sum = 0;
    for (Doc x : repo.rows())
      if (x.eq("kind", "security_instrument") && x.same("tradeId", t, "id") && !x.b("isDemo")) {
        boolean eligible =
            x.eq("status", "active")
                && x.b("verified")
                && real(x.get("source"))
                && x.same("currency", t, "currency")
                && x.s("validFrom").compareTo(today()) <= 0
                && x.s("validUntil").compareTo(today()) >= 0
                && (t.get("dueDate") == null || x.s("validUntil").compareTo(t.s("dueDate")) >= 0);
        Long covered =
            exposure == null
                ? null
                : eligible
                    ? Math.min(
                        x.l("amountMinor"), (long) Math.floor(exposure * x.n("coveragePct") / 100))
                    : 0L;
        details.add(x.with("eligible", eligible, "eligibleMinor", covered));
        if (covered != null) sum = Math.addExact(sum, covered);
      }
    boolean known = c != null && c.eq("securityMode", "none") || !details.isEmpty();
    Long secured = known && exposure != null ? Math.min(exposure, sum) : null;
    return Doc.of(
        "currency",
        t.get("currency"),
        "exposureMinor",
        exposure,
        "securedMinor",
        secured,
        "unsecuredMinor",
        secured == null ? null : exposure - secured,
        "details",
        details,
        "known",
        known,
        "automaticCreditOffset",
        false);
  }

  private Doc dimension(String state, String label, List<String> items) {
    return Doc.of(
        "state", state, "label", label, "items", new ArrayList<>(new LinkedHashSet<>(items)));
  }

  public Doc dimensions(Doc t, Doc p, Doc e) {
    if (t.b("isDemo")) {
      Doc f = e.d("forecast");
      boolean purchase = t.eq("direction", "purchase"),
          loss = e.get("stressedMarginMinor") != null && e.l("stressedMarginMinor") < 0;
      return Doc.of(
          "credit",
          dimension(
              purchase ? "na" : f.l("overLimitMinor") > 0 ? "high" : "watch",
              purchase ? "采购不占客户额度" : f.l("overLimitMinor") > 0 ? "授信容量不足" : "按额度与账期复核",
              List.of()),
          "profit",
          dimension(
              purchase ? "watch" : loss ? "high" : "normal",
              purchase ? "采购成本测算" : loss ? "压力后预计亏损" : "压力后毛差为正",
              List.of()),
          "fulfillment",
          dimension(
              e.l("overdueDays") > 0 ? "high" : "watch",
              e.l("overdueDays") > 0 ? "逾期 " + e.l("overdueDays") + " 天" : "按合同条件复核",
              List.of()),
          "documents",
          dimension("watch", "主体、财务与履约资料待复核", List.of()));
    }
    Doc review = review(p),
        c = control(t),
        credit = repo.get(RiskRepository.accountId(p.get("id"), t.get("currency")));
    Long balance = RiskRepository.balance(t);
    List<String> issues = new ArrayList<>();
    if (t.eq("direction", "sale")
        && t.eq("paymentMode", "credit")
        && balance != null
        && balance > 0) {
      issues.addAll(RiskRepository.creditProblems(credit, t, p));
      issues.addAll(review.strings("hard"));
    }
    if (credit != null
        && t.eq("direction", "sale")
        && !t.b("reserved")
        && balance != null
        && balance > credit.l("limitMinor") - credit.l("occupiedMinor")) issues.add("可用授信不足");
    List<String> fulfillment = new ArrayList<>(), missing = e.strings("missing");
    if (review.l("overdueDays") > 0) fulfillment.add("客户最长逾期 " + review.l("overdueDays") + " 天");
    if (repo.rows().stream()
        .anyMatch(
            x ->
                List.of("control_change", "security_change").contains(x.s("kind", ""))
                    && x.same("tradeId", t, "id")
                    && x.eq("status", "pending"))) fulfillment.add("实货或保障台账变更待复核");
    if (c == null) missing.add("实货台账");
    else {
      if (c.get("inventoryQuantity") != null && c.n("inventoryQuantity") < t.n("quantity"))
        fulfillment.add("登记库存数量不足整单装运");
      if (c.get("minPrepaymentPct") != null && t.eq("direction", "sale")) {
        long paid =
            repo.rows().stream()
                .filter(
                    x ->
                        x.eq("kind", "receivable")
                            && x.same("tradeId", t, "id")
                            && !x.eq("status", "voided"))
                .mapToLong(x -> x.l("paidMinor"))
                .sum();
        if (paid < Math.ceil(t.n("amountMinor") * c.n("minPrepaymentPct") / 100))
          fulfillment.add("已核销回款未达到约定预付比例");
      }
      String[] keys = {"batchNumber", "grade", "warehouse", "titleEvidence", "qualityEvidence"},
          names = {"批次", "牌号", "仓储或交付位置", "货权依据", "质检依据"};
      for (int i = 0; i < keys.length; i++) if (blank(c.get(keys[i]))) missing.add(names[i]);
    }
    boolean purchase = t.eq("direction", "purchase"),
        profitMissing =
            purchase
                ? (c != null && c.eq("positionType", "unsold_inventory")
                    ? e.get("inventoryLossMinor") == null
                    : e.get("stressedCostMinor") == null)
                : e.get("stressedMarginMinor") == null,
        loss =
            e.l("inventoryLossMinor") > 0
                || e.get("stressedMarginMinor") != null && e.l("stressedMarginMinor") < 0;
    return Doc.of(
        "credit",
        dimension(
            purchase
                ? "na"
                : !issues.isEmpty() ? "high" : review.eq("status", "missing") ? "missing" : "watch",
            purchase
                ? "采购不占客户额度"
                : !issues.isEmpty()
                    ? "授信条件未满足"
                    : review.eq("status", "missing") ? "复审待建立" : "仍须人工审批",
            issues),
        "profit",
        dimension(
            profitMissing
                ? "missing"
                : loss ? "high" : purchase || e.l("stressedMarginMinor") == 0 ? "watch" : "normal",
            purchase
                ? (e.l("inventoryLossMinor") > 0 ? "库存压力价值低于成本" : "采购成本与库存价值")
                : profitMissing
                    ? "成本资料待补齐"
                    : loss ? "压力后预计亏损" : e.l("stressedMarginMinor") == 0 ? "压力后毛差为零" : "压力后毛差为正",
            List.of()),
        "fulfillment",
        dimension(
            !fulfillment.isEmpty() ? "high" : c == null ? "missing" : "watch",
            !fulfillment.isEmpty() ? "履约条件待处理" : c == null ? "实货资料待补齐" : "待人工发货复核",
            fulfillment),
        "documents",
        dimension(
            !missing.isEmpty() || review.eq("status", "missing") ? "missing" : "watch",
            !missing.isEmpty() ? "资料待补齐" : review.eq("status", "missing") ? "资料待独立核验" : "按复审版本核验",
            missing));
  }

  private Doc ensureCase(Doc actor, Doc p, List<String> reasons, boolean blocking) {
    List<Doc> cases =
        repo.rows().stream()
            .filter(
                x -> x.eq("kind", "review_case") && x.same("profileId", p, "id") && !x.b("isDemo"))
            .toList();
    Doc open = cases.stream().filter(x -> x.eq("status", "open")).findFirst().orElse(null);
    if (open != null) {
      List<String> triggers = new ArrayList<>(new LinkedHashSet<>(open.strings("triggers")));
      reasons.forEach(
          s -> {
            if (!triggers.contains(s)) triggers.add(s);
          });
      if (!triggers.equals(open.strings("triggers"))
          || blocking && !open.b("blocking")
          || open.l("profileVersion") != p.l("version")) {
        Doc result =
            open.with(
                "triggers",
                triggers,
                "blocking",
                open.b("blocking") || blocking,
                "version",
                open.l("version") + 1,
                "profileVersion",
                p.get("version"),
                "profileSnapshot",
                p);
        repo.put(result);
        repo.audit(
            actor,
            p.s("ownerId"),
            "review.escalate",
            open.s("id"),
            Doc.of("before", open, "after", result));
        return result;
      }
      return open;
    }
    long sequence = cases.stream().mapToLong(x -> x.l("sequence")).max().orElse(0) + 1;
    String id = key("review", p.get("ownerId"), List.of(p.get("id"), sequence));
    Doc row =
        Doc.of(
            "id",
            id,
            "kind",
            "review_case",
            "ownerId",
            p.get("ownerId"),
            "profileId",
            p.get("id"),
            "source",
            p.get("source"),
            "sourceNote",
            p.get("sourceNote"),
            "sequence",
            sequence,
            "status",
            "open",
            "version",
            1,
            "blocking",
            blocking,
            "triggers",
            reasons,
            "requestedBy",
            actor.get("id"),
            "assigneeId",
            p.get("ownerId"),
            "profileSnapshot",
            p,
            "profileVersion",
            p.get("version"),
            "policySnapshot",
            POLICY,
            "rulesSnapshot",
            repo.rules(),
            "createdAt",
            now());
    repo.insert(row);
    repo.audit(actor, p.s("ownerId"), "review.open", id, row);
    return row;
  }

  public Doc scan(Doc actor, String scope) {
    int created = 0;
    for (Doc p : repo.rows())
      if (p.eq("kind", "profile")
          && !p.b("isDemo")
          && real(p.get("source"))
          && (scope == null || p.eq("ownerId", scope))) {
        Doc state = review(p);
        List<String> reasons =
            state.strings("triggers").stream()
                .filter(s -> !List.of("客户复审处理中", "复审限制新增赊销").contains(s))
                .toList();
        if (reasons.isEmpty()) continue;
        ensureCase(
            actor,
            p,
            reasons,
            state.strings("hard").stream()
                .anyMatch(s -> !List.of("客户复审处理中", "复审限制新增赊销").contains(s)));
        if (state.get("openCase") == null) created++;
      }
    return Doc.of("created", created, "scannedAt", now(), "policy", POLICY);
  }

  public Doc requestReview(Doc u, Doc b) {
    fields(b, List.of("profileId", "reason"));
    Doc p = repo.real(u, b.get("profileId"), "profile");
    return ensureCase(u, p, List.of(text(b.get("reason"), "复审触发原因", 1000)), true);
  }

  public Doc assign(Doc u, String id, Doc b) {
    fields(b, List.of("version", "assigneeId", "reason"));
    Doc row = repo.accessible(u, id, "review_case");
    require(row.eq("status", "open") && row.l("version") == b.l("version"), 409, "复审已变化或已结束，请刷新");
    Doc a = repo.db.get("users", text(b.get("assigneeId"), "负责人", 100));
    require(
        a != null && !a.b("isDemo") && (a.same("id", row, "ownerId") || a.eq("role", "admin")),
        400,
        "负责人须为所属账号或平台管理员");
    Doc result = row.with("assigneeId", a.get("id"), "version", row.l("version") + 1);
    repo.put(result);
    repo.audit(
        u,
        row.s("ownerId"),
        "review.assign",
        id,
        Doc.of("before", row, "after", result, "reason", text(b.get("reason"), "分派理由", 1000)));
    return result;
  }

  public Doc decideReview(Doc u, String id, Doc b) {
    AuthService.admin(u);
    fields(
        b,
        List.of(
            "version",
            "conclusion",
            "reason",
            "evidenceRef",
            "nextReviewDate",
            "registrationVerified",
            "financialVerified",
            "performanceVerified"));
    Doc c = repo.accessible(u, id, "review_case"), p = repo.real(u, c.get("profileId"), "profile");
    require(c.eq("status", "open"), 409, "复审已完成，不可覆盖历史");
    require(c.l("version") == b.l("version"), 409, "复审任务已变化，请刷新");
    require(
        !c.same("requestedBy", u, "id")
            && !p.same("ownerId", u, "id")
            && !Objects.equals(p.getOrDefault("updatedBy", p.get("createdBy")), u.get("id")),
        403,
        "资料提供或复审申请人与独立核验人必须分离");
    require(c.l("profileVersion") == p.l("version"), 409, "档案版本已变化，请重新扫描");
    String conclusion = choice(b.get("conclusion"), List.of("cleared", "restricted"), "复审结论"),
        next = day(b.get("nextReviewDate"));
    require(next != null && next.compareTo(today()) > 0, 400, "下次复审日须晚于今天");
    Doc verified =
        Doc.of(
            "registration",
            b.b("registrationVerified"),
            "financial",
            b.b("financialVerified"),
            "performance",
            b.b("performanceVerified"));
    if (conclusion.equals("cleared")) {
      require(
          !blank(p.get("registration"))
              && !blank(p.get("country"))
              && !blank(p.get("financialEvidence"))
              && !blank(p.get("performanceEvidence"))
              && verified.values().stream().allMatch(Boolean.TRUE::equals),
          400,
          "须补齐并独立核验主体、财务及履约依据");
      require(
          review(p).l("overdueDays") < repo.rules().l("overdueEscalationDays"),
          409,
          "严重逾期尚未消除，不能解除新增赊销限制");
    }
    Doc result =
        c.with(
            "status",
            "completed",
            "version",
            c.l("version") + 1,
            "conclusion",
            conclusion,
            "reason",
            text(b.get("reason"), "复审理由", 1000),
            "evidenceRef",
            text(b.get("evidenceRef"), "独立核验依据", 1000),
            "nextReviewDate",
            next,
            "verification",
            verified,
            "profileVersion",
            p.get("version"),
            "profileSnapshot",
            p,
            "decidedBy",
            u.get("id"),
            "decidedAt",
            now(),
            "rulesSnapshot",
            repo.rules());
    repo.put(result);
    repo.audit(u, p.s("ownerId"), "review.complete", id, result);
    return result;
  }

  private Doc requestRecord(Doc u, String kind, String owner, String businessKey, Doc input) {
    String id = key(kind, owner, businessKey), hash = digest(input);
    Doc old = repo.get(id);
    if (old != null) {
      require(old.eq("inputHash", hash), 409, "业务唯一键已用于不同内容");
      return old;
    }
    Doc row =
        input.with(
            "id",
            id,
            "kind",
            kind,
            "ownerId",
            owner,
            "businessKey",
            businessKey,
            "inputHash",
            hash,
            "requestedBy",
            u.get("id"),
            "status",
            "pending",
            "createdAt",
            now());
    repo.insert(row);
    repo.audit(u, owner, kind + ".request", id, row);
    return row;
  }

  public Doc requestControl(Doc u, Doc b) {
    fields(
        b,
        List.of(
            "tradeId",
            "businessKey",
            "version",
            "reason",
            "sourceNote",
            "lockedQuantity",
            "lockEvidence",
            "inventoryQuantity",
            "positionType",
            "batchNumber",
            "grade",
            "specification",
            "warehouse",
            "titleEvidence",
            "qualityEvidence",
            "marketUnitPrice",
            "marketPriceAsOf",
            "supplierPrepayment",
            "prepaymentEvidence",
            "minPrepaymentPct",
            "securityMode"));
    Doc t = repo.real(u, b.get("tradeId"), "trade");
    require(
        t.n("quantity") > 0
            && t.get("unit") != null
            && t.get("currency") != null
            && t.get("amountMinor") != null
            && !t.b("cancelled"),
        400,
        "须明确未取消合同的金额币种及数量单位");
    Double locked = number(b.get("lockedQuantity"), "锁价数量", 0, t.n("quantity"), true),
        inventory = number(b.get("inventoryQuantity"), "库存数量", 0, t.n("quantity"), true);
    Long market = minor(b.get("marketUnitPrice"), "市场单位价格"),
        prepay = minor(b.get("supplierPrepayment"), "供应商预付款");
    String marketDate = day(b.get("marketPriceAsOf"));
    if (market != null)
      require(
          marketDate != null
              && marketDate.compareTo(today()) <= 0
              && t.get("steelCurrency") != null
              && t.get("steelCostUnit") != null,
          400,
          "行情须有日期及成本币种和单位");
    if (prepay != null)
      require(
          t.eq("direction", "purchase") && prepay <= t.l("amountMinor"), 400, "预付款仅适用于采购且不能超过本金");
    String position =
        choice(b.get("positionType"), List.of("back_to_back", "unsold_inventory"), "业务头寸");
    require(
        !position.equals("unsold_inventory") || t.eq("direction", "purchase"), 400, "未售库存须关联采购合同");
    Doc payload =
        Doc.of(
            "lockedQuantity",
            locked,
            "inventoryQuantity",
            inventory,
            "positionType",
            position,
            "marketUnitPriceMinor",
            market,
            "marketPriceAsOf",
            marketDate,
            "supplierPrepaymentMinor",
            prepay,
            "minPrepaymentPct",
            number(b.get("minPrepaymentPct"), "最低预付比例", 0, 100, true),
            "securityMode",
            choice(b.get("securityMode"), List.of("unknown", "none", "instruments"), "保障安排"),
            "source",
            t.get("source"),
            "sourceNote",
            text(b.get("sourceNote"), "资料来源说明", 1000));
    for (String k :
        List.of(
            "lockEvidence",
            "batchNumber",
            "grade",
            "specification",
            "warehouse",
            "titleEvidence",
            "qualityEvidence",
            "prepaymentEvidence")) payload.put(k, text(b.get(k), k, 1000, true));
    require(
        inventory == null
            || inventory == 0
            || payload.get("batchNumber") != null && payload.get("warehouse") != null,
        400,
        "正数库存须有批次及仓储位置");
    require(
        locked == null || locked == 0 || payload.get("lockEvidence") != null, 400, "已锁价数量须有采购依据");
    require(
        prepay == null || prepay == 0 || payload.get("prepaymentEvidence") != null,
        400,
        "预付款须有支付核验依据");
    require(!position.equals("unsold_inventory") || inventory != null, 400, "库存头寸须明确数量");
    double version = number(b.get("version"), "台账版本", 0, 1e9);
    require(version == Math.rint(version), 400, "台账版本无效");
    return requestRecord(
        u,
        "control_change",
        t.s("ownerId"),
        text(b.get("businessKey"), "业务唯一键", 100),
        Doc.of(
            "tradeId",
            t.get("id"),
            "expectedVersion",
            version,
            "payload",
            payload,
            "reason",
            text(b.get("reason"), "变更理由", 1000),
            "tradeSnapshot",
            t));
  }

  public Doc requestSecurity(Doc u, Doc b) {
    fields(
        b,
        List.of(
            "tradeId",
            "businessKey",
            "version",
            "instrumentType",
            "reference",
            "issuer",
            "amount",
            "currency",
            "coveragePct",
            "validFrom",
            "validUntil",
            "evidenceRef",
            "sourceNote",
            "reason",
            "status"));
    Doc t = repo.real(u, b.get("tradeId"), "trade");
    String currency = choice(b.get("currency"), RiskMath.CURRENCIES, "保障币种");
    require(t.eq("currency", currency), 400, "保障须与合同同币种，不支持未经核验的跨币种折算");
    String reference = normalize(text(b.get("reference"), "保障唯一编号", 150)),
        from = day(b.get("validFrom")),
        until = day(b.get("validUntil"));
    long amount = positive(b.get("amount"));
    require(from != null && until != null && from.compareTo(until) <= 0, 400, "须明确保障有效期间");
    double version = number(b.get("version"), "保障版本", 0, 1e9);
    require(version == Math.rint(version), 400, "保障版本无效");
    Doc payload =
        Doc.of(
            "reference",
            reference,
            "instrumentType",
            choice(
                b.get("instrumentType"),
                List.of("bank_guarantee", "credit_insurance", "corporate_guarantee"),
                "保障类型"),
            "issuer",
            text(b.get("issuer"), "出具方", 150),
            "amountMinor",
            amount,
            "currency",
            currency,
            "coveragePct",
            number(b.get("coveragePct"), "覆盖比例", 0, 100),
            "validFrom",
            from,
            "validUntil",
            until,
            "evidenceRef",
            text(b.get("evidenceRef"), "保障及可执行性依据", 1000),
            "source",
            t.get("source"),
            "sourceNote",
            text(b.get("sourceNote"), "资料来源说明", 1000),
            "status",
            choice(b.get("status"), List.of("active", "withdrawn"), "保障状态"));
    return requestRecord(
        u,
        "security_change",
        t.s("ownerId"),
        text(b.get("businessKey"), "业务唯一键", 100),
        Doc.of(
            "tradeId",
            t.get("id"),
            "profileId",
            t.get("profileId"),
            "targetId",
            key("security", t.get("ownerId"), reference),
            "expectedVersion",
            version,
            "payload",
            payload,
            "reason",
            text(b.get("reason"), "申请理由", 1000),
            "tradeSnapshot",
            t));
  }

  public Doc decideControl(Doc u, String id, Doc b, boolean security) {
    AuthService.admin(u);
    fields(b, List.of("decision", "reason", "evidenceRef", "verified"));
    String kind = security ? "security_change" : "control_change";
    Doc a = repo.accessible(u, id, kind);
    String decision = choice(b.get("decision"), List.of("approved", "rejected"), "审批决定"),
        reason = text(b.get("reason"), "独立复核理由", 1000);
    if (!a.eq("status", "pending")) {
      require(a.eq("status", decision) && a.eq("decisionReason", reason), 409, "申请已处理，不可覆盖历史");
      return a;
    }
    require(!a.same("requestedBy", u, "id"), 403, "录入人与独立核验人必须分离");
    Doc t = repo.real(u, a.get("tradeId"), "trade"), applied = null, payload = a.d("payload");
    if (decision.equals("approved")) {
      require(b.b("verified"), 400, "须明确完成独立核验");
      require(
          !t.b("cancelled") && t.l("version") == a.d("tradeSnapshot").l("version"),
          409,
          "合同已变化，请重新申请");
      String target = security ? a.s("targetId") : "trade-control:" + t.s("id");
      Doc old = repo.get(target);
      require((old == null ? 0 : old.l("version")) == a.l("expectedVersion"), 409, "台账版本已变化，请重新申请");
      require(old == null || old.same("tradeId", t, "id"), 409, "同一保障编号不能跨合同重复分配");
      if (!security) {
        if (payload.eq("securityMode", "none"))
          require(
              repo.rows().stream()
                  .noneMatch(
                      x ->
                          x.eq("kind", "security_instrument")
                              && x.same("tradeId", t, "id")
                              && x.eq("status", "active")),
              409,
              "仍有生效保障，不能声明无保障");
        if (payload.n("inventoryQuantity") > 0)
          require(
              repo.rows().stream()
                  .noneMatch(
                      x ->
                          x.eq("kind", "trade_control")
                              && x.same("ownerId", t, "ownerId")
                              && !x.same("tradeId", t, "id")
                              && x.n("inventoryQuantity") > 0
                              && Objects.equals(
                                  normalize(x.s("batchNumber")),
                                  normalize(payload.s("batchNumber")))
                              && Objects.equals(
                                  normalize(x.s("warehouse")), normalize(payload.s("warehouse")))),
              409,
              "同批次同仓储库存已绑定其他合同");
      }
      applied =
          payload.with(
              "id",
              target,
              "kind",
              security ? "security_instrument" : "trade_control",
              "ownerId",
              t.get("ownerId"),
              "profileId",
              t.get("profileId"),
              "tradeId",
              t.get("id"),
              "version",
              (old == null ? 0 : old.l("version")) + 1,
              "unit",
              t.get("unit"),
              "verified",
              true,
              "verifiedBy",
              u.get("id"),
              "verificationEvidence",
              text(b.get("evidenceRef"), "独立核验依据", 1000),
              "verifiedAt",
              now(),
              "approvalId",
              id);
      repo.put(applied);
    }
    Doc result =
        a.with(
            "status",
            decision,
            "decisionReason",
            reason,
            "decidedBy",
            u.get("id"),
            "decidedAt",
            now(),
            "appliedSnapshot",
            applied);
    repo.put(result);
    repo.audit(u, t.s("ownerId"), kind + "." + decision, id, result);
    return result;
  }

  private static String normalize(String s) {
    return s == null
        ? null
        : Normalizer.normalize(s, Normalizer.Form.NFKC).trim().toUpperCase(Locale.ROOT);
  }
}
