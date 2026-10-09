'use client';

/**
 * 표양식 관리(s030100020) 본문 — 왼쪽 양식 목록 + 오른쪽 입력칸 · 미리보기 · [인쇄].
 *
 * ★ 모양은 **코드 관리(s030100030)와 같다**(사용자 지시 「다른 ERP 화면과 같게」) —
 *   `codes.module.css` 를 그대로 쓴다. 왼쪽 420px · 검색 줄 · 줄 끝 작은 버튼 · 아래 띠.
 *
 * =============================================================================
 * ★★★ 양식 편집은 이 화면, **법무 서류 출력은 법무 서비스(s04)** 다 (결정 2026-10-09)
 * =============================================================================
 * 양식을 고르고 → 칸을 채우고 → [인쇄]. 2026-10-07 에는 「문서를 뽑는 곳은 이 화면 하나」
 * 였지만 고쳤다 — 법무 서류는 회사가 직접 로그인해 뽑는데, 이 화면은 운영사 전용이다.
 * 그래서 **법무 양식(`isLegalForm`)은 여기서 [인쇄] 를 막는다.** 일반 서류(재직증명서 등)는
 * 그대로 여기서 뽑는다(CLAUDE.md 「한 업무는 한 화면에서」). 「대상을 고른다」는 지금은
 * **손으로 입력하는 것**과 같은 뜻이다 — 자동 채움은 아직 없다(`domain/form-template.ts` 머리말).
 *
 * ★ 입력칸은 양식 안의 `{{…}}` 전부다(`inputFieldsOf`). 이름표가 없으면 자리표시 글자를
 *   그대로 보인다 — 기존 양식 2건이 이름표 없이 그대로 뽑혀야 한다(결정 2026-10-07).
 * ★ 입력한 값은 **저장하지 않는다.** 뽑을 때 한 번 쓰는 값이다. 양식을 옮기면 비운다
 *   — 다른 양식에 같은 이름의 자리표시가 있어도 남의 값을 들고 가지 않게.
 *
 * ★ 양식 편집은 넓은 별도 페이지다(`/forms/[id]`) — 계약 목록 → 계약 폼과 같은 방식.
 *   돌아올 때 `?id=` 로 그 양식이 골라진 채로 연다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Icon, type IconName } from '@/components/ds';
import { ModalShell, cf } from '@/features/facility/ModalShell';
import codes from '@/features/codes/codes.module.css';
import { inputFieldsOf, isLegalForm } from '@swonbiz/shared/domain/form-template';
import {
  FormsError,
  duplicateTemplate,
  kindName,
  loadTemplate,
  loadTemplates,
  removeTemplate,
  type FormTemplate,
  type FormTemplateItem,
  type KindOption,
} from './forms-model';
import { FormDocument } from './FormDocument';
import { FormPrintPortal, printFormDocument } from './FormPrintPortal';
import styles from './forms.module.css';

const EMPTY_FILTER = { name: '', kind: '' };

/** 삭제가 막힌 이유 — 화면이 미리 잠근다. 판정은 서버(409)다. */
const deleteBlockReason = (t: FormTemplateItem): string | null =>
  t.linkCount > 0 ? `등기 설정 ${t.linkCount}건이 쓰는 중이라 지울 수 없습니다` : null;

export function FormsView({ initialId }: { initialId: string | null }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<FormTemplateItem[]>([]);
  const [kinds, setKinds] = useState<KindOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  /** 고른 양식 — 정의까지. ★ 옮기는 동안 이전 양식을 보이지 않게 `null` 로 비운다. */
  const [current, setCurrent] = useState<FormTemplate | null>(null);
  const [currentBusy, setCurrentBusy] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const [filterInput, setFilterInput] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [deleting, setDeleting] = useState<FormTemplateItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const r = await loadTemplates();
      setTemplates(r.templates);
      setKinds(r.kinds);
      setError(null);
    } catch (err) {
      setError(err instanceof FormsError ? err.message : '양식을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    setValues({});
    if (!selectedId) {
      setCurrent(null);
      return;
    }
    let alive = true;
    setCurrent(null);
    setCurrentBusy(true);
    loadTemplate(selectedId)
      .then((r) => {
        if (alive) setCurrent(r.template);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof FormsError ? err.message : '양식을 불러오지 못했습니다');
        /* 없는 양식(지워졌거나 주소가 틀렸다)을 붙들고 있지 않는다. */
        if (err instanceof FormsError && err.status === 404) setSelectedId(null);
      })
      .finally(() => {
        if (alive) setCurrentBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  /* 고른 양식을 주소에 남긴다 — 편집에서 돌아오거나 새로고침해도 그대로다. */
  useEffect(() => {
    const url = selectedId ? `/forms?id=${encodeURIComponent(selectedId)}` : '/forms';
    window.history.replaceState(null, '', url);
  }, [selectedId]);

  const shown = useMemo(
    () =>
      templates.filter((t) => {
        if (filter.name && !t.name.includes(filter.name)) return false;
        if (filter.kind && t.kind !== filter.kind) return false;
        return true;
      }),
    [templates, filter],
  );

  const fields = useMemo(() => (current ? inputFieldsOf(current.definition) : []), [current]);
  /** 법무 양식이면 [인쇄] 를 막는다 — 법무 서비스(s04)에서 뽑는다(결정 2026-10-09). */
  const legal = current ? isLegalForm(current.definition) : false;
  const labels = useMemo(() => Object.fromEntries(fields.map((f) => [f.name, f.label])), [fields]);

  const onDuplicate = async (t: FormTemplateItem) => {
    setBusyId(t.id);
    try {
      const r = await duplicateTemplate(t.id);
      await refreshList();
      setSelectedId(r.id);
    } catch (err) {
      setError(err instanceof FormsError ? err.message : '복사하지 못했습니다');
    } finally {
      setBusyId(null);
    }
  };

  const applySearch = () => setFilter({ name: filterInput.name.trim(), kind: filterInput.kind });

  return (
    <div className={codes.page}>
      <div className={codes.head}>
        <h1 className={codes.title}>표양식 관리</h1>
      </div>

      <div className={codes.body}>
        {/* ══════════ 좌측 · 양식 목록 ══════════ */}
        <aside className={codes.tree}>
          <div className={codes.treeHead}>
            <div className={codes.searchRow}>
              <input
                className={`${cf.input} ${codes.searchInput}`}
                value={filterInput.name}
                onChange={(e) => setFilterInput((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="양식 이름"
                aria-label="양식 이름"
              />
              {/* ★ 종류 이름은 코드 관리(LAW_DOC_TP)에서 온다 — 여기 박지 않는다. */}
              <select
                className={`${cf.input} ${codes.searchInput}`}
                value={filterInput.kind}
                onChange={(e) => setFilterInput((f) => ({ ...f, kind: e.target.value }))}
                aria-label="양식 종류"
              >
                <option value="">종류 전체</option>
                {kinds.map((k) => (
                  <option key={k.code} value={k.code}>
                    {k.name}
                  </option>
                ))}
              </select>
              <button type="button" className={`${codes.btnXs} ${codes.searchBtn}`} onClick={applySearch}>
                조회
              </button>
              <button
                type="button"
                className={`${codes.btnXs} ${codes.searchBtn}`}
                onClick={() => {
                  setFilterInput(EMPTY_FILTER);
                  setFilter(EMPTY_FILTER);
                }}
              >
                초기화
              </button>
            </div>
            <div className={codes.addRow}>
              <button
                type="button"
                className={`${codes.btnXs} ${codes.searchBtn}`}
                onClick={() => router.push('/forms/new')}
              >
                <Icon name="plus" size={12} />
                양식 추가
              </button>
            </div>
          </div>

          <div className={codes.treeBody}>
            {loading ? (
              <p className={codes.empty}>불러오는 중…</p>
            ) : shown.length === 0 ? (
              <p className={codes.empty}>{templates.length === 0 ? '양식이 없습니다' : '조회 결과가 없습니다'}</p>
            ) : (
              shown.map((t) => {
                const why = deleteBlockReason(t);
                return (
                  <div key={t.id} className={`${codes.node} ${selectedId === t.id ? codes.nodeOn : ''}`}>
                    <button type="button" className={codes.nodePick} onClick={() => setSelectedId(t.id)}>
                      <span className={codes.nodeLabel}>{t.name}</span>
                      <span className={codes.nodeKey}>{kindName(kinds, t.kind)}</span>
                    </button>
                    <span className={codes.nodeActions}>
                      <button
                        type="button"
                        className={codes.btnXs}
                        onClick={() => router.push(`/forms/${encodeURIComponent(t.id)}`)}
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        className={codes.btnXs}
                        disabled={busyId === t.id}
                        onClick={() => void onDuplicate(t)}
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        className={codes.btnXs}
                        disabled={why !== null}
                        title={why ?? undefined}
                        onClick={() => setDeleting(t)}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className={codes.treeFoot}>
            <span>양식 {templates.length}개</span>
            {shown.length !== templates.length ? (
              <span className={codes.panelFootSub}>조회 {shown.length}건</span>
            ) : null}
          </div>
        </aside>

        {/* ══════════ 우측 · 입력칸 · 미리보기 ══════════ */}
        <section className={codes.panel}>
          {error ? <p className={codes.error}>{error}</p> : null}

          {!selectedId ? (
            <PanelEmpty
              icon="file-text"
              lead="양식을 고르세요"
              sub="왼쪽에서 양식을 누르면 칸을 채워 인쇄할 수 있습니다"
            />
          ) : currentBusy || !current ? (
            <p className={codes.hint}>불러오는 중…</p>
          ) : (
            <>
              <div className={codes.panelHead}>
                <div>
                  <h2 className={codes.panelTitle}>{current.name}</h2>
                  <p className={styles.panelMeta}>
                    <span className={`${codes.tag} ${codes.tagOn}`}>{kindName(kinds, current.kind)}</span>
                    <span>{current.definition.pages.length}장</span>
                    <span>· 수정 {current.updatedOn}</span>
                    {current.linkCount > 0 ? (
                      <span className={`${codes.tag} ${codes.tagWarn}`}>등기 설정 {current.linkCount}건이 씀</span>
                    ) : null}
                    {legal ? (
                      <span className={`${codes.tag} ${codes.tagWarn}`}>법무 양식 — 법무 화면에서 출력</span>
                    ) : null}
                  </p>
                  {current.description ? <p className={codes.panelSub}>{current.description}</p> : null}
                </div>
                <div className={codes.actions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/forms/${encodeURIComponent(current.id)}`)}
                  >
                    <Icon name="pencil-line" size={16} />
                    양식 편집
                  </Button>
                  {/*
                    ★★ 법무 양식은 여기서 뽑지 않는다(결정 2026-10-09) — 회사가 직접 로그인해
                       법무 서비스(s04)에서 뽑는다. 이 화면은 운영사 전용이라 회사가 못 들어온다.
                       편집은 그대로 여기서 한다.
                  */}
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={legal}
                    title={legal ? '법무 양식은 법무 화면(법인변경)에서 출력합니다' : undefined}
                    onClick={printFormDocument}
                  >
                    <Icon name="printer" size={16} />
                    인쇄
                  </Button>
                </div>
              </div>

              <div className={styles.work}>
                <div className={styles.fields}>
                  <div className={styles.fieldsHead}>
                    <span>채울 칸 {fields.length}개</span>
                    {fields.length > 0 ? (
                      <button type="button" className={codes.btnXs} onClick={() => setValues({})}>
                        비우기
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.fieldsBody}>
                    {fields.length === 0 ? (
                      <p className={styles.note}>
                        채울 칸이 없습니다. 양식 편집에서 칸에 <b>{'{{이름}}'}</b> 같은 자리표시를 넣으면
                        여기서 채울 수 있습니다.
                      </p>
                    ) : (
                      fields.map((f) => (
                        <label key={f.name}>
                          <span className={styles.fieldLabel}>
                            {f.label}
                            {f.label !== f.name ? <span className={styles.fieldKey}>{f.name}</span> : null}
                          </span>
                          <input
                            className={cf.input}
                            value={values[f.name] ?? ''}
                            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                          />
                        </label>
                      ))
                    )}
                    {/*
                      ★ 자동 채움이 없다는 것을 화면에 적는다 — 회사명·직원명을 골라 넣는 기능을
                        찾아 헤매지 않게. 언제 붙는지는 `domain/form-template.ts` 머리말.
                    */}
                    <p className={styles.note}>
                      값은 손으로 넣습니다. 넣은 값은 저장되지 않습니다 — 인쇄할 때 한 번 쓰입니다.
                    </p>
                    <p className={styles.note}>
                      <span className={styles.tip}>인쇄 창에서 PDF로 저장할 수 있습니다.</span> 날짜·주소·쪽번호가
                      함께 찍히면 인쇄 대화상자에서 머리글·바닥글을 꺼 주세요.
                    </p>
                  </div>
                </div>

                <div className={styles.preview}>
                  <FormDocument definition={current.definition} values={values} labels={labels} showEmpty />
                </div>
              </div>

              {/* 종이에 나갈 문서 — body 밑에 숨어 있다가 [인쇄] 때만 나온다.
                  ★ 법무 양식이면 아예 깔지 않는다 — 브라우저 인쇄(Ctrl+P)로도 나가지 않게. */}
              {legal ? null : <FormPrintPortal definition={current.definition} values={values} />}
            </>
          )}
        </section>
      </div>

      {deleting ? (
        <DeleteDialog
          template={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            if (selectedId === deleting.id) setSelectedId(null);
            setDeleting(null);
            await refreshList();
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteDialog({
  template,
  onClose,
  onDeleted,
}: {
  template: FormTemplateItem;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      await removeTemplate(template.id);
      onDeleted();
    } catch (err) {
      if (err instanceof FormsError && err.inUse) setBlocked(err.message);
      else setError(err instanceof FormsError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="양식 삭제"
      desc={template.name}
      busy={busy}
      error={error}
      blocked={blocked}
      okLabel="삭제"
      okDanger
      okDisabled={blocked !== null}
      onClose={onClose}
      onOk={submit}
    >
      <p className={codes.formNote}>
        이 양식을 지웁니다. 되돌릴 수 없습니다 — 다시 쓰려면 처음부터 그려야 합니다. 이미 인쇄한 종이에는
        영향이 없습니다.
      </p>
    </ModalShell>
  );
}

function PanelEmpty({ icon, lead, sub }: { icon: IconName; lead: string; sub: string }) {
  return (
    <div className={codes.panelEmpty}>
      <span className={codes.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={codes.emptyLead}>{lead}</p>
      <p className={codes.emptySub}>{sub}</p>
    </div>
  );
}
