'use client'

import { useState, FormEvent } from 'react'
import styles from './ProductSearch.module.css'
import CompanySelector from './CompanySelector'
import { CompanyKey } from '@/lib/companies'

interface RithumImage {
  PlacementName: string
  Url: string | null
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

function ProductCard({ product }: { product: RithumProduct }) {
  return (
    <div className={styles.card}>
      <div className={styles.images}>
        {product.Images && product.Images.length > 0 ? (
          product.Images.map(img => (
            <img
              key={img.PlacementName}
              src={img.Url ?? undefined}
              alt={img.PlacementName}
              className={styles.image}
            />
          ))
        ) : (
          <div className={styles.noImage}>No images</div>
        )}
      </div>

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
