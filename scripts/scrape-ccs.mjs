process.env.WHMCS_CONFIG_FILE ??= "ccs/whmcs.config.json";
process.env.WHMCS_OUTPUT_FILE ??= "ccs/products.generated.json";
process.env.WHMCS_EXTRA_PID_FILE ??= "ccs/ccs-extra-pids.json";
process.env.WHMCS_PID_SCAN_CACHE_FILE ??= "ccs/whmcs-pid-scan-cache.json";

await import("./scrape-whmcs-core.mjs");
