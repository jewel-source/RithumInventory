import { NextRequest, NextResponse } from 'next/server'
import {
  FILTER_FIELDS,
  FilterField,
  SIZE_MENTION_PATTERN,
  extractCtw,
  extractCategory,
  extractStyleCode,
  extractRhodiumYp,
  categoryFromStylePrefix,
  toNullableString,
  pruneUnmentionedFields,
  sanitizeKeywords,
  callQwenExtraction,
  DEFAULT_QWEN_MODEL,
} from '@/lib/jewelryAttributes'

type ParsedAttributeFilters = Record<FilterField, string | null> & { keywords: string[] }

const SYSTEM_PROMPT = `You extract jewelry attributes from a product description.
Reply with ONLY a single JSON object, no markdown fences, no explanation, matching exactly this shape:
{
  "category": string|null, "color": string|null, "colorName": string|null,
  "gemType": string|null, "metalType": string|null, "patternName": string|null,
  "ringSize": string|null, "sizeName": string|null,
  "keywords": string[]
}
Do not include "style", "ctw", or "rhodiumYp" fields — all three are extracted separately, not by you.
"metalType" is the base metal (e.g. "STERLING SILVER", "GOLD") — plating (rhodium/yellow/gold-plated) is never a metalType value.
"gemType" is an actual gemstone material only (e.g. "DIAMOND", "SAPPHIRE", "CUBIC ZIRCONIA", "MOISSANITE", "PEARL") — a shape/motif word like "flower", "heart", "halo", "cluster", "vintage" is never a gemType, that belongs in "patternName" or "keywords" instead.

Rules:
- "category" is a product type like RING, EARRING, NECKLACE, BRACELET, PENDANT. null if not mentioned.
- "color", "colorName", "gemType", "metalType", "patternName", "sizeName" are jewelry attributes — fill in only if clearly mentioned, else null.
- "ringSize" is the numeric ring size (e.g. "6"). null if not mentioned.
- "keywords" is up to 4 words copied verbatim from the description that would help find this item by matching a product title. Prefer the specific descriptor itself over the generic word introducing it — for "heart shape", the keyword is "heart", never "shape" (also true for "___ design"/"___ cut"/"___ style"): those generic words appear in nearly every title in a product family and match everything, defeating the purpose. DO include a word here even if it's also used for "gemType"/"metalType"/"patternName"/"color"/"colorName" above — repeat it, don't skip it, since that attribute may not exist on every matching product and the keyword is what catches those. Only exclude category nouns ("ring"), carat/size numbers, and plating words ("plated"/"gold"/"yellow"/"rhodium"). Every word must be an exact word from the description.`

function validate(parsed: unknown, description: string): ParsedAttributeFilters {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Model output was not a JSON object')
  }
  const obj = parsed as Record<string, unknown>

  const filters = Object.fromEntries(
    FILTER_FIELDS.map(field => [field, toNullableString(obj[field])])
  ) as Record<FilterField, string | null> as ParsedAttributeFilters

  filters.keywords = sanitizeKeywords(obj.keywords, description)

  filters.rhodiumYp = extractRhodiumYp(description)
  pruneUnmentionedFields(filters, description)

  filters.style = extractStyleCode(description)
  filters.ctw = extractCtw(description)

  const categoryFromDescription = extractCategory(description)
  if (categoryFromDescription) {
    filters.category = categoryFromDescription
  } else if (
    filters.category &&
    !description.toLowerCase().includes(filters.category.toLowerCase())
  ) {
    filters.category = null
  }
  const isRing = filters.category === 'RING' || categoryFromStylePrefix(filters.style) === 'RING'

  const sizeMatch = description.match(SIZE_MENTION_PATTERN)
  if (sizeMatch) {
    if (isRing) {
      filters.ringSize = sizeMatch[1]
      filters.sizeName = null
    } else {
      filters.sizeName = sizeMatch[1]
      filters.ringSize = null
    }
  } else {
    filters.ringSize = null
    filters.sizeName = null
  }

  return filters
}

export async function POST(req: NextRequest) {
  const token = process.env.HF_API_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'HF_API_TOKEN is not configured on the server' },
      { status: 500 }
    )
  }

  let description: string
  try {
    const body = await req.json()
    description = typeof body?.description === 'string' ? body.description.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!description) {
    return NextResponse.json({ error: 'A description is required' }, { status: 400 })
  }

  const model = process.env.HF_MODEL || DEFAULT_QWEN_MODEL

  try {
    const result = await callQwenExtraction(SYSTEM_PROMPT, description, token, model)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    const filters = validate(result.json, description)
    return NextResponse.json(filters)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json(
      { error: `Could not understand that description: ${message}` },
      { status: 422 }
    )
  }
}
