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
 *
 * =============================================================================
 * ★★ 2026-11-18 (통합 방 · 대표 결정) — 「주인」(삐용 · ERP)
 * =============================================================================
 * 코드 관리 화면이 하나다. 왼쪽 목록에 **ERP 표의 분류**와 **삐용 표의 종류**가 함께 나오고, 줄마다 주인 딱지가
 * 붙는다(주인 = 그 코드가 온 표). [주인] 고르기로 걸러 본다. 삐용 종류를 고르면 오른쪽은 `BbiyongPanel` —
 * 삐용 화면 API 로 보고 고친다. 삐용 종류에는 [수정] · [삭제] 가 없다(삐용 API 에 종류 고치기 · 지우기가 없다).
 * 삐용을 못 읽으면 ERP 코드는 그대로 보이고 그 사실만 적는다.
 *
 * ★ 2026-11-19: 화면 이름 「주인」 → 「업무구분」 · 선택지와 딱지 글자는 공통 코드 `CODE_BIZ_TP`(일회용 40)에서
 *   읽는다 · 삐용 줄도 ERP 줄과 같은 칸 · 같은 배치(딱지 폭 고정 · 끝의 [수정] · [삭제] 자리는 잠가 둔다).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Icon, Table, TableEmpty, TableHead, TableRow, tableCell, type IconName } from '@/components/ds';
import { ListNote } from '@/components/patterns/ListFrame';
import { LoadingBar } from '@/components/patterns/LoadingBar';
import { BTN_XS } from '@/features/billing/BillingTable';
import { cf } from '@/features/facility/ModalShell';
import {
  CodesError,
  codeTypeRows,
  loadBbiyongTypes,
  loadBizTpOptions,
  loadMasterLines,
  loadTree,
  lineBlockReason,
  lineUseTpLabel,
  masterBlockReason,
  usageText,
  type BbiyongCodeType,
  type BizTpOption,
  type CodeLine,
  type CodeMaster,
  type CodeOwner,
  type CodePartition,
} from './codes-model';
import { codeBizTpLabel } from '@swonbiz/shared/domain/code-biz-tp';
import { BbiyongPanel } from './BbiyongPanel';
import { MasterDialog } from './MasterDialog';
import { PartitionDialog } from './PartitionDialog';
import { LineDialog } from './LineDialog';
import { DeleteCodeDialog, type DeleteTarget } from './DeleteCodeDialog';
import styles from './codes.module.css';
import view from './codes-view.module.css';

type Dialog =
  | { kind: 'master'; master: CodeMaster | null }
  | { kind: 'partition'; category: string; partition: CodePartition | null }
  | { kind: 'line'; category: string; line: CodeLine | null }
  | { kind: 'delete'; target: DeleteTarget };

/** 삐용 종류 줄의 잠근 [수정] · [삭제] 안내 — 삐용 API 에 종류 고치기 · 지우기가 없다. */
const BBIYONG_TYPE_LOCKED = '삐용 종류는 여기서 고치거나 지울 수 없습니다 — 코드값은 오른쪽에서 고칩니다';

/** 오른쪽 검색 조건. */
const EMPTY_FILTER = { useTp: '', code: '', name: '' };

/*
 * ★ 2026-11-25 센터·기준관리 일관성 — 목록 두 개를 공통 표(Table)로. 칸 폭.
 *   왼쪽(분류 목록 · 종전 카드형 줄) : 업무구분 | 분류코드 | 분류코드명 | 건수 | [수정][삭제]
 *     업무구분 4.5em = 종전 딱지 폭(.bizTpTag) · 건수 3em · 단추 칸 100px = 30px 단추(BTN_XS) 「수정」「삭제」 + 사이 4.
 *     종전엔 분류코드 · 분류코드명이 한 줄 안에서 남는 폭을 나눴다 — 이제 두 칸이 반씩 갖는다.
 *   오른쪽(코드값 표 · 종전 <table> 자동 폭) : 사용타입 | 코드값 | 코드값 이름 | 순서 | 사용여부 | 동작
 *     순서 56 · 사용여부 96(「사용 안 함」 딱지) · 동작 112 = 30px 단추 「수정」「삭제」 + 사이 6.
 */
const NODE_COLS = '4.5em minmax(0, 1fr) minmax(0, 1fr) 3em 100px';
const LINE_COLS = 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr) 56px 96px 112px';

export function CodesView() {
  const [masters, setMasters] = useState<CodeMaster[]>([]);
  const [partitions, setPartitions] = useState<CodePartition[]>([]);
  const [lines, setLines] = useState<CodeLine[]>([]);
  /** 고른 분류코드(ERP 주인). `null` 이면 오른쪽은 빈 상태다. */
  const [category, setCategory] = useState<string | null>(null);
  /** 삐용 주인 종류(2026-11-18). 고른 것은 ERP 분류(`category`)와 둘 중 하나뿐이다. */
  const [bbiyongTypes, setBbiyongTypes] = useState<BbiyongCodeType[]>([]);
  const [bbiyongError, setBbiyongError] = useState<string | null>(null);
  const [bbiyongKey, setBbiyongKey] = useState<string | null>(null);
  /** 왼쪽 [업무구분] 걸러 보기 — 빈 값은 전체. 고르면 바로 걸린다. */
  const [owner, setOwner] = useState<'' | CodeOwner>('');
  /** 업무구분 선택지 · 딱지 글자 — ERP 공통 코드 `CODE_BIZ_TP`(2026-11-19). 못 읽으면 빈 목록. */
  const [bizTps, setBizTps] = useState<BizTpOption[]>([]);
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

  /** ★ 삐용 종류는 따로 받는다 — 삐용을 못 읽어도 ERP 코드는 보여야 한다. */
  const refreshBbiyong = useCallback(async () => {
    try {
      const b = await loadBbiyongTypes();
      setBbiyongTypes(b.types);
      setBbiyongError(null);
    } catch (err) {
      setBbiyongTypes([]);
      setBbiyongError(`삐용 코드를 불러오지 못했습니다 — ${err instanceof CodesError ? err.message : '연결 오류'}`);
    }
  }, []);

  const refreshTree = useCallback(async () => {
    try {
      const [t] = await Promise.all([loadTree(), refreshBbiyong()]);
      setMasters(t.masters);
      setError(null);
    } catch (err) {
      setError(err instanceof CodesError ? err.message : '분류코드를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [refreshBbiyong]);

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

  /* 업무구분은 한 번만 읽는다 — 못 읽어도 목록은 그대로 보인다(걸러 보기는 「전체」만). */
  useEffect(() => {
    let alive = true;
    loadBizTpOptions()
      .then((o) => {
        if (alive) setBizTps(o);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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

  /** 왼쪽 — ERP 분류 + 삐용 종류에 조회 조건 · 주인을 건 것. 키는 대소문자 무시, 이름은 그대로. */
  const allRows = useMemo(() => codeTypeRows(masters, bbiyongTypes), [masters, bbiyongTypes]);
  const shownRows = useMemo(
    () =>
      allRows.filter((r) => {
        if (owner && r.owner !== owner) return false;
        if (appliedKey && !r.code.toLowerCase().includes(appliedKey.toLowerCase())) return false;
        if (appliedName && !r.name.includes(appliedName)) return false;
        return true;
      }),
    [allRows, owner, appliedKey, appliedName],
  );
  const bbiyongType = useMemo(() => {
    for (const r of allRows) if (r.owner === 'bbiyong' && r.key === bbiyongKey) return r.type;
    return null;
  }, [allRows, bbiyongKey]);

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
      <div className={styles.head} data-page-title>
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
              {/* ★ 2026-11-25 일관성 — 삐용 검색 줄 : 오른쪽 끝 [초기화][조회](보통 단추) 다음 「n건」 */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInputKey('');
                  setInputName('');
                  setAppliedKey('');
                  setAppliedName('');
                }}
              >
                초기화
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAppliedKey(inputKey.trim());
                  setAppliedName(inputName.trim());
                }}
              >
                조회
              </Button>
              <ListNote>{loading ? '' : `${shownRows.length}건`}</ListNote>
            </div>

            {/*
              ★ [분류코드 추가] 는 **검색어 줄 아래**이고 **[초기화] 와 같은 크기**다
                (사용자 지시 2026-10-03). 예전에는 검색 위 전체 폭이었다 — 전체 폭이면
                이 패널에서 제일 큰 것이 되어 목록보다 먼저 읽힌다.
            */}
            <div className={view.addRow}>
              {/* ★ 2026-11-25 일관성 — 등록 = 보통 단추 · 표 위 왼쪽 */}
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<Icon name="plus" size={16} />}
                onClick={() => setDialog({ kind: 'master', master: null })}
              >
                분류코드 추가
              </Button>
              {/* ★ 업무구분 걸러 보기(2026-11-18 · 이름 2026-11-19) — 고르면 바로 걸린다. 선택지는 공통 코드 CODE_BIZ_TP. */}
              <select
                className={`${cf.input} ${view.ownerSelect}`}
                value={owner}
                aria-label="업무구분"
                onChange={(e) => setOwner(e.target.value as '' | CodeOwner)}
              >
                <option value="">업무구분 전체</option>
                {bizTps.map((o) => (
                  <option key={o.tp} value={o.tp}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.treeBody}>
            {bbiyongError ? <p className={styles.error}>{bbiyongError}</p> : null}
            {/*
              ★ 2026-11-25 일관성 — 카드형 줄 → 공통 표(Table). 보이던 것(딱지 · 분류코드 · 이름 · 건수 · [수정][삭제])을 칸으로 그대로.
              ★★ 분류코드와 이름만 — 사용타입은 보이지 않는다(사용자 지시).
              ★★ 줄을 누르면 고른다. 줄 끝 [수정] · [삭제] 는 고르기와 섞이지 않게 그 칸에서 누름을 멈춘다
                 (종전엔 이름 쪽 버튼만 고르기를 맡았다 — 누르는 자리는 같다).
            */}
            <Table cols={NODE_COLS}>
              <TableHead sticky className={view.nodeGrid}>
                <span>업무구분</span>
                <span>분류코드</span>
                <span>분류코드명</span>
                <span className={tableCell.right}>건수</span>
                <span className={tableCell.center}>동작</span>
              </TableHead>
              {loading ? (
                <TableEmpty>불러오는 중…</TableEmpty>
              ) : shownRows.length === 0 ? (
                <TableEmpty>{allRows.length === 0 ? '분류코드가 없습니다' : '조회 결과가 없습니다'}</TableEmpty>
              ) : (
                shownRows.map((r) => {
                  /* ★ 업무구분 딱지 — 폭을 맞춰 두 종류의 코드 · 이름이 같은 자리에서 시작한다(2026-11-19). */
                  const ownerTag = (
                    <span>
                      <span
                        className={`${styles.tag} ${styles.bizTpTag} ${r.owner === 'bbiyong' ? styles.tagOn : styles.tagOff}`}
                        title="업무구분"
                      >
                        {codeBizTpLabel(r.owner, bizTps)}
                      </span>
                    </span>
                  );
                  if (r.owner === 'bbiyong') {
                    /*
                     * ★ 삐용 종류 — 고르기만. 종류 수정 · 삭제는 삐용 API 에 없다.
                     * ★ ERP 줄과 같은 칸 · 같은 배치(2026-11-19) — 끝의 [수정] · [삭제] 자리를 두고 잠근다.
                     */
                    const on = bbiyongKey === r.key;
                    return (
                      <TableRow
                        key={r.key}
                        className={`${view.nodeGrid}${on ? ` ${styles.nodeOn}` : ''}`}
                        selected={on}
                        onClick={() => {
                          setCategory(null);
                          setBbiyongKey(r.key);
                        }}
                      >
                        {ownerTag}
                        <span className={`${styles.nodeKey} ${view.codeCell}`}>{r.code}</span>
                        <span className={styles.nodeLabel}>{r.name}</span>
                        <span className={`${styles.nodeCount} ${tableCell.right}`}>{r.count}</span>
                        <span className={view.nodeActions} role="presentation" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" style={BTN_XS} disabled title={BBIYONG_TYPE_LOCKED}>
                            수정
                          </Button>
                          <Button variant="danger" size="sm" style={BTN_XS} disabled title={BBIYONG_TYPE_LOCKED}>
                            삭제
                          </Button>
                        </span>
                      </TableRow>
                    );
                  }
                  const m = r.master;
                  const why = masterBlockReason(m);
                  const on = category === m.category;
                  return (
                    <TableRow
                      key={r.key}
                      className={`${view.nodeGrid}${on ? ` ${styles.nodeOn}` : ''}`}
                      selected={on}
                      onClick={() => {
                        setBbiyongKey(null);
                        setCategory(m.category);
                      }}
                    >
                      {ownerTag}
                      <span className={`${styles.nodeKey} ${view.codeCell}`}>{m.category}</span>
                      <span className={styles.nodeLabel}>{m.name}</span>
                      <span className={`${styles.nodeCount} ${tableCell.right}`}>{m.lineCount}</span>
                      <span className={view.nodeActions} role="presentation" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          style={BTN_XS}
                          onClick={() => setDialog({ kind: 'master', master: m })}
                        >
                          수정
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          style={BTN_XS}
                          disabled={why !== null}
                          title={why ?? undefined}
                          onClick={() => setDialog({ kind: 'delete', target: { kind: 'master', master: m } })}
                        >
                          삭제
                        </Button>
                      </span>
                    </TableRow>
                  );
                })
              )}
            </Table>
          </div>

          {/*
            ★ 목록 아래 띠 — **이 목록의 건수만** 둔다.
            ★★ 2026-10-03 (사용자 지시) — 「사용타입 N개 · 코드값 N개」를 여기서 빼고
               **오른쪽 목록 아래 띠**로 옮겼다. 그 수는 오른쪽에 열린 것의 수라, 세는
               대상이 있는 쪽에 붙어 있어야 읽힌다.
          */}
          {/* ★ 2026-11-25 대표 결정(정한 것 3) — 아래 띠 「분류 N개」를 뺐다. 건수는 검색 줄 오른쪽 끝 「n건」 하나 */}
        </aside>

        {/* ══════════ 우측 · 코드값 ══════════ */}
        <section className={styles.panel}>
          {/* ★ 코드값을 받아 오는 동안 칸 맨 위에 막대(공통 로딩바 · 2026-11-15). 표는 비워 둔다. */}
          {master !== null && linesBusy ? <LoadingBar /> : null}
          {error ? <p className={styles.error}>{error}</p> : null}

          {bbiyongType !== null ? (
            <BbiyongPanel type={bbiyongType} onChanged={() => void refreshBbiyong()} />
          ) : master === null ? (
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
                  {/* ★ 2026-11-25 일관성 — 구역 제목 = 왼쪽 4px 아쿠아 막대(글자에만) */}
                  <h2 className={`${styles.panelTitle} ${view.sectionTitle}`}>
                    {master.name}({master.category})
                  </h2>
                  {master.description ? (
                    <p className={styles.panelSub}>{master.description}</p>
                  ) : null}
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
                {/* ★ 2026-11-25 일관성 — 오른쪽 끝 [초기화][조회](보통 단추) 다음 「n건」 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterInput(EMPTY_FILTER);
                    setFilter(EMPTY_FILTER);
                  }}
                >
                  초기화
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setFilter(filterInput)}>
                  조회
                </Button>
                <ListNote>{linesBusy ? '' : `${shownLines.length}건`}</ListNote>
              </div>

              {/*
                ★ 2026-11-25 일관성 — 등록 = 보통 단추 · 표 위 왼쪽(종전 제목 줄 오른쪽 주 단추 둘).
                ★ 분류코드 수정·삭제는 **왼쪽 목록의 줄로 옮겼다**(사용자 지시 2026-10-03).
                  여기에는 더하는 것만 남는다 — 오른쪽은 고른 분류코드의 **속**을 다룬다.
              */}
              <div className={view.listBar}>
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={16} />}
                  onClick={() => setDialog({ kind: 'partition', category: master.category, partition: null })}
                >
                  사용타입 추가
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<Icon name="plus" size={16} />}
                  onClick={() => setDialog({ kind: 'line', category: master.category, line: null })}
                >
                  코드값 추가
                </Button>
              </div>

              <div className={styles.tableWrap}>
                {/* ★ 2026-11-25 일관성 — 공통 표(Table · 머리글 아쿠아). 칸 폭은 LINE_COLS */}
                <Table cols={LINE_COLS}>
                  <TableHead sticky className={view.lineGrid}>
                    <span>사용타입</span>
                    <span>코드값</span>
                    <span>코드값 이름</span>
                    <span className={tableCell.right}>순서</span>
                    <span className={tableCell.center}>사용여부</span>
                    <span className={tableCell.center}>동작</span>
                  </TableHead>
                  {/* ★ 「불러오는 중」과 「없음」을 가른다 — 둘을 섞으면 거짓을 보여 준다. */}
                  {linesBusy ? null : shownLines.length === 0 ? (
                    <TableEmpty>{lines.length === 0 ? '코드값이 없습니다' : '조회 결과가 없습니다'}</TableEmpty>
                  ) : (
                    shownLines.map((l) => {
                      const why = lineBlockReason(l);
                      return (
                        <TableRow key={l.lineId} className={`${view.lineGrid}${l.isActive ? '' : ` ${view.rowOff}`}`} muted={!l.isActive}>
                          <span>
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
                          </span>
                          <span className={styles.code}>{l.code}</span>
                          <span>
                            {/* ★ 「시스템」 딱지를 뺐다(사용자 지시 2026-10-03). */}
                            {l.name}
                            {l.pinnedBy ? (
                              <span className={`${styles.tag} ${styles.tagWarn}`} title={l.pinnedBy}>
                                앱이 직접 씀
                              </span>
                            ) : l.usage.length > 0 ? (
                              <span className={`${styles.tag} ${styles.tagWarn}`}>{usageText(l.usage)}</span>
                            ) : null}
                          </span>
                          <span className={`${styles.num} ${tableCell.right}`}>{l.sortOrder}</span>
                          <span className={tableCell.center}>
                            <span className={`${styles.tag} ${l.isActive ? styles.tagOn : styles.tagOff}`}>
                              {l.isActive ? '사용' : '사용 안 함'}
                            </span>
                          </span>
                          <span className={styles.rowActions}>
                            {/* ★ 수정은 **언제나 열려 있다** — 이름은 늘 바꿀 수 있다. */}
                            <Button
                              variant="ghost"
                              size="sm"
                              style={BTN_XS}
                              onClick={() => setDialog({ kind: 'line', category: master.category, line: l })}
                            >
                              수정
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              style={BTN_XS}
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
                            </Button>
                          </span>
                        </TableRow>
                      );
                    })
                  )}
                </Table>
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
                {/* ★ 2026-11-25 대표 결정(정한 것 3) — 「조회 n건」을 뺐다. 건수는 검색 줄 오른쪽 끝 「n건」 하나 */}
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
