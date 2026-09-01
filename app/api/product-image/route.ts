import { NextRequest, NextResponse } from 'next/server'
import { findProductImages } from '@/lib/immich'

export async function GET(req: NextRequest) {
  const sku = req.nextUrl.searchParams.get('sku')?.trim()
  if (!sku) {
    return NextResponse.json({ error: 'A sku is required' }, { status: 400 })
  }

  try {
    const result = await findProductImages(sku)
    return NextResponse.json(result)
  } catch (e) {
    console.error(`[product-image] lookup failed for sku=${sku}:`, e)
    return NextResponse.json({ found: false })
  }
}
