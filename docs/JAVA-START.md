# Java 版本：运行、验证与部署

本版本在原仓库内将业务后端迁移到 Java。原 React 页面、接口形状、48 款目录、账号、MySQL 业务记录、只读演示和风控逻辑保留。`server/` 是迁移前的 Node 实现及回滚/对照代码；Java 请求不会代理给 Node 处理。生产服务仍只有原有 induport-trade。

## 已使用的技术与学习表对应

| 学习表内容 | 项目中的落点 |
| --- | --- |
| JDK 17 / Maven 3.9 / Spring Boot 3 | `backend/pom.xml`；已在 Temurin 17 验证，使用 Boot 3.5 维护版本 |
| Spring MVC / IOC / 异常处理 / 校验 | `TradeController`、`RiskController`、`Requests`、`ApiExceptionHandler` |
| MyBatis / MyBatis-Plus / Hikari | `DocumentMapper` 兼容原数据；`OutboxMapper` + `OutboxEvent` 是标准关系表映射 |
| Spring 事务 / MySQL 8 | `Transactions`、财务 Service、`SELECT ... FOR UPDATE`、唯一主键 |
| Cookie / 拦截与数据权限 | `ApiAuthFilter`、`AuthService`；沿用 HttpOnly Cookie，不强行替换旧登录协议 |
| AOP | `BusinessEventAspect` 在业务事务内追加 Outbox，在提交后清理匿名缓存 |
| Redis | 仅匿名采购数据短期缓存，25–35 秒随机 TTL；故障时回源，不缓存余额和私有工作区 |
| RabbitMQ | 持久化队列/消息、Confirm + Return、Outbox 重试、消费者 Inbox 唯一键、死信队列 |
| Quartz | 周期复审和 Outbox 调度；可选 JDBC JobStore + 集群模式 |
| 并发 / JVM | 不可变 `Money`、scrypt 信号量、数据库行锁、有限工作线程、容器内存参数 |

前端继续使用已有 React；本次重点是 Java 后端。学习表中的 Vue 3、JWT、Redisson、Spring Cloud Alibaba 不因此成为本项目已使用的技术。选用它们应有具体需求，不能仅为简历增加名词。

## 本地准备

需要 JDK 17、Maven 3.9、Node.js 24、MySQL 8。可以在 IDEA 中直接打开 `backend/pom.xml`，Project SDK 选 JDK 17。仓库也提供 `scripts/java-tools.mjs`：Linux x64 缺工具时从官方地址下载固定版本并核验 checksum，不修改系统 JDK。

建议使用独立本地数据库学习，不使用线上 Aiven 库做实验。

1. 复制 `.env.java.example` 为 `.env.java`，自行填写本地 MySQL root/app 密码及 RabbitMQ 密码。管理员两个字段可以都留空；要体验独立审批时再配置管理员账号和密码，没有内置管理员密码。
2. 启动基础服务：

```bash
docker compose --env-file .env.java -f compose.java.yml up -d mysql redis rabbitmq
```

3. 构建前端及后端：

```bash
npm ci
npm run build
npm run build:java
```

4. 启动前后端独立开发进程：

```bash
npm run dev
```

浏览器打开 `http://localhost:3000`。Vite 把 `/api` 转发到 Java `8080`，保留请求 Host，Cookie 与 CSRF 校验仍走同源。也可以分别执行 `npm run frontend:dev` 和设置本地环境后 `mvn -f backend/pom.xml spring-boot:run -Dspring-boot.run.profiles=local`。

`local` profile 开启本地 API 文档：`http://localhost:8080/swagger-ui/index.html`。生产默认关闭文档，不公开调试入口。成功响应沿用原接口；错误统一为 HTTP 状态码加 `{error}`，避免破坏现有页面。

## 打开完整中间件模式

基础模式只要求 MySQL；Redis/MQ 默认关闭。设置 `SPRING_PROFILES_ACTIVE=local,infra` 后启动 Java，可开启 Redis、RabbitMQ 和 Quartz JDBC 集群模式。Shell/PowerShell 的环境变量设置方法不同，也可在 IDEA Run Configuration 中设置。

`compose.java.yml` 的 MySQL 首次初始化会导入去掉 DROP 语句的 Quartz 官方表结构。已有本地数据卷不会再次执行初始化脚本；开启 infra 前应自行检查 `QRTZ_*` 表，必要时在本地库执行 `backend/src/main/resources/db/quartz.sql`。应用不自动删除调度表。

也可直接运行完整 Docker 服务：

```bash
docker compose --env-file .env.java -f compose.java.yml up -d --build
```

打开 `http://localhost:8080`。此配置用于本地学习，端口绑定本机。云环境中构建如需平台代理 CA，使用 `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f Dockerfile.java .`，保持 TLS 验证。最终运行镜像只含 JRE、jar 和前端文件，不含构建代理配置或证书。

## 验证

```bash
npm run test:java                    # JUnit：密码/审计/金额及计算兼容
npm test                            # 原 Node 回归，保留作迁移对照
```

真实 MySQL 8 HTTP 合约、浏览器和中间件测试使用测试配置文件路径，文件需私有保存，结构为 host/port/user/password/database；只允许 `127.0.0.1` 且 database 以 `_test` 结尾。测试启动器每次创建新的随机 `_test` 数据库，结束后只删除自己创建的数据库。

```bash
JAVA_TEST_DB_CONFIG=/private/mysql-test.json npm run test:java:contract
JAVA_TEST_DB_CONFIG=/private/mysql-test.json npm run test:e2e:java
JAVA_TEST_DB_CONFIG=/private/mysql-test.json JAVA_TEST_INFRA_CONFIG=/private/infra-test.json npm run test:java:contract
```

中间件配置文件字段为 redisHost、rabbitHost、rabbitUser、rabbitPassword，前两个只接受 localhost。测试使用本地 6379、5672、15672 端口，验证真实 Redis、Confirm/Return、消息去重、死信、两个 Java 实例共享 Quartz 表。没有配置该文件时，中间件测试明确跳过，不能据此声称运行通过。

本次迁移已在真实本地 MySQL 8.4 上验证：5 项 JUnit 测试、10 项 HTTP/中间件合约测试和 17 项浏览器测试通过。中间件测试包含 Redis、RabbitMQ 和两个 Java 实例共享 Quartz 表。迁移前 Node 回归为 63 项通过、5 项依赖另一 MySQL 测试配置的测试跳过；跳过项不算通过。上述结果不是生产吞吐量或大规模压测结论。

## 数据兼容及边界

- 原 MySQL `ip_*` JSON 表保留；适配层严格限制表名，业务值用 `#{}` 绑定。该方案是已有系统迁移兼容，不是推荐所有新系统都这样建表。新建的 Outbox/Inbox/通知使用关系表和索引。
- 原 scrypt 盐是十六进制**字符串的 UTF-8 字节**，不是将盐解码为原始字节。Java 使用相同 N/r/p/输出长度，旧密码不重置。
- 原会话 token、token 的 SHA-256、有效期及撤销记录保持兼容。演示账号旧版升级保留原密码哈希。
- 审计 canonical JSON 兼容排序、数字、Unicode 和空值。启动时校验旧链，异常则停止启动，不重建数据库掩盖错误。
- Java 工作流策略版本更新；旧的尚未执行发货批准需重新复核。已发货记录、已占用金额和历史审批不回退。
- 账务与审计同步提交；异步消息只是站内通知，不替代记账。所有幂等重试须保持业务唯一键和内容一致。
- Redis 缓存可能短暂过期，订单价格、库存、信用及资金始终以数据库事务检查为准。Redis 故障时回源，MQ 故障时 Outbox 保留待投递；不影响已经提交的财务账。
- 原 JSON 迁移备份格式保留，覆盖核心业务、账号、风控和审计。Outbox/通知/Quartz 状态需数据库级备份；不能把仅恢复原 JSON 备份说成完整基础设施灾备。

## 现有 Render 服务

仍更新 `induport-trade`（srv-dbhv45psrm7s73e27t90），不创建新收费服务。它原为 Node runtime，构建阶段下载固定 JDK/Maven 并构建 Java，`npm start` 启动 Java 进程。原有 MySQL、SSL CA、管理员变量继续使用；数据库缺失时不会回退到本机库。

构建命令：`npm ci --no-audit --no-fund && npm run build && npm run build:java`。启动命令：`npm start`。健康接口应有 `backend:java`、`javaVersion:17`、`database:mysql`。

线上不新配 Redis/MQ 服务，默认关闭；Quartz 使用单实例内存调度、业务任务的 MySQL 锁与去重仍有效。不要把本地集群验证写成线上已部署 MQ/Redis 集群。

如需回滚到迁移前的 Node 服务，可使用 Git 中的迁移前版本，或将启动命令改为 `npm run start:legacy`；不要重置数据库。Java 新审计可由原 Node 算法验证，但发货策略版本变化时仍需重新审批。
