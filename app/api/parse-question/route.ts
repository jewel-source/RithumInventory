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
  callQwenExtraction,
  DEFAULT_QWEN_MODEL,
} from '@/lib/jewelryAttributes'

const SOLD_WINDOWS = ['7', '14', '30', '60', '90'] as const
type SoldWindow = (typeof SOLD_WINDOWS)[number]

const METRICS = ['sold', 'onHand', 'available'] as const
type Metric = (typeof METRICS)[number]

const INTENTS = ['total', 'topSelling'] as const
type Intent = (typeof INTENTS)[number]

type ParsedFilters = {
  intent: Intent
  metric: Metric
  window: SoldWindow
  allTimeCaveat?: true
} & Record<FilterField, string | null>

const BEST_SELLER_PATTERN = /\b(best[- ]sell|top[- ]sell|most sold|highest[- ]sell)/i
const ALL_TIME_PATTERN = /\b(until now|so far|all[- ]time|ever|lifetime|to date)\b/i
const AVAILABLE_PATTERN = /\bavailable\b/i
const ON_HAND_PATTERN = /\b(do i have|i have|in stock|on hand|inventory|stock)\b/i

const SYSTEM_PROMPT = `You extract search filters from a question about a jewelry catalog.
Reply with ONLY a single JSON object, no markdown fences, no explanation, matching exactly this shape:
{
  "intent": "total"|"topSelling",
  "category": string|null, "color": string|null, "colorName": string|null,
  "gemType": string|null, "metalType": string|null, "patternName": string|null,
  "ringSize": string|null, "sizeName": string|null,
  "metric": "sold"|"onHand"|"available",
  "window": "7"|"14"|"30"|"60"|"90"
}
Do not include "style", "ctw", or "rhodiumYp" fields — all three are extracted separately, not by you.
"metalType" is the base metal (e.g. "STERLING SILVER", "GOLD") — plating (rhodium/yellow/gold-plated) is never a metalType value.
"gemType" is an actual gemstone material only (e.g. "DIAMOND", "SAPPHIRE", "CUBIC ZIRCONIA", "MOISSANITE", "PEARL") — a shape/motif word like "flower", "heart", "halo", "cluster", "vintage" is never a gemType.

Rules:
- "intent" is "topSelling" only when the question asks which item/style sells best or most (e.g. "best selling", "top seller", "most sold"). Otherwise "total".
- "category" is a product type like RING, EARRING, NECKLACE, BRACELET. null if not mentioned.
- "color", "colorName", "gemType", "metalType", "patternName", "sizeName" are jewelry attributes — fill in only if clearly mentioned, else null.
- "ringSize" is the numeric ring size (e.g. "6"). null if not mentioned.
- "metric" is "sold" for units-sold questions, "onHand" for questions about current stock or "how many ... do I have", "available" for available-to-sell stock questions. Default "sold".
- "window" is the sales lookback period in days, one of "7","14","30","60","90". Default to "30" if not stated. Round to the nearest allowed value.`

function isSoldWindow(value: unknown): value is SoldWindow {
  return typeof value === 'string' && (SOLD_WINDOWS as readonly string[]).includes(value)
}

function isMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value)
}

function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as readonly string[]).includes(value)
}

function validate(parsed: unknown, question: string): ParsedFilters {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Model output was not a JSON object')
  }
  const obj = parsed as Record<string, unknown>

  const filters = Object.fromEntries(
    FILTER_FIELDS.map(field => [field, toNullableString(obj[field])])
  ) as Record<FilterField, string | null>

  filters.rhodiumYp = extractRhodiumYp(question)
  pruneUnmentionedFields(filters, question)

  filters.style = extractStyleCode(question)
  filters.ctw = extractCtw(question)

  const categoryFromQuestion = extractCategory(question)
  if (categoryFromQuestion) {
    filters.category = categoryFromQuestion
  } else if (filters.category && !question.toLowerCase().includes(filters.category.toLowerCase())) {
    filters.category = null
  }
  const isRingQuestion =
    filters.category === 'RING' || categoryFromStylePrefix(filters.style) === 'RING'

  const sizeMatch = question.match(SIZE_MENTION_PATTERN)
  if (sizeMatch) {
    if (isRingQuestion) {
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

  let intent: Intent = isIntent(obj.intent) ? obj.intent : 'total'
  if (BEST_SELLER_PATTERN.test(question)) {
    intent = 'topSelling'
  }

  if (intent === 'total' && FILTER_FIELDS.every(field => filters[field] === null)) {
    throw new Error(
      'Could not identify any filters (style, category, color, metal, CTW, size, etc.) in the question'
    )
  }

  let metric: Metric = isMetric(obj.metric) ? obj.metric : 'sold'
  if (AVAILABLE_PATTERN.test(question)) {
    metric = 'available'
  } else if (ON_HAND_PATTERN.test(question)) {
    metric = 'onHand'
  }
  let window: SoldWindow = isSoldWindow(obj.window) ? obj.window : '30'

  const result: ParsedFilters = { intent, metric, window, ...filters }

  if (metric === 'sold' && ALL_TIME_PATTERN.test(question)) {
    window = '90'
    result.window = '90'
    result.allTimeCaveat = true
  }

  return result
}

export async function POST(req: NextRequest) {
  const token = process.env.HF_API_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'HF_API_TOKEN is not configured on the server' },
      { status: 500 }
    )
  }

  let question: string
  try {
    const body = await req.json()
    question = typeof body?.question === 'string' ? body.question.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!question) {
    return NextResponse.json({ error: 'A question is required' }, { status: 400 })
  }

  const model = process.env.HF_MODEL || DEFAULT_QWEN_MODEL

  try {
    const result = await callQwenExtraction(SYSTEM_PROMPT, question, token, model)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    const filters = validate(result.json, question)
    return NextResponse.json(filters)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json(
      { error: `Could not understand that question: ${message}` },
      { status: 422 }
    )
  }
}
