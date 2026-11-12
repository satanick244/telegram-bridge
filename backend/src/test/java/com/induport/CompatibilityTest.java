package com.induport;

import static org.junit.jupiter.api.Assertions.*;

import com.induport.auth.PasswordService;
import com.induport.common.*;
import com.induport.risk.RiskMath;
import java.util.*;
import org.junit.jupiter.api.*;

class CompatibilityTest {
  private Doc fixtures() throws Exception {
    try (var in = getClass().getResourceAsStream("/compat-vectors.json")) {
      return Doc.JSON.readValue(in, Doc.class);
    }
  }

  @Test
  void canonicalHashesAndBusinessKeysMatchExistingNode() throws Exception {
    Doc f = fixtures();
    for (Doc v : f.rows("canonical"))
      assertEquals(v.s("hash"), CanonicalJson.digest(v.get("value")));
    assertEquals(f.s("key"), CanonicalJson.key("credit", "fixture-profile", "USD"));
  }

  @Test
  void oldNodeScryptPasswordsRemainValid() throws Exception {
    Doc f = fixtures();
    PasswordService p = new PasswordService();
    assertTrue(p.matches(f.s("password"), f.s("passwordHash")));
    assertFalse(p.matches("Wrong-fixture-password", f.s("passwordHash")));
    String encoded = p.hash("New-fixture-password9!");
    assertTrue(p.matches("New-fixture-password9!", encoded));
    assertFalse(p.matches("Wrong", encoded));
  }

  @Test
  void stressVectorsMatchNodeIncludingNullsUnitsCurrenciesAndPrecision() throws Exception {
    RiskMath math = new RiskMath();
    int i = 0;
    for (Doc v : fixtures().rows("vectors")) {
      Doc actual =
          math.evaluate(v.d("trade"), v.d("profile"), v.d("rules"), null, null, "2026-11-12");
      for (String field : v.d("expected").keySet())
        assertEquals(
            CanonicalJson.encode(v.d("expected").get(field)),
            CanonicalJson.encode(actual.get(field)),
            "case " + i + " / " + field);
      i++;
    }
  }

  @Test
  void importsRejectMalformedCsvAndExplicitAmountsKeepUnknownDistinctFromZero() {
    RiskMath m = new RiskMath();
    assertNull(Inputs.minor("", "amount"));
    assertEquals(0, Inputs.minor("0", "amount"));
    assertThrows(BusinessException.class, () -> Inputs.minor("1e2", "amount"));
    assertThrows(BusinessException.class, () -> Inputs.minor("-1", "amount"));
    assertEquals("a,b", m.parseRows("csv", "name,note\n\"a,b\",\"x\"\"y\"\n").get(0).s("name"));
    assertThrows(BusinessException.class, () -> m.parseRows("csv", "x,x\n1,2"));
    assertThrows(BusinessException.class, () -> m.parseRows("csv", "x,y\n\"a\"oops,b"));
    assertThrows(BusinessException.class, () -> m.parseRows("json", "{}"));
  }

  @Test
  void balancesRejectMixedCurrenciesNegativeAmountsAndUnsafeTotals() {
    Money available = new Money("USD", 10000);
    assertEquals(new Money("USD", 7500), available.subtract(new Money("USD", 2500)));
    assertThrows(BusinessException.class, () -> available.subtract(new Money("CNY", 100)));
    assertThrows(BusinessException.class, () -> available.subtract(new Money("USD", 10001)));
    assertThrows(BusinessException.class, () -> new Money("USD", -1));
    assertThrows(
        BusinessException.class,
        () -> new Money("USD", 9007199254740991L).add(new Money("USD", 1)));
  }
}
