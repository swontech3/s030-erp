import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward';

/** 상태 전이 `{ from, to, cancelReason? }` — 판정은 Fastify(법인변경과 같은 표). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardJson(request, `/legal/incorporations/${encodeURIComponent(id)}/transition`, 'POST');
}
