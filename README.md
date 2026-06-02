# VPS Data

公开 VPS 数据仓库。当前负责抓取 DediRock WHMCS 套餐数据，并把前端可直接读取的 JSON 发布在仓库主分支。

## 数据地址

前端默认读取：

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/dedirock/products.generated.json
```

当前数据文件：

```text
dedirock/products.generated.json
```

## 自动抓取

`.github/workflows/scrape-dedirock.yml` 会：

1. 定时每 6 小时运行一次，也支持手动 `workflow_dispatch`。
2. 使用 GitHub 托管 runner `ubuntu-latest`。
3. 执行 `npm run scrape:dedirock` 抓取 DediRock WHMCS 数据。
4. 执行 `npm run validate:dedirock` 校验 JSON。
5. 如数据变化，提交 `dedirock/products.generated.json` 到 `main`。

PID 区间扫描和深抓并发由 workflow 环境变量控制：

```text
WHMCS_PID_SCAN_MIN=1
WHMCS_PID_SCAN_MAX=10000
WHMCS_PID_SCAN_CONCURRENCY=32
WHMCS_PID_SCRAPE_CONCURRENCY=12
WHMCS_PID_SCAN_RETRIES=2
WHMCS_PID_REQUEST_TIMEOUT_MS=15000
```

## 本地运行

```bash
npm run scrape:dedirock
npm run validate:dedirock
```

轻量冒烟测试可以关闭 PID 区间扫描：

```bash
WHMCS_PID_SCAN_MAX=0 npm run scrape:dedirock
npm run validate:dedirock
```

Windows PowerShell：

```powershell
$env:WHMCS_PID_SCAN_MAX='0'
npm run scrape:dedirock
npm run validate:dedirock
```

## 文件职责

- `dedirock/whmcs.config.json`: DediRock 抓取配置。
- `dedirock/dedirock-extra-pids.json`: 手工补充 PID。
- `dedirock/products.generated.json`: 公开数据产物。
- `scripts/scrape-dedirock.mjs`: DediRock 抓取入口。
- `scripts/scrape-whmcs-core.mjs`: 通用 WHMCS 抓取核心。
- `scripts/validate-products.mjs`: 数据结构校验。

更多交接信息见 `HANDOFF.md`。
