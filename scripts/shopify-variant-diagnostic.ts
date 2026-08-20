import { mkdir, writeFile } from 'node:fs/promises';
import { secureFetch } from '../packages/crawler-core/src/url-policy.ts';

const requestedUrl = 'https://missboon.ca/en/products/scindapsus-mount-salak-4';
const page = new URL(requestedUrl);
const match = page.pathname.match(/^(.*\/products\/)([^/]+?)\/?$/i);
if (!match) throw new Error('Expected Shopify product URL');
const productJsonUrl = new URL(page.origin);
productJsonUrl.pathname = `${match[1]}${match[2]}.js`;

const fetched = await secureFetch(productJsonUrl.toString(), {
  timeoutMs:8_000,
  maxResponseBytes:1024 * 1024,
});
const raw = await fetched.response.text();
const parsed = JSON.parse(raw) as Record<string, unknown>;
const variants = Array.isArray(parsed.variants)
  ? parsed.variants.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  : [];

const diagnostic = {
  runAt:new Date().toISOString(),
  requestedPageUrl:requestedUrl,
  requestedProductJsonUrl:productJsonUrl.toString(),
  finalUrl:fetched.finalUrl,
  httpStatus:fetched.response.status,
  bytesDownloaded:Buffer.byteLength(raw),
  product:{
    id:parsed.id,
    handle:parsed.handle,
    title:parsed.title,
    price:parsed.price,
    priceMin:parsed.price_min,
    priceMax:parsed.price_max,
    priceVaries:parsed.price_varies,
    available:parsed.available,
    options:parsed.options,
  },
  variants:variants.slice(0, 20).map((variant) => ({
    id:variant.id,
    title:variant.title,
    option1:variant.option1,
    option2:variant.option2,
    option3:variant.option3,
    price:variant.price,
    available:variant.available,
    inventoryPolicy:variant.inventory_policy,
    inventoryQuantity:variant.inventory_quantity,
  })),
};

await mkdir('artifacts/reliability/shopify-source-diagnostic', { recursive:true });
await writeFile(
  'artifacts/reliability/shopify-source-diagnostic/scindapsus-variants.json',
  `${JSON.stringify(diagnostic, null, 2)}\n`,
);
console.log(JSON.stringify(diagnostic, null, 2));
