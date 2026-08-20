import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAutomatedSourceAccess, assertAutomatedSourceAccess } from '../src/source-access-policy.ts';
import {
  sourcePolicies,
  sourcePolicyConflicts,
  sourcePolicyForId,
  sourcePolicyForUrl,
  type SourcePolicy,
} from '../src/source-governance.ts';
import { secureFetch } from '../src/url-policy.ts';

const PUBLIC_IP = '93.184.216.34';

function response(status = 200) {
  return {
    status,
    headers:{ get:() => null },
    text:async () => '',
  };
}

test('source registry has no hostname/method ambiguity and every policy has an explicit method scope', () => {
  assert.deepEqual(sourcePolicyConflicts(), [], 'registry policy selection must never depend on array order');
  for (const policy of sourcePolicies) {
    assert.ok(policy.appliesToMethods.length > 0, `${policy.sourceId} must declare appliesToMethods`);
    for (const permitted of policy.permittedMethods) {
      assert.ok(policy.appliesToMethods.includes(permitted), `${policy.sourceId} cannot permit a method outside its policy scope`);
    }
  }
});

test('conflict detector rejects overlapping host policies with intersecting method scope', () => {
  const base = {
    status:'NOT_APPROVED',
    permittedMethods:[],
    basis:'PUBLIC_TERMS_REVIEW',
    reviewedAt:'2026-08-21',
    evidenceReference:'fixture.md',
    reason:'fixture',
  } as const;
  const fixtures: SourcePolicy[] = [
    {
      ...base,
      sourceId:'FIXTURE_PARENT',
      hostnamePatterns:['*.example.com'],
      appliesToMethods:['PUBLIC_HTTP'],
    },
    {
      ...base,
      sourceId:'FIXTURE_CHILD',
      hostnamePatterns:['api.example.com'],
      appliesToMethods:['PUBLIC_HTTP'],
    },
  ];
  const conflicts = sourcePolicyConflicts(fixtures);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.sourceIds, ['FIXTURE_PARENT','FIXTURE_CHILD']);
  assert.deepEqual(conflicts[0]?.methods, ['PUBLIC_HTTP']);
});

test("Lowe's public web and partner catalog API select by method, not registry order", () => {
  const apiUrl = 'https://apis-b2b.lowes.com/lowesx-marketplace-gateway/api/v1/products/details';

  assert.equal(sourcePolicyForUrl(apiUrl, 'PUBLIC_HTTP')?.sourceId, 'LOWES_PUBLIC_WEB');
  assert.equal(sourcePolicyForUrl(apiUrl, 'RETAILER_API')?.sourceId, 'LOWES_PARTNER_CATALOG_API');

  const publicApiHost = evaluateAutomatedSourceAccess(apiUrl, 'PUBLIC_HTTP');
  assert.equal(publicApiHost.allowed, false);
  assert.equal(publicApiHost.sourceId, 'LOWES_PUBLIC_WEB');
  assert.equal(publicApiHost.code, 'SOURCE_NOT_APPROVED');

  const partnerApi = evaluateAutomatedSourceAccess(apiUrl, 'RETAILER_API');
  assert.equal(partnerApi.allowed, false);
  assert.equal(partnerApi.sourceId, 'LOWES_PARTNER_CATALOG_API');
  assert.equal(partnerApi.status, 'REVIEW_REQUIRED');
  assert.equal(partnerApi.code, 'SOURCE_REVIEW_REQUIRED');
  assert.equal(partnerApi.nextAction, 'MANUAL_REVIEW');
});

test("Lowe's Marketplace seller API remains research-only until its runtime endpoint and rights are verified", () => {
  assert.equal(sourcePolicyForId('LOWES_MARKETPLACE_SELLER_API'), undefined);
});

test("Lowe's public web is rejected before DNS or transport", async () => {
  let resolverCalls = 0;
  let transportCalls = 0;

  await assert.rejects(
    secureFetch('https://www.lowes.com/pd/example/123', {
      authorizeTarget:assertAutomatedSourceAccess,
      resolver:async () => { resolverCalls += 1; return [PUBLIC_IP]; },
      transport:async () => { transportCalls += 1; return response(); },
    }),
    (error: unknown) => {
      const value = error as {code?:string;sourceId?:string};
      return value.code === 'SOURCE_NOT_APPROVED' && value.sourceId === 'LOWES_PUBLIC_WEB';
    },
  );

  assert.equal(resolverCalls, 0, "Lowe's public-web policy must run before DNS");
  assert.equal(transportCalls, 0, "Lowe's public web must never reach transport");
});
