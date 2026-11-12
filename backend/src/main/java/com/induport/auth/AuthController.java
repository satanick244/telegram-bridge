package com.induport.auth;

import static com.induport.common.BusinessException.*;

import com.induport.common.*;
import com.induport.persistence.*;
import jakarta.servlet.http.*;
import java.time.Duration;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
  private final AuthService auth;
  private final DemoService demos;
  private final Transactions tx;
  private final DocumentStore db;
  private final Environment env;

  public AuthController(
      AuthService auth, DemoService demos, Transactions tx, DocumentStore db, Environment env) {
    this.auth = auth;
    this.demos = demos;
    this.tx = tx;
    this.db = db;
    this.env = env;
  }

  private ResponseEntity<Doc> session(Doc u, HttpServletRequest req, int status) {
    String token = tx.write(() -> auth.session(u, (String) req.getAttribute("induport.sessionId")));
    String cookie =
        ResponseCookie.from(AuthService.COOKIE, token)
            .httpOnly(true)
            .secure(env.getProperty("induport.cookie-secure", Boolean.class, true))
            .sameSite("Lax")
            .path("/")
            .maxAge(Duration.ofSeconds(u.b("isDemo") ? 3600 : 14 * 86400))
            .build()
            .toString();
    return ResponseEntity.status(status)
        .header(HttpHeaders.SET_COOKIE, cookie)
        .body(Doc.of("user", auth.publicUser(u)));
  }

  @PostMapping("/register")
  ResponseEntity<Doc> register(@RequestBody Doc b, HttpServletRequest req) {
    String role = b.s("role", "buyer");
    require(List.of("buyer", "supplier").contains(role), 400, "账户类型无效");
    return session(tx.write(() -> auth.create(b, role)), req, 201);
  }

  @PostMapping("/login")
  ResponseEntity<Doc> login(@RequestBody Doc b, HttpServletRequest req) {
    return session(auth.login(b), req, 200);
  }

  @PostMapping("/demo")
  ResponseEntity<Doc> demo(@RequestBody Doc b, HttpServletRequest req) {
    Doc current = AuthService.user(req);
    require(current == null || current.b("isDemo"), 409, "请先退出当前真实账号，再进入只读演示");
    return session(tx.write(() -> demos.provision(b.s("role"))), req, 200);
  }

  @GetMapping("/me")
  Doc me(HttpServletRequest req) {
    return Doc.of("user", auth.publicUser(AuthService.user(req)));
  }

  @PostMapping("/logout")
  ResponseEntity<Doc> logout(HttpServletRequest req) {
    db.remove("sessions", req.getAttribute("induport.sessionId"));
    return ResponseEntity.ok()
        .header(
            HttpHeaders.SET_COOKIE,
            ResponseCookie.from(AuthService.COOKIE, "")
                .httpOnly(true)
                .secure(env.getProperty("induport.cookie-secure", Boolean.class, true))
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build()
                .toString())
        .body(Doc.of("ok", true));
  }
}
