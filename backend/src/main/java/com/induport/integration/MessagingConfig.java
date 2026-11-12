package com.induport.integration;

import com.induport.common.Doc;
import com.induport.persistence.OutboxEvent;
import com.rabbitmq.client.Channel;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.annotation.EnableRabbit;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;

@Configuration
@EnableRabbit
@ConditionalOnProperty(name = "induport.mq-enabled", havingValue = "true")
public class MessagingConfig {
  @Bean
  DirectExchange events() {
    return new DirectExchange("induport.events", true, false);
  }

  @Bean
  DirectExchange dead() {
    return new DirectExchange("induport.dead", true, false);
  }

  @Bean
  Queue notifications() {
    return QueueBuilder.durable("induport.notifications")
        .deadLetterExchange("induport.dead")
        .deadLetterRoutingKey("notification.dead")
        .build();
  }

  @Bean
  Queue deadQueue() {
    return QueueBuilder.durable("induport.notifications.dead").build();
  }

  @Bean
  Binding liveBinding() {
    return BindingBuilder.bind(notifications()).to(events()).with("notification");
  }

  @Bean
  Binding deadBinding() {
    return BindingBuilder.bind(deadQueue()).to(dead()).with("notification.dead");
  }

  @Bean
  Publisher publisher(RabbitTemplate rabbit, OutboxService outbox) {
    rabbit.setMandatory(true);
    return new Publisher(rabbit, outbox);
  }

  @Bean
  Listener listener(OutboxService outbox) {
    return new Listener(outbox);
  }

  public static class Publisher {
    private final RabbitTemplate rabbit;
    private final OutboxService outbox;

    Publisher(RabbitTemplate rabbit, OutboxService outbox) {
      this.rabbit = rabbit;
      this.outbox = outbox;
    }

    public void dispatch() {
      for (int i = 0; i < 5; i++) {
        OutboxEvent row = outbox.claim();
        if (row == null) return;
        boolean sent = false;
        try {
          Doc event =
              Doc.of(
                  "id",
                  row.getId(),
                  "ownerId",
                  row.getOwnerId(),
                  "topic",
                  row.getTopic(),
                  "payload",
                  Doc.parse(row.getPayload()));
          MessageProperties p = new MessageProperties();
          p.setContentType("application/json");
          p.setMessageId(row.getId());
          p.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
          CorrelationData confirmation = new CorrelationData(row.getId());
          rabbit.send(
              "induport.events",
              "notification",
              new Message(Doc.json(event).getBytes(StandardCharsets.UTF_8), p),
              confirmation);
          sent =
              confirmation.getFuture().get(5, TimeUnit.SECONDS).isAck()
                  && confirmation.getReturned() == null;
        } catch (Exception ignored) {
        }
        outbox.finish(row, sent);
      }
    }
  }

  public static class Listener {
    private final OutboxService outbox;

    Listener(OutboxService outbox) {
      this.outbox = outbox;
    }

    @RabbitListener(queues = "induport.notifications", concurrency = "1")
    public void receive(Message message, Channel channel) throws Exception {
      long tag = message.getMessageProperties().getDeliveryTag();
      Doc event;
      try {
        event = Doc.parse(new String(message.getBody(), StandardCharsets.UTF_8));
      } catch (Exception e) {
        channel.basicReject(tag, false);
        return;
      }
      for (int attempt = 1; attempt <= 3; attempt++) {
        try {
          outbox.consume(event);
          channel.basicAck(tag, false);
          return;
        } catch (com.induport.common.BusinessException e) {
          channel.basicReject(tag, false);
          return;
        } catch (RuntimeException e) {
          if (attempt == 3) {
            channel.basicReject(tag, false);
            return;
          }
          Thread.sleep(attempt * 100L);
        }
      }
    }
  }
}
