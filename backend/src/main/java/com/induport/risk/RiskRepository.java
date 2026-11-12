package com.induport.risk;

import static com.induport.common.BusinessException.*;
import static com.induport.common.CanonicalJson.*;

import com.induport.common.*;
import com.induport.persistence.DocumentStore;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
public class RiskRepository {
  public static final Doc DEFAULT_RULES =
      Doc.of(
          "id",
          "rules",
          "kind",
          "rules",
          "version",
          1,
          "overdueWarningDays",
          1,
          "overdueEscalationDays",
          7,
          "marketDataMaxAgeDays",
          7,
          "steelShockPct",
          5,
          "fxShockPct",
          3,
          "freightShockPct",
          10,
          "trialOnly",
          true,
          "autoCredit",
          false,
          "calibrated",
          false);
  public static final Doc WORKFLOW =
      Doc.of(
          "version",
          4,
          "makerChecker",
          true,
          "shipmentValidityHours",
          24,
          "automaticPayment",
          false,
          "automaticWarehouseRelease",
          false);
  public final DocumentStore db;

  public RiskRepository(DocumentStore db) {
    this.db = db;
  }

  public List<Doc> rows() {
    return db.all("risk_records");
  }

  public Doc get(Object id) {
    return db.get("risk_records", id);
  }

  public Doc put(Doc d) {
    return db.put("risk_records", d);
  }

  public Doc insert(Doc d) {
    return db.insert("risk_records", d);
  }

  public Doc rules() {
    Doc d = new Doc(DEFAULT_RULES);
    Doc old = get("rules");
    if (old != null) d.putAll(old);
    return d;
  }

  public static boolean owns(Doc user, Doc row) {
    return user != null
        && row != null
        && (user.eq("role", "admin") || row.same("ownerId", user, "id"));
  }

  public Doc accessible(Doc user, Object id, String kind) {
    Doc row = get(id);
    require(
        owns(user, row) && row.eq("kind", kind) && (!row.b("isDemo") || user.b("isDemo")),
        404,
        "记录不存在或无权访问");
    return row;
  }

  public Doc real(Doc user, Object id, String kind) {
    Doc row = accessible(user, id, kind);
    require(!row.b("isDemo") && Inputs.real(row.get("source")), 400, "仅支持真实录入或导入的业务资料");
    return row;
  }

  public static String accountId(Object profile, Object currency) {
    return key("credit", profile, currency);
  }

  public static Long balance(Doc t) {
    if (t.b("cancelled")) return 0L;
    if (t.get("amountMinor") == null) return null;
    return t.l("amountMinor") - t.l("receivedMinor") - t.l("releasedMinor");
  }

  public void audit(Doc user, String owner, String action, String entity, Object payload) {
    Doc root = db.get("risk_locks", "operations");
    Doc row =
        Doc.of(
            "id",
            Inputs.id("AUD-"),
            "sequence",
            root.l("sequence") + 1,
            "ownerId",
            owner,
            "actorId",
            user.s("id"),
            "action",
            action,
            "entityId",
            entity,
            "at",
            Inputs.now(),
            "payload",
            payload,
            "previousHash",
            root.get("headHash"));
    if (user.b("isDemo") || action.startsWith("demo.")) row.put("isDemo", true);
    row.put("hash", digest(row));
    db.insert("risk_audit", row);
    db.put("risk_locks", root.with("sequence", row.l("sequence"), "headHash", row.get("hash")));
  }

  public static List<String> creditProblems(Doc c, Doc t, Doc p) {
    List<String> issues = new ArrayList<>();
    if (c == null) return List.of("未获批授信");
    String today = Inputs.today();
    if (p != null && c.l("profileVersion") != p.l("version")) issues.add("客户档案已更新或未复核，须重新审批授信");
    if (c.b("frozen")) issues.add("授信已冻结");
    if (c.get("validUntil") == null) issues.add("历史授信未设置有效期，须重新审批");
    else if (c.s("validUntil").compareTo(today) < 0) issues.add("授信已到期");
    if (c.l("occupiedMinor") > c.l("limitMinor")) issues.add("当前占用超过授信额度");
    if (t != null) {
      if (t.get("dueDate") != null
          && c.get("validUntil") != null
          && t.s("dueDate").compareTo(c.s("validUntil")) > 0) issues.add("合同到期日超出授信有效期");
      if (c.get("maxSingleMinor") != null && balance(t) > c.l("maxSingleMinor"))
        issues.add("超出单笔授信上限");
      if (c.l("maxTermDays") == 0) issues.add("授信账期条件未确认");
      else if (t.get("dueDate") != null
          && Inputs.days(t.s("createdAt", Inputs.now()).substring(0, 10), t.s("dueDate"))
              > c.l("maxTermDays")) issues.add("超出获批账期");
    }
    return issues;
  }
}
