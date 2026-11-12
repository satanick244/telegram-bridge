package com.induport.persistence;

import com.induport.common.Doc;
import java.util.*;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@org.springframework.core.annotation.Order(0)
public class SchemaInitializer implements ApplicationRunner {
  private final JdbcTemplate jdbc;
  private final DocumentStore store;
  private final Transactions tx;

  public SchemaInitializer(JdbcTemplate jdbc, DocumentStore store, Transactions tx) {
    this.jdbc = jdbc;
    this.store = store;
    this.tx = tx;
  }

  @Override
  public void run(ApplicationArguments args) throws Exception {
    boolean h2;
    try (var connection = jdbc.getDataSource().getConnection()) {
      h2 = connection.getMetaData().getDatabaseProductName().equals("H2");
    }
    for (String b : DocumentMapper.Sql.BUCKETS)
      jdbc.execute(
          "CREATE TABLE IF NOT EXISTS ip_"
              + b
              + " (id VARCHAR(191)"
              + (h2 ? "" : " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
              + " PRIMARY KEY,data "
              + (h2 ? "CLOB" : "JSON")
              + " NOT NULL)"
              + (h2 ? "" : " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"));
    jdbc.update(
        "INSERT IGNORE INTO ip_risk_locks(id,data) VALUES (?,?)",
        "operations",
        "{\"id\":\"operations\",\"headHash\":null}");
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS ip_outbox (id VARCHAR(64) PRIMARY KEY,owner_id VARCHAR(191)"
            + " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,topic VARCHAR(100) NOT"
            + " NULL,payload TEXT NOT NULL,status VARCHAR(16) NOT NULL,attempts INT NOT"
            + " NULL,available_at BIGINT NOT NULL,created_at BIGINT NOT NULL,INDEX"
            + " ip_outbox_ready(status,available_at))");
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS ip_notification_inbox (event_id VARCHAR(64) PRIMARY"
            + " KEY,received_at BIGINT NOT NULL)");
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS ip_notifications (id VARCHAR(64) PRIMARY KEY,owner_id"
            + " VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,topic VARCHAR(100)"
            + " NOT NULL,entity_id VARCHAR(191),created_at BIGINT NOT NULL,INDEX"
            + " ip_notification_owner(owner_id,created_at))");
    tx.write(
        () -> {
          if (store.get("meta", "catalog-v1") == null) {
            try (var in = SchemaInitializer.class.getResourceAsStream("/catalog.json")) {
              for (Doc p : Doc.docs(Doc.JSON.readValue(in, List.class)))
                if (store.get("products", p.get("id")) == null) store.insert("products", p);
              store.insert(
                  "meta",
                  Doc.of("id", "catalog-v1", "createdAt", com.induport.common.Inputs.now()));
            } catch (Exception e) {
              throw new IllegalStateException("Catalog initialization failed", e);
            }
          }
          return null;
        });
  }
}
