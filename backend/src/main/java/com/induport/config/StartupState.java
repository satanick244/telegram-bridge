package com.induport.config;

import org.springframework.stereotype.Component;

@Component
public class StartupState {
  private volatile boolean ready;

  public boolean ready() {
    return ready;
  }

  public void markReady() {
    ready = true;
  }
}
