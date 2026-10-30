# 账号登录与 MySQL 部署

当前版本支持用户名密码注册、登录、退出；买家和供应商的询价、订单、入驻申请按账号归属隔离。密码使用带随机盐的 scrypt 哈希，浏览器使用 HttpOnly、SameSite Cookie，生产环境启用 Secure。不存在默认管理员或公开的管理员注册入口。

商品显示 USD / 商品单位的预算参考区间，不代表供应商报价、实际库存或可直接购买的承诺。供应商上架带单价和库存的商品后，订单使用服务端价格并通过数据库事务预留库存。

## 推荐：Render + 云端 MySQL

本地电脑上的 `localhost:3306` 无法直接被 Render 访问。没有公网入口时，使用云端 MySQL，无需修改家庭路由器。

Aiven 官方文档提供免费 MySQL 方案，可在 <https://console.aiven.io/> 创建 MySQL → Free 服务。以控制台实际套餐为准；免费方案有资源和活跃度限制，没有付费服务的 SLA。官方说明：<https://github.com/aiven/aiven-docs/blob/main/docs/products/mysql/concepts/mysql-free-tier.md>。

数据库状态 Running 后，在 Overview / Connection information 找到 Host、Port、User、Password、Database，以及 CA certificate。Host 使用服务域名，Port 使用页面分配的值，不能假定一定是 3306。数据库可使用服务预建的 `defaultdb`，也可在 Databases 页面新建 `induport`。

在 Render 的 **induport-trade → Environment** 添加：

| Key | Value |
| --- | --- |
| `DATABASE_CLIENT` | `mysql` |
| `MYSQL_HOST` | 数据库页面的 Host，不能填 localhost |
| `MYSQL_PORT` | 数据库页面的 Port |
| `MYSQL_DATABASE` | 实际数据库名，如 defaultdb 或 induport |
| `MYSQL_USER` | 数据库服务提供的业务用户 |
| `MYSQL_PASSWORD` | 密码直接填 Render，不发聊天、不写仓库 |
| `MYSQL_SSL` | `true` |
| `MYSQL_SSL_CA` | CA certificate 的完整 PEM 文本（若服务需要自有 CA） |
| `ADMIN_USERNAME` | 你选择的平台管理员账号，至少 3 位 |
| `ADMIN_PASSWORD` | 你自行设置的管理员密码，至少 8 位；不要使用文档或测试中的密码 |

`MYSQL_SSL_CA` 支持真实换行或 `\n`。启用 SSL 后会验证 CA 和服务器域名；遇到证书错误应补齐正确 CA，不关闭验证。Aiven 服务若配置 IP 访问限制，在 Render 的 Connect → Outbound 中查看出口地址，加入数据库访问白名单。

所有必填项填齐后再保存并部署，避免只填一半导致新部署连接失败。应用不会在 MySQL 连接失败时悄悄改用 SQLite。首次连接仅创建 `ip_` 前缀的表和 48 款选型目录，不覆盖其他数据库表，也不导入旧示例交易。账号需要所在库的 CREATE、ALTER、SELECT、INSERT、UPDATE、DELETE 权限；不需要 root 或全服务器权限。

部署后打开 <https://induport-trade.onrender.com/api/health>：只有返回 `"database":"mysql"` 才表示线上已连接 MySQL。返回 `sqlite` 代表仍使用过渡数据库，Render 免费实例重启或重新部署时可能丢失这些记录；接入 MySQL 前不要将其用于需要长期保留的业务数据。

## 管理员与供应商

- 买家/供应商都可从网页注册，注册接口不能创建管理员。
- `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 在启动时只初始化尚不存在的管理员。若同名买家已存在，需换一个管理员名，不会自动提升该买家的权限。
- 管理员登录后，在供应商管理中审核申请。申请归属于申请者账号，批准后才能为对应公司发布商品。
- 账号角色由服务端判定，切换导航入口不能改变权限。
- 修改 ADMIN_PASSWORD 环境变量不会覆盖已有管理员密码，避免部署时误改账户；请妥善保存账号。

## 从过渡 SQLite 迁移已有数据

如果已经在过渡实例创建账号或业务记录，先由管理员登录网页，进入「企业设置」，导出数据库迁移备份。备份含密码哈希与业务资料，必须私下保存，不提交到 Git、不发在聊天中；备份不包含登录会话。

在可信电脑上配置指向目标 MySQL 的私有 `.env`，执行：

```bash
node --env-file-if-exists=.env scripts/import-backup.mjs /private/path/induport.backup.json
```

脚本在一个事务中导入，遇到记录冲突会整体回滚。已存在的采购选型条目、同名管理员可保留目标库版本，其他冲突不强制覆盖。迁移后用户重新登录；原密码哈希可继续验证。务必在旧实例重部署丢失临时文件之前导出。

## 本地与 IDEA

使用 Node.js 24。IDEA 打开项目根目录，将 `.env.example` 复制为 `.env`，填入实际配置；`.env` 不入库。

```bash
npm ci
npm run dev
```

生产模式本地验证（兼容 Windows）：

```bash
npm run build
npm start
```

本地直连 MySQL 5.7.40 可用 MYSQL_HOST=127.0.0.1、MYSQL_PORT=3306、自己的业务账号与库。仅 localhost 或已加密的私网隧道可将 MYSQL_SSL 设为 false。公网连接使用 TLS。

可通过 `node --env-file-if-exists=.env scripts/create-admin.mjs` 初始化管理员。启动服务时同样会执行管理员初始化。

## 验证

`npm test` 验证账号哈希、会话退出/过期、权限隔离、跨站请求限制、价格防篡改和库存规则。`npm run test:e2e` 验证实际注册、密码登录、退出、手机布局及采购流程。

MySQL 兼容性集成测试在隔离的官方 MySQL 5.7.40 实例验证建表、JSON 数据、事务回滚、跨连接行锁、账户和会话重启后保留。测试只接受 localhost 和以 `_test` 结尾的测试库；私有连接配置路径通过 `MYSQL_TEST_CONFIG_FILE` 指定，不把密码写入源码。
