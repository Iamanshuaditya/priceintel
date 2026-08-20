export type ListingHealth =
  | 'HEALTHY'
  | 'STALE'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'PARSE_FAILED'
  | 'PAGE_MISSING'
  | 'NEEDS_REVIEW';

export type SourceMethod = 'JSON_LD' | 'RETAILER_ADAPTER' | 'GENERIC_DOM' | 'BROWSER';
export type StockStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';

export interface Workspace { id: string; name: string }
export interface Product {
  id: string;
  workspaceId: string;
  sku: string;
  title: string;
  currentPrice?: number;
  currency: string;
}
export interface CompetitorListing {
  id: string;
  workspaceId: string;
  productId: string;
  url: string;
  retailer: string;
  health: ListingHealth;
  lastCrawlAt?: Date;
  lastSuccessfulCrawlAt?: Date;
  failureCount: number;
  lastFailureCode?: string;
}
export interface PriceObservation {
  id: string;
  workspaceId: string;
  productId: string;
  competitorListingId: string;
  fetchedAt: Date;
  verifiedAt: Date;
  currency: string;
  price: number;
  stockStatus: StockStatus;
  sellerName?: string;
  sourceMethod: SourceMethod;
  extractorVersion: string;
  confidence: number;
  crawlRunId: string;
}
export interface ChangeEvent {
  type: 'PRICE_CHANGED' | 'STOCK_CHANGED';
  listingId: string;
  previousObservationId: string;
  observationId: string;
  previousValue: number | StockStatus;
  currentValue: number | StockStatus;
}

export class TenantBoundaryError extends Error {
  constructor(message = 'Entity does not belong to workspace') {
    super(message);
    this.name = 'TenantBoundaryError';
  }
}

function assertWorkspace(entityWorkspaceId: string, workspaceId: string) {
  if (entityWorkspaceId !== workspaceId) throw new TenantBoundaryError();
}

export class InMemoryMonitoringStore {
  #workspaces = new Map<string, Workspace>();
  #products = new Map<string, Product>();
  #listings = new Map<string, CompetitorListing>();
  #observations: PriceObservation[] = [];
  #changes: ChangeEvent[] = [];

  createWorkspace(workspace: Workspace) {
    if (this.#workspaces.has(workspace.id)) throw new Error('Workspace already exists');
    this.#workspaces.set(workspace.id, workspace);
    return workspace;
  }

  createProduct(workspaceId: string, product: Product) {
    assertWorkspace(product.workspaceId, workspaceId);
    if (!this.#workspaces.has(workspaceId)) throw new Error('Workspace not found');
    if (this.#products.has(product.id)) throw new Error('Product already exists');
    this.#products.set(product.id, product);
    return product;
  }

  createListing(workspaceId: string, listing: CompetitorListing) {
    assertWorkspace(listing.workspaceId, workspaceId);
    const product = this.#products.get(listing.productId);
    if (!product) throw new Error('Product not found');
    assertWorkspace(product.workspaceId, workspaceId);
    if (this.#listings.has(listing.id)) throw new Error('Listing already exists');
    this.#listings.set(listing.id, listing);
    return listing;
  }

  getListing(workspaceId: string, listingId: string) {
    const listing = this.#listings.get(listingId);
    if (!listing) return undefined;
    assertWorkspace(listing.workspaceId, workspaceId);
    return structuredClone(listing);
  }

  getObservations(workspaceId: string, listingId: string) {
    const listing = this.#listings.get(listingId);
    if (!listing) return [];
    assertWorkspace(listing.workspaceId, workspaceId);
    return this.#observations
      .filter((o) => o.competitorListingId === listingId)
      .map((o) => structuredClone(o));
  }

  getChanges(workspaceId: string, listingId: string) {
    const listing = this.#listings.get(listingId);
    if (!listing) return [];
    assertWorkspace(listing.workspaceId, workspaceId);
    return this.#changes.filter((c) => c.listingId === listingId).map((c) => structuredClone(c));
  }

  recordSuccessfulObservation(workspaceId: string, observation: PriceObservation) {
    assertWorkspace(observation.workspaceId, workspaceId);
    const listing = this.#listings.get(observation.competitorListingId);
    if (!listing) throw new Error('Listing not found');
    assertWorkspace(listing.workspaceId, workspaceId);
    if (listing.productId !== observation.productId) throw new Error('Observation product/listing mismatch');

    if (this.#observations.some((o) => o.id === observation.id || o.crawlRunId === observation.crawlRunId)) {
      return { inserted: false as const, reason: 'DUPLICATE_OBSERVATION' as const };
    }
    const prior = [...this.#observations].reverse().find((o) => o.competitorListingId === listing.id);
    this.#observations.push(structuredClone(observation));

    if (prior && prior.price !== observation.price) {
      this.#changes.push({
        type: 'PRICE_CHANGED', listingId: listing.id,
        previousObservationId: prior.id, observationId: observation.id,
        previousValue: prior.price, currentValue: observation.price,
      });
    }
    if (prior && prior.stockStatus !== observation.stockStatus) {
      this.#changes.push({
        type: 'STOCK_CHANGED', listingId: listing.id,
        previousObservationId: prior.id, observationId: observation.id,
        previousValue: prior.stockStatus, currentValue: observation.stockStatus,
      });
    }

    listing.lastCrawlAt = new Date(observation.fetchedAt);
    listing.lastSuccessfulCrawlAt = new Date(observation.verifiedAt);
    listing.health = 'HEALTHY';
    listing.failureCount = 0;
    delete listing.lastFailureCode;
    return { inserted: true as const };
  }

  recordFailure(workspaceId: string, listingId: string, at: Date, code: string, health: ListingHealth = 'DEGRADED') {
    const listing = this.#listings.get(listingId);
    if (!listing) throw new Error('Listing not found');
    assertWorkspace(listing.workspaceId, workspaceId);
    listing.lastCrawlAt = new Date(at);
    listing.failureCount += 1;
    listing.lastFailureCode = code;
    listing.health = health;
  }
}
