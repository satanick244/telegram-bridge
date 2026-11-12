package com.induport.config;

import java.nio.file.Path;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  private final Environment env;

  public WebConfig(Environment env) {
    this.env = env;
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry
        .addResourceHandler("/**")
        .addResourceLocations(
            Path.of(env.getProperty("induport.static-root", "dist"))
                    .toAbsolutePath()
                    .normalize()
                    .toUri()
                    .toString()
                + "/")
        .setCachePeriod(3600);
  }
}
