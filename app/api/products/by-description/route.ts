import { NextRequest, NextResponse } from 'next/server'
import { rithumFetchJson, getProfileId } from '@/lib/rithum'
import { COMPANY_LABELS, isCompanyKey } from '@/lib/companies'
import {
  ATTRIBUTE_NAME_BY_PARAM,
  HARD_FIELDS,
  MAX_TITLE_KEYWORDS,
  MODEL_SOURCED_FIELDS,
  RESERVED_ATTRIBUTE_WORDS,
  STOPWORDS,
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

function significantWords(text: string, exclude: Set<string>): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      w => w.length >= 3 && !STOPWORDS.has(w) && !RESERVED_ATTRIBUTE_WORDS.has(w) && !exclude.has(w)
    )
  return [...new Set(words)].slice(0, MAX_TITLE_KEYWORDS)
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

  const filterValueTokens = new Set(hardValues.flatMap(v => v.toLowerCase().split(/\s+/)))

  const qwenKeywords = (params.get('keywords') ?? '')
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && !filterValueTokens.has(w))
    .slice(0, MAX_TITLE_KEYWORDS)

  const words = qwenKeywords.length > 0 ? qwenKeywords : significantWords(description, filterValueTokens)
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

    let products = data.value

    if (products.length === 0) {
      return NextResponse.json(
        { error: 'No matching products found for that description' },
        { status: 404 }
      )
    }

    if (!params.get('rhodiumYp')?.trim()) {
      const styleAttrName = ATTRIBUTE_NAME_BY_PARAM.style
      const foundStyles = new Set(
        products
          .map(p => p.Attributes?.find(a => a.Name === styleAttrName)?.Value)
          .filter((v): v is string => !!v)
      )
      const companionStyles = [...foundStyles]
        .map(style => (/YP$/i.test(style) ? style.slice(0, -2) : `${style}YP`))
        .filter(companion => !foundStyles.has(companion))

      if (companionStyles.length > 0) {
        const companionClauses = companionStyles.map(s => attributeClause(styleAttrName, s))
        let companionFilterExpr =
          `(${companionClauses.join(' or ')}) and Labels/any(l: l/Name eq '${escapeODataString(companyLabel)}')`
        if (profileId) {
          companionFilterExpr += ` and ProfileID eq ${Number(profileId)}`
        }
        try {
          const companionData = await rithumFetchJson<ProductsResponse>(
            `/v1/Products?$filter=${encodeURIComponent(companionFilterExpr)}&$expand=Images,Attributes&$select=${SELECT_FIELDS}&$top=${MAX_RESULTS}`
          )
          const existingIds = new Set(products.map(p => p.ID))
          products = [...products, ...companionData.value.filter(p => !existingIds.has(p.ID))]
        } catch {
        }
      }
    }

    return NextResponse.json({ products })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
