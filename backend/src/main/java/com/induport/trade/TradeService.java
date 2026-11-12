package com.induport.trade;

import static com.induport.common.BusinessException.*;
import static com.induport.common.Inputs.*;
import static com.induport.risk.RiskRepository.owns;

import com.induport.auth.*;
import com.induport.common.*;
import com.induport.persistence.*;
import com.induport.risk.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class TradeService {
  public static final List<String>
      CATEGORIES = List.of("钢卷", "钢管", "建筑钢材", "钢板", "型钢", "电动工具", "电气与能源", "工业防护"),
      UNITS = List.of("吨", "件", "套", "米", "双"),
      STAGES = List.of("待确认", "合同确认", "生产备货", "待装运", "运输中", "已完成");
  public static final Map<String, List<String>> IMAGES =
      Map.of(
          "钢卷",
          List.of("coil", "galvanized"),
          "钢管",
          List.of("pipe"),
          "建筑钢材",
          List.of("rebar"),
          "钢板",
          List.of("sheet"),
          "型钢",
          List.of("beam"),
          "电动工具",
          List.of("drill", "grinder", "hammer", "saw", "sander", "bits"),
          "电气与能源",
          List.of("solar", "meter"),
          "工业防护",
          List.of("helmet", "gloves"));
  private final DocumentStore db;
  private final AuthService auth;
  private final DemoService demos;
  private final RiskFlowService flow;

  public TradeService(DocumentStore db, AuthService auth, DemoService demos, RiskFlowService flow) {
    this.db = db;
    this.auth = auth;
    this.demos = demos;
    this.flow = flow;
  }

  public static String unit(Doc p) {
    return p.s("unit", CATEGORIES.subList(0, 5).contains(p.s("category", "钢卷")) ? "吨" : "件");
  }

  private static String email(Object v) {
    String s = text(v, "邮箱", 200);
    require(s.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"), 400, "请输入有效邮箱");
    return s;
  }

  private Doc cleanProduct(Doc p, Doc u) {
    return owns(u, p) ? p : p.without("cost", "ownerId");
  }

  public Doc bootstrap(Doc u) {
    List<Doc> products = db.all("products");
    if (u != null && u.b("isDemo")) {
      List<Doc> publicProducts =
          products.stream()
              .filter(p -> !p.b("isSample") && p.b("catalogOnly") && p.eq("status", "在售"))
              .map(p -> cleanProduct(p, u))
              .toList();
      return demos.bootstrap(u, publicProducts).with("user", auth.publicUser(u));
    }
    List<Doc> suppliers = db.all("suppliers").stream().filter(s -> !s.b("isSample")).toList();
    Set<String> mine = new HashSet<>();
    suppliers.stream().filter(s -> owns(u, s)).forEach(s -> mine.add(s.s("id")));
    List<Doc> ps =
        products.stream()
            .filter(p -> !p.b("isSample") && (p.eq("status", "在售") || owns(u, p)))
            .map(p -> cleanProduct(p, u))
            .toList();
    Doc result =
        Doc.of(
            "user",
            auth.publicUser(u),
            "products",
            sort(ps),
            "suppliers",
            suppliers.stream().map(s -> owns(u, s) ? s : s.without("contact", "ownerId")).toList());
    for (String bucket : List.of("orders", "inquiries", "applications")) {
      List<Doc> visible =
          u == null
              ? List.of()
              : db.all(bucket).stream()
                  .filter(
                      x ->
                          !x.b("isSample")
                              && (owns(u, x)
                                  || !bucket.equals("applications")
                                      && mine.contains(x.s("supplierId"))))
                  .map(
                      x ->
                          bucket.equals("orders")
                                  && !u.eq("role", "admin")
                                  && !mine.contains(x.s("supplierId"))
                              ? x.without("costCny")
                              : x)
                  .toList();
      result.put(bucket, sort(visible));
    }
    return result;
  }

  private List<Doc> sort(List<Doc> list) {
    return list.stream()
        .sorted(Comparator.comparing((Doc d) -> d.s("createdAt", "")).reversed())
        .toList();
  }

  public Doc createProduct(Doc u, Doc b) {
    Doc s = db.get("suppliers", b.get("supplierId"));
    require(s != null && !s.b("isSample"), 400, "请选择有效供应商");
    require(owns(u, s), 403, "只能为自己的供应商档案发布商品");
    String category = choice(b.get("category"), CATEGORIES, "品类");
    double stock = strictNumber(b.get("stock"), "库存", 1, 1e7),
        moq = strictNumber(b.get("moq"), "起订量", 1, 1e7);
    require(
        stock == Math.rint(stock) && moq == Math.rint(moq) && moq <= stock,
        400,
        "库存与起订量须为整数，且库存不少于起订量");
    Doc p =
        Doc.of(
            "id",
            UUID.randomUUID().toString(),
            "ownerId",
            s.getOrDefault("ownerId", u.get("id")),
            "supplierId",
            s.get("id"),
            "name",
            text(b.get("name"), "商品名称", 80),
            "en",
            text(blank(b.get("en")) ? b.get("name") : b.get("en"), "英文名称", 120),
            "category",
            category,
            "unit",
            UNITS.contains(b.s("unit", "")) ? b.s("unit") : unit(Doc.of("category", category)),
            "grade",
            text(b.get("grade"), "型号或牌号", 80),
            "spec",
            text(b.get("spec"), "规格", 150),
            "price",
            strictNumber(b.get("price"), "售价", 1, 1e6),
            "cost",
            strictNumber(b.get("cost"), "成本", 0, 1e6),
            "stock",
            stock,
            "moq",
            moq,
            "port",
            text(b.get("port"), "装运港", 200),
            "term",
            List.of("FOB", "CIF", "CFR", "EXW").contains(b.s("term", "")) ? b.s("term") : "FOB",
            "image",
            IMAGES.get(category).contains(b.s("image", ""))
                ? b.s("image")
                : IMAGES.get(category).get(0),
            "certifications",
            text(blank(b.get("certifications")) ? "待补充" : b.get("certifications"), "认证", 200),
            "lead",
            text(blank(b.get("lead")) ? "按合同确认" : b.get("lead"), "交期", 200),
            "status",
            "在售",
            "createdAt",
            now());
    return db.insert("products", p);
  }

  public Doc productStatus(Doc u, String id, Doc b) {
    Doc p = db.get("products", id);
    require(p != null, 404, "商品不存在");
    require(owns(u, p), 403, "无权修改该商品");
    return db.put(
        "products", p.with("status", choice(b.get("status"), List.of("在售", "已下架"), "商品状态")));
  }

  public Doc application(Doc u, Doc b) {
    String registration = text(b.get("registration"), "统一社会信用代码", 18).toUpperCase(Locale.ROOT);
    require(registration.matches("[0-9A-Z]{18}"), 400, "统一社会信用代码须为 18 位字母或数字");
    require(
        db.all("applications").stream().noneMatch(a -> a.eq("registration", registration)),
        400,
        "该企业已提交申请，请勿重复提交");
    Doc a =
        Doc.of(
            "id",
            id("APP-"),
            "ownerId",
            u.get("id"),
            "company",
            text(b.get("company"), "企业名称", 100),
            "registration",
            registration,
            "contact",
            text(b.get("contact"), "联系人", 80),
            "email",
            email(b.get("email")),
            "location",
            text(b.get("location"), "企业所在地", 200),
            "category",
            text(b.get("category"), "主营品类", 200),
            "capacity",
            strictNumber(b.get("capacity"), "年产能", 1, 1e9),
            "capacityUnit",
            UNITS.contains(b.s("capacityUnit", "")) ? b.s("capacityUnit") : "吨",
            "certifications",
            text(blank(b.get("certifications")) ? "待补充" : b.get("certifications"), "认证", 200),
            "status",
            "待审核",
            "createdAt",
            now());
    return db.insert("applications", a);
  }

  public Doc applicationDecision(Doc u, String id, Doc b) {
    AuthService.admin(u);
    Doc a = db.get("applications", id);
    require(a != null, 404, "申请不存在");
    require(a.eq("status", "待审核"), 400, "该申请已处理");
    String status = choice(b.get("status"), List.of("已通过", "需补充资料"), "审核状态");
    if (status.equals("已通过")) {
      db.put(
          "suppliers",
          Doc.of(
              "id",
              a.get("id"),
              "ownerId",
              a.get("ownerId"),
              "name",
              a.get("company"),
              "en",
              a.get("company"),
              "location",
              a.get("location"),
              "contact",
              a.get("contact"),
              "verified",
              false,
              "certifications",
              a.get("certifications"),
              "years",
              0,
              "score",
              null));
      Doc owner = db.get("users", a.get("ownerId"));
      if (owner != null && !owner.eq("role", "admin"))
        db.put("users", owner.with("role", "supplier"));
    }
    return db.put("applications", a.with("status", status));
  }

  @com.induport.integration.BusinessEvent("order.created")
  public Doc order(Doc u, Doc b) {
    Doc p = db.get("products", b.get("productId"));
    require(p != null && p.eq("status", "在售"), 400, "商品不存在或已下架");
    require(
        !p.b("catalogOnly") && p.get("price") instanceof Number && p.get("stock") instanceof Number,
        400,
        "该商品需先询价并确认供应、价格与库存后才能下单");
    double q = strictNumber(b.get("quantity"), "采购量", 1, 1e7);
    require(
        q == Math.rint(q) && q >= p.n("moq"), 400, "采购量须为整数，且不少于 " + p.n("moq") + " " + unit(p));
    require(q <= p.n("stock"), 400, "当前可售库存不足");
    Doc row =
        Doc.of(
            "id",
            id("IP-" + today().substring(0, 7).replace("-", "") + "-"),
            "ownerId",
            u.get("id"),
            "productId",
            p.get("id"),
            "productName",
            p.get("name"),
            "supplierId",
            p.get("supplierId"),
            "buyer",
            text(b.get("buyer"), "买方企业", 200),
            "email",
            email(b.get("email")),
            "country",
            text(b.get("country"), "目的国", 200),
            "destination",
            text(b.get("destination"), "目的港", 200),
            "quantity",
            q,
            "unit",
            unit(p),
            "unitPrice",
            p.get("price"),
            "costCny",
            p.get("cost"),
            "exchangeRate",
            7.12,
            "feeRate",
            2,
            "total",
            round2(p.n("price") * q),
            "term",
            p.get("term"),
            "status",
            "待确认",
            "createdAt",
            now(),
            "history",
            List.of(Doc.of("status", "待确认", "at", now())));
    db.put("products", p.with("stock", p.n("stock") - q));
    db.insert("orders", row);
    return u.eq("role", "admin") ? row : row.without("costCny");
  }

  public Doc advance(Doc u, String id, Doc b) {
    Doc o = db.get("orders", id);
    require(o != null && !o.b("isSample"), 404, "订单不存在");
    Doc supplier = db.get("suppliers", o.get("supplierId"));
    require(owns(u, supplier), 403, "订单履约状态由供应商维护");
    if (b.get("shipmentApprovalId") != null
        && o.eq("shipmentApprovalId", b.get("shipmentApprovalId"))
        && List.of("运输中", "已完成").contains(o.s("status"))) return o;
    if (b.get("shipmentApprovalId") != null)
      require(o.eq("status", "待装运"), 409, "发货审批仅用于待装运订单的首次发货");
    int i = STAGES.indexOf(o.s("status"));
    require(i >= 0 && i < STAGES.size() - 1, 400, "订单已完成");
    String status = STAGES.get(i + 1);
    Doc event = Doc.of("status", status, "at", now());
    if (status.equals("运输中")) {
      Doc release = flow.consumeShipment(u, o, b.s("shipmentApprovalId"));
      o = o.with("shipmentApprovalId", release.get("id"));
      event.put("shipmentApprovalId", release.get("id"));
    }
    List<Doc> history = new ArrayList<>(o.rows("history"));
    history.add(event);
    return db.put("orders", o.with("status", status, "history", history));
  }

  private Doc inquiryInfo(Doc u, Doc b) {
    return Doc.of(
        "ownerId",
        u.get("id"),
        "buyer",
        text(b.get("buyer"), "公司名称", 200),
        "email",
        email(b.get("email")),
        "country",
        text(b.get("country"), "目的国", 200),
        "message",
        text(b.get("message"), "采购要求", 2000),
        "status",
        "待报价",
        "createdAt",
        now());
  }

  private Doc inquiryRow(Doc info, Doc b, boolean batch) {
    Doc p = db.get("products", b.get("productId"));
    require(p != null && p.eq("status", "在售"), 400, "询价商品不存在或已下架");
    double quantity =
        strictNumber(
            b.get("quantity"),
            "询价数量",
            p.get("moq") == null ? 1 : p.n("moq"),
            batch || p.b("catalogOnly") ? 1e7 : p.n("stock"));
    require(quantity == Math.rint(quantity), 400, "询价数量须为整数");
    return info.with(
        "id",
        id("RFQ-"),
        "productId",
        p.get("id"),
        "productName",
        p.get("name"),
        "quantity",
        quantity,
        "unit",
        unit(p),
        "supplierId",
        p.get("supplierId"));
  }

  public Doc inquiry(Doc u, Doc b) {
    return db.insert("inquiries", inquiryRow(inquiryInfo(u, b), b, false));
  }

  public Doc batch(Doc u, Doc b) {
    List<Doc> items = b.rows("items");
    require(!items.isEmpty() && items.size() <= 20, 400, "询价篮须包含 1–20 款商品");
    Set<String> ids = new HashSet<>();
    for (Doc item : items)
      require(
          item.get("productId") instanceof String && ids.add(item.s("productId")),
          400,
          "请选择商品并合并重复项");
    String group = id("RFQ-G-");
    Doc info = inquiryInfo(u, b).with("groupId", group);
    List<Doc> rows = new ArrayList<>();
    for (Doc item : items) rows.add(inquiryRow(info, item, true));
    rows.forEach(r -> db.insert("inquiries", r));
    return Doc.of("id", group, "items", rows, "status", "待报价", "createdAt", info.get("createdAt"));
  }

  public Doc custom(Doc u, Doc b) {
    double q = strictNumber(b.get("quantity"), "采购量", 1, 1e7);
    require(q == Math.rint(q), 400, "采购量须为整数");
    return db.insert(
        "inquiries",
        inquiryInfo(u, b)
            .with(
                "id",
                id("RFQ-"),
                "productId",
                null,
                "custom",
                true,
                "productName",
                text(b.get("productName"), "采购商品", 120),
                "category",
                text(b.get("category"), "采购品类", 80),
                "quantity",
                q,
                "unit",
                choice(b.get("unit"), UNITS, "计量单位")));
  }

  public Doc quote(Doc u, String id, Doc b) {
    Doc q = db.get("inquiries", id);
    require(q != null && !q.b("isSample"), 404, "询价单不存在");
    require(
        u.eq("role", "admin") || owns(u, db.get("suppliers", q.get("supplierId"))),
        403,
        "只能回复发给自己企业的询价");
    require(q.eq("status", "待报价"), 400, "该询价已报价");
    return db.put(
        "inquiries",
        q.with(
            "quotedPrice",
            strictNumber(b.get("price"), "报价", 1, 1e6),
            "status",
            "已报价",
            "quotedAt",
            now()));
  }

  public static Doc profit(Doc b) {
    Doc n =
        Doc.of(
            "price",
            b.get("price"),
            "cost",
            b.get("cost"),
            "quantity",
            b.get("quantity"),
            "freight",
            b.getOrDefault("freight", 0),
            "other",
            b.getOrDefault("other", 0),
            "feeRate",
            b.getOrDefault("feeRate", 2),
            "exchangeRate",
            b.getOrDefault("exchangeRate", 7.12));
    for (String k : n.keySet()) strictNumber(n.get(k), k, 0, Double.MAX_VALUE);
    require(
        n.n("quantity") > 0 && n.n("exchangeRate") > 0 && n.n("feeRate") <= 100, 400, "数量、汇率或费率无效");
    double revenue = round2(n.n("price") * n.n("quantity")),
        purchase = round2(n.n("cost") / n.n("exchangeRate") * n.n("quantity")),
        fee = round2(revenue * n.n("feeRate") / 100),
        logistics = round2(n.n("freight") * n.n("quantity")),
        expenses = round2(purchase + fee + logistics + n.n("other")),
        profit = round2(revenue - expenses);
    return Doc.of(
        "revenue",
        revenue,
        "purchaseCost",
        purchase,
        "platformFee",
        fee,
        "logistics",
        logistics,
        "expenses",
        expenses,
        "profit",
        profit,
        "margin",
        revenue == 0 ? 0 : round2(profit / revenue * 100),
        "perTon",
        round2(profit / n.n("quantity")));
  }
}
