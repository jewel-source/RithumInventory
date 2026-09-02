import { NextRequest, NextResponse } from 'next/server'
import { findProductImagesForCandidates } from '@/lib/immich'

export async function GET(req: NextRequest) {
  const skus = req.nextUrl.searchParams
    .getAll('sku')
    .map(s => s.trim())
    .filter(Boolean)
  if (skus.length === 0) {
    return NextResponse.json({ error: 'A sku is required' }, { status: 400 })
  }

  try {
    const result = await findProductImagesForCandidates(skus)
    return NextResponse.json(result)
  } catch (e) {
    console.error(`[product-image] lookup failed for sku(s)=${skus.join(',')}:`, e)
    return NextResponse.json({ found: false })
  }
}
