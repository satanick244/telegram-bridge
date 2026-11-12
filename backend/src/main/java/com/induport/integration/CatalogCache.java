package com.induport.integration;

import com.induport.common.Doc;
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.*;

@Service
public class CatalogCache {
  private static final String KEY = "induport:public-bootstrap:v1";
  private final StringRedisTemplate redis;
  private final boolean enabled;

  public CatalogCache(StringRedisTemplate redis, Environment env) {
    this.redis = redis;
    this.enabled = env.getProperty("induport.redis-enabled", Boolean.class, false);
  }

  /**
   * Only anonymous, sanitized data is cached. Financial data and authenticated workspaces never
   * enter Redis.
   */
  public Doc anonymous(Supplier<Doc> load) {
    if (!enabled) return load.get();
    try {
      String value = redis.opsForValue().get(KEY);
      if (value != null) return Doc.parse(value);
    } catch (Exception ignored) {
    }
    Doc value = load.get();
    try {
      redis
          .opsForValue()
          .set(
              KEY,
              Doc.json(value),
              Duration.ofSeconds(ThreadLocalRandom.current().nextInt(25, 36)));
    } catch (Exception ignored) {
    }
    return value;
  }

  public void evictAfterCommit() {
    if (!enabled) return;
    Runnable clear =
        () -> {
          try {
            redis.delete(KEY);
          } catch (Exception ignored) {
          }
        };
    if (TransactionSynchronizationManager.isSynchronizationActive())
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              clear.run();
            }
          });
    else clear.run();
  }
}
