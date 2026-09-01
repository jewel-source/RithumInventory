import { NextRequest, NextResponse } from 'next/server'
import { rithumFetchJson, getProfileId } from '@/lib/rithum'
import { COMPANY_LABELS, isCompanyKey } from '@/lib/companies'
import {
  ATTRIBUTE_NAME_BY_PARAM,
  HARD_FIELDS,
  MODEL_SOURCED_FIELDS,
  RESERVED_ATTRIBUTE_WORDS,
  attributeClause,
  escapeODataString,
} from '@/lib/jewelryAttributes'

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

interface ProductsResponse {
  value: RithumProduct[]
}

// Same field set the exact SKU/UPC search (`/api/products/[query]`) selects,
// so results plug straight into the same ProductCard rendering.
const SELECT_FIELDS = [
  'ID',
  'Sku',
  'UPC',
  'Title',
  'TotalQuantity',
  'TotalAvailableQuantity',
  'QuantitySoldLast7Days',
  'QuantitySoldLast14Days',
  'QuantitySoldLast30Days',
  'QuantitySoldLast60Days',
  'QuantitySoldLast90Days',
  'Images',
  'Attributes',
].join(',')

const MAX_RESULTS = 50
// Kept small: Rithum's OData service rejects queries whose parsed node count
// exceeds 100, and each `contains(Title, ...)` clause plus its `or` adds up
// fast once combined with the attribute-filter branch and the company clause.
const MAX_KEYWORDS = 4

const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'for', 'with', 'and', 'or', 'to', 'is', 'are', 'this',
  'that', 'it', 'its', 'from', 'by', 'at', 'as', 'be', 'been', 'was', 'were', 'has', 'have',
  'had', 'will', 'would', 'can', 'could', 'our', 'your', 'their', 'his', 'her', 'new', 'item',
  'product', 'style', 'sku',
])

// Words worth matching against Title directly, as a fallback alongside the
// AI-extracted attribute filters — a vague or partially-wrong description can
// still surface candidates this way. Excludes words already owned by a
// precise attribute filter — category nouns/CTW always (RESERVED_ATTRIBUTE_
// WORDS), plus, dynamically, any token that's part of an active filter's
// *value* this search already has (e.g. once rhodiumYp = "YELLOW PLATED" is
// a hard requirement, also letting "plated" compete as a loose Title keyword
// would make virtually every plated item satisfy the soft group on that
// word alone, silently erasing the rest of the description).
function significantWords(text: string, exclude: Set<string>): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      w => w.length >= 3 && !STOPWORDS.has(w) && !RESERVED_ATTRIBUTE_WORDS.has(w) && !exclude.has(w)
    )
  return [...new Set(words)].slice(0, MAX_KEYWORDS)
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  const company = params.get('company')
  if (!company || !isCompanyKey(company)) {
    return NextResponse.json({ error: 'A company (kohls or macys) is required' }, { status: 400 })
  }

  const description = params.get('description')?.trim() || ''
  if (!description) {
    return NextResponse.json({ error: 'A description is required' }, { status: 400 })
  }

  // Hard filters (style, category, CTW, ring/size, rhodium) are extracted
  // deterministically or keyword-gated — high enough confidence to require
  // outright (AND) rather than treat as just one option among many. Soft
  // signals (model-guessed color/metal/gem/pattern, plus Title keywords) are
  // lower confidence individually, so they're OR'd together into one group —
  // but that group still has to match, it doesn't bypass the hard filters.
  // Without this split, a single broad hard filter (e.g. category=RING) or
  // one incidental keyword hit could satisfy the whole query on its own and
  // swamp the results with everything else that happens to share it.
  const activeHardFields = HARD_FIELDS.filter(field => params.get(field)?.trim())
  const hardValues = activeHardFields.map(field => params.get(field)!.trim())
  const hardClauses = activeHardFields.map((field, i) =>
    attributeClause(ATTRIBUTE_NAME_BY_PARAM[field], hardValues[i])
  )

  const activeSoftFields = MODEL_SOURCED_FIELDS.filter(field => params.get(field)?.trim())
  const softValues = activeSoftFields.map(field => params.get(field)!.trim())
  const softAttributeClauses = activeSoftFields.map((field, i) =>
    attributeClause(ATTRIBUTE_NAME_BY_PARAM[field], softValues[i])
  )

  const filterValueTokens = new Set(
    [...hardValues, ...softValues].flatMap(v => v.toLowerCase().split(/\s+/))
  )

  // The Rithum OData service rejects tolower(), so this relies on the
  // backing store's default (case-insensitive) string collation rather than
  // folding case in the query itself.
  const words = significantWords(description, filterValueTokens)
  const titleClauses = words.map(w => `contains(Title, '${escapeODataString(w)}')`)

  const softClauses = [...softAttributeClauses, ...titleClauses]

  let coreExpr: string
  if (hardClauses.length > 0 && softClauses.length > 0) {
    coreExpr = `(${hardClauses.join(' and ')}) and (${softClauses.join(' or ')})`
  } else if (hardClauses.length > 0) {
    coreExpr = hardClauses.join(' and ')
  } else if (softClauses.length > 0) {
    coreExpr = `(${softClauses.join(' or ')})`
  } else {
    return NextResponse.json(
      { error: 'Could not identify any searchable attributes or keywords in the description' },
      { status: 400 }
    )
  }

  const companyLabel = COMPANY_LABELS[company]
  let filterExpr =
    `(${coreExpr}) and Labels/any(l: l/Name eq '${escapeODataString(companyLabel)}')`

  const profileId = getProfileId()
  if (profileId) {
    filterExpr += ` and ProfileID eq ${Number(profileId)}`
  }

  const filter = encodeURIComponent(filterExpr)

  try {
    const data = await rithumFetchJson<ProductsResponse>(
      `/v1/Products?$filter=${filter}&$expand=Images,Attributes&$select=${SELECT_FIELDS}&$top=${MAX_RESULTS}`
    )

    const products = data.value

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'No matching products found for that description' },
        { status: 404 }
      )
    }

    return NextResponse.json({ products })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
