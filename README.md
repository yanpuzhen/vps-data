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

CCS / ColoCrossing Cloud:

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/ccs/products.generated.json
```

DMIT:

```text
https://raw.githubusercontent.com/yanpuzhen/vps-data/main/dmit/products.generated.json
```

## 自动抓取

当前有四个独立 workflow:

- `.github/workflows/scrape-dedirock.yml`: 抓取 DediRock WHMCS 数据。
- `.github/workflows/scrape-racknerd.yml`: 抓取 RackNerd WHMCS 数据。
- `.github/workflows/scrape-ccs.yml`: 抓取 CCS / ColoCrossing Cloud WHMCS 数据。
- `.github/workflows/scrape-dmit.yml`: 抓取 DMIT pricing 数据。

四个 workflow 都使用 GitHub 托管 runner `ubuntu-latest`，每 6 小时定时运行一次，也支持 `workflow_dispatch` 手动触发。抓取成功后会校验 JSON，如果数据有变化，会把对应的 `products.generated.json` 提交回 `main`。

定时分钟错开为 `7/17/37/57`，避免四个商家同时启动。DediRock、RackNerd 和 CCS 都按 `WHMCS_PID_SCAN_MIN=1`、`WHMCS_PID_SCAN_MAX=10000` 做 PID 区间盲扫；额外 PID 仍然通过各自的 `*-extra-pids.json` 补充。DMIT 官方页和购物车存在 Cloudflare challenge，不走 WHMCS PID 盲扫；`scripts/scrape-dmit.mjs` 会优先尝试官方 pricing 页，失败后解析公开 pricing 镜像，并把订单 URL 统一重写为 `https://www.dmit.io/aff.php?aff=22739&pid=...`。

这个仓库没有依赖项和 lockfile，数据 workflow 不运行 `npm ci`，也不要在 `actions/setup-node` 上启用 `cache: npm`。否则 `setup-node` 会因为找不到 `package-lock.json`、`npm-shrinkwrap.json` 或 `yarn.lock` 直接失败。

## 本地运行

校验全部数据：

```bash
npm run validate
```

单独刷新：

```bash
npm run refresh:dedirock
npm run refresh:racknerd
npm run refresh:ccs
npm run refresh:dmit
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
- `ccs/whmcs.config.json`: CCS 抓取配置。
- `ccs/ccs-extra-pids.json`: CCS 手工补充 PID。
- `ccs/products.generated.json`: CCS 公开数据产物。
- `dmit/products.generated.json`: DMIT 公开数据产物。
- `scripts/scrape-dedirock.mjs`: DediRock 抓取入口。
- `scripts/scrape-racknerd.mjs`: RackNerd 抓取入口。
- `scripts/scrape-ccs.mjs`: CCS 抓取入口。
- `scripts/scrape-dmit.mjs`: DMIT pricing 抓取入口。
- `scripts/scrape-whmcs-core.mjs`: 通用 WHMCS 抓取核心。
- `scripts/validate-products.mjs`: 数据结构校验。

更多交接信息见 `HANDOFF.md`。
