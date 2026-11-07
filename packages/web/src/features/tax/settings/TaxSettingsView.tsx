'use client';

/**
 * 세무 설정(s050100010) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-11 ·
 * 결과서 `08-screen-report.md` S05-11 그대로.
 *
 *   [저장] 버튼 줄(오른쪽 위) · 회사 기본정보(회사 이름 · 사업자번호 · 사업자 유형) · 세무사 메일(4칸) · 회사 계좌 | 회사 카드
 *
 * ★ 2026-11-07 대표 수정: 맨 위 안내 · 설명 · 「삐용 단체관리가 정본…」 문구를 지웠다. 사업자 유형은 회사 기본정보 안으로 옮겼다 —
 *   법인등록번호가 있으면 법인으로 고정해 보이기만(`bizTypeLocked`), 없으면 고르는 상자(코드 TAX_BIZ_TP). (법인등록번호 칸은 수정 2 에서 지웠다)
 *   세무사 메일은 4명 고정(이름 · 메일 · 이름 · 메일 4칸 × 2줄, 빈 칸 허용). 「우리 회사가 쓰지 않는 자료」 · 「원천세 신고 주기」 섹션은 지웠다
 *   (값 · DB 칸은 그대로 — 저장 때 보내지 않으면 서버가 저장된 값을 둔다).
 * ★ 2026-11-07 대표 수정 2: 법인등록번호 칸을 지웠다 — 세무에서 입력받지 않고, 법인 고정 판단(`lockedBizType`)만 삐용 값으로 한다.
 *   값이 없는 칸은 「—」. 「사용 안 함」 계좌 · 카드는 따로 모으지 않고 제자리에 흐리게(꺼진 버튼과 같은 .45) — 입력칸은 막고
 *   줄 앞 체크박스만 늘 누를 수 있다. 위 버튼 줄의 [사용 안 함] · [다시 사용]으로 그 자리에서 바꾼다.
 *
 * ★★ 칸을 고쳐도 바로 반영하지 않는다 — 초안(draft)에 담고 **[저장] 하나로 한 번에** 보낸다(`PUT /tax/settings`).
 *    틀린 칸은 서버의 칸별 오류(`errors[]`)로 빨간 테두리 + [저장] 위 빨간 띠. 고치기 시작하면 그 칸 테두리가 풀린다.
 * ★★ 선택지 · 이름 · 설명은 **API 가 준 코드 값으로만** 그린다(코드 관리 s030100030 에서 고친다). 화면에 박지 않는다.
 * ★ 회사 기본정보는 보기만 — 번호는 숫자로 받아 **화면에서만** 하이픈을 붙인다. 없으면 「삐용에서 아직 받지 못했습니다」.
 * ★ 저장하지 않고 화면 안에서 떠나면 시안 모양 확인 창, 새로고침 · 창 닫기는 브라우저 기본(`useLeaveGuard`).
 * ★ 1-1 에는 올린 자료가 없다 — 계좌 · 카드 「올린 자료가 있으면 지우기 막기」는 1-2 에서 붙는다(지금은 늘 지울 수 있다).
 */
import { useCallback, useEffect, useState } from 'react';
import { formatBizNumber } from '@swonbiz/shared/domain/tax-number';
import { TAX_FIN_KIND_BANK, TAX_FIN_KIND_CARD, type TaxCodeOption } from '@swonbiz/shared/domain/tax-settings';
import { Button, Icon } from '@/components/ds';
// ★ 버튼 줄은 ERP 표양식 편집(s030100020)과 같은 클래스를 그대로 쓴다(FormEditor 가 codes.module.css 를 쓰는 것과 같은 방식)
import codesCss from '@/features/codes/codes.module.css';
import forms from '@/features/forms/forms.module.css';
import t from '../common/tax.module.css';
import { TaxConfirmDialog } from '../common/TaxConfirmDialog';
import { TaxFormErrorBanner } from '../common/TaxFormErrorBanner';
import { TaxToast, useTaxToast } from '../common/TaxToast';
import { useLeaveGuard } from '../common/useLeaveGuard';
import {
  TaxSettingsError,
  bodyOf,
  draftOf,
  errorKeyOf,
  loadTaxSettings,
  newKey,
  sameDraft,
  saveTaxSettings,
  type Draft,
  type DraftFin,
  type TaxSettingsResponse,
} from './tax-settings-model';

type FinList = 'accounts' | 'cards';
type ListName = FinList;

/** 입력 오류 띠의 안내 — 결과서 S05-11 [저장]. */
const INPUT_GUIDE = '메일은 name@example.com 모양, 계좌번호는 숫자와 - 만(숫자 10~14자리), 카드는 끝 4자리 숫자입니다.';
/** 값이 없는 칸 — 회사 이름 · 사업자번호(2026-11-07 「삐용에서 아직 받지 못했습니다」 → 「—」). */
const NOT_RECEIVED = '—';
/** 「사용 안 함」 줄의 흐림 — 꺼진 버튼(`.btn:disabled`)과 같은 값. */
const OFF_OPACITY = 0.45;

type Confirm = { kind: 'fin'; list: FinList; keys: string[] } | null;

const nameOf = (list: TaxCodeOption[], code: string) => list.find((c) => c.code === code)?.name ?? code;

export function TaxSettingsView() {
  const [data, setData] = useState<TaxSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sel, setSel] = useState<Record<ListName, string[]>>({ accounts: [], cards: [] });
  /** 화면 칸 열쇠 → 서버 문구. 크기가 띠의 「N곳」이다. */
  const [errs, setErrs] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const { message: toast, notify } = useTaxToast();

  const reset = useCallback((d: TaxSettingsResponse) => {
    const fresh = draftOf(d);
    setData(d);
    setBase(fresh);
    setDraft(fresh);
    setSel({ accounts: [], cards: [] });
    setErrs(new Map());
    setFailed(null);
  }, []);

  useEffect(() => {
    loadTaxSettings()
      .then(reset)
      .catch((err: unknown) =>
        setLoadError(err instanceof TaxSettingsError ? err.message : '세무 설정을 불러오지 못했습니다'),
      );
  }, [reset]);

  const dirty = draft !== null && base !== null && !sameDraft(draft, base);
  const leave = useLeaveGuard(dirty);

  /** 칸을 고치면 그 칸의 빨간 테두리를 푼다(시안 `INP["st-f"]`). */
  const clearErr = (key: string) =>
    setErrs((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  const errCls = (key: string) => (errs.has(key) ? t.isErr : '');
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const editEmail = (key: string, field: 'name' | 'email', value: string) => {
    clearErr(`email:${key}:${field}`);
    setDraft((d) => (d ? { ...d, taxEmails: d.taxEmails.map((e) => (e.key === key ? { ...e, [field]: value } : e)) } : d));
  };
  const editFin = (list: FinList, key: string, field: 'instCode' | 'number' | 'alias', value: string) => {
    clearErr(`fin:${key}:${field === 'instCode' ? 'inst' : field}`);
    setDraft((d) => (d ? { ...d, [list]: d[list].map((f) => (f.key === key ? { ...f, [field]: value } : f)) } : d));
  };
  const toggleSel = (list: ListName, key: string, on: boolean) =>
    setSel((s) => ({ ...s, [list]: on ? [...s[list], key] : s[list].filter((k) => k !== key) }));

  const codes = data?.codes;

  // ── 목록 위 버튼 ──
  const add = (list: ListName) => {
    if (!draft || !codes) return;
    const isBank = list === 'accounts';
    const row: DraftFin = {
      key: newKey(),
      id: null,
      kind: isBank ? TAX_FIN_KIND_BANK : TAX_FIN_KIND_CARD,
      instCode: (isBank ? codes.banks[0]?.code : codes.cardCompanies[0]?.code) ?? '',
      number: '',
      alias: '',
      isActive: true,
    };
    patch({ [list]: [...draft[list], row] } as Partial<Draft>);
  };

  const removeRows = (list: ListName, keys: string[]) => {
    setDraft((d) => (d ? ({ ...d, [list]: (d[list] as { key: string }[]).filter((r) => !keys.includes(r.key)) } as Draft) : d));
    setSel((s) => ({ ...s, [list]: [] }));
  };

  /** [삭제] — 빈 줄만이면 바로 지우고, 아니면 확인 창(시안 `ACT["st-del"]`). */
  const askDelete = (list: ListName) => {
    if (!draft) return;
    const keys = sel[list];
    const filled = draft[list].filter((f) => keys.includes(f.key) && (f.number || f.alias));
    if (filled.length === 0) removeRows(list, keys);
    else setConfirm({ kind: 'fin', list, keys });
  };

  /** [사용 안 함] · [다시 사용] — 고른 줄을 그 자리에서 흐리게 ↔ 보통으로. [저장]을 눌러야 반영된다. */
  const setActive = (list: FinList, on: boolean) => {
    if (!draft) return;
    const keys = sel[list];
    patch({ [list]: draft[list].map((f) => (keys.includes(f.key) ? { ...f, isActive: on } : f)) } as Partial<Draft>);
    setSel((s) => ({ ...s, [list]: [] }));
    notify(`${on ? '다시 사용' : '사용 안 함'}으로 바꿨습니다 · [저장]을 눌러야 반영됩니다`);
  };

  // ── [저장] ──
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFailed(null);
    try {
      const fresh = await saveTaxSettings(bodyOf(draft));
      reset(fresh);
      notify('세무 설정을 저장했습니다');
    } catch (err) {
      if (err instanceof TaxSettingsError && err.status === 400 && err.errors.length > 0) {
        setErrs(new Map(err.errors.map((e) => [errorKeyOf(e.field, draft), e.message])));
      } else {
        setErrs(new Map());
        setFailed(err instanceof TaxSettingsError ? err.message : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      setSaving(false);
    }
  };

  const renderConfirm = () => {
    if (!confirm || !draft || !codes) return null;
    const isBank = confirm.list === 'accounts';
    const what = isBank ? '계좌' : '카드';
    const options = isBank ? codes.banks : codes.cardCompanies;
    const rows = draft[confirm.list].filter((f) => confirm.keys.includes(f.key) && (f.number || f.alias));
    return (
      <TaxConfirmDialog
        icon="trash-2"
        danger
        title={confirm.keys.length > 1 ? `${what} ${confirm.keys.length}개를 지우시겠습니까?` : `이 ${what}를 지우시겠습니까?`}
        body={
          <>
            {rows.map((f) => (
              <span key={f.key}>
                <b>
                  {nameOf(options, f.instCode)} · {f.alias}
                </b>
                <br />
              </span>
            ))}
            이 {what}로 올린 자료는 없습니다. [저장]을 눌러야 반영됩니다.
          </>
        }
        okLabel="삭제"
        onCancel={() => setConfirm(null)}
        onOk={() => {
          removeRows(confirm.list, confirm.keys);
          setConfirm(null);
        }}
      />
    );
  };

  if (loadError) {
    return (
      <div className={t.page}>
        <TaxFormErrorBanner kind="failed" message={loadError} />
      </div>
    );
  }
  if (!data || !draft || !codes) {
    return (
      <div className={t.page}>
        <p className={t.help}>불러오는 중…</p>
      </div>
    );
  }

  const co = data.company;
  const locked = data.settings.bizTypeLocked;
  const valueCell = (label: string, v: string | null) => (
    <div key={label}>
      <div className={t.sm}>{label}</div>
      {v ? (
        <div className={t.tnum} style={{ fontSize: 15, color: 'var(--text-heading)', marginTop: 2 }}>
          {v}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-caption)', marginTop: 2 }}>{NOT_RECEIVED}</div>
      )}
    </div>
  );
  const errorOf = (key: string) => errs.get(key) ?? null;

  const listBar = (list: ListName, addLabel: string) => {
    const picked = sel[list].length;
    const chosen = draft[list].filter((f) => sel[list].includes(f.key));
    return (
      <div className={t.row} style={{ marginTop: 12 }}>
        <button type="button" className={`${t.btn} ${t.btnSm}`} onClick={() => add(list)}>
          <Icon name="plus" size={14} />
          {addLabel}
        </button>
        <button type="button" className={`${t.btn} ${t.btnSm} ${t.btnDanger}`} disabled={picked === 0} onClick={() => askDelete(list)}>
          <Icon name="trash-2" size={14} />
          삭제
        </button>
        <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!chosen.some((f) => f.isActive)} onClick={() => setActive(list, false)}>
          사용 안 함
        </button>
        <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={!chosen.some((f) => !f.isActive)} onClick={() => setActive(list, true)}>
          다시 사용
        </button>
        <span className={t.sm}>{picked > 0 ? `${picked}개 선택` : ''}</span>
      </div>
    );
  };

  const rowChk = (list: ListName, key: string) => (
    <input
      type="checkbox"
      className={t.rowchk}
      aria-label="선택"
      checked={sel[list].includes(key)}
      onChange={(e) => toggleSel(list, key, e.target.checked)}
    />
  );

  const finRows = (list: FinList) => {
    const isBank = list === 'accounts';
    const options = isBank ? codes.banks : codes.cardCompanies;
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft[list].map((f) => {
          const off = !f.isActive;
          return (
            <div key={f.key} className={t.row} style={{ flexWrap: 'nowrap' }}>
              {rowChk(list, f.key)}
              <div className={t.row} style={{ flex: 1, minWidth: 0, flexWrap: 'nowrap', opacity: off ? OFF_OPACITY : 1 }}>
                <select
                  disabled={off}
                  className={`${t.select} ${errCls(`fin:${f.key}:inst`)}`}
                  style={{ width: 112 }}
                  value={f.instCode}
                  aria-label={isBank ? '은행' : '카드사'}
                  onChange={(e) => editFin(list, f.key, 'instCode', e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <input
                  disabled={off}
                  className={`${t.input} ${t.tnum} ${errCls(`fin:${f.key}:number`)}`}
                  style={isBank ? { flex: 1, minWidth: 0 } : { width: 90 }}
                  value={f.number}
                  maxLength={isBank ? undefined : 4}
                  placeholder={isBank ? '계좌번호' : '끝 4자리'}
                  aria-label={isBank ? '계좌번호' : '카드 끝 4자리'}
                  onChange={(e) => editFin(list, f.key, 'number', e.target.value)}
                />
                <input
                  disabled={off}
                  className={`${t.input} ${errCls(`fin:${f.key}:alias`)}`}
                  style={isBank ? { width: 100 } : { flex: 1, minWidth: 0 }}
                  value={f.alias}
                  placeholder="별칭"
                  aria-label="별칭"
                  onChange={(e) => editFin(list, f.key, 'alias', e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /** 세무사 메일 4칸 — 한 줄에 두 사람(이름 · 메일 · 이름 · 메일), 2줄. 빈 칸 허용(서버가 둘 다 빈 사람은 버린다). */
  const emailGrid = (
    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr 1.4fr', gap: 8 }}>
      {draft.taxEmails.map((e, i) => [
        <input
          key={`${e.key}-n`}
          className={`${t.input} ${errCls(`email:${e.key}:name`)}`}
          value={e.name}
          placeholder="이름"
          aria-label={`세무사 ${i + 1} 이름`}
          onChange={(ev) => editEmail(e.key, 'name', ev.target.value)}
        />,
        <input
          key={`${e.key}-m`}
          className={`${t.input} ${errCls(`email:${e.key}:email`)}`}
          type="email"
          value={e.email}
          placeholder="메일주소"
          aria-label={`세무사 ${i + 1} 메일`}
          onChange={(ev) => editEmail(e.key, 'email', ev.target.value)}
        />,
      ])}
    </div>
  );

  /** 입력칸이 없는 칸의 오류 — 그 카드 아래 빨간 글자(시안 `.err-t`). */
  const cardError = (key: string) => (errorOf(key) ? <div className={t.errT} style={{ marginTop: 8 }}>{errorOf(key)}</div> : null);

  return (
    <div className={t.page}>
      {/*
        ★ 버튼 줄 — ERP 표양식 편집(s030100020 FormEditor)의 head · actions 꼴 그대로(2026-11-07 대표 결정).
          왼쪽 저장 상태 안내(자리는 늘 있다), 오른쪽 ERP 공통 Button(sm · primary) [저장]. 세무 화면 제목은 머리글에 있어 h1 은 두지 않는다.
          세무 설정에는 작업할 달 줄이 없어(2026-11-07 안내 지움) 이 줄이 맨 위다. 저장 오류 띠는 바로 아래.
      */}
      <div className={forms.editHead}>
        <div className={forms.editTitleRow}>
          <span className={`${forms.editNote} ${dirty ? forms.editNoteDirty : ''}`} role="status">
            {dirty ? '저장하지 않은 변경이 있습니다' : ''}
          </span>
        </div>
        <div className={codesCss.actions}>
          <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
            <Icon name="save" size={16} />
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
      {errs.size > 0 ? <TaxFormErrorBanner kind="input" count={errs.size} guide={INPUT_GUIDE} /> : null}
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.secT}>회사 기본정보</div>
        <div className={t.grid3} style={{ marginTop: 12 }}>
          {valueCell('회사 이름', co.name)}
          {valueCell('사업자번호', co.bizNumber ? formatBizNumber(co.bizNumber) : null)}
          <div>
            <div className={t.sm}>사업자 유형</div>
            {locked ? (
              <div style={{ fontSize: 15, color: 'var(--text-heading)', marginTop: 2 }}>{nameOf(codes.bizTypes, draft.bizType ?? '')}</div>
            ) : (
              <select
                className={`${t.select} ${errCls('bizType')}`}
                style={{ marginTop: 2 }}
                value={draft.bizType ?? ''}
                aria-label="사업자 유형"
                onChange={(e) => {
                  clearErr('bizType');
                  patch({ bizType: e.target.value === '' ? null : e.target.value });
                }}
              >
                <option value="">고르세요</option>
                {codes.bizTypes.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {cardError('bizType')}
      </div>

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.between}>
          <div className={t.secT}>세무사 메일</div>
          <span className={t.sm}>4명까지 · 세무사 사무실 담당자, 대표 참조 등</span>
        </div>
        {emailGrid}
        {cardError('taxEmails')}
      </div>

      <div className={t.grid2}>
        <div className={`${t.card} ${t.cardPad}`}>
          <div className={t.secT}>회사 계좌</div>
          <p className={t.help} style={{ marginTop: 4 }}>
            은행 자료를 올릴 때 고르고, 이 계좌끼리 오간 돈은 「내 계좌끼리」로 짝을 맞춥니다.
          </p>
          {listBar('accounts', '계좌 추가')}
          {finRows('accounts')}
        </div>
        <div className={`${t.card} ${t.cardPad}`}>
          <div className={t.secT}>회사 카드</div>
          <p className={t.help} style={{ marginTop: 4 }}>
            카드 사용 내역을 올릴 때 고르고, 카드대금 출금과 그 달 청구 합계를 짝 맞춥니다.
          </p>
          {listBar('cards', '카드 추가')}
          {finRows('cards')}
        </div>
      </div>


      {renderConfirm()}
      {leave.pendingHref ? (
        <TaxConfirmDialog
          icon="triangle-alert"
          title="저장하지 않은 변경이 있습니다"
          body="이 화면을 나가면 바꾼 내용이 사라집니다. 저장하려면 [돌아가기]를 누른 뒤 [저장]을 누르세요."
          okLabel="나가기"
          onCancel={leave.stay}
          onOk={leave.leave}
        />
      ) : null}
      <TaxToast message={toast} />
    </div>
  );
}
