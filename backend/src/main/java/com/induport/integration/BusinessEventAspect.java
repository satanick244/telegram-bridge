package com.induport.integration;

import com.induport.common.Doc;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.*;
import org.springframework.stereotype.Component;

@Aspect
@Component
public class BusinessEventAspect {
  private final OutboxService outbox;
  private final CatalogCache cache;

  public BusinessEventAspect(OutboxService outbox, CatalogCache cache) {
    this.outbox = outbox;
    this.cache = cache;
  }

  @AfterReturning(pointcut = "@annotation(event)", returning = "result")
  public void after(JoinPoint call, BusinessEvent event, Object result) {
    if (!(result instanceof Doc d)) return;
    if (event.value().equals("credit.decided") && !d.eq("type", "credit")) return;
    if (event.value().equals("cash.allocated")
        && (!d.eq("type", "allocation") || !d.eq("status", "approved"))) return;
    outbox.append(d.s("ownerId"), event.value(), d.s("id"));
  }

  @AfterReturning(
      "execution(* com.induport.trade.TradeService.createProduct(..)) || execution(*"
          + " com.induport.trade.TradeService.productStatus(..)) || execution(*"
          + " com.induport.trade.TradeService.applicationDecision(..)) || execution(*"
          + " com.induport.trade.TradeService.order(..))")
  public void invalidate() {
    cache.evictAfterCommit();
  }
}
