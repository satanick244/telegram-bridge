package com.induport.integration;

import com.induport.auth.AuthService;
import com.induport.common.Doc;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
public class NotificationController {
  private final OutboxService outbox;

  public NotificationController(OutboxService outbox) {
    this.outbox = outbox;
  }

  @GetMapping("/api/notifications")
  Doc list(HttpServletRequest request) {
    return Doc.of("items", outbox.notifications(AuthService.user(request)));
  }
}
