package com.induport.api;

import com.induport.common.Doc;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

/**
 * Typed DTOs for the most important financial commands; persisted documents are an adapter detail.
 */
public final class Requests {
  private Requests() {}

  public record Credit(
      @NotBlank String profileId,
      @Pattern(regexp = "USD|CNY") @NotNull String currency,
      @NotBlank @Pattern(regexp = "\\d{1,10}(\\.\\d{1,2})?") String amount,
      @NotBlank String validUntil,
      @NotNull @Min(1) @Max(365) Integer maxTermDays,
      String maxSingleAmount,
      @NotBlank @Size(max = 1000) String conditions,
      @NotBlank @Size(max = 100) String businessKey,
      @NotBlank @Size(max = 1000) String reason,
      Boolean acknowledgeMissing) {
    public Doc doc() {
      return Doc.JSON.convertValue(this, Doc.class);
    }
  }

  public record AllocationItem(
      @NotBlank String invoiceId,
      @NotBlank @Pattern(regexp = "\\d{1,10}(\\.\\d{1,2})?") String amount) {}

  public record Allocation(
      @NotBlank String receiptId,
      @NotEmpty @Size(max = 50) List<@Valid AllocationItem> items,
      @NotBlank @Size(max = 100) String businessKey,
      @NotBlank @Size(max = 1000) String reason) {
    public Doc doc() {
      return Doc.JSON.convertValue(this, Doc.class);
    }
  }

  public record Arrival(
      @NotBlank String profileId,
      @NotBlank @Size(max = 100) String bankAccountRef,
      @NotBlank @Size(max = 150) String bankReference,
      @NotBlank @Pattern(regexp = "\\d{1,10}(\\.\\d{1,2})?") String amount,
      @NotNull @Pattern(regexp = "USD|CNY") String currency,
      @NotBlank String receivedDate,
      @NotBlank @Size(max = 150) String payerName,
      @NotBlank @Size(max = 1000) String evidenceRef,
      @NotNull @Pattern(regexp = "manual|import") String source) {
    public Doc doc() {
      return Doc.JSON.convertValue(this, Doc.class);
    }
  }
}
