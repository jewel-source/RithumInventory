import { NextRequest, NextResponse } from 'next/server'
import { rithumFetchJson, getProfileId } from '@/lib/rithum'
import { COMPANY_LABELS, isCompanyKey } from '@/lib/companies'
import {
  ATTRIBUTE_NAME_BY_PARAM,
  FILTER_FIELDS,
  attributeClause,
  escapeODataString,
} from '@/lib/jewelryAttributes'

const FILTER_PARAMS = FILTER_FIELDS

const SOLD_WINDOWS = ['7', '14', '30', '60', '90'] as const
type SoldWindow = (typeof SOLD_WINDOWS)[number]

function isSoldWindow(value: string): value is SoldWindow {
  return (SOLD_WINDOWS as readonly string[]).includes(value)
}

const SOLD_FIELD_BY_WINDOW: Record<SoldWindow, keyof RithumProduct> = {
  '7': 'QuantitySoldLast7Days',
  '14': 'QuantitySoldLast14Days',
  '30': 'QuantitySoldLast30Days',
  '60': 'QuantitySoldLast60Days',
  '90': 'QuantitySoldLast90Days',
}

const METRICS = ['sold', 'onHand', 'available'] as const
type Metric = (typeof METRICS)[number]

function isMetric(value: string): value is Metric {
  return (METRICS as readonly string[]).includes(value)
}

const INTENTS = ['total', 'topSelling'] as const
type Intent = (typeof INTENTS)[number]

function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value)
}

const SELECT_FIELDS = [
  'ID',
  'Sku',
  'TotalQuantity',
  'TotalAvailableQuantity',
  'QuantitySoldLast7Days',
  'QuantitySoldLast14Days',
  'QuantitySoldLast30Days',
  'QuantitySoldLast60Days',
  'QuantitySoldLast90Days',
  'Attributes',
].join(',')

interface RithumAttribute {
  Name: string
  Value: string | null
}

interface RithumProduct {
  ID: number
  Sku: string | null
  TotalQuantity: number | null
  TotalAvailableQuantity: number | null
  QuantitySoldLast7Days: number | null
  QuantitySoldLast14Days: number | null
  QuantitySoldLast30Days: number | null
  QuantitySoldLast60Days: number | null
  QuantitySoldLast90Days: number | null
  Attributes?: RithumAttribute[]
}

interface ProductsResponse {
  value: RithumProduct[]
  '@odata.nextLink'?: string
}

function metricField(metric: Metric, window: SoldWindow): keyof RithumProduct {
  if (metric === 'onHand') return 'TotalQuantity'
  if (metric === 'available') return 'TotalAvailableQuantity'
  return SOLD_FIELD_BY_WINDOW[window]
}

function metricValue(product: RithumProduct, metric: Metric, window: SoldWindow): number {
  return Number(product[metricField(metric, window)]) || 0
}

async function fetchAllMatchingProducts(filterExpr: string): Promise<RithumProduct[]> {
  const filter = encodeURIComponent(filterExpr)
  let path: string | undefined =
    `/v1/Products?$filter=${filter}&$expand=Attributes&$select=${SELECT_FIELDS}&$top=100`

  const products: RithumProduct[] = []
  while (path) {
    const data: ProductsResponse = await rithumFetchJson<ProductsResponse>(path)
    products.push(...data.value)
    path = data['@odata.nextLink']
  }
  return products
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  const company = params.get('company')
  if (!company || !isCompanyKey(company)) {
    return NextResponse.json({ error: 'A company (kohls or macys) is required' }, { status: 400 })
  }

  const intentParam = params.get('intent')?.trim() || 'total'
  if (!isIntent(intentParam)) {
    return NextResponse.json({ error: 'intent must be total or topSelling' }, { status: 400 })
  }

  const metricParam = params.get('metric')?.trim() || 'sold'
  if (!isMetric(metricParam)) {
    return NextResponse.json({ error: 'metric must be sold, onHand, or available' }, { status: 400 })
  }

  const windowParam = params.get('window')?.trim() || '30'
  if (!isSoldWindow(windowParam)) {
    return NextResponse.json(
      { error: 'window must be one of 7, 14, 30, 60, or 90' },
      { status: 400 }
    )
  }

  const activeFilters = FILTER_PARAMS.filter(p => params.get(p)?.trim())

  if (intentParam === 'total' && activeFilters.length === 0) {
    return NextResponse.json(
      {
        error:
          'Please include at least one filter — style, category, color, metal, CTW, ring size, etc.',
      },
      { status: 400 }
    )
  }

  const companyLabel = COMPANY_LABELS[company]
  const clauses = [`Labels/any(l: l/Name eq '${escapeODataString(companyLabel)}')`]
  for (const paramName of activeFilters) {
    const value = params.get(paramName)!.trim()
    clauses.push(attributeClause(ATTRIBUTE_NAME_BY_PARAM[paramName], value))
  }

  let filterExpr = clauses.join(' and ')

  const profileId = getProfileId()
  if (profileId) {
    filterExpr += ` and ProfileID eq ${Number(profileId)}`
  }

  try {
    const products = await fetchAllMatchingProducts(filterExpr)

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'No matching products found for those filters' },
        { status: 404 }
      )
    }

    const windowOut = metricParam === 'sold' ? windowParam : undefined

    if (intentParam === 'topSelling') {
      const limitRaw = Number(params.get('limit')) || 5
      const limit = Math.min(Math.max(limitRaw, 1), 20)

      const groups = new Map<string, RithumProduct[]>()
      for (const product of products) {
        const style =
          product.Attributes?.find(a => a.Name === ATTRIBUTE_NAME_BY_PARAM.style)?.Value ||
          product.Sku ||
          `#${product.ID}`
        const group = groups.get(style)
        if (group) group.push(product)
        else groups.set(style, [product])
      }

      const rankings = [...groups.entries()]
        .map(([style, groupProducts]) => ({
          style,
          total: groupProducts.reduce(
            (sum, p) => sum + metricValue(p, metricParam, windowParam),
            0
          ),
          skuCount: groupProducts.length,
          skus: groupProducts.map(p => ({
            Sku: p.Sku,
            value: metricValue(p, metricParam, windowParam),
          })),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit)

      return NextResponse.json({
        intent: 'topSelling',
        metric: metricParam,
        window: windowOut,
        rankings,
      })
    }

    const total = products.reduce((sum, p) => sum + metricValue(p, metricParam, windowParam), 0)

    return NextResponse.json({
      intent: 'total',
      total,
      metric: metricParam,
      window: windowOut,
      matchCount: products.length,
      products: products.map(p => ({
        Sku: p.Sku,
        value: metricValue(p, metricParam, windowParam),
        attributes: p.Attributes ?? [],
      })),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
