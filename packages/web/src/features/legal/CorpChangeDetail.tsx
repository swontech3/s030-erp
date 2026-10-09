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
 *   · 기본정보(비입주사 법무 회사 정보)는 **건과 무관**해서 두 모드 모두 바로 저장된다
 *
 * ★ 임시 모드에서 입력이 있으면 나갈 때 확인한다 — 「입력이 있다」 = 변경 내용 칸이 처음 상태와
 *   다르거나 임원을 하나라도 추가했다(지웠다가 처음으로 돌아가면 없음). 브라우저 닫기도 같은 기준.
 *   회사 정보는 따로 저장되므로 이 판정에 넣지 않는다.
 *
 * ★★ 칸 정의를 이 파일에 적지 않는다 — shared `CHANGE_TYPE_DEFS` 대로 그린다. 구분 · 상태 ·
 *    회사유형 이름은 응답에 코드표의 것으로 온다.
 * ★ 저장할 때 내용 검증은 하지 않는다(작성 중 임시 저장). 필수 칸은 `*` 로 알려 주기만 한다 —
 *   검증은 서류작성완료(P→E, 4단계) 때다. 형식 오류(날짜 · 주민번호)는 칸 옆에 바로 알려 주고,
 *   주민번호는 형식이 틀리면 서버가 저장을 거절한다.
 * ★★ 서버는 주민번호 평문을 돌려주지 않는다(마스킹만). 임시 모드의 평문은 사람이 적은 것을 첫 저장
 *    때까지 화면이 들고 있는 것뿐이고, 표에는 마스킹해서 보인다.
 * ★ 상태 전이 · 서류 출력 버튼은 아직 없다(4단계 이후). 한 업무는 한 화면에서 — 이 화면이 그 자리다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CHANGE_TYPE_DEFS,
  OFFICER_CHANGE_KINDS,
  OFFICER_CHANGE_KIND_LABEL,
  REGISTRATION_DEADLINE_DAYS,
  isRrnShape,
  registrationDeadline,
  type CorpChangeFieldDef,
  type CorpChangeFieldError,
  type OfficerChangeKind,
} from '@swonbiz/shared/domain/corp-change';
import {
  corpChangeCompanyName,
  maskRrn,
  normalizeRrn,
  type CorpChangeAddressView,
  type CorpChangeCompanyInfo,
  type CorpChangeDetailResponse,
  type CorpChangeDraftResponse,
  type CorpChangeOfficerView,
} from '@swonbiz/shared/domain/corp-change-detail';
import { parseDay } from '@swonbiz/shared/domain/day';
import { Icon } from '@/components/ds';
import { useKakaoPostcode } from '@/lib/useKakaoPostcode';
import styles from './corp-change-detail.module.css';

interface Props {
  /** 머리 · 기본정보 — 임시 모드는 임시 모드 읽기 응답, 저장된 건은 상세 응답 그대로. */
  draft: CorpChangeDraftResponse;
  /** 저장된 건. **null 이면 임시 모드**(건이 아직 없다). */
  saved: CorpChangeDetailResponse | null;
  /** 「입주사 화면에서 입력」 링크를 보여 줄까 — 그 화면(s030200030)을 받은 사람에게만. */
  canOpenTenantScreen: boolean;
}

type Address = { zipCode: string; address: string; addressDetail: string };
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
  body: T & { message?: string; errors?: CorpChangeFieldError[] };
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

export function CorpChangeDetail({ draft, saved, canOpenTenantScreen }: Props) {
  const router = useRouter();
  const isNew = saved === null;
  const editable = isNew || saved.editable;
  const def = CHANGE_TYPE_DEFS[draft.changeType];
  const base = saved ? `/api/legal/corp-changes/${encodeURIComponent(saved.id)}` : null;

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
  const [company, setCompany] = useState<CorpChangeCompanyInfo>(draft.company);

  // ── 변경 내용 ────────────────────────────────────────────────────────────
  /**
   * ★ 대표주소 변경의 「변경 전 주소」 기본값은 **대표자 자택**(ceo_*)이다 — 사업장 주소가 아니다.
   *   저장된 값이 없을 때만 채운다. 채운 값은 [저장] 을 눌러야 건에 남는다.
   * ★ 본점이전의 새 본점은 채우지 않는다(건물주소+호실 자동 채움 없음 — 결정 2026-10-10).
   */
  const savedPayload = useMemo(() => saved?.payload ?? {}, [saved]);
  const initialForm = useMemo(() => {
    const form = toForm(def.fields, savedPayload);
    if (draft.changeType === 'CEO_ADDR' && editable && isEmptyAddress(form.oldCeoAddress as Address)) {
      form.oldCeoAddress = viewToAddress(draft.company.ceo);
    }
    return form;
  }, [def.fields, savedPayload, draft, editable]);
  const prefilledOldAddress =
    draft.changeType === 'CEO_ADDR' &&
    editable &&
    isEmptyAddress(toAddress(savedPayload.oldCeoAddress)) &&
    !isEmptyAddress(viewToAddress(draft.company.ceo));

  const [form, setForm] = useState<FormPayload>(initialForm);
  const [savedWire, setSavedWire] = useState<string>(() => JSON.stringify(toWire(def.fields, toForm(def.fields, savedPayload))));
  const dirty = JSON.stringify(toWire(def.fields, form)) !== savedWire;
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── 임원 — 두 모드 모두 이 자리가 들고 있다 ─────────────────────────────
  const [officers, setOfficers] = useState<LocalOfficer[]>(() => (saved?.officers ?? []).map((o) => ({ ...o, rrn: '' })));
  const tempSeq = useRef(0);

  // ── 임시 모드 — 나갈 때 확인 ─────────────────────────────────────────────
  /** 「입력이 있다」 — 변경 내용이 처음 상태와 다르거나 임원이 하나라도 있다(결정 2026-10-10). */
  const hasInput = isNew && (JSON.stringify(form) !== JSON.stringify(initialForm) || officers.length > 0);
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
  const save = async () => {
    setBusy(true);
    setSaveError(null);
    setFieldErrors({});
    const wire = toWire(def.fields, form);

    if (isNew) {
      // ★ 첫 저장 — 건 + 변경 내용 + 임원 전부를 한 요청으로. 하나라도 틀리면 아무것도 생기지 않는다.
      const res = await send<{ id: string }>('POST', '/api/legal/corp-changes', {
        changeType: draft.changeType,
        orgId: draft.orgId,
        orgCode: draft.orgCode,
        payload: wire,
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
        setBusy(false);
        setFieldErrors(errorMap(res.body.errors));
        setSaveError(
          res.body.errors && res.body.errors.length > 0
            ? '저장하지 못했습니다 — 표시된 칸을 고쳐 주세요. 건은 만들어지지 않았습니다.'
            : (res.body.message ?? '저장하지 못했습니다'),
        );
        return;
      }
      // ★ 이제 저장된 건이다 — 나가기 확인을 풀고 그 건의 주소로 옮겨 간다(뒤로 가기에 임시 모드가 남지 않게 replace).
      leaving.current = true;
      router.replace(`/legal/corp-changes/${encodeURIComponent(res.body.id)}`);
      return;
    }

    const res = await send<{ payload: Record<string, unknown> }>('PATCH', base!, { payload: wire });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(errorMap(res.body.errors));
      setSaveError(res.body.message ?? '저장하지 못했습니다');
      return;
    }
    setSavedWire(JSON.stringify(toWire(def.fields, toForm(def.fields, res.body.payload))));
    notify('변경 내용을 저장했습니다');
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

  const deadline = registrationDeadline(draft.changeType, toWire(def.fields, form), localToday());

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadInner}>
          <div>
            <Link href="/legal/corp-changes" className={styles.back}>
              <Icon name="chevron-left" size={14} />
              법인변경 목록
            </Link>
            <div className={styles.titleRow}>
              <h1 className={styles.pageTitle}>{draft.changeTypeName}</h1>
              {saved ? <span className={`${styles.badge} ${styles.status}`}>{saved.statusName}</span> : null}
            </div>
            <div className={styles.pageNote}>
              {company.displayName}
              {saved ? ` · 등록 ${saved.createdOn}` : ' · 아직 저장하지 않았습니다'}
            </div>
          </div>
          <div className={styles.headActions}>
            {editable ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                // ★ 임시 모드는 늘 누를 수 있다 — 빈 채로 저장하는 것도 사람이 고른 일이다.
                disabled={busy || (!isNew && !dirty)}
                onClick={() => void save()}
              >
                <Icon name="save" size={16} />
                저장
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.formScroll}>
        <div className={styles.formWrap}>
          {isNew ? (
            <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
              <Icon name="info" size={16} />
              <span>저장하면 건이 생성됩니다.</span>
            </div>
          ) : null}
          {saveError ? (
            <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
              <Icon name="circle-alert" size={16} />
              <span>{saveError}</span>
            </div>
          ) : null}
          {saved && !saved.editable ? (
            <div className={`${styles.banner} ${styles.bannerInfo}`} role="status">
              <Icon name="lock" size={16} />
              <span>
                「{saved.statusName}」 상태라 변경 내용과 임원을 고칠 수 없습니다. 서류작성중일 때만 고칩니다.
              </span>
            </div>
          ) : null}

          <CompanySection
            org={{ orgId: draft.orgId, orgCode: draft.orgCode }}
            company={company}
            memberTypes={draft.memberTypes}
            canOpenTenantScreen={canOpenTenantScreen}
            onSaved={(next) => {
              setCompany(next);
              notify('회사 정보를 저장했습니다');
            }}
          />

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>변경 내용</h2>
            </div>
            <div className={styles.sectionRule} />
            <p className={styles.sectionNote}>
              작성 중에는 비어 있어도 저장됩니다. <span className={styles.req}>*</span> 칸은 서류작성완료 때 필요합니다.
            </p>

            {deadline ? (
              <div
                className={`${styles.banner} ${deadline.overdue ? styles.bannerWarning : styles.bannerInfo}`}
                role="status"
                style={{ marginBottom: 16 }}
              >
                <Icon name={deadline.overdue ? 'triangle-alert' : 'info'} size={16} />
                <span>
                  {deadline.elapsedDays < 0
                    ? `전입일이 아직 오지 않았습니다(${-deadline.elapsedDays}일 뒤). 변경등기 신청기한은 전입일로부터 ${REGISTRATION_DEADLINE_DAYS}일입니다.`
                    : deadline.overdue
                    ? `전입일로부터 ${deadline.elapsedDays}일이 지났습니다 — 신청기한(${REGISTRATION_DEADLINE_DAYS}일)을 넘겼습니다.`
                    : `전입일로부터 ${deadline.elapsedDays}일째입니다 — 신청기한은 ${REGISTRATION_DEADLINE_DAYS}일입니다.`}
                </span>
              </div>
            ) : null}

            <div className={styles.grid4}>
              {def.fields.map((f) => (
                <PayloadField
                  key={f.name}
                  def={f}
                  value={form[f.name] ?? (f.type === 'address' ? EMPTY_ADDRESS : '')}
                  disabled={!editable || busy}
                  error={fieldErrors[f.name]}
                  note={
                    f.name === 'oldCeoAddress' && prefilledOldAddress
                      ? '대표자 자택 주소로 채웠습니다 — 저장해야 남습니다'
                      : f.name === 'oldCeoAddress'
                      ? '기본값은 대표자 자택 주소입니다(사업장 주소가 아닙니다)'
                      : undefined
                  }
                  onChange={(v) => setForm((prev) => ({ ...prev, [f.name]: v }))}
                  onError={notify}
                />
              ))}
            </div>
          </section>

          {def.usesOfficers ? (
            <OfficersSection
              officers={officers}
              editable={editable}
              isNew={isNew}
              rowErrors={officerErrors}
              listError={fieldErrors.officers}
              onSave={saveOfficer}
              onRemove={removeOfficer}
            />
          ) : null}
        </div>
      </div>

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
}: {
  def: CorpChangeFieldDef;
  value: string | Address;
  disabled: boolean;
  /** 서버가 돌려준 이 칸의 오류. */
  error?: string;
  note?: string;
  onChange: (v: string | Address) => void;
  onError: (message: string) => void;
}) {
  const label = (
    <span className={styles.label}>
      {def.label} {def.required ? <span className={styles.req}>*</span> : null}
    </span>
  );
  const serverError = error ? <span className={styles.fieldError}>{error}</span> : null;

  if (def.type === 'address') {
    return (
      <div className={`${styles.field} ${styles.span4}`}>
        {label}
        {note ? <span className={styles.hint}>{note}</span> : null}
        <AddressInput value={value as Address} disabled={disabled} onChange={onChange} onError={onError} />
        {serverError}
      </div>
    );
  }

  const text = value as string;
  if (def.type === 'textarea') {
    return (
      <label className={`${styles.field} ${styles.span4}`}>
        {label}
        <span className={styles.hint}>한 줄에 하나씩 적습니다</span>
        <textarea
          className={`${styles.textarea}${error ? ` ${styles.inputInvalid}` : ''}`}
          rows={6}
          value={text}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        {serverError}
      </label>
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
    <label className={`${styles.field} ${styles.span2}`}>
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
function AddressInput({
  value,
  disabled,
  onChange,
  onError,
}: {
  value: Address;
  disabled: boolean;
  onChange: (v: Address) => void;
  onError: (message: string) => void;
}) {
  const postcode = useKakaoPostcode(onError);
  return (
    <div className={styles.addrRow}>
      <input
        className={`${styles.input} ${styles.tabular} ${styles.addrZip}`}
        readOnly
        placeholder="우편번호"
        value={value.zipCode}
      />
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        style={{ height: 44 }}
        disabled={disabled}
        onClick={() => postcode.open((r) => onChange({ ...value, zipCode: r.zipCode, address: r.address }))}
      >
        <Icon name="search" size={14} />
        주소 검색
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

const companyForm = (c: CorpChangeCompanyInfo): CompanyForm => ({
  legalName: c.legalName ?? '',
  memberType: c.memberType ?? '',
  corpNumber: c.corpNumber ?? '',
  bizNumber: c.bizNumber ?? '',
  ceoName: c.ceoName ?? '',
  tel: c.tel ?? '',
  head: viewToAddress(c.head),
  ceo: viewToAddress(c.ceo),
});

/**
 * 기본정보 — 입주사는 ERP 를 읽기만, 비입주사는 법무 회사 정보를 여기서 고친다.
 * ★ 비입주사 회사 정보는 **단체 기준**으로 저장한다(건과 무관) — 임시 모드에서도 바로 저장된다.
 */
function CompanySection({
  org,
  company,
  memberTypes,
  canOpenTenantScreen,
  onSaved,
}: {
  org: { orgId: number; orgCode: string | null };
  company: CorpChangeCompanyInfo;
  memberTypes: { code: string; name: string }[];
  canOpenTenantScreen: boolean;
  onSaved: (next: CorpChangeCompanyInfo) => void;
}) {
  const [form, setForm] = useState<CompanyForm>(() => companyForm(company));
  const [saved, setSaved] = useState(() => JSON.stringify(companyForm(company)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kakaoError, setKakaoError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== saved;

  const badge = (
    <span className={`${styles.badge} ${company.isTenant ? styles.tenant : styles.nonTenant}`}>
      {company.isTenant ? '입주사' : '비입주사'}
    </span>
  );

  if (company.isTenant) {
    // ★ 입주사 = ERP 를 읽기만 한다. 비어 있으면 입주사 화면으로 보낸다 — 법무는 ERP 에 쓰지 않는다.
    const rows: [string, string | null, boolean?][] = [
      ['회사명', company.legalName],
      ['회사유형', company.memberTypeName],
      ['법인등록번호', company.corpNumber],
      ['사업자등록번호', company.bizNumber],
      ['대표자', company.ceoName],
      ['전화', company.tel],
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
            <div key={label} className={`${styles.field}${wide ? ` ${styles.span4}` : ` ${styles.span2}`}`}>
              <span className={styles.label}>{label}</span>
              <span className={`${styles.readValue}${value ? '' : ` ${styles.readEmpty}`}`}>{value || '—'}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      legalName: blankToNull(form.legalName),
      memberType: blankToNull(form.memberType),
      corpNumber: blankToNull(form.corpNumber),
      bizNumber: blankToNull(form.bizNumber),
      ceoName: blankToNull(form.ceoName),
      tel: blankToNull(form.tel),
      headZipCode: blankToNull(form.head.zipCode),
      headAddress: blankToNull(form.head.address),
      headAddressDetail: blankToNull(form.head.addressDetail),
      ceoZipCode: blankToNull(form.ceo.zipCode),
      ceoAddress: blankToNull(form.ceo.address),
      ceoAddressDetail: blankToNull(form.ceo.addressDetail),
    };
    // ★ 단체 ID 를 함께 보낸다 — 회사 세션이면 서버가 세션 단체와 대조한다(다르면 403).
    const res = await send<{ saved: boolean }>('PUT', '/api/legal/corp-changes/company-info', { orgId: org.orgId, ...body });
    setBusy(false);
    if (!res.ok) {
      setError(res.body.message ?? '회사 정보를 저장하지 못했습니다');
      return;
    }
    setSaved(JSON.stringify(form));
    onSaved({
      ...company,
      // ★ 회사명 표시 규칙은 서버와 같은 함수다 — 상호 → 단체코드 → 「단체 {ID}」.
      displayName: corpChangeCompanyName(body.legalName, org),
      legalName: body.legalName,
      memberType: body.memberType,
      memberTypeName: memberTypes.find((m) => m.code === body.memberType)?.name ?? body.memberType,
      corpNumber: body.corpNumber,
      bizNumber: body.bizNumber,
      ceoName: body.ceoName,
      tel: body.tel,
      head: { zipCode: body.headZipCode, address: body.headAddress, addressDetail: body.headAddressDetail },
      ceo: { zipCode: body.ceoZipCode, address: body.ceoAddress, addressDetail: body.ceoAddressDetail },
      hasLegalOrg: true,
    });
  };

  const text = (key: 'legalName' | 'corpNumber' | 'bizNumber' | 'ceoName' | 'tel', label: string, wide = false) => (
    <label className={`${styles.field}${wide ? ` ${styles.span2}` : ''}`}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        value={form[key]}
        disabled={busy}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          <h2>기본정보</h2>
          {badge}
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          <Icon name="save" size={16} />
          회사 정보 저장
        </button>
      </div>
      <div className={styles.sectionRule} />
      <p className={styles.sectionNote}>
        비입주사의 법무 회사 정보입니다 — 이 회사의 모든 법인변경 건이 함께 쓰고, [회사 정보 저장] 을 누르면 바로
        저장됩니다.
        {company.hasLegalOrg ? '' : ' 아직 입력한 적이 없습니다. 처음 저장하면 만들어집니다.'}
      </p>
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert" style={{ marginBottom: 16 }}>
          <Icon name="circle-alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      {kakaoError ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert" style={{ marginBottom: 16 }}>
          <Icon name="circle-alert" size={16} />
          <span>{kakaoError}</span>
        </div>
      ) : null}
      <div className={styles.grid4}>
        {text('legalName', '등기상 상호', true)}
        <label className={styles.field}>
          <span className={styles.label}>회사유형</span>
          <select
            className={styles.select}
            value={form.memberType}
            disabled={busy}
            onChange={(e) => setForm((f) => ({ ...f, memberType: e.target.value }))}
          >
            <option value="">선택</option>
            {memberTypes.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {text('ceoName', '대표자')}
        {text('corpNumber', '법인등록번호')}
        {text('bizNumber', '사업자등록번호')}
        {text('tel', '전화', true)}
        <div className={`${styles.field} ${styles.span4}`}>
          <span className={styles.label}>본점 주소</span>
          <AddressInput
            value={form.head}
            disabled={busy}
            onChange={(head) => setForm((f) => ({ ...f, head }))}
            onError={setKakaoError}
          />
        </div>
        <div className={`${styles.field} ${styles.span4}`}>
          <span className={styles.label}>대표자 자택 주소</span>
          <span className={styles.hint}>대표주소 변경의 「변경 전 주소」 기본값입니다</span>
          <AddressInput
            value={form.ceo}
            disabled={busy}
            onChange={(ceo) => setForm((f) => ({ ...f, ceo }))}
            onError={setKakaoError}
          />
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
  rowErrors,
  listError,
  onSave,
  onRemove,
}: {
  officers: CorpChangeOfficerView[];
  editable: boolean;
  isNew: boolean;
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
              <span className={styles.label}>효력일</span>
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
