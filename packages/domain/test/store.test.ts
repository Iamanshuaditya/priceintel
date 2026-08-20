import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMonitoringStore, TenantBoundaryError } from '../src/index.ts';
import type { PriceObservation } from '../src/index.ts';

test('tenant boundary rejects cross-workspace reads', () => {
  const store = new InMemoryMonitoringStore();
  store.createWorkspace({ id: 'a', name: 'A' });
  store.createWorkspace({ id: 'b', name: 'B' });
  store.createProduct('a', { id: 'p', workspaceId: 'a', sku: 'S', title: 'Product', currency: 'USD' });
  store.createListing('a', { id: 'l', workspaceId: 'a', productId: 'p', url: 'https://example.com/p', retailer: 'example.com', health: 'STALE', failureCount: 0 });
  assert.throws(() => store.getListing('b', 'l'), TenantBoundaryError);
});

test('failure never advances last successful crawl or appends history', () => {
  const store = new InMemoryMonitoringStore();
  store.createWorkspace({ id: 'a', name: 'A' });
  store.createProduct('a', { id: 'p', workspaceId: 'a', sku: 'S', title: 'Product', currency: 'USD' });
  store.createListing('a', { id: 'l', workspaceId: 'a', productId: 'p', url: 'https://example.com/p', retailer: 'example.com', health: 'STALE', failureCount: 0 });
  const t1 = new Date('2026-08-20T00:00:00Z');
  store.recordSuccessfulObservation('a', { id:'o1', workspaceId:'a', productId:'p', competitorListingId:'l', fetchedAt:t1, verifiedAt:t1, currency:'USD', price:100, stockStatus:'IN_STOCK', sourceMethod:'JSON_LD', extractorVersion:'jsonld-v1', confidence:0.95, crawlRunId:'r1' });
  store.recordFailure('a', 'l', new Date('2026-08-20T01:00:00Z'), 'PARSE_FAILED', 'PARSE_FAILED');
  assert.equal(store.getObservations('a','l').length, 1);
  assert.equal(store.getListing('a','l')?.lastSuccessfulCrawlAt?.toISOString(), t1.toISOString());
  assert.equal(store.getListing('a','l')?.health, 'PARSE_FAILED');
});

test('duplicate crawl/observation ingestion is idempotent', () => {
  const store = new InMemoryMonitoringStore();
  store.createWorkspace({ id: 'a', name: 'A' });
  store.createProduct('a', { id: 'p', workspaceId: 'a', sku: 'S', title: 'Product', currency: 'USD' });
  store.createListing('a', { id: 'l', workspaceId: 'a', productId: 'p', url: 'https://example.com/p', retailer: 'example.com', health: 'STALE', failureCount: 0 });
  const at = new Date('2026-08-20T00:00:00Z');
  const observation: PriceObservation = { id:'o1', workspaceId:'a', productId:'p', competitorListingId:'l', fetchedAt:at, verifiedAt:at, currency:'USD', price:100, stockStatus:'IN_STOCK', sourceMethod:'JSON_LD', extractorVersion:'jsonld-v1', confidence:0.95, crawlRunId:'r1' };
  assert.equal(store.recordSuccessfulObservation('a', observation).inserted, true);
  assert.equal(store.recordSuccessfulObservation('a', observation).inserted, false);
  assert.equal(store.getObservations('a','l').length, 1);
  assert.equal(store.getChanges('a','l').length, 0);
});

test('global entity IDs cannot be silently overwritten across workspaces', () => {
  const store = new InMemoryMonitoringStore();
  store.createWorkspace({ id: 'a', name: 'A' });
  store.createWorkspace({ id: 'b', name: 'B' });
  store.createProduct('a', { id: 'p', workspaceId: 'a', sku: 'A', title: 'A', currency: 'USD' });
  assert.throws(() => store.createProduct('b', { id: 'p', workspaceId: 'b', sku: 'B', title: 'B', currency: 'USD' }), /already exists/);
});
