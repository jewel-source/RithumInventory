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
    </div>
  )
}
