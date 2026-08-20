import test from 'node:test';
import assert from 'node:assert/strict';
import { collectHtmlDiagnosticEvidence } from '../src/evidence.ts';

test('diagnostic evidence stores structure and hashes without storing raw script bodies', () => {
  const html = `<!doctype html><html><head>
    <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"price":99,"currency":"USD","description":"do not retain this"}}}}</script>
    <script src="https://cdn.example.com/app.js"></script>
  </head><body></body></html>`;
  const evidence = collectHtmlDiagnosticEvidence(html);
  assert.equal(evidence.bytes, Buffer.byteLength(html));
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.markers.nextData, true);
  assert.equal(evidence.scriptCount, 2);
  assert.deepEqual(evidence.scripts[0].jsonTopLevelKeys, ['props']);
  assert.equal(evidence.scripts[0].jsonRoot, 'object');
  assert.deepEqual(evidence.scripts[0].commerceSignals, [
    { path:'props.pageProps.product.price', value:99 },
    { path:'props.pageProps.product.currency', value:'USD' },
  ]);
  assert.equal(evidence.externalScriptHosts[0], 'cdn.example.com');
  assert.equal('body' in evidence.scripts[0], false, 'raw script content must not be retained');
  assert.equal(JSON.stringify(evidence).includes('do not retain this'), false, 'non-commerce text must not leak into diagnostics');
});
