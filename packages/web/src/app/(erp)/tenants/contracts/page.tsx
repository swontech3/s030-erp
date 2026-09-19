/** @screen s0300200030 입주사·계약 마스터-디테일 · 020 입주사관리 · 1차 */

/**
 * 입주사·계약 마스터-디테일.
 *
 * 원본: design/handoff/prototypes/s0300200030.html  ← ★ 시각 정본(2차 인계분)
 * 명세: design/handoff/tenant-contract/02-master-detail.md
 *
 * 3-4 에서 자리 화면을 실제 데이터로 바꿨다. 좌측 목록은 여기서 한 번 받아 넘기고,
 * 우측 계약은 카드를 고를 때 클라이언트가 가져온다 — 화면 전환이 없는 구조라서다.
 *
 * ★ 이 화면은 **운영사 전용(audience_tp='P')** 이다. 옆 호실의 계약 조건이 걸린
 *   자리라 사이드바에서 감추는 것만으로는 부족하다 — `requireScreen` 이 URL 직접
 *   접근을 막고, `/companies` API 도 Fastify 가 403 으로 막는다.
 */
import { EXPIRY_SOON_DAYS } from '@swonbiz/shared/domain/tenant-status';
import { callApi } from '@/lib/api';
import { readSid, requireScreen } from '@/lib/session';
import type { TenantCard } from '@/features/tenants/tenant-model';
import { TenantContractsView } from './TenantContractsView';

interface CodeOption {
  category: string;
  code: string;
  name: string;
}

export default async function TenantContractsPage() {
  await requireScreen('s0300200030', '/tenants/contracts');
  const sid = await readSid();

  const [listRes, codesRes] = await Promise.all([
    callApi<{ total: number; companies: TenantCard[] }>('/companies', { erpSid: sid }),
    // 계약 테이블의 「플랜」·「납부방법」·**상태 뱃지**가 코드 표시명을 쓴다.
    // 상태는 `CONTRACT_ST` 다 — 실패하면 화면 쪽 기본값이 받는다(뱃지가 비지 않는다).
    callApi<{ codes: CodeOption[] }>('/codes', { erpSid: sid }),
  ]);

  // ★ 조회가 실패해도 화면은 연다. 빈 목록은 「등록된 입주사가 없습니다」로 보이고,
  //   그 편이 오류 화면보다 낫다 — 운영자가 할 수 있는 일(신규 등록)이 남는다.
  const tenants = listRes.ok ? listRes.body.companies : [];
  const total = listRes.ok ? listRes.body.total : 0;

  // ★ 키를 `카테고리:코드` 로 묶는다. 코드값만 쓰면 카테고리가 다른 같은 글자가
  //   서로를 덮는다 — 지금은 겹치는 값이 없지만 코드가 늘면 조용히 어긋난다.
  const codeNames: Record<string, string> = {};
  if (codesRes.ok) for (const c of codesRes.body.codes) codeNames[`${c.category}:${c.code}`] = c.name;

  return (
    <TenantContractsView
      tenants={tenants}
      total={total}
      codeNames={codeNames}
      soonDays={EXPIRY_SOON_DAYS}
    />
  );
}
