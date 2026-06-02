import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_FILE = resolve(ROOT_DIR, process.env.DMIT_OUTPUT_FILE ?? "dmit/products.generated.json");

const OFFICIAL_ORIGIN = "https://www.dmit.io";
const OFFICIAL_PRICING_URL = `${OFFICIAL_ORIGIN}/pages/pricing`;
const AFFILIATE_ID = "22739";
const AFFILIATE_URL = `${OFFICIAL_ORIGIN}/aff.php?aff=${AFFILIATE_ID}`;
const MIRROR_PRICING_URL = "https://dmit.vpssk.com/";

const FETCH_CANDIDATES = uniqueStrings([
  process.env.DMIT_PRICING_URL,
  OFFICIAL_PRICING_URL,
  process.env.DMIT_MIRROR_PRICING_URL,
  MIRROR_PRICING_URL,
]);

const ROUTE_META = [
  {
    id: "lax-an4-pro",
    pattern: /^LAX\.AN4\.Pro\b/i,
    category: "Los Angeles Premium",
    location: "Los Angeles",
    family: "Premium Network",
    tags: ["LAX", "Premium", "CN2 GIA"],
  },
  {
    id: "lax-an5-pro",
    pattern: /^LAX\.AN5\.Pro\b/i,
    category: "Los Angeles Premium",
    location: "Los Angeles",
    family: "Premium Network",
    tags: ["LAX", "Premium", "CN2 GIA"],
  },
  {
    id: "lax-an4-eb",
    pattern: /^LAX\.AN4\.EB\b/i,
    category: "Los Angeles Eyeball",
    location: "Los Angeles",
    family: "Eyeball Network",
    tags: ["LAX", "Eyeball"],
  },
  {
    id: "lax-an5-eb",
    pattern: /^LAX\.AN5\.EB\b/i,
    category: "Los Angeles Eyeball",
    location: "Los Angeles",
    family: "Eyeball Network",
    tags: ["LAX", "Eyeball"],
  },
  {
    id: "lax-an5-t1-volume",
    pattern: /^LAX\.AN5\.T1\b/i,
    category: "Los Angeles Tier 1",
    location: "Los Angeles",
    family: "Tier 1 Network",
    tags: ["LAX", "Tier 1", "Volume"],
  },
  {
    id: "lax-an4-t1",
    pattern: /^LAX\.AN4\.T1\b/i,
    category: "Los Angeles Tier 1",
    location: "Los Angeles",
    family: "Tier 1 Network",
    tags: ["LAX", "Tier 1"],
  },
  {
    id: "hkg-as3-pro",
    pattern: /^HKG\.AS3\.Pro\b/i,
    category: "Hong Kong Premium",
    location: "Hong Kong",
    family: "Premium Network",
    tags: ["HKG", "Premium", "CN2 GIA"],
  },
  {
    id: "hkg-as3-eb",
    pattern: /^HKG\.AS3\.EB\b/i,
    category: "Hong Kong Eyeball",
    location: "Hong Kong",
    family: "Eyeball Network",
    tags: ["HKG", "Eyeball"],
  },
  {
    id: "hkg-as3-t1",
    pattern: /^HKG\.AS3\.T1\b/i,
    category: "Hong Kong Tier 1",
    location: "Hong Kong",
    family: "Tier 1 Network",
    tags: ["HKG", "Tier 1"],
  },
  {
    id: "tyo-as3-pro",
    pattern: /^TYO\.AS3\.Pro\b/i,
    category: "Tokyo Premium",
    location: "Tokyo",
    family: "Premium Network",
    tags: ["TYO", "Premium", "CN2 GIA"],
  },
  {
    id: "tyo-as3-eb",
    pattern: /^TYO\.AS3\.EB\b/i,
    category: "Tokyo Eyeball",
    location: "Tokyo",
    family: "Eyeball Network",
    tags: ["TYO", "Eyeball"],
  },
  {
    id: "tyo-as3-t1",
    pattern: /^TYO\.AS3\.T1\b/i,
    category: "Tokyo Tier 1",
    location: "Tokyo",
    family: "Tier 1 Network",
    tags: ["TYO", "Tier 1"],
  },
];

const FALLBACK_PRODUCTS = [
  makeFallbackProduct(100, "LAX.AN5.Pro TINY", "Los Angeles Premium", "Los Angeles", "Premium Network", {
    cpuCores: 1,
    ramGb: 2,
    storageGb: 20,
    bandwidthGb: 1000,
    portMbps: 1000,
    amount: 119.99,
    cycle: "annually",
    label: "Annual",
  }),
  makeFallbackProduct(137, "LAX.AN5.Pro Pocket", "Los Angeles Premium", "Los Angeles", "Premium Network", {
    cpuCores: 2,
    ramGb: 2,
    storageGb: 40,
    bandwidthGb: 1500,
    portMbps: 4000,
    amount: 203.9,
    cycle: "annually",
    label: "Annual",
  }),
  makeFallbackProduct(56, "LAX.AN5.Pro STARTER", "Los Angeles Premium", "Los Angeles", "Premium Network", {
    cpuCores: 2,
    ramGb: 2,
    storageGb: 80,
    bandwidthGb: 3000,
    portMbps: 10000,
    amount: 38.9,
  }),
  makeFallbackProduct(218, "HKG.AS3.Pro TINY", "Hong Kong Premium", "Hong Kong", "Premium Network", {
    cpuCores: 1,
    ramGb: 1,
    storageGb: 20,
    bandwidthGb: 500,
    portMbps: 1000,
    amount: 39.9,
  }),
  makeFallbackProduct(219, "HKG.AS3.Pro STARTER", "Hong Kong Premium", "Hong Kong", "Premium Network", {
    cpuCores: 1,
    ramGb: 2,
    storageGb: 40,
    bandwidthGb: 1000,
    portMbps: 1000,
    amount: 79.9,
  }),
  makeFallbackProduct(201, "TYO.AS3.Pro TINY", "Tokyo Premium", "Tokyo", "Premium Network", {
    cpuCores: 1,
    ramGb: 1,
    storageGb: 20,
    bandwidthGb: 500,
    portMbps: 1000,
    amount: 21.9,
  }),
  makeFallbackProduct(202, "TYO.AS3.Pro STARTER", "Tokyo Premium", "Tokyo", "Premium Network", {
    cpuCores: 1,
    ramGb: 2,
    storageGb: 40,
    bandwidthGb: 1000,
    portMbps: 1000,
    amount: 39.9,
  }),
];

const warnings = [
  "DMIT protects the official pricing and cart pages with Cloudflare challenges; this scraper falls back to a public pricing mirror when direct official fetch fails.",
  "Order URLs are rewritten to use affiliate id 22739. Always confirm stock, final price, billing cycle, and add-ons on DMIT checkout before purchase.",
];

const pricingSource = await fetchPricingHtml();
let products = [];

if (pricingSource?.html) {
  products = parsePricingHtml(pricingSource.html, pricingSource.url);
}

if (products.length === 0) {
  warnings.push("Live pricing parse produced no products; generated from a bundled DMIT pricing snapshot instead.");
  products = FALLBACK_PRODUCTS;
}

const dataset = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    name: "DMIT Pricing",
    origin: OFFICIAL_ORIGIN,
    siteName: "DMIT",
    siteTitle: "DMIT VPS Filter",
    searchPlaceholder: "LAX / HKG / TYO / Premium / Eyeball",
    currency: "USD",
    affiliate: {
      id: AFFILIATE_ID,
      param: "aff",
      baseUrl: `${OFFICIAL_ORIGIN}/aff.php`,
    },
    categories: ROUTE_META.map((route) => ({
      id: route.id,
      name: route.category,
      url: OFFICIAL_PRICING_URL,
    })),
    stats: {
      pricingSourceUrl: pricingSource?.url ?? "bundled-snapshot",
      parsedProducts: products.length,
      directOfficialFetch: pricingSource?.url === OFFICIAL_PRICING_URL,
    },
  },
  warnings,
  products: sortProducts(products),
};

await mkdir(dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

console.log(`Generated ${dataset.products.length} DMIT products -> ${OUTPUT_FILE}`);
console.log(`Pricing source: ${dataset.source.stats.pricingSourceUrl}`);
if (warnings.length > 0) {
  console.warn(warnings.map((warning) => `Warning: ${warning}`).join("\n"));
}

async function fetchPricingHtml() {
  for (const url of FETCH_CANDIDATES) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; vps-data-dmit-scraper/1.0; +https://github.com/yanpuzhen/vps-data)",
        },
        signal: AbortSignal.timeout(Number(process.env.DMIT_FETCH_TIMEOUT_MS ?? 30000)),
      });
      const html = await response.text();

      if (!response.ok) {
        warnings.push(`Fetch ${url} returned HTTP ${response.status}; trying next source.`);
        continue;
      }
      if (looksLikeCloudflareChallenge(html) && !looksLikePricingTable(html)) {
        warnings.push(`Fetch ${url} returned a Cloudflare challenge; trying next source.`);
        continue;
      }
      if (!/DMIT|LAX\.|HKG\.|TYO\./i.test(html)) {
        warnings.push(`Fetch ${url} did not look like a DMIT pricing page; trying next source.`);
        continue;
      }

      return { url, html };
    } catch (error) {
      warnings.push(`Fetch ${url} failed: ${error.message}; trying next source.`);
    }
  }

  return null;
}

function parsePricingHtml(html, sourceUrl) {
  const productsByPid = new Map();
  const blockPattern = /<h3[^>]*>([\s\S]*?)<\/h3>\s*(?:<div[^>]*class=["'][^"']*notes[^"']*["'][^>]*>[\s\S]*?<\/div>\s*)?<table[^>]*>[\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/gi;

  for (const match of html.matchAll(blockPattern)) {
    const routeTitle = cleanHtml(match[1]);
    const routeMeta = getRouteMeta(routeTitle);

    for (const rowHtml of match[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowHtml[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
      if (cells.length < 7) {
        continue;
      }

      const rawOrderCell = cells[7] ?? "";
      const sourcePid = extractPid(rawOrderCell);
      const id = sourcePid ?? stableNumericId(`${routeTitle}:${cleanHtml(cells[0])}`);
      const orderUrl = sourcePid ? makeAffiliateUrl(sourcePid) : AFFILIATE_URL;
      const billing = parsePrice(cleanHtml(cells[6]));
      const title = `${routeTitle.split(/\s+/)[0]} ${cleanHtml(cells[0])}`.trim();

      const product = {
        id,
        title,
        category: routeMeta.category,
        family: routeMeta.family,
        location: routeMeta.location,
        stock: "Check DMIT checkout",
        availableCount: null,
        inStock: true,
        tags: routeMeta.tags,
        specs: {
          cpuCores: parseFirstNumber(cleanHtml(cells[1])),
          cpuLabel: cleanHtml(cells[1]),
          ramGb: parseGb(cleanHtml(cells[2])),
          storageGb: parseGb(cleanHtml(cells[3])),
          storageType: parseStorageType(cleanHtml(cells[3])),
          bandwidthGb: parseGb(cleanHtml(cells[4])),
          portMbps: parsePortMbps(cleanHtml(cells[5])),
          ipv4: 1,
        },
        billingOptions: billing
          ? [
              {
                cycle: billing.cycle,
                label: billing.label,
                amount: billing.amount,
                currency: "USD",
                selected: true,
              },
            ]
          : [],
        sourceUrl: orderUrl,
        sources: [
          {
            type: "pricing",
            url: sourceUrl,
          },
          {
            type: "affiliate",
            url: orderUrl,
          },
        ],
        baseSpecsText: [
          title,
          routeMeta.category,
          cleanHtml(cells[1]),
          cleanHtml(cells[2]),
          cleanHtml(cells[3]),
          cleanHtml(cells[4]),
          cleanHtml(cells[5]),
          cleanHtml(cells[6]),
          `Source: ${sourceUrl}`,
        ].join("\n"),
      };

      productsByPid.set(product.id, product);
    }
  }

  return [...productsByPid.values()];
}

function getRouteMeta(routeTitle) {
  const matched = ROUTE_META.find((route) => route.pattern.test(routeTitle));
  if (matched) {
    return matched;
  }

  return {
    id: slugify(routeTitle),
    category: routeTitle,
    location: inferLocation(routeTitle),
    family: inferFamily(routeTitle),
    tags: [],
  };
}

function makeFallbackProduct(id, title, category, location, family, spec) {
  return {
    id: String(id),
    title,
    category,
    family,
    location,
    stock: "Check DMIT checkout",
    availableCount: null,
    inStock: true,
    tags: [location, family],
    specs: {
      cpuCores: spec.cpuCores,
      cpuLabel: `${spec.cpuCores} vCPU`,
      ramGb: spec.ramGb,
      storageGb: spec.storageGb,
      storageType: "SSD",
      bandwidthGb: spec.bandwidthGb,
      portMbps: spec.portMbps,
      ipv4: 1,
    },
    billingOptions: [
      {
        cycle: spec.cycle ?? "monthly",
        label: spec.label ?? "Monthly",
        amount: spec.amount,
        currency: "USD",
        selected: true,
      },
    ],
    sourceUrl: makeAffiliateUrl(id),
    sources: [
      {
        type: "pricing",
        url: OFFICIAL_PRICING_URL,
      },
      {
        type: "affiliate",
        url: makeAffiliateUrl(id),
      },
    ],
    baseSpecsText: `${title}\n${category}\n${spec.cpuCores} vCPU\n${spec.ramGb}GB RAM\n${spec.storageGb}GB SSD\n${spec.bandwidthGb}GB Transfer\n${spec.portMbps}Mbps Port`,
  };
}

function makeAffiliateUrl(pid) {
  return `${AFFILIATE_URL}&pid=${encodeURIComponent(pid)}`;
}

function extractPid(html) {
  const href = html.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) {
    return null;
  }

  try {
    const url = new URL(href, OFFICIAL_ORIGIN);
    return url.searchParams.get("pid");
  } catch {
    return href.match(/[?&]pid=(\d+)/i)?.[1] ?? null;
  }
}

function parsePrice(text) {
  const match = text.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(月|年|季|month|mo|monthly|year|yr|annual|annually|quarter|quarterly)?/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = (match[2] ?? "month").toLowerCase();
  if (unit === "年" || unit.startsWith("year") || unit.startsWith("yr") || unit.startsWith("annual")) {
    return { amount, cycle: "annually", label: "Annual" };
  }
  if (unit === "季" || unit.startsWith("quarter")) {
    return { amount, cycle: "quarterly", label: "Quarterly" };
  }

  return { amount, cycle: "monthly", label: "Monthly" };
}

function parseFirstNumber(text) {
  const value = Number.parseFloat(text.match(/[\d.]+/)?.[0] ?? "0");
  return Number.isFinite(value) ? value : 0;
}

function parseGb(text) {
  const value = parseFirstNumber(text);
  if (/tb|tib/i.test(text)) {
    return value * 1024;
  }
  return value;
}

function parsePortMbps(text) {
  const value = parseFirstNumber(text);
  if (/gbps|gbit/i.test(text)) {
    return value * 1000;
  }
  return value;
}

function parseStorageType(text) {
  if (/nvme/i.test(text)) {
    return "NVMe";
  }
  if (/ssd/i.test(text)) {
    return "SSD";
  }
  return "Storage";
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCloudflareChallenge(html) {
  return /cf-mitigated|just a moment|challenge-platform|cdn-cgi\/challenge-platform|checking your browser|turnstile/i.test(
    html,
  );
}

function looksLikePricingTable(html) {
  return /<h3[^>]*>[\s\S]*?(?:LAX|HKG|TYO)\./i.test(html) && /data-label=["']价格["']/i.test(html);
}

function inferLocation(title) {
  if (/HKG|Hong Kong/i.test(title)) {
    return "Hong Kong";
  }
  if (/TYO|Tokyo/i.test(title)) {
    return "Tokyo";
  }
  if (/LAX|Los Angeles/i.test(title)) {
    return "Los Angeles";
  }
  return "Global";
}

function inferFamily(title) {
  if (/eyeball|\.EB\b/i.test(title)) {
    return "Eyeball Network";
  }
  if (/tier\s*1|\.T1\b/i.test(title)) {
    return "Tier 1 Network";
  }
  if (/premium|\.Pro\b/i.test(title)) {
    return "Premium Network";
  }
  return "Cloud Instance";
}

function stableNumericId(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String(900000 + (hash >>> 0) % 99999);
}

function sortProducts(input) {
  return [...input].sort((a, b) => {
    const locationCompare = String(a.location).localeCompare(String(b.location));
    if (locationCompare !== 0) {
      return locationCompare;
    }
    const categoryCompare = String(a.category).localeCompare(String(b.category));
    if (categoryCompare !== 0) {
      return categoryCompare;
    }
    return Number(a.billingOptions?.[0]?.amount ?? 0) - Number(b.billingOptions?.[0]?.amount ?? 0);
  });
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueStrings(input) {
  return [...new Set(input.filter((value) => typeof value === "string" && value.length > 0))];
}
