import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { rithumFetch, rithumFetchJson, getProfileId } from '@/lib/rithum'

const EXPORT_FIELDS = [
  'sku',
  'title',
  'totalquantity',
  'totalavailablequantity',
  'quantitysoldlast7days',
  'quantitysoldlast14days',
  'quantitysoldlast30days',
  'quantitysoldlast60days',
  'quantitysoldlast90days',
].join(',')

interface ExportStatus {
  Token: string
  Status: string
  StartedOnUtc?: string
  ResponseFileUrl?: string
}

/** Kicks off a new inventory export job and returns its token. */
export async function POST() {
  try {
    const profileId = getProfileId()
    const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''

    const res = await rithumFetch(`/v1/ProductExport${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: EXPORT_FIELDS,
    })

    const text = await res.text()

    if (!res.ok) {
      return NextResponse.json(
        { error: text || `Export request failed (${res.status})` },
        { status: 502 }
      )
    }

    // The docs describe this response as a bare token string, but in
    // practice Rithum returns the full status object right away
    // (`{Token, Status, StartedOnUtc, ResponseFileUrl}`) — pull `Token` out
    // of that, while still handling a bare/JSON-quoted string just in case.
    let token: string | undefined
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'string') {
        token = parsed
      } else if (parsed && typeof parsed.Token === 'string') {
        token = parsed.Token
      }
    } catch {
      token = text.trim()
    }

    if (!token) {
      return NextResponse.json(
        { error: `Unexpected export response: ${text.slice(0, 300)}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ token })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

/** Polls an export job by token. Once complete, downloads and parses the
 * resulting tab-delimited file and returns rows as JSON. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  try {
    const status = await rithumFetchJson<ExportStatus>(
      `/v1/ProductExport?token=${encodeURIComponent(token)}`
    )

    const isComplete = /complete/i.test(status.Status) && !!status.ResponseFileUrl

    if (!isComplete) {
      return NextResponse.json({ status: status.Status, ready: false })
    }

    // The download URL is a pre-signed link, not part of the Rithum API
    // itself — fetch it directly without the bearer token.
    const fileRes = await fetch(status.ResponseFileUrl!)
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `Failed to download export file (${fileRes.status})` },
        { status: 502 }
      )
    }

    const raw = await extractExportText(await fileRes.arrayBuffer())
    const rows = parseTabDelimited(raw)

    return NextResponse.json({ status: status.Status, ready: true, rows })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

/** The export download is a `.zip` wrapping a single tab-delimited `.txt`
 * file — detect that (via the 'PK' zip signature) and unzip it; otherwise
 * assume the response is already plain text. */
async function extractExportText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const isZip = bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b // 'PK'

  if (!isZip) {
    return Buffer.from(buffer).toString('utf-8')
  }

  const zip = await JSZip.loadAsync(buffer)
  const entry = Object.values(zip.files).find(f => !f.dir)
  if (!entry) {
    throw new Error('Export zip file was empty')
  }
  return entry.async('string')
}

function parseTabDelimited(raw: string): Record<string, string>[] {
  const lines = raw.split(/\r?\n/).filter(line => line.length > 0)
  if (lines.length === 0) return []

  const headers = lines[0].split('\t')
  return lines.slice(1).map(line => {
    const cells = line.split('\t')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
}
