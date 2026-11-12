package com.induport.auth;

import static com.induport.common.BusinessException.*;

import com.induport.common.*;
import com.induport.persistence.*;
import com.induport.risk.RiskRepository;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class DemoService {
  private final DocumentStore db;
  private final RiskRepository risk;
  private final PasswordService passwords;

  public DemoService(DocumentStore db, RiskRepository risk, PasswordService passwords) {
    this.db = db;
    this.risk = risk;
    this.passwords = passwords;
  }

  public Doc provision(String role) {
    require(
        role != null && List.of("buyer", "supplier").contains(role), 400, "仅提供买家和供应商演示，不提供管理员演示");
    String id = "induport_demo_" + role + "_v1";
    Doc old = db.get("users", id);
    int prior = old == null ? 0 : (int) old.l("demoSeedVersion");
    if (old != null) {
      require(
          old.b("isDemo") && old.eq("role", role) && (prior == 1 || prior == 2),
          409,
          "演示账号标识冲突，已保留现有账号");
      if (prior == 2) return old;
    }
    Doc user =
        old == null
            ? Doc.of(
                "id",
                id,
                "username",
                id,
                "displayName",
                role.equals("buyer") ? "买家演示账号 · 只读" : "供应商演示账号 · 只读",
                "role",
                role,
                "isDemo",
                true,
                "demoSeedVersion",
                2,
                "passwordHash",
                passwords.hash(passwords.token()),
                "createdAt",
                Inputs.now())
            : old.with("demoSeedVersion", 2);
    db.put("users", user);
    try (var in = DemoService.class.getResourceAsStream("/demo-" + role + ".json")) {
      Doc template = Doc.JSON.readValue(in, Doc.class);
      long offset = Duration.between(Instant.parse(template.s("asOf")), Instant.now()).toMillis();
      long dayOffset = Inputs.days(template.s("asOf").substring(0, 10), Inputs.today());
      List<Doc> rows = new ArrayList<>();
      for (Doc d : template.rows("records")) {
        Doc row = Doc.from(shift(d, offset, dayOffset));
        db.insert("risk_records", row);
        rows.add(row);
      }
      risk.audit(
          Doc.of("id", "system:demo-provision", "isDemo", true),
          id,
          prior == 0 ? "demo.seed" : "demo.upgrade",
          id,
          Doc.of(
              "source",
              "estimate",
              "reason",
              "只读演示资料；不代表真实交易或资质",
              "fromVersion",
              prior,
              "seedVersion",
              2,
              "records",
              rows));
    } catch (Exception e) {
      if (e instanceof BusinessException b) throw b;
      throw new IllegalStateException("Demo initialization failed", e);
    }
    return user;
  }

  private Object shift(Object value, long offset, long dayOffset) {
    if (value instanceof Map<?, ?> m) {
      Doc d = new Doc();
      m.forEach((k, v) -> d.put((String) k, shift(v, offset, dayOffset)));
      return d;
    }
    if (value instanceof List<?> l)
      return l.stream().map(v -> shift(v, offset, dayOffset)).toList();
    if (value instanceof String s) {
      try {
        if (s.matches("\\d{4}-\\d{2}-\\d{2}T.*Z"))
          return Instant.parse(s).plusMillis(offset).toString();
        if (s.matches("\\d{4}-\\d{2}-\\d{2}"))
          return LocalDate.parse(s).plusDays(dayOffset).toString();
      } catch (DateTimeException ignored) {
      }
    }
    return value;
  }

  public Doc bootstrap(Doc user, List<Doc> products) {
    Doc row = db.get("risk_records", "demo:" + user.s("role") + ":v2:business");
    require(
        row != null && row.same("ownerId", user, "id") && row.b("isDemo"),
        503,
        "演示资料暂不可用，请重新进入演示账号");
    List<Doc> p = new ArrayList<>(products);
    p.addAll(row.rows("products"));
    return Doc.of(
        "products",
        p,
        "suppliers",
        row.get("suppliers"),
        "orders",
        row.get("orders"),
        "inquiries",
        row.get("inquiries"),
        "applications",
        row.get("applications"),
        "demo",
        Doc.of(
            "readOnly",
            true,
            "source",
            "example",
            "notice",
            "企业、合同、库存和金额均为模拟数据，仅供功能体验。",
            "asOf",
            row.get("createdAt")));
  }
}
