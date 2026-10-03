import { forwardGetJson } from '@/lib/forward';

/** 한 층의 회의실. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardGetJson(`/facility/floors/${encodeURIComponent(id)}/facilities`);
}
