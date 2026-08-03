'use client'

import { useState, useRef, useEffect } from 'react'
import styles from './InventoryExport.module.css'

type Row = Record<string, string>

type Phase = 'idle' | 'starting' | 'polling' | 'ready' | 'error'

const POLL_INTERVAL_MS = 3000

export default function InventoryExport() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  // Stop polling if the component unmounts mid-export.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
    }
  }, [])

  async function runExport() {
    cancelledRef.current = false
    setPhase('starting')
    setError(null)
    setRows([])
    setStatusMessage('Starting export…')

    try {
      const startRes = await fetch('/api/inventory-export', { method: 'POST' })
      const startData = await startRes.json()

      if (!startRes.ok) {
        throw new Error(startData.error || 'Failed to start export')
      }

      setPhase('polling')
      await poll(startData.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start export')
      setPhase('error')
    }
  }

  async function poll(token: string) {
    while (!cancelledRef.current) {
      const res = await fetch(`/api/inventory-export?token=${encodeURIComponent(token)}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Export status check failed')
      }

      if (data.ready) {
        setRows(data.rows)
        setStatusMessage(`Export complete — ${data.rows.length} rows`)
        setPhase('ready')
        return
      }

      setStatusMessage(`Export status: ${data.status || 'Processing'}…`)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
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
    a.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isRunning = phase === 'starting' || phase === 'polling'
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <div className={styles.wrapper}>
      <div className={styles.actions}>
        <button className={styles.button} onClick={runExport} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Run Export'}
        </button>
        {phase === 'ready' && (
          <button className={styles.buttonSecondary} onClick={downloadCsv}>
            Download CSV
          </button>
        )}
      </div>

      {statusMessage && phase !== 'ready' && <p className={styles.status}>{statusMessage}</p>}
      {phase === 'ready' && <p className={styles.status}>{statusMessage}</p>}
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
