import { parsePriceUSFirst } from '../jsonld.ts';
import type { AdapterCandidate, RetailerAdapter } from './types.ts';
import { attribute, hostnameOf, objectAtPath, scriptJson } from './helpers.ts';

function nextData(html: string) {
  return scriptJson(html, (tag) => attribute(tag, 'id') === '__NEXT_DATA__')[0];
}

function validCurrency(value: unknown) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function currencyFromProductData(productData: Record<string, unknown>, product: Record<string, unknown>) {
  const direct = validCurrency(product.currencyCode ?? product.currency);
  if (direct) return direct;
  const variants = Array.isArray(productData.variants)
    ? productData.variants.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
    : [];
  const currencies = new Set(variants.map((variant) => validCurrency(variant.currencyCode ?? variant.currency)).filter(Boolean));
  return currencies.size === 1 ? [...currencies][0] : undefined;
}

export const gymsharkAdapter: RetailerAdapter = {
  id:'gymshark',
  version:'1.0.0',
  priority:120,
  canHandle(artifact) {
    const host = hostnameOf(artifact.finalUrl);
    return (host === 'gymshark.com' || host.endsWith('.gymshark.com')) && /id=["']__NEXT_DATA__["']/i.test(artifact.html);
  },
  extract(artifact): AdapterCandidate[] {
    const data = nextData(artifact.html);
    const productData = objectAtPath(data, ['props','pageProps','productData']);
    const product = objectAtPath(data, ['props','pageProps','productData','product']);
    if (!productData || !product) return [];
    const price = parsePriceUSFirst(product.price);
    const currency = currencyFromProductData(productData, product);
    if (price === undefined || !currency) return [];
    const inStock = typeof product.inStock === 'boolean' ? product.inStock : undefined;
    const sellerName = typeof product.vendor === 'string' && product.vendor.trim() ? product.vendor.trim() : 'Gymshark';
    return [{
      price,
      currency,
      stockStatus:inStock === true ? 'IN_STOCK' : inStock === false ? 'OUT_OF_STOCK' : 'UNKNOWN',
      sellerName,
      sourceMethod:'RETAILER_ADAPTER',
      confidence:0.995,
      provenance:{
        adapterId:gymsharkAdapter.id,
        adapterVersion:gymsharkAdapter.version,
        sourcePath:'script#__NEXT_DATA__.props.pageProps.productData.product',
      },
    }];
  },
};
