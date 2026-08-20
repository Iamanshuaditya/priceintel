import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/packages/db', { recursive:true });
await cp('packages/db/migrations', 'dist/packages/db/migrations', { recursive:true });
