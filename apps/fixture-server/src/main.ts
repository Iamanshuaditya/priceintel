import { createFixtureServer } from './server.ts';
const fixture = createFixtureServer();
const baseUrl = await fixture.listen();
console.log(`Fixture commerce server: ${baseUrl}`);
console.log(`Product: ${baseUrl}/product/jsonld`);
process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
