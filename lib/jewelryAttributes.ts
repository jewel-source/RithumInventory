export const ATTRIBUTE_NAME_BY_PARAM = {
  style: 'Image reference style #',
  category: 'CATEGORY',
  color: 'COLOR',
  colorName: 'COLOR_NAME',
  ctw: 'CTW',
  gemType: 'GEM_TYPE',
  metalType: 'METAL_TYPE',
  patternName: 'PATTERN_NAME',
  rhodiumYp: 'RHODIUM/YP',
  ringSize: 'RING_SIZE',
  sizeName: 'SIZE_NAME',
} as const

export type FilterField = keyof typeof ATTRIBUTE_NAME_BY_PARAM
export const FILTER_FIELDS = Object.keys(ATTRIBUTE_NAME_BY_PARAM) as FilterField[]

export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''")
}

export function attributeClause(name: string, value: string): string {
  const escapedName = escapeODataString(name)
  const escapedValue = escapeODataString(value)
  return `Attributes/any(a: a/Name eq '${escapedName}' and a/Value eq '${escapedValue}')`
}

export const STYLE_CODE_PATTERN = /\b(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{7,}\b/g
export const SIZE_MENTION_PATTERN = /\bsize\s*([0-9]+(?:\.[0-9]+)?)\b/i
export const CTW_MENTION_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*(?:ctw|cttw|carats?)\b/i

export function extractCtw(text: string): string | null {
  const match = text.match(CTW_MENTION_PATTERN)
  if (!match) return null
  return `${Number(match[1]).toFixed(2)} CTW`
}

const YELLOW_PLATED_PATTERN = /\b(?:yellow|gold)[- ]plated\b|\byp\b/i
const WHITE_RHODIUM_PATTERN = /\b(?:white[- ]rhodium|rhodium(?:[- ]plated)?)\b/i

export function extractRhodiumYp(text: string): string | null {
  if (YELLOW_PLATED_PATTERN.test(text)) return 'YELLOW PLATED'
  if (WHITE_RHODIUM_PATTERN.test(text)) return 'WHITE RHODIUM'
  return null
}

const CATEGORY_KEYWORDS: Record<string, RegExp> = {
  RING: /\brings?\b/i,
  EARRING: /\bearrings?\b/i,
  NECKLACE: /\bnecklaces?\b/i,
  BRACELET: /\bbracelets?\b/i,
  PENDANT: /\bpendants?\b/i,
}

export function extractCategory(text: string): string | null {
  for (const [category, pattern] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pattern.test(text)) return category
  }
  return null
}

export function extractStyleCode(text: string): string | null {
  const matches = text.match(STYLE_CODE_PATTERN)
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

export function categoryFromStylePrefix(style: string | null): string | null {
  if (!style) return null
  const match = STYLE_PREFIX_CATEGORY.find(([prefix]) => style.startsWith(prefix))
  return match ? match[1] : null
}

export function mentionedInText(value: string, text: string): boolean {
  const lowerText = text.toLowerCase()
  return value
    .toLowerCase()
    .split(/\s+/)
    .some(token => token.length >= 3 && lowerText.includes(token))
}

export const RESERVED_ATTRIBUTE_WORDS = new Set([
  'ctw', 'cttw', 'carat', 'carats',
  'ring', 'rings', 'earring', 'earrings', 'necklace', 'necklaces',
  'bracelet', 'bracelets', 'pendant', 'pendants',
  'size', 'sizes',
])

export const MODEL_SOURCED_FIELDS = ['color', 'colorName', 'gemType', 'metalType', 'patternName'] as const

const GEM_TYPE_PATTERN =
  /\b(diamond|ruby|rubies|sapphire|emerald|moissanite|cubic zirconia|\bcz\b|pearl|garnet|topaz|amethyst|aquamarine|opal|peridot|citrine|morganite|tanzanite|onyx|turquoise|quartz|jade|spinel|zircon|alexandrite)\b/i

export const HARD_FIELDS: FilterField[] = FILTER_FIELDS.filter(
  field => !(MODEL_SOURCED_FIELDS as readonly string[]).includes(field)
)

export function pruneUnmentionedFields(
  filters: Record<FilterField, string | null>,
  text: string
): void {
  for (const field of MODEL_SOURCED_FIELDS) {
    const value = filters[field]
    if (!value) continue
    const lower = value.trim().toLowerCase()
    if (
      RESERVED_ATTRIBUTE_WORDS.has(lower) ||
      lower.includes('plated') ||
      !mentionedInText(value, text) ||
      (field === 'gemType' && !GEM_TYPE_PATTERN.test(value))
    ) {
      filters[field] = null
    }
  }
}

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'for', 'with', 'and', 'or', 'to', 'is', 'are', 'this',
  'that', 'it', 'its', 'from', 'by', 'at', 'as', 'be', 'been', 'was', 'were', 'has', 'have',
  'had', 'will', 'would', 'can', 'could', 'our', 'your', 'their', 'his', 'her', 'new', 'item',
  'product', 'style', 'sku', 'shape', 'design', 'cut', 'type', 'look',
])

export const MAX_TITLE_KEYWORDS = 4

export function sanitizeKeywords(raw: unknown, text: string): string[] {
  if (!Array.isArray(raw)) return []
  const lowerText = text.toLowerCase()
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const word = item.toLowerCase().trim()
    if (
      word.length < 3 ||
      STOPWORDS.has(word) ||
      RESERVED_ATTRIBUTE_WORDS.has(word) ||
      word.includes('plated') ||
      seen.has(word) ||
      !lowerText.includes(word)
    ) {
      continue
    }
    seen.add(word)
    result.push(word)
    if (result.length >= MAX_TITLE_KEYWORDS) break
  }
  return result
}

export function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const HF_CHAT_COMPLETIONS_URL = 'https://router.huggingface.co/v1/chat/completions'
export const DEFAULT_QWEN_MODEL = 'Qwen/Qwen2.5-1.5B-Instruct:featherless-ai'

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model output')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

export type QwenCallResult =
  | { ok: true; json: unknown }
  | { ok: false; status: number; message: string }

export async function callQwenExtraction(
  systemPrompt: string,
  userText: string,
  token: string,
  model: string
): Promise<QwenCallResult> {
  const res = await fetch(HF_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: 700,
      temperature: 0.1,
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, status: 502, message: `Hugging Face request failed (${res.status}): ${body}` }
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const generatedText = data.choices?.[0]?.message?.content

  if (!generatedText) {
    return { ok: false, status: 502, message: 'Hugging Face response did not include generated text' }
  }

  return { ok: true, json: extractJson(generatedText) }
}
