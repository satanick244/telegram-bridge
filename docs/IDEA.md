# 使用 IntelliJ IDEA 打开 SteelFlow

这是 React + Node.js 项目，不是 Java / Maven 项目，无需 JDK、Tomcat 或外部数据库。SQLite 会在首次启动时自动创建。

## 打开与启动

1. 安装 Node.js 24 LTS 或更高版本。
2. 解压源码包，在 IntelliJ IDEA 中选择 **File → Open**，打开包含 `package.json` 的 `steelflow` 文件夹。
3. 打开 IDEA 底部的 Terminal，在项目根目录执行：

   ```bash
   npm ci --cache .npm-cache
   npm run dev
   ```

4. 等终端出现 `SteelFlow running on port 3000` 后，在本机浏览器打开 **http://localhost:3000**。
5. 在运行服务的终端按 Ctrl+C 停止。

Windows、macOS 和 Linux 均可通过上述方式运行。即使当前 IDEA 版本没有 JavaScript 专业功能，也可以通过 Terminal 运行。启用 JavaScript / Node.js 支持的 IDEA 版本还可从 `package.json` 左侧运行按钮执行 `dev`。

首次启动会自动创建 3 家示例供应商、6 款商品和 4 笔订单；随后新增的数据保存在 `data/steelflow.db`，关闭后重开仍存在。

## 可选验证

```bash
npm test
npm run build
```

浏览器自动化测试另需 Chromium，详情见根目录 README.md。

## 源码包内容

包含前后端源码、锁定依赖文件、测试、产品设计文档和本说明。未包含 `node_modules`、运行数据库、Git 元数据、构建产物和测试输出，避免把本机生成文件或业务数据混入交付包。依赖通过 `npm ci` 安装。

## 网页链接说明

`http://localhost:3000` 只在运行项目的电脑上可访问，不是公网网址。云环境里的 3000 端口也不自动等于公开网站。本项目尚未部署到公网服务器，因此当前没有可对外分享的网址。

项目为共享业务演示，未启用账户权限、企业隔离、实际支付和真实物流。对外正式发布前，请先完成相关能力和部署配置，参见 `docs/PRODUCT.md`。
