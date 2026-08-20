import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAutomatedSourceAccess, evaluateAutomatedSourceAccess } from '../src/source-access-policy.ts';

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
