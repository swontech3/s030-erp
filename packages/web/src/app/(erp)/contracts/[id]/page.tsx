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
import {
  ContractForm,
  type CompanyResponse,
  type ContractResponse,
  type MemberResponse,
} from '@/features/contracts/ContractForm';
import type { CodeOption, SpaceOption } from '@/features/contracts/form-model';
import type { SpaceHolder } from '@swonbiz/shared/domain/space-occupancy';

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

  /*
   * 호실·코드·입주 현황은 두 경로 다 필요하다 — 같이 부른다.
   *
   * ★ 입주 현황(`space-holders`)을 **서버에서** 받아 넘긴다. 브라우저가 따로 부르면
   *   셀렉트가 한 번 「아무도 없음」으로 그려졌다가 뒤늦게 바뀐다 — 그 짧은 사이에
   *   고른 호실이 사실은 못 고르는 호실일 수 있다.
   * ★ 자기 계약을 빼는 것은 화면이 한다(`occupancyBySpace`). 서버는 전부 준다.
   */
  const [spacesRes, codesRes, holdersRes] = await Promise.all([
    callApi<{ spaces: SpaceOption[] }>('/spaces', { erpSid: sid }),
    callApi<{ codes: CodeOption[] }>('/codes', { erpSid: sid }),
    callApi<{ holders: SpaceHolder[] }>('/contracts/space-holders', { erpSid: sid }),
  ]);

  let contract: ContractResponse | null = null;
  if (id !== NEW) {
    const res = await callApi<ContractResponse>(`/contracts/${encodeURIComponent(id)}`, { erpSid: sid });
    // ★ 없는 계약과 볼 수 없는 계약을 구분하지 않는다 — Fastify 가 둘 다 404 로 준다.
    if (res.status === 404) notFound();
    if (!res.ok) throw new Error(`계약 조회 실패(${res.status})`);
    contract = res.body;
  }

  // 섹션 1·3 의 값은 **계약이 아니라 입주사**에 붙어 있다(3-4). 계약이 어느 입주사
  // 것인지 정해진 뒤에만 읽을 수 있다 — 신규 작성인데 `companyId` 가 없으면 빈 폼이다.
  const targetCompany = contract?.companyId ?? companyId ?? null;
  let company: CompanyResponse | null = null;
  let members: MemberResponse[] = [];
  if (targetCompany) {
    const [companyRes, membersRes] = await Promise.all([
      callApi<CompanyResponse>(`/companies/${encodeURIComponent(targetCompany)}`, { erpSid: sid }),
      callApi<{ members: MemberResponse[] }>(`/companies/${encodeURIComponent(targetCompany)}/members`, {
        erpSid: sid,
      }),
    ]);
    // ★ 없는 입주사를 가리키는 `?companyId=` 는 404 가 아니라 «회사 없음»으로 둔다.
    //   계약 자체는 열려야 한다 — 계약이 있는데 회사 조회가 404 인 상황은 데이터가
    //   깨진 것이고, 그때 화면까지 닫으면 고칠 방법이 없어진다.
    if (companyRes.ok) company = companyRes.body;
    if (membersRes.ok) members = membersRes.body.members;
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
      companyId={targetCompany}
      company={company}
      members={members}
      spaces={spacesRes.ok ? spacesRes.body.spaces : []}
      codes={codesRes.ok ? codesRes.body.codes : []}
      /*
       * ★ 못 받으면 **빈 배열**이다 — 「아무도 없다」로 보여 전부 고를 수 있게 된다.
       *   화면이 느슨해지는 쪽이고, 저장할 때 서버가 같은 함수로 다시 막는다.
       */
      spaceHolders={holdersRes.ok ? holdersRes.body.holders : []}
    />
  );
}
