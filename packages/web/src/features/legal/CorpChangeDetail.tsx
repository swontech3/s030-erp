'use client';

/**
 * s040200011 법인변경 상세 — 기본정보 · 변경 내용 · 임원(3단계, 2026-10-10).
 *
 * ★ 시안이 없다. 계약 폼(s030200040)의 틀 — 붙어 있는 머리 · 카드 · 4열 그리드 · 주소 한 줄 — 에 얹었다.
 *
 * =============================================================================
 * ★★★ 두 모드 — 임시 모드(새 건)와 저장된 건
 * =============================================================================
 * 건은 첫 [저장] 을 눌러야 생긴다(결정 2026-10-10 — 쓰레기 건 방지).
 *   · 임시 모드(`saved === null`) — 변경 내용 · 임원을 **화면만** 들고 있다. [저장] 한 번에 건 +
 *     변경 내용 + 임원 전부가 한 요청으로 간다. 하나라도 틀리면 아무것도 생기지 않고 칸별 오류가
 *     돌아온다. 성공하면 그 건의 주소로 옮겨 간다(이후는 저장된 건)
 *   · 저장된 건 — 변경 내용은 [저장](PATCH), 임원은 한 명씩 바로 저장된다
 *   · 기본정보(비입주사 법무 회사 정보)도 **같은 [저장]** 으로 간다(2026-10-10 — 저장 버튼 하나).
 *     첫 저장 · PATCH 본문의 `company` 로, 건 · 변경 내용과 한 트랜잭션이다. 사람이 고쳤거나 삐용
 *     기본값으로 채운 칸이 있을 때만 싣는다. 입주사는 ERP 를 읽기만 한다
 *   · 비입주사의 빈 칸은 서버가 삐용 값(회사명 · 대표자명)으로 채워 보여 준다 — 「저장 전」 딱지.
 *     [저장] 해야 법무 회사 정보에 남는다
 *
 * ★ 임시 모드에서 입력이 있으면 나갈 때 확인한다 — 「입력이 있다」 = 변경 내용 · 회사 정보 칸이
 *   처음 상태와 다르거나 임원을 하나라도 추가했다(지웠다가 처음으로 돌아가면 없음). 브라우저 닫기도
 *   같은 기준. 삐용 기본값으로 채운 것만으로는 입력이 아니다(사람이 고쳤을 때만).
 *
 * ★★ 칸 정의를 이 파일에 적지 않는다 — shared `CHANGE_TYPE_DEFS` 대로 그린다. 구분 · 상태 ·
 *    회사유형 이름은 응답에 코드표의 것으로 온다.
 * ★ 저장할 때 내용 검증은 하지 않는다(작성 중 임시 저장). 필수 칸은 `*` 로 알려 주기만 한다 —
 *   검증은 서류작성완료(P→E, 4단계) 때다. 형식 오류(날짜 · 주민번호)는 칸 옆에 바로 알려 주고,
 *   주민번호는 형식이 틀리면 서버가 저장을 거절한다.
 * ★★ 서버는 주민번호 평문을 돌려주지 않는다(마스킹만). 임시 모드의 평문은 사람이 적은 것을 첫 저장
 *    때까지 화면이 들고 있는 것뿐이고, 표에는 마스킹해서 보인다.
 *
 * =============================================================================
 * ★★★ 상태 전이 · 삭제는 이 화면 한 곳이다 (4단계, 2026-10-10 — 한 업무는 한 화면에서)
 * =============================================================================
 * 목록에는 처리 버튼이 없다. 버튼은 서버가 준 `availableTransitions` · `canDelete` 로만 고른다
 * (`StatusActions`). 누를 때 **화면이 본 상태**(`from`)를 함께 보낸다 — 서버가 잠근 뒤 다르면 409 이고,
 * 화면은 상세를 다시 읽어 최신 상태와 버튼으로 다시 그린다.
 *   · [작성완료](P→E)는 **지금 입력을 저장한 뒤** 서버가 저장된 값으로 검증한다(결정 2026-10-10,
 *     `complete`). 검증이 실패하면 입력은 저장된 채 P 로 남고, 칸별 오류가 첫 저장 때와 같은 자리
 *     (변경 내용 칸 · 기본정보 칸 · 임원 줄)에 붙는다. 임시 모드에도 있다. [저장] 은 검증 없는 임시 저장 그대로
 *   · 다른 상태 버튼(서류수정 · 취소 · 삭제 등)은 저장 안 한 입력이 있으면 막는다
 *   · 완료 · 완료 취소 · 취소 · 복원 · 삭제는 확인 창(`CorpChangeConfirmDialog`)을 거친다
 *   · 흐름은 서류작성중(P) → 작성완료(E) → 완료(C), 그리고 취소(X). 제출(A)은 없앴다(2026-10-10)
 * ★ 「출력 이력」 카드(040) — 서류작성중(P)이 아닌 건에. 회사는 자기 건 · 운영사는 전체(RLS).
 * ★ [서류 출력](5-4, 2026-10-11) — 작성완료(E) · 완료(C) 건에만 뜬다(`canPrintCorpChange`). 운영사 · 회사 모두.
 *   대화상자(`CorpChangePrintDialog`)가 서버에서 값을 받아 서류를 하나씩 인쇄한다.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CHANGE_TYPE_DEFS,
  OFFICER_CHANGE_KINDS,
  OFFICER_CHANGE_KIND_LABEL,
  REGISTRATION_DEADLINE_DAYS,
  canPrintCorpChange,
  isRrnShape,
  purposeLines,
  registrationDeadline,
  type CorpChangeFieldDef,
  type CorpChangeFieldError,
  type CorpChangeStatus,
  type OfficerChangeKind,
} from '@swonbiz/shared/domain/corp-change';
import { STALE_STATUS_MESSAGE } from '@swonbiz/shared/domain/corp-change-transition';
import {
  corpChangeDateLine,
  maskRrn,
  normalizeRrn,
  type CorpChangeAddressView,
  type CompanyDefaultField,
  type CorpChangeCompanyInfo,
  type CorpChangeDetailResponse,
  type CorpChangeDraftResponse,
  type CorpChangeOfficerView,
} from '@swonbiz/shared/domain/corp-change-detail';
import { parseDay } from '@swonbiz/shared/domain/day';
import { DIGIT_MASK_RULE, isDigitMaskComplete, maskValue, type DigitMaskKind } from '@swonbiz/shared/domain/masked-caret';
import { maskInput } from '@/features/contracts/form-model';
import { Icon } from '@/components/ds';
import { useKakaoPostcode } from '@/lib/useKakaoPostcode';
import { CorpChangeConfirmDialog, type CorpChangeConfirmKind } from './CorpChangeConfirmDialog';
import { CorpChangePrintDialog } from './CorpChangePrintDialog';
import { CorpChangePrintHistory } from './CorpChangePrintHistory';
import { BizPurposePickerDialog } from './BizPurposePickerDialog';
import { appendPurposeLines } from '@swonbiz/shared/domain/biz-purpose';
import styles from './corp-change-detail.module.css';

interface Props {
  /** 머리 · 기본정보 — 임시 모드는 임시 모드 읽기 응답, 저장된 건은 상세 응답 그대로. */
  draft: CorpChangeDraftResponse;
  /** 저장된 건. **null 이면 임시 모드**(건이 아직 없다). */
  saved: CorpChangeDetailResponse | null;
  /** 「입주사 화면에서 입력」 링크를 보여 줄까 — 그 화면(s030200030)을 받은 사람에게만. */
  canOpenTenantScreen: boolean;
}

export type Address = { zipCode: string; address: string; addressDetail: string };
const EMPTY_ADDRESS: Address = { zipCode: '', address: '', addressDetail: '' };

const toAddress = (v: unknown): Address => {
  if (typeof v !== 'object' || v === null) return EMPTY_ADDRESS;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === 'string' ? x : '');
  return { zipCode: s(o.zipCode), address: s(o.address), addressDetail: s(o.addressDetail) };
};
const viewToAddress = (v: CorpChangeAddressView): Address => ({
  zipCode: v.zipCode ?? '',
  address: v.address ?? '',
  addressDetail: v.addressDetail ?? '',
});
const isEmptyAddress = (a: Address) => a.zipCode === '' && a.address === '' && a.addressDetail === '';
const addressLine = (a: { zipCode: string | null; address: string | null; addressDetail: string | null }) =>
  [a.zipCode ? `(${a.zipCode})` : '', a.address ?? '', a.addressDetail ?? ''].filter(Boolean).join(' ');
const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** 오늘(브라우저 시간대) `YYYY-MM-DD` — 신청기한 계산의 기준일. */
function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 화면이 들고 있는 변경 내용 — 글자 칸은 문자열, 주소 칸은 세 칸. */
type FormPayload = Record<string, string | Address>;

function toForm(fields: readonly CorpChangeFieldDef[], payload: Record<string, unknown>): FormPayload {
  const out: FormPayload = {};
  for (const f of fields) {
    const v = payload[f.name];
    out[f.name] = f.type === 'address' ? toAddress(v) : typeof v === 'string' ? v : '';
  }
  return out;
}

/** 보낼 모양 — 빈 칸은 null. 서버가 같은 규칙으로 다시 읽는다(`parsePayload`). */
function toWire(fields: readonly CorpChangeFieldDef[], form: FormPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.name];
    if (f.type === 'address') {
      const a = v as Address;
      out[f.name] = isEmptyAddress(a) ? null : a;
    } else {
      out[f.name] = (v as string).trim() === '' ? null : v;
    }
  }
  return out;
}

interface Reply<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string; message?: string; errors?: CorpChangeFieldError[] };
}

async function send<T>(method: string, url: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: parsed as Reply<T>['body'] };
  } catch {
    return { ok: false, status: 0, body: { message: '서버에 연결할 수 없습니다' } as Reply<T>['body'] };
  }
}

/** 칸별 오류 → `{ 자리: 문구 }`. 같은 자리에 둘이면 앞의 것. */
const errorMap = (errors: CorpChangeFieldError[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const e of errors ?? []) if (!(e.field in out)) out[e.field] = e.message;
  return out;
};

const LEAVE_MESSAGE = '저장하지 않은 내용이 사라집니다. 이 화면을 나갈까요?';

/**
 * 임시 모드의 [작성완료] 가 검증에 걸렸을 때, 새로 생긴 건의 화면으로 오류를 **한 번** 넘긴다.
 * ★ 브라우저 저장소는 막혀 있을 수 있다 — 실패하면 넘기지 않을 뿐이다(건은 P 로 저장돼 있다).
 */
const COMPLETE_ERRORS_KEY = (id: string) => `corp-change-complete-errors:${id}`;
type HandedErrors = { message: string; errors?: CorpChangeFieldError[] };

function stashCompleteErrors(id: string, message: string, errors?: CorpChangeFieldError[]) {
  try {
    sessionStorage.setItem(COMPLETE_ERRORS_KEY(id), JSON.stringify({ message, errors } satisfies HandedErrors));
  } catch {
    /* 저장소 막힘 — 넘기지 않는다 */
  }
}

function takeCompleteErrors(id: string): HandedErrors | null {
  try {
    const raw = sessionStorage.getItem(COMPLETE_ERRORS_KEY(id));
    if (raw === null) return null;
    sessionStorage.removeItem(COMPLETE_ERRORS_KEY(id));
    return JSON.parse(raw) as HandedErrors;
  } catch {
    return null;
  }
}

// =============================================================================
// 임원 — 화면이 들고 있는 한 명
// =============================================================================

/** 임시 모드의 임원 — 표에 보이는 모양 + 사람이 적은 주민번호(첫 저장 때 보낸다). */
interface LocalOfficer extends CorpChangeOfficerView {
  /** 숫자 13자리 또는 ''. ★ 임시 모드에서만 있다 — 저장된 건의 임원은 마스킹 값만 안다. */
  rrn: string;
}

interface OfficerDraft {
  /** 고치는 중이면 그 임원 ID, 새로 넣는 중이면 null. */
  id: string | null;
  name: string;
  changeKind: OfficerChangeKind;
  position: string;
  effectiveDate: string;
  address: Address;
  /** ★ 새로 적을 때만 채운다. 비우면 「안 바꿈」이다. */
  rrn: string;
  rrnMasked: string | null;
}

export function CorpChangeDetail({ draft, saved: initialSaved, canOpenTenantScreen }: Props) {
  const router = useRouter();
  /**
   * ★ 저장된 건은 **상태로** 든다 — 상태 전이가 돌려준 새 상세, 409 뒤에 다시 읽은 상세로 바꿔
   *   그린다(버튼 · 잠금 · 날짜). 건 ID 는 바뀌지 않는다.
   */
  const [saved, setSaved] = useState<CorpChangeDetailResponse | null>(initialSaved);
  const isNew = saved === null;
  const editable = isNew || saved.editable;
  const def = CHANGE_TYPE_DEFS[draft.changeType];
  const base = initialSaved ? `/api/legal/corp-changes/${encodeURIComponent(initialSaved.id)}` : null;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // ── 기본정보 ────────────────────────────────────────────────────────────
  /**
   * ★ 비입주사 회사 정보는 [저장] 하나로 변경 내용과 함께 간다(결정 2026-10-10). 화면이 입력을 들고
   *   있다가, 사람이 고쳤거나 삐용 기본값(`defaultedFields`)이 있으면 본문의 `company` 로 싣는다.
   * ★ 「저장 안 한 입력」은 사람이 고친 것만이다 — 기본값으로 채운 것만으로는 아니다(처음 입력
   *   상태가 기본값을 담고 있으므로 비교에서 저절로 빠진다).
   * ★ 입주사는 ERP 값을 읽기만 한다 — 싣지 않는다.
   */
  const [company, setCompany] = useState<CorpChangeCompanyInfo>(draft.company);
  const [companyInput, setCompanyInput] = useState<CompanyForm>(() => companyForm(draft.company));
  const [companySaved, setCompanySaved] = useState(() => JSON.stringify(companyForm(draft.company)));
  const companyEditable = editable && !company.isTenant;
  const companyDirty = companyEditable && JSON.stringify(companyInput) !== companySaved;
  const sendCompany = companyEditable && (companyDirty || company.defaultedFields.length > 0);

  // ── 변경 내용 ────────────────────────────────────────────────────────────
  /**
   * ★ 대표주소 변경에는 「변경 전 주소」 칸이 없다(2026-10-10) — 기본정보의 **대표자 자택 주소**가
   *   그 값이다(입주사 = ERP, 비입주사 = 법무 회사 정보). 작성완료 때 비어 있으면 서버가 `company.ceo` 로 거절한다.
   * ★ 본점이전의 새 본점은 채우지 않는다(건물주소+호실 자동 채움 없음 — 결정 2026-10-10).
   */
  const savedPayload = useMemo(() => saved?.payload ?? {}, [saved]);
  const initialForm = useMemo(() => toForm(def.fields, savedPayload), [def.fields, savedPayload]);

  const [form, setForm] = useState<FormPayload>(initialForm);
  const [savedWire, setSavedWire] = useState<string>(() => JSON.stringify(toWire(def.fields, toForm(def.fields, savedPayload))));
  /** 저장 안 한 입력 — 변경 내용 또는 회사 정보를 사람이 고쳤다. [저장] · 상태 버튼 막기가 이것을 본다. */
  const dirty = JSON.stringify(toWire(def.fields, form)) !== savedWire || companyDirty;
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── 임원 — 두 모드 모두 이 자리가 들고 있다 ─────────────────────────────
  const [officers, setOfficers] = useState<LocalOfficer[]>(() => (saved?.officers ?? []).map((o) => ({ ...o, rrn: '' })));
  const tempSeq = useRef(0);

  // ── 임시 모드 — 나갈 때 확인 ─────────────────────────────────────────────
  /** 「입력이 있다」 — 변경 내용 · 회사 정보가 처음 상태와 다르거나 임원이 하나라도 있다(결정 2026-10-10). */
  const hasInput = isNew && (JSON.stringify(form) !== JSON.stringify(initialForm) || officers.length > 0 || companyDirty);
  const leaving = useRef(false);
  useEffect(() => {
    if (!hasInput) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    /*
     * ★ 화면 안의 링크(사이드바 · 「법인변경 목록」)는 beforeunload 가 울리지 않는다 — 클라이언트
     *   전환이라서다. 그래서 문서 맨 위에서 **잡는 단계(capture)** 로 링크 누름을 먼저 본다.
     *   React 의 Link 처리는 그 아래에서 돌므로, 여기서 멈추면 옮겨 가지 않는다.
     * ★ 새 탭(가운데 단추 · Ctrl/⌘ · target=_blank)은 이 화면을 떠나는 것이 아니라 막지 않는다.
     */
    const onClick = (e: MouseEvent) => {
      if (leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self')) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [hasInput]);

  // ── 저장 ────────────────────────────────────────────────────────────────
  /**
   * 지금 화면의 입력을 저장한다 — [저장] 과 [작성완료] 가 같이 쓴다. 검증은 하지 않는다(임시 저장).
   * 실패하면 오류를 띄우고 null. 성공하면 건 ID(첫 저장)나 새 상세(PATCH).
   * ★ busy 는 부르는 쪽이 켜고 끈다.
   */
  const persist = async (): Promise<{ id: string; detail: CorpChangeDetailResponse | null } | null> => {
    setSaveError(null);
    setFieldErrors({});
    const wire = toWire(def.fields, form);
    // 비입주사 회사 정보 — 고쳤거나 기본값이 있을 때만 싣는다(안 실으면 서버가 건드리지 않는다).
    const companyWire = sendCompany ? companyBody(companyInput) : undefined;

    if (isNew) {
      // ★ 첫 저장 — 건 + 변경 내용 + 임원 (+ 회사 정보) 전부를 한 요청으로. 하나라도 틀리면 아무것도 생기지 않는다.
      const res = await send<{ id: string }>('POST', '/api/legal/corp-changes', {
        changeType: draft.changeType,
        orgId: draft.orgId,
        orgCode: draft.orgCode,
        payload: wire,
        company: companyWire,
        officers: officers.map((o) => ({
          name: o.name,
          changeKind: o.changeKind,
          position: o.position,
          effectiveDate: o.effectiveDate,
          zipCode: o.zipCode,
          address: o.address,
          addressDetail: o.addressDetail,
          rrn: o.rrn,
        })),
      });
      if (!res.ok || !res.body.id) {
        setFieldErrors(errorMap(res.body.errors));
        setSaveError(
          res.body.errors && res.body.errors.length > 0
            ? '저장하지 못했습니다 — 표시된 칸을 고쳐 주세요. 건은 만들어지지 않았습니다.'
            : (res.body.message ?? '저장하지 못했습니다'),
        );
        return null;
      }
      return { id: res.body.id, detail: null };
    }

    // ★ 변경 내용 + 회사 정보가 한 트랜잭션이다 — 회사 정보가 틀리면 변경 내용도 안 바뀐다.
    const res = await send<CorpChangeDetailResponse>('PATCH', base!, { payload: wire, company: companyWire });
    if (!res.ok) {
      setFieldErrors(errorMap(res.body.errors));
      setSaveError(res.body.message ?? '저장하지 못했습니다');
      return null;
    }
    applyDetail(res.body);
    return { id: res.body.id, detail: res.body };
  };

  /** 건의 주소로 옮겨 간다 — 나가기 확인을 풀고, 뒤로 가기에 임시 모드가 남지 않게 replace. */
  const goToSaved = (id: string) => {
    leaving.current = true;
    router.replace(`/legal/corp-changes/${encodeURIComponent(id)}`);
  };

  /** [저장] — 검증 없이 임시 저장. */
  const save = async () => {
    setBusy(true);
    const done = await persist();
    if (done && isNew) {
      goToSaved(done.id); // ★ 이제 저장된 건이다
      return;
    }
    setBusy(false);
    if (done) notify('저장했습니다');
  };

  /**
   * [작성완료] — 지금 입력을 **저장한 뒤** 검증하고, 통과하면 P→E(결정 2026-10-10).
   *
   * ★ 두 요청을 차례로 보낸다 — 저장(첫 저장 POST · PATCH) → 전이(POST transition). 새 API 를 두지 않았다:
   *   · 저장이 실패(형식 오류 400 등)하면 전이를 보내지 않는다 — 아무것도 바뀌지 않는다
   *   · 검증 실패(400)면 입력은 저장된 채로 남고 상태는 P 그대로 — 칸별 오류를 붙인다
   *   · 둘 사이에서 끊겨도 결과는 「저장만 됨 · P 그대로」로 검증 실패와 같다
   * ★ 임시 모드는 첫 저장으로 건이 생긴 뒤 전이를 누른다. 검증이 실패해도 건은 P 로 남고, 그 건의
   *   주소로 옮겨 가 오류를 보여 준다(오류는 sessionStorage 로 한 번 넘긴다 — `COMPLETE_ERRORS_KEY`).
   */
  const complete = async () => {
    setBusy(true);
    const done = await persist();
    if (!done) {
      setBusy(false);
      return;
    }
    if (isNew) {
      const res = await send<CorpChangeDetailResponse>('POST', `/api/legal/corp-changes/${encodeURIComponent(done.id)}/transition`, {
        from: 'P',
        to: 'E',
      });
      if (!res.ok) stashCompleteErrors(done.id, res.body.message ?? '작성완료하지 못했습니다', res.body.errors);
      goToSaved(done.id);
      return;
    }
    setBusy(false);
    await transitionNow('E');
  };

  // ── 임원 저장 · 삭제 — 임시 모드는 화면에서만, 저장된 건은 바로 서버로 ──────────
  const saveOfficer = async (d: OfficerDraft): Promise<string | null> => {
    if (isNew) {
      const id = d.id ?? `new-${++tempSeq.current}`;
      const prev = officers.find((o) => o.id === id);
      // ★ 비우면 「안 바꿈」 — 저장된 건과 같은 규칙이다.
      const rrn = d.rrn.trim() !== '' ? (normalizeRrn(d.rrn) ?? '') : (prev?.rrn ?? '');
      const view: LocalOfficer = {
        id,
        name: d.name.trim(),
        changeKind: d.changeKind,
        position: blankToNull(d.position),
        effectiveDate: blankToNull(d.effectiveDate),
        zipCode: blankToNull(d.address.zipCode),
        address: blankToNull(d.address.address),
        addressDetail: blankToNull(d.address.addressDetail),
        rrnMasked: rrn ? maskRrn(rrn) : null,
        sortOrder: prev?.sortOrder ?? officers.length + 1,
        rrn,
      };
      setOfficers((list) => (prev ? list.map((o) => (o.id === id ? view : o)) : [...list, view]));
      setFieldErrors({});
      return null;
    }
    const body = {
      name: d.name,
      changeKind: d.changeKind,
      position: d.position,
      effectiveDate: d.effectiveDate,
      zipCode: d.address.zipCode,
      address: d.address.address,
      addressDetail: d.address.addressDetail,
      // ★ 비우면 「안 바꿈」이다(수정). 새로 넣을 때 비우면 주민번호 없음.
      rrn: d.rrn,
    };
    const res = d.id
      ? await send<CorpChangeOfficerView>('PATCH', `${base}/officers/${encodeURIComponent(d.id)}`, body)
      : await send<CorpChangeOfficerView>('POST', `${base}/officers`, body);
    if (!res.ok) return res.body.message ?? '임원을 저장하지 못했습니다';
    const view: LocalOfficer = { ...res.body, rrn: '' };
    setOfficers((list) => (d.id ? list.map((o) => (o.id === view.id ? view : o)) : [...list, view]));
    notify(d.id ? '임원을 고쳤습니다' : '임원을 추가했습니다');
    return null;
  };

  const removeOfficer = async (id: string): Promise<string | null> => {
    if (!isNew) {
      const res = await send<unknown>('DELETE', `${base}/officers/${encodeURIComponent(id)}`);
      if (!res.ok) return res.body.message ?? '임원을 지우지 못했습니다';
      notify('임원을 지웠습니다');
    }
    setOfficers((list) => list.filter((o) => o.id !== id));
    setFieldErrors({});
    return null;
  };

  /** 첫 저장이 돌려준 임원 오류 — `officers.{i}.{칸}` 를 줄 번호별로 모은다. */
  const officerErrors = useMemo(() => {
    const out: Record<number, string[]> = {};
    for (const [field, message] of Object.entries(fieldErrors)) {
      const m = /^officers\.(\d+)\./.exec(field);
      if (m) (out[Number(m[1])] ??= []).push(message);
    }
    return out;
  }, [fieldErrors]);

  // ── 상태 전이 · 삭제(4단계) — 처리는 이 화면 한 곳이다(목록에는 버튼이 없다) ──────────
  const [confirm, setConfirm] = useState<CorpChangeConfirmKind | null>(null);
  const [printing, setPrinting] = useState(false);
  /** 출력 이력 다시 읽기 — 서류 출력 대화상자를 닫을 때 올린다. */
  const [printLogKey, setPrintLogKey] = useState(0);

  /** 새 상세로 다시 그린다 — 상태 · 버튼 · 변경 내용 · 임원 · 회사 정보 모두 서버 값으로. */
  function applyDetail(d: CorpChangeDetailResponse) {
    setSaved(d);
    setForm(toForm(def.fields, d.payload));
    setSavedWire(JSON.stringify(toWire(def.fields, toForm(def.fields, d.payload))));
    setOfficers(d.officers.map((o) => ({ ...o, rrn: '' })));
    setCompany(d.company);
    setCompanyInput(companyForm(d.company));
    setCompanySaved(JSON.stringify(companyForm(d.company)));
  }

  /**
   * 409 — 화면이 본 상태가 낡았다. 상세를 다시 읽어 최신 상태와 버튼으로 다시 그리고 서버 문구를 띄운다.
   * 다시 읽기마저 안 되면(그새 지워졌으면) 그 사실을 띄운다.
   */
  const reloadAfterConflict = async (message: string) => {
    setConfirm(null);
    const res = await send<CorpChangeDetailResponse>('GET', base!);
    if (res.ok) applyDetail(res.body);
    setFieldErrors({});
    setSaveError(res.ok ? message : res.status === 404 ? '이 건을 찾을 수 없습니다 — 다른 사용자가 지웠을 수 있습니다' : message);
  };

  /** 전이 하나. 실패면 문구(확인 창이 띄운다), 성공 · 409 처리 후면 null. */
  const transition = async (to: CorpChangeStatus, cancelReason: string | null = null): Promise<string | null> => {
    if (!saved) return null;
    setBusy(true);
    setSaveError(null);
    const res = await send<CorpChangeDetailResponse>('POST', `${base}/transition`, { from: saved.status, to, cancelReason });
    setBusy(false);
    if (res.ok) {
      setConfirm(null);
      setFieldErrors({});
      applyDetail(res.body);
      notify(`「${res.body.statusName}」 상태로 바꿨습니다`);
      return null;
    }
    if (res.status === 409) {
      await reloadAfterConflict(res.body.message ?? STALE_STATUS_MESSAGE);
      return null;
    }
    if (res.status === 400 && res.body.errors && res.body.errors.length > 0) {
      // ★ P→E 검증 실패 — 칸 옆에 붙인다(첫 저장 때와 같은 자리 규칙). 상태는 그대로다.
      setConfirm(null);
      setFieldErrors(errorMap(res.body.errors));
      setSaveError(`${res.body.message ?? '입력 내용을 확인하세요'} — 입력은 저장했습니다. 표시된 칸을 고친 뒤 다시 [작성완료] 를 누르세요.`);
      return null;
    }
    return res.body.message ?? '상태를 바꾸지 못했습니다';
  };

  /** 확인 창 없이 바로 누르는 전이(작성완료 · 서류수정) — 실패 문구는 머리 아래 띄운다. */
  const transitionNow = async (to: CorpChangeStatus) => {
    const failed = await transition(to);
    if (failed) setSaveError(failed);
  };

  const removeChange = async (): Promise<string | null> => {
    if (!saved) return null;
    const res = await send<unknown>('DELETE', `${base}?from=${encodeURIComponent(saved.status)}`);
    if (res.ok) {
      leaving.current = true;
      router.replace('/legal/corp-changes');
      return null;
    }
    if (res.status === 409) {
      await reloadAfterConflict(res.body.message ?? STALE_STATUS_MESSAGE);
      return null;
    }
    return res.body.message ?? '삭제하지 못했습니다';
  };

  const onConfirm = (cancelReason: string | null): Promise<string | null> => {
    if (!saved || !confirm) return Promise.resolve(null);
    if (confirm === 'delete') return removeChange();
    if (confirm === 'cancel') return transition('X', cancelReason);
    if (confirm === 'restore') return saved.statusBeforeCancel ? transition(saved.statusBeforeCancel) : Promise.resolve(null);
    return transition(confirm === 'uncomplete' ? 'E' : 'C');
  };

  /** 임시 모드의 [작성완료] 가 검증에 걸려 이 건으로 옮겨 왔다 — 넘겨받은 오류를 한 번 보여 준다. */
  useEffect(() => {
    if (!initialSaved) return;
    const handed = takeCompleteErrors(initialSaved.id);
    if (!handed) return;
    setFieldErrors(errorMap(handed.errors));
    setSaveError(
      handed.errors && handed.errors.length > 0
        ? `${handed.message} — 건은 서류작성중으로 저장했습니다. 표시된 칸을 고친 뒤 다시 [작성완료] 를 누르세요.`
        : `건은 서류작성중으로 저장했습니다 — ${handed.message}`,
    );
  }, [initialSaved]);

  /** 서버가 준 칸 자리 → 그 칸의 오류. 주소 묶음은 `newHqAddress.zipCode` 처럼 아래 자리로 온다. */
  const errorFor = (name: string): string | undefined =>
    fieldErrors[name] ?? Object.entries(fieldErrors).find(([k]) => k.startsWith(`${name}.`))?.[1];

  // ★ 신청기한 — 모든 구분(기준일은 shared `DEADLINE_BASIS`: 결의일 · 이전일 · 전입일 · 임원 효력일 중 가장 이른 날).
  const deadline = registrationDeadline(draft.changeType, toWire(def.fields, form), localToday(), officers);

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadInner}>
          <div className={styles.headTitle}>
            {/*
              ★ 제목 옆은 상태명만 — 「상호변경 · 서류작성중」(결정 2026-10-10). 회사명은 기본정보의
                등기상 상호와 겹쳐서 뺐다. 임시 모드의 상태명은 「서류작성중」(draft.statusName).
            */}
            <div className={styles.titleRow}>
              <h1 className={styles.pageTitle}>{draft.changeTypeName}</h1>
              <span className={styles.titleMeta}>
                · <strong>{saved?.statusName ?? draft.statusName}</strong>
              </span>
            </div>
            {/* 날짜 줄 — 저장된 건만, 상태에 맞는 날짜만(`corpChangeDateLine`). 임시 모드는 없다. */}
            {saved ? (
              <div className={styles.pageNote}>
                {corpChangeDateLine(saved).map((d) => `${d.label} ${d.day}`).join(' · ')}
              </div>
            ) : null}
          </div>
          <div className={styles.headActions}>
            {saved && canPrintCorpChange(saved.status) ? (
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => setPrinting(true)}>
                <Icon name="printer" size={16} />
                서류 출력
              </button>
            ) : null}
            {saved ? (
              <StatusActions
                saved={saved}
                // ★ 작성완료가 아닌 처리(취소 · 삭제 · 서류수정 등)는 저장 안 한 입력이 있으면 막는다.
                //   작성완료는 스스로 저장하므로 이 규칙에서 뺐다(아래 [작성완료], 결정 2026-10-10).
                disabled={busy || dirty}
                onTransition={(to) => void transitionNow(to)}
                onConfirm={setConfirm}
              />
            ) : null}
            <Link href="/legal/corp-changes" className={`${styles.btn} ${styles.btnGhost}`}>
              <Icon name="chevron-left" size={16} />
              법인변경 목록
            </Link>
            {editable ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                // ★ 임시 모드는 늘 누를 수 있다 — 빈 채로 저장하는 것도 사람이 고른 일이다.
                disabled={busy || (!isNew && !dirty)}
                onClick={() => void save()}
              >
                <Icon name="save" size={16} />
                저장
              </button>
            ) : null}
            {/* [작성완료] — 저장 + 검증 + P→E 한 번에. 임시 모드에도 있다(회사 · 운영사 모두 P→E 를 누른다). */}
            {isNew || (saved.status === 'P' && saved.availableTransitions.includes('E')) ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void complete()}>
                <Icon name="check" size={16} />
                작성완료
              </button>
            ) : null}
            {saved && dirty && (saved.canDelete || saved.availableTransitions.some((t) => t !== 'E')) ? (
              <span className={styles.headHint}>저장하지 않은 입력이 있습니다 — 저장한 뒤 다른 처리를 할 수 있습니다</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.formScroll}>
        <div className={styles.formWrap}>
          {saveError ? (
            <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
              <Icon name="circle-alert" size={16} />
              <span>{saveError}</span>
            </div>
          ) : null}
          {saved?.status === 'X' ? (
            <div className={`${styles.banner} ${styles.bannerWarning}`} role="status">
              <Icon name="circle-x" size={16} />
              <span>
                취소된 건입니다{saved.statusBeforeCancelName ? `(취소 직전: ${saved.statusBeforeCancelName})` : ''}.
                {saved.cancelReason ? ` 사유: ${saved.cancelReason}` : ' 사유는 적지 않았습니다.'}
              </span>
            </div>
          ) : saved && !saved.editable ? (
            <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
              <Icon name="lock" size={16} />
              <span>
                「{saved.statusName}」 상태라 변경 내용과 임원을 고칠 수 없습니다. 서류작성중일 때만 고칩니다.
              </span>
            </div>
          ) : null}

          <CompanySection
            company={company}
            form={companyInput}
            editable={companyEditable}
            busy={busy}
            memberTypes={draft.memberTypes}
            canOpenTenantScreen={canOpenTenantScreen}
            errorFor={(key) => errorFor(`company.${key}`)}
            onChange={setCompanyInput}
            onError={notify}
          />

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>변경 내용</h2>
            </div>
            <div className={styles.sectionRule} />

            {deadline ? (
              <div
                className={`${styles.banner} ${deadline.overdue ? styles.bannerWarning : styles.bannerInfo}`}
                role="status"
                style={{ marginBottom: 12 }}
              >
                <Icon name={deadline.overdue ? 'triangle-alert' : 'info'} size={16} />
                <span>
                  {deadline.elapsedDays < 0
                    ? `${deadline.basisLabel}이 아직 오지 않았습니다(${-deadline.elapsedDays}일 뒤). 변경등기 신청기한은 ${deadline.basisLabel}로부터 ${REGISTRATION_DEADLINE_DAYS}일입니다.`
                    : deadline.overdue
                    ? `${deadline.basisLabel}(${deadline.basisDay})로부터 ${deadline.elapsedDays}일이 지났습니다 — 신청기한(${REGISTRATION_DEADLINE_DAYS}일)을 넘겼습니다.`
                    : `${deadline.basisLabel}(${deadline.basisDay})로부터 ${deadline.elapsedDays}일째입니다 — 신청기한은 ${REGISTRATION_DEADLINE_DAYS}일입니다.`}
                </span>
              </div>
            ) : null}

            {/* ★ 칸 수에 맞춰 한 행에(최소 3열) — 주소 · 사업목적은 한 줄을 다 쓴다(결정 2026-10-10). */}
            <div
              className={styles.payloadGrid}
              style={{ gridTemplateColumns: `repeat(${payloadColumns(def.fields)}, minmax(0, 1fr))` }}
            >
              {def.fields.map((f) => (
                <PayloadField
                  key={f.name}
                  def={f}
                  value={form[f.name] ?? (f.type === 'address' ? EMPTY_ADDRESS : '')}
                  disabled={!editable || busy}
                  error={errorFor(f.name)}
                  onChange={(v) => setForm((prev) => ({ ...prev, [f.name]: v }))}
                  onError={notify}
                  onNotice={notify}
                />
              ))}
            </div>
          </section>

          {def.usesOfficers ? (
            <OfficersSection
              officers={officers}
              editable={editable}
              isNew={isNew}
              effectiveDateRequired={def.officerEffectiveDateRequired}
              rowErrors={officerErrors}
              listError={fieldErrors.officers}
              onSave={saveOfficer}
              onRemove={removeOfficer}
            />
          ) : null}

          {/* 출력 이력(040) — 출력할 수 있는 상태이거나 이미 출력한 적이 있을 수 있는 건(취소된 건 포함)에. */}
          {saved && saved.status !== 'P' ? <CorpChangePrintHistory id={saved.id} reloadKey={printLogKey} /> : null}
        </div>
      </div>

      {confirm && saved ? (
        <CorpChangeConfirmDialog
          kind={confirm}
          restoreToName={saved.statusBeforeCancelName}
          onClose={() => setConfirm(null)}
          onConfirm={onConfirm}
        />
      ) : null}

      {printing && saved ? <CorpChangePrintDialog
          id={saved.id}
          onClose={() => {
            setPrinting(false);
            setPrintLogKey((k) => k + 1);
          }}
        /> : null}

      {toast ? (
        <div className={styles.toast} role="status">
          <Icon name="circle-check" size={16} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// 머리의 처리 버튼(4단계)
// =============================================================================

/**
 * 상태별 버튼 — **서버가 준 `availableTransitions` · `canDelete` 로만** 고른다. 이 화면은 전이표를
 * 모른다(`corp-change.ts` 머리말 ★★★ — 화면과 서버가 같은 표를 쓴다).
 *
 *   E→P 서류수정 — 바로 누른다. P→E 작성완료는 여기 없다 — 머리의 [작성완료] 가 저장까지 한다
 *   E→C 완료 · C→E 완료 취소(운영사) · →X 취소 · X→ 복원 · 삭제 — 확인 창을 거친다
 */
export function StatusActions({
  saved,
  disabled,
  onTransition,
  onConfirm,
}: {
  /** ★ 법인설립 상세(10-4)도 쓴다 — 상태 · 전이 · 삭제 네 값만 본다. */
  saved: Pick<CorpChangeDetailResponse, 'status' | 'availableTransitions' | 'canDelete' | 'statusBeforeCancel'>;
  disabled: boolean;
  onTransition: (to: CorpChangeStatus) => void;
  onConfirm: (kind: CorpChangeConfirmKind) => void;
}) {
  const can = (to: CorpChangeStatus) => saved.availableTransitions.includes(to);
  const from = saved.status;
  const ghost = `${styles.btn} ${styles.btnGhost}`;
  const danger = `${styles.btn} ${styles.btnDanger}`;
  const primary = `${styles.btn} ${styles.btnPrimary}`;

  return (
    <>
      {saved.canDelete ? (
        <button type="button" className={danger} disabled={disabled} onClick={() => onConfirm('delete')}>
          <Icon name="trash-2" size={16} />
          삭제
        </button>
      ) : null}
      {from !== 'X' && can('X') ? (
        <button type="button" className={danger} disabled={disabled} onClick={() => onConfirm('cancel')}>
          <Icon name="circle-x" size={16} />
          취소
        </button>
      ) : null}
      {from === 'X' && saved.statusBeforeCancel && can(saved.statusBeforeCancel) ? (
        <button type="button" className={ghost} disabled={disabled} onClick={() => onConfirm('restore')}>
          <Icon name="rotate-ccw" size={16} />
          복원
        </button>
      ) : null}
      {from === 'C' && can('E') ? (
        <button type="button" className={ghost} disabled={disabled} onClick={() => onConfirm('uncomplete')}>
          <Icon name="rotate-ccw" size={16} />
          완료 취소
        </button>
      ) : null}
      {from === 'E' && can('P') ? (
        <button type="button" className={ghost} disabled={disabled} onClick={() => onTransition('P')}>
          <Icon name="pencil-line" size={16} />
          서류수정
        </button>
      ) : null}
      {from === 'E' && can('C') ? (
        <button type="button" className={primary} disabled={disabled} onClick={() => onConfirm('complete')}>
          <Icon name="circle-check" size={16} />
          완료
        </button>
      ) : null}
    </>
  );
}

// =============================================================================
// 변경 내용 칸 하나
// =============================================================================

function PayloadField({
  def,
  value,
  disabled,
  error,
  note,
  onChange,
  onError,
  onNotice,
}: {
  def: CorpChangeFieldDef;
  value: string | Address;
  disabled: boolean;
  /** 서버가 돌려준 이 칸의 오류. */
  error?: string;
  note?: string;
  onChange: (v: string | Address) => void;
  onError: (message: string) => void;
  /** 알림(토스트) — 사업목적 고르기 결과. */
  onNotice?: (message: string) => void;
}) {
  const textareaId = useId();
  const [picking, setPicking] = useState(false);
  const label = (
    <span className={styles.label}>
      {def.label} {def.required ? <span className={styles.req}>*</span> : null}
    </span>
  );
  const serverError = error ? <span className={styles.fieldError}>{error}</span> : null;

  if (def.type === 'address') {
    return (
      <div className={`${styles.field} ${styles.spanAll}`}>
        {label}
        {note ? <span className={styles.hint}>{note}</span> : null}
        <AddressInput value={value as Address} disabled={disabled} onChange={onChange} onError={onError} />
        {serverError}
      </div>
    );
  }

  const text = value as string;
  if (def.type === 'textarea') {
    // ★ 사업목적(purposes)만 [목록에서 고르기] 가 붙는다(30-6, 결정 2026-10-11) — 고른 문구를 끝에 줄로
    //   덧붙인다(이미 있는 줄은 건너뜀, shared `appendPurposeLines`). 저장은 텍스트 그대로이고 직접 입력도
    //   그대로다. 카탈로그를 고치는 버튼은 두지 않는다 — 고치는 자리는 030 화면 하나다.
    const pickable = def.name === 'purposes';
    return (
      <div className={`${styles.field} ${styles.spanAll}`}>
        <div className={styles.fieldHead}>
          <label htmlFor={textareaId}>{label}</label>
          {pickable ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
              disabled={disabled}
              onClick={() => setPicking(true)}
            >
              <Icon name="search" size={14} />
              목록에서 고르기
            </button>
          ) : null}
        </div>
        <span className={styles.hint}>{def.hint ?? '한 줄에 하나씩 적습니다'}</span>
        <textarea
          id={textareaId}
          className={`${styles.textarea}${error ? ` ${styles.inputInvalid}` : ''}`}
          rows={4}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {serverError}
        {picking ? (
          <BizPurposePickerDialog
            existing={purposeLines(text)}
            onClose={() => setPicking(false)}
            onPick={(texts) => {
              const r = appendPurposeLines(text, texts);
              setPicking(false);
              if (r.added.length > 0) onChange(r.text);
              onNotice?.(
                r.skipped.length > 0
                  ? `${r.added.length}개를 넣었습니다 — 이미 있는 ${r.skipped.length}개는 건너뛰었습니다`
                  : `${r.added.length}개를 넣었습니다`,
              );
            }}
          />
        ) : null}
      </div>
    );
  }

  if (def.type === 'date') {
    // ★ 형식 안내만 한다 — 저장은 막지 않는다(임시 저장). 날짜 칸이라 보통은 생기지 않고,
    //   옛 자료가 틀린 값을 들고 있을 때 보인다.
    const bad = text !== '' && parseDay(text) === null;
    return (
      <label className={styles.field}>
        {label}
        <input
          type="date"
          className={`${styles.input} ${styles.tabular}${bad || error ? ` ${styles.inputInvalid}` : ''}`}
          value={bad ? '' : text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {bad ? <span className={styles.fieldError}>날짜(YYYY-MM-DD)가 아닙니다: {text}</span> : serverError}
      </label>
    );
  }

  return (
    <label className={styles.field}>
      {label}
      <input
        className={`${styles.input}${error ? ` ${styles.inputInvalid}` : ''}`}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {serverError}
    </label>
  );
}

/**
 * 주소 한 줄 — 우편번호 · 기본주소는 카카오 주소 검색으로 채우고, 상세주소는 손으로 적는다.
 * ★ 계약 폼과 같은 부품(`useKakaoPostcode`)이다. 팝업은 상세주소를 건드리지 않는다.
 */
export function AddressInput({
  value,
  disabled,
  compact = false,
  onChange,
  onError,
}: {
  value: Address;
  disabled: boolean;
  /** 반 줄 — 기본정보의 두 주소를 한 행에 나란히 둘 때. 칸이 좁고 검색 단추는 그림만. */
  compact?: boolean;
  onChange: (v: Address) => void;
  onError: (message: string) => void;
}) {
  const postcode = useKakaoPostcode(onError);
  return (
    <div className={`${styles.addrRow}${compact ? ` ${styles.addrCompact}` : ''}`}>
      <input
        className={`${styles.input} ${styles.tabular} ${styles.addrZip}`}
        readOnly
        placeholder="우편번호"
        value={value.zipCode}
      />
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        style={{ height: 38, ...(compact ? { padding: '0 10px' } : {}) }}
        disabled={disabled}
        aria-label="주소 검색"
        title="주소 검색"
        onClick={() => postcode.open((r) => onChange({ ...value, zipCode: r.zipCode, address: r.address }))}
      >
        <Icon name="search" size={14} />
        {compact ? null : '주소 검색'}
      </button>
      <input className={`${styles.input} ${styles.addrMain}`} readOnly placeholder="기본주소" value={value.address} />
      <input
        className={`${styles.input} ${styles.addrDetail}`}
        placeholder="상세주소(동·호수 등)"
        value={value.addressDetail}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, addressDetail: e.target.value })}
      />
    </div>
  );
}

// =============================================================================
// 기본정보
// =============================================================================

interface CompanyForm {
  legalName: string;
  memberType: string;
  corpNumber: string;
  bizNumber: string;
  ceoName: string;
  tel: string;
  head: Address;
  ceo: Address;
}

/**
 * 숫자 칸의 형식 — 계약 폼과 같은 마스크(shared `maskValue`). 저장된 값 · 기본값(ERP · 삐용)도
 * 이 모양으로 보여 준다. ★ 표시만 바꾼다 — DB 값은 고쳐 쓰지 않는다.
 */
const DIGIT_KINDS = { corpNumber: 'corpno', bizNumber: 'bizno', tel: 'phone' } as const satisfies Partial<
  Record<keyof CompanyForm, DigitMaskKind>
>;
const shown = (kind: DigitMaskKind, v: string | null) => (v ? maskValue(kind, v) : '');

const companyForm = (c: CorpChangeCompanyInfo): CompanyForm => ({
  legalName: c.legalName ?? '',
  memberType: c.memberType ?? '',
  corpNumber: shown('corpno', c.corpNumber),
  bizNumber: shown('bizno', c.bizNumber),
  ceoName: c.ceoName ?? '',
  tel: shown('phone', c.tel),
  head: viewToAddress(c.head),
  ceo: viewToAddress(c.ceo),
});

/** 저장 본문의 `company` — 칸 전체(통째로 바꾼다). 빈 칸은 null. */
const companyBody = (f: CompanyForm) => ({
  legalName: blankToNull(f.legalName),
  memberType: blankToNull(f.memberType),
  corpNumber: blankToNull(f.corpNumber),
  bizNumber: blankToNull(f.bizNumber),
  ceoName: blankToNull(f.ceoName),
  tel: blankToNull(f.tel),
  headZipCode: blankToNull(f.head.zipCode),
  headAddress: blankToNull(f.head.address),
  headAddressDetail: blankToNull(f.head.addressDetail),
  ceoZipCode: blankToNull(f.ceo.zipCode),
  ceoAddress: blankToNull(f.ceo.address),
  ceoAddressDetail: blankToNull(f.ceo.addressDetail),
});

/** 변경 내용 칸의 열 수 — 한 행에 들어가는 칸(글자 · 날짜) 수, 최소 3. 주소 · 사업목적은 한 줄을 다 쓴다. */
function payloadColumns(fields: readonly CorpChangeFieldDef[]): number {
  return Math.max(3, fields.filter((f) => f.type === 'text' || f.type === 'date').length);
}

/**
 * 기본정보 — 입주사는 ERP 를 읽기만, 비입주사는 법무 회사 정보를 여기서 고친다.
 * ★ 저장은 머리의 [저장] 하나다(결정 2026-10-10) — 이 부품은 입력만 하고, 값은 부모가 든다.
 * ★ 삐용 기본값으로 채운 칸(`defaultedFields`)은 고치기 전까지 「저장 전」 딱지를 붙인다.
 */
function CompanySection({
  company,
  form,
  editable,
  busy,
  memberTypes,
  canOpenTenantScreen,
  errorFor,
  onChange,
  onError,
}: {
  company: CorpChangeCompanyInfo;
  form: CompanyForm;
  /** 비입주사이고 건을 고칠 수 있다(임시 모드 · 서류작성중). */
  editable: boolean;
  busy: boolean;
  memberTypes: { code: string; name: string }[];
  canOpenTenantScreen: boolean;
  /** 저장이 돌려준 이 칸의 오류(`company.{칸}`). */
  errorFor: (key: string) => string | undefined;
  onChange: (next: CompanyForm) => void;
  onError: (message: string) => void;
}) {
  const badge = (
    <span className={`${styles.badge} ${company.isTenant ? styles.tenant : styles.nonTenant}`}>
      {company.isTenant ? '입주사' : '비입주사'}
    </span>
  );

  if (company.isTenant) {
    // ★ 입주사 = ERP 를 읽기만 한다. 비어 있으면 입주사 화면으로 보낸다 — 법무는 ERP 에 쓰지 않는다.
    const rows: [string, string | null, boolean?][] = [
      ['회사명', company.legalName, true],
      ['회사유형', company.memberTypeName],
      ['대표자', company.ceoName],
      ['법인등록번호', shown('corpno', company.corpNumber) || null],
      ['사업자등록번호', shown('bizno', company.bizNumber) || null],
      ['전화', shown('phone', company.tel) || null, true],
      ['본점 주소', addressLine(company.head) || null, true],
      ['대표자 자택 주소', addressLine(company.ceo) || null, true],
    ];
    const missing = rows.some(([, v]) => v === null || v === '');
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <h2>기본정보</h2>
            {badge}
          </div>
          {missing && canOpenTenantScreen && company.tenantCompanyId ? (
            <Link
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
              href={`/tenants/contracts?companyId=${encodeURIComponent(company.tenantCompanyId)}`}
            >
              입주사 화면에서 입력
            </Link>
          ) : null}
        </div>
        <div className={styles.sectionRule} />
        <p className={styles.sectionNote}>입주사 정보는 ERP 입주사 정보를 읽어 보여 줍니다. 여기서는 고치지 않습니다.</p>
        <div className={styles.grid4}>
          {rows.map(([label, value, wide]) => (
            <div key={label} className={`${styles.field}${wide ? ` ${styles.span2}` : ''}`}>
              <span className={styles.label}>{label}</span>
              <span className={`${styles.readValue}${value ? '' : ` ${styles.readEmpty}`}`}>{value || '—'}</span>
              {/* 대표주소 변경의 작성완료 — 자택 주소가 비면 서버가 company.ceo 로 거절한다(입주사 화면에서 입력) */}
              {label === '대표자 자택 주소' && errorFor('ceo') ? <span className={styles.fieldError}>{errorFor('ceo')}</span> : null}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const disabled = !editable || busy;
  const set = (patch: Partial<CompanyForm>) => onChange({ ...form, ...patch });
  /** 기본값(삐용 · 상호로 추정한 회사유형)으로 채워 보여 주는 중 — 그 값 그대로면 딱지. 사람이 고치면 사라진다. */
  const defaulted = (key: CompanyDefaultField) =>
    editable && company.defaultedFields.includes(key) && form[key] === (company[key] ?? '');
  const fieldError = (key: string) => {
    const e = errorFor(key);
    return e ? <span className={styles.fieldError}>{e}</span> : null;
  };

  const preTag = (key: CompanyDefaultField) => (defaulted(key) ? <span className={styles.preTag}>저장 전</span> : null);

  const text = (key: Exclude<CompanyDefaultField, 'memberType'>, label: string, wide = false) => {
    // ★ 숫자 칸 — 숫자만 받고 하이픈은 자동(계약 폼과 같은 `maskInput`). 자릿수가 틀리면 칸 옆에 알린다.
    const kind = (DIGIT_KINDS as Partial<Record<string, DigitMaskKind>>)[key];
    const short = kind !== undefined && !isDigitMaskComplete(kind, form[key]);
    return (
      <label className={`${styles.field}${wide ? ` ${styles.span2}` : ''}`}>
        <span className={styles.label}>
          {label}
          {preTag(key)}
        </span>
        <input
          className={`${styles.input}${kind ? ` ${styles.tabular}` : ''}${errorFor(key) || short ? ` ${styles.inputInvalid}` : ''}`}
          value={form[key]}
          disabled={disabled}
          inputMode={kind ? 'numeric' : undefined}
          onChange={(e) => set({ [key]: kind ? maskInput(e.currentTarget, kind) : e.target.value })}
        />
        {short ? <span className={styles.fieldError}>{DIGIT_MASK_RULE[kind]}로 입력하세요</span> : fieldError(key)}
      </label>
    );
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <h2>기본정보</h2>
          {badge}
        </div>
      </div>
      <div className={styles.sectionRule} />
      <div className={styles.grid4}>
        {text('legalName', '등기상 상호', true)}
        <label className={styles.field}>
          <span className={styles.label}>
            회사유형
            {preTag('memberType')}
          </span>
          <select
            className={`${styles.select}${errorFor('memberType') ? ` ${styles.inputInvalid}` : ''}`}
            value={form.memberType}
            disabled={disabled}
            onChange={(e) => set({ memberType: e.target.value })}
          >
            <option value="">선택</option>
            {memberTypes.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
          {fieldError('memberType')}
        </label>
        {text('ceoName', '대표자')}
        {text('corpNumber', '법인등록번호')}
        {text('bizNumber', '사업자등록번호')}
        {text('tel', '전화', true)}
        {/* 두 주소를 한 행에 나란히(반 줄씩) — 한 화면에 들어오게(결정 2026-10-10) */}
        <div className={`${styles.field} ${styles.span2}`}>
          <span className={styles.label}>본점 주소</span>
          <AddressInput value={form.head} disabled={disabled} compact onChange={(head) => set({ head })} onError={onError} />
          {fieldError('headAddress') ?? fieldError('headZipCode') ?? fieldError('headAddressDetail')}
        </div>
        <div className={`${styles.field} ${styles.span2}`}>
          <span className={styles.label}>대표자 자택 주소</span>
          <AddressInput value={form.ceo} disabled={disabled} compact onChange={(ceo) => set({ ceo })} onError={onError} />
          {fieldError('ceo') ?? fieldError('ceoAddress') ?? fieldError('ceoZipCode') ?? fieldError('ceoAddressDetail')}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// 임원
// =============================================================================

const blankDraft = (): OfficerDraft => ({
  id: null,
  name: '',
  changeKind: 'APPOINT',
  position: '',
  effectiveDate: '',
  address: EMPTY_ADDRESS,
  rrn: '',
  rrnMasked: null,
});

const draftOf = (o: CorpChangeOfficerView): OfficerDraft => ({
  id: o.id,
  name: o.name,
  changeKind: (OFFICER_CHANGE_KINDS as readonly string[]).includes(o.changeKind)
    ? (o.changeKind as OfficerChangeKind)
    : 'APPOINT',
  position: o.position ?? '',
  effectiveDate: o.effectiveDate ?? '',
  address: { zipCode: o.zipCode ?? '', address: o.address ?? '', addressDetail: o.addressDetail ?? '' },
  rrn: '',
  rrnMasked: o.rrnMasked,
});

/**
 * 임원 표 + 입력 칸. 저장 · 삭제가 어디로 가는지는 부모가 정한다(임시 모드는 화면에서만,
 * 저장된 건은 바로 서버로). 이 부품은 그리기와 입력만 한다.
 */
function OfficersSection({
  officers,
  editable,
  isNew,
  effectiveDateRequired,
  rowErrors,
  listError,
  onSave,
  onRemove,
}: {
  officers: CorpChangeOfficerView[];
  editable: boolean;
  isNew: boolean;
  /** 효력일 필수 표시 — 구분 정의(`officerEffectiveDateRequired`) 그대로. 검증은 서버가 작성완료 때. */
  effectiveDateRequired: boolean;
  /** 첫 저장이 돌려준 줄별 오류(보낸 순서 = 표의 순서). */
  rowErrors: Record<number, string[]>;
  listError?: string;
  /** 실패하면 문구, 성공하면 null. */
  onSave: (d: OfficerDraft) => Promise<string | null>;
  onRemove: (id: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<OfficerDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rrnBad = draft !== null && draft.rrn.trim() !== '' && !isRrnShape(draft.rrn);

  const save = async () => {
    if (!draft || rrnBad) return;
    setBusy(true);
    setError(null);
    const failed = await onSave(draft);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    // ★ 칸의 주민번호 평문을 지운다 — 저장된 건은 서버로 갔고, 임시 모드는 목록이 들고 있다.
    setDraft(null);
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    const failed = await onRemove(id);
    setBusy(false);
    setConfirmDelete(null);
    if (failed) {
      setError(failed);
      return;
    }
    if (draft?.id === id) setDraft(null);
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <h2>임원</h2>
          <span className={styles.muted}>{officers.length}명</span>
        </div>
        {editable ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={busy || (draft !== null && draft.id === null)}
            onClick={() => {
              setError(null);
              setDraft(blankDraft());
            }}
          >
            <Icon name="plus" size={16} />
            임원 추가
          </button>
        ) : null}
      </div>
      <div className={styles.sectionRule} />
      {isNew ? (
        <p className={styles.sectionNote}>임원은 위의 [저장] 을 누를 때 건과 함께 저장됩니다.</p>
      ) : null}

      {error || listError ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert" style={{ marginBottom: 16 }}>
          <Icon name="circle-alert" size={16} />
          <span>{error ?? listError}</span>
        </div>
      ) : null}

      <div className={styles.oTable}>
        <div className={styles.oHead}>
          <span>성명</span>
          <span>구분</span>
          <span>직위</span>
          <span>효력일</span>
          <span>주민등록번호</span>
          <span>주소</span>
          <span />
        </div>
        {officers.length === 0 ? (
          <div className={styles.empty}>등록된 임원이 없습니다</div>
        ) : (
          officers.map((o, i) => (
            <div key={o.id} className={styles.oItem}>
              <div className={`${styles.oRow}${draft?.id === o.id ? ` ${styles.oRowEditing}` : ''}`}>
                <span className={o.name ? styles.ellipsis : styles.muted}>{o.name || '(성명 없음)'}</span>
                <span>{OFFICER_CHANGE_KIND_LABEL[o.changeKind as OfficerChangeKind] ?? o.changeKind}</span>
                <span className={o.position ? styles.ellipsis : styles.muted}>{o.position ?? '—'}</span>
                <span className={`${styles.tabular}${o.effectiveDate ? '' : ` ${styles.muted}`}`}>{o.effectiveDate ?? '—'}</span>
                <span className={`${styles.tabular}${o.rrnMasked ? '' : ` ${styles.muted}`}`}>{o.rrnMasked ?? '—'}</span>
                <span className={styles.ellipsis} title={addressLine(o)}>
                  {addressLine(o) || <span className={styles.muted}>—</span>}
                </span>
                <span className={styles.oActions}>
                  {editable ? (
                    confirmDelete === o.id ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger} ${styles.btnXs}`}
                          disabled={busy}
                          onClick={() => void remove(o.id)}
                        >
                          삭제 확인
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                          disabled={busy}
                          onClick={() => setConfirmDelete(null)}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setDraft(draftOf(o));
                          }}
                        >
                          <Icon name="pencil-line" size={14} />
                          수정
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger} ${styles.btnXs}`}
                          disabled={busy}
                          aria-label={`${o.name || '임원'} 삭제`}
                          onClick={() => setConfirmDelete(o.id)}
                        >
                          <Icon name="trash-2" size={14} />
                        </button>
                      </>
                    )
                  ) : null}
                </span>
              </div>
              {rowErrors[i] ? (
                <div className={styles.oRowError} role="alert">
                  {rowErrors[i].join(' · ')}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {draft && editable ? (
        <div className={styles.editor}>
          <p className={styles.editorHead}>{draft.id ? '임원 수정' : '임원 추가'}</p>
          <div className={styles.grid4}>
            <label className={styles.field}>
              <span className={styles.label}>
                성명 <span className={styles.req}>*</span>
              </span>
              <input
                className={styles.input}
                value={draft.name}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                구분 <span className={styles.req}>*</span>
              </span>
              <select
                className={styles.select}
                value={draft.changeKind}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, changeKind: e.target.value as OfficerChangeKind })}
              >
                {OFFICER_CHANGE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {OFFICER_CHANGE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                직위 <span className={styles.req}>*</span>
              </span>
              <input
                className={styles.input}
                value={draft.position}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, position: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>
                효력일 {effectiveDateRequired ? <span className={styles.req}>*</span> : null}
              </span>
              <input
                type="date"
                className={`${styles.input} ${styles.tabular}`}
                value={draft.effectiveDate}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.span2}`}>
              <span className={styles.label}>주민등록번호</span>
              <input
                className={`${styles.input} ${styles.tabular}${rrnBad ? ` ${styles.inputInvalid}` : ''}`}
                value={draft.rrn}
                disabled={busy}
                inputMode="numeric"
                autoComplete="off"
                placeholder={draft.rrnMasked ? `${draft.rrnMasked} — 바꿀 때만 입력` : '숫자 13자리'}
                onChange={(e) => setDraft({ ...draft, rrn: e.target.value })}
              />
              {rrnBad ? (
                <span className={styles.fieldError}>주민등록번호는 숫자 13자리로 입력하세요</span>
              ) : draft.rrnMasked ? (
                <span className={styles.hint}>비워 두면 저장된 번호를 그대로 둡니다</span>
              ) : null}
            </label>
            <div className={`${styles.field} ${styles.span4}`}>
              <span className={styles.label}>주소</span>
              <AddressInput
                value={draft.address}
                disabled={busy}
                onChange={(address) => setDraft({ ...draft, address })}
                onError={setError}
              />
            </div>
          </div>
          <div className={styles.editorActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              취소
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={busy || rrnBad}
              onClick={() => void save()}
            >
              <Icon name="save" size={16} />
              {isNew ? (draft.id ? '목록에 반영' : '목록에 추가') : draft.id ? '임원 저장' : '임원 추가'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
