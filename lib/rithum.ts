const TOKEN_URL = 'https://api.channeladvisor.com/oauth2/token'
const API_BASE = 'https://api.channeladvisor.com'

interface CachedToken {
  accessToken: string
  expiresAt: number
}

let cachedToken: CachedToken | null = null

async function fetchNewAccessToken(): Promise<CachedToken> {
  const appId = process.env.RITHUM_APPLICATION_ID
  const secret = process.env.RITHUM_SHARED_SECRET
  const refreshToken = process.env.RITHUM_REFRESH_TOKEN

  if (!appId || !secret || !refreshToken) {
    throw new Error(
      'Missing RITHUM_APPLICATION_ID, RITHUM_SHARED_SECRET, or RITHUM_REFRESH_TOKEN env vars'
    )
  }

  const basicAuth = Buffer.from(`${appId}:${secret}`).toString('base64')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Rithum token refresh failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken
  }
  cachedToken = await fetchNewAccessToken()
  return cachedToken.accessToken
}

export async function rithumFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken()
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`

  return fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })
}

export async function rithumFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await rithumFetch(path, init)

  if (!res.ok) {
    const body = await res.text()
    let message = body
    try {
      const parsed = JSON.parse(body)
      message = parsed?.error?.message ?? body
    } catch {
    }
    throw new Error(`Rithum API error (${res.status}): ${message}`)
  }

  return res.json() as Promise<T>
}

export function getProfileId(): string | undefined {
  return process.env.RITHUM_PROFILE_ID || undefined
}
