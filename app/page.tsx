import Link from 'next/link'

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
      }}
    >
      <h1>Rithum Inventory</h1>
      <div style={{ display: 'flex', gap: '16px' }}>
        <Link href="/search">Product Search</Link>
        <Link href="/export">Inventory Export</Link>
      </div>
    </main>
  )
}
