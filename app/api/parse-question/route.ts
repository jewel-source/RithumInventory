import { NextRequest, NextResponse } from 'next/server'

const HF_CHAT_COMPLETIONS_URL = 'https://router.huggingface.co/v1/chat/completions'
const DEFAULT_MODEL = 'Qwen/Qwen2.5-1.5B-Instruct:featherless-ai'

const SOLD_WINDOWS = ['7', '14', '30', '60', '90'] as const
type SoldWindow = (typeof SOLD_WINDOWS)[number]

const METRICS = ['sold', 'onHand', 'available'] as const
type Metric = (typeof METRICS)[number]

const INTENTS = ['total', 'topSelling'] as const
type Intent = (typeof INTENTS)[number]

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

type ParsedFilters = {
  intent: Intent
  metric: Metric
  window: SoldWindow
  allTimeCaveat?: true
} & Record<FilterField, string | null>

const BEST_SELLER_PATTERN = /\b(best[- ]sell|top[- ]sell|most sold|highest[- ]sell)/i
const ALL_TIME_PATTERN = /\b(until now|so far|all[- ]time|ever|lifetime|to date)\b/i
const RHODIUM_MENTION_PATTERN = /\brhodium\b|\byp\b|yellow[- ]plated|\bplated\b/i
const STYLE_CODE_PATTERN = /\b(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{7,}\b/g
const SIZE_MENTION_PATTERN = /\bsize\s*([0-9]+(?:\.[0-9]+)?)\b/i
const CTW_MENTION_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*(?:ctw|carats?)\b/i
const AVAILABLE_PATTERN = /\bavailable\b/i
const ON_HAND_PATTERN = /\b(do i have|i have|in stock|on hand|inventory|stock)\b/i

function extractCtw(question: string): string | null {
  const match = question.match(CTW_MENTION_PATTERN)
  if (!match) return null
  return `${Number(match[1]).toFixed(2)} CTW`
}


const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  RING: /\brings?\b/i,
  EARRING: /\bearrings?\b/i,
  NECKLACE: /\bnecklaces?\b/i,
  BRACELET: /\bbracelets?\b/i,
  PENDANT: /\bpendants?\b/i,
}

function extractCategory(question: string): string | null {
  for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pattern.test(question)) return category
  }
  return null
}

function extractStyleCode(question: string): string | null {
  const matches = question.match(STYLE_CODE_PATTERN)
  if (!matches || matches.length === 0) return null
  return matches.reduce((longest, m) => (m.length > longest.length ? m : longest)).toUpperCase()
}

const STYLE_PREFIX_CATEGORY: [prefix: string, category: string][] = [
  ['AABR', 'BRACELET'],
  ['AASET', 'SET'],
  ['AAR', 'RING'],
  ['AAE', 'EARRING'],
  ['AAP', 'PENDANT'],
  ['AAN', 'NECKLACE'],
  ['JSR', 'RING'],
  ['JSE', 'EARRING'],
  ['JSP', 'PENDANT'],
  ['JSN', 'NECKLACE'],
  ['JSB', 'BRACELET'],
  ['AR', 'RING'],
  ['AE', 'EARRING'],
  ['AP', 'PENDANT'],
  ['AN', 'NECKLACE'],
  ['AB', 'BRACELET'],
  ['JR', 'RING'],
  ['JE', 'EARRING'],
  ['JP', 'PENDANT'],
  ['JN', 'NECKLACE'],
  ['JB', 'BRACELET'],
]
STYLE_PREFIX_CATEGORY.sort((a, b) => b[0].length - a[0].length)

function categoryFromStylePrefix(style: string | null): string | null {
  if (!style) return null
  const match = STYLE_PREFIX_CATEGORY.find(([prefix]) => style.startsWith(prefix))
  return match ? match[1] : null
}

const SYSTEM_PROMPT = `You extract search filters from a question about a jewelry catalog.
Reply with ONLY a single JSON object, no markdown fences, no explanation, matching exactly this shape:
{
  "intent": "total"|"topSelling",
  "category": string|null, "color": string|null, "colorName": string|null,
  "gemType": string|null, "metalType": string|null, "patternName": string|null,
  "rhodiumYp": string|null, "ringSize": string|null, "sizeName": string|null,
  "metric": "sold"|"onHand"|"available",
  "window": "7"|"14"|"30"|"60"|"90"
}
Do not include "style" or "ctw" fields — both are extracted separately, not by you.

Rules:
- "intent" is "topSelling" only when the question asks which item/style sells best or most (e.g. "best selling", "top seller", "most sold"). Otherwise "total".
- "category" is a product type like RING, EARRING, NECKLACE, BRACELET. null if not mentioned.
- "color", "colorName", "gemType", "metalType", "patternName", "sizeName" are jewelry attributes — fill in only if clearly mentioned, else null.
- "rhodiumYp" is the plating type — it is exactly "RHODIUM PLATED" or "YELLOW PLATED" (YP = Yellow Plated), never any other value. null if not mentioned.
- "ringSize" is the numeric ring size (e.g. "6"). null if not mentioned.
- "metric" is "sold" for units-sold questions, "onHand" for questions about current stock or "how many ... do I have", "available" for available-to-sell stock questions. Default "sold".
- "window" is the sales lookback period in days, one of "7","14","30","60","90". Default to "30" if not stated. Round to the nearest allowed value.`

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model output')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

function isSoldWindow(value: unknown): value is SoldWindow {
  return typeof value === 'string' && (SOLD_WINDOWS as readonly string[]).includes(value)
}

function isMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value)
}

function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as readonly string[]).includes(value)
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function validate(parsed: unknown, question: string): ParsedFilters {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Model output was not a JSON object')
  }
  const obj = parsed as Record<string, unknown>

  const filters = Object.fromEntries(
    FILTER_FIELDS.map(field => [field, toNullableString(obj[field])])
  ) as Record<FilterField, string | null>

  if (!RHODIUM_MENTION_PATTERN.test(question)) {
    filters.rhodiumYp = null
  }

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

  const model = process.env.HF_MODEL || DEFAULT_MODEL

  try {
    const res = await fetch(HF_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        max_tokens: 300,
        temperature: 0.1,
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      const body = await res.text()
      return NextResponse.json(
        { error: `Hugging Face request failed (${res.status}): ${body}` },
        { status: 502 }
      )
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const generatedText = data.choices?.[0]?.message?.content

    if (!generatedText) {
      return NextResponse.json(
        { error: 'Hugging Face response did not include generated text' },
        { status: 502 }
      )
    }

    const filters = validate(extractJson(generatedText), question)
    return NextResponse.json(filters)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json(
      { error: `Could not understand that question: ${message}` },
      { status: 422 }
    )
  }
}
