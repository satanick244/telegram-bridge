package com.induport.auth;

import static com.induport.common.BusinessException.*;

import com.induport.common.*;
import com.induport.persistence.*;
import java.text.Normalizer;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
  public static final String COOKIE = "induport_session";
  private final DocumentStore db;
  private final PasswordService passwords;

  public AuthService(DocumentStore db, PasswordService passwords) {
    this.db = db;
    this.passwords = passwords;
  }

  public String username(Object value) {
    require(value instanceof String, 400, "请输入账号");
    String s =
        Normalizer.normalize((String) value, Normalizer.Form.NFKC).trim().toLowerCase(Locale.ROOT);
    require(s.matches("[\\p{L}\\p{N}_.-]{3,40}"), 400, "账号须为 3–40 位文字、数字、下划线、点或短横线");
    return s;
  }

  public Doc create(Doc b, String role) {
    String id = username(b.get("username"));
    require(
        !id.equals("induport_demo_buyer_v1") && !id.equals("induport_demo_supplier_v1"),
        400,
        "该账号名保留给只读演示");
    require(List.of("buyer", "supplier", "admin").contains(role), 400, "账户类型无效");
    String name = Inputs.text(b.getOrDefault("displayName", id), "显示名称", 80);
    Doc u =
        Doc.of(
            "id",
            id,
            "username",
            id,
            "displayName",
            name,
            "role",
            role,
            "passwordHash",
            passwords.hash(b.s("password")),
            "createdAt",
            Inputs.now());
    db.insert("users", u);
    return u;
  }

  public Doc login(Doc b) {
    String id;
    try {
      id = username(b.get("username"));
    } catch (BusinessException e) {
      throw fail(401, "账号或密码错误");
    }
    Doc u = db.get("users", id);
    require(u != null && passwords.matches(b.s("password"), u.s("passwordHash")), 401, "账号或密码错误");
    return u;
  }

  public Doc publicUser(Doc u) {
    return u == null
        ? null
        : u.b("isDemo")
            ? Doc.of(
                "id",
                u.get("id"),
                "username",
                u.get("username"),
                "displayName",
                u.get("displayName"),
                "role",
                u.get("role"),
                "isDemo",
                true)
            : Doc.of(
                "id",
                u.get("id"),
                "username",
                u.get("username"),
                "displayName",
                u.get("displayName"),
                "role",
                u.get("role"));
  }

  public String session(Doc user, String oldId) {
    if (oldId != null) db.remove("sessions", oldId);
    String token = passwords.token();
    db.insert(
        "sessions",
        Doc.of(
            "id",
            CanonicalJson.sha256(token),
            "userId",
            user.get("id"),
            "expiresAt",
            System.currentTimeMillis() + (user.b("isDemo") ? 3600000L : 14 * 86400000L),
            "isDemo",
            user.b("isDemo")));
    return token;
  }

  public static Doc user(jakarta.servlet.http.HttpServletRequest req) {
    return (Doc) req.getAttribute("induport.user");
  }

  public static void admin(Doc user) {
    require(user != null && user.eq("role", "admin"), 403, "此操作需要管理员权限");
  }
}
