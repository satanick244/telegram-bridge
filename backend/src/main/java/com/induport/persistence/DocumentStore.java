package com.induport.persistence;

import com.induport.common.Doc;
import java.util.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Repository
public class DocumentStore {
  private final DocumentMapper mapper;

  public DocumentStore(DocumentMapper mapper) {
    this.mapper = mapper;
  }

  public List<Doc> all(String bucket) {
    return mapper.all(bucket).stream().map(Doc::parse).toList();
  }

  public Doc get(String bucket, Object id) {
    if (id == null) return null;
    String value =
        mapper.get(
            bucket,
            String.valueOf(id),
            TransactionSynchronizationManager.isActualTransactionActive());
    return value == null ? null : Doc.parse(value);
  }

  public Doc insert(String bucket, Doc row) {
    mapper.insert(bucket, row.s("id"), Doc.json(row));
    return row;
  }

  public Doc put(String bucket, Doc row) {
    if ("risk_audit".equals(bucket)) throw new IllegalStateException("Audit is append only");
    if (get(bucket, row.get("id")) == null) return insert(bucket, row);
    mapper.update(bucket, row.s("id"), Doc.json(row));
    return row;
  }

  public void remove(String bucket, Object id) {
    if ("risk_audit".equals(bucket)) throw new IllegalStateException("Audit is append only");
    if (id != null) mapper.remove(bucket, String.valueOf(id));
  }

  public void lock() {
    if (get("risk_locks", "operations") == null)
      throw new IllegalStateException("Risk lock missing");
  }

  public String engine() {
    return "mysql";
  }
}
