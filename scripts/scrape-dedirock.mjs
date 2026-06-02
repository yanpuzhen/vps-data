process.env.WHMCS_CONFIG_FILE ??= "dedirock/whmcs.config.json";
process.env.WHMCS_OUTPUT_FILE ??= "dedirock/products.generated.json";
process.env.WHMCS_EXTRA_PID_FILE ??= "dedirock/dedirock-extra-pids.json";
process.env.WHMCS_PID_SCAN_CACHE_FILE ??= "dedirock/whmcs-pid-scan-cache.json";

await import("./scrape-whmcs-core.mjs");
