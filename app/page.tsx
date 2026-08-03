import Link from 'next/link'
import styles from './page.module.css'

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.heading}>
        <h1 className={styles.title}>Rithum Inventory</h1>
        <p className={styles.subtitle}>Product search &amp; inventory export, straight from Rithum</p>
      </div>

      <div className={styles.cards}>
        <Link href="/search" className={styles.card}>
          <span className={styles.cardIcon}>🔍</span>
          <span className={styles.cardTitle}>Product Search</span>
          <span className={styles.cardDesc}>Look up SKU, UPC, or Vendor SKU with images and sales data</span>
        </Link>
        <Link href="/export" className={styles.card}>
          <span className={styles.cardIcon}>📦</span>
          <span className={styles.cardTitle}>Inventory Export</span>
          <span className={styles.cardDesc}>Export current inventory for Kohl&apos;s or Macy&apos;s</span>
        </Link>
      </div>
    </main>
  )
}
