package com.induport.api;

import com.induport.common.*;
import java.nio.file.Path;
import org.springframework.core.env.Environment;
import org.springframework.core.io.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class WebController {
  private final Environment env;

  public WebController(Environment env) {
    this.env = env;
  }

  @GetMapping({"/", "/index.html"})
  ResponseEntity<Resource> index() {
    Resource r =
        new FileSystemResource(
            Path.of(env.getProperty("induport.static-root", "dist"), "index.html"));
    if (!r.exists()) throw BusinessException.fail(404, "请先构建前端，或使用 Vite 开发服务");
    return ResponseEntity.ok()
        .contentType(MediaType.TEXT_HTML)
        .cacheControl(CacheControl.noCache())
        .body(r);
  }

  @RequestMapping("/api/{*path}")
  ResponseEntity<Doc> missing() {
    return ResponseEntity.status(404).body(Doc.of("error", "接口不存在"));
  }
}
