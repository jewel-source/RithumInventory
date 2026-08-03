'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './Header.module.css'

export default function Header() {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.mark}>JS</span>
        <span className={styles.name}>
          <span className={styles.company}>Jewel Source</span>
          <span className={styles.tagline}>Rithum Inventory</span>
        </span>
      </Link>

      {!isHome && (
        <Link href="/" className={styles.back}>
          ← Back
        </Link>
      )}
    </header>
  )
}
