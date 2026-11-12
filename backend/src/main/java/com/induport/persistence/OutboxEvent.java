package com.induport.persistence;

import com.baomidou.mybatisplus.annotation.*;

@TableName("ip_outbox")
public class OutboxEvent {
  @TableId(type = IdType.INPUT)
  private String id;

  private String ownerId, topic, payload, status;
  private Integer attempts;
  private Long availableAt, createdAt;

  public String getId() {
    return id;
  }

  public void setId(String v) {
    id = v;
  }

  public String getOwnerId() {
    return ownerId;
  }

  public void setOwnerId(String v) {
    ownerId = v;
  }

  public String getTopic() {
    return topic;
  }

  public void setTopic(String v) {
    topic = v;
  }

  public String getPayload() {
    return payload;
  }

  public void setPayload(String v) {
    payload = v;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String v) {
    status = v;
  }

  public Integer getAttempts() {
    return attempts;
  }

  public void setAttempts(Integer v) {
    attempts = v;
  }

  public Long getAvailableAt() {
    return availableAt;
  }

  public void setAvailableAt(Long v) {
    availableAt = v;
  }

  public Long getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Long v) {
    createdAt = v;
  }
}
