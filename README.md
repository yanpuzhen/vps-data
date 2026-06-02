# VPS Data

公开 VPS 数据仓库。这个仓库只负责抓取、校验和发布前端可直接读取的 JSON 数据，不负责构建任何前端页面。

## 数据地址

DediRock:

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/dedirock/products.generated.json
```

RackNerd:

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/racknerd/products.generated.json
```

## 自动抓取

当前有两个独立 workflow:

- `.github/workflows/scrape-dedirock.yml`: 抓取 DediRock WHMCS 数据。
- `.github/workflows/scrape-racknerd.yml`: 抓取 RackNerd WHMCS 数据。

两个 workflow 都使用 GitHub 托管 runner `ubuntu-latest`，每 6 小时定时运行一次，也支持 `workflow_dispatch` 手动触发。抓取成功后会校验 JSON，如果数据有变化，会把对应的 `products.generated.json` 提交回 `main`。

PID 区间扫描和详情页抓取的高并发参数维护在 workflow 环境变量里：

```text
WHMCS_PID_SCAN_MIN=1
WHMCS_PID_SCAN_MAX=10000
WHMCS_PID_SCAN_CONCURRENCY=32
WHMCS_PID_SCRAPE_CONCURRENCY=12
WHMCS_PID_SCAN_RETRIES=2
WHMCS_PID_REQUEST_TIMEOUT_MS=15000
```

## 本地运行

校验全部数据：

```bash
npm run validate
```

单独刷新 DediRock:

```bash
npm run refresh:dedirock
```

单独刷新 RackNerd:

```bash
npm run refresh:racknerd
```

本地快速冒烟可以关闭完整 PID 区间扫描。Windows PowerShell 示例：

```powershell
$env:WHMCS_PID_SCAN_MAX='0'
npm run scrape:racknerd
npm run validate:racknerd
```

## 文件职责

- `dedirock/whmcs.config.json`: DediRock 抓取配置。
- `dedirock/dedirock-extra-pids.json`: DediRock 手工补充 PID。
- `dedirock/products.generated.json`: DediRock 公开数据产物。
- `racknerd/whmcs.config.json`: RackNerd 抓取配置。
- `racknerd/racknerd-extra-pids.json`: RackNerd 手工补充 PID。
- `racknerd/products.generated.json`: RackNerd 公开数据产物。
- `scripts/scrape-dedirock.mjs`: DediRock 抓取入口。
- `scripts/scrape-racknerd.mjs`: RackNerd 抓取入口。
- `scripts/scrape-whmcs-core.mjs`: 通用 WHMCS 抓取核心。
- `scripts/validate-products.mjs`: 数据结构校验。

更多交接信息见 `HANDOFF.md`。
