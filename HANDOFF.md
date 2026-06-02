# vps-data 交接文档

## 仓库定位

本仓库是公开后端数据仓库，只负责抓取、校验和发布 JSON 数据。它不构建前端页面，也不依赖前端仓库。

前端仓库运行时读取本仓库的 raw JSON:

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/dedirock/products.generated.json
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/racknerd/products.generated.json
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/ccs/products.generated.json
```

## 当前数据流

1. GitHub Actions 定时运行对应商家的抓取 workflow。
2. workflow 调用 `npm run scrape:dedirock`、`npm run scrape:racknerd` 或 `npm run scrape:ccs`。
3. 抓取脚本读取对应目录的 `whmcs.config.json`。
4. 产物写入对应目录的 `products.generated.json`。
5. 对应的 `validate:*` 脚本校验数据结构。
6. 数据变化时由 `github-actions[bot]` 提交回 `main`。

## Workflow 约束

本仓库目前没有第三方 npm 依赖，也没有 lockfile。数据抓取 workflow 只需要：

```text
checkout -> setup node -> restore PID cache -> scrape -> validate -> commit
```

不要加入 `npm ci`，也不要在 `actions/setup-node` 里配置 `cache: npm`。`cache: npm` 会要求存在 `package-lock.json`、`npm-shrinkwrap.json` 或 `yarn.lock`；本仓库没有这些文件时，workflow 会在 `Setup Node.js` 阶段失败，抓取脚本根本不会执行。

## CCS 特别说明

CCS 的 AFF 链接使用：

```text
https://cloud.colocrossing.com/aff.php?aff=1295
```

CCS 当前公开分类页：

- `Cloud Virtual Private Servers`
- `Cloud Metal Servers`

CCS 页面会把产品 slug 直接渲染为公开分类页或购物车页，不是 DediRock/RackNerd 那种标准配置页。因此 `ccs/whmcs.config.json` 仍设置 `scrapeProductDetails: false`，以分类卡片的价格和规格作为权威数据。

从 2026-06-02 起，`scrape-ccs.yml` 也按 `WHMCS_PID_SCAN_MIN=1`、`WHMCS_PID_SCAN_MAX=10000` 执行 PID 盲扫。盲扫用于发现可能存在的新 PID；当前 CCS 的产品详情页解析仍以分类页数据为主，必要时通过 `ccs/ccs-extra-pids.json` 做人工补充。

## 运行与验证

校验全部数据：

```bash
npm run validate
```

刷新单个商家：

```bash
npm run refresh:dedirock
npm run refresh:racknerd
npm run refresh:ccs
```

本地快速冒烟，不扫完整 PID 区间：

```powershell
$env:WHMCS_PID_SCAN_MAX='0'
npm run scrape:racknerd
npm run validate:racknerd
```

## 关键配置

每个商家的 workflow 里维护并发和重试参数：

- `WHMCS_PID_SCAN_MIN=1`: PID 扫描起点。
- `WHMCS_PID_SCAN_MAX=10000`: PID 扫描终点。
- `WHMCS_PID_SCAN_CONCURRENCY=32`: PID 区间探测并发。
- `WHMCS_PID_SCRAPE_CONCURRENCY=12`: 有效 PID 详情页抓取并发。
- `WHMCS_PID_SCAN_RETRIES=2`: 单个 PID 探测重试次数。
- `WHMCS_PID_SCAN_CACHE_TTL_HOURS=24`: PID 探测缓存有效期。

商家配置文件里维护 WHMCS 站点差异：

- `origin`: WHMCS 根地址。
- `categories`: 公开分类页。
- `affiliate`: AFF 参数。
- `outputFile`: 数据产物路径。
- `extraPidFile`: 手工补充 PID 文件。
- `scrapeProductDetails`: 是否进入产品详情/配置页深抓。

## 和前端仓库的边界

本仓库发布数据，前端仓库只消费数据。前端仓库如需切换数据地址，改 `VITE_PRODUCT_DATA_URL` 或 `src/data/remote.ts` 的默认 URL。不要把后端抓取 workflow 放回前端仓库。

## 常见故障

- `Setup Node.js` 失败并提示 `Dependencies lock file is not found`: workflow 启用了 `cache: npm`，但仓库没有 lockfile。移除 `cache: npm`，也不要补 `npm ci`。
- Action 抓取失败：先看对应 workflow 的 `Scrape ... products` 步骤日志，常见原因是远端 WHMCS 响应慢、页面结构变化或网络错误。
- 校验失败：看 `Validate dataset` 输出，修复数据结构或解析器。
- raw JSON 404：确认本仓库 `main` 分支存在对应 `products.generated.json`，并且仓库是公开仓库。
- 数据长时间不更新：检查 Actions 是否被禁用，或仓库 Actions token 是否允许 `contents: write`。

## 2026-06-02 追加

- 远端 RackNerd Action `26819675265` 失败在 `Setup Node.js`，公开 annotation 显示缺少 lockfile，不是 RackNerd 盲抓脚本报错。
- `scrape-racknerd.yml` 已移除 `cache: npm` 和 `npm ci`，后续会直接进入 PID cache 恢复、抓取和校验。
- `scrape-ccs.yml` 已改为独立 CCS workflow，并启用 `1..10000` PID 盲扫；同样不运行 `npm ci`。
- CCS 前端默认数据源已切换到 `https://raw.githubusercontent.com/yanpuzhen/vps-data/main/ccs/products.generated.json`。

## 2026-06-02 推送交接

- 本次推送范围包含 CCS 数据目录、CCS 独立 workflow、RackNerd workflow setup 修复、通用 WHMCS 抓取核心兼容项，以及 README/HANDOFF 交接说明。
- 推送后先手动触发 `Scrape RackNerd Data`，确认它能越过 `Setup Node.js` 并进入 `Scrape RackNerd products` 步骤。
- 再手动触发 `Scrape CCS Data`，确认 Actions 列表出现新 workflow，且 `WHMCS_PID_SCAN_MAX=10000` 生效。
- CCS 前端仓库位于 `E:\affman\ccs`，静态构建产物已单独推送到该仓库的 `pages` 分支。

## 2026-06-02 Actions 提交冲突修复

- 远端 `Scrape CCS Data` run `26824227863` 的抓取和校验步骤均成功，失败点是最后的 `Commit updated data`。
- 同一时间手动触发的 `Scrape RackNerd Data` run `26824240207` 先完成并提交了 `0d69620`，导致 CCS run 基于旧的 `88386fc` checkout 推送时落后远端。
- 已新增 `scripts/commit-data-changes.sh`，三个数据 workflow 都改为调用该脚本提交数据。
- 新提交脚本会在无变更时正常退出；有变更时先提交，若 push 因远端已有新提交而失败，会 `fetch + rebase` 后重试，默认最多 3 次。
- 后续如需同时手动触发多个数据 workflow，可以直接并行触发；若仍失败，优先查看 `Commit ... data` 步骤是否出现 rebase 冲突。
