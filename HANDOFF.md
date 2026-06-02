# vps-data 交接文档

## 仓库定位

本仓库是公开后端数据仓库，只负责抓取、校验和发布 JSON 数据。它不构建前端页面，也不依赖前端仓库。

前端仓库运行时读取本仓库的 raw JSON：

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/dedirock/products.generated.json
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/racknerd/products.generated.json
```

## 当前数据流

1. GitHub Actions 定时运行对应商家的抓取 workflow。
2. workflow 调用 `npm run scrape:dedirock` 或 `npm run scrape:racknerd`。
3. 抓取脚本读取 `dedirock/whmcs.config.json` 或 `racknerd/whmcs.config.json`。
4. 产物写入对应目录的 `products.generated.json`。
5. `npm run validate:dedirock` 或 `npm run validate:racknerd` 校验数据结构。
6. 数据变化时由 `github-actions[bot]` 提交回 `main`。

## 运行与验证

校验全部数据：

```bash
npm run validate
```

刷新 DediRock:

```bash
npm run refresh:dedirock
```

刷新 RackNerd:

```bash
npm run refresh:racknerd
```

本地快速冒烟，不扫完整 PID 区间：

```powershell
$env:WHMCS_PID_SCAN_MAX='0'
npm run scrape:racknerd
npm run validate:racknerd
```

## 关键配置

每个商家的 workflow 里维护并发和重试参数：

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

## 和前端仓库的边界

本仓库发布数据，前端仓库只消费数据。前端仓库如需切换数据地址，改 `VITE_PRODUCT_DATA_URL` 或 `src/data/remote.ts` 的默认 URL。不要把后端抓取 workflow 放回前端仓库。

## 常见故障

- Action 抓取失败：先看对应 workflow 的 `Scrape ... products` 步骤日志，常见原因是远端 WHMCS 响应慢、页面结构变化或网络错误。
- 校验失败：看 `Validate dataset` 输出，修复数据结构或解析器。
- raw JSON 404：确认本仓库 `main` 分支存在对应 `products.generated.json`，并且仓库是公开仓库。
- 数据长时间不更新：检查 Actions 是否被禁用，或仓库 Actions token 是否允许 `contents: write`。
