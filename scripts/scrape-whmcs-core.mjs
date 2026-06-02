import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_FILE = resolve(ROOT, "scripts/whmcs.config.json");
const MIN_EXPECTED_PRODUCTS = 10;
const DEFAULT_PID_SCAN_CONCURRENCY = 24;
const DEFAULT_PID_SCRAPE_CONCURRENCY = 12;
const DEFAULT_PID_SCAN_CACHE_TTL_HOURS = 24;
const DEFAULT_PID_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_PID_SCAN_RETRIES = 2;
const DEFAULT_PRODUCT_REDIRECT_HOPS = 5;

let activeConfig;

const BILLING_CYCLE_BY_LABEL = new Map([
  ["monthly", "monthly"],
  ["quarterly", "quarterly"],
  ["semi-annually", "semiannually"],
  ["semi annually", "semiannually"],
  ["semiannually", "semiannually"],
  ["annually", "annually"],
  ["yearly", "annually"],
  ["biennially", "biennially"],
  ["triennially", "triennially"],
]);

async function loadWhmcsConfig() {
  const configFile = resolve(ROOT, firstEnv("WHMCS_CONFIG_FILE") ?? DEFAULT_CONFIG_FILE);
  const rawConfig = JSON.parse(await readFile(configFile, "utf8"));
  const origin = trimTrailingSlash(firstEnv("WHMCS_ORIGIN") ?? rawConfig.origin ?? "");

  if (!origin) {
    throw new Error(`WHMCS config ${configFile} must define an origin.`);
  }

  const sourceName = firstEnv("WHMCS_SOURCE_NAME") ?? rawConfig.sourceName ?? `${rawConfig.siteName ?? new URL(origin).hostname} WHMCS`;
  const siteName = firstEnv("WHMCS_SITE_NAME") ?? rawConfig.siteName ?? sourceName.replace(/\s+WHMCS$/i, "");
  const categories = (rawConfig.categories ?? []).map((category, index) => normalizeCategory(category, origin, index));

  return {
    configFile,
    siteName,
    siteTitle: firstEnv("WHMCS_SITE_TITLE") ?? rawConfig.siteTitle ?? `${siteName} AFF 筛选`,
    sourceName,
    origin,
    searchPlaceholder: firstEnv("WHMCS_SEARCH_PLACEHOLDER") ?? rawConfig.searchPlaceholder ?? "VPS / KVM / Storage / Promo",
    currency: firstEnv("WHMCS_CURRENCY") ?? rawConfig.currency ?? "USD",
    productCardPattern: rawConfig.productCardPattern,
    minExpectedProducts: Math.max(1, readInteger(firstEnv("WHMCS_MIN_EXPECTED_PRODUCTS") ?? rawConfig.minExpectedProducts, MIN_EXPECTED_PRODUCTS)),
    productRedirectHops: Math.max(0, readInteger(firstEnv("WHMCS_PRODUCT_REDIRECT_HOPS") ?? rawConfig.productRedirectHops, DEFAULT_PRODUCT_REDIRECT_HOPS)),
    scrapeProductDetails: readBoolean(firstEnv("WHMCS_SCRAPE_PRODUCT_DETAILS") ?? rawConfig.scrapeProductDetails, true),
    affiliate: normalizeAffiliate(rawConfig.affiliate, origin),
    storeIndexPaths: normalizeStoreIndexPaths(rawConfig.storeIndexPaths),
    outputFile: resolve(ROOT, firstEnv("WHMCS_OUTPUT_FILE") ?? rawConfig.outputFile ?? "src/data/products.generated.json"),
    extraPidFile: resolve(ROOT, firstEnv("WHMCS_EXTRA_PID_FILE") ?? rawConfig.extraPidFile ?? "scripts/whmcs-extra-pids.json"),
    pidScanCacheFile: resolve(ROOT, firstEnv("WHMCS_PID_SCAN_CACHE_FILE") ?? rawConfig.pidScanCacheFile ?? "scripts/whmcs-pid-scan-cache.json"),
    categories,
  };
}

function normalizeCategory(category, origin, index) {
  const url = category.url ? new URL(category.url, origin).toString() : new URL(category.path ?? "", origin).toString();
  const name = asOptionalString(category.name) ?? `Category ${index + 1}`;

  return {
    id: asOptionalString(category.id) ?? slugify(name),
    name,
    family: asOptionalString(category.family) ?? inferFamily(name, name),
    location: asOptionalString(category.location) ?? "Unknown",
    url,
  };
}

function normalizeAffiliate(affiliate = {}, origin) {
  const id = firstEnv("WHMCS_AFFILIATE_ID") ?? affiliate.id ?? "166";
  const param = firstEnv("WHMCS_AFFILIATE_PARAM") ?? affiliate.param ?? "aff";
  const baseUrl = firstEnv("WHMCS_AFFILIATE_BASE_URL") ?? affiliate.baseUrl ?? new URL(affiliate.basePath ?? "/aff.php", origin).toString();

  return {
    id: String(id),
    param,
    baseUrl: new URL(baseUrl, origin).toString(),
  };
}

function normalizeStoreIndexPaths(paths) {
  return (paths?.length ? paths : ["/index.php/store"]).map((path) => {
    const url = new URL(path, activeConfig?.origin ?? "https://example.invalid");
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    return `${pathname}${url.search}`.toLowerCase();
  });
}

function userAgent() {
  const host = new URL(activeConfig.origin).hostname;
  return `whmcs-aff-filter/1.0 (+https://${host}/)`;
}

async function main() {
  activeConfig = await loadWhmcsConfig();
  const productMap = new Map();
  const warnings = [];
  const stats = {
    categoryProducts: 0,
    pidTargets: 0,
    pidParsed: 0,
    pidInvalid: 0,
    pidOutOfStockOnly: 0,
    pidUnparsed: 0,
    pidScrapeErrors: 0,
    pidScanEnabled: 0,
    pidScanMin: 0,
    pidScanMax: 0,
    pidScanConcurrency: 0,
    pidScrapeConcurrency: 0,
    pidScanCacheHits: 0,
    pidScanRequests: 0,
    pidScanValid: 0,
    pidScanInvalid: 0,
    pidScanErrors: 0,
  };

  for (const category of activeConfig.categories) {
    const html = await fetchText(category.url);
    const parsedProducts = parseCategoryProducts(html, category, warnings);
    stats.categoryProducts += parsedProducts.length;
    for (const product of parsedProducts) {
      mergeProduct(productMap, product);
    }
  }

  const extraPidTargets = await loadExtraPidTargets(warnings);
  const scanOptions = readPidScanOptions();
  const scanResult = scanOptions.enabled
    ? await scanPidRange(scanOptions, warnings)
    : { targets: [], stats: {} };
  Object.assign(stats, scanResult.stats);

  const pidTargets = activeConfig.scrapeProductDetails
    ? buildPidTargets(productMap, [...scanResult.targets, ...extraPidTargets])
    : buildPidTargets(new Map(), [...scanResult.targets, ...extraPidTargets]);
  stats.pidTargets = pidTargets.length;
  stats.pidScrapeConcurrency = scanOptions.scrapeConcurrency;

  const scrapeResults = [];
  await runPool(pidTargets, scanOptions.scrapeConcurrency, async (target) => {
    scrapeResults.push({ target, result: await scrapePidProduct(target, warnings, scanOptions.timeoutMs) });
  });

  scrapeResults.sort((left, right) => Number(left.target.id) - Number(right.target.id));

  for (const { target, result } of scrapeResults) {
    if (result.status === "parsed") {
      stats.pidParsed += 1;
      mergeProduct(productMap, result.product);
      continue;
    }

    if (result.status === "invalid") {
      stats.pidInvalid += 1;
      if (target.extra) {
        warnings.push(`Extra PID ${target.id} redirected to store index and was skipped.`);
      }
      continue;
    }

    if (result.status === "out-of-stock") {
      stats.pidOutOfStockOnly += 1;
      if (!productMap.has(target.id)) {
        mergeProduct(productMap, createPlaceholderPidProduct(target, result.sourceUrl, "out-of-stock"));
      }
      continue;
    }

    stats.pidUnparsed += 1;
    if (result.error) {
      stats.pidScrapeErrors += 1;
    }
    if (!productMap.has(target.id)) {
      mergeProduct(productMap, createPlaceholderPidProduct(target, result.sourceUrl, "unparsed"));
    }
    if (!target.scanned || target.extra || target.existingProduct) {
      warnings.push(`PID ${target.id} exists at ${result.sourceUrl}, but the product configuration page could not be parsed.`);
    }
  }

  const products = [...productMap.values()].sort((left, right) => Number(left.id) - Number(right.id));

  if (products.length === 0) {
    throw new Error(`No ${activeConfig.siteName} products were scraped from official WHMCS sources.`);
  }

  if (products.length < activeConfig.minExpectedProducts) {
    throw new Error(
      `Only scraped ${products.length} ${activeConfig.siteName} products; parser output is below the safety floor of ${activeConfig.minExpectedProducts}.`,
    );
  }

  const dataset = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: activeConfig.sourceName,
      origin: activeConfig.origin,
      siteName: activeConfig.siteName,
      siteTitle: activeConfig.siteTitle,
      searchPlaceholder: activeConfig.searchPlaceholder,
      currency: activeConfig.currency,
      affiliate: activeConfig.affiliate,
      categories: activeConfig.categories.map(({ id, name, url }) => ({ id, name, url })),
      extraPids: extraPidTargets.map(({ id, category, family, location }) => ({
        id,
        category,
        family,
        location,
      })),
      stats,
    },
    warnings,
    products,
  };

  const tempFile = `${activeConfig.outputFile}.tmp`;
  await mkdir(dirname(activeConfig.outputFile), { recursive: true });
  await writeFile(tempFile, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(tempFile, activeConfig.outputFile);

  console.log(`Scraped ${products.length} official ${activeConfig.siteName} products into ${activeConfig.outputFile}`);
  console.log(
    `Category products: ${stats.categoryProducts}; PID targets: ${stats.pidTargets}; PID parsed: ${stats.pidParsed}`,
  );
  if (warnings.length > 0) {
    console.warn(`Completed with ${warnings.length} parser warning(s).`);
  }
}

async function loadExtraPidTargets(warnings) {
  const targets = [];

  try {
    const fileText = await readFile(activeConfig.extraPidFile, "utf8");
    const config = JSON.parse(fileText);

    for (const item of config.pids ?? []) {
      const target = normalizePidTarget(item, "file", warnings);
      if (target) {
        targets.push(target);
      }
    }

    for (const item of config.products ?? []) {
      const target = normalizePidTarget(item, "file", warnings);
      if (target) {
        targets.push(target);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Failed to read ${activeConfig.extraPidFile}: ${error.message}`);
    }
  }

  for (const pid of parsePidList(firstEnv("WHMCS_EXTRA_PIDS") ?? "")) {
    const target = normalizePidTarget(pid, "env", warnings);
    if (target) {
      targets.push(target);
    }
  }

  const byId = new Map();
  for (const target of targets) {
    byId.set(target.id, { ...byId.get(target.id), ...target, extra: true });
  }

  return [...byId.values()];
}

function normalizePidTarget(item, source, warnings) {
  const id = String(typeof item === "object" && item !== null ? item.id ?? item.pid ?? "" : item).trim();

  if (!/^\d+$/.test(id)) {
    warnings.push(`Ignored invalid extra PID from ${source}: ${JSON.stringify(item)}`);
    return null;
  }

  if (typeof item !== "object" || item === null) {
    return { id, extra: true };
  }

  return {
    id,
    title: asOptionalString(item.title),
    category: asOptionalString(item.category),
    family: asOptionalString(item.family),
    location: asOptionalString(item.location),
    extra: true,
  };
}

function parsePidList(value) {
  return value
    .split(/[,\s]+/)
    .map((pid) => pid.trim())
    .filter(Boolean);
}

function readPidScanOptions() {
  const min = readIntegerEnv("WHMCS_PID_SCAN_MIN", 1);
  const max = readIntegerEnv("WHMCS_PID_SCAN_MAX", 0);
  const concurrency = Math.max(1, readIntegerEnv("WHMCS_PID_SCAN_CONCURRENCY", DEFAULT_PID_SCAN_CONCURRENCY));
  const scrapeConcurrency = Math.max(1, readIntegerEnv("WHMCS_PID_SCRAPE_CONCURRENCY", DEFAULT_PID_SCRAPE_CONCURRENCY));
  const cacheTtlHours = Math.max(0, readIntegerEnv("WHMCS_PID_SCAN_CACHE_TTL_HOURS", DEFAULT_PID_SCAN_CACHE_TTL_HOURS));
  const timeoutMs = Math.max(1000, readIntegerEnv("WHMCS_PID_REQUEST_TIMEOUT_MS", DEFAULT_PID_REQUEST_TIMEOUT_MS));
  const retries = Math.max(0, readIntegerEnv("WHMCS_PID_SCAN_RETRIES", DEFAULT_PID_SCAN_RETRIES));

  return {
    enabled: max >= min,
    min,
    max,
    concurrency,
    scrapeConcurrency,
    cacheTtlHours,
    timeoutMs,
    retries,
  };
}

function readIntegerEnv(names, fallback) {
  const value = firstEnv(names);
  if (!value) {
    return fallback;
  }

  return readInteger(value, fallback);
}

function readInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (/^(1|true|yes)$/i.test(value)) {
      return true;
    }
    if (/^(0|false|no)$/i.test(value)) {
      return false;
    }
  }
  return fallback;
}

function firstEnv(names) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

async function scanPidRange(options, warnings) {
  const cache = await loadPidScanCache(warnings);
  const startedAt = new Date().toISOString();
  const pids = [];
  const targets = [];
  const stats = {
    pidScanEnabled: 1,
    pidScanMin: options.min,
    pidScanMax: options.max,
    pidScanConcurrency: options.concurrency,
    pidScanCacheHits: 0,
    pidScanRequests: 0,
    pidScanValid: 0,
    pidScanInvalid: 0,
    pidScanErrors: 0,
  };

  for (let pid = options.min; pid <= options.max; pid += 1) {
    pids.push(String(pid));
  }

  console.log(
    `Scanning ${activeConfig.siteName} PID range ${options.min}-${options.max} with concurrency ${options.concurrency}`,
  );

  await runPool(pids, options.concurrency, async (pid) => {
    const cached = getFreshCachedPidScan(cache, pid, options.cacheTtlHours);

    if (cached) {
      stats.pidScanCacheHits += 1;
      if (cached.status === "valid") {
        stats.pidScanValid += 1;
        targets.push({
          id: pid,
          sourceUrl: cached.sourceUrl,
          scanned: true,
          extra: false,
        });
      } else if (cached.status === "invalid") {
        stats.pidScanInvalid += 1;
      } else {
        stats.pidScanErrors += 1;
      }
      return;
    }

    stats.pidScanRequests += 1;
    const result = await probePidWithRetries(pid, options.timeoutMs, options.retries);
    cache.entries[pid] = {
      ...result,
      checkedAt: startedAt,
    };

    if (result.status === "valid") {
      stats.pidScanValid += 1;
      targets.push({
        id: pid,
        sourceUrl: result.sourceUrl,
        scanned: true,
        extra: false,
      });
      return;
    }

    if (result.status === "invalid") {
      stats.pidScanInvalid += 1;
      return;
    }

    stats.pidScanErrors += 1;
    warnings.push(`PID scan failed for ${pid}: ${result.error}`);
  });

  targets.sort((left, right) => Number(left.id) - Number(right.id));
  await savePidScanCache(cache);

  return { targets, stats };
}

async function probePidWithRetries(pid, timeoutMs, retries) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await probePid(pid, timeoutMs);
    if (result.status !== "error") {
      return result;
    }
    lastError = result.error;
    if (attempt < retries) {
      await delay(150 * (attempt + 1));
    }
  }

  return { status: "error", error: lastError ?? "unknown PID probe failure" };
}

async function loadPidScanCache(warnings) {
  try {
    const text = await readFile(activeConfig.pidScanCacheFile, "utf8");
    const cache = JSON.parse(text);
    if (cache.schemaVersion === 1 && cache.entries && typeof cache.entries === "object") {
      return cache;
    }
    warnings.push(`Ignored invalid PID scan cache schema in ${activeConfig.pidScanCacheFile}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warnings.push(`Could not read PID scan cache: ${error.message}`);
    }
  }

  return {
    schemaVersion: 1,
    entries: {},
  };
}

async function savePidScanCache(cache) {
  await mkdir(dirname(activeConfig.pidScanCacheFile), { recursive: true });
  await writeFile(activeConfig.pidScanCacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function getFreshCachedPidScan(cache, pid, ttlHours) {
  if (ttlHours === 0) {
    return null;
  }

  const entry = cache.entries[pid];
  if (!entry?.checkedAt) {
    return null;
  }
  if (entry.status === "error") {
    return null;
  }

  const checkedAt = new Date(entry.checkedAt).valueOf();
  if (!Number.isFinite(checkedAt)) {
    return null;
  }

  const ageMs = Date.now() - checkedAt;
  return ageMs <= ttlHours * 60 * 60 * 1000 ? entry : null;
}

async function probePid(pid, timeoutMs) {
  try {
    const response = await fetch(`${activeConfig.origin}/cart.php?a=add&pid=${encodeURIComponent(pid)}`, {
      headers: {
        "user-agent": userAgent(),
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const location = response.headers.get("location");

    if (!isRedirect(response.status) || !location || isStoreIndex(location)) {
      return { status: "invalid" };
    }

    return {
      status: "valid",
      sourceUrl: new URL(location, activeConfig.origin).toString(),
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
    };
  }
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildPidTargets(productMap, extraTargets) {
  const targets = new Map();

  for (const product of productMap.values()) {
    targets.set(product.id, {
      id: product.id,
      title: product.title,
      category: product.category,
      family: product.family,
      location: product.location,
      existingProduct: product,
      scanned: false,
      extra: false,
    });
  }

  for (const target of extraTargets) {
    const existing = targets.get(target.id);
    targets.set(target.id, {
      ...existing,
      ...target,
      existingProduct: existing?.existingProduct,
      extra: existing?.extra || target.extra,
      scanned: existing?.scanned || target.scanned,
    });
  }

  return [...targets.values()].sort((left, right) => Number(left.id) - Number(right.id));
}

async function scrapePidProduct(target, warnings, timeoutMs) {
  const session = { cookie: "" };
  const addUrl = `${activeConfig.origin}/cart.php?a=add&pid=${encodeURIComponent(target.id)}`;

  try {
    const addResponse = await fetchWithSession(addUrl, session, timeoutMs);
    const productLocation = addResponse.headers.get("location");

    if (!isRedirect(addResponse.status) || !productLocation || isStoreIndex(productLocation)) {
      return { status: "invalid", sourceUrl: addUrl };
    }

    const sourceUrl = new URL(productLocation, activeConfig.origin).toString();
    const response = await fetchProductPage(sourceUrl, session, timeoutMs);

    if (!response.ok) {
      warnings.push(`PID ${target.id} failed at ${response.url}: HTTP ${response.status}`);
      return { status: "unparsed", sourceUrl };
    }

    const html = await response.text();

    if (isProductConfigPage(html)) {
      const product = parseConfiguredPidProduct(html, target, sourceUrl, warnings);
      return product ? { status: "parsed", sourceUrl, product } : { status: "unparsed", sourceUrl };
    }

    if (/Out of Stock/i.test(html)) {
      return { status: "out-of-stock", sourceUrl };
    }

    return { status: "unparsed", sourceUrl };
  } catch (error) {
    const sourceUrl = target.sourceUrl ?? addUrl;
    warnings.push(`PID ${target.id} failed while scraping ${sourceUrl}: ${error.message}`);
    return { status: "unparsed", sourceUrl, error: error.message };
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent(),
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchWithSession(url, session, timeoutMs = DEFAULT_PID_REQUEST_TIMEOUT_MS) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent(),
      accept: "text/html,application/xhtml+xml",
      ...(session.cookie ? { cookie: session.cookie } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    session.cookie = setCookie.split(";")[0];
  }

  return response;
}

async function fetchProductPage(url, session, timeoutMs) {
  let currentUrl = url;
  let response = await fetchWithSession(currentUrl, session, timeoutMs);

  for (let hop = 0; hop < activeConfig.productRedirectHops; hop += 1) {
    const location = response.headers.get("location");
    if (!isRedirect(response.status) || !location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl).toString();
    response = await fetchWithSession(currentUrl, session, timeoutMs);
  }

  return response;
}

function parseCategoryProducts(html, category, warnings) {
  const productCardPattern = activeConfig.productCardPattern
    ? new RegExp(activeConfig.productCardPattern, "g")
    : /<div class="product clearfix" id="product(\d+)">([\s\S]*?)<\/footer>\s*<\/div>/g;
  const blocks = [...html.matchAll(productCardPattern)];

  if (blocks.length === 0) {
    warnings.push(`No product cards found for ${category.name}`);
  }

  return blocks.map(([, id, block]) => parseProductBlock(id, block, category, warnings));
}

function parseProductBlock(id, block, category, warnings) {
  const sourcePath = extractOrderHref(block);
  const lines = stripHtmlToLines(block);
  const title = lines[0] || `${category.name} PID ${id}`;
  const availableLine = lines.find((line) => /^\d+\s+Available$/i.test(line));
  const availableCount = availableLine ? Number(availableLine.match(/^(\d+)/)?.[1]) : null;
  const priceLineIndex = lines.findIndex((line) => parseMoneyLine(line));
  const parsedPrice = priceLineIndex >= 0 ? parseMoneyLine(lines[priceLineIndex]) : null;
  const amount = parsedPrice?.amount ?? NaN;
  const cycleLabel = parsedPrice?.suffix || (priceLineIndex >= 0 ? lines[priceLineIndex + 1] : "");
  const cycle = normalizeBillingCycle(cycleLabel);

  if (!Number.isFinite(amount)) {
    warnings.push(`Missing price for PID ${id} (${title})`);
  }

  const specs = parseSpecs(lines, id, warnings);
  const sourceUrl = sourcePath ? new URL(sourcePath, activeConfig.origin).toString() : category.url;

  return {
    id,
    title,
    category: category.name,
    family: category.family,
    location: category.location,
    stock: availableLine ?? "Available",
    availableCount,
    inStock: availableCount === null ? true : availableCount > 0,
    specs,
    billingOptions: [
      {
        cycle,
        label: cycleLabel || cycle,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: activeConfig.currency,
        selected: true,
      },
    ],
    sourceUrl,
    sources: [
      { type: "category", url: category.url },
      { type: "pid", url: sourceUrl },
    ],
    baseSpecsText: lines
      .filter((line) => line !== "Order Now")
      .join("\n"),
  };
}

function parseConfiguredPidProduct(html, target, sourceUrl, warnings) {
  const lines = stripHtmlToLines(html);
  const startIndex = lines.findIndex((line) => /^Configure your desired options/i.test(line));
  const endIndex = lines.findIndex((line, index) => index > startIndex && /^Order Summary$/i.test(line));

  if (startIndex < 0) {
    warnings.push(`PID ${target.id} configuration page did not contain a recognizable configuration section.`);
    return null;
  }

  const configLines = lines.slice(startIndex + 1, endIndex > startIndex ? endIndex : undefined);
  const title = configLines[0] || target.title || `${activeConfig.siteName} PID ${target.id}`;
  const billingStartIndex = configLines.findIndex((line) => /^Choose Billing Cycle$/i.test(line));
  const validationIndex = configLines.findIndex((line) => /^Please correct the following errors/i.test(line));
  const specEndIndex = smallestPositiveIndex([validationIndex, billingStartIndex], configLines.length);
  const specLines = configLines.slice(1, specEndIndex);
  const billingEndIndex = smallestPositiveIndex(
    [
      configLines.findIndex((line) => /^Configure Server$/i.test(line)),
      configLines.findIndex((line) => /^Configurable Options$/i.test(line)),
    ],
    configLines.length,
  );
  const billingLines = billingStartIndex >= 0 ? configLines.slice(billingStartIndex + 1, billingEndIndex) : [];
  const billingOptions = parseBillingOptions(billingLines);

  if (billingOptions.length === 0) {
    warnings.push(`Could not parse billing options for PID ${target.id} (${title})`);
    return null;
  }

  const specs = parseSpecs([title, ...specLines], target.id, warnings);
  const category = target.category || inferCategory(sourceUrl, title);
  const family = target.family || inferFamily(category, title);
  const location = target.location || inferLocation(category, sourceUrl, title);

  return {
    id: target.id,
    title,
    category,
    family,
    location,
    stock: target.existingProduct?.stock ?? "Available",
    availableCount: target.existingProduct?.availableCount ?? null,
    inStock: target.existingProduct?.availableCount === null ? true : (target.existingProduct?.inStock ?? true),
    specs,
    billingOptions,
    sourceUrl,
    sources: [
      ...(target.existingProduct?.sources ?? []),
      { type: "pid", url: sourceUrl },
    ],
    baseSpecsText: [
      title,
      ...specLines,
      "",
      "Billing Cycles",
      ...billingOptions.map((option) => `${option.label}: $${option.amount} ${option.currency}`),
    ].join("\n"),
  };
}

function createPlaceholderPidProduct(target, sourceUrl, status) {
  const title = target.title || titleFromSourceUrl(sourceUrl) || `${activeConfig.siteName} PID ${target.id}`;
  const category = target.category || inferCategory(sourceUrl, title);
  const family = target.family || inferFamily(category, title);
  const location = target.location || inferLocation(category, sourceUrl, title);
  const stock = status === "out-of-stock" ? "Out of Stock" : "Unparsed";

  return {
    id: target.id,
    title,
    category,
    family,
    location,
    stock,
    availableCount: status === "out-of-stock" ? 0 : null,
    inStock: false,
    specs: {
      cpuCores: 0,
      cpuLabel: "N/A",
      ramGb: 0,
      storageGb: 0,
      storageType: "N/A",
      bandwidthGb: 0,
      portMbps: 0,
      ipv4: 0,
    },
    billingOptions: [],
    sourceUrl,
    sources: [{ type: "pid", url: sourceUrl }],
    baseSpecsText: [
      title,
      `PID: ${target.id}`,
      `Status: ${stock}`,
      `Source: ${sourceUrl}`,
    ].join("\n"),
  };
}

function parseBillingOptions(lines) {
  return lines
    .map((line, index) => {
      const parsed = parseMoneyLine(line);
      if (!parsed) {
        return null;
      }

      return {
        cycle: normalizeBillingCycle(parsed.suffix),
        label: parsed.suffix.trim(),
        amount: parsed.amount,
        currency: parsed.currency,
        selected: index === 0,
      };
    })
    .filter(Boolean);
}

function parseMoneyLine(line) {
  const escapedCurrency = escapeRegExp(activeConfig.currency);
  const symbolPattern = String.raw`[$€£¥]`;
  const amountPattern = String.raw`(\d+(?:\.\d+)?)`;
  const suffixPattern = String.raw`(.+?)`;
  const patterns = [
    new RegExp(String.raw`^\s*${symbolPattern}\s*${amountPattern}\s+${escapedCurrency}(?:\s+${suffixPattern})?\s*$`, "i"),
    new RegExp(String.raw`^\s*${escapedCurrency}\s*${amountPattern}(?:\s+${suffixPattern})?\s*$`, "i"),
    new RegExp(String.raw`^\s*${symbolPattern}\s*${amountPattern}(?:\s+${suffixPattern})?\s*$`, "i"),
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return {
        amount: Number(match[1]),
        currency: activeConfig.currency,
        suffix: match[2] ?? "",
      };
    }
  }

  return null;
}

function mergeProduct(productMap, product) {
  const existing = productMap.get(product.id);

  if (!existing) {
    productMap.set(product.id, product);
    return;
  }

  productMap.set(product.id, {
    ...existing,
    ...product,
    stock: existing.availableCount !== null ? existing.stock : product.stock,
    availableCount: existing.availableCount ?? product.availableCount,
    inStock: existing.availableCount !== null ? existing.inStock : product.inStock,
    billingOptions: mergeBillingOptions(existing.billingOptions, product.billingOptions),
    sources: mergeSources(existing.sources ?? [], product.sources ?? []),
  });
}

function mergeBillingOptions(existingOptions, nextOptions) {
  const byCycle = new Map();
  for (const option of existingOptions) {
    byCycle.set(option.cycle, option);
  }
  for (const option of nextOptions) {
    byCycle.set(option.cycle, option);
  }
  return [...byCycle.values()];
}

function mergeSources(existingSources, nextSources) {
  const byKey = new Map();
  for (const source of [...existingSources, ...nextSources]) {
    byKey.set(`${source.type}:${source.url}`, source);
  }
  return [...byKey.values()];
}

function extractOrderHref(block) {
  const orderAnchor = block.match(/<a\b[^>]*btn-order-now[^>]*>/i)?.[0];
  return orderAnchor?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}

function stripHtmlToLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:h[1-6]|p|div|li|span|footer|header|label|option|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;/g, "$")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeBillingCycle(label) {
  const normalized = label.trim().toLowerCase();
  return BILLING_CYCLE_BY_LABEL.get(normalized) ?? "monthly";
}

function parseSpecs(lines, id, warnings) {
  const ramLine = lines.find((line) => /\b(?:MB|GB)\s*RAM\b/i.test(line));
  const cpuLine = lines.find((line) => /\bv(?:Core|CPU)|CPU\b/i.test(line));
  const storageLine = lines.find((line) => /\b(?:GB|TB)\s+(?:SSD|Space|Storage|HDD|NVMe)\b/i.test(line));
  const bandwidthLine = lines.find((line) => /\b(?:GB|TB)\b.*\bBandwidth\b/i.test(line));
  const portLine = lines.find((line) => /\b(?:Mbp\/s|Mbps|Gbp\/s|Gbps)\b/i.test(line));
  const ipv4Line = lines.find((line) => /\b(?:IPv4|Dedicated IP)\b/i.test(line));

  const specs = {
    cpuCores: parseCpuCores(cpuLine),
    cpuLabel: cpuLine ?? "N/A",
    ramGb: parseCapacityGb(ramLine),
    storageGb: parseCapacityGb(storageLine),
    storageType: parseStorageType(storageLine),
    bandwidthGb: parseCapacityGb(bandwidthLine),
    portMbps: parsePortMbps(portLine),
    ipv4: ipv4Line ? Number(ipv4Line.match(/(\d+)/)?.[1] ?? 0) : 0,
  };

  for (const [key, value] of Object.entries(specs)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      warnings.push(`Could not parse ${key} for PID ${id}`);
      specs[key] = 0;
    }
  }

  return specs;
}

function parseCpuCores(line) {
  if (!line) {
    return 0;
  }

  return Number(line.match(/(\d+(?:\.\d+)?)\s*x/i)?.[1] ?? line.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
}

function parseCapacityGb(line) {
  if (!line) {
    return 0;
  }

  const match = line.match(/(\d+(?:\.\d+)?)\s*(MB|GB|TB)\b/i);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "MB") {
    return amount / 1024;
  }
  if (unit === "TB") {
    return amount * 1024;
  }
  return amount;
}

function parseStorageType(line) {
  if (!line) {
    return "Storage";
  }

  if (/\bNVMe\b/i.test(line)) {
    return "NVMe";
  }
  if (/\bSSD\b/i.test(line)) {
    return "SSD";
  }
  if (/\bHDD\b/i.test(line)) {
    return "HDD";
  }
  return "Space";
}

function parsePortMbps(line) {
  if (!line) {
    return 0;
  }

  const match = line.match(/(\d+(?:\.\d+)?)\s*(Mbp\/s|Mbps|Gbp\/s|Gbps)\b/i);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  return /^G/i.test(match[2]) ? amount * 1000 : amount;
}

function inferCategory(sourceUrl, title) {
  const matchedCategory = [...activeConfig.categories]
    .sort((left, right) => routeKey(right.url).length - routeKey(left.url).length)
    .find((category) => routeStartsWith(sourceUrl, category.url));
  if (matchedCategory) {
    return matchedCategory.name;
  }
  const haystack = `${sourceUrl} ${title}`;
  if (/dedicated|bare[-\s]?metal/i.test(haystack)) {
    return "Dedicated Server";
  }
  if (/promo/i.test(title) && /storage/i.test(title)) {
    return "Hidden Promo Storage";
  }
  if (/promo/i.test(title)) {
    return "Hidden Promo VPS";
  }
  if (/storage/i.test(title)) {
    return "Hidden Storage VPS";
  }
  return "Hidden VPS";
}

function inferFamily(category, title) {
  if (/dedicated|bare[-\s]?metal/i.test(`${category} ${title}`)) {
    return "Dedicated Server";
  }
  if (/promo/i.test(category) && /storage/i.test(category)) {
    return "Promo Storage VPS";
  }
  if (/promo/i.test(category)) {
    return "Promo VPS";
  }
  if (/storage/i.test(category) || /storage/i.test(title)) {
    return "Storage VPS";
  }
  return "KVM VPS";
}

function inferLocation(category, sourceUrl, title) {
  const haystack = `${category} ${sourceUrl} ${title}`.toLowerCase();
  if (/\bny\b|new-york|buffalo/.test(haystack)) {
    return "New York";
  }
  if (/\bla\b|los-angeles|lax/.test(haystack)) {
    return "Los Angeles";
  }
  return "Unknown";
}

function isProductConfigPage(html) {
  return /Configure your desired options and continue to checkout\./i.test(html) && /Choose Billing Cycle/i.test(html);
}

function titleFromSourceUrl(sourceUrl) {
  const pathname = new URL(sourceUrl, activeConfig.origin).pathname;
  const slug = pathname.split("/").filter(Boolean).at(-1);
  if (!slug || slug === "cart.php" || slug === "index.php") {
    return "";
  }

  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 ? word.toUpperCase() : `${word[0].toUpperCase()}${word.slice(1)}`))
    .join(" ");
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}

function isStoreIndex(location) {
  const url = new URL(location, activeConfig.origin);
  const route = routeKey(url);
  return activeConfig.storeIndexPaths.some((storeRoute) => route === storeRoute);
}

function routeStartsWith(url, baseUrl) {
  const route = routeKey(url);
  const baseRoute = routeKey(baseUrl);
  return route === baseRoute || route.startsWith(`${baseRoute}/`);
}

function routeKey(urlLike) {
  const url = urlLike instanceof URL ? urlLike : new URL(urlLike, activeConfig.origin);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  return `${pathname}${url.search}`.toLowerCase();
}

function smallestPositiveIndex(indexes, fallback) {
  const positiveIndexes = indexes.filter((index) => index >= 0);
  return positiveIndexes.length > 0 ? Math.min(...positiveIndexes) : fallback;
}

function asOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/$/, "");
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "category";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
