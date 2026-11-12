package com.induport.risk;

import com.induport.auth.AuthService;
import com.induport.common.*;
import com.induport.persistence.Transactions;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class RiskController {
  private final RiskService risk;
  private final RiskRepository repo;
  private final RiskFlowService flow;
  private final MonitorService monitor;
  private final Transactions tx;

  public RiskController(
      RiskService risk,
      RiskRepository repo,
      RiskFlowService flow,
      MonitorService monitor,
      Transactions tx) {
    this.risk = risk;
    this.repo = repo;
    this.flow = flow;
    this.monitor = monitor;
    this.tx = tx;
  }

  @GetMapping("/risk")
  Doc view(HttpServletRequest q) {
    return tx.write(() -> risk.view(AuthService.user(q)));
  }

  @PostMapping("/risk/profiles")
  @ResponseStatus(HttpStatus.CREATED)
  Doc profile(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.profile(AuthService.user(q), b, "manual"));
  }

  @PatchMapping("/risk/profiles/{id}")
  Doc patch(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.patchProfile(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/trades")
  @ResponseStatus(HttpStatus.CREATED)
  Doc trade(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.trade(AuthService.user(q), b, "manual"));
  }

  @PostMapping("/risk/trades/{id}/archive")
  Doc archive(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.archive(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/trades/{id}/evaluate")
  @ResponseStatus(HttpStatus.CREATED)
  Doc evaluate(@PathVariable String id, HttpServletRequest q) {
    return tx.write(
        () ->
            risk.saveEvaluation(
                AuthService.user(q), repo.accessible(AuthService.user(q), id, "trade")));
  }

  @PostMapping("/risk/approvals/receipt")
  Doc oldReceipt() {
    throw BusinessException.fail(409, "请在资金与应收中登记到账凭据，经另一位管理员确认后再分配核销");
  }

  @PostMapping("/risk/approvals/credit")
  @ResponseStatus(HttpStatus.CREATED)
  Doc credit(
      @jakarta.validation.Valid @RequestBody com.induport.api.Requests.Credit b,
      HttpServletRequest q) {
    return tx.write(() -> risk.request(AuthService.user(q), "credit", b.doc()));
  }

  @PostMapping("/risk/approvals/{type}")
  @ResponseStatus(HttpStatus.CREATED)
  Doc request(@PathVariable String type, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.request(AuthService.user(q), type, b));
  }

  @PostMapping("/risk/approvals/{id}/decide")
  Doc decide(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.decide(AuthService.user(q), id, b));
  }

  @PutMapping("/risk/rules")
  Doc rules(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.rules(AuthService.user(q), b));
  }

  @PostMapping("/risk/alerts/scan")
  Doc scan(HttpServletRequest q) {
    return tx.write(() -> risk.scan(AuthService.user(q)));
  }

  @PatchMapping("/risk/tickets/{id}")
  Doc ticket(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.ticket(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/import")
  @ResponseStatus(HttpStatus.CREATED)
  Doc importRows(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> risk.importRows(AuthService.user(q), b));
  }

  @GetMapping("/risk/audit/verify")
  Doc verify(HttpServletRequest q) {
    return tx.write(() -> risk.verify(AuthService.user(q)));
  }

  @GetMapping("/risk/flow")
  Doc flow(HttpServletRequest q) {
    return tx.write(() -> flow.view(AuthService.user(q)));
  }

  @PostMapping("/risk/receivables")
  @ResponseStatus(HttpStatus.CREATED)
  Doc invoice(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> flow.invoice(AuthService.user(q), b));
  }

  @PostMapping("/risk/cash-receipts")
  @ResponseStatus(HttpStatus.CREATED)
  Doc receipt(
      @jakarta.validation.Valid @RequestBody com.induport.api.Requests.Arrival b,
      HttpServletRequest q) {
    return tx.write(() -> flow.receipt(AuthService.user(q), b.doc()));
  }

  @PostMapping("/risk/cash-receipts/{id}/confirm")
  Doc confirm(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> flow.confirm(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/flow-approvals/allocation")
  @ResponseStatus(HttpStatus.CREATED)
  Doc allocation(
      @jakarta.validation.Valid @RequestBody com.induport.api.Requests.Allocation b,
      HttpServletRequest q) {
    return tx.write(() -> flow.request(AuthService.user(q), "allocation", b.doc()));
  }

  @PostMapping("/risk/flow-approvals/{type}")
  @ResponseStatus(HttpStatus.CREATED)
  Doc flowRequest(@PathVariable String type, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> flow.request(AuthService.user(q), type, b));
  }

  @PostMapping("/risk/flow-approvals/{id}/decide")
  Doc flowDecide(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> flow.decide(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/credits/{id}/freeze")
  Doc freeze(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> flow.freeze(AuthService.user(q), id, b));
  }

  @GetMapping("/orders/{id}/risk-release")
  Doc release(@PathVariable String id, HttpServletRequest q) {
    return tx.write(() -> flow.releaseView(AuthService.user(q), id));
  }

  @PostMapping("/risk/reviews/scan")
  Doc reviewScan(HttpServletRequest q) {
    Doc u = AuthService.user(q);
    return tx.write(() -> monitor.scan(u, u.eq("role", "admin") ? null : u.s("id")));
  }

  @PostMapping("/risk/reviews")
  @ResponseStatus(HttpStatus.CREATED)
  Doc reviewRequest(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.requestReview(AuthService.user(q), b));
  }

  @PatchMapping("/risk/reviews/{id}")
  Doc assign(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.assign(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/reviews/{id}/decide")
  Doc reviewDecision(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.decideReview(AuthService.user(q), id, b));
  }

  @PostMapping("/risk/trade-controls")
  @ResponseStatus(HttpStatus.CREATED)
  Doc controlRequest(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.requestControl(AuthService.user(q), b));
  }

  @PostMapping("/risk/securities")
  @ResponseStatus(HttpStatus.CREATED)
  Doc securityRequest(@RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.requestSecurity(AuthService.user(q), b));
  }

  @PostMapping("/risk/trade-controls/{id}/decide")
  Doc controlDecision(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.decideControl(AuthService.user(q), id, b, false));
  }

  @PostMapping("/risk/securities/{id}/decide")
  Doc securityDecision(@PathVariable String id, @RequestBody Doc b, HttpServletRequest q) {
    return tx.write(() -> monitor.decideControl(AuthService.user(q), id, b, true));
  }
}
