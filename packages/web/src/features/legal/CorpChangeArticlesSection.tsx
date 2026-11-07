'use client';

/**
 * 법인변경 상세 「변경된 정관 조항」(2026-11-08, 설계 `doc/법무_정관_최종본_설계.md` §3-1 · §3-2) — 정관이 바뀌는 구분이고
 * 정관 최종본이 있거나(우리 시스템으로 설립한 회사) 설립 건으로 만들 수 있을 때만 보인다. 다른 곳 설립 회사는 보이지 않는다
 * (1단계 밖 — 지금처럼 [서류 출력]의 「변경된 정관은 따로 준비하세요」 안내만).
 *
 * ★ 서류작성중(P) — 지금 최종본 조항에 이 건의 입력(신규 상호 · 목적 · 새 본점)을 넣은 **자동 문구**를 그 자리에서 보인다
 *   (`planArticleChanges` — 서버의 작성완료와 같은 함수). 사람이 고치면 그 문구가 payload `articlesItems` 로 [저장] 에
 *   실린다. [자동 문구로] 는 고친 문구를 버린다. 고친 문구가 자동 문구와 같으면 싣지 않는다.
 * ★ 작성완료 뒤(E · C · X) — 작성완료 스냅샷의 바뀐 조항을 읽기만 한다.
 * ★ 역할마다 「변경 전」(지금 최종본 · 설립 건으로 만든 조항 — 읽기만) → 「변경 후」를 보이고, 바뀐 낱말은 양쪽에서 굵게
 *   (2026-11-08). 고칠 수 있을 때 글 칸은 굵게 할 수 없어, 글 칸 아래에 바뀐 부분을 굵게 한 읽기 칸을 하나 더 둔다.
 * ★ 바뀐 조항이 하나도 없으면(시·도가 같은 본점이전 등) 정관 변경이 아니다 — 「변경된 정관」은 출력되지 않는다(§3-2).
 */
import { useId } from 'react';
import {
  articleHeading,
  autoArticleBody,
  changedArticles,
  planArticleChanges,
  type ArticleChange,
  type ArticleChangeContext,
  type ArticleRole,
} from '@swonbiz/shared/domain/legal-articles';
import type { CorpChangeArticlesView } from '@swonbiz/shared/domain/corp-change-detail';
import { Icon } from '@/components/ds';
import styles from './corp-change-detail.module.css';

export type ArticleOverrides = Partial<Record<ArticleRole, string>>;

const NOT_CHANGED = '정관 변경이 아닙니다 — 조항 문구가 지금 정관과 같아 「변경된 정관」은 출력되지 않습니다.';

/**
 * 낱말 단위 비교(2026-11-08) — 공백으로 자른 낱말의 최장 공통 부분열(LCS)에 들지 않은 낱말을 「바뀜」으로 표시한다.
 * 공백 조각은 굵게 하지 않는다. 너무 길면(낱말 수 곱이 100만 넘음) 비교하지 않고 전부 바뀜으로 본다.
 */
export interface DiffPiece {
  text: string;
  changed: boolean;
}

const isSpace = (t: string) => /^\s+$/.test(t);

export function wordDiff(before: string, after: string): { before: DiffPiece[]; after: DiffPiece[] } {
  const a = before.split(/(\s+)/).filter((t) => t !== '');
  const b = after.split(/(\s+)/).filter((t) => t !== '');
  const aw = a.flatMap((t, i) => (isSpace(t) ? [] : [{ t, i }]));
  const bw = b.flatMap((t, i) => (isSpace(t) ? [] : [{ t, i }]));
  const keepA = new Set<number>();
  const keepB = new Set<number>();
  const n = aw.length;
  const m = bw.length;
  if (n * m <= 1_000_000) {
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = aw[i]!.t === bw[j]!.t ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (aw[i]!.t === bw[j]!.t) {
        keepA.add(aw[i]!.i);
        keepB.add(bw[j]!.i);
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
      else j++;
    }
  }
  const mark = (tokens: string[], keep: Set<number>): DiffPiece[] =>
    tokens.map((t, i) => ({ text: t, changed: !isSpace(t) && !keep.has(i) }));
  return { before: mark(a, keepA), after: mark(b, keepB) };
}

/** 비교 결과를 읽기 칸으로 — 바뀐 낱말은 굵게. */
function DiffText({ pieces, label }: { pieces: DiffPiece[]; label: string }) {
  return (
    <div
      className={styles.textarea}
      role="textbox"
      aria-readonly="true"
      aria-label={label}
      style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-alt)', cursor: 'default', minHeight: 38 }}
    >
      {pieces.map((p, i) => (p.changed ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </div>
  );
}

function RoleText({
  change,
  editable,
  overridden,
  error,
  onChange,
  onReset,
}: {
  change: ArticleChange;
  editable: boolean;
  overridden: boolean;
  error?: string;
  onChange: (text: string) => void;
  onReset: () => void;
}) {
  const id = useId();
  const same = change.after === change.before;
  const diff = wordDiff(change.before, change.after);
  const heading = articleHeading(change);
  return (
    <div className={`${styles.field} ${styles.spanAll}`}>
      <div className={styles.fieldHead}>
        <span style={{ fontWeight: 600 }}>
          {heading}
          <span className={styles.labelNote}> {same ? '(바뀌지 않음)' : overridden ? '(직접 고침)' : '(자동 문구)'}</span>
        </span>
        {editable && overridden ? (
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`} onClick={onReset}>
            자동 문구로
          </button>
        ) : null}
      </div>
      <span className={styles.labelNote}>변경 전</span>
      <DiffText pieces={diff.before} label={`${heading} 변경 전`} />
      {editable ? (
        <>
          <label htmlFor={id} className={styles.labelNote}>
            변경 후
          </label>
          <textarea
            id={id}
            className={`${styles.textarea}${error ? ` ${styles.inputInvalid}` : ''}`}
            rows={Math.min(12, Math.max(2, change.after.split('\n').length + 1))}
            value={change.after}
            onChange={(e) => onChange(e.target.value)}
          />
          {same ? null : (
            <>
              <span className={styles.labelNote}>변경 후 — 바뀐 부분</span>
              <DiffText pieces={diff.after} label={`${heading} 변경 후 바뀐 부분`} />
            </>
          )}
        </>
      ) : (
        <>
          <span className={styles.labelNote}>변경 후</span>
          <DiffText pieces={diff.after} label={`${heading} 변경 후`} />
        </>
      )}
      {error ? <span className={styles.fieldError}>{error}</span> : null}
    </div>
  );
}

export function CorpChangeArticlesSection({
  view,
  editable,
  ctx,
  overrides,
  errorFor,
  onChange,
}: {
  view: CorpChangeArticlesView;
  /** 서류작성중이고 바쁘지 않을 때. */
  editable: boolean;
  /** 지금 화면의 입력(저장 전 값 포함) — 미리 채움에 쓴다. */
  ctx: ArticleChangeContext;
  overrides: ArticleOverrides;
  errorFor: (role: ArticleRole) => string | undefined;
  onChange: (next: ArticleOverrides) => void;
}) {
  const base = view.base;
  if (!base) return null;

  // 작성완료 뒤 — 스냅샷의 바뀐 조항만 읽기로
  if (view.written !== null && !editable) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>변경된 정관 조항</h2>
        </div>
        <div className={styles.sectionRule} />
        {view.written.length === 0 ? (
          <span className={styles.hint}>{NOT_CHANGED}</span>
        ) : (
          <div className={styles.payloadGrid} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            {view.written.map((c) => (
              <RoleText key={c.role} change={c} editable={false} overridden={false} onChange={() => undefined} onReset={() => undefined} />
            ))}
          </div>
        )}
      </section>
    );
  }

  const plan = planArticleChanges(base.items, view.roles, { ...ctx, payload: { ...ctx.payload, articlesItems: overrides } });
  const nothing = changedArticles(plan.items).length === 0;
  const setRole = (role: ArticleRole, text: string | null) => {
    const next: ArticleOverrides = { ...overrides };
    const item = base.items.find((i) => i.role === role);
    const auto = item ? autoArticleBody(role, item.body, ctx).body : null;
    if (text === null || text.trim() === '' || text === auto) delete next[role];
    else next[role] = text;
    onChange(next);
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>변경된 정관 조항</h2>
      </div>
      <div className={styles.sectionRule} />
      <span className={styles.hint} style={{ display: 'block', marginBottom: 8 }}>
        지금 정관에서 이 건이 바꾸는 조항입니다. 입력한 값으로 자동으로 채워지며, 고칠 수 있습니다. [서류 출력]의 「변경된
        정관」에 이 문구가 들어갑니다.
      </span>
      {nothing ? (
        <div className={`${styles.banner} ${styles.bannerInfo}`} role="status" style={{ marginBottom: 12 }}>
          <Icon name="info" size={16} />
          <span>{NOT_CHANGED}</span>
        </div>
      ) : null}
      <div className={styles.payloadGrid} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {plan.items.map((c) => (
          <RoleText
            key={c.role}
            change={c}
            editable={editable}
            overridden={overrides[c.role] !== undefined}
            error={errorFor(c.role)}
            onChange={(t) => setRole(c.role, t)}
            onReset={() => setRole(c.role, null)}
          />
        ))}
      </div>
    </section>
  );
}
