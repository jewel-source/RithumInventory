import { NextRequest, NextResponse } from 'next/server'
import { rithumFetchJson, getProfileId } from '@/lib/rithum'
import { COMPANY_LABELS, isCompanyKey } from '@/lib/companies'

// Custom Attribute name this catalog uses for a vendor's own style/item number.
const VENDOR_SKU_ATTRIBUTE_NAME = 'Vendor SKU'

interface RithumAttribute {
  Name: string
  Value: string | null
}

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
  Attributes?: RithumAttribute[]
}

interface ProductsResponse {
  value: RithumProduct[]
}

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

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

function matchesTerm(product: RithumProduct, term: string): boolean {
  const lower = term.toLowerCase()
  if (product.Sku?.toLowerCase() === lower) return true
  if (product.UPC?.toLowerCase() === lower) return true
  return (
    product.Attributes?.some(
      a => a.Name === VENDOR_SKU_ATTRIBUTE_NAME && a.Value?.toLowerCase() === lower
    ) ?? false
  )
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ query: string }> }) {
  const { query } = await params
  const raw = decodeURIComponent(query)

  // Comma-separated batch search: "SKU1, upc2, vendorSku3"
  const terms = [...new Set(raw.split(',').map(t => t.trim()).filter(Boolean))]

  if (terms.length === 0) {
    return NextResponse.json({ error: 'A SKU, UPC, or Vendor SKU is required' }, { status: 400 })
  }

  const company = req.nextUrl.searchParams.get('company')
  if (!company || !isCompanyKey(company)) {
    return NextResponse.json({ error: 'A company (kohls or macys) is required' }, { status: 400 })
  }
  const companyLabel = COMPANY_LABELS[company]

  const escapedAttrName = escapeODataString(VENDOR_SKU_ATTRIBUTE_NAME)

  // AttributeValues has no searchable collection endpoint (only create + an
  // exact Name+ProductID key lookup), so Vendor SKU has to be matched via a
  // lambda filter on the Attributes navigation property instead — confirmed
  // working directly against the Products entity, combined with plain `or`.
  const perTermClauses = terms.map(term => {
    const escaped = escapeODataString(term)
    return (
      `Sku eq '${escaped}' or UPC eq '${escaped}' or ` +
      `Attributes/any(a: a/Name eq '${escapedAttrName}' and a/Value eq '${escaped}')`
    )
  })

  const escapedLabel = escapeODataString(companyLabel)
  let filterExpr =
    `(${perTermClauses.join(' or ')}) and Labels/any(l: l/Name eq '${escapedLabel}')`

  const profileId = getProfileId()
  if (profileId) {
    filterExpr += ` and ProfileID eq ${Number(profileId)}`
  }

  const filter = encodeURIComponent(filterExpr)

  try {
    const data = await rithumFetchJson<ProductsResponse>(
      `/v1/Products?$filter=${filter}&$expand=Images,Attributes&$select=${SELECT_FIELDS}`
    )

    const products = data.value
    const notFound = terms.filter(term => !products.some(p => matchesTerm(p, term)))

    if (products.length === 0) {
      return NextResponse.json({ error: 'No matching products found', notFound }, { status: 404 })
    }

    return NextResponse.json({ products, notFound })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
