package com.induport.steel;

import com.induport.auth.AuthService;
import com.induport.common.Doc;
import com.induport.persistence.Transactions;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/steel")
public class SteelController {
  private final SteelService service;
  private final Transactions tx;

  public SteelController(SteelService service, Transactions tx) {
    this.service = service;
    this.tx = tx;
  }

  @GetMapping
  Doc view(@RequestParam(required = false) String companyId, HttpServletRequest request) {
    return tx.write(() -> service.view(AuthService.user(request), companyId));
  }

  @PostMapping("/company")
  Doc create(@RequestBody Doc body, HttpServletRequest request) {
    return tx.write(() -> service.createCompany(AuthService.user(request), body));
  }

  @PostMapping("/{companyId}/{command}")
  Doc command(
      @PathVariable String companyId,
      @PathVariable String command,
      @RequestBody Doc body,
      HttpServletRequest request) {
    return tx.write(() -> service.execute(AuthService.user(request), companyId, command, body));
  }
}
