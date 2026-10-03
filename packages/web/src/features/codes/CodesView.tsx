'use client';

/**
 * 코드 관리(s030100030) 본문 — 좌측 분류코드 목록 + 우측 코드값 표.
 *
 * =============================================================================
 * ★★ 2026-10-03 개편 (사용자 지시) — 왼쪽에서 사용타입을 뺐다
 * =============================================================================
 * 처음에는 왼쪽이 **분류 ▸ 사용타입** 트리였고, 사용타입을 골라야 코드값이 나왔다.
 * 지금은:
 *   · 왼쪽은 **분류코드만** — 펼침이 없다
 *   · 오른쪽은 고른 분류의 **코드값 전부** — 사용타입이 표의 **첫 칸이자 검색 조건**이다
 *
 * ★★★ **「파티션」이라는 말을 화면에서 쓰지 않는다 — 「사용타입」이다.**
 *    코드·DB·분석 문서의 이름(`use_tp` · 파티션)은 그대로 둔다: 그쪽은
 *    `doc/CODE_MASTER_ANALYSIS.md` §B 가 정의한 개념 이름이고, 바꾸면 그 문서와
 *    마이그레이션 013 의 주석이 전부 어긋난다.
 *
 * ★ 왼쪽 규격은 **문의상담(s030200080)과 같다** — 420px · 검색 영역과 목록을 가르는
 *   아래 테두리 · 목록 독립 스크롤(`codes.module.css` 머리말에 가져온 숫자를 적어 뒀다).
 *
 * ★ [분류코드 추가] 는 **왼쪽 검색 영역 맨 위, 전체 폭**이다(사용자 결정). 분류코드는
 *   왼쪽의 일이라 페이지 우상단에서 옮겨 왔다.
 *
 * ★ 사용타입 **수정·삭제**는 표의 사용타입 글자를 눌러 연다(사용자 결정) — 센터 관리의
 *   호실명과 같은 방식이고, 삭제는 그 팝업 안에 있다. 그래서 파란 글씨에 밑줄이 선다.
 *
 * ★★★ 지우기·코드값 바꾸기는 **서버가 막는다.** 화면은 목록에 실려 온 `usage`·`pinnedBy`
 *    로 버튼을 미리 잠그지만 판정은 `routes/codes.ts` 다. **이름 바꾸기는 언제나 열려
 *    있다** — 그래야 「이름을 고치면 쓰는 화면에 바로 반영된다」가 성립한다.
 *
 * ★ 불러오는 중과 「없음」을 가른다 — 분류를 옮기는 동안 이전 분류의 코드값이 그대로
 *   보이면 **거짓을 보여 주는 것**이다(센터 관리에서 겪은 그대로).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Icon, type IconName } from '@/components/ds';
import { cf } from '@/features/facility/ModalShell';
import {
  CodesError,
  loadMasterLines,
  loadTree,
  lineBlockReason,
  lineUseTpLabel,
  masterBlockReason,
  usageText,
  type CodeLine,
  type CodeMaster,
  type CodePartition,
} from './codes-model';
import { MasterDialog } from './MasterDialog';
import { PartitionDialog } from './PartitionDialog';
import { LineDialog } from './LineDialog';
import { DeleteCodeDialog, type DeleteTarget } from './DeleteCodeDialog';
import styles from './codes.module.css';

type Dialog =
  | { kind: 'master'; master: CodeMaster | null }
  | { kind: 'partition'; category: string; partition: CodePartition | null }
  | { kind: 'line'; category: string; line: CodeLine | null }
  | { kind: 'delete'; target: DeleteTarget };

/** 오른쪽 검색 조건. */
const EMPTY_FILTER = { useTp: '', code: '', name: '' };

export function CodesView() {
  const [masters, setMasters] = useState<CodeMaster[]>([]);
  const [partitions, setPartitions] = useState<CodePartition[]>([]);
  const [lines, setLines] = useState<CodeLine[]>([]);
  /** 고른 분류코드. `null` 이면 오른쪽은 빈 상태다. */
  const [category, setCategory] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** ★ 코드값 표만 따로 「불러오는 중」을 둔다 — 왼쪽 목록은 그대로 있어야 한다. */
  const [linesBusy, setLinesBusy] = useState(false);

  /* 왼쪽 검색 — ★ [조회] 를 눌러야 적용된다(레거시와 같다). */
  const [inputKey, setInputKey] = useState('');
  const [inputName, setInputName] = useState('');
  const [appliedKey, setAppliedKey] = useState('');
  const [appliedName, setAppliedName] = useState('');

  /* 오른쪽 검색 — 사용타입 · 코드값 · 코드값 이름. */
  const [filterInput, setFilterInput] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState(EMPTY_FILTER);

  const refreshTree = useCallback(async () => {
    try {
      const t = await loadTree();
      setMasters(t.masters);
      setError(null);
    } catch (err) {
      setError(err instanceof CodesError ? err.message : '분류코드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLines = useCallback(async (cat: string | null) => {
    if (!cat) {
      setLines([]);
      setPartitions([]);
      return;
    }
    setLinesBusy(true);
    try {
      const page = await loadMasterLines(cat);
      setLines(page.lines);
      setPartitions(page.partitions);
      setError(null);
    } catch (err) {
      setLines([]);
      setPartitions([]);
      setError(err instanceof CodesError ? err.message : '코드값을 불러오지 못했습니다');
    } finally {
      setLinesBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    void refreshLines(category);
    /* 분류를 옮기면 오른쪽 검색 조건을 비운다 — 이전 분류의 사용타입이 남으면 0건이 된다. */
    setFilterInput(EMPTY_FILTER);
    setFilter(EMPTY_FILTER);
  }, [category, refreshLines]);

  /** 쓰고 나면 왼쪽과 오른쪽을 함께 새로 받는다 — 건수가 바뀐다. */
  const afterWrite = async () => {
    setDialog(null);
    await refreshTree();
    await refreshLines(category);
  };

  const masterOf = (cat: string) => masters.find((m) => m.category === cat) ?? null;
  const partitionOf = (useTp: string) => partitions.find((p) => p.useTp === useTp) ?? null;

  /** 왼쪽 — 조회 조건이 걸린 분류코드들. 키는 대소문자 무시, 이름은 그대로. */
  const shownMasters = useMemo(
    () =>
      masters.filter((m) => {
        if (appliedKey && !m.category.toLowerCase().includes(appliedKey.toLowerCase())) return false;
        if (appliedName && !m.name.includes(appliedName)) return false;
        return true;
      }),
    [masters, appliedKey, appliedName],
  );

  /** 오른쪽 — 조회 조건이 걸린 코드값들. */
  const shownLines = useMemo(
    () =>
      lines.filter((l) => {
        if (filter.useTp && l.useTp !== filter.useTp) return false;
        if (filter.code && !l.code.toLowerCase().includes(filter.code.toLowerCase())) return false;
        if (filter.name && !l.name.includes(filter.name)) return false;
        return true;
      }),
    [lines, filter],
  );

  const master = category ? masterOf(category) : null;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>코드 관리</h1>
      </div>

      <div className={styles.body}>
        {/* ══════════ 좌측 · 분류코드 목록 ══════════ */}
        <aside className={styles.tree}>
          <div className={styles.treeHead}>
            {/* ★★ 넷이 한 줄이다 — 입력 둘이 남는 폭을 나눠 갖는다. */}
            <div className={styles.searchRow}>
              <input
                className={`${cf.input} ${styles.searchInput}`}
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setAppliedKey(inputKey.trim());
                    setAppliedName(inputName.trim());
                  }
                }}
                placeholder="분류코드"
                aria-label="분류코드"
              />
              <input
                className={`${cf.input} ${styles.searchInput}`}
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setAppliedKey(inputKey.trim());
                    setAppliedName(inputName.trim());
                  }
                }}
                placeholder="분류코드명"
                aria-label="분류코드명"
              />
              <button
                type="button"
                className={`${styles.btnXs} ${styles.searchBtn}`}
                onClick={() => {
                  setAppliedKey(inputKey.trim());
                  setAppliedName(inputName.trim());
                }}
              >
                조회
              </button>
              <button
                type="button"
                className={`${styles.btnXs} ${styles.searchBtn}`}
                onClick={() => {
                  setInputKey('');
                  setInputName('');
                  setAppliedKey('');
                  setAppliedName('');
                }}
              >
                초기화
              </button>
            </div>

            {/*
              ★ [분류코드 추가] 는 **검색어 줄 아래**이고 **[초기화] 와 같은 크기**다
                (사용자 지시 2026-10-03). 예전에는 검색 위 전체 폭이었다 — 전체 폭이면
                이 패널에서 제일 큰 것이 되어 목록보다 먼저 읽힌다.
            */}
            <div className={styles.addRow}>
              <button
                type="button"
                className={`${styles.btnXs} ${styles.searchBtn}`}
                onClick={() => setDialog({ kind: 'master', master: null })}
              >
                <Icon name="plus" size={12} />
                분류코드 추가
              </button>
            </div>
          </div>

          <div className={styles.treeBody}>
            {loading ? (
              <p className={styles.empty}>불러오는 중…</p>
            ) : shownMasters.length === 0 ? (
              <p className={styles.empty}>
                {masters.length === 0 ? '분류코드가 없습니다' : '조회 결과가 없습니다'}
              </p>
            ) : (
              /*
               * ★★ 분류코드와 이름만 — 사용타입은 보이지 않는다(사용자 지시).
               * ★★ 행 끝에 [수정]·[삭제] 가 있다(사용자 지시 2026-10-03). 그래서 행
               *    전체를 `<button>` 으로 둘 수 없다 — **버튼 안에 버튼을 넣을 수 없다.**
               *    고르는 것은 이름 쪽 버튼이 맡고, 행은 `<div>` 다(센터 관리의 호실 표가
               *    같은 이유로 같은 모양이다).
               */
              shownMasters.map((m) => {
                const why = masterBlockReason(m);
                return (
                  <div
                    key={m.category}
                    className={`${styles.node} ${category === m.category ? styles.nodeOn : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.nodePick}
                      onClick={() => setCategory(m.category)}
                    >
                      <span className={styles.nodeKey}>{m.category}</span>
                      <span className={styles.nodeLabel}>{m.name}</span>
                      <span className={styles.nodeCount}>{m.lineCount}</span>
                    </button>
                    <span className={styles.nodeActions}>
                      <button
                        type="button"
                        className={styles.btnXs}
                        onClick={() => setDialog({ kind: 'master', master: m })}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className={styles.btnXs}
                        disabled={why !== null}
                        title={why ?? undefined}
                        onClick={() => setDialog({ kind: 'delete', target: { kind: 'master', master: m } })}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/*
            ★ 목록 아래 띠 — **이 목록의 건수만** 둔다.
            ★★ 2026-10-03 (사용자 지시) — 「사용타입 N개 · 코드값 N개」를 여기서 빼고
               **오른쪽 목록 아래 띠**로 옮겼다. 그 수는 오른쪽에 열린 것의 수라, 세는
               대상이 있는 쪽에 붙어 있어야 읽힌다.
          */}
          <div className={styles.treeFoot}>
            <span>분류 {shownMasters.length}개</span>
          </div>
        </aside>

        {/* ══════════ 우측 · 코드값 ══════════ */}
        <section className={styles.panel}>
          {error ? <p className={styles.error}>{error}</p> : null}

          {master === null ? (
            <PanelEmpty
              icon="settings"
              lead="분류코드를 고르세요"
              sub="왼쪽에서 분류코드를 누르면 그 아래 코드값이 나옵니다"
            />
          ) : (
            <>
              <div className={styles.panelHead}>
                <div>
                  {/*
                    ★ 「회원구분(MEMBER_TYPE)」 한 덩이다(사용자 지시 2026-10-03).
                      예전에는 이름과 분류코드가 띄어져 있고 뒤에 「시스템」 딱지가 붙었다.
                  */}
                  <h2 className={styles.panelTitle}>
                    {master.name}({master.category})
                  </h2>
                  {master.description ? (
                    <p className={styles.panelSub}>{master.description}</p>
                  ) : null}
                </div>
                {/*
                  ★ 분류코드 수정·삭제는 **왼쪽 목록의 줄로 옮겼다**(사용자 지시 2026-10-03).
                    여기에는 더하는 것만 남는다 — 오른쪽은 고른 분류코드의 **속**을 다룬다.
                */}
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setDialog({ kind: 'partition', category: master.category, partition: null })}
                  >
                    <Icon name="plus" size={16} />
                    사용타입 추가
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setDialog({ kind: 'line', category: master.category, line: null })}
                  >
                    <Icon name="plus" size={16} />
                    코드값 추가
                  </Button>
                </div>
              </div>

              {/* 오른쪽 검색 — 사용타입 · 코드값 · 코드값 이름 */}
              <div className={styles.panelSearch}>
                <select
                  className={`${cf.input} ${styles.panelSearchSelect}`}
                  value={filterInput.useTp}
                  aria-label="사용타입"
                  onChange={(e) => setFilterInput((f) => ({ ...f, useTp: e.target.value }))}
                >
                  <option value="">사용타입 전체</option>
                  {partitions.map((p) => (
                    <option key={p.useTp} value={p.useTp}>
                      {p.name} ({p.useTp})
                    </option>
                  ))}
                </select>
                <input
                  className={`${cf.input} ${styles.panelSearchInput}`}
                  value={filterInput.code}
                  onChange={(e) => setFilterInput((f) => ({ ...f, code: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && setFilter(filterInput)}
                  placeholder="코드값"
                  aria-label="코드값"
                />
                <input
                  className={`${cf.input} ${styles.panelSearchInput}`}
                  value={filterInput.name}
                  onChange={(e) => setFilterInput((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && setFilter(filterInput)}
                  placeholder="코드값 이름"
                  aria-label="코드값 이름"
                />
                <button
                  type="button"
                  className={`${styles.btnXs} ${styles.searchBtn}`}
                  onClick={() => setFilter(filterInput)}
                >
                  조회
                </button>
                <button
                  type="button"
                  className={`${styles.btnXs} ${styles.searchBtn}`}
                  onClick={() => {
                    setFilterInput(EMPTY_FILTER);
                    setFilter(EMPTY_FILTER);
                  }}
                >
                  초기화
                </button>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>사용타입</th>
                      <th>코드값</th>
                      <th>코드값 이름</th>
                      <th className={styles.num}>순서</th>
                      <th className={styles.center}>사용여부</th>
                      <th className={styles.center}>동작</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* ★ 「불러오는 중」과 「없음」을 가른다 — 둘을 섞으면 거짓을 보여 준다. */}
                    {linesBusy ? (
                      <tr>
                        <td colSpan={6} className={styles.center}>
                          불러오는 중…
                        </td>
                      </tr>
                    ) : shownLines.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={styles.center}>
                          {lines.length === 0 ? '코드값이 없습니다' : '조회 결과가 없습니다'}
                        </td>
                      </tr>
                    ) : (
                      shownLines.map((l) => {
                        const why = lineBlockReason(l);
                        return (
                          <tr key={l.lineId} className={l.isActive ? undefined : styles.rowOff}>
                            <td>
                              {/*
                                ★ 누르면 **사용타입 수정** 팝업이 열린다(사용자 결정) —
                                  센터 관리의 호실명과 같은 방식이다. 삭제는 그 팝업 안에 있다.
                                  그래서 파란 글씨에 밑줄이 선다(누를 수 있게 보여야 한다).
                              */}
                              <button
                                type="button"
                                className={styles.useTpBtn}
                                onClick={() => {
                                  const p = partitionOf(l.useTp);
                                  if (p) setDialog({ kind: 'partition', category: master.category, partition: p });
                                }}
                              >
                                {lineUseTpLabel(l)}
                              </button>
                            </td>
                            <td className={styles.code}>{l.code}</td>
                            <td>
                              {/* ★ 「시스템」 딱지를 뺐다(사용자 지시 2026-10-03). */}
                              {l.name}
                              {l.pinnedBy ? (
                                <span className={`${styles.tag} ${styles.tagWarn}`} title={l.pinnedBy}>
                                  앱이 직접 씀
                                </span>
                              ) : l.usage.length > 0 ? (
                                <span className={`${styles.tag} ${styles.tagWarn}`}>
                                  {usageText(l.usage)}
                                </span>
                              ) : null}
                            </td>
                            <td className={styles.num}>{l.sortOrder}</td>
                            <td className={styles.center}>
                              <span
                                className={`${styles.tag} ${l.isActive ? styles.tagOn : styles.tagOff}`}
                              >
                                {l.isActive ? '사용' : '사용 안 함'}
                              </span>
                            </td>
                            <td>
                              <div className={styles.rowActions}>
                                {/* ★ 수정은 **언제나 열려 있다** — 이름은 늘 바꿀 수 있다. */}
                                <button
                                  type="button"
                                  className={styles.btnXs}
                                  onClick={() => setDialog({ kind: 'line', category: master.category, line: l })}
                                >
                                  수정
                                </button>
                                <button
                                  type="button"
                                  className={styles.btnXs}
                                  disabled={why !== null}
                                  title={why ?? undefined}
                                  onClick={() =>
                                    setDialog({
                                      kind: 'delete',
                                      target: {
                                        kind: 'line',
                                        line: l,
                                        category: master.category,
                                        useTp: l.useTp,
                                      },
                                    })
                                  }
                                >
                                  삭제
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/*
                ★ 코드값 목록 아래 띠 — **왼쪽에** 고른 분류코드의 속내용을 적는다
                  (사용자 지시 2026-10-03). 왼쪽 띠의 「분류 N개」와 같은 모양·같은 자리다.
                ★ 거른 수가 전체와 다르면 함께 적는다 — 「조회 3건」만 보이는데 띠가
                  「코드값 11개」라고 하면 어긋나 보인다.
              */}
              <div className={styles.panelFoot}>
                <span>
                  사용타입 {master.partitionCount}개 · 코드값 {master.lineCount}개
                </span>
                {!linesBusy && shownLines.length !== lines.length ? (
                  <span className={styles.panelFootSub}>조회 {shownLines.length}건</span>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ── 팝업 ───────────────────────────────────────────────────────── */}
      {dialog?.kind === 'master' ? (
        <MasterDialog master={dialog.master} onClose={() => setDialog(null)} onSaved={afterWrite} />
      ) : null}
      {dialog?.kind === 'partition' ? (
        <PartitionDialog
          category={dialog.category}
          partition={dialog.partition}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
        />
      ) : null}
      {dialog?.kind === 'line' ? (
        <LineDialog
          category={dialog.category}
          partitions={partitions}
          line={dialog.line}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteCodeDialog
          target={dialog.target}
          onClose={() => setDialog(null)}
          onDeleted={async () => {
            /* 분류코드를 지웠으면 선택을 비운다 — 없는 것을 보여 주지 않게. */
            if (dialog.target.kind === 'master') setCategory(null);
            await afterWrite();
          }}
        />
      ) : null}
    </div>
  );
}

// =============================================================================
// 우측 — 빈 상태
// =============================================================================

function PanelEmpty({ icon, lead, sub }: { icon: IconName; lead: string; sub: string }) {
  return (
    <div className={styles.panelEmpty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      <p className={styles.emptySub}>{sub}</p>
    </div>
  );
}
