package com.induport.integration;

import com.induport.common.*;
import com.induport.persistence.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class OutboxService {
  private final OutboxMapper mapper;
  private final JdbcTemplate jdbc;

  public OutboxService(OutboxMapper mapper, JdbcTemplate jdbc) {
    this.mapper = mapper;
    this.jdbc = jdbc;
  }

  public void append(String owner, String topic, String entity) {
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("Outbox must participate in the business transaction");
    OutboxEvent row = new OutboxEvent();
    row.setId(CanonicalJson.digest(List.of(topic, entity)));
    if (mapper.selectById(row.getId()) != null) return;
    row.setOwnerId(owner);
    row.setTopic(topic);
    row.setPayload(Doc.json(Doc.of("entityId", entity)));
    row.setStatus("NEW");
    row.setAttempts(0);
    row.setAvailableAt(System.currentTimeMillis());
    row.setCreatedAt(System.currentTimeMillis());
    mapper.insert(row);
  }

  @Transactional(rollbackFor = Exception.class)
  public OutboxEvent claim() {
    List<String> ids =
        jdbc.queryForList(
            "SELECT id FROM ip_outbox WHERE status IN ('NEW','RETRY','SENDING') AND available_at<=?"
                + " ORDER BY available_at,id LIMIT 1 FOR UPDATE",
            String.class,
            System.currentTimeMillis());
    if (ids.isEmpty()) return null;
    OutboxEvent row = mapper.selectById(ids.get(0));
    row.setStatus("SENDING");
    row.setAttempts(row.getAttempts() + 1);
    row.setAvailableAt(System.currentTimeMillis() + 30000);
    mapper.updateById(row);
    return row;
  }

  public void finish(OutboxEvent event, boolean acknowledged) {
    jdbc.update(
        "UPDATE ip_outbox SET status=?,available_at=? WHERE id=? AND status='SENDING' AND"
            + " attempts=?",
        acknowledged ? "SENT" : event.getAttempts() >= 5 ? "DEAD" : "RETRY",
        System.currentTimeMillis()
            + Math.min(60000, 1000L * (1L << Math.min(6, event.getAttempts()))),
        event.getId(),
        event.getAttempts());
  }

  @Transactional(rollbackFor = Exception.class)
  public void consume(Doc event) {
    String id = Inputs.text(event.get("id"), "事件编号", 100),
        owner = Inputs.text(event.get("ownerId"), "事件所属账号", 100),
        topic = Inputs.text(event.get("topic"), "事件类型", 100);
    List<String> topics = List.of("order.created", "credit.decided", "cash.allocated");
    BusinessException.require(topics.contains(topic), 400, "事件类型无效");
    OutboxEvent source = mapper.selectById(id);
    BusinessException.require(
        source != null
            && source.getOwnerId().equals(owner)
            && source.getTopic().equals(topic)
            && CanonicalJson.digest(Doc.parse(source.getPayload()))
                .equals(CanonicalJson.digest(event.get("payload"))),
        400,
        "事件来源无效");
    int inserted =
        jdbc.update(
            "INSERT IGNORE INTO ip_notification_inbox(event_id,received_at) VALUES(?,?)",
            id,
            System.currentTimeMillis());
    if (inserted == 0) return;
    jdbc.update(
        "INSERT INTO ip_notifications(id,owner_id,topic,entity_id,created_at) VALUES(?,?,?,?,?)",
        id,
        owner,
        topic,
        event.d("payload").s("entityId"),
        System.currentTimeMillis());
  }

  public List<Doc> notifications(Doc user) {
    return jdbc.query(
        "SELECT id,topic,entity_id,created_at FROM ip_notifications WHERE owner_id=? ORDER BY"
            + " created_at DESC LIMIT 100",
        (rs, n) ->
            Doc.of(
                "id",
                rs.getString(1),
                "topic",
                rs.getString(2),
                "entityId",
                rs.getString(3),
                "createdAt",
                rs.getLong(4)),
        user.s("id"));
  }
}
