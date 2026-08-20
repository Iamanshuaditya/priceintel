import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBrowserEgressConfigured,
  browserContextSecurityOptions,
  enforceBrowserHttpRoute,
  evaluateBrowserHttpRequest,
  evaluateBrowserWebSocketRequest,
} from '../src/browser-network-policy.ts';

test('browser HTTP policy allows public DNS and carries the approved set for audit', async () => {
  const decision = await evaluateBrowserHttpRequest('https://shop.example/product', async () => ['93.184.216.34']);
  assert.equal(decision.action, 'ALLOW');
  assert.deepEqual(decision.approvedAddresses, ['93.184.216.34']);
});

test('browser HTTP policy blocks private DNS, localhost, metadata and non-http schemes', async () => {
  assert.equal((await evaluateBrowserHttpRequest('https://shop.example/product', async () => ['10.0.0.8'])).action, 'BLOCK');
  assert.equal((await evaluateBrowserHttpRequest('http://localhost/admin', async () => ['127.0.0.1'])).action, 'BLOCK');
  assert.equal((await evaluateBrowserHttpRequest('http://169.254.169.254/latest/meta-data')).action, 'BLOCK');
  assert.equal((await evaluateBrowserHttpRequest('file:///etc/passwd')).action, 'BLOCK');
});

test('browser websocket policy applies the same destination classification', async () => {
  const publicDecision = await evaluateBrowserWebSocketRequest('wss://stream.example/socket', async () => ['93.184.216.34']);
  const privateDecision = await evaluateBrowserWebSocketRequest('ws://internal.example/socket', async () => ['192.168.1.5']);
  assert.equal(publicDecision.action, 'ALLOW');
  assert.equal(privateDecision.action, 'BLOCK');
});

test('route guard aborts blocked requests and continues approved requests', async () => {
  const calls: string[] = [];
  const route = (url: string) => ({
    request: () => ({ url: () => url }),
    abort: async () => { calls.push('abort'); },
    continue: async () => { calls.push('continue'); },
  });
  await enforceBrowserHttpRoute(route('https://public.example'), async () => ['93.184.216.34']);
  await enforceBrowserHttpRoute(route('https://private.example'), async () => ['127.0.0.1']);
  assert.deepEqual(calls, ['continue','abort']);
});

test('browser contexts block service workers and production requires an external egress deny invariant', () => {
  assert.equal(browserContextSecurityOptions.serviceWorkers, 'block');
  assert.throws(
    () => assertBrowserEgressConfigured({ NODE_ENV:'production' }),
    (error: unknown) => (error as {code?:string}).code === 'BROWSER_EGRESS_POLICY_REQUIRED',
  );
  assert.doesNotThrow(() => assertBrowserEgressConfigured({ NODE_ENV:'production', BROWSER_EGRESS_PRIVATE_DENY:'1' }));
});
