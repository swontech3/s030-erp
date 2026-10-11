'use client';

/**
 * 양식 편집 페이지(`/forms/[id]` · `/forms/new`) — 레거시 `FormDesigner` 를 옮겼다.
 *
 * 머리(제목 · 저장 상태 · [목록으로] · [저장]) → 양식 정보(이름 · 종류 · 설명) → 법무 표시 한 줄 → 장 탭 · 도구 막대 →
 * 칸 편집기 + 칸 속성 패널.
 *
 * =============================================================================
 * 레거시와 달라진 것 — 되돌리기 전에 읽을 것
 * =============================================================================
 * · 「데이터 소스」 고르기와 「수기 변수」 막대를 **뺐다** — 값은 손으로만 채우고(결정
 *   2026-10-07) 입력칸은 양식 안의 자리표시 전부다. 그 대신 칸 속성 패널에
 *   「입력칸 넣기」·「입력칸 이름표」가 있다(`CellPanel`).
 *   레거시 정의의 `dataSource` 는 **그대로 남는다**(지우지 않는다 — `form-template.ts`).
 * · [미리보기]·[인쇄/PDF] 를 뺐다 — **문서를 뽑는 곳은 목록 화면 하나**다(결정 2026-10-07).
 *   ★ 법무 양식은 그 목록 화면에서도 뽑지 않는다 — 법무 서비스(s04)에서 뽑는다(결정 2026-10-09).
 *   편집기 칸 자체가 종이 모양 그대로다.
 * · 도구 막대의 [전체테두리]·[무테] 는 레거시에서 **아무 일도 안 했다** — version 1 의
 *   `bordered` 칸을 썼는데 렌더러는 version 2 의 `border` 만 본다. 지금은 `border` 를 쓴다.
 * · 여러 칸을 골라 속성을 바꿀 때 **병합에 덮인 자리는 건너뛴다.** 레거시는 덮인 자리에도
 *   칸을 만들어(보이지 않는 칸) 나중에 분할하면 엉뚱한 서식이 드러났다.
 * · 글자는 **왼쪽 위 칸 하나에만** 쓴다. 레거시는 여러 칸을 고른 채 글자를 치면 고른 칸
 *   전부에 같은 글자가 들어갔다.
 * · 나갈 때 확인은 `window.confirm` 대신 ERP 확인 창이다(`ModalShell`).
 * · 양식 정보 아래에 **법무 표시**가 있다(`LegalMarkPanel`, 2026-10-11) — 붙이면 법인변경 [서류 출력]에
 *   뜬다. 레거시 「데이터 소스」 대신 이것이 「법무 양식」의 정본이다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Icon } from '@/components/ds';
import { Field, ModalShell, cf } from '@/features/facility/ModalShell';
import codes from '@/features/codes/codes.module.css';
import {
  DEFAULT_FORM_KIND,
  createEmptyDefinition,
  createEmptyPage,
  inputFieldsOf,
  withFieldLabel,
  type Cell,
  type FormDefinition,
  type Page,
} from '@swonbiz/shared/domain/form-template';
import {
  addCol,
  addRow,
  cellAt,
  coveredPositions,
  mergeCells,
  removeCol,
  removeRow,
  setColCount,
  setColWidth,
  setRowCount,
  setRowHeight,
  splitCell,
  updateCell,
} from '@swonbiz/shared/domain/form-grid';
import {
  FormsError,
  createTemplate,
  loadTemplate,
  loadTemplates,
  saveTemplate,
  type KindOption,
  type LegalOptions,
} from './forms-model';
import { LegalMarkPanel, legalMarkProblem } from './LegalMarkPanel';
import { GridEditor, normSel, type Selection } from './GridEditor';
import { CellPanel } from './CellPanel';
import styles from './forms.module.css';

interface Info {
  name: string;
  kind: string;
  description: string;
}

/** 「저장하지 않은 변경」을 가르는 기준 — 저장된 상태를 글자로 굳혀 비교한다. */
const snapshotOf = (info: Info, def: FormDefinition) =>
  JSON.stringify({ name: info.name.trim(), kind: info.kind, description: info.description.trim(), def });

export function FormEditor({ id }: { id: string | null }) {
  const router = useRouter();
  const [kinds, setKinds] = useState<KindOption[]>([]);
  const [legalOptions, setLegalOptions] = useState<LegalOptions>({ changeTypes: [], companyTypes: [] });
  const [info, setInfo] = useState<Info>({ name: '', kind: DEFAULT_FORM_KIND, description: '' });
  const [definition, setDefinition] = useState<FormDefinition>(() => createEmptyDefinition());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activePage, setActivePage] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const baseline = useRef('');

  /* 처음 한 번 — 고칠 양식(또는 새 양식의 종류 선택지)을 받는다. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (id) {
          const r = await loadTemplate(id);
          if (!alive) return;
          const nextInfo = { name: r.template.name, kind: r.template.kind, description: r.template.description ?? '' };
          setKinds(r.kinds);
          setLegalOptions(r.legalOptions);
          setInfo(nextInfo);
          setDefinition(r.template.definition);
          baseline.current = snapshotOf(nextInfo, r.template.definition);
        } else {
          const r = await loadTemplates();
          if (!alive) return;
          setKinds(r.kinds);
          setLegalOptions(r.legalOptions);
          // ★ 기본 종류가 코드에서 꺼져 있으면 첫 종류로 — 없는 코드값으로 시작하지 않게.
          const kind = r.kinds.some((k) => k.code === DEFAULT_FORM_KIND) ? DEFAULT_FORM_KIND : (r.kinds[0]?.code ?? '');
          const nextInfo = { name: '', kind, description: '' };
          setInfo(nextInfo);
          baseline.current = snapshotOf(nextInfo, createEmptyDefinition());
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof FormsError ? err.message : '양식을 불러오지 못했습니다');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const dirty = !loading && snapshotOf(info, definition) !== baseline.current;
  const page: Page | undefined = definition.pages[activePage];
  const fields = useMemo(() => inputFieldsOf(definition), [definition]);
  const sel = selection ? normSel(selection) : null;
  const anchor = sel ? { row: sel.minR, col: sel.minC } : null;

  /* 무엇이든 고치면 「저장했습니다」를 내린다 — 남아 있으면 거짓이 된다. */
  useEffect(() => {
    if (dirty) setSavedNote(false);
  }, [dirty]);

  const applyToPage = (fn: (p: Page) => Page) =>
    setDefinition((d) => ({ ...d, pages: d.pages.map((p, i) => (i === activePage ? fn(p) : p)) }));

  /**
   * 고른 칸들에 속성을 준다.
   * ★ 글자는 **왼쪽 위 칸 하나**에만 쓴다. ★ 병합에 덮인 자리는 건너뛴다(머리말).
   */
  const onCell = (patch: Partial<Cell>) => {
    if (!sel) return;
    if ('text' in patch) {
      applyToPage((p) => updateCell(p, sel.minR, sel.minC, { text: patch.text }));
      return;
    }
    applyToPage((p) => {
      const covered = coveredPositions(p);
      let next = p;
      for (let r = sel.minR; r <= sel.maxR; r++) {
        for (let c = sel.minC; c <= sel.maxC; c++) {
          if (covered.has(`${r},${c}`)) continue;
          next = updateCell(next, r, c, patch);
        }
      }
      return next;
    });
  };

  const onInsertToken = (name: string) => {
    if (!anchor) return;
    applyToPage((p) =>
      updateCell(p, anchor.row, anchor.col, { text: `${cellAt(p, anchor.row, anchor.col)?.text ?? ''}{{${name}}}` }),
    );
  };

  const pickPage = (i: number) => {
    setActivePage(i);
    setSelection(null);
  };

  const onDeletePage = () => {
    if (definition.pages.length <= 1) return;
    setDefinition((d) => ({ ...d, pages: d.pages.filter((_, i) => i !== activePage) }));
    pickPage(Math.max(0, activePage - 1));
  };

  const listHref = id ? `/forms?id=${encodeURIComponent(id)}` : '/forms';

  async function onSave() {
    if (saving) return;
    // ★ 표시가 덜 골라졌으면 보내지 않는다 — 사유는 표시 칸 아래에 이미 보인다. 서버도 같은 규칙으로 거절한다.
    const problem = legalMarkProblem(definition.legal);
    if (problem) {
      setError(`법무 표시 — ${problem}`);
      return;
    }
    setError(null);
    setSaving(true);
    const input = { name: info.name, kind: info.kind, description: info.description, definition };
    try {
      if (id) {
        await saveTemplate(id, input);
        baseline.current = snapshotOf(info, definition);
        setSavedNote(true);
      } else {
        const r = await createTemplate(input);
        // ★ 기준을 먼저 맞춘다 — 주소를 바꾸는 동안 「저장하지 않은 변경」이 뜨지 않게.
        baseline.current = snapshotOf(info, definition);
        router.replace(`/forms/${encodeURIComponent(r.id)}`);
      }
    } catch (err) {
      setError(err instanceof FormsError ? err.message : '저장하지 못했습니다');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className={codes.hint}>불러오는 중…</p>;
  if (loadError) {
    return (
      <div className={styles.editPage}>
        <p className={codes.error}>{loadError}</p>
        <div>
          <Button size="sm" variant="ghost" onClick={() => router.push('/forms')}>
            목록으로
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editPage}>
      <div className={styles.editHead}>
        {/*
          ★ 저장 상태는 제목 **옆** 같은 줄이다(2026-10-11 — 제목 아래 줄을 없애 격자에 높이를 돌려줬다).
            자리는 늘 있다(비어 있어도) — 글자가 생기고 사라져도 아무것도 움직이지 않는다.
        */}
        <div className={styles.editTitleRow}>
          <h1 className={codes.title}>{id ? '양식 편집' : '양식 추가'}</h1>
          <span className={`${styles.editNote} ${dirty ? styles.editNoteDirty : ''}`} role="status">
            {dirty ? '저장하지 않은 변경이 있습니다' : savedNote ? '저장했습니다' : ''}
          </span>
        </div>
        <div className={codes.actions}>
          <Button size="sm" variant="ghost" onClick={() => (dirty ? setLeaving(true) : router.push(listHref))}>
            <Icon name="chevron-left" size={16} />
            목록으로
          </Button>
          <Button size="sm" variant="primary" disabled={saving || info.name.trim() === ''} onClick={() => void onSave()}>
            <Icon name="save" size={16} />
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>

      {error ? <p className={codes.error} style={{ marginTop: 12 }}>{error}</p> : null}

      <div className={styles.editInfo}>
        <Field label="양식 이름">
          <input
            className={cf.input}
            value={info.name}
            onChange={(e) => setInfo((v) => ({ ...v, name: e.target.value }))}
            placeholder="재직증명서"
            autoFocus={!id}
          />
        </Field>
        {/* ★ 종류 이름은 코드 관리(LAW_DOC_TP)에서 온다. 표·일반서류는 모양이 같다 — 분류용이다. */}
        <Field label="종류">
          <select
            className={cf.input}
            value={info.kind}
            onChange={(e) => setInfo((v) => ({ ...v, kind: e.target.value }))}
          >
            {kinds.some((k) => k.code === info.kind) ? null : <option value={info.kind}>{info.kind}</option>}
            {kinds.map((k) => (
              <option key={k.code} value={k.code}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="설명">
          <input
            className={cf.input}
            value={info.description}
            onChange={(e) => setInfo((v) => ({ ...v, description: e.target.value }))}
            placeholder="어디에 쓰는 양식인지"
          />
        </Field>
      </div>

      <LegalMarkPanel
        mark={definition.legal}
        options={legalOptions}
        onChange={(legal) =>
          setDefinition((d) => {
            const { legal: _old, ...rest } = d;
            return legal ? { ...rest, legal } : rest;
          })
        }
      />

      <div className={styles.editBody}>
        <div className={styles.toolbar}>
          {definition.pages.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`${codes.btnXs} ${styles.pageTab} ${i === activePage ? styles.pageTabOn : ''}`}
              onClick={() => pickPage(i)}
              title={`${i + 1}장`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            className={codes.btnXs}
            onClick={() => setDefinition((d) => ({ ...d, pages: [...d.pages, createEmptyPage()] }))}
            title="장 추가"
          >
            <Icon name="plus" size={12} />장
          </button>
          <button
            type="button"
            className={codes.btnXs}
            disabled={definition.pages.length <= 1}
            onClick={onDeletePage}
            title="이 장 삭제"
          >
            <Icon name="minus" size={12} />장
          </button>

          <span className={styles.toolSep} />
          <label className={styles.toolLabel}>
            행
            <input
              type="number"
              min={1}
              className={styles.toolNum}
              value={page?.rowHeights.length ?? 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) applyToPage((p) => setRowCount(p, n));
              }}
            />
          </label>
          <label className={styles.toolLabel}>
            열
            <input
              type="number"
              min={1}
              className={styles.toolNum}
              value={page?.colWidths.length ?? 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) applyToPage((p) => setColCount(p, n));
              }}
            />
          </label>

          <span className={styles.toolSep} />
          <button type="button" className={codes.btnXs} onClick={() => applyToPage((p) => addRow(p, sel ? sel.minR + 1 : p.rowHeights.length))}>
            행＋
          </button>
          <button type="button" className={codes.btnXs} onClick={() => applyToPage((p) => removeRow(p, sel ? sel.minR : p.rowHeights.length - 1))}>
            행－
          </button>
          <button type="button" className={codes.btnXs} onClick={() => applyToPage((p) => addCol(p, sel ? sel.minC + 1 : p.colWidths.length))}>
            열＋
          </button>
          <button type="button" className={codes.btnXs} onClick={() => applyToPage((p) => removeCol(p, sel ? sel.minC : p.colWidths.length - 1))}>
            열－
          </button>

          <span className={styles.toolSep} />
          <button
            type="button"
            className={codes.btnXs}
            disabled={!selection}
            onClick={() => selection && applyToPage((p) => mergeCells(p, selection.r0, selection.c0, selection.r1, selection.c1))}
          >
            병합
          </button>
          <button
            type="button"
            className={codes.btnXs}
            disabled={!sel}
            onClick={() => sel && applyToPage((p) => splitCell(p, sel.minR, sel.minC))}
          >
            분할
          </button>

          <span className={styles.toolSep} />
          <button type="button" className={codes.btnXs} disabled={!sel} onClick={() => onCell({ border: undefined })}>
            전체 테두리
          </button>
          <button
            type="button"
            className={codes.btnXs}
            disabled={!sel}
            onClick={() => onCell({ border: { top: false, right: false, bottom: false, left: false } })}
          >
            무테
          </button>

          <span className={styles.toolSep} />
          <button type="button" className={codes.btnXs} disabled={!sel} onClick={() => onCell({ bold: true })}>
            굵게
          </button>
          <button type="button" className={codes.btnXs} disabled={!sel} onClick={() => onCell({ bold: undefined })}>
            보통
          </button>
        </div>

        <div className={styles.editMain}>
          <div className={styles.canvas}>
            {page ? (
              <GridEditor
                page={page}
                fontFamily={definition.font.family}
                fontSize={definition.font.size}
                selection={selection}
                onSelectionChange={setSelection}
                onCellText={(r, c, text) => applyToPage((p) => updateCell(p, r, c, { text }))}
              />
            ) : null}
          </div>
          {page ? (
            <CellPanel
              page={page}
              sel={anchor}
              onCell={onCell}
              onColWidth={(cm) => anchor && applyToPage((p) => setColWidth(p, anchor.col, cm))}
              onRowHeight={(cm) => anchor && applyToPage((p) => setRowHeight(p, anchor.row, cm))}
              onMarginTop={(cm) => applyToPage((p) => ({ ...p, marginTop: cm }))}
              fields={fields}
              onInsertToken={onInsertToken}
              onLabel={(name, label) => setDefinition((d) => withFieldLabel(d, name, label))}
            />
          ) : null}
        </div>
      </div>

      {leaving ? (
        <ModalShell
          title="저장하지 않고 나갈까요?"
          desc={info.name || '새 양식'}
          busy={false}
          okLabel="나가기"
          okDanger
          onClose={() => setLeaving(false)}
          onOk={() => router.push(listHref)}
        >
          <p className={codes.formNote}>저장하지 않은 변경이 있습니다. 나가면 그 변경은 사라집니다.</p>
        </ModalShell>
      ) : null}
    </div>
  );
}
