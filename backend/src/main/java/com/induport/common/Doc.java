package com.induport.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

/** Compatibility document for the existing MySQL JSON records, never a permission boundary. */
public class Doc extends LinkedHashMap<String, Object> {
  public static final ObjectMapper JSON = new ObjectMapper();

  public Doc() {}

  public Doc(Map<String, ?> map) {
    super(map);
  }

  public static Doc of(Object... pairs) {
    Doc d = new Doc();
    for (int i = 0; i < pairs.length; i += 2) d.put((String) pairs[i], pairs[i + 1]);
    return d;
  }

  public static Doc from(Object value) {
    if (value == null) return new Doc();
    if (value instanceof Map<?, ?> m) {
      Doc d = new Doc();
      m.forEach((k, v) -> d.put(String.valueOf(k), v));
      return d;
    }
    throw new IllegalArgumentException("Expected object");
  }

  public static Doc parse(String value) {
    try {
      return JSON.readValue(value, Doc.class);
    } catch (Exception e) {
      throw new IllegalStateException("Invalid stored JSON", e);
    }
  }

  public static String json(Object value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException("Cannot encode JSON", e);
    }
  }

  public Doc with(Object... pairs) {
    Doc d = new Doc(this);
    d.putAll(of(pairs));
    return d;
  }

  public Doc withExtra(Map<String, ?> extra) {
    Doc d = new Doc(this);
    d.putAll(extra);
    return d;
  }

  public Doc without(String... keys) {
    Doc d = new Doc(this);
    for (String k : keys) d.remove(k);
    return d;
  }

  public String s(String key) {
    Object v = get(key);
    return v == null ? null : String.valueOf(v);
  }

  public String s(String key, String fallback) {
    String v = s(key);
    return v == null ? fallback : v;
  }

  public double n(String key) {
    Object v = get(key);
    return v instanceof Number
        ? ((Number) v).doubleValue()
        : v == null ? 0 : Double.parseDouble(String.valueOf(v));
  }

  public long l(String key) {
    return get(key) == null ? 0 : ((Number) get(key)).longValue();
  }

  public boolean b(String key) {
    return Boolean.TRUE.equals(get(key));
  }

  public Doc d(String key) {
    return from(get(key));
  }

  public List<Doc> rows(String key) {
    Object v = get(key);
    if (!(v instanceof List<?> a)) return new ArrayList<>();
    return a.stream().map(Doc::from).toList();
  }

  public List<String> strings(String key) {
    Object v = get(key);
    if (!(v instanceof Collection<?> a)) return new ArrayList<>();
    return new ArrayList<>(a.stream().map(String::valueOf).toList());
  }

  public boolean eq(String key, Object value) {
    return Objects.equals(get(key), value);
  }

  public boolean same(String key, Doc other, String field) {
    return Objects.equals(get(key), other.get(field));
  }

  public static List<Doc> docs(Object value) {
    return value instanceof List<?> l ? l.stream().map(Doc::from).toList() : List.of();
  }
}
