'use client';

/**
 * 설정(s040900010) 본문 — 왼쪽 구분 목록 + 오른쪽 편집(2026-10-18).
 *
 * ★ **시안이 없다.** 모양은 코드 관리(s030100030)와 같다 — 왼쪽 목록 · 오른쪽 패널은 `codes.module.css`,
 *   입력칸 · 버튼 · 안내 띠는 법무 상세(`corp-change-detail.module.css`), 회사유형 탭은 청구 화면의 탭
 *   (`billing.module.css` — 입주사 화면의 탭과 같은 모양)을 그대로 쓴다. 새 색 · 새 스타일은 없다.
 *
 * ★★ 저장 규칙은 shared `doc-form-setting.ts` 머리말 1~8 — 화면은 칸을 글자로 들고 있다가 저장할 때 보내고,
 *    서버의 칸별 오류를 그 칸 아래에 그린다.
 *   · 법인변경 = 기본 · 주식회사 · 유한회사 탭. 회사유형 탭의 빈칸은 기본 줄 값을 쓴다(흐린 글자로 보인다)
 *   · 법인설립 = 기본 줄만(결정 3 — 탭이 없다). 세금은 세율 · 최소액 · 배수 · 교육세율 · 수수료(결정 1)
 *   · 기본 줄은 지우지 않고 「사용」을 끈다. 회사유형 줄만 지운다(결정 2)
 *   · 목적변경은 상호변경 줄을 같이 쓴다 — 고르면 안내만 보이고 상호변경으로 보낸다
 *   · 저장하지 않은 수정이 있으면 다른 줄 · 탭으로 옮기거나 화면을 나갈 때 묻는다(법무 상세의 「나갈 때 확인」과 같다)
 *
 * ★ 등기 설정을 고치는 자리는 이 화면 하나다(한 업무는 한 화면). 코드(등기 종류 · 회사유형 이름)는 읽기만 한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INCORP_TAX_LABEL, type DocFormSettingItem } from '@swonbiz/shared/domain/doc-form-setting';
import { INCORP_TAX_KEYS } from '@swonbiz/shared/domain/incorporation-tax';
import { Button, Icon } from '@/components/ds';
import { comma, formatMoneyInput } from '@/features/contracts/form-model';
import { ModalShell } from '@/features/facility/ModalShell';
import {
  DocFormSettingError,
  bodyOf,
  deleteDocFormSettingOverride,
  draftOf,
  fixedTaxTotal,
  loadDocFormSettings,
  saveDocFormSetting,
  type DocFormDomain,
  type DocFormSettingsResponse,
  type Draft,
  type IncorpTaxKey,
} from './doc-form-settings-model';
import cs from '@/features/codes/codes.module.css';
import ls from './corp-change-detail.module.css';
import bs from '@/features/billing/billing.module.css';

/** 설립 세금 칸의 안내 — 단위. */
const INCORP_TAX_HINT: Record<IncorpTaxKey, string> = {
  regLicenseRate: '자본금의 1,000분의 n',
  regLicenseMin: '원',
  metroMultiplier: '배(최소액을 적용한 뒤 곱한다)',
  localEduRate: '등록면허세의 100분의 n',
  regFee: '원',
};

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : comma(n));

/** 화면을 나갈 때 — 법무 상세와 같은 문구. */
const LEAVE_MESSAGE = '저장하지 않은 내용이 사라집니다. 이 화면을 나갈까요?';
/** 다른 줄 · 탭으로 옮길 때. */
const SWITCH_MESSAGE = '저장하지 않은 내용이 사라집니다. 옮길까요?';
/** 법인변경 상호변경(NAME) 줄의 등기의 목적 안내 — 목적변경(PURPOSE)이 이 줄을 같이 쓴다. */
const NAME_PURPOSE_HINT = '목적변경도 이 줄을 같이 씁니다. 비워 두면 서류에 각 구분 이름(상호변경 · 목적변경)이 들어갑니다';

export function DocFormSettingsView() {
  const [data, setData] = useState<DocFormSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sel, setSel] = useState<{ domain: DocFormDomain; code: string } | null>(null);
  /** '' = 기본 줄 · 'R' · 'A'. */
  const [tab, setTab] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErr, setFieldErr] = useState<{ field: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const refresh = useCallback(async (): Promise<DocFormSettingsResponse | null> => {
    try {
      const d = await loadDocFormSettings();
      setData(d);
      setError(null);
      return d;
    } catch (err) {
      setError(err instanceof DocFormSettingError ? err.message : '등기 설정을 불러오지 못했습니다');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const group = sel && data ? (data.groups.find((g) => g.domain === sel.domain) ?? null) : null;
  const item: DocFormSettingItem | null = sel && group ? (group.items.find((i) => i.code === sel.code) ?? null) : null;
  const rowOf = (it: DocFormSettingItem | null, companyType: string) => it?.rows.find((r) => r.companyType === companyType) ?? null;
  const row = rowOf(item, tab);
  const base = rowOf(item, '');
  const isBase = tab === '';
  const companyTypes = data?.companyTypes ?? [];
  const tabName = isBase ? '기본' : (companyTypes.find((c) => c.code === tab)?.name ?? tab);
  /** 회사유형 탭에서 빈칸 안에 흐리게 보일 기본 줄 값. */
  const inherit = isBase ? null : base;

  // ── 저장하지 않은 수정 — 다른 줄 · 탭으로 옮기거나 화면을 나갈 때 확인(법무 상세와 같은 방식) ──
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(row));
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    /*
     * ★ 화면 안의 링크(사이드바)는 beforeunload 가 울리지 않는다 — 클라이언트 전환이라서다. 그래서 문서
     *   맨 위에서 **잡는 단계(capture)** 로 링크 누름을 먼저 본다(법인변경 상세와 같다).
     * ★ 새 탭(가운데 단추 · Ctrl/⌘ · target=_blank)은 이 화면을 떠나는 것이 아니라 막지 않는다.
     */
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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
  }, [dirty]);

  /**
   * 고르기 · 탭 바꾸기 — 그 줄로 초안을 새로 만든다. 저장하지 않은 수정이 있으면 먼저 묻는다.
   * @param force 저장 · 삭제 직후 새로 읽은 값으로 다시 열 때 — 묻지 않는다
   */
  const open = (
    domain: DocFormDomain,
    code: string,
    companyType: string,
    from: DocFormSettingsResponse | null = data,
    force = false,
  ) => {
    const same = sel?.domain === domain && sel.code === code && tab === companyType;
    if (!force && !same && dirty && !window.confirm(SWITCH_MESSAGE)) return;
    const it = from?.groups.find((g) => g.domain === domain)?.items.find((i) => i.code === code) ?? null;
    setSel({ domain, code });
    setTab(companyType);
    setDraft(draftOf(rowOf(it, companyType)));
    setFieldErr(null);
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const errOf = (field: string) => (fieldErr?.field === field ? fieldErr.message : null);

  const save = async () => {
    if (!sel || !draft) return;
    setSaving(true);
    setFieldErr(null);
    try {
      await saveDocFormSetting(bodyOf(sel.domain, sel.code, tab, draft));
      const fresh = await refresh();
      if (fresh) open(sel.domain, sel.code, tab, fresh, true);
      notify('저장했습니다');
    } catch (err) {
      if (err instanceof DocFormSettingError) setFieldErr({ field: err.field ?? 'body', message: err.message });
      else setFieldErr({ field: 'body', message: '저장하지 못했습니다' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!sel || isBase) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocFormSettingOverride(sel.domain, sel.code, tab);
      setConfirmDelete(false);
      const fresh = await refresh();
      open(sel.domain, sel.code, '', fresh, true);
      notify(`${tabName} 줄을 지웠습니다 — 기본 줄 값을 씁니다`);
    } catch (err) {
      setDeleteError(err instanceof DocFormSettingError ? err.message : '지우지 못했습니다');
    } finally {
      setDeleting(false);
    }
  };

  const itemCount = useMemo(() => (data?.groups ?? []).reduce((s, g) => s + g.items.length, 0), [data]);
  /** 칸 아래에 그리지 못하는 오류(본문 · 구분 · 회사유형) — 패널 위 띠로. */
  const KNOWN = /^(label|formNo|regPurpose|regReason|matter|matterBody|isActive|taxes\.|incorpTax\.|attachments)/;
  const topError = fieldErr && !KNOWN.test(fieldErr.field) ? fieldErr.message : null;

  return (
    <div className={cs.page}>
      <div className={cs.head}>
        <h1 className={cs.title}>설정</h1>
      </div>

      <div className={cs.body}>
        {/* ══════════ 좌측 · 구분 목록 ══════════ */}
        <aside className={cs.tree}>
          <div className={cs.treeBody}>
            {loading ? (
              <p className={cs.empty}>불러오는 중…</p>
            ) : (
              (data?.groups ?? []).map((g) => (
                <div key={g.domain}>
                  <div className={cs.treeHead}>
                    <span className={ls.label}>{g.name}</span>
                  </div>
                  {g.items.length === 0 ? (
                    <p className={cs.empty}>등기 종류 코드가 없습니다</p>
                  ) : (
                    g.items.map((it) => {
                      const b = rowOf(it, '');
                      const on = sel?.domain === g.domain && sel.code === it.code;
                      return (
                        <div key={it.code} className={`${cs.node} ${on ? cs.nodeOn : ''}`}>
                          <button type="button" className={cs.nodePick} onClick={() => open(g.domain, it.code, '')}>
                            <span className={cs.nodeKey}>{it.code}</span>
                            <span className={cs.nodeLabel}>{it.name}</span>
                            {it.sharedWith ? (
                              <span className={`${cs.tag} ${cs.tagOff}`}>상호변경 줄 사용</span>
                            ) : !b ? (
                              <span className={`${cs.tag} ${cs.tagOff}`}>미설정</span>
                            ) : !b.isActive ? (
                              <span className={`${cs.tag} ${cs.tagOff}`}>사용 끔</span>
                            ) : (
                              <span className={cs.nodeCount}>{b.formNo ?? ''}</span>
                            )}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              ))
            )}
          </div>
          <div className={cs.treeFoot}>
            <span>등기 종류 {itemCount}개</span>
          </div>
        </aside>

        {/* ══════════ 우측 · 편집 ══════════ */}
        <section className={cs.panel}>
          {error ? <p className={cs.error}>{error}</p> : null}

          {!item || !group || !draft ? (
            <div className={cs.panelEmpty}>
              <span className={cs.emptyIcon}>
                <Icon name="settings" size={40} />
              </span>
              <p className={cs.emptyLead}>등기 종류를 고르세요</p>
              <p className={cs.emptySub}>왼쪽에서 등기 종류를 누르면 그 설정이 나옵니다</p>
            </div>
          ) : item.sharedWith ? (
            <div className={cs.panelEmpty}>
              <span className={cs.emptyIcon}>
                <Icon name="info" size={40} />
              </span>
              <p className={cs.emptyLead}>
                {item.name}은(는) {group.items.find((i) => i.code === item.sharedWith)?.name ?? item.sharedWith} 줄을 같이 씁니다
              </p>
              <p className={cs.emptySub}>표시명 · 양식호수 · 세금 · 첨부서면은 그 줄에서 고칩니다</p>
              <p className={cs.emptySub}>
                <button type="button" className={cs.btnXs} onClick={() => open(group.domain, item.sharedWith!, '')}>
                  {group.items.find((i) => i.code === item.sharedWith)?.name ?? item.sharedWith} 열기
                </button>
              </p>
            </div>
          ) : (
            <>
              <div className={cs.panelHead}>
                <div>
                  <h2 className={cs.panelTitle}>
                    {item.name}({item.code})
                  </h2>
                  <p className={cs.panelSub}>
                    {group.name} · {tabName} 줄 · {row ? `수정 ${row.updatedAt}` : '미설정 — 저장하면 줄이 생깁니다'}
                  </p>
                </div>
                <div className={cs.actions}>
                  {!isBase && row ? (
                    <button
                      type="button"
                      className={`${cs.btnXs} ${cs.btnDanger}`}
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmDelete(true);
                      }}
                    >
                      {tabName} 줄 삭제
                    </button>
                  ) : null}
                  <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
                    <Icon name="save" size={16} />
                    {saving ? '저장 중…' : '저장'}
                  </Button>
                </div>
              </div>

              {/* 회사유형 탭 — 법인변경만(결정 3) */}
              {group.domain === 'corp-change' ? (
                <div className={bs.tabs} role="tablist">
                  {[{ code: '', name: '기본' }, ...companyTypes].map((t) => (
                    <button
                      key={t.code || 'base'}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.code}
                      className={`${bs.tab} ${tab === t.code ? bs.tabOn : ''}`}
                      onClick={() => open(group.domain, item.code, t.code)}
                    >
                      {t.name}
                      {t.code !== '' && rowOf(item, t.code) ? ' ●' : ''}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className={cs.treeBody}>
                <div className={ls.formScroll}>
                  <div className={ls.formWrap}>
                    {topError ? <div className={`${ls.banner} ${ls.bannerError}`}>{topError}</div> : null}
                    {!isBase ? (
                      <div className={`${ls.banner} ${ls.bannerInfo}`}>
                        {tabName} 줄 — 비워 둔 칸은 기본 줄 값(흐린 글자)을 씁니다. 채운 칸만 {tabName}에 적용됩니다.
                      </div>
                    ) : null}

                    <div className={ls.grid4}>
                      <TextField
                        label="표시명"
                        required={isBase}
                        wide
                        value={draft.label}
                        placeholder={inherit?.label}
                        hint="신청서 머리의 양식호수 뒤 제목"
                        error={errOf('label')}
                        onChange={(v) => patch({ label: v })}
                      />
                      <TextField
                        label="양식호수"
                        value={draft.formNo}
                        placeholder={inherit?.formNo}
                        error={errOf('formNo')}
                        onChange={(v) => patch({ formNo: v })}
                      />
                      {isBase ? (
                        <div className={ls.field}>
                          <span className={ls.label}>사용 여부</span>
                          <div className={ls.checkRow}>
                            <label className={ls.checkItem}>
                              <input type="checkbox" checked={draft.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />
                              사용
                            </label>
                          </div>
                          {errOf('isActive') ? (
                            <span className={ls.fieldError}>{errOf('isActive')}</span>
                          ) : (
                            <span className={ls.hint}>끄면 이 종류의 설정이 서류에 나가지 않습니다</span>
                          )}
                        </div>
                      ) : (
                        <div />
                      )}
                      <TextField
                        label="등기의 목적"
                        wide
                        value={draft.regPurpose}
                        placeholder={inherit?.regPurpose}
                        hint={
                          group.domain === 'corp-change' && item.code === 'NAME' ? NAME_PURPOSE_HINT : '비면 등기 종류 이름이 나갑니다'
                        }
                        error={errOf('regPurpose')}
                        onChange={(v) => patch({ regPurpose: v })}
                      />
                      <TextField
                        label="등기의 사유"
                        wide
                        value={draft.regReason}
                        placeholder={inherit?.regReason}
                        error={errOf('regReason')}
                        onChange={(v) => patch({ regReason: v })}
                      />
                      {group.domain === 'corp-change' ? (
                        <>
                          <TextField
                            label="등기할 사항(제목)"
                            wide
                            multiline
                            value={draft.matter}
                            placeholder={inherit?.matter}
                            error={errOf('matter')}
                            onChange={(v) => patch({ matter: v })}
                          />
                          <TextField
                            label="등기할 사항(내용)"
                            wide
                            multiline
                            value={draft.matterBody}
                            placeholder={inherit?.matterBody}
                            hint="서류의 자동 문장 앞에 한 줄로 붙습니다"
                            error={errOf('matterBody')}
                            onChange={(v) => patch({ matterBody: v })}
                          />
                        </>
                      ) : null}
                    </div>

                    {/* ── 세금 ── */}
                    <div>
                      <div className={ls.sectionHeader}>
                        <h2>세금</h2>
                      </div>
                      <div className={ls.sectionRule} />
                      {group.domain === 'corp-change' ? (
                        <div className={ls.grid4}>
                          {(['regLicense', 'localEdu', 'regFee'] as const).map((k) => (
                            <MoneyField
                              key={k}
                              label={{ regLicense: '등록면허세', localEdu: '지방교육세', regFee: '등기신청수수료' }[k]}
                              value={draft.taxes[k]}
                              placeholder={money(inherit?.taxes?.[k])}
                              error={errOf(`taxes.${k}`)}
                              onChange={(v) => patch({ taxes: { ...draft.taxes, [k]: v } })}
                            />
                          ))}
                          <div className={ls.field}>
                            <span className={ls.label}>세액합계</span>
                            <div className={`${ls.readValue} ${ls.tabular}`}>{fixedTaxTotal(draft.taxes) || '—'}</div>
                            <span className={ls.hint}>등록면허세 + 지방교육세</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className={ls.sectionNote}>
                            자본금으로 계산합니다 — 등록면허세 = 자본금 × 세율(최소액 이상, 대도시 중과면 × 배수), 지방교육세 =
                            등록면허세 × 율, 각각 10원 미만 버림. 다섯 칸을 모두 넣거나 모두 비웁니다. 비면 서류의 세금 칸은 빈칸입니다.
                          </p>
                          <div className={ls.grid4}>
                            {INCORP_TAX_KEYS.map((k) => (
                              <MoneyField
                                key={k}
                                label={INCORP_TAX_LABEL[k]}
                                value={draft.incorpTax[k]}
                                hint={INCORP_TAX_HINT[k]}
                                error={errOf(`incorpTax.${k}`)}
                                onChange={(v) => patch({ incorpTax: { ...draft.incorpTax, [k]: v } })}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── 첨부서면 ── */}
                    <div>
                      <div className={ls.sectionHeader}>
                        <div className={ls.sectionTitle}>
                          <h2>첨부서면</h2>
                          <span className={ls.muted}>{draft.attachments.length}개</span>
                        </div>
                        <button
                          type="button"
                          className={`${ls.btn} ${ls.btnGhost} ${ls.btnXs}`}
                          onClick={() => patch({ attachments: [...draft.attachments, { name: '', copies: '1' }] })}
                        >
                          <Icon name="plus" size={14} />
                          행 추가
                        </button>
                      </div>
                      <div className={ls.sectionRule} />
                      <p className={ls.sectionNote}>
                        {isBase
                          ? '적은 순서대로 찍힙니다. 통수가 0 이면 번호 · 통수 없이 이름만 찍힙니다. 이름이 빈 행은 저장하지 않습니다.'
                          : `비워 두면 기본 줄의 첨부서면(${base?.attachments.length ?? 0}개)을 씁니다. 하나라도 넣으면 이 목록만 씁니다.`}
                      </p>
                      {errOf('attachments') ? <p className={ls.fieldError}>{errOf('attachments')}</p> : null}
                      {draft.attachments.length === 0 ? (
                        <p className={ls.empty}>첨부서면이 없습니다</p>
                      ) : (
                        <div className={ls.grid4}>
                          <span className={`${ls.label} ${ls.span2}`}>서류명</span>
                          <span className={ls.label}>통수</span>
                          <span />
                          {draft.attachments.map((a, i) => {
                            const set = (p: Partial<{ name: string; copies: string }>) =>
                              patch({ attachments: draft.attachments.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                            const move = (to: number) => {
                              const next = [...draft.attachments];
                              [next[i], next[to]] = [next[to]!, next[i]!];
                              patch({ attachments: next });
                            };
                            const nameErr = errOf(`attachments.${i}.name`) ?? errOf(`attachments.${i}`);
                            const copiesErr = errOf(`attachments.${i}.copies`);
                            return (
                              <div key={i} className={ls.spanAll}>
                                <div className={ls.grid4}>
                                  <div className={`${ls.field} ${ls.span2}`}>
                                    <input
                                      aria-label={`첨부서면 ${i + 1} 서류명`}
                                      className={`${ls.input}${nameErr ? ` ${ls.inputInvalid}` : ''}`}
                                      value={a.name}
                                      onChange={(e) => set({ name: e.target.value })}
                                    />
                                    {nameErr ? <span className={ls.fieldError}>{nameErr}</span> : null}
                                  </div>
                                  <div className={ls.field}>
                                    <input
                                      aria-label={`첨부서면 ${i + 1} 통수`}
                                      className={`${ls.input} ${ls.tabular} ${ls.numInput}${copiesErr ? ` ${ls.inputInvalid}` : ''}`}
                                      inputMode="numeric"
                                      value={a.copies}
                                      onChange={(e) => set({ copies: formatMoneyInput(e.currentTarget) })}
                                    />
                                    {copiesErr ? <span className={ls.fieldError}>{copiesErr}</span> : null}
                                  </div>
                                  <div className={ls.oActions}>
                                    <button type="button" className={cs.btnXs} disabled={i === 0} onClick={() => move(i - 1)}>
                                      위
                                    </button>
                                    <button
                                      type="button"
                                      className={cs.btnXs}
                                      disabled={i === draft.attachments.length - 1}
                                      onClick={() => move(i + 1)}
                                    >
                                      아래
                                    </button>
                                    <button
                                      type="button"
                                      className={cs.btnXs}
                                      onClick={() => patch({ attachments: draft.attachments.filter((_, j) => j !== i) })}
                                    >
                                      삭제
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {confirmDelete && item && group ? (
        <ModalShell
          title={`${tabName} 줄 삭제`}
          desc={`${item.name}의 ${tabName} 줄을 지웁니다. 지우면 ${tabName} 회사도 기본 줄 값을 씁니다.`}
          busy={deleting}
          error={deleteError}
          okLabel="삭제"
          okDanger
          onClose={() => setConfirmDelete(false)}
          onOk={() => void remove()}
        >
          {null}
        </ModalShell>
      ) : null}

      {toast ? (
        <div className={ls.toast} role="status">
          <Icon name="circle-check" size={16} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// 칸 — 법무 상세의 입력칸 그대로
// =============================================================================

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  required,
  wide,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | null;
  hint?: string;
  error: string | null;
  required?: boolean;
  wide?: boolean;
  multiline?: boolean;
}) {
  const cls = `${multiline ? ls.textarea : ls.input}${error ? ` ${ls.inputInvalid}` : ''}`;
  return (
    <label className={`${ls.field}${wide ? ` ${ls.span2}` : ''}`}>
      <span className={ls.label}>
        {label} {required ? <span className={ls.req}>*</span> : null}
      </span>
      {multiline ? (
        <textarea className={cls} rows={3} value={value} placeholder={placeholder ?? undefined} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={cls} value={value} placeholder={placeholder ?? undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {error ? <span className={ls.fieldError}>{error}</span> : hint ? <span className={ls.hint}>{hint}</span> : null}
    </label>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  error: string | null;
}) {
  return (
    <label className={ls.field}>
      <span className={ls.label}>{label}</span>
      <input
        className={`${ls.input} ${ls.tabular} ${ls.numInput}${error ? ` ${ls.inputInvalid}` : ''}`}
        inputMode="numeric"
        value={value}
        placeholder={placeholder || undefined}
        onChange={(e) => onChange(formatMoneyInput(e.currentTarget))}
      />
      {error ? <span className={ls.fieldError}>{error}</span> : hint ? <span className={ls.hint}>{hint}</span> : null}
    </label>
  );
}
