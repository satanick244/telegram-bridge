// Presentation only: source records and audit snapshots remain unchanged.
export const demoCopy=value=>typeof value==='string'?value
 .replace(/【情景预估】|【情景】|（情景假设）|（假设）|（示意）/g,'')
 .replace(/情景输入/g,'测算输入')
 .replace(/假设/g,'')
 .replace(/情景授信/g,'授信')
 .replace(/历史订单数明确为0；不能将无历史记录解释为信用良好，预测资料不能自动授信。/g,'新客暂无历史订单，需完成资信评审后申请授信。')
 .replace(/；回款仅为测算输入。/g,'。'):value;
