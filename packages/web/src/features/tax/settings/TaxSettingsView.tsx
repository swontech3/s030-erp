'use client';

/**
 * 세무 설정(s050100010) 본문 — 시안 `doc/tax-service/prototypes/s05-tax/tax-screens-b.js` 의 S05-11 ·
 * 결과서 `08-screen-report.md` S05-11 그대로.
 *
 *   안내 줄(달 선택 없음) · 제목 · 회사 기본정보(보기만) · 사업자 유형 · 세무사 메일 · 회사 계좌 | 회사 카드 ·
 *   우리 회사가 쓰지 않는 자료 · 원천세 신고 주기 · [저장] 줄
 *
 * ★★ 칸을 고쳐도 바로 반영하지 않는다 — 초안(draft)에 담고 **[저장] 하나로 한 번에** 보낸다(`PUT /tax/settings`).
 *    틀린 칸은 서버의 칸별 오류(`errors[]`)로 빨간 테두리 + [저장] 위 빨간 띠. 고치기 시작하면 그 칸 테두리가 풀린다.
 * ★★ 선택지 · 이름 · 설명은 **API 가 준 코드 값으로만** 그린다(코드 관리 s030100030 에서 고친다). 화면에 박지 않는다.
 * ★ 회사 기본정보는 보기만 — 번호는 숫자로 받아 **화면에서만** 하이픈을 붙인다. 없으면 「삐용에서 아직 받지 못했습니다」.
 * ★ 저장하지 않고 화면 안에서 떠나면 시안 모양 확인 창, 새로고침 · 창 닫기는 브라우저 기본(`useLeaveGuard`).
 * ★ 1-1 에는 올린 자료가 없다 — 계좌 · 카드 「올린 자료가 있으면 지우기 막기」는 1-2 에서 붙는다(지금은 늘 지울 수 있다).
 */
import { useCallback, useEffect, useState } from 'react';
import { formatBizNumber, formatCorpNumber } from '@swonbiz/shared/domain/tax-number';
import { TAX_EMAILS_MAX, TAX_FIN_KIND_BANK, TAX_FIN_KIND_CARD, type TaxCodeOption } from '@swonbiz/shared/domain/tax-settings';
import { Icon } from '@/components/ds';
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
  type DraftEmail,
  type DraftFin,
  type TaxSettingsResponse,
} from './tax-settings-model';

type FinList = 'accounts' | 'cards';
type ListName = 'taxEmails' | FinList;

/** 입력 오류 띠의 안내 — 결과서 S05-11 [저장]. */
const INPUT_GUIDE = '메일은 name@example.com 모양, 계좌번호는 숫자와 - 만(숫자 10~14자리), 카드는 끝 4자리 숫자입니다.';
const NOT_RECEIVED = '삐용에서 아직 받지 못했습니다';

type Confirm = { kind: 'email'; keys: string[] } | { kind: 'fin'; list: FinList; keys: string[] } | null;

const nameOf = (list: TaxCodeOption[], code: string) => list.find((c) => c.code === code)?.name ?? code;

export function TaxSettingsView() {
  const [data, setData] = useState<TaxSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sel, setSel] = useState<Record<ListName, string[]>>({ taxEmails: [], accounts: [], cards: [] });
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
    setSel({ taxEmails: [], accounts: [], cards: [] });
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
    if (list === 'taxEmails') {
      if (draft.taxEmails.length >= TAX_EMAILS_MAX) return;
      patch({ taxEmails: [...draft.taxEmails, { key: newKey(), name: '', email: '' }] });
      return;
    }
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
    if (list === 'taxEmails') {
      const filled = draft.taxEmails.filter((e) => keys.includes(e.key) && (e.name || e.email));
      if (filled.length === 0) removeRows(list, keys);
      else setConfirm({ kind: 'email', keys });
      return;
    }
    const filled = draft[list].filter((f) => keys.includes(f.key) && (f.number || f.alias));
    if (filled.length === 0) removeRows(list, keys);
    else setConfirm({ kind: 'fin', list, keys });
  };

  /** [사용 안 함] — 고른 줄을 목록에서 숨긴다. */
  const turnOff = (list: FinList) => {
    if (!draft) return;
    const keys = sel[list];
    patch({ [list]: draft[list].map((f) => (keys.includes(f.key) ? { ...f, isActive: false } : f)) } as Partial<Draft>);
    setSel((s) => ({ ...s, [list]: [] }));
    notify('사용 안 함으로 바꿨습니다 · [저장]을 눌러야 반영됩니다');
  };
  const turnOn = (list: FinList, key: string) => {
    if (!draft) return;
    patch({ [list]: draft[list].map((f) => (f.key === key ? { ...f, isActive: true } : f)) } as Partial<Draft>);
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
    if (confirm.kind === 'email') {
      const rows = draft.taxEmails.filter((e) => confirm.keys.includes(e.key) && (e.name || e.email));
      return (
        <TaxConfirmDialog
          icon="trash-2"
          danger
          title={confirm.keys.length > 1 ? `메일 ${confirm.keys.length}개를 지우시겠습니까?` : '이 메일을 지우시겠습니까?'}
          body={
            <>
              {rows.map((e) => (
                <span key={e.key}>
                  <b>{e.name}</b> {e.email}
                  <br />
                </span>
              ))}
              [저장]을 눌러야 반영됩니다.
            </>
          }
          okLabel="삭제"
          onCancel={() => setConfirm(null)}
          onOk={() => {
            removeRows('taxEmails', confirm.keys);
            setConfirm(null);
          }}
        />
      );
    }
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
  const companyCells: [string, string | null][] = [
    ['회사 이름', co.name],
    ['사업자등록번호', co.bizNumber ? formatBizNumber(co.bizNumber) : null],
    ['법인등록번호', co.corpNumber ? formatCorpNumber(co.corpNumber) : null],
  ];
  const errorOf = (key: string) => errs.get(key) ?? null;

  const listBar = (list: ListName, addLabel: string) => {
    const picked = sel[list].length;
    const full = list === 'taxEmails' && draft.taxEmails.length >= TAX_EMAILS_MAX;
    return (
      <div className={t.row} style={{ marginTop: 12 }}>
        <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={full} onClick={() => add(list)}>
          <Icon name="plus" size={14} />
          {addLabel}
        </button>
        <button type="button" className={`${t.btn} ${t.btnSm} ${t.btnDanger}`} disabled={picked === 0} onClick={() => askDelete(list)}>
          <Icon name="trash-2" size={14} />
          삭제
        </button>
        {list !== 'taxEmails' ? (
          <button type="button" className={`${t.btn} ${t.btnSm}`} disabled={picked === 0} onClick={() => turnOff(list)}>
            사용 안 함
          </button>
        ) : null}
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

  const offList = (list: FinList) => {
    const offs = draft[list].filter((f) => !f.isActive);
    if (offs.length === 0) return null;
    return (
      <div className={t.sm} style={{ marginTop: 6 }}>
        사용 안 함 ·{' '}
        {offs.map((f, i) => (
          <span key={f.key}>
            {i > 0 ? ' · ' : ''}
            {f.alias || f.number}{' '}
            <button type="button" className={`${t.btn} ${t.btnLink}`} style={{ fontSize: 12 }} onClick={() => turnOn(list, f.key)}>
              다시 사용
            </button>
          </span>
        ))}
      </div>
    );
  };

  const finRows = (list: FinList) => {
    const isBank = list === 'accounts';
    const options = isBank ? codes.banks : codes.cardCompanies;
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft[list].map((f) =>
          f.isActive ? (
            <div key={f.key} className={t.row} style={{ flexWrap: 'nowrap' }}>
              {rowChk(list, f.key)}
              <select
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
                className={`${t.input} ${t.tnum} ${errCls(`fin:${f.key}:number`)}`}
                style={isBank ? { flex: 1, minWidth: 0 } : { width: 90 }}
                value={f.number}
                maxLength={isBank ? undefined : 4}
                placeholder={isBank ? '계좌번호' : '끝 4자리'}
                aria-label={isBank ? '계좌번호' : '카드 끝 4자리'}
                onChange={(e) => editFin(list, f.key, 'number', e.target.value)}
              />
              <input
                className={`${t.input} ${errCls(`fin:${f.key}:alias`)}`}
                style={isBank ? { width: 100 } : { flex: 1, minWidth: 0 }}
                value={f.alias}
                placeholder="별칭"
                aria-label="별칭"
                onChange={(e) => editFin(list, f.key, 'alias', e.target.value)}
              />
            </div>
          ) : null,
        )}
        {offList(list)}
      </div>
    );
  };

  const emailRows = (rows: DraftEmail[]) => (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((e) => (
        <div key={e.key} className={t.row} style={{ flexWrap: 'nowrap' }}>
          {rowChk('taxEmails', e.key)}
          <input
            className={`${t.input} ${errCls(`email:${e.key}:name`)}`}
            style={{ flex: 1 }}
            value={e.name}
            placeholder="이름 · 역할"
            aria-label="이름 · 역할"
            onChange={(ev) => editEmail(e.key, 'name', ev.target.value)}
          />
          <input
            className={`${t.input} ${errCls(`email:${e.key}:email`)}`}
            style={{ flex: 1.2 }}
            type="email"
            value={e.email}
            placeholder="name@example.com"
            aria-label="메일"
            onChange={(ev) => editEmail(e.key, 'email', ev.target.value)}
          />
        </div>
      ))}
    </div>
  );

  /** 입력칸이 없는 칸의 오류 — 그 카드 아래 빨간 글자(시안 `.err-t`). */
  const cardError = (key: string) => (errorOf(key) ? <div className={t.errT} style={{ marginTop: 8 }}>{errorOf(key)}</div> : null);

  return (
    <div className={t.page}>
      <div className={t.ctx}>
        <span className={t.ctxNote}>세무 설정은 달과 상관없습니다</span>
      </div>
      <div className={t.pageH}>
        <div>
          <h1>세무 설정</h1>
          <p>세무에만 쓰는 값을 정합니다. 처음에 한 번 하고, 바뀔 때만 고칩니다.</p>
        </div>
      </div>

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.between}>
          <div className={t.secT}>회사 기본정보</div>
          <span className={t.sm}>삐용 단체관리가 정본입니다 — 여기서는 보기만 합니다</span>
        </div>
        <div className={t.grid3} style={{ marginTop: 12 }}>
          {companyCells.map(([k, v]) => (
            <div key={k}>
              <div className={t.sm}>{k}</div>
              {v ? (
                <div className={t.tnum} style={{ fontSize: 15, color: 'var(--text-heading)', marginTop: 2 }}>
                  {v}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-caption)', marginTop: 2 }}>{NOT_RECEIVED}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.secT}>사업자 유형</div>
        <p className={t.help} style={{ marginTop: 4 }}>
          분류 항목, 부가세 신고 기간, 마감일이 이 값에 따라 바뀝니다.
        </p>
        <div className={t.row} style={{ marginTop: 12, gap: 24 }}>
          {codes.bizTypes.map((o) => (
            <label key={o.code} className={t.chk}>
              <input
                type="radio"
                name="tax-biz-type"
                value={o.code}
                checked={draft.bizType === o.code}
                onChange={() => {
                  clearErr('bizType');
                  patch({ bizType: o.code });
                }}
              />
              {o.name}
              {o.description ? <span className={t.sm}>— {o.description}</span> : null}
            </label>
          ))}
        </div>
        {cardError('bizType')}
      </div>

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.between}>
          <div className={t.secT}>세무사 메일</div>
          <span className={t.sm}>최대 3개 · 세무사 사무실 담당자, 대표 참조 등</span>
        </div>
        {listBar('taxEmails', '메일 추가')}
        {emailRows(draft.taxEmails)}
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

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.secT}>우리 회사가 쓰지 않는 자료</div>
        <p className={t.help} style={{ marginTop: 4 }}>
          고른 자료는 매달 자동으로 「없음」이 되어 할 일에서 빠집니다. 이번 달에만 없는 자료는 자료 올리기에서 「이번 달
          없음」을 누르세요.
        </p>
        <div className={t.grid4} style={{ marginTop: 12 }}>
          {codes.kinds.map((k) => (
            <label key={k.code} className={t.chk}>
              <input
                type="checkbox"
                checked={draft.unusedKinds.includes(k.code)}
                onChange={(e) => {
                  clearErr('unusedKinds');
                  patch({
                    unusedKinds: e.target.checked
                      ? [...draft.unusedKinds, k.code]
                      : draft.unusedKinds.filter((c) => c !== k.code),
                  });
                }}
              />
              {k.name}
            </label>
          ))}
        </div>
        {cardError('unusedKinds')}
      </div>

      <div className={`${t.card} ${t.cardPad}`}>
        <div className={t.secT}>원천세 신고 주기</div>
        <p className={t.help} style={{ marginTop: 4 }}>
          원천세 마감일과 신고자료를 만드는 때가 이 값에 따라 바뀝니다.
        </p>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {codes.withholdingCycles.map((o) => (
            <label key={o.code} className={t.chk}>
              <input
                type="radio"
                name="tax-withholding-cycle"
                value={o.code}
                checked={draft.withholdingCycle === o.code}
                onChange={() => {
                  clearErr('withholdingCycle');
                  patch({ withholdingCycle: o.code });
                }}
              />
              <span>
                {o.name} {o.description ? <span className={t.sm}>— {o.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
        {cardError('withholdingCycle')}
      </div>

      {errs.size > 0 ? <TaxFormErrorBanner kind="input" count={errs.size} guide={INPUT_GUIDE} /> : null}
      {failed ? <TaxFormErrorBanner kind="failed" message={failed} /> : null}
      <div className={t.row} style={{ gap: 12 }}>
        <button type="button" className={`${t.btn} ${t.btnPrimary}`} disabled={saving} onClick={() => void save()}>
          저장
        </button>
        {dirty ? (
          <span className={t.sm} style={{ color: 'var(--color-warning-text)', fontWeight: 700 }}>
            저장하지 않은 변경이 있습니다
          </span>
        ) : null}
        <span className={t.help}>
          자료를 올린 계좌·카드는 지울 수 없고 「사용 안 함」으로 바꿉니다 — 목록에서 숨기고, 올린 자료에는 이름이 그대로
          보입니다.
        </span>
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
