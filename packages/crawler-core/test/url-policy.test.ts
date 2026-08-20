import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isPrivateOrLocalIp, resolvePublicHttpUrl, secureFetch, UnsafeTargetError } from '../src/url-policy.ts';

const publicResolver = async () => ['93.184.216.34'];

test('private/local address classification', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1']) assert.equal(isPrivateOrLocalIp(ip), true, ip);
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
});

test('rejects non-http, credentials, localhost and private literals', async () => {
  const cases = ['file:///etc/passwd','ftp://example.com/a','https://u:p@example.com','http://localhost/x','http://127.0.0.1','http://169.254.169.254/latest/meta-data'];
  for (const url of cases) await assert.rejects(assertPublicHttpUrl(url, publicResolver), UnsafeTargetError, url);
});

test('rejects public-looking hostname resolving private', async () => {
  await assert.rejects(assertPublicHttpUrl('https://evil.example/product', async () => ['10.0.0.9']), (e: unknown) => (e as UnsafeTargetError).code === 'PRIVATE_DNS_RESULT');
});

test('resolved target carries the exact public IP set into the transport boundary', async () => {
  const target = await resolvePublicHttpUrl('https://example.com/product', async () => ['93.184.216.34','2606:2800:220:1:248:1893:25c8:1946']);
  assert.deepEqual(target.approvedAddresses, ['93.184.216.34','2606:2800:220:1:248:1893:25c8:1946']);
});

test('secureFetch pins each request to addresses from the validation lookup and does not re-resolve inside transport', async () => {
  let resolverCalls = 0;
  const resolver = async () => {
    resolverCalls += 1;
    return resolverCalls === 1 ? ['93.184.216.34'] : ['127.0.0.1'];
  };
  const seen: string[][] = [];
  const transport = async (input: { approvedAddresses: string[] }) => {
    seen.push(input.approvedAddresses);
    return { status:200, headers:{ get:()=>null }, text:async()=>'<html></html>' };
  };
  await secureFetch('https://example.com/product', { resolver, transport });
  assert.equal(resolverCalls, 1, 'the transport must not perform a second DNS resolution');
  assert.deepEqual(seen, [['93.184.216.34']]);
});

test('secureFetch revalidates redirects and blocks redirect into private network', async () => {
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return { status: 302, headers: { get: (name: string) => name.toLowerCase() === 'location' ? 'http://127.0.0.1/admin' : null }, text: async () => '' };
  };
  await assert.rejects(secureFetch('https://example.com/product', { resolver: publicResolver, transport }), (e: unknown) => (e as UnsafeTargetError).code === 'PRIVATE_IP_BLOCKED');
  assert.equal(calls, 1);
});
