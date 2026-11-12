package com.induport.auth;

import static com.induport.common.BusinessException.*;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.HexFormat;
import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.stereotype.Component;

@Component
public class PasswordService {
  private final SecureRandom random = new SecureRandom();
  private final java.util.concurrent.Semaphore hashing = new java.util.concurrent.Semaphore(2);

  public String token() {
    byte[] b = new byte[32];
    random.nextBytes(b);
    return HexFormat.of().formatHex(b);
  }

  public String hash(String password) {
    require(
        password != null && password.length() >= 8 && password.length() <= 128,
        400,
        "密码须为 8–128 位");
    byte[] saltBytes = new byte[16];
    random.nextBytes(saltBytes);
    String salt = HexFormat.of().formatHex(saltBytes);
    return "scrypt$" + salt + "$" + HexFormat.of().formatHex(derive(password, salt));
  }

  private byte[] derive(String password, String salt) {
    boolean acquired = false;
    try {
      acquired = hashing.tryAcquire(2, java.util.concurrent.TimeUnit.SECONDS);
      require(acquired, 429, "登录服务繁忙，请稍后重试");
      return SCrypt.generate(
          password.getBytes(StandardCharsets.UTF_8),
          salt.getBytes(StandardCharsets.UTF_8),
          16384,
          8,
          1,
          64);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw fail(503, "登录请求已中断");
    } finally {
      if (acquired) hashing.release();
    }
  }

  public boolean matches(String password, String encoded) {
    if (password == null || password.length() > 128 || encoded == null) return false;
    try {
      String[] p = encoded.split("\\$");
      if (p.length != 3 || !p[0].equals("scrypt") || p[1].length() != 32 || p[2].length() != 128)
        return false;
      return MessageDigest.isEqual(derive(password, p[1]), HexFormat.of().parseHex(p[2]));
    } catch (IllegalArgumentException e) {
      return false;
    }
  }
}
