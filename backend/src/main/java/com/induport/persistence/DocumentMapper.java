package com.induport.persistence;

import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface DocumentMapper {
  @SelectProvider(type = Sql.class, method = "all")
  List<String> all(@Param("bucket") String bucket);

  @SelectProvider(type = Sql.class, method = "get")
  String get(
      @Param("bucket") String bucket, @Param("id") String id, @Param("locking") boolean locking);

  @InsertProvider(type = Sql.class, method = "insert")
  int insert(@Param("bucket") String bucket, @Param("id") String id, @Param("data") String data);

  @UpdateProvider(type = Sql.class, method = "update")
  int update(@Param("bucket") String bucket, @Param("id") String id, @Param("data") String data);

  @DeleteProvider(type = Sql.class, method = "remove")
  int remove(@Param("bucket") String bucket, @Param("id") String id);

  final class Sql {
    public static final Set<String> BUCKETS =
        Set.of(
            "products",
            "suppliers",
            "orders",
            "inquiries",
            "applications",
            "users",
            "sessions",
            "meta",
            "risk_records",
            "risk_audit",
            "risk_locks");

    private static String table(Map<String, Object> p) {
      String b = (String) p.get("bucket");
      if (!BUCKETS.contains(b)) throw new IllegalArgumentException("Unknown table");
      return "ip_" + b;
    }

    public String all(Map<String, Object> p) {
      return "SELECT data FROM " + table(p) + " ORDER BY id";
    }

    public String get(Map<String, Object> p) {
      return "SELECT data FROM "
          + table(p)
          + " WHERE id=#{id}"
          + (Boolean.TRUE.equals(p.get("locking")) ? " FOR UPDATE" : "");
    }

    public String insert(Map<String, Object> p) {
      return "INSERT INTO " + table(p) + "(id,data) VALUES(#{id},#{data})";
    }

    public String update(Map<String, Object> p) {
      return "UPDATE " + table(p) + " SET data=#{data} WHERE id=#{id}";
    }

    public String remove(Map<String, Object> p) {
      return "DELETE FROM " + table(p) + " WHERE id=#{id}";
    }
  }
}
