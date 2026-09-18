/** @screen s0300200040 계약 폼 · 020 입주사관리 · 1차 */

/**
 * 계약 폼 페이지.
 *
 * 원본: design/handoff/prototypes/s0300200040.html
 * 명세: design/handoff/tenant-contract/03-contract-form.md · 04-status.md · 05-logic.md
 *
 * 라우트는 `/contracts/[id]` 하나다. **신규 작성은 `/contracts/new`** 이고, 그때만
 * `?companyId=` 로 어느 입주사의 계약인지 받는다 — 저장할 때 서버가 요구하는 값이다.
 *
 * ★ 사이드바에 없는 화면이다(`lib/sidebar.ts` 의 `s0300200040: null`). 계약 목록·상세에서
 *   들어온다. 그래도 `requireScreen` 은 반드시 거친다 — 메뉴에 없다는 것은 방어가 아니고,
 *   URL 을 직접 치면 열리기 때문이다.
 *
 * ★ **운영사 전용**이다. 입주사 세션에는 이 화면 코드가 내려가지 않으므로 `requireScreen`
 *   이 `/no-access` 로 돌려보낸다. 호실·코드 조회와 계약 쓰기도 Fastify 가 따로 막는다.
 *
 * ★ 조회는 전부 서버에서 한다. 브라우저는 Fastify 에 직접 붙지 않는다(`lib/api.ts`).
 */
import { notFound } from 'next/navigation';
import { callApi } from '@/lib/api';
import { readSid, requireScreen } from '@/lib/session';
import { ContractForm, type ContractResponse } from '@/features/contracts/ContractForm';
import type { CodeOption, SpaceOption } from '@/features/contracts/form-model';

/** 신규 작성을 가리키는 세그먼트. 실제 계약 ID 는 UUID 라 겹치지 않는다. */
const NEW = 'new';

export default async function ContractFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ companyId?: string }>;
}) {
  await requireScreen('s0300200040', '/contracts/[id]');

  const { id } = await params;
  const { companyId } = await searchParams;
  const sid = await readSid();

  // 호실·코드는 두 경로 다 필요하다 — 같이 부른다.
  const [spacesRes, codesRes] = await Promise.all([
    callApi<{ spaces: SpaceOption[] }>('/spaces', { erpSid: sid }),
    callApi<{ codes: CodeOption[] }>('/codes', { erpSid: sid }),
  ]);

  let contract: ContractResponse | null = null;
  if (id !== NEW) {
    const res = await callApi<ContractResponse>(`/contracts/${encodeURIComponent(id)}`, { erpSid: sid });
    // ★ 없는 계약과 볼 수 없는 계약을 구분하지 않는다 — Fastify 가 둘 다 404 로 준다.
    if (res.status === 404) notFound();
    if (!res.ok) throw new Error(`계약 조회 실패(${res.status})`);
    contract = res.body;
  }

  return (
    /*
     * ★ key 로 다시 마운트한다 — 상태가 **실제로 바뀐 경우에만** 폼을 다시 채우기 위해서다
     *   (04-status.md 「상태 변경 시에만 값을 다시 채우세요」). 임시저장처럼 상태가 그대로인
     *   갱신에서는 key 가 같아 입력 중인 값이 살아 있고, 확정·종료처럼 상태가 바뀌면
     *   서버 값으로 새로 채워진다.
     */
    <ContractForm
      key={`${id}:${contract?.status ?? 'create'}`}
      contract={contract}
      companyId={contract?.companyId ?? companyId ?? null}
      spaces={spacesRes.ok ? spacesRes.body.spaces : []}
      codes={codesRes.ok ? codesRes.body.codes : []}
    />
  );
}
