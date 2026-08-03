import InventoryExport from '@/components/InventoryExport'

export default function ExportPage() {
  return (
    <main style={{ padding: '32px 24px' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '24px' }}>Inventory Export</h1>
      <InventoryExport />
    </main>
  )
}
