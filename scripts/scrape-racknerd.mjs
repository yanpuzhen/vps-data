process.env.WHMCS_CONFIG_FILE ??= "racknerd/whmcs.config.json";
process.env.WHMCS_OUTPUT_FILE ??= "racknerd/products.generated.json";
process.env.WHMCS_EXTRA_PID_FILE ??= "racknerd/racknerd-extra-pids.json";
process.env.WHMCS_PID_SCAN_CACHE_FILE ??= "racknerd/whmcs-pid-scan-cache.json";

await import("./scrape-whmcs-core.mjs");
