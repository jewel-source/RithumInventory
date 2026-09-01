import { NextRequest, NextResponse } from 'next/server'
import { fetchImmichAsset } from '@/lib/immich'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params
  const size = req.nextUrl.searchParams.get('size') === 'original' ? 'original' : 'thumbnail'

  try {
    const res = await fetchImmichAsset(assetId, size)

    if (!res.ok || !res.body) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    return new NextResponse(res.body, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (e) {
    console.error(`[immich-image] proxy failed for assetId=${assetId}:`, e)
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }
}
