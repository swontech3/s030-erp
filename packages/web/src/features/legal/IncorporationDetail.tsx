'use client';

/**
 * s040100020 법인설립 상세 — 회사 · 자본·주식 · 설립 정보 · 사람 · 사업목적 · 상태 전이 · 삭제(10-4, 2026-10-11).
 * 서류 출력은 10-5 다.
 *
 * ★ 시안이 없다. 법인변경 상세(`CorpChangeDetail`)와 같은 틀 · 같은 CSS · 같은 동작이다:
 *   · 건은 첫 [저장] 때 생긴다. 임시 모드(`saved === null`)는 설립 정보 · 사람을 **화면만** 들고 있다가
 *     첫 저장 한 요청으로 보낸다(하나라도 틀리면 아무것도 생기지 않는다). 저장된 건은 설립 정보를 [저장]
 *     (PATCH)으로, 사람은 한 명씩 바로 저장한다
 *   · 저장 버튼은 하나다. [작성완료] = 지금 입력 저장 → 검증 → P→E 한 번에(검증 실패면 저장만 · P 그대로,
 *     칸별 오류). 임시 모드에도 있다
 *   · 제목 옆은 상태명만, 날짜 줄은 상태에 맞는 날짜만(`corpChangeDateLine`)
 *   · 상태 버튼은 서버의 `availableTransitions` · `canDelete` 로만 고른다(`StatusActions` 를 함께 쓴다).
 *     확인 창은 법무 전용 창(`CorpChangeConfirmDialog`)을 그대로 쓴다
 *   · 임시 모드에서 입력이 있으면 나갈 때 확인한다
 *
 * ★★ 칸 이름 · 필수 표시 · 안내는 이 파일에 적지 않는다 — shared `INCORP_FIELD_DEFS` 를 읽는다. 이 파일이
 *    정하는 것은 **묶음(배치)** 뿐이다(회사 · 자본·주식 · 설립 정보 · 사람 · 사업목적, 결정 2026-10-11).
 * ★ 상호는 순수 상호 + 위치(앞/뒤, 코드표 `NAME_POSITION`) — 합친 상호를 미리 보여 준다(shared
 *   `composeIncorporationName`, 서류에 쓰이는 이름과 같은 함수).
 * ★ 사업목적은 [목록에서 고르기] 팝업(`BizPurposePickerDialog`)을 그대로 쓴다 — 카탈로그를 고치는 버튼은 없다.
 * ★ 저장할 때 내용 검증은 하지 않는다(작성 중 임시 저장) — 검증은 작성완료 때 서버가. 경고(1주 100원 미만 ·
 *   자본금 10억 이상인데 감사 없음)는 막지 않고 지금 입력으로 보여 준다(shared `incorporationWarnings`).
 * ★★ 서버는 주민번호 평문을 돌려주지 않는다(마스킹만). 임시 모드의 평문은 첫 저장 때까지 화면이 들고 있는
 *    것뿐이고, 표에는 마스킹해서 보인다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isRrnShape, purposeLines, type CorpChangeFieldError, type CorpChangeStatus } from '@swonbiz/shared/domain/corp-change';
import { STALE_STATUS_MESSAGE } from '@swonbiz/shared/domain/corp-change-transition';
import { corpChangeDateLine, normalizeRrn } from '@swonbiz/shared/domain/corp-change-detail';
import {
  INCORP_FIELD_DEFS,
  incorporationWarnings,
  type IncorpFieldDef,
  type IncorporationInfo,
} from '@swonbiz/shared/domain/incorporation';
import {
  composeIncorporationName,
  maskRrn,
  type IncorpPersonView,
  type IncorporationDetailResponse,
  type IncorporationDraftResponse,
} from '@swonbiz/shared/domain/incorporation-detail';
import { appendPurposeLines } from '@swonbiz/shared/domain/biz-purpose';
import { parseDay } from '@swonbiz/shared/domain/day';
import { formatMoneyInput } from '@/features/contracts/form-model';
import { Icon } from '@/components/ds';
import { AddressInput, StatusActions, type Address } from './CorpChangeDetail';
import { CorpChangeConfirmDialog, type CorpChangeConfirmKind } from './CorpChangeConfirmDialog';
import { BizPurposePickerDialog } from './BizPurposePickerDialog';
import styles from './corp-change-detail.module.css';

interface Props {
  /** 머리 · 선택지 — 임시 모드는 임시 모드 읽기 응답, 저장된 건은 상세 응답 그대로. */
  draft: IncorporationDraftResponse;
  /** 저장된 건. **null 이면 임시 모드**(건이 아직 없다). */
  saved: IncorporationDetailResponse | null;
}

type InfoName = keyof IncorporationInfo;

const EMPTY_ADDRESS: Address = { zipCode: '', address: '', addressDetail: '' };
const isEmptyAddress = (a: Address) => a.zipCode === '' && a.address === '' && a.addressDetail === '';
const addressLine = (a: { zipCode: string | null; address: string | null; addressDetail: string | null }) =>
  [a.zipCode ? `(${a.zipCode})` : '', a.address ?? '', a.addressDetail ?? ''].filter(Boolean).join(' ');
const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** 숫자 칸 표시 — 콤마. 보낼 때는 콤마를 뗀 숫자(`toCount`). */
const showCount = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '');
const toCount = (s: string): number | null => {
  const digits = s.replace(/[^0-9]/g, '');
  return digits === '' ? null : Number(digits);
};

const DEF: Record<InfoName, IncorpFieldDef> = Object.fromEntries(INCORP_FIELD_DEFS.map((d) => [d.name, d])) as Record<
  InfoName,
  IncorpFieldDef
>;

/** 묶음 — 배치만 정한다(칸 정의는 shared). 상호(국문) · 본점은 회사 묶음이 따로 그린다. */
const CAPITAL_FIELDS: InfoName[] = ['capitalAmount', 'parValue', 'unitsAuthorized', 'unitsIssued'];
const SETUP_FIELDS: InfoName[] = ['publicNoticeMethod', 'fiscalStart', 'fiscalEnd', 'plannedDate'];

/** 화면이 들고 있는 설립 정보 — 글자 칸은 문자열(숫자 칸은 콤마 붙은 문자열), 본점은 세 칸. */
interface InfoForm {
  text: Record<Exclude<InfoName, 'hq'>, string>;
  hq: Address;
  companyTypePosition: string;
}

function toInfoForm(info: Partial<Record<InfoName, unknown>> & { companyTypePosition?: string | null }, defaultPosition: string): InfoForm {
  const text = {} as InfoForm['text'];
  for (const d of INCORP_FIELD_DEFS) {
    if (d.name === 'hq') continue;
    const v = info[d.name];
    text[d.name] = d.type === 'amount' || d.type === 'count' ? showCount(v as number | null) : typeof v === 'string' ? v : '';
  }
  const hq = info.hq as { zipCode?: string | null; address?: string | null; addressDetail?: string | null } | null | undefined;
  return {
    text,
    hq: hq ? { zipCode: hq.zipCode ?? '', address: hq.address ?? '', addressDetail: hq.addressDetail ?? '' } : EMPTY_ADDRESS,
    companyTypePosition: info.companyTypePosition ?? defaultPosition,
  };
}

/** 보낼 모양 `info` — 빈 칸은 null. 서버가 같은 규칙으로 다시 읽는다(`parseIncorpInfo`). */
function toWire(form: InfoForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of INCORP_FIELD_DEFS) {
    if (d.name === 'hq') {
      out.hq = isEmptyAddress(form.hq) ? null : form.hq;
      continue;
    }
    const v = form.text[d.name];
    out[d.name] = d.type === 'amount' || d.type === 'count' ? toCount(v) : blankToNull(v);
  }
  out.companyTypePosition = form.companyTypePosition || null;
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

/** 임시 모드의 [작성완료] 가 검증에 걸렸을 때, 새로 생긴 건의 화면으로 오류를 **한 번** 넘긴다(법인변경과 같다). */
const COMPLETE_ERRORS_KEY = (id: string) => `incorporation-complete-errors:${id}`;
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
// 사람 — 화면이 들고 있는 한 명
// =============================================================================

/** 화면의 사람 — 표에 보이는 모양 + 사람이 적은 주민번호(임시 모드에서만, 첫 저장 때 보낸다). */
interface LocalPerson extends IncorpPersonView {
  /** 숫자 13자리 또는 ''. ★ 저장된 건의 사람은 마스킹 값만 안다. */
  rrn: string;
}

interface PersonDraft {
  /** 고치는 중이면 그 사람 ID, 새로 넣는 중이면 null. */
  id: string | null;
  name: string;
  isFounder: boolean;
  isDirector: boolean;
  isAuditor: boolean;
  isRepresentative: boolean;
  /** 인수 주식 수 — 콤마 붙은 문자열. */
  units: string;
  appointmentDate: string;
  address: Address;
  /** ★ 새로 적을 때만 채운다. 비우면 「안 바꿈」이다. */
  rrn: string;
  rrnMasked: string | null;
}

const ROLES = [
  ['isFounder', '발기인'],
  ['isDirector', '이사'],
  ['isAuditor', '감사'],
  ['isRepresentative', '대표이사'],
] as const satisfies readonly (readonly [keyof IncorpPersonView & keyof PersonDraft, string])[];

const rolesOf = (p: Pick<IncorpPersonView, 'isFounder' | 'isDirector' | 'isAuditor' | 'isRepresentative'>) =>
  ROLES.filter(([k]) => p[k]).map(([, label]) => label);

/** 보낼 사람 본문 — 서버가 `parseIncorpPersonBody` 로 읽는다. */
const personBody = (p: {
  name: string;
  isFounder: boolean;
  isDirector: boolean;
  isAuditor: boolean;
  isRepresentative: boolean;
  unitsSubscribed: number | null;
  appointmentDate: string | null;
  zipCode: string | null;
  address: string | null;
  addressDetail: string | null;
  rrn: string;
}) => ({
  name: p.name,
  isFounder: p.isFounder,
  isDirector: p.isDirector,
  isAuditor: p.isAuditor,
  isRepresentative: p.isRepresentative,
  unitsSubscribed: p.unitsSubscribed,
  appointmentDate: p.appointmentDate,
  zipCode: p.zipCode,
  address: p.address,
  addressDetail: p.addressDetail,
  // ★ 비우면 「안 바꿈」이다(수정). 새로 넣을 때 비우면 주민번호 없음.
  rrn: p.rrn === '' ? null : p.rrn,
});

export function IncorporationDetail({ draft, saved: initialSaved }: Props) {
  const router = useRouter();
  /** ★ 저장된 건은 **상태로** 든다 — 전이 · 저장이 돌려준 새 상세, 409 뒤에 다시 읽은 상세로 다시 그린다. */
  const [saved, setSaved] = useState<IncorporationDetailResponse | null>(initialSaved);
  const isNew = saved === null;
  const editable = isNew || saved.editable;
  const base = initialSaved ? `/api/legal/incorporations/${encodeURIComponent(initialSaved.id)}` : null;

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

  // ── 설립 정보 ────────────────────────────────────────────────────────────
  const initialForm = useMemo(
    () => toInfoForm(initialSaved?.info ?? {}, draft.defaultNamePosition),
    [initialSaved, draft.defaultNamePosition],
  );
  const [form, setForm] = useState<InfoForm>(initialForm);
  const [savedWire, setSavedWire] = useState<string>(() => JSON.stringify(toWire(initialForm)));
  const wire = toWire(form);
  /** 저장 안 한 입력 — [저장] · 상태 버튼 막기가 이것을 본다. */
  const dirty = JSON.stringify(wire) !== savedWire;
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setText = (name: Exclude<InfoName, 'hq'>, value: string) =>
    setForm((f) => ({ ...f, text: { ...f.text, [name]: value } }));

  // ── 사람 — 두 모드 모두 이 자리가 들고 있다 ─────────────────────────────
  const [persons, setPersons] = useState<LocalPerson[]>(() => (initialSaved?.persons ?? []).map((p) => ({ ...p, rrn: '' })));
  const tempSeq = useRef(0);

  // ── 임시 모드 — 나갈 때 확인(법인변경과 같다) ─────────────────────────────
  const hasInput = isNew && (JSON.stringify(form) !== JSON.stringify(initialForm) || persons.length > 0);
  const leaving = useRef(false);
  useEffect(() => {
    if (!hasInput) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    // ★ 화면 안의 링크는 beforeunload 가 울리지 않는다(클라이언트 전환) — 잡는 단계에서 먼저 본다.
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
  /** 새 상세로 다시 그린다 — 상태 · 버튼 · 설립 정보 · 사람 모두 서버 값으로. */
  function applyDetail(d: IncorporationDetailResponse) {
    const f = toInfoForm(d.info, d.defaultNamePosition);
    setSaved(d);
    setForm(f);
    setSavedWire(JSON.stringify(toWire(f)));
    setPersons(d.persons.map((p) => ({ ...p, rrn: '' })));
  }

  /**
   * 지금 화면의 입력을 저장한다 — [저장] 과 [작성완료] 가 같이 쓴다. 검증은 하지 않는다(임시 저장).
   * 실패하면 오류를 띄우고 null. ★ busy 는 부르는 쪽이 켜고 끈다.
   */
  const persist = async (): Promise<{ id: string } | null> => {
    setSaveError(null);
    setFieldErrors({});
    if (isNew) {
      // ★ 첫 저장 — 건 + 설립 정보 + 사람 전부를 한 요청으로. 하나라도 틀리면 아무것도 생기지 않는다.
      const res = await send<{ id: string }>('POST', '/api/legal/incorporations', {
        orgId: draft.orgId,
        orgCode: draft.orgCode,
        info: wire,
        persons: persons.map((p) => personBody(p)),
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
      return { id: res.body.id };
    }
    const res = await send<IncorporationDetailResponse>('PATCH', base!, { info: wire });
    if (!res.ok) {
      setFieldErrors(errorMap(res.body.errors));
      setSaveError(res.body.message ?? '저장하지 못했습니다');
      return null;
    }
    applyDetail(res.body);
    return { id: res.body.id };
  };

  /** 건의 주소로 옮겨 간다 — 나가기 확인을 풀고, 뒤로 가기에 임시 모드가 남지 않게 replace. */
  const goToSaved = (id: string) => {
    leaving.current = true;
    router.replace(`/legal/incorporations/${encodeURIComponent(id)}`);
  };

  /** [저장] — 검증 없이 임시 저장. */
  const save = async () => {
    setBusy(true);
    const done = await persist();
    if (done && isNew) {
      goToSaved(done.id);
      return;
    }
    setBusy(false);
    if (done) notify('저장했습니다');
  };

  /**
   * [작성완료] — 지금 입력을 **저장한 뒤** 검증하고, 통과하면 P→E(법인변경과 같다).
   * 저장이 실패하면 전이를 보내지 않는다. 검증 실패면 입력은 저장된 채 P 로 남고 칸별 오류를 붙인다.
   */
  const complete = async () => {
    setBusy(true);
    const done = await persist();
    if (!done) {
      setBusy(false);
      return;
    }
    if (isNew) {
      const res = await send<IncorporationDetailResponse>(
        'POST',
        `/api/legal/incorporations/${encodeURIComponent(done.id)}/transition`,
        { from: 'P', to: 'E' },
      );
      if (!res.ok) stashCompleteErrors(done.id, res.body.message ?? '작성완료하지 못했습니다', res.body.errors);
      goToSaved(done.id);
      return;
    }
    setBusy(false);
    await transitionNow('E');
  };

  // ── 사람 저장 · 삭제 — 임시 모드는 화면에서만, 저장된 건은 바로 서버로 ──────────
  const savePerson = async (d: PersonDraft): Promise<string | null> => {
    const fields = {
      name: d.name.trim(),
      isFounder: d.isFounder,
      isDirector: d.isDirector,
      isAuditor: d.isAuditor,
      isRepresentative: d.isRepresentative,
      unitsSubscribed: toCount(d.units),
      appointmentDate: blankToNull(d.appointmentDate),
      zipCode: blankToNull(d.address.zipCode),
      address: blankToNull(d.address.address),
      addressDetail: blankToNull(d.address.addressDetail),
    };
    if (isNew) {
      const id = d.id ?? `new-${++tempSeq.current}`;
      const prev = persons.find((p) => p.id === id);
      // ★ 비우면 「안 바꿈」 — 저장된 건과 같은 규칙이다.
      const rrn = d.rrn.trim() !== '' ? (normalizeRrn(d.rrn) ?? '') : (prev?.rrn ?? '');
      const view: LocalPerson = {
        ...fields,
        id,
        unitsSubscribed: fields.unitsSubscribed ?? 0,
        rrnMasked: rrn ? maskRrn(rrn) : null,
        sortOrder: prev?.sortOrder ?? persons.length + 1,
        rrn,
      };
      setPersons((list) => (prev ? list.map((p) => (p.id === id ? view : p)) : [...list, view]));
      setFieldErrors({});
      return null;
    }
    const body = personBody({ ...fields, rrn: d.rrn.trim() });
    const res = d.id
      ? await send<IncorpPersonView>('PATCH', `${base}/persons/${encodeURIComponent(d.id)}`, body)
      : await send<IncorpPersonView>('POST', `${base}/persons`, body);
    if (!res.ok) return res.body.message ?? '사람을 저장하지 못했습니다';
    const view: LocalPerson = { ...res.body, rrn: '' };
    setPersons((list) => (d.id ? list.map((p) => (p.id === view.id ? view : p)) : [...list, view]));
    notify(d.id ? '사람을 고쳤습니다' : '사람을 추가했습니다');
    return null;
  };

  const removePerson = async (id: string): Promise<string | null> => {
    if (!isNew) {
      const res = await send<unknown>('DELETE', `${base}/persons/${encodeURIComponent(id)}`);
      if (!res.ok) return res.body.message ?? '사람을 지우지 못했습니다';
      notify('사람을 지웠습니다');
    }
    setPersons((list) => list.filter((p) => p.id !== id));
    setFieldErrors({});
    return null;
  };

  /** 저장 · 검증이 돌려준 사람 오류 — `persons.{i}.{칸}` 를 줄 번호별로 모은다. */
  const personErrors = useMemo(() => {
    const out: Record<number, string[]> = {};
    for (const [field, message] of Object.entries(fieldErrors)) {
      const m = /^persons\.(\d+)\./.exec(field);
      if (m) (out[Number(m[1])] ??= []).push(message);
    }
    return out;
  }, [fieldErrors]);

  // ── 상태 전이 · 삭제 — 처리는 이 화면 한 곳이다(목록에는 버튼이 없다) ──────────
  const [confirm, setConfirm] = useState<CorpChangeConfirmKind | null>(null);

  /** 409 — 화면이 본 상태가 낡았다. 다시 읽어 최신 상태와 버튼으로 다시 그린다. */
  const reloadAfterConflict = async (message: string) => {
    setConfirm(null);
    const res = await send<IncorporationDetailResponse>('GET', base!);
    if (res.ok) applyDetail(res.body);
    setFieldErrors({});
    setSaveError(res.ok ? message : res.status === 404 ? '이 건을 찾을 수 없습니다 — 다른 사용자가 지웠을 수 있습니다' : message);
  };

  /** 전이 하나. 실패면 문구(확인 창이 띄운다), 성공 · 409 처리 후면 null. */
  const transition = async (to: CorpChangeStatus, cancelReason: string | null = null): Promise<string | null> => {
    if (!saved) return null;
    setBusy(true);
    setSaveError(null);
    const res = await send<IncorporationDetailResponse>('POST', `${base}/transition`, { from: saved.status, to, cancelReason });
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
      // ★ P→E 검증 실패 — 칸 옆에 붙인다. 상태는 그대로다.
      setConfirm(null);
      setFieldErrors(errorMap(res.body.errors));
      setSaveError(`${res.body.message ?? '입력 내용을 확인하세요'} — 입력은 저장했습니다. 표시된 칸을 고친 뒤 다시 [작성완료] 를 누르세요.`);
      return null;
    }
    return res.body.message ?? '상태를 바꾸지 못했습니다';
  };

  const transitionNow = async (to: CorpChangeStatus) => {
    const failed = await transition(to);
    if (failed) setSaveError(failed);
  };

  const removeIncorporation = async (): Promise<string | null> => {
    if (!saved) return null;
    const res = await send<unknown>('DELETE', `${base}?from=${encodeURIComponent(saved.status)}`);
    if (res.ok) {
      leaving.current = true;
      router.replace('/legal/incorporations');
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
    if (confirm === 'delete') return removeIncorporation();
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

  /** 서버가 준 칸 자리 → 그 칸의 오류. 본점은 `hq.zipCode` 처럼 아래 자리로, 위치는 `info.` 가 붙어 온다. */
  const errorFor = (name: string): string | undefined =>
    fieldErrors[name] ??
    fieldErrors[`info.${name}`] ??
    Object.entries(fieldErrors).find(([k]) => k.startsWith(`${name}.`))?.[1];

  // ★ 경고는 지금 입력으로 센다(막지 않는다) — 서버 상세의 `warnings` 와 같은 함수다.
  const warnings = incorporationWarnings({ info: wire as IncorporationInfo, persons });
  const composed = composeIncorporationName(form.text.nameKo, form.companyTypePosition);
  const positions =
    draft.namePositions.length > 0 ? draft.namePositions : [{ code: draft.defaultNamePosition, name: draft.defaultNamePosition }];
  const disabled = !editable || busy;

  /** 글자 · 숫자 · 날짜 칸 하나 — 정의(shared)대로 이름 · 필수 · 안내를 그린다. */
  const field = (name: Exclude<InfoName, 'hq' | 'purposes'>, wide = false) => {
    const d = DEF[name];
    const value = form.text[name];
    const error = errorFor(name);
    const numeric = d.type === 'amount' || d.type === 'count';
    const badDate = d.type === 'date' && value !== '' && parseDay(value) === null;
    return (
      <label key={name} className={`${styles.field}${wide ? ` ${styles.span2}` : ''}`}>
        <span className={styles.label}>
          {d.label} {d.required ? <span className={styles.req}>*</span> : null}
        </span>
        {d.type === 'date' ? (
          <input
            type="date"
            className={`${styles.input} ${styles.tabular}${badDate || error ? ` ${styles.inputInvalid}` : ''}`}
            value={badDate ? '' : value}
            disabled={disabled}
            onChange={(e) => setText(name, e.target.value)}
          />
        ) : (
          <input
            className={`${styles.input}${numeric ? ` ${styles.tabular} ${styles.numInput}` : ''}${d.type === 'monthDay' ? ` ${styles.tabular}` : ''}${error ? ` ${styles.inputInvalid}` : ''}`}
            value={value}
            disabled={disabled}
            inputMode={numeric ? 'numeric' : undefined}
            placeholder={d.type === 'monthDay' ? 'MM-DD' : undefined}
            onChange={(e) => setText(name, numeric ? formatMoneyInput(e.currentTarget) : e.target.value)}
          />
        )}
        {badDate ? (
          <span className={styles.fieldError}>날짜(YYYY-MM-DD)가 아닙니다: {value}</span>
        ) : error ? (
          <span className={styles.fieldError}>{error}</span>
        ) : d.hint ? (
          <span className={styles.hint}>{d.hint}</span>
        ) : null}
      </label>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadInner}>
          <div className={styles.headTitle}>
            {/* ★ 제목 옆은 상태명만(법인변경과 같다). 상호는 회사 묶음에 있다. */}
            <div className={styles.titleRow}>
              <h1 className={styles.pageTitle}>법인설립</h1>
              <span className={styles.titleMeta}>
                · <strong>{saved?.statusName ?? draft.statusName}</strong>
              </span>
            </div>
            {/*
              날짜 줄 — 저장된 건만, 상태에 맞는 날짜만. 옆에 단체코드를 작게(결정 2026-10-11).
              ★ 단체코드는 **읽어 보여 주기만** 한다 — 만들거나 검증하지 않고, 접두어로 유형을 가르지 않는다.
                없으면 「단체 {ID}」. 임시 모드는 날짜가 없어 단체코드만 보인다.
            */}
            <div className={styles.pageNote}>
              {saved ? corpChangeDateLine(saved).map((d) => `${d.label} ${d.day}`).join(' · ') : null}
              <span className={saved ? styles.orgTag : undefined}>{draft.orgCode ?? `단체 ${draft.orgId}`}</span>
            </div>
          </div>
          <div className={styles.headActions}>
            {saved ? (
              <StatusActions
                saved={saved}
                // ★ 작성완료가 아닌 처리는 저장 안 한 입력이 있으면 막는다(작성완료는 스스로 저장한다).
                disabled={busy || dirty}
                onTransition={(to) => void transitionNow(to)}
                onConfirm={setConfirm}
              />
            ) : null}
            <Link href="/legal/incorporations" className={`${styles.btn} ${styles.btnGhost}`}>
              <Icon name="chevron-left" size={16} />
              법인설립 목록
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
            {/* [작성완료] — 저장 + 검증 + P→E 한 번에. 임시 모드에도 있다. */}
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
              <span>「{saved.statusName}」 상태라 설립 정보와 사람을 고칠 수 없습니다. 서류작성중일 때만 고칩니다.</span>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className={`${styles.banner} ${styles.bannerWarning}`} role="status">
              <Icon name="triangle-alert" size={16} />
              <span>{warnings.join(' · ')} — 작성완료를 막지는 않습니다.</span>
            </div>
          ) : null}

          {/* ── 회사 ── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>회사</h2>
            </div>
            <div className={styles.sectionRule} />
            <div className={styles.grid4}>
              {field('nameKo', true)}
              <label className={styles.field}>
                <span className={styles.label}>「주식회사」 위치</span>
                <select
                  className={`${styles.select}${errorFor('companyTypePosition') ? ` ${styles.inputInvalid}` : ''}`}
                  value={form.companyTypePosition}
                  disabled={disabled}
                  onChange={(e) => setForm((f) => ({ ...f, companyTypePosition: e.target.value }))}
                >
                  {positions.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {errorFor('companyTypePosition') ? (
                  <span className={styles.fieldError}>{errorFor('companyTypePosition')}</span>
                ) : null}
              </label>
              <div className={styles.field}>
                <span className={styles.label}>서류에 쓰이는 상호</span>
                <span className={`${styles.readValue}${composed ? '' : ` ${styles.readEmpty}`}`}>{composed || '—'}</span>
              </div>
              {field('nameEn', true)}
              <div className={`${styles.field} ${styles.span2}`} />
              <div className={`${styles.field} ${styles.span4}`}>
                <span className={styles.label}>
                  {DEF.hq.label} {DEF.hq.required ? <span className={styles.req}>*</span> : null}
                </span>
                <AddressInput
                  value={form.hq}
                  disabled={disabled}
                  onChange={(hq) => setForm((f) => ({ ...f, hq }))}
                  onError={notify}
                />
                {errorFor('hq') ? <span className={styles.fieldError}>{errorFor('hq')}</span> : null}
              </div>
            </div>
          </section>

          {/* ── 자본·주식 ── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>자본·주식</h2>
            </div>
            <div className={styles.sectionRule} />
            <div className={styles.grid4}>{CAPITAL_FIELDS.map((n) => field(n as Exclude<InfoName, 'hq' | 'purposes'>))}</div>
          </section>

          {/* ── 설립 정보 ── */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>설립 정보</h2>
            </div>
            <div className={styles.sectionRule} />
            <div className={styles.grid4}>{SETUP_FIELDS.map((n) => field(n as Exclude<InfoName, 'hq' | 'purposes'>))}</div>
          </section>

          <PersonsSection
            persons={persons}
            editable={editable}
            isNew={isNew}
            unitsIssued={toCount(form.text.unitsIssued)}
            rowErrors={personErrors}
            listError={fieldErrors.persons}
            onSave={savePerson}
            onRemove={removePerson}
          />

          <PurposesSection
            def={DEF.purposes}
            value={form.text.purposes}
            disabled={disabled}
            error={errorFor('purposes')}
            onChange={(v) => setText('purposes', v)}
            onNotice={notify}
          />
        </div>
      </div>

      {confirm && saved ? (
        <CorpChangeConfirmDialog
          kind={confirm}
          restoreToName={saved.statusBeforeCancelName}
          peopleLabel="사람"
          onClose={() => setConfirm(null)}
          onConfirm={onConfirm}
        />
      ) : null}

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
// 사업목적 — [목록에서 고르기] 팝업을 그대로 쓴다(법인변경 목적변경과 같다)
// =============================================================================

function PurposesSection({
  def,
  value,
  disabled,
  error,
  onChange,
  onNotice,
}: {
  def: IncorpFieldDef;
  value: string;
  disabled: boolean;
  error?: string;
  onChange: (v: string) => void;
  onNotice: (message: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const lines = purposeLines(value).length;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <h2>
            {def.label} {def.required ? <span className={styles.req}>*</span> : null}
          </h2>
          <span className={styles.muted}>{lines}줄</span>
        </div>
        {/* ★ 고른 문구를 끝에 줄로 덧붙인다(이미 있는 줄은 건너뜀). 카탈로그를 고치는 버튼은 두지 않는다. */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
          disabled={disabled}
          onClick={() => setPicking(true)}
        >
          <Icon name="search" size={14} />
          목록에서 고르기
        </button>
      </div>
      <div className={styles.sectionRule} />
      <div className={styles.field}>
        {def.hint ? <span className={styles.hint}>{def.hint}</span> : null}
        <textarea
          aria-label={def.label}
          className={`${styles.textarea}${error ? ` ${styles.inputInvalid}` : ''}`}
          rows={8}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {error ? <span className={styles.fieldError}>{error}</span> : null}
      </div>
      {picking ? (
        <BizPurposePickerDialog
          existing={purposeLines(value)}
          onClose={() => setPicking(false)}
          onPick={(texts) => {
            const r = appendPurposeLines(value, texts);
            setPicking(false);
            if (r.added.length > 0) onChange(r.text);
            onNotice(
              r.skipped.length > 0
                ? `${r.added.length}개를 넣었습니다 — 이미 있는 ${r.skipped.length}개는 건너뛰었습니다`
                : `${r.added.length}개를 넣었습니다`,
            );
          }}
        />
      ) : null}
    </section>
  );
}

// =============================================================================
// 사람 — 발기인 · 이사 · 감사 · 대표이사(겹쳐 체크) + 인수 주식 수 + 취임일
// =============================================================================

const blankDraft = (): PersonDraft => ({
  id: null,
  name: '',
  isFounder: false,
  isDirector: false,
  isAuditor: false,
  isRepresentative: false,
  units: '',
  appointmentDate: '',
  address: EMPTY_ADDRESS,
  rrn: '',
  rrnMasked: null,
});

const draftOf = (p: IncorpPersonView): PersonDraft => ({
  id: p.id,
  name: p.name,
  isFounder: p.isFounder,
  isDirector: p.isDirector,
  isAuditor: p.isAuditor,
  isRepresentative: p.isRepresentative,
  units: p.unitsSubscribed ? showCount(p.unitsSubscribed) : '',
  appointmentDate: p.appointmentDate ?? '',
  address: { zipCode: p.zipCode ?? '', address: p.address ?? '', addressDetail: p.addressDetail ?? '' },
  rrn: '',
  rrnMasked: p.rrnMasked,
});

/**
 * 사람 표 + 입력 칸. 저장 · 삭제가 어디로 가는지는 부모가 정한다(임시 모드는 화면에서만, 저장된 건은
 * 바로 서버로). 법인변경의 임원 묶음과 같은 모양이다.
 */
function PersonsSection({
  persons,
  editable,
  isNew,
  unitsIssued,
  rowErrors,
  listError,
  onSave,
  onRemove,
}: {
  persons: IncorpPersonView[];
  editable: boolean;
  isNew: boolean;
  /** 설립 때 발행하는 주식의 총수(지금 입력) — 발기인 인수 합과 나란히 보여 준다. */
  unitsIssued: number | null;
  /** 저장 · 검증이 돌려준 줄별 오류(보낸 순서 = 표의 순서). */
  rowErrors: Record<number, string[]>;
  listError?: string;
  onSave: (d: PersonDraft) => Promise<string | null>;
  onRemove: (id: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<PersonDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rrnBad = draft !== null && draft.rrn.trim() !== '' && !isRrnShape(draft.rrn);
  const founders = persons.filter((p) => p.isFounder);
  const founderUnits = founders.reduce((s, p) => s + p.unitsSubscribed, 0);

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
          <h2>사람</h2>
          <span className={styles.muted}>{persons.length}명</span>
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
            사람 추가
          </button>
        ) : null}
      </div>
      <div className={styles.sectionRule} />
      <p className={styles.sectionNote}>
        발기인 {founders.length}명 · 인수 주식 수 합 {founderUnits.toLocaleString('ko-KR')}주
        {unitsIssued !== null ? ` / 설립 때 발행하는 주식의 총수 ${unitsIssued.toLocaleString('ko-KR')}주` : ''}
        {isNew ? ' · 사람은 위의 [저장] 을 누를 때 건과 함께 저장됩니다.' : ''}
      </p>

      {error || listError ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert" style={{ marginBottom: 16 }}>
          <Icon name="circle-alert" size={16} />
          <span>{error ?? listError}</span>
        </div>
      ) : null}

      <div className={styles.oTable}>
        <div className={styles.oHead}>
          <span>성명</span>
          <span>역할</span>
          <span>인수 주식 수</span>
          <span>취임일</span>
          <span>주민등록번호</span>
          <span>주소</span>
          <span />
        </div>
        {persons.length === 0 ? (
          <div className={styles.empty}>등록된 사람이 없습니다</div>
        ) : (
          persons.map((p, i) => (
            <div key={p.id} className={styles.oItem}>
              <div className={`${styles.oRow}${draft?.id === p.id ? ` ${styles.oRowEditing}` : ''}`}>
                <span className={p.name ? styles.ellipsis : styles.muted}>{p.name || '(성명 없음)'}</span>
                <span className={rolesOf(p).length > 0 ? styles.ellipsis : styles.muted}>{rolesOf(p).join(' · ') || '—'}</span>
                <span className={styles.tabular}>{p.unitsSubscribed.toLocaleString('ko-KR')}</span>
                <span className={`${styles.tabular}${p.appointmentDate ? '' : ` ${styles.muted}`}`}>{p.appointmentDate ?? '—'}</span>
                <span className={`${styles.tabular}${p.rrnMasked ? '' : ` ${styles.muted}`}`}>{p.rrnMasked ?? '—'}</span>
                <span className={styles.ellipsis} title={addressLine(p)}>
                  {addressLine(p) || <span className={styles.muted}>—</span>}
                </span>
                <span className={styles.oActions}>
                  {editable ? (
                    confirmDelete === p.id ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger} ${styles.btnXs}`}
                          disabled={busy}
                          onClick={() => void remove(p.id)}
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
                            setDraft(draftOf(p));
                          }}
                        >
                          <Icon name="pencil-line" size={14} />
                          수정
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnDanger} ${styles.btnXs}`}
                          disabled={busy}
                          aria-label={`${p.name || '사람'} 삭제`}
                          onClick={() => setConfirmDelete(p.id)}
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
          <p className={styles.editorHead}>{draft.id ? '사람 수정' : '사람 추가'}</p>
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
            <div className={`${styles.field} ${styles.span2}`}>
              <span className={styles.label}>
                역할 <span className={styles.req}>*</span>
              </span>
              <div className={styles.checkRow}>
                {ROLES.map(([key, label]) => (
                  <label key={key} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      disabled={busy}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>인수 주식 수</span>
              <input
                className={`${styles.input} ${styles.tabular} ${styles.numInput}`}
                value={draft.units}
                disabled={busy}
                inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, units: formatMoneyInput(e.currentTarget) })}
              />
              <span className={styles.hint}>발기인의 합이 설립 때 발행하는 주식의 총수와 같아야 합니다</span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>취임일</span>
              <input
                type="date"
                className={`${styles.input} ${styles.tabular}`}
                value={draft.appointmentDate}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, appointmentDate: e.target.value })}
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
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => setDraft(null)}>
              취소
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={busy || rrnBad}
              onClick={() => void save()}
            >
              <Icon name="save" size={16} />
              {isNew ? (draft.id ? '목록에 반영' : '목록에 추가') : draft.id ? '사람 저장' : '사람 추가'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
