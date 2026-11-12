package com.induport;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.induport.persistence")
public class InduPortApplication {
  public static void main(String[] args) {
    SpringApplication.run(InduPortApplication.class, args);
  }
}
