package com.induport.integration;

import com.induport.common.Doc;
import com.induport.persistence.Transactions;
import com.induport.risk.MonitorService;
import org.quartz.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.AutowireCapableBeanFactory;
import org.springframework.boot.autoconfigure.quartz.SchedulerFactoryBeanCustomizer;
import org.springframework.context.annotation.*;
import org.springframework.scheduling.quartz.SpringBeanJobFactory;

@Configuration
public class QuartzConfig {
  @Bean
  SchedulerFactoryBeanCustomizer jobFactory(AutowireCapableBeanFactory beans) {
    return factory ->
        factory.setJobFactory(
            new SpringBeanJobFactory() {
              @Override
              protected Object createJobInstance(org.quartz.spi.TriggerFiredBundle bundle) {
                return beans.createBean(bundle.getJobDetail().getJobClass());
              }
            });
  }

  @Bean
  JobDetail reviewJob() {
    return JobBuilder.newJob(ReviewJob.class)
        .withIdentity("risk-review-scan")
        .storeDurably()
        .build();
  }

  @Bean
  Trigger reviewTrigger() {
    return TriggerBuilder.newTrigger()
        .withIdentity("risk-review-trigger")
        .forJob(reviewJob())
        .withSchedule(
            SimpleScheduleBuilder.simpleSchedule()
                .withIntervalInMinutes(15)
                .repeatForever()
                .withMisfireHandlingInstructionNextWithRemainingCount())
        .startAt(java.util.Date.from(java.time.Instant.now().plusSeconds(30)))
        .build();
  }

  @Bean
  JobDetail outboxJob() {
    return JobBuilder.newJob(OutboxJob.class)
        .withIdentity("notification-outbox")
        .storeDurably()
        .build();
  }

  @Bean
  Trigger outboxTrigger() {
    return TriggerBuilder.newTrigger()
        .withIdentity("notification-outbox-trigger")
        .forJob(outboxJob())
        .withSchedule(
            SimpleScheduleBuilder.simpleSchedule()
                .withIntervalInSeconds(5)
                .repeatForever()
                .withMisfireHandlingInstructionNextWithRemainingCount())
        .startAt(java.util.Date.from(java.time.Instant.now().plusSeconds(15)))
        .build();
  }

  @DisallowConcurrentExecution
  public static class ReviewJob implements Job {
    private final Transactions tx;
    private final MonitorService monitor;
    private final com.induport.config.StartupState state;

    public ReviewJob(
        Transactions tx, MonitorService monitor, com.induport.config.StartupState state) {
      this.tx = tx;
      this.monitor = monitor;
      this.state = state;
    }

    @Override
    public void execute(JobExecutionContext context) {
      if (state.ready()) tx.write(() -> monitor.scan(Doc.of("id", "system:risk-monitor"), null));
    }
  }

  @DisallowConcurrentExecution
  public static class OutboxJob implements Job {
    private final ObjectProvider<MessagingConfig.Publisher> publisher;
    private final com.induport.config.StartupState state;

    public OutboxJob(
        ObjectProvider<MessagingConfig.Publisher> publisher,
        com.induport.config.StartupState state) {
      this.publisher = publisher;
      this.state = state;
    }

    @Override
    public void execute(JobExecutionContext context) {
      if (state.ready()) publisher.ifAvailable(MessagingConfig.Publisher::dispatch);
    }
  }
}
