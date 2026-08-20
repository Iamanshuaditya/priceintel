export interface ReliabilityEconomicsAttempt {
  bytesDownloaded: number;
  supplementaryBytes: number;
  supplementaryRequestCount: number;
  totalDurationMs: number;
}

export interface ReliabilityCostRates {
  requestCostUsd?: number;
  egressGbCostUsd?: number;
}

function nonNegative(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function computeReliabilityEconomics(
  attempts: ReliabilityEconomicsAttempt[],
  rates: ReliabilityCostRates = {},
) {
  const urls = attempts.length;
  const totalPrimaryBytes = attempts.reduce((sum, item) => sum + item.bytesDownloaded, 0);
  const totalSupplementaryBytes = attempts.reduce((sum, item) => sum + item.supplementaryBytes, 0);
  const totalDownloadedBytes = totalPrimaryBytes + totalSupplementaryBytes;
  const totalHttpRequests = attempts.reduce((sum, item) => sum + 1 + item.supplementaryRequestCount, 0);
  const totalCrawlMs = attempts.reduce((sum, item) => sum + item.totalDurationMs, 0);
  const requestCostUsd = nonNegative(rates.requestCostUsd);
  const egressGbCostUsd = nonNegative(rates.egressGbCostUsd);
  const costModelConfigured = requestCostUsd !== undefined && egressGbCostUsd !== undefined;
  const estimatedCostUsd = costModelConfigured
    ? totalHttpRequests * requestCostUsd + (totalDownloadedBytes / 1024 ** 3) * egressGbCostUsd
    : null;

  return {
    urls,
    totalPrimaryBytes,
    totalSupplementaryBytes,
    totalDownloadedBytes,
    totalDownloadedMiB:round(totalDownloadedBytes / 1024 ** 2, 3),
    totalHttpRequests,
    totalCrawlMs,
    meanBytesPerUrl:urls ? round(totalDownloadedBytes / urls, 2) : 0,
    meanHttpRequestsPerUrl:urls ? round(totalHttpRequests / urls, 3) : 0,
    meanCrawlMsPerUrl:urls ? round(totalCrawlMs / urls, 2) : 0,
    costModelConfigured,
    requestCostUsd:requestCostUsd ?? null,
    egressGbCostUsd:egressGbCostUsd ?? null,
    estimatedCostUsd:estimatedCostUsd === null ? null : round(estimatedCostUsd, 8),
    estimatedCostPerUrlUsd:estimatedCostUsd === null || !urls ? null : round(estimatedCostUsd / urls, 8),
  };
}
