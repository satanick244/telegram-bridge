# 部署 SteelFlow 演示网站

源码已包含 Dockerfile 和 Compose 配置。本环境中的镜像构建停在依赖下载阶段，已停止构建，尚未完成容器运行验证。部署需要实际的服务器或支持长驻 Node.js / Docker 服务的托管平台；源码包本身不会自动生成网址。

## 已有 Linux 服务器

安装 Docker Engine 与 Compose 后，上传并解压源码，在包含 `compose.yaml` 的目录运行：

```bash
docker compose up -d --build
docker compose ps
curl -f http://127.0.0.1:3000/api/health
```

应用默认只监听服务器的回环地址，请使用宝塔、Nginx 或托管平台的 HTTPS 入口代理至服务器的 `127.0.0.1:3000`。域名解析与 TLS 证书配置完成后，才能获得外部可访问的 HTTPS 地址。

订单、申请和商品保存在 `steelflow-data` Docker 卷。常规重启和重建保留数据；不要执行 `docker compose down -v`，该命令会删除数据库卷。

## 支持 Docker 的托管平台

- 构建入口：仓库根目录 `Dockerfile`。
- 服务类型：长驻 Web 服务，不是纯静态站点或无状态函数。
- 容器端口：3000；平台也可以通过 `PORT` 注入自己的端口。
- 数据持久化：将持久卷挂载到 `/app/data`。
- 健康检查：`/api/health`。
- 对外网址：使用托管平台实际分配的 HTTPS 域名，或绑定自己的域名。

不支持持久卷的平台会在重建后丢失数据库，因此不适合需要保留业务数据的版本。平台费用以其实际计划为准，本项目不会自动创建付费资源。

## 交付状态与限制

公开演示入口：https://steelflow-demo.onrender.com 。该服务使用 Render 免费 Node 运行时。重新部署后，应核对实际部署提交、`/release.json` 版本、`/api/health`、页面资源及本地摄影素材，再确认发布结果。

这是共享业务演示，没有登录、企业数据隔离、真实支付和实时物流。公开演示只使用示例数据；任何能够访问演示的用户都可能更改演示商品与订单。正式商用前请完成 `PRODUCT.md` 中的账户、权限和交易能力。

## Render 免费演示配置

根目录 `render.yaml` 提供原生 Node Web Service 配置，不依赖 Docker 构建。选择免费计划，不自动创建付费资源。构建执行 `npm ci --no-audit --no-fund && npm run build`，启动执行 `npm start`，健康检查为 `/api/health`。

**免费演示的 SQLite 位于临时文件系统，实例休眠、重启或重新部署后可能重置。** 它只适合展示流程；长期保存真实业务数据需要独立持久化数据库或持久卷，不能把免费演示当作正式生产服务。

由代理代为部署时，需要 Render API Key。只通过环境设置中名为 `RENDER_API_KEY` 的密钥填写，不要把密钥放进仓库、源码包或聊天。Render 必须能读取源代码仓库；若仓库私有，还需在 Render 中授权 GitHub 仓库访问。
