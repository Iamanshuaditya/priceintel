import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpUrl, isPrivateOrLocalIp, secureFetch, UnsafeTargetError } from '../src/url-policy.ts';

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

test('accepts public HTTPS target', async () => {
  const url = await assertPublicHttpUrl('https://example.com/product', publicResolver);
  assert.equal(url.hostname, 'example.com');
});

test('secureFetch revalidates redirects and blocks redirect into private network', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { status: 302, headers: { get: (name: string) => name.toLowerCase() === 'location' ? 'http://127.0.0.1/admin' : null }, text: async () => '' };
  };
  await assert.rejects(secureFetch('https://example.com/product', { resolver: publicResolver, fetchImpl }), (e: unknown) => (e as UnsafeTargetError).code === 'PRIVATE_IP_BLOCKED');
  assert.equal(calls, 1);
});
