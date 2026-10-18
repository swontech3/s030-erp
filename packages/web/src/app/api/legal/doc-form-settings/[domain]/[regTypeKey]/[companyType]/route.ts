import type { NextRequest } from 'next/server';
import { forwardDelete } from '@/lib/forward';

/**
 * 회사유형 줄 지우기 — 운영사만(회사는 Fastify 가 403). ★ 기본 줄은 지우지 않는다(400, 사용 끔으로).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string; regTypeKey: string; companyType: string }> },
) {
  const { domain, regTypeKey, companyType } = await params;
  return forwardDelete(
    request,
    `/legal/doc-form-settings/${encodeURIComponent(domain)}/${encodeURIComponent(regTypeKey)}/${encodeURIComponent(companyType)}`,
  );
}
