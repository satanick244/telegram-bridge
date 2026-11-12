package com.induport.trade;

import com.induport.auth.AuthService;
import com.induport.common.*;
import com.induport.persistence.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class TradeController {
  private final TradeService service;
  private final Transactions tx;
  private final DocumentStore db;
  private final JdbcTemplate jdbc;
  private final com.induport.config.StartupState state;
  private final com.induport.integration.CatalogCache cache;

  public TradeController(
      TradeService service,
      Transactions tx,
      DocumentStore db,
      JdbcTemplate jdbc,
      com.induport.config.StartupState state,
      com.induport.integration.CatalogCache cache) {
    this.service = service;
    this.tx = tx;
    this.db = db;
    this.jdbc = jdbc;
    this.state = state;
    this.cache = cache;
  }

  @GetMapping("/health")
  Doc health() {
    BusinessException.require(state.ready(), 503, "服务初始化中");
    jdbc.queryForObject("SELECT 1", Integer.class);
    return Doc.of(
        "ok",
        true,
        "mode",
        "sourcing",
        "database",
        "mysql",
        "backend",
        "java",
        "javaVersion",
        Runtime.version().feature(),
        "riskVersion",
        "steel-risk-v3",
        "demoVersion",
        "forecast-demo-v2");
  }

  @GetMapping("/bootstrap")
  Doc bootstrap(HttpServletRequest req) {
    Doc user = AuthService.user(req);
    return user == null ? cache.anonymous(() -> service.bootstrap(null)) : service.bootstrap(user);
  }

  @PostMapping("/profit")
  Doc profit(@RequestBody Doc b) {
    return TradeService.profit(b);
  }

  @GetMapping("/admin/backup")
  ResponseEntity<Doc> backup(HttpServletRequest req) {
    AuthService.admin(AuthService.user(req));
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=induport.backup.json")
        .body(
            tx.write(
                () -> {
                  Doc tables = new Doc();
                  for (String bucket :
                      List.of(
                          "products",
                          "suppliers",
                          "orders",
                          "inquiries",
                          "applications",
                          "users",
                          "risk_records",
                          "risk_audit",
                          "risk_locks"))
                    tables.put(
                        bucket, db.all(bucket).stream().filter(d -> !d.b("isSample")).toList());
                  return Doc.of(
                      "format", "induport-backup-v1", "createdAt", Inputs.now(), "tables", tables);
                }));
  }

  @PostMapping("/products")
  @ResponseStatus(HttpStatus.CREATED)
  Doc product(@RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.createProduct(AuthService.user(req), b));
  }

  @PatchMapping("/products/{id}")
  Doc status(@PathVariable String id, @RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.productStatus(AuthService.user(req), id, b));
  }

  @PostMapping("/applications")
  @ResponseStatus(HttpStatus.CREATED)
  Doc application(@RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.application(AuthService.user(req), b));
  }

  @PatchMapping("/applications/{id}")
  Doc decide(@PathVariable String id, @RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.applicationDecision(AuthService.user(req), id, b));
  }

  @PostMapping("/orders")
  @ResponseStatus(HttpStatus.CREATED)
  Doc order(@RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.order(AuthService.user(req), b));
  }

  @PatchMapping("/orders/{id}/advance")
  Doc advance(@PathVariable String id, @RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.advance(AuthService.user(req), id, b));
  }

  @PostMapping("/inquiries")
  @ResponseStatus(HttpStatus.CREATED)
  Doc inquiry(@RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.inquiry(AuthService.user(req), b));
  }

  @PostMapping("/inquiries/batch")
  @ResponseStatus(HttpStatus.CREATED)
  Doc batch(@RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.batch(AuthService.user(req), b));
  }

  @PostMapping("/inquiries/custom")
  @ResponseStatus(HttpStatus.CREATED)
  Doc custom(@RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.custom(AuthService.user(req), b));
  }

  @PatchMapping("/inquiries/{id}/quote")
  Doc quote(@PathVariable String id, @RequestBody Doc b, HttpServletRequest req) {
    return tx.write(() -> service.quote(AuthService.user(req), id, b));
  }
}
