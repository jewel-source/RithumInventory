const IMMICH_BASE_URL = process.env.IMMICH_BASE_URL || 'https://photos.jsi.studio/api'
const CACHE_TTL_MS = 5 * 60 * 1000

interface ImmichAsset {
  id: string
  originalFileName: string
}

interface ImmichMetadataSearchResponse {
  assets: {
    items: ImmichAsset[]
    total: number
    nextPage: string | null
  }
}

export interface ProductImageEntry {
  assetId: string
  thumbnailUrl: string
}

export interface ProductImageResult {
  found: boolean
  images?: ProductImageEntry[]
}

interface CacheEntry {
  result: ProductImageResult
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function getApiKey(): string {
  const key = process.env.IMMICH_API_KEY
  if (!key) {
    throw new Error('IMMICH_API_KEY is not configured on the server')
  }
  return key
}

async function immichFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${IMMICH_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      'x-api-key': getApiKey(),
    },
    cache: 'no-store',
  })
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? filename : filename.slice(0, idx)
}

// The library mixes two naming conventions: most SKUs use a numbered
// sequence ("SKU_001 (AA).jpg", "SKU_002 (AA).jpg", ...), but some use a
// bare primary shot plus lettered alternates ("SKU.jpeg", "SKU_ALT.jpeg",
// "SKU_ALT1.jpeg"). A match is either the bare file or anything starting
// with "SKU_".
function isSkuMatch(originalFileName: string, sku: string): boolean {
  const base = stripExtension(originalFileName)
  return base === sku || base.startsWith(`${sku}_`)
}

// Ranks a match for "which one is primary": bare file first, then by
// ascending numeric sequence, then alphabetically for non-numeric suffixes
// (e.g. "_ALT" before "_ALT1") as a deterministic last resort.
function rankKey(originalFileName: string, sku: string): [number, number, string] {
  const base = stripExtension(originalFileName)
  if (base === sku) return [0, 0, '']
  const suffix = base.slice(sku.length + 1)
  const numericMatch = suffix.match(/^(\d+)/)
  if (numericMatch) return [1, parseInt(numericMatch[1], 10), suffix]
  return [2, 0, suffix]
}

function compareRankKeys(a: [number, number, string], b: [number, number, string]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2].localeCompare(b[2])
}

/** Looks up every product photo for a SKU in Immich, ordered primary-first,
 * caching the result briefly since the same SKU is searched repeatedly. */
export async function findProductImages(sku: string): Promise<ProductImageResult> {
  const cached = cache.get(sku)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const res = await immichFetch('/search/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalFileName: sku, withDeleted: false }),
  })

  if (!res.ok) {
    throw new Error(`Immich metadata search failed (${res.status}): ${await res.text()}`)
  }

  const data = (await res.json()) as ImmichMetadataSearchResponse
  const matches = data.assets.items.filter(item => isSkuMatch(item.originalFileName, sku))

  let result: ProductImageResult
  if (matches.length === 0) {
    result = { found: false }
  } else {
    matches.sort((a, b) =>
      compareRankKeys(rankKey(a.originalFileName, sku), rankKey(b.originalFileName, sku))
    )
    result = {
      found: true,
      images: matches.map(m => ({
        assetId: m.id,
        thumbnailUrl: `/api/immich-image/${m.id}`,
      })),
    }
  }

  cache.set(sku, { result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}

/** Thin authenticated fetch for streaming an asset's bytes back through our
 * own proxy route, so the Immich API key never reaches the browser. */
export async function fetchImmichAsset(
  assetId: string,
  size: 'thumbnail' | 'preview' | 'original'
): Promise<Response> {
  if (size === 'original') return immichFetch(`/assets/${assetId}/original`)
  // 'preview' (1440px JPEG) is served off the same thumbnail endpoint as
  // 'thumbnail' (250px WebP), just with a different Immich size param.
  return immichFetch(`/assets/${assetId}/thumbnail?size=${size}`)
}
