'use client'

import { useState, useEffect, FormEvent } from 'react'
import styles from './ProductSearch.module.css'
import CompanySelector from './CompanySelector'
import { CompanyKey } from '@/lib/companies'

interface RithumImage {
  PlacementName: string
  Url: string | null
}

interface RithumAttribute {
  Name: string
  Value: string | null
}

interface RithumProduct {
  ID: number
  Sku: string | null
  UPC: string | null
  Title: string | null
  TotalQuantity: number | null
  TotalAvailableQuantity: number | null
  QuantitySoldLast7Days: number | null
  QuantitySoldLast14Days: number | null
  QuantitySoldLast30Days: number | null
  QuantitySoldLast60Days: number | null
  QuantitySoldLast90Days: number | null
  Images?: RithumImage[]
  Attributes?: RithumAttribute[]
}

// The Sku field is Rithum's own product identifier and isn't always the
// vendor's style code — for some catalogs (e.g. Kohl's) it's a separate
// numeric ID. The style code that matches Immich filenames lives in these
// attributes instead, which are always equal to each other when both are set.
function getImageStyleCode(product: RithumProduct): string | null {
  const attrs = product.Attributes ?? []
  const styleAttr = attrs.find(a => a.Name === 'Image reference style #')?.Value
  const vendorAttr = attrs.find(a => a.Name === 'Vendor SKU')?.Value
  return styleAttr || vendorAttr || product.Sku || null
}

const SOLD_PERIODS: { key: keyof RithumProduct; label: string }[] = [
  { key: 'QuantitySoldLast7Days', label: 'Last 7 days' },
  { key: 'QuantitySoldLast14Days', label: 'Last 14 days' },
  { key: 'QuantitySoldLast30Days', label: 'Last 30 days' },
  { key: 'QuantitySoldLast60Days', label: 'Last 60 days' },
  { key: 'QuantitySoldLast90Days', label: 'Last 90 days' },
]

const WINDOW_LABELS: Record<string, string> = {
  '7': 'last 7 days',
  '14': 'last 14 days',
  '30': 'last 30 days',
  '60': 'last 60 days',
  '90': 'last 90 days',
}

const FILTER_FIELDS = [
  'style',
  'category',
  'color',
  'colorName',
  'ctw',
  'gemType',
  'metalType',
  'patternName',
  'rhodiumYp',
  'ringSize',
  'sizeName',
] as const
type FilterField = (typeof FILTER_FIELDS)[number]

const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  style: 'style',
  category: 'category',
  color: 'color',
  colorName: 'color name',
  ctw: 'CTW',
  gemType: 'gem type',
  metalType: 'metal type',
  patternName: 'pattern',
  rhodiumYp: 'rhodium/YP',
  ringSize: 'ring size',
  sizeName: 'size name',
}

const METRIC_LABELS: Record<string, string> = {
  sold: 'units sold',
  onHand: 'on hand',
  available: 'available',
}

type ParsedFilters = {
  intent: 'total' | 'topSelling'
  metric: string
  window: string
  allTimeCaveat?: true
} & Record<FilterField, string | null>

interface AttributeSearchProduct {
  Sku: string | null
  value: number
}

interface TotalResult {
  intent: 'total'
  total: number
  metric: string
  window?: string
  matchCount: number
  products: AttributeSearchProduct[]
}

interface TopSellingRanking {
  style: string
  total: number
  skuCount: number
  skus: AttributeSearchProduct[]
}

interface TopSellingResult {
  intent: 'topSelling'
  metric: string
  window?: string
  rankings: TopSellingRanking[]
}

type AttributeSearchResult = TotalResult | TopSellingResult

interface GalleryImage {
  thumbUrl: string
  fullUrl: string
  alt: string
}

function ImageCarousel({
  images,
  onOpen,
}: {
  images: GalleryImage[]
  onOpen: (index: number) => void
}) {
  const [index, setIndex] = useState(0)
  const current = images[index]

  function step(e: React.MouseEvent, delta: number) {
    e.stopPropagation()
    setIndex(i => Math.max(0, Math.min(images.length - 1, i + delta)))
  }

  return (
    <div className={styles.carousel}>
      <img
        src={current.thumbUrl}
        alt={current.alt}
        className={styles.image}
        onClick={() => onOpen(index)}
      />
      {images.length > 1 && (
        <>
          <button
            className={`${styles.carouselArrow} ${styles.carouselPrev}`}
            onClick={e => step(e, -1)}
            disabled={index === 0}
            aria-label="Previous image"
          >
            ‹
          </button>
          <button
            className={`${styles.carouselArrow} ${styles.carouselNext}`}
            onClick={e => step(e, 1)}
            disabled={index === images.length - 1}
            aria-label="Next image"
          >
            ›
          </button>
          <div className={styles.carouselCounter}>
            {index + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  )
}

function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: GalleryImage[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)

  function goTo(nextIndex: number) {
    setIndex(Math.max(0, Math.min(images.length - 1, nextIndex)))
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goTo(index - 1)
      else if (e.key === 'ArrowRight') goTo(index + 1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const current = images[index]

  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <div className={styles.lightboxBg} style={{ backgroundImage: `url(${current.fullUrl})` }} />

      <button className={styles.lightboxClose} onClick={onClose} aria-label="Close">
        ×
      </button>

      <div className={styles.lightboxContent} onClick={e => e.stopPropagation()}>
        {images.length > 1 && (
          <button
            className={styles.sliderBtn}
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            aria-label="Previous image"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}

        <div className={styles.slidesStage}>
          {images.map((img, i) => {
            const offset = i - index
            const abs = Math.abs(offset)
            const isCurrent = offset === 0
            const rotate = offset === 0 ? 0 : offset > 0 ? -45 : 45

            return (
              <div
                key={img.fullUrl + i}
                className={styles.slide}
                style={{
                  zIndex: 100 - abs,
                  opacity: abs <= 1 ? 1 : 0,
                  pointerEvents: abs <= 1 ? 'auto' : 'none',
                  cursor: abs === 1 ? 'pointer' : 'default',
                  transform: `perspective(1000px) translate3d(${offset * 107}%, 0, 0) rotateY(${rotate}deg) scale(${isCurrent ? 1.2 : 1})`,
                }}
                onClick={() => {
                  if (abs === 1) goTo(i)
                }}
              >
                <img
                  src={img.fullUrl}
                  alt={img.alt}
                  className={`${styles.slideImage} ${isCurrent ? styles.slideImageCurrent : ''}`}
                />
                <div className={`${styles.slideCaption} ${isCurrent ? styles.slideCaptionVisible : ''}`}>
                  {img.alt}
                </div>
              </div>
            )
          })}
        </div>

        {images.length > 1 && (
          <button
            className={styles.sliderBtn}
            onClick={() => goTo(index + 1)}
            disabled={index === images.length - 1}
            aria-label="Next image"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className={styles.lightboxCounter}>
          {index + 1} / {images.length}
        </div>
      )}
    </div>
  )
}

function ProductCard({ product }: { product: RithumProduct }) {
  const hasRithumImages = (product.Images?.length ?? 0) > 0
  const imageStyleCode = getImageStyleCode(product)
  const shouldLookupImmich = !hasRithumImages && !!imageStyleCode
  const [immichState, setImmichState] = useState<'loading' | 'found' | 'not-found'>(
    shouldLookupImmich ? 'loading' : 'not-found'
  )
  const [immichImages, setImmichImages] = useState<GalleryImage[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!shouldLookupImmich) return

    let cancelled = false

    fetch(`/api/product-image?sku=${encodeURIComponent(imageStyleCode!)}`)
      .then(res => res.json())
      .then((data: { found: boolean; images?: { assetId: string; thumbnailUrl: string }[] }) => {
        if (cancelled) return
        if (data.found && data.images && data.images.length > 0) {
          setImmichImages(
            data.images.map(img => ({
              thumbUrl: img.thumbnailUrl,
              fullUrl: `${img.thumbnailUrl}?size=original`,
              alt: imageStyleCode!,
            }))
          )
          setImmichState('found')
        } else {
          setImmichState('not-found')
        }
      })
      .catch(() => {
        if (!cancelled) setImmichState('not-found')
      })

    return () => {
      cancelled = true
    }
  }, [shouldLookupImmich, imageStyleCode])

  const images: GalleryImage[] = hasRithumImages
    ? (product.Images ?? [])
        .filter((img): img is RithumImage & { Url: string } => !!img.Url)
        .map(img => ({ thumbUrl: img.Url, fullUrl: img.Url, alt: img.PlacementName }))
    : immichImages

  return (
    <div className={styles.card}>
      <div className={styles.images}>
        {images.length > 0 ? (
          <ImageCarousel images={images} onOpen={setLightboxIndex} />
        ) : immichState === 'loading' ? (
          <div className={`${styles.noImage} ${styles.skeleton}`} />
        ) : (
          <div className={styles.noImage}>No images</div>
        )}
      </div>

      {lightboxIndex !== null && images.length > 0 && (
        <ImageLightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <div className={styles.details}>
        <h2 className={styles.title}>{product.Title ?? '(no title)'}</h2>
        <p className={styles.sku}>
          SKU: {product.Sku ?? '—'}
          {product.UPC && <> · UPC: {product.UPC}</>}
        </p>

        <div className={styles.quantities}>
          <div>
            <span className={styles.label}>On hand</span>
            <span className={styles.value}>{product.TotalQuantity ?? '—'}</span>
          </div>
          <div>
            <span className={styles.label}>Available</span>
            <span className={styles.value}>{product.TotalAvailableQuantity ?? '—'}</span>
          </div>
        </div>

        <table className={styles.soldTable}>
          <thead>
            <tr>
              <th>Period</th>
              <th>Units Sold</th>
            </tr>
          </thead>
          <tbody>
            {SOLD_PERIODS.map(({ key, label }) => (
              <tr key={key}>
                <td>{label}</td>
                <td>{(product[key] as number | null) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ProductSearch() {
  const [company, setCompany] = useState<CompanyKey | null>(null)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<RithumProduct[]>([])
  const [notFound, setNotFound] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [parsedFilters, setParsedFilters] = useState<ParsedFilters | null>(null)
  const [askResult, setAskResult] = useState<AttributeSearchResult | null>(null)

  async function handleAskSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed) return

    if (!company) {
      setAskError("Select Kohl's or Macy's first")
      return
    }

    setAskLoading(true)
    setAskError(null)
    setParsedFilters(null)
    setAskResult(null)

    try {
      const parseRes = await fetch('/api/parse-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      })
      const parseData = await parseRes.json()

      if (!parseRes.ok) {
        setAskError(parseData.error || 'Could not understand that question')
        return
      }

      const filters: ParsedFilters = parseData
      setParsedFilters(filters)

      const searchParams = new URLSearchParams({
        company,
        intent: filters.intent,
        metric: filters.metric,
      })
      if (filters.metric === 'sold') searchParams.set('window', filters.window)
      for (const field of FILTER_FIELDS) {
        const value = filters[field]
        if (value) searchParams.set(field, value)
      }

      const searchRes = await fetch(`/api/attribute-search?${searchParams.toString()}`)
      const searchData = await searchRes.json()

      if (!searchRes.ok) {
        setAskError(searchData.error || 'No matching products found')
        return
      }

      setAskResult(searchData)
    } catch {
      setAskError('Failed to reach the server')
    } finally {
      setAskLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    if (!company) {
      setError("Select Kohl's or Macy's first")
      return
    }

    setLoading(true)
    setError(null)
    setProducts([])
    setNotFound([])

    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(trimmed)}?company=${company}`
      )
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setNotFound(data.notFound ?? [])
        return
      }

      setProducts(data.products)
      setNotFound(data.notFound ?? [])
    } catch {
      setError('Failed to reach the server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrapper}>
      <CompanySelector value={company} onChange={setCompany} />

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          className={styles.input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Enter SKU, UPC, or Vendor SKU — separate multiple with commas..."
          disabled={!company}
          autoFocus
        />
        <button className={styles.button} type="submit" disabled={loading || !company}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {notFound.length > 0 && (
        <p className={styles.warning}>No match for: {notFound.join(', ')}</p>
      )}

      {products.length > 0 && (
        <div className={styles.results}>
          {products.map(product => (
            <ProductCard key={product.ID} product={product} />
          ))}
        </div>
      )}

      <div className={styles.askSection}>
        <h3 className={styles.askHeading}>Ask a question</h3>
        <form onSubmit={handleAskSubmit} className={styles.form}>
          <input
            className={styles.input}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. How many size 6 rings sold in the last 30 days for style AAR200A0827YP, 2.00 CTW?"
            disabled={!company}
          />
          <button className={styles.button} type="submit" disabled={askLoading || !company}>
            {askLoading ? 'Thinking…' : 'Ask'}
          </button>
        </form>

        {askError && <p className={styles.error}>{askError}</p>}

        {parsedFilters && (
          <>
            <p className={styles.parsedFilters}>
              {parsedFilters.intent === 'topSelling' ? 'Ranking top sellers' : 'Understood'}
              {FILTER_FIELDS.filter(f => parsedFilters[f]).map(f => (
                <span key={f}>
                  , {FILTER_FIELD_LABELS[f]} <strong>{parsedFilters[f]}</strong>
                </span>
              ))}
              , {METRIC_LABELS[parsedFilters.metric] ?? parsedFilters.metric}
              {parsedFilters.metric === 'sold' && (
                <> ({WINDOW_LABELS[parsedFilters.window] ?? `${parsedFilters.window} days`})</>
              )}
            </p>
            {parsedFilters.allTimeCaveat && (
              <p className={styles.caveat}>
                Rithum doesn&apos;t provide a lifetime total — showing the last 90 days, the
                longest window available.
              </p>
            )}
          </>
        )}

        {askResult && askResult.intent === 'total' && (
          <div className={styles.askResult}>
            <p className={styles.askTotal}>
              <span className={styles.value}>{askResult.total}</span>{' '}
              {METRIC_LABELS[askResult.metric] ?? askResult.metric}
              {askResult.window && (
                <> ({WINDOW_LABELS[askResult.window] ?? `${askResult.window} days`})</>
              )}{' '}
              across {askResult.matchCount} matching SKU{askResult.matchCount === 1 ? '' : 's'}
            </p>
            <table className={styles.soldTable}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>{METRIC_LABELS[askResult.metric] ?? askResult.metric}</th>
                </tr>
              </thead>
              <tbody>
                {askResult.products.map(p => (
                  <tr key={p.Sku}>
                    <td>{p.Sku ?? '—'}</td>
                    <td>{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {askResult && askResult.intent === 'topSelling' && (
          <div className={styles.askResult}>
            <table className={styles.soldTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Style</th>
                  <th>{METRIC_LABELS[askResult.metric] ?? askResult.metric}</th>
                  <th>SKUs</th>
                </tr>
              </thead>
              <tbody>
                {askResult.rankings.map((r, i) => (
                  <tr key={r.style} className={i === 0 ? styles.topRank : undefined}>
                    <td>{i + 1}</td>
                    <td>{r.style}</td>
                    <td>{r.total}</td>
                    <td>{r.skuCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
