package com.induport.risk;

import static com.induport.common.BusinessException.*;
import static com.induport.common.Inputs.*;

import com.induport.common.*;
import java.text.Normalizer;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class RiskMath {
  public static final List<String> CURRENCIES = List.of("USD", "CNY"),
      SOURCES = List.of("manual", "import", "estimate", "example");
  public static final List<String>
      PROFILE_FIELDS =
          List.of(
              "name",
              "partyType",
              "registration",
              "country",
              "financialEvidence",
              "performanceEvidence",
              "notes",
              "source",
              "sourceNote",
              "businessKey",
              "platformAccountId"),
      TRADE_FIELDS =
          List.of(
              "profileId",
              "platformOrderId",
              "businessKey",
              "direction",
              "currency",
              "amount",
              "quantity",
              "unit",
              "term",
              "paymentMode",
              "dueDate",
              "steelUnitCost",
              "steelCurrency",
              "steelCostUnit",
              "freight",
              "freightCurrency",
              "freightPayer",
              "freightIncluded",
              "fxRate",
              "source",
              "sourceNote");

  public Doc profileInput(Doc b) {
    String account = text(b.get("platformAccountId"), "平台对手账号", 80, true);
    return Doc.of(
        "platformAccountId",
        account == null
            ? null
            : Normalizer.normalize(account, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT),
        "name",
        text(b.get("name"), "企业名称", 120),
        "partyType",
        choice(b.get("partyType"), List.of("customer", "supplier"), "档案类型"),
        "registration",
        text(b.get("registration"), "注册资料", 120, true),
        "country",
        text(b.get("country"), "国家地区", 80, true),
        "financialEvidence",
        text(b.get("financialEvidence"), "财务凭据", 1000, true),
        "performanceEvidence",
        text(b.get("performanceEvidence"), "履约凭据", 1000, true),
        "notes",
        text(b.get("notes"), "备注", 1000, true),
        "source",
        choice(b.get("source"), SOURCES, "数据来源"),
        "sourceNote",
        text(b.get("sourceNote"), "来源说明", 1000),
        "businessKey",
        text(b.get("businessKey"), "业务唯一键", 100));
  }

  public Doc tradeInput(Doc b) {
    return Doc.of(
        "profileId",
        text(b.get("profileId"), "档案编号", 191),
        "platformOrderId",
        text(b.get("platformOrderId"), "平台订单编号", 100, true),
        "businessKey",
        text(b.get("businessKey"), "业务唯一键", 100),
        "direction",
        choice(b.get("direction"), List.of("sale", "purchase"), "合同方向"),
        "currency",
        choice(b.get("currency"), CURRENCIES, "合同币种", true),
        "amountMinor",
        minor(b.get("amount"), "合同金额"),
        "quantity",
        number(b.get("quantity"), "数量", 0.000001, 1e9, true),
        "unit",
        choice(b.get("unit"), List.of("吨", "千克", "件", "套", "米", "双"), "计量单位", true),
        "term",
        choice(b.get("term"), List.of("EXW", "FOB", "CFR", "CIF", "DAP", "DDP"), "贸易条款", true),
        "paymentMode",
        choice(b.get("paymentMode"), List.of("cash", "credit"), "付款方式", true),
        "dueDate",
        day(b.get("dueDate")),
        "steelUnitCostMinor",
        minor(b.get("steelUnitCost"), "钢材单位成本"),
        "steelCurrency",
        choice(b.get("steelCurrency"), CURRENCIES, "成本币种", true),
        "steelCostUnit",
        choice(b.get("steelCostUnit"), List.of("吨", "千克", "件", "套", "米", "双"), "成本计量单位", true),
        "freightMinor",
        minor(b.get("freight"), "运费总额"),
        "freightCurrency",
        choice(b.get("freightCurrency"), CURRENCIES, "运费币种", true),
        "freightPayer",
        choice(b.get("freightPayer"), List.of("self", "counterparty"), "运费承担方", true),
        "freightIncluded",
        bool(b.get("freightIncluded"), "合同金额是否含运费"),
        "fxRate",
        number(b.get("fxRate"), "汇率 CNY/USD", 0.0001, 10000, true),
        "source",
        choice(b.get("source"), SOURCES, "数据来源"),
        "sourceNote",
        text(b.get("sourceNote"), "来源说明", 1000));
  }

  public Doc evaluate(Doc t, Doc p, Doc r, Doc credit, Doc control) {
    return evaluate(t, p, r, credit, control, today());
  }

  public Doc evaluate(Doc t, Doc p, Doc r, Doc credit, Doc control, String asOfDate) {
    List<String> missing = new ArrayList<>(), warnings = new ArrayList<>();
    String[] pf = {"registration", "country", "financialEvidence", "performanceEvidence"},
        pl = {"企业注册资料", "国家地区", "财务凭据", "履约凭据"},
        tf =
            {
              "amountMinor",
              "currency",
              "quantity",
              "unit",
              "term",
              "paymentMode",
              "freightPayer",
              "freightIncluded"
            },
        tl = {"合同金额", "合同币种", "数量", "计量单位", "贸易条款", "付款方式", "运费承担方", "合同是否含运费"};
    for (int i = 0; i < pf.length; i++) if (blank(p.get(pf[i]))) missing.add(pl[i]);
    for (int i = 0; i < tf.length; i++) if (blank(t.get(tf[i]))) missing.add(tl[i]);
    if (t.eq("paymentMode", "credit") && t.get("dueDate") == null) missing.add("赊销到期日");
    Double multiplier = null;
    if (t.get("unit") != null && t.get("steelCostUnit") != null) {
      if (t.same("unit", t, "steelCostUnit")) multiplier = 1d;
      else if (t.eq("unit", "吨") && t.eq("steelCostUnit", "千克")) multiplier = 1000d;
      else if (t.eq("unit", "千克") && t.eq("steelCostUnit", "吨")) multiplier = .001d;
      else missing.add("成本单位换算依据");
    }
    boolean known = true;
    double steelCny = 0, steelUsd = 0, freightCny = 0, freightUsd = 0;
    if (t.get("steelUnitCostMinor") == null
        || t.get("steelCurrency") == null
        || t.get("quantity") == null
        || multiplier == null) {
      missing.add("钢材单位成本及同单位数量");
      known = false;
    } else {
      double amount = t.n("steelUnitCostMinor") * t.n("quantity") * multiplier;
      if (!safe(amount)) {
        known = false;
        missing.add("成本总额超出支持精度");
      } else if (t.eq("steelCurrency", "USD")) steelUsd = round(amount);
      else steelCny = round(amount);
    }
    if (t.eq("freightPayer", "self")) {
      if (t.get("freightMinor") == null || t.get("freightCurrency") == null) {
        missing.add("本方承担的运费总额及币种");
        known = false;
      } else if (t.eq("freightCurrency", "USD")) freightUsd = t.n("freightMinor");
      else freightCny = t.n("freightMinor");
    } else if (!t.eq("freightPayer", "counterparty")) known = false;
    Long outstanding = RiskRepository.balance(t), overdue = null;
    if (t.get("dueDate") != null && outstanding != null && outstanding > 0) {
      overdue = Math.max(0, days(t.s("dueDate"), asOfDate));
      if (overdue >= r.l("overdueEscalationDays")) warnings.add("逾期升级");
      else if (overdue >= r.l("overdueWarningDays")) warnings.add("逾期预警");
    }
    if (!real(t.get("source")) || !real(p.get("source"))) warnings.add("预估或示例：仅测算，不进入真实额度账");
    if (t.eq("paymentMode", "credit") && t.eq("direction", "sale")) {
      if (credit == null) warnings.add("未获批授信，默认额度为 0");
      else if (t.get("amountMinor") != null
          && !t.b("reserved")
          && t.l("amountMinor") > credit.l("limitMinor") - credit.l("occupiedMinor"))
        warnings.add("可用授信不足");
    }
    boolean fxNeeded = t.eq("currency", "USD") || steelUsd != 0 || freightUsd != 0;
    if (fxNeeded && t.get("fxRate") == null) missing.add("汇率 CNY/USD");
    double fx = t.get("fxRate") == null ? 1 : t.n("fxRate");
    Long baseCost = null, stressCost = null, baseMargin = null, stressMargin = null, loss = null;
    if (known && (!fxNeeded || t.get("fxRate") != null)) {
      double
          ratio =
              control != null && control.eq("positionType", "unsold_inventory")
                  ? 1
                  : control != null
                          && control.b("verified")
                          && control.get("lockedQuantity") != null
                          && t.n("quantity") > 0
                      ? Math.min(1, control.n("lockedQuantity") / t.n("quantity"))
                      : 0,
          steelFactor = 1 + r.n("steelShockPct") / 100 * (1 - ratio),
          sc = steelCny * steelFactor + freightCny * (1 + r.n("freightShockPct") / 100),
          su = steelUsd * steelFactor + freightUsd * (1 + r.n("freightShockPct") / 100),
          rc = 0,
          ru = 0;
      boolean revenue =
          t.eq("direction", "sale")
              && t.get("currency") != null
              && t.get("amountMinor") != null
              && t.get("freightIncluded") != null;
      if (revenue) {
        if (t.eq("currency", "USD")) ru = t.n("amountMinor");
        else rc = t.n("amountMinor");
        if (t.eq("freightPayer", "self") && Boolean.FALSE.equals(t.get("freightIncluded"))) {
          if (t.eq("freightCurrency", "USD")) ru += t.n("freightMinor");
          else rc += t.n("freightMinor");
        }
      }
      double adverseFx =
          fx * (ru - su >= 0 ? 1 - r.n("fxShockPct") / 100 : 1 + r.n("fxShockPct") / 100);
      double bc = steelCny + freightCny + (steelUsd + freightUsd) * fx,
          st = sc + su * adverseFx,
          bm = rc + ru * fx - bc,
          sm = rc - sc + (ru - su) * adverseFx;
      if (safe(bc) && safe(st) && (!revenue || safe(bm) && safe(sm) && safe(bm - sm))) {
        baseCost = round(bc);
        stressCost = round(st);
        if (revenue) {
          baseMargin = round(rc + ru * fx) - baseCost;
          stressMargin = round(sm);
          loss = baseMargin - stressMargin;
          if (stressMargin < 0) warnings.add("压力情景下预计亏损");
        }
      } else missing.add("测算金额超出支持精度");
    }
    Long book = null, market = null, stressedInventory = null, inventoryLoss = null;
    if (control != null && control.eq("positionType", "unsold_inventory")) {
      Long age =
          control.get("marketPriceAsOf") == null
              ? null
              : days(control.s("marketPriceAsOf"), asOfDate);
      if (control.get("marketUnitPriceMinor") == null
          || age == null
          || age < 0
          || age > r.n("marketDataMaxAgeDays")) missing.add("有效期内的库存市场价格");
      else if (control.get("inventoryQuantity") != null
          && multiplier != null
          && t.get("steelUnitCostMinor") != null
          && t.get("steelCurrency") != null
          && (!fxNeeded || t.get("fxRate") != null)) {
        double quantity = control.n("inventoryQuantity") * multiplier,
            rate = t.eq("steelCurrency", "USD") ? fx : 1,
            bv = quantity * t.n("steelUnitCostMinor") * rate,
            mv = quantity * control.n("marketUnitPriceMinor") * rate;
        if (safe(bv) && safe(mv)) {
          book = round(bv);
          market = round(mv);
          stressedInventory =
              round(
                  market
                      * (1 - r.n("steelShockPct") / 100)
                      * (t.eq("steelCurrency", "USD") ? 1 - r.n("fxShockPct") / 100 : 1));
          inventoryLoss = Math.max(0, book - stressedInventory);
          if (inventoryLoss > 0) warnings.add("库存压力价值低于账面成本");
        } else missing.add("库存测算金额超出支持精度");
      }
    }
    if (t.eq("direction", "purchase")) warnings.add("采购合同仅测算成本，不将采购金额作为销售收入");
    return Doc.of(
        "status",
        missing.isEmpty() ? "待人工审批" : "资料待补齐",
        "missing",
        new ArrayList<>(new LinkedHashSet<>(missing)),
        "warnings",
        warnings,
        "outstandingMinor",
        outstanding,
        "overdueDays",
        overdue,
        "reportingCurrency",
        "CNY",
        "calculationSource",
        "estimate",
        "controlSnapshot",
        control,
        "inventoryBookMinor",
        book,
        "inventoryMarketMinor",
        market,
        "inventoryStressedMinor",
        stressedInventory,
        "inventoryLossMinor",
        inventoryLoss,
        "baseCostMinor",
        baseCost,
        "stressedCostMinor",
        stressCost,
        "baseMarginMinor",
        baseMargin,
        "stressedMarginMinor",
        stressMargin,
        "stressLossMinor",
        loss,
        "rulesSnapshot",
        r,
        "profileSnapshot",
        p,
        "tradeSnapshot",
        t,
        "creditSnapshot",
        credit,
        "evaluatedAt",
        now(),
        "method",
        "仅未锁价部分承受采购涨价；未售库存单列跌价。合同预算口径，不含未知税费、融资费及套保；保障不抵减授信本金。",
        "automaticRelease",
        false);
  }

  private boolean safe(double n) {
    return Double.isFinite(n) && Math.abs(n) <= 9007199254740991L;
  }

  public Doc demoEvaluation(Doc t, Doc p) {
    Doc f = t.d("forecast"), r = f.d("rulesSnapshot"), e = evaluate(t, p, r, null, null);
    List<String> verification = new ArrayList<>(), missing = new ArrayList<>();
    for (String s : e.strings("missing"))
      if (List.of("企业注册资料", "财务凭据", "履约凭据").contains(s)) verification.add(s);
      else missing.add(s);
    boolean purchase = t.eq("direction", "purchase");
    long
        remaining = t.l("amountMinor") - (purchase ? f.l("prepaymentMinor") : f.l("receivedMinor")),
        proposed = purchase ? 0 : remaining,
        occupied = f.l("existingOccupiedMinor") + proposed,
        available = f.l("limitMinor") - occupied,
        overdue =
            purchase || remaining == 0
                ? 0
                : Math.max(0, days(t.s("dueDate"), f.s("asOf").substring(0, 10)));
    List<String> warnings = e.strings("warnings");
    warnings.removeAll(List.of("未获批授信，默认额度为 0", "可用授信不足", "逾期预警", "逾期升级"));
    String outcome = "压力后仍有毛差", tone = "normal";
    if (purchase) {
      outcome = "供应商预付款敞口";
      tone = "watch";
    } else if (remaining == 0) outcome = "已结清（情景假设）";
    else {
      if (e.get("stressedMarginMinor") != null && e.l("stressedMarginMinor") < 0) {
        outcome = "压力后预计亏损";
        tone = "high";
      }
      if (available < 0) {
        warnings.add("情景授信缺口");
        outcome = f.l("limitMinor") == 0 ? "新客未授信" : "授信容量不足";
        tone = "high";
      }
      if (overdue >= r.l("overdueEscalationDays")) {
        warnings.add("逾期升级");
        outcome = "逾期升级";
        tone = "high";
      } else if (overdue >= r.l("overdueWarningDays")) {
        warnings.add("逾期预警");
        outcome = "逾期预警";
        if (!tone.equals("high")) tone = "watch";
      }
    }
    if (!missing.isEmpty()) {
      outcome = "情景输入待补齐";
      tone = "watch";
    }
    return e.with(
        "status",
        missing.isEmpty() ? "情景输入完整" : "情景输入待补齐",
        "missing",
        missing,
        "verificationMissing",
        verification,
        "verificationStatus",
        "演示企业资料未进行真实核验",
        "warnings",
        warnings,
        "outstandingMinor",
        remaining,
        "overdueDays",
        overdue,
        "creditSnapshot",
        null,
        "evaluationAsOf",
        f.get("asOf"),
        "forecast",
        f.with(
            "proposedOccupationMinor",
            proposed,
            "occupiedMinor",
            occupied,
            "availableMinor",
            available,
            "overLimitMinor",
            Math.max(0, -available),
            "utilizationPct",
            f.l("limitMinor") > 0
                ? Math.floor(occupied * 1000d / f.l("limitMinor") + .5d) / 10d
                : null,
            "outstandingMinor",
            remaining,
            "supplierPrepaymentExposureMinor",
            purchase ? f.l("prepaymentMinor") : 0,
            "outcome",
            outcome,
            "tone",
            tone,
            "recommendation",
            f.get("note"),
            "source",
            "estimate",
            "actualLedger",
            false));
  }

  public List<Doc> parseRows(String format, String content) {
    require(content != null && content.length() <= 80000, 400, "导入文件最多 80 KB");
    if ("json".equals(format)) {
      try {
        Object rows = Doc.JSON.readValue(content, Object.class);
        require(rows instanceof List<?>, 400, "JSON 须为记录数组");
        return Doc.docs(rows);
      } catch (Exception e) {
        throw fail(400, "JSON 须为记录数组");
      }
    }
    require("csv".equals(format), 400, "请选择 CSV 或 JSON");
    List<List<String>> rows = new ArrayList<>();
    List<String> row = new ArrayList<>();
    StringBuilder f = new StringBuilder();
    boolean quoted = false, closed = false;
    String data = content.startsWith("\uFEFF") ? content.substring(1) : content;
    for (int i = 0; i < data.length(); i++) {
      char c = data.charAt(i);
      if (quoted) {
        if (c == '"') {
          if (i + 1 < data.length() && data.charAt(i + 1) == '"') {
            f.append('"');
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else f.append(c);
      } else if (c == '"') {
        require(f.isEmpty() && !closed, 400, "CSV 引号位置无效");
        quoted = true;
      } else if (c == ',' || c == '\n' || c == '\r') {
        row.add(f.toString());
        f.setLength(0);
        closed = false;
        if (c != ',') {
          if (c == '\r' && i + 1 < data.length() && data.charAt(i + 1) == '\n') i++;
          if (row.stream().anyMatch(x -> !x.isEmpty())) rows.add(row);
          row = new ArrayList<>();
        }
      } else {
        require(!closed, 400, "CSV 引号后有无效字符");
        f.append(c);
      }
    }
    require(!quoted, 400, "CSV 引号未闭合");
    if (!f.isEmpty() || !row.isEmpty() || closed) {
      row.add(f.toString());
      rows.add(row);
    }
    require(!rows.isEmpty(), 400, "CSV 表头为空");
    List<String> headers = rows.remove(0);
    require(new HashSet<>(headers).size() == headers.size(), 400, "CSV 表头重复");
    List<Doc> out = new ArrayList<>();
    for (List<String> values : rows) {
      require(values.size() == headers.size(), 400, "CSV 列数不匹配");
      Doc d = new Doc();
      for (int i = 0; i < headers.size(); i++) d.put(headers.get(i), values.get(i));
      out.add(d);
    }
    return out;
  }
}
