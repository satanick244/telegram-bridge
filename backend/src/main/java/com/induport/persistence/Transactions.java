package com.induport.persistence;

import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** A separate Spring bean is essential: self-invocation would bypass the transactional proxy. */
@Service
public class Transactions {
  private final DocumentStore store;

  public Transactions(DocumentStore store) {
    this.store = store;
  }

  @Transactional(rollbackFor = Exception.class)
  public <T> T write(Supplier<T> action) {
    store.lock();
    return action.get();
  }
}
