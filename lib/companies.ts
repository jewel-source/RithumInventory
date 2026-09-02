export const COMPANY_LABELS = {
  kohls: "Kohl's Drop Ship",
  macys: "Macy's Drop Ship",
} as const

export type CompanyKey = keyof typeof COMPANY_LABELS

export const COMPANY_OPTIONS: { key: CompanyKey; label: string }[] = [
  { key: 'kohls', label: "Kohl's" },
  { key: 'macys', label: "Macy's" },
]

export function isCompanyKey(value: string): value is CompanyKey {
  return value in COMPANY_LABELS
}
