import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAdapterSupplements } from '../src/adapters/registry.ts';
import type { FetchArtifact } from '../src/adapters/types.ts';
import { assertAutomatedSourceAccess, evaluateAutomatedSourceAccess } from '../src/source-access-policy.ts';
import { secureFetch, type PinnedTransport } from '../src/url-policy.ts';

const PUBLIC_IP = '93.184.216.34';

function response(status: number, location?: string, body = '') {
  return {
    status,
    headers:{ get:(name: string) => name.toLowerCase() === 'location' ? location ?? null : null },
    text:async () => body,
  };
}

function artifact(url: string, html: string, input: Partial<FetchArtifact> = {}): FetchArtifact {
  return {
    requestedUrl:url,
    finalUrl:input.finalUrl ?? url,
    html,
    fetchedAt:input.fetchedAt ?? new Date('2026-08-21T00:00:00Z'),
    status:input.status ?? 200,
    contentType:input.contentType ?? 'text/html',
    bytesDownloaded:input.bytesDownloaded ?? Buffer.byteLength(html),
  };
}

test('Best Buy public web is failed closed pending an approved source agreement', () => {
  const direct = evaluateAutomatedSourceAccess('https://www.bestbuy.com/site/example/123.p');
  assert.deepEqual(direct, {
    allowed:false,
    sourceId:'BESTBUY_PUBLIC_WEB',
    code:'SOURCE_NOT_APPROVED',
    nextAction:'MANUAL_REVIEW',
    reason:'Best Buy automated source requires explicit written/licensed approval for PriceIntel use',
  });
  assert.equal(evaluateAutomatedSourceAccess('https://images.bestbuy.com/example').allowed, false);
  assert.throws(
    () => assertAutomatedSourceAccess('https://bestbuy.com/site/example/123.p'),
    (error: unknown) => {
      const value = error as {code?:string;sourceId?:string;nextAction?:string};
      return value.code === 'SOURCE_NOT_APPROVED'
        && value.sourceId === 'BESTBUY_PUBLIC_WEB'
        && value.nextAction === 'MANUAL_REVIEW';
    },
  );
});

test('source approval gate does not block unrelated retailers', () => {
  assert.deepEqual(evaluateAutomatedSourceAccess('https://example.com/products/widget'), { allowed:true });
  assert.doesNotThrow(() => assertAutomatedSourceAccess('https://www.gymshark.com/products/widget'));
});

test('direct unapproved source is rejected before DNS or transport', async () => {
  let resolverCalls = 0;
  let transportCalls = 0;
  await assert.rejects(
    secureFetch('https://www.bestbuy.com/site/product/123.p', {
      authorizeTarget:assertAutomatedSourceAccess,
      resolver:async () => { resolverCalls += 1; return [PUBLIC_IP]; },
      transport:async () => { transportCalls += 1; return response(200); },
    }),
    (error: unknown) => (error as {code?:string}).code === 'SOURCE_NOT_APPROVED',
  );
  assert.equal(resolverCalls, 0, 'authorization must run before DNS');
  assert.equal(transportCalls, 0, 'unapproved direct target must never reach transport');
});

test('allowed source redirecting to unapproved source never contacts redirect destination', async () => {
  const resolvedHosts: string[] = [];
  const transportedHosts: string[] = [];
  const transport: PinnedTransport = async (input) => {
    transportedHosts.push(input.url.hostname);
    return response(302, 'https://www.bestbuy.com/site/redirected/123.p');
  };

  await assert.rejects(
    secureFetch('https://allowed.example/product', {
      authorizeTarget:assertAutomatedSourceAccess,
      resolver:async (hostname) => { resolvedHosts.push(hostname); return [PUBLIC_IP]; },
      transport,
    }),
    (error: unknown) => (error as {code?:string}).code === 'SOURCE_NOT_APPROVED',
  );

  assert.deepEqual(resolvedHosts, ['allowed.example']);
  assert.deepEqual(transportedHosts, ['allowed.example']);
});

test('supplementary fetch redirect to unapproved source is stopped before destination contact', async () => {
  const primary = artifact(
    'https://fixture-shop.example/products/widget',
    '<meta property="og:price:currency" content="USD"><script>Shopify.theme={}</script>',
  );
  const resolvedHosts: string[] = [];
  const transportedHosts: string[] = [];
  const transport: PinnedTransport = async (input) => {
    transportedHosts.push(input.url.hostname);
    if (input.url.hostname === 'fixture-shop.example') {
      return response(302, 'https://www.bestbuy.com/site/supplement/123.p');
    }
    throw new Error(`unexpected transport contact: ${input.url.hostname}`);
  };

  const result = await extractWithAdapterSupplements(primary, async (request) => {
    const fetched = await secureFetch(request.url, {
      authorizeTarget:assertAutomatedSourceAccess,
      resolver:async (hostname) => { resolvedHosts.push(hostname); return [PUBLIC_IP]; },
      transport,
    });
    const html = await fetched.response.text();
    return artifact(request.url, html, {
      finalUrl:fetched.finalUrl,
      status:fetched.response.status,
      contentType:'application/json',
      bytesDownloaded:Buffer.byteLength(html),
    });
  });

  assert.deepEqual(resolvedHosts, ['fixture-shop.example']);
  assert.deepEqual(transportedHosts, ['fixture-shop.example']);
  const denied = result.supplementaryAttempts?.find((attempt) => attempt.errorCode === 'SOURCE_NOT_APPROVED');
  assert.ok(denied, 'supplementary redirect denial must remain visible in extraction evidence');
});

test('normal redirects between approved sources remain allowed', async () => {
  const authorized: string[] = [];
  const transported: string[] = [];
  const transport: PinnedTransport = async (input) => {
    transported.push(input.url.hostname);
    if (input.url.hostname === 'approved-one.example') {
      return response(302, 'https://approved-two.example/final');
    }
    return response(200, undefined, '<html>ok</html>');
  };

  const result = await secureFetch('https://approved-one.example/start', {
    authorizeTarget:(url) => {
      authorized.push(new URL(url).hostname);
      assertAutomatedSourceAccess(url);
    },
    resolver:async () => [PUBLIC_IP],
    transport,
  });

  assert.deepEqual(authorized, ['approved-one.example','approved-two.example']);
  assert.deepEqual(transported, ['approved-one.example','approved-two.example']);
  assert.equal(result.finalUrl, 'https://approved-two.example/final');
  assert.equal(result.redirectCount, 1);
});
