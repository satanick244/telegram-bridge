package com.induport.api;

import com.induport.common.*;
import org.slf4j.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class ApiExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

  @ExceptionHandler(BusinessException.class)
  ResponseEntity<Doc> business(BusinessException e) {
    return ResponseEntity.status(e.status()).body(Doc.of("error", e.getMessage()));
  }

  @ExceptionHandler(DuplicateKeyException.class)
  ResponseEntity<Doc> duplicate() {
    return ResponseEntity.status(409).body(Doc.of("error", "账号或业务唯一键已存在"));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    org.springframework.web.bind.MethodArgumentNotValidException.class
  })
  ResponseEntity<Doc> invalid() {
    return ResponseEntity.badRequest().body(Doc.of("error", "请求参数或 JSON 格式无效"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Doc> unknown(Exception e) {
    LOG.error("API failed: {}", e.getClass().getSimpleName());
    return ResponseEntity.status(500).body(Doc.of("error", "服务器处理失败，请稍后重试"));
  }
}
