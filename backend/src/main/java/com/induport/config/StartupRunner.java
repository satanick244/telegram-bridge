package com.induport.config;

import com.induport.auth.AuthService;
import com.induport.common.Doc;
import com.induport.persistence.*;
import com.induport.risk.*;
import org.springframework.boot.*;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
@Order(10)
public class StartupRunner implements ApplicationRunner {
  private final DocumentStore db;
  private final Transactions tx;
  private final AuthService auth;
  private final Environment env;
  private final RiskService risk;
  private final MonitorService monitor;
  private final StartupState state;

  public StartupRunner(
      DocumentStore db,
      Transactions tx,
      AuthService auth,
      Environment env,
      RiskService risk,
      MonitorService monitor,
      StartupState state) {
    this.db = db;
    this.tx = tx;
    this.auth = auth;
    this.env = env;
    this.risk = risk;
    this.monitor = monitor;
    this.state = state;
  }

  @Override
  public void run(ApplicationArguments args) {
    tx.write(
        () -> {
          String username = env.getProperty("ADMIN_USERNAME"),
              password = env.getProperty("ADMIN_PASSWORD");
          if (username != null && !username.isBlank() || password != null && !password.isBlank()) {
            if (username == null || username.isBlank() || password == null || password.isBlank())
              throw new IllegalStateException("Both admin settings are required");
            Doc old = db.get("users", auth.username(username));
            if (old == null)
              auth.create(
                  Doc.of("username", username, "password", password, "displayName", "平台管理员"),
                  "admin");
            else if (!old.eq("role", "admin"))
              throw new IllegalStateException("Configured admin belongs to a non-admin account");
          }
          if (!risk.verify(Doc.of("id", "system:startup", "role", "admin")).b("ok"))
            throw new IllegalStateException(
                "Historical audit chain verification failed; database was not reset");
          return null;
        });
    if (env.getProperty("INDUPORT_JOBS_ENABLED", Boolean.class, true))
      tx.write(() -> monitor.scan(Doc.of("id", "system:risk-monitor"), null));
    state.markReady();
  }
}
