// Shared jewelry-attribute extraction used by the natural-language search
// features ("Ask a question" and "search by description"): the Rithum
// attribute-name mapping, deterministic regex extractors, and the Qwen
// (Hugging Face) call used to pull the rest out of freeform text.

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

// ---------------------------------------------------------------------
// Deterministic extractors (regex-based, no model call)
// ---------------------------------------------------------------------

export const STYLE_CODE_PATTERN = /\b(?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{7,}\b/g
export const SIZE_MENTION_PATTERN = /\bsize\s*([0-9]+(?:\.[0-9]+)?)\b/i
// Jewelry titles commonly use "CTTW" (carat total weight) alongside "CTW".
export const CTW_MENTION_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*(?:ctw|cttw|carats?)\b/i

export function extractCtw(text: string): string | null {
  const match = text.match(CTW_MENTION_PATTERN)
  if (!match) return null
  return `${Number(match[1]).toFixed(2)} CTW`
}

// The RHODIUM/YP attribute only ever holds one of two values in this
// catalog. Rather than trust a small model to pick between them (it
// confused "gold plated" for a metalType value entirely, per a real user
// report), derive it deterministically from the same synonyms the system
// prompt used to describe to the model: "gold plated" and "yellow plated"
// both mean YP, "rhodium (plated)" means RHODIUM PLATED. A bare "plated"
// with no color qualifier is genuinely ambiguous, so it stays null rather
// than guessing.
const YELLOW_PLATED_PATTERN = /\b(?:yellow|gold)[- ]plated\b|\byp\b/i
const RHODIUM_PLATED_PATTERN = /\brhodium(?:[- ]plated)?\b/i

export function extractRhodiumYp(text: string): string | null {
  if (YELLOW_PLATED_PATTERN.test(text)) return 'YELLOW PLATED'
  if (RHODIUM_PLATED_PATTERN.test(text)) return 'RHODIUM PLATED'
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

// Small extraction models readily hallucinate a plausible-sounding value for
// a free-text field (e.g. inventing "YELLOW PLATED" for metalType when
// nothing in the text says so). Require at least one real word of the
// model's value to actually appear in the source text before trusting it.
export function mentionedInText(value: string, text: string): boolean {
  const lowerText = text.toLowerCase()
  return value
    .toLowerCase()
    .split(/\s+/)
    .some(token => token.length >= 3 && lowerText.includes(token))
}

// Words that are always extracted deterministically by their own dedicated
// field (ctw, category) — a model returning one of these AS THE VALUE of a
// different field (e.g. gemType: "CTW") is leaking the source text back at
// us, not identifying a real attribute. "mentionedInText" alone can't catch
// this, since the word trivially appears in text the user actually typed.
export const RESERVED_ATTRIBUTE_WORDS = new Set([
  'ctw', 'cttw', 'carat', 'carats',
  'ring', 'rings', 'earring', 'earrings', 'necklace', 'necklaces',
  'bracelet', 'bracelets', 'pendant', 'pendants',
  'size', 'sizes',
])

// Fields whose values are free text pulled from the model (as opposed to
// style/ctw/category/ringSize/sizeName, which are extracted deterministically,
// or rhodiumYp, which has its own keyword-pattern guard) — null out any that
// aren't actually grounded in the source text, or that are just an echo of a
// word another field already owns.
export const MODEL_SOURCED_FIELDS = ['color', 'colorName', 'gemType', 'metalType', 'patternName'] as const

// The rest of FILTER_FIELDS: extracted deterministically (or, for rhodiumYp,
// gated by an explicit keyword pattern) — high enough confidence to use as a
// hard requirement rather than just one option among many. Search callers
// that want "precise filters AND fuzzy signals" rather than one flat OR
// should split on this.
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
    // "plated" describes the RHODIUM/YP attribute (handled deterministically
    // by extractRhodiumYp), never a legitimate color/metal/gem/pattern value
    // — the model has confused the two before (e.g. metalType: "GOLD PLATED").
    if (RESERVED_ATTRIBUTE_WORDS.has(lower) || lower.includes('plated') || !mentionedInText(value, text)) {
      filters[field] = null
    }
  }
}

export function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ---------------------------------------------------------------------
// Qwen (Hugging Face) extraction call
// ---------------------------------------------------------------------

const HF_CHAT_COMPLETIONS_URL = 'https://router.huggingface.co/v1/chat/completions'
export const DEFAULT_QWEN_MODEL = 'Qwen/Qwen2.5-1.5B-Instruct:featherless-ai'

/** Pulls the first {...} JSON object out of a model reply, tolerating
 * markdown code fences around it. */
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

/** Calls the Hugging Face-hosted Qwen model with a system prompt + user
 * text. Transport/response-shape failures (bad HTTP status, empty reply)
 * come back as `{ ok: false }` for the caller to map to its own status
 * code; a malformed JSON reply throws instead, so callers that want a
 * single "couldn't understand" catch-all can still get one. */
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
      max_tokens: 300,
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
