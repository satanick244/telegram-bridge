package com.induport.auth;

import com.induport.common.*;
import com.induport.persistence.*;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class ApiAuthFilter extends OncePerRequestFilter {
  private final DocumentStore db;
  private final DemoService demos;
  private final Transactions tx;
  private final Environment env;
  private final ConcurrentHashMap<String, long[]> limits = new ConcurrentHashMap<>();

  public ApiAuthFilter(DocumentStore db, DemoService demos, Transactions tx, Environment env) {
    this.db = db;
    this.demos = demos;
    this.tx = tx;
    this.env = env;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    String path = req.getRequestURI();
    if (!path.startsWith("/api/")) {
      chain.doFilter(req, res);
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!List.of("GET", "HEAD", "OPTIONS").contains(req.getMethod())) {
        String
            expected =
                env.getProperty("APP_ORIGIN", req.getScheme() + "://" + req.getHeader("Host")),
            origin = req.getHeader("Origin");
        BusinessException.require(
            (origin == null || origin.equals(expected))
                && !"cross-site".equals(req.getHeader("Sec-Fetch-Site")),
            403,
            "请求来源无效");
      }
      String token = null;
      if (req.getCookies() != null)
        for (Cookie c : req.getCookies())
          if (c.getName().equals(AuthService.COOKIE)) token = c.getValue();
      Doc user = null;
      if (token != null && token.matches("[a-f0-9]{64}")) {
        String id = CanonicalJson.sha256(token);
        Doc s = db.get("sessions", id);
        if (s != null && s.l("expiresAt") > System.currentTimeMillis()) {
          user = db.get("users", s.get("userId"));
          req.setAttribute("induport.sessionId", id);
        } else if (s != null) db.remove("sessions", id);
      }
      if (user != null
          && user.b("isDemo")
          && user.l("demoSeedVersion") == 1
          && List.of("GET", "HEAD").contains(req.getMethod())) {
        String role = user.s("role");
        user = tx.write(() -> demos.provision(role));
      }
      req.setAttribute("induport.user", user);
      if (user != null && user.b("isDemo")) {
        boolean
            readable =
                List.of("GET", "HEAD").contains(req.getMethod())
                    && List.of("/api/health", "/api/auth/me", "/api/bootstrap", "/api/risk")
                        .contains(path),
            action =
                req.getMethod().equals("POST")
                    && List.of(
                            "/api/auth/logout",
                            "/api/auth/login",
                            "/api/auth/register",
                            "/api/auth/demo")
                        .contains(path);
        BusinessException.require(
            readable || action, 403, "演示账号为只读，不能提交真实业务、导入、授信或审批。请退出演示后使用自己的账号。");
      }
      if (req.getMethod().equals("POST")
          && List.of("/api/auth/login", "/api/auth/register", "/api/auth/demo").contains(path)) {
        long n = System.currentTimeMillis();
        long[] a =
            limits.compute(
                req.getRemoteAddr(),
                (k, v) ->
                    v == null || v[1] < n
                        ? new long[] {1, n + 900000}
                        : new long[] {v[0] + 1, v[1]});
        if (a[0] > 30) {
          res.setHeader("Retry-After", String.valueOf(Math.max(1, (a[1] - n) / 1000)));
          throw BusinessException.fail(429, "尝试过于频繁，请稍后再试");
        }
        if (limits.size() > 10000) limits.entrySet().removeIf(e -> e.getValue()[1] < n);
      }
      boolean publicPath =
          List.of(
                  "/api/health",
                  "/api/bootstrap",
                  "/api/profit",
                  "/api/auth/login",
                  "/api/auth/register",
                  "/api/auth/demo",
                  "/api/auth/me",
                  "/api/auth/logout")
              .contains(path);
      BusinessException.require(publicPath || user != null, 401, "请先登录账号");
      if (java.util.List.of("POST", "PUT", "PATCH").contains(req.getMethod())
          && req.getContentType() != null
          && req.getContentType().startsWith("application/json")) {
        BusinessException.require(req.getContentLengthLong() <= 102400, 413, "请求体超过 100 KB");
        byte[] body = req.getInputStream().readNBytes(102401);
        BusinessException.require(body.length <= 102400, 413, "请求体超过 100 KB");
        HttpServletRequest wrapped =
            new HttpServletRequestWrapper(req) {
              @Override
              public ServletInputStream getInputStream() {
                var in = new java.io.ByteArrayInputStream(body);
                return new ServletInputStream() {
                  public int read() {
                    return in.read();
                  }

                  public boolean isFinished() {
                    return in.available() == 0;
                  }

                  public boolean isReady() {
                    return true;
                  }

                  public void setReadListener(ReadListener listener) {
                    throw new UnsupportedOperationException("Synchronous request body");
                  }
                };
              }

              @Override
              public java.io.BufferedReader getReader() {
                return new java.io.BufferedReader(
                    new java.io.InputStreamReader(
                        getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
              }
            };
        chain.doFilter(wrapped, res);
      } else chain.doFilter(req, res);
    } catch (BusinessException e) {
      res.setStatus(e.status());
      res.setContentType("application/json;charset=UTF-8");
      res.getWriter().write(Doc.json(Doc.of("error", e.getMessage())));
    }
  }
}
