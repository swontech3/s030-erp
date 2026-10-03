'use client';

/**
 * 코드 관리(s030100030) 본문 — 좌측 트리 + 우측 패널.
 *
 * ★ 구성: 분류 ▸ 파티션 트리와, 고른 노드에 따라 갈리는 우측 2종
 *   (분류를 고르면 **파티션 목록**, 파티션을 고르면 **코드값 표**).
 *
 * ★★ **시안이 없다.** 기능은 레거시 `/admin/codes` 를 전수 옮겼고, 모양은 센터 관리
 *    (s030100010)와 같게 맞췄다 — 사용자 지시 2026-10-03.
 *
 *    레거시에서 옮긴 것:  분류 검색(ID·이름) · 분류 추가 · 분류 수정 · 분류 삭제 ·
 *                        코드 추가 · 코드 수정 · 활성/비활성 토글 · 코드 삭제 ·
 *                        시스템 코드 잠금 · 운영자 전용
 *    레거시에 없던 것:    **파티션 CRUD**(3층이 됐으므로) · **쓰임 표시와 차단**
 *    옮기지 않은 것:      **2단 계층**(부모 코드 지정) — 근거 컬럼 `parent_line_id` 가
 *                        마이그레이션 014 에서 드롭됐다. 사용자 결정 2026-10-03.
 *
 * =============================================================================
 * ★★★ 트리는 파티션을 **언제나** 보여 준다
 * =============================================================================
 * `000` 단독 분류(26개 중 24개)도 「공통 (000)」을 한 단계 거쳐 들어간다.
 * `doc/CODE_MASTER_ANALYSIS.md` §F-5 는 「숨긴다 — 의미 없는 클릭이 는다」로 정해
 * 두었는데, **뒤집었다**(사용자 결정 2026-10-03). 이유:
 *   · 모양이 둘이면 운영자가 규칙을 못 읽는다 — 어떤 분류는 한 번, 어떤 분류는 두 번
 *   · 나중에 파티션이 하나 더 생기면 **그 분류만** 모양이 바뀐다
 * 그 문서에도 뒤집은 사실과 이유를 적어 두었다.
 *
 * =============================================================================
 * ★★★ 지우기·코드값 바꾸기는 **서버가 막는다**
 * =============================================================================
 * 화면은 목록에 실려 온 `usage`·`pinnedBy` 로 버튼을 미리 잠그지만, 그것은 편의일 뿐이고
 * 판정은 `routes/codes.ts` 다. **이름 바꾸기는 언제나 열려 있다** — 그래야 「이름을
 * 고치면 그 코드를 쓰는 화면에 바로 반영된다」가 성립한다.
 *
 * ★ 불러오는 중과 「없음」을 가른다 — 파티션을 옮기는 동안 이전 파티션의 코드가 그대로
 *   보이면 **거짓을 보여 주는 것**이다(센터 관리에서 겪은 그대로).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Icon, type IconName } from '@/components/ds';
import { cf } from '@/features/facility/ModalShell';
import {
  CodesError,
  loadLines,
  loadTree,
  lineBlockReason,
  masterBlockReason,
  partitionBlockReason,
  partitionLabel,
  usageText,
  type CodeLine,
  type CodeMaster,
  type CodePartition,
  type UsageRef,
} from './codes-model';
import { MasterDialog } from './MasterDialog';
import { PartitionDialog } from './PartitionDialog';
import { LineDialog } from './LineDialog';
import { DeleteCodeDialog, type DeleteTarget } from './DeleteCodeDialog';
import styles from './codes.module.css';

/** 고른 노드. */
type Node =
  | { kind: 'master'; category: string }
  | { kind: 'partition'; category: string; useTp: string };

type Dialog =
  | { kind: 'master'; master: CodeMaster | null }
  | { kind: 'partition'; category: string; partition: CodePartition | null }
  | { kind: 'line'; category: string; useTp: string; line: CodeLine | null }
  | { kind: 'delete'; target: DeleteTarget };

export function CodesView() {
  const [masters, setMasters] = useState<CodeMaster[]>([]);
  const [partitions, setPartitions] = useState<CodePartition[]>([]);
  const [lines, setLines] = useState<CodeLine[]>([]);
  const [usageRefs, setUsageRefs] = useState<UsageRef[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [node, setNode] = useState<Node | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** ★ 코드값 표만 따로 「불러오는 중」을 둔다 — 트리는 그대로 있어야 한다. */
  const [linesBusy, setLinesBusy] = useState(false);
  /** 레거시 조회칸 — 분류 키·이름 부분일치. ★ [조회] 를 눌러야 적용된다(레거시와 같다). */
  const [inputKey, setInputKey] = useState('');
  const [inputName, setInputName] = useState('');
  const [appliedKey, setAppliedKey] = useState('');
  const [appliedName, setAppliedName] = useState('');

  const refreshTree = useCallback(async () => {
    try {
      const t = await loadTree();
      setMasters(t.masters);
      setPartitions(t.partitions);
      setError(null);
    } catch (err) {
      setError(err instanceof CodesError ? err.message : '코드 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLines = useCallback(async (n: Node | null) => {
    if (!n || n.kind !== 'partition') {
      setLines([]);
      setUsageRefs([]);
      return;
    }
    setLinesBusy(true);
    try {
      const page = await loadLines(n.category, n.useTp);
      setLines(page.lines);
      setUsageRefs(page.usageRefs);
      setError(null);
    } catch (err) {
      setLines([]);
      setUsageRefs([]);
      setError(err instanceof CodesError ? err.message : '코드를 불러오지 못했습니다');
    } finally {
      setLinesBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    void refreshLines(node);
  }, [node, refreshLines]);

  /** 쓰고 나면 트리와 지금 보고 있는 표를 함께 새로 받는다 — 건수가 바뀐다. */
  const afterWrite = async () => {
    setDialog(null);
    await refreshTree();
    await refreshLines(node);
  };

  const toggle = (category: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const masterOf = (category: string) => masters.find((m) => m.category === category) ?? null;
  const partitionsOf = (category: string) => partitions.filter((p) => p.category === category);
  const partitionOf = (category: string, useTp: string) =>
    partitions.find((p) => p.category === category && p.useTp === useTp) ?? null;

  /** 조회 조건이 걸린 분류들. ★ 레거시와 같은 규칙 — 키는 대소문자 무시, 이름은 그대로. */
  const shown = useMemo(
    () =>
      masters.filter((m) => {
        if (appliedKey && !m.category.toLowerCase().includes(appliedKey.toLowerCase())) return false;
        if (appliedName && !m.name.includes(appliedName)) return false;
        return true;
      }),
    [masters, appliedKey, appliedName],
  );

  function search() {
    setAppliedKey(inputKey.trim());
    setAppliedName(inputName.trim());
  }

  function reset() {
    setInputKey('');
    setInputName('');
    setAppliedKey('');
    setAppliedName('');
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>코드 관리</h1>
        <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'master', master: null })}>
          <Icon name="plus" size={16} />
          분류 추가
        </Button>
      </div>

      <div className={styles.body}>
        {/* ── 좌측 트리 ──────────────────────────────────────────────── */}
        <aside className={styles.tree}>
          <div className={styles.treeHead}>
            <span className={styles.treeTitle}>
              <Icon name="settings" size={14} />
              분류 {masters.length}개
            </span>
          </div>

          {/* 레거시 `page.tsx` 의 조회 조건 바 — 분류가 26개라 그대로 쓸모가 있다. */}
          <div className={styles.search}>
            <div className={styles.grid2}>
              <input
                className={cf.input}
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="ROOM_TP"
                aria-label="분류 키"
              />
              <input
                className={cf.input}
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="계약타입"
                aria-label="분류 이름"
              />
              <button type="button" className={styles.btnXs} onClick={search}>
                <Icon name="search" size={12} />
                조회
              </button>
              <button type="button" className={styles.btnXs} onClick={reset}>
                초기화
              </button>
            </div>
          </div>

          <div className={styles.treeBody}>
            {loading ? (
              <p className={styles.empty}>불러오는 중…</p>
            ) : shown.length === 0 ? (
              <p className={styles.empty}>
                {masters.length === 0 ? '분류가 없습니다' : '조회 결과가 없습니다'}
              </p>
            ) : (
              shown.map((m) => {
                const open = expanded.has(m.category);
                const mine = partitionsOf(m.category);
                const on = node?.kind === 'master' && node.category === m.category;
                return (
                  <div key={m.category}>
                    <button
                      type="button"
                      className={`${styles.node} ${on ? styles.nodeOn : ''}`}
                      onClick={() => {
                        toggle(m.category);
                        setNode({ kind: 'master', category: m.category });
                      }}
                    >
                      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                      <span className={styles.nodeLabel}>{m.name}</span>
                      <span className={styles.nodeKey}>{m.category}</span>
                      <span className={styles.nodeCount}>{m.lineCount}</span>
                    </button>

                    {/* ★★ `000` 단독이어도 파티션을 보여 준다(머리말 ★★★). */}
                    {open ? (
                      <div className={styles.leafWrap}>
                        {mine.length === 0 ? (
                          <p className={styles.empty}>파티션이 없습니다</p>
                        ) : (
                          mine.map((p) => {
                            const pOn =
                              node?.kind === 'partition' &&
                              node.category === p.category &&
                              node.useTp === p.useTp;
                            return (
                              <button
                                key={p.useTp}
                                type="button"
                                className={`${styles.leaf} ${pOn ? styles.nodeOn : ''}`}
                                onClick={() =>
                                  setNode({ kind: 'partition', category: p.category, useTp: p.useTp })
                                }
                              >
                                <Icon name="file-text" size={12} />
                                <span className={styles.nodeLabel}>{p.name}</span>
                                <span className={styles.nodeKey}>{p.useTp}</span>
                                <span className={styles.nodeCount}>{p.lineCount}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ── 우측 패널 ──────────────────────────────────────────────── */}
        <section className={styles.panel}>
          {error ? <p className={styles.error}>{error}</p> : null}

          {node === null ? (
            <PanelEmpty
              icon="settings"
              lead="분류를 고르세요"
              sub="왼쪽에서 분류를 누르면 파티션이, 파티션을 누르면 코드값이 나옵니다"
            />
          ) : node.kind === 'master' ? (
            <MasterPanel
              master={masterOf(node.category)}
              partitions={partitionsOf(node.category)}
              onAddPartition={() => setDialog({ kind: 'partition', category: node.category, partition: null })}
              onEditMaster={(m) => setDialog({ kind: 'master', master: m })}
              onDeleteMaster={(m) => setDialog({ kind: 'delete', target: { kind: 'master', master: m } })}
              onOpenPartition={(p) => setNode({ kind: 'partition', category: p.category, useTp: p.useTp })}
              onEditPartition={(p) => setDialog({ kind: 'partition', category: p.category, partition: p })}
              onDeletePartition={(p) =>
                setDialog({ kind: 'delete', target: { kind: 'partition', partition: p } })
              }
            />
          ) : (
            <LinesPanel
              master={masterOf(node.category)}
              partition={partitionOf(node.category, node.useTp)}
              lines={lines}
              usageRefs={usageRefs}
              busy={linesBusy}
              onAdd={() => setDialog({ kind: 'line', category: node.category, useTp: node.useTp, line: null })}
              onEdit={(l) =>
                setDialog({ kind: 'line', category: node.category, useTp: node.useTp, line: l })
              }
              onDelete={(l) =>
                setDialog({
                  kind: 'delete',
                  target: { kind: 'line', line: l, category: node.category, useTp: node.useTp },
                })
              }
            />
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
          useTp={dialog.useTp}
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
            /* 지운 것이 지금 보고 있는 노드면 선택을 올린다 — 없는 것을 보여 주지 않게. */
            const t = dialog.target;
            if (t.kind === 'master') setNode(null);
            if (t.kind === 'partition') setNode({ kind: 'master', category: t.partition.category });
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

// =============================================================================
// 우측 — 분류를 골랐을 때: 파티션 목록
// =============================================================================

function MasterPanel({
  master,
  partitions,
  onAddPartition,
  onEditMaster,
  onDeleteMaster,
  onOpenPartition,
  onEditPartition,
  onDeletePartition,
}: {
  master: CodeMaster | null;
  partitions: CodePartition[];
  onAddPartition: () => void;
  onEditMaster: (m: CodeMaster) => void;
  onDeleteMaster: (m: CodeMaster) => void;
  onOpenPartition: (p: CodePartition) => void;
  onEditPartition: (p: CodePartition) => void;
  onDeletePartition: (p: CodePartition) => void;
}) {
  if (!master) return <p className={styles.hint}>불러오는 중…</p>;

  const blocked = masterBlockReason(master);

  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>
            {master.name} <span className={styles.nodeKey}>{master.category}</span>
            {master.isSystem ? <span className={`${styles.tag} ${styles.tagOff}`}>시스템</span> : null}
          </h2>
          <p className={styles.panelSub}>
            파티션 {master.partitionCount}개 · 코드 {master.lineCount}개
            {master.description ? ` · ${master.description}` : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={onAddPartition}>
            <Icon name="plus" size={16} />
            파티션 추가
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEditMaster(master)}>
            수정
          </Button>
          <Button size="sm" variant="ghost" disabled={blocked !== null} onClick={() => onDeleteMaster(master)}>
            삭제
          </Button>
        </div>
      </div>

      {/*
        ★ 파티션이 무엇인지 적어 둔다. 운영자가 「000 이 공통이고 001 이 그 위에 쌓인다」로
          읽으면 코드를 잘못 넣는다 — 실제로는 **각 파티션이 완결된 목록**이다.
      */}
      <p className={styles.usage}>
        <Icon name="info" size={14} />
        <span>
          파티션은 한 분류 안의 <span className={styles.usageWhat}>독립된 목록</span>입니다.
          `000`(공통)이 기본이고, `001` 은 `000` 을 물려받지 않습니다 — 쓰는 화면이 파티션을
          지정해 읽습니다.
        </span>
      </p>

      {blocked ? <p className={styles.blocked}>{blocked}</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>파티션</th>
              <th>이름</th>
              <th>설명</th>
              <th className={styles.num}>코드</th>
              <th className={styles.center}>조치</th>
            </tr>
          </thead>
          <tbody>
            {partitions.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.center}>
                  파티션이 없습니다
                </td>
              </tr>
            ) : (
              partitions.map((p) => {
                const why = partitionBlockReason(p);
                return (
                  <tr key={p.useTp}>
                    <td className={styles.code}>{p.useTp}</td>
                    <td>
                      <button type="button" className={styles.rowBtn} onClick={() => onOpenPartition(p)}>
                        {p.name}
                      </button>
                      {p.isSystem ? (
                        <span className={`${styles.tag} ${styles.tagOff}`}>시스템</span>
                      ) : null}
                    </td>
                    <td>{p.description ?? '—'}</td>
                    <td className={styles.num}>{p.lineCount}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button type="button" className={styles.btnXs} onClick={() => onEditPartition(p)}>
                          수정
                        </button>
                        <button
                          type="button"
                          className={styles.btnXs}
                          disabled={why !== null}
                          title={why ?? undefined}
                          onClick={() => onDeletePartition(p)}
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
    </>
  );
}

// =============================================================================
// 우측 — 파티션을 골랐을 때: 코드값 표
// =============================================================================

function LinesPanel({
  master,
  partition,
  lines,
  usageRefs,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: {
  master: CodeMaster | null;
  partition: CodePartition | null;
  lines: CodeLine[];
  usageRefs: UsageRef[];
  busy: boolean;
  onAdd: () => void;
  onEdit: (l: CodeLine) => void;
  onDelete: (l: CodeLine) => void;
}) {
  if (!partition) return <p className={styles.hint}>불러오는 중…</p>;

  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>
            {master?.name ?? partition.category} · {partitionLabel(partition)}
          </h2>
          <p className={styles.panelSub}>
            {partition.category}/{partition.useTp}
            {partition.description ? ` · ${partition.description}` : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={onAdd}>
            <Icon name="plus" size={16} />
            코드 추가
          </Button>
        </div>
      </div>

      {/*
        ★★★ 이 띠가 **선언표(`domain/code-usage.ts`)를 빠뜨렸을 때 사람이 알아차리는
            유일한 자리다.** 비어 있으면 경고색으로 그리고, 새 컬럼을 만들었으면 표에
            한 줄을 추가하라고 적는다. 자동으로는 잡을 수 없다 — 없는 줄을 없다고 알
            방법이 없기 때문이다.
      */}
      {usageRefs.length > 0 ? (
        <p className={styles.usage}>
          <Icon name="shield-check" size={14} />
          <span>
            이 파티션의 코드값은{' '}
            <span className={styles.usageWhat}>{usageRefs.map((r) => r.label).join(' · ')}</span> 에
            저장됩니다. 쓰는 중인 코드는 코드값·사용여부를 바꿀 수 없고 지울 수 없습니다 —
            이름은 언제나 바꿀 수 있습니다.
          </span>
        </p>
      ) : lines.some((l) => l.pinnedBy) ? (
        /*
         * ★★ 저장되는 자리는 없지만 **앱이 코드값을 상수로 쓴다**(`QU_ST` 처럼 상태를
         *    유도하는 분류가 그렇다). 보호되고 있으므로 경고가 아니다 — 경고로 그리면
         *    틀린 경고가 되고, 운영자가 경고를 무시하는 법을 배운다.
         */
        <p className={styles.usage}>
          <Icon name="shield-check" size={14} />
          <span>
            이 파티션의 코드값은 어디에도 저장되지 않지만{' '}
            <span className={styles.usageWhat}>앱이 코드값을 직접 씁니다.</span> 그 코드는 코드값·
            사용여부를 바꿀 수 없고 지울 수 없습니다 — 이름은 언제나 바꿀 수 있습니다.
          </span>
        </p>
      ) : (
        <p className={styles.usageWarn}>
          <Icon name="triangle-alert" size={14} />
          <span>
            이 파티션은 <span className={styles.usageWhat}>쓰임이 등록돼 있지 않습니다.</span> 코드값을
            저장하는 업무 컬럼을 새로 만들었다면{' '}
            <code>packages/shared/src/domain/code-usage.ts</code> 의 <code>CODE_USAGE</code> 에 한 줄을
            추가해 주세요. 등록하지 않으면 쓰고 있는 코드도 지워집니다.
          </span>
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>코드값</th>
              <th>이름</th>
              <th className={styles.num}>순서</th>
              <th className={styles.center}>사용</th>
              <th>쓰는 곳</th>
              <th className={styles.center}>조치</th>
            </tr>
          </thead>
          <tbody>
            {/* ★ 「불러오는 중」과 「없음」을 가른다 — 둘을 섞으면 거짓을 보여 준다. */}
            {busy ? (
              <tr>
                <td colSpan={6} className={styles.center}>
                  불러오는 중…
                </td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.center}>
                  코드가 없습니다
                </td>
              </tr>
            ) : (
              lines.map((l) => {
                const why = lineBlockReason(l);
                return (
                  <tr key={l.lineId} className={l.isActive ? undefined : styles.rowOff}>
                    <td className={styles.code}>{l.code}</td>
                    <td>
                      <button type="button" className={styles.rowBtn} onClick={() => onEdit(l)}>
                        {l.name}
                      </button>
                      {l.isSystem ? (
                        <span className={`${styles.tag} ${styles.tagOff}`}>시스템</span>
                      ) : null}
                    </td>
                    <td className={styles.num}>{l.sortOrder}</td>
                    <td className={styles.center}>
                      <span className={`${styles.tag} ${l.isActive ? styles.tagOn : styles.tagOff}`}>
                        {l.isActive ? '사용' : '사용 안 함'}
                      </span>
                    </td>
                    <td>
                      {l.pinnedBy ? (
                        <span className={`${styles.tag} ${styles.tagWarn}`} title={l.pinnedBy}>
                          앱이 직접 씀
                        </span>
                      ) : l.usage.length > 0 ? (
                        <span className={`${styles.tag} ${styles.tagWarn}`}>{usageText(l.usage)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {/* ★ 수정은 **언제나 열려 있다** — 이름은 늘 바꿀 수 있다. */}
                        <button type="button" className={styles.btnXs} onClick={() => onEdit(l)}>
                          수정
                        </button>
                        <button
                          type="button"
                          className={styles.btnXs}
                          disabled={why !== null}
                          title={why ?? undefined}
                          onClick={() => onDelete(l)}
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
    </>
  );
}
