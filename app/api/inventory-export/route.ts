import { NextRequest, NextResponse } from 'next/server'
import { rithumFetchJson, getProfileId } from '@/lib/rithum'
import { COMPANY_LABELS, isCompanyKey, CompanyKey } from '@/lib/companies'

const VENDOR_SKU_ATTRIBUTE_NAME = 'Vendor SKU'

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
  'Attributes',
].join(',')

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
  Attributes?: RithumAttribute[]
}

interface ProductsResponse {
  value: RithumProduct[]
  '@odata.nextLink'?: string
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

async function fetchAllProducts(companyLabel: string): Promise<RithumProduct[]> {
  const escapedLabel = escapeODataString(companyLabel)
  let filterExpr = `Labels/any(l: l/Name eq '${escapedLabel}')`

  const profileId = getProfileId()
  if (profileId) {
    filterExpr += ` and ProfileID eq ${Number(profileId)}`
  }

  const filter = encodeURIComponent(filterExpr)
  let path: string | undefined =
    `/v1/Products?$filter=${filter}&$select=${SELECT_FIELDS}&$expand=Attributes&$top=100`

  const products: RithumProduct[] = []
  while (path) {
    const data: ProductsResponse = await rithumFetchJson<ProductsResponse>(path)
    products.push(...data.value)
    path = data['@odata.nextLink']
  }
  return products
}

function toRow(product: RithumProduct, company: CompanyKey): Record<string, string> {
  const vendorSku =
    product.Attributes?.find(a => a.Name === VENDOR_SKU_ATTRIBUTE_NAME)?.Value ?? ''

  const base: Record<string, string> = {
    SKU: product.Sku ?? '',
    UPC: product.UPC ?? '',
  }

  if (company === 'kohls') {
    base['Vendor SKU'] = vendorSku
  }

  base['Title'] = product.Title ?? ''
  base['On Hand'] = String(product.TotalQuantity ?? '')
  base['Available'] = String(product.TotalAvailableQuantity ?? '')
  base['Sold Last 7 Days'] = String(product.QuantitySoldLast7Days ?? '')
  base['Sold Last 14 Days'] = String(product.QuantitySoldLast14Days ?? '')
  base['Sold Last 30 Days'] = String(product.QuantitySoldLast30Days ?? '')
  base['Sold Last 60 Days'] = String(product.QuantitySoldLast60Days ?? '')
  base['Sold Last 90 Days'] = String(product.QuantitySoldLast90Days ?? '')

  return base
}

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company')
  if (!company || !isCompanyKey(company)) {
    return NextResponse.json(
      { error: 'A company (kohls or macys) is required' },
      { status: 400 }
    )
  }

  try {
    const companyLabel = COMPANY_LABELS[company]
    const products = await fetchAllProducts(companyLabel)
    const rows = products.map(p => toRow(p, company))
    return NextResponse.json({ ready: true, rows })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
