'use client'

import { useState } from 'react'
import styles from './InventoryExport.module.css'
import CompanySelector from './CompanySelector'
import { CompanyKey } from '@/lib/companies'

type Row = Record<string, string>

type Phase = 'idle' | 'running' | 'ready' | 'error'

export default function InventoryExport() {
  const [company, setCompany] = useState<CompanyKey | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)

  async function runExport() {
    if (!company) {
      setError("Select Kohl's or Macy's first")
      setPhase('error')
      return
    }

    setPhase('running')
    setError(null)
    setRows([])
    setStatusMessage('Fetching products…')

    try {
      const res = await fetch(`/api/inventory-export?company=${company}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to run export')
      }

      setRows(data.rows)
      setStatusMessage(`Export complete — ${data.rows.length} rows`)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run export')
      setPhase('error')
    }
  }

  function downloadCsv() {
    if (rows.length === 0) return

    const headers = Object.keys(rows[0])
    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      headers.join(','),
      ...rows.map(row => headers.map(h => escape(row[h] ?? '')).join(',')),
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${company}-inventory-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isRunning = phase === 'running'
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className={styles.wrapper}>
      <CompanySelector value={company} onChange={setCompany} />

      <div className={styles.actions}>
        <button className={styles.button} onClick={runExport} disabled={isRunning || !company}>
          {isRunning ? 'Running…' : 'Run Export'}
        </button>
        {phase === 'ready' && (
          <button className={styles.buttonSecondary} onClick={downloadCsv}>
            Download CSV
          </button>
        )}
      </div>

      {statusMessage && <p className={styles.status}>{statusMessage}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {rows.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {headers.map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {headers.map(h => (
                    <td key={h}>{row[h]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
