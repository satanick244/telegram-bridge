package com.induport.config;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final Environment env;

  public WebConfig(Environment env) {
    this.env = env;
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    String root =
        Path.of(env.getProperty("induport.static-root", "dist"))
            .toAbsolutePath()
            .normalize()
            .toUri()
            .toString();
    if (!root.endsWith("/")) root += "/";
    CacheControl immutable = CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable();
    registry
        .addResourceHandler("/images/optimized/**")
        .addResourceLocations(root + "images/optimized/")
        .setCacheControl(immutable);
    registry
        .addResourceHandler("/assets/**")
        .addResourceLocations(root + "assets/")
        .setCacheControl(immutable);
    registry
        .addResourceHandler("/images/**")
        .addResourceLocations(root + "images/")
        .setCacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic());
    registry.addResourceHandler("/**").addResourceLocations(root).setCachePeriod(3600);
  }
}
