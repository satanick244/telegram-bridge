package com.induport.common;

import static com.induport.common.BusinessException.*;

import java.math.BigDecimal;

/**
 * Immutable monetary balance. Cents are integral; unlike a ledger movement a balance cannot be
 * negative.
 */
public record Money(String currency, long minor) {
  public Money {
    require("USD".equals(currency) || "CNY".equals(currency), 400, "币种无效");
    require(minor >= 0 && minor <= 9007199254740991L, 409, "余额超出支持范围");
  }

  public Money add(Money other) {
    same(other);
    return new Money(currency, Math.addExact(minor, other.minor));
  }

  public Money subtract(Money other) {
    same(other);
    require(other.minor <= minor, 409, "余额不足");
    return new Money(currency, Math.subtractExact(minor, other.minor));
  }

  private void same(Money other) {
    require(currency.equals(other.currency), 400, "不同币种不能直接相加或核销");
  }

  public BigDecimal major() {
    return BigDecimal.valueOf(minor, 2);
  }
}
