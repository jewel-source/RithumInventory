'use client'

import { COMPANY_OPTIONS, CompanyKey } from '@/lib/companies'
import styles from './CompanySelector.module.css'

export default function CompanySelector({
  value,
  onChange,
}: {
  value: CompanyKey | null
  onChange: (key: CompanyKey) => void
}) {
  return (
    <div className={styles.wrapper}>
      {COMPANY_OPTIONS.map(opt => (
        <button
          key={opt.key}
          type="button"
          className={value === opt.key ? styles.selected : styles.option}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
