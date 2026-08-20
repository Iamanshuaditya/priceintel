import http from 'node:http';

export interface FixtureState { price: number; stock: boolean; seller: string; malformed: boolean }
export function createFixtureServer(initial: Partial<FixtureState> = {}) {
  let state: FixtureState = { price: 99.99, stock: true, seller: 'Example Seller', malformed: false, ...initial };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify({ok:true})); }
    if (req.method === 'GET' && url.pathname === '/product/jsonld') {
      const body = state.malformed
        ? '<html><script type="application/ld+json">{broken</script></html>'
        : `<html><body><h1>Fixture Product</h1><script type="application/ld+json">${JSON.stringify({ '@context':'https://schema.org','@type':'Product',name:'Fixture Product',offers:{'@type':'Offer',price:state.price.toFixed(2),priceCurrency:'USD',availability:state.stock?'https://schema.org/InStock':'https://schema.org/OutOfStock',seller:{'@type':'Organization',name:state.seller}} })}</script></body></html>`;
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(body);
    }
    if (req.method === 'POST' && url.pathname === '/admin/state') {
      let raw=''; for await (const chunk of req) raw += chunk;
      const patch = JSON.parse(raw || '{}'); state = { ...state, ...patch };
      res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(state));
    }
    res.writeHead(404, {'content-type':'text/plain'}); res.end('Not found');
  });
  return {
    server,
    getState: () => ({...state}),
    setState: (patch: Partial<FixtureState>) => { state = {...state, ...patch}; },
    async listen() {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture server failed to bind');
      return `http://127.0.0.1:${address.port}`;
    },
    async close() { await new Promise<void>((resolve,reject) => server.close((err) => err ? reject(err) : resolve())); },
  };
}
