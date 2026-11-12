package com.induport.common;

public class BusinessException extends RuntimeException {
  private final int status;

  public BusinessException(int status, String message) {
    super(message);
    this.status = status;
  }

  public int status() {
    return status;
  }

  public static BusinessException fail(int status, String message) {
    return new BusinessException(status, message);
  }

  public static void require(boolean condition, int status, String message) {
    if (!condition) throw fail(status, message);
  }
}
