package com.induport.config;

import com.zaxxer.hikari.HikariDataSource;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.security.cert.CertificateFactory;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;

@Configuration
public class DatabaseConfig {
  @Bean
  DataSource dataSource(DataSourceProperties properties, Environment env) throws Exception {
    if ("production".equals(System.getenv("NODE_ENV"))
        && System.getenv("MYSQL_HOST") == null
        && System.getenv("INDUPORT_JDBC_URL") == null)
      throw new IllegalStateException("Production MySQL settings are required; no local fallback");
    HikariDataSource ds =
        properties.initializeDataSourceBuilder().type(HikariDataSource.class).build();
    ds.setMaximumPoolSize(8);
    ds.setConnectionTimeout(15000);
    if (ds.getJdbcUrl().startsWith("jdbc:mysql:")) {
      String ssl = env.getProperty("MYSQL_SSL");
      if (ssl != null && !ssl.equals("true") && !ssl.equals("false"))
        throw new IllegalStateException("Invalid MYSQL_SSL");
      if (ssl != null)
        ds.addDataSourceProperty("sslMode", ssl.equals("true") ? "VERIFY_IDENTITY" : "DISABLED");
      String ca = env.getProperty("MYSQL_SSL_CA");
      if (ca != null && !ca.isBlank()) {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        int i = 0;
        for (var cert :
            CertificateFactory.getInstance("X.509")
                .generateCertificates(
                    new ByteArrayInputStream(
                        ca.replace("\\n", "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8))))
          ks.setCertificateEntry("aiven-" + i++, cert);
        Path path = Files.createTempFile("induport-ca-", ".p12");
        String password = UUID.randomUUID().toString();
        try (var out = Files.newOutputStream(path)) {
          ks.store(out, password.toCharArray());
        }
        path.toFile().deleteOnExit();
        ds.addDataSourceProperty("trustCertificateKeyStoreUrl", path.toUri().toString());
        ds.addDataSourceProperty("trustCertificateKeyStorePassword", password);
        ds.addDataSourceProperty("trustCertificateKeyStoreType", "PKCS12");
        ds.addDataSourceProperty("sslMode", "VERIFY_IDENTITY");
      }
    }
    return ds;
  }
}
