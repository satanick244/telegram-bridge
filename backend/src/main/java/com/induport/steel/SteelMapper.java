package com.induport.steel;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface SteelMapper {
  @Select(
      "SELECT data FROM ip_steel_records WHERE owner_id=#{company} AND record_kind NOT IN"
          + " ('command','ledger') ORDER BY id")
  List<String> company(@Param("company") String company);

  @Select(
      "SELECT data FROM ip_steel_records WHERE owner_id=#{company} AND record_kind='ledger' ORDER"
          + " BY JSON_UNQUOTE(JSON_EXTRACT(data,'$.createdAt')) DESC,id DESC LIMIT 100")
  List<String> recentLedger(@Param("company") String company);

  @Select("SELECT data FROM ip_steel_records WHERE record_kind='company' ORDER BY id")
  List<String> companies();

  @Select(
      "SELECT data FROM ip_steel_records WHERE record_kind='member' AND"
          + " JSON_UNQUOTE(JSON_EXTRACT(data,'$.userId')) COLLATE utf8mb4_bin=#{user} COLLATE"
          + " utf8mb4_bin")
  List<String> memberships(@Param("user") String user);
}
