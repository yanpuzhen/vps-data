import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve(process.argv[2] ?? "src/data/products.generated.json");
const dataset = JSON.parse(await readFile(file, "utf8"));

const errors = [];

if (dataset.schemaVersion !== 1) {
  errors.push("schemaVersion must be 1.");
}
if (!isIsoDate(dataset.generatedAt)) {
  errors.push("generatedAt must be an ISO date string.");
}
if (!dataset.source?.name) {
  errors.push("source.name is required.");
}
if (!isHttpUrl(dataset.source?.origin)) {
  errors.push("source.origin must be an absolute HTTP(S) URL.");
}
if (!Array.isArray(dataset.source?.categories)) {
  errors.push("source.categories must be an array.");
}
if (!Array.isArray(dataset.warnings)) {
  errors.push("warnings must be an array.");
}
if (!Array.isArray(dataset.products) || dataset.products.length === 0) {
  errors.push("products must be a non-empty array.");
}

const ids = new Set();
for (const [index, product] of (dataset.products ?? []).entries()) {
  const label = product?.id ? `PID ${product.id}` : `product[${index}]`;

  if (!/^\d+$/.test(String(product?.id ?? ""))) {
    errors.push(`${label}: id must be numeric.`);
  }
  if (ids.has(product.id)) {
    errors.push(`${label}: duplicate id.`);
  }
  ids.add(product.id);
  if (!product?.title) {
    errors.push(`${label}: title is required.`);
  }
  if (!isHttpUrl(product?.sourceUrl)) {
    errors.push(`${label}: sourceUrl must be an absolute HTTP(S) URL.`);
  }
  if (!Array.isArray(product?.billingOptions)) {
    errors.push(`${label}: billingOptions must be an array.`);
  }
  for (const option of product?.billingOptions ?? []) {
    if (!option.cycle || !Number.isFinite(option.amount) || option.amount < 0 || !option.currency) {
      errors.push(`${label}: invalid billing option ${JSON.stringify(option)}.`);
    }
  }
  for (const [key, value] of Object.entries(product?.specs ?? {})) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${label}: specs.${key} must be a non-negative finite number.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Invalid product dataset ${file}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${dataset.products.length} products in ${file}`);

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
