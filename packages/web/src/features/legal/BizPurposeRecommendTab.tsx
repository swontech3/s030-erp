'use client';

/**
 * 「사업목적 고르기」 팝업의 「추천」 탭(AI 없음, 2026-10-22).
 *
 * 흐름: 사업 설명 → 업종 후보(업종 사전 047, 최대 20) → 고른 업종의 업태 · 종목 · KSIC ·
 *       「검토됨」 인허가(049)와 근거 조문(048, 번호 · 제목 · 항 · 호만) → 사업목적 문구(카탈로그 문구, 없으면 종목 이름) → 고르기.
 * 검색 규칙은 shared `rankBizCandidates`(서버가 돌린다).
 *
 * ★ 읽기만 한다. 바꿔 부르는 말은 코드 관리, 카탈로그는 030 화면에서 고친다(한 업무는 한 화면).
 * ★ 인허가는 「검토됨」만 오고, 「참고용」 안내는 **항상** 띄운다(결정 2026-10-22).
 * ★ 고른 문구는 팝업의 고른 목록(`checked`)에 같이 담긴다 — 넘기는 것은 문구 배열 그대로다.
 * ★ 팝업 틀의 바로 아래 자식으로 그린다(조각) — 목록이 상자 높이에 맞춰 줄고 스크롤되게(전체 탭과 같다).
 * ★ 새 스타일 없음 — 팝업 틀(`org-lookup.module.css`)과 팝업 파일(`biz-purpose-picker.module.css`)만 쓴다.
 * ★ [AI 추천](2026-10-27) — 누를 때만 부른다. AI 가 후보 안에서 고른 업종만 그 순서로 보이고 줄마다 「AI 이유」.
 *   고른 뒤 상세 · 인허가(「검토됨」만) · 문구(서버 문구)는 일반 추천과 같다. AI 가 안 되면 일반 추천 그대로 + 안내.
 */
import { useRef, useState } from 'react';
import type { BizMatchKind } from '@swonbiz/shared/domain/biz-purpose-recommend';
import {
  BizPurposeError,
  loadBizRecommend,
  loadBizRecommendAi,
  loadBizRecommendDetail,
  type BizRecommendCandidate,
  type BizRecommendDetail,
} from './biz-purposes-model';
import base from '@/components/org-lookup/org-lookup.module.css';
import styles from './biz-purpose-picker.module.css';

/** 고른 목록의 키 — 「전체」 탭(카탈로그 id)과 겹치지 않게 앞에 붙인다. */
export const recommendKey = (text: string) => `recommend:${text}`;

const KIND_LABEL: Record<Exclude<BizMatchKind, 'alias'>, string> = {
  item: '종목',
  ksic: 'KSIC',
  type: '업태',
};
const matchLabel = (m: BizRecommendCandidate['matchedBy'][number]) =>
  m.kind === 'alias' ? `「${m.word ?? ''}」` : KIND_LABEL[m.kind];

type Candidates =
  | { state: 'idle' }
  | { state: 'loading'; ai: boolean }
  | {
      state: 'ok';
      items: BizRecommendCandidate[];
      truncated: boolean;
      /** AI 가 고른 업종 → 이유(고른 순서). null 이면 일반 추천 */
      reasons: ReadonlyMap<string, string> | null;
      /** AI 가 안 됐을 때의 안내 */
      aiNotice: string | null;
    }
  | { state: 'error'; message: string };

type Detail =
  | { state: 'none' }
  | { state: 'loading'; bizCode: string }
  | { state: 'ok'; item: BizRecommendDetail }
  | { state: 'error'; bizCode: string; message: string };

const errMessage = (err: unknown, fallback: string) => (err instanceof BizPurposeError ? err.message : fallback);

interface Props {
  /** 이미 적힌 문구(앞뒤 공백 걷음) — 「추가됨」으로 막는다. */
  have: ReadonlySet<string>;
  checked: ReadonlyMap<string, string>;
  onToggle: (key: string, text: string) => void;
}

export function BizPurposeRecommendTab({ have, checked, onToggle }: Props) {
  const [query, setQuery] = useState('');
  const [cands, setCands] = useState<Candidates>({ state: 'idle' });
  const [detail, setDetail] = useState<Detail>({ state: 'none' });
  /** 늦게 온 응답이 새 결과를 덮지 않게 — 마지막 요청만 그린다. */
  const seq = useRef(0);
  const detailSeq = useRef(0);

  const search = async (q: string, ai = false) => {
    if (q.trim() === '') return;
    const mine = ++seq.current;
    detailSeq.current++;
    setCands({ state: 'loading', ai });
    setDetail({ state: 'none' });
    try {
      if (ai) {
        const r = await loadBizRecommendAi(q);
        if (mine === seq.current)
          setCands({
            state: 'ok',
            items: r.items,
            truncated: r.truncated,
            reasons: r.ai.ok ? new Map(r.ai.picks.map((p) => [p.bizCode, p.reason])) : null,
            aiNotice: r.ai.ok ? null : r.ai.message,
          });
        return;
      }
      const page = await loadBizRecommend(q);
      if (mine === seq.current)
        setCands({ state: 'ok', items: page.items, truncated: page.truncated, reasons: null, aiNotice: null });
    } catch (err) {
      if (mine === seq.current)
        setCands({
          state: 'error',
          message: errMessage(err, '업종 후보를 불러오지 못했습니다'),
        });
    }
  };

  const pick = async (bizCode: string) => {
    const mine = ++detailSeq.current;
    setDetail({ state: 'loading', bizCode });
    try {
      const item = await loadBizRecommendDetail(bizCode);
      if (mine === detailSeq.current) setDetail({ state: 'ok', item });
    } catch (err) {
      if (mine === detailSeq.current)
        setDetail({
          state: 'error',
          bizCode,
          message: errMessage(err, '업종을 불러오지 못했습니다'),
        });
    }
  };

  const picked = detail.state === 'none' ? null : detail.state === 'ok' ? detail.item.bizCode : detail.bizCode;
  const reasons = cands.state === 'ok' ? cands.reasons : null;
  /** AI 가 고른 업종만, 고른 순서로 — 아니면 일반 추천 그대로 */
  const rows =
    cands.state !== 'ok'
      ? []
      : reasons
        ? [...reasons.keys()].flatMap((code) => cands.items.filter((c) => c.bizCode === code))
        : cands.items;

  return (
    <>
      <form
        className={base.searchRow}
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input
          className={base.input}
          placeholder="사업 설명  예) 온라인 쇼핑몰에서 옷을 판다"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          className={`${base.btn} ${base.btnGhost} ${base.btnSearch}`}
          disabled={query.trim() === ''}
        >
          검색
        </button>
        <button
          type="button"
          className={`${base.btn} ${base.btnGhost} ${base.btnSearch}`}
          disabled={query.trim() === '' || cands.state === 'loading'}
          onClick={() => void search(query, true)}
        >
          AI 추천
        </button>
      </form>

      <div className={base.list}>
        {cands.state === 'idle' ? (
          <p className={base.note}>하는 사업을 적고 검색하세요. 업종 후보가 나옵니다.</p>
        ) : cands.state === 'loading' ? (
          <p className={base.note}>{cands.ai ? 'AI 가 고르는 중…' : '찾는 중…'}</p>
        ) : cands.state === 'error' ? (
          <p className={base.error} role="alert">
            {cands.message}
          </p>
        ) : cands.items.length === 0 ? (
          <>
            {cands.aiNotice ? <p className={base.note}>{cands.aiNotice}</p> : null}
            <p className={base.note}>맞는 업종이 없습니다. 다른 말로 적어 보세요.</p>
          </>
        ) : (
          <>
            {cands.aiNotice ? (
              <p className={base.note} role="status">
                {cands.aiNotice}
              </p>
            ) : reasons ? (
              <p className={base.note}>AI 가 업종 후보 안에서 고른 것입니다 — 전체 후보는 [검색]으로 봅니다.</p>
            ) : null}
            <table className={base.table}>
              <thead>
                <tr>
                  <th className={styles.checkCell} aria-label="고르기" />
                  <th>업종코드</th>
                  <th>업태 · 종목</th>
                  <th>맞은 것</th>
                  {reasons ? <th>AI 이유</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.bizCode}
                    className={`${base.row}${picked === c.bizCode ? ` ${base.rowOn}` : ''}`}
                    onClick={() => void pick(c.bizCode)}
                  >
                    <td className={styles.checkCell}>
                      <input
                        type="radio"
                        name="biz-recommend"
                        checked={picked === c.bizCode}
                        onChange={() => void pick(c.bizCode)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`${c.bizCode} ${c.itemName}`}
                      />
                    </td>
                    <td className={base.code}>{c.bizCode}</td>
                    <td>
                      {c.bizType} · {c.itemName}
                    </td>
                    <td>
                      <span className={`${base.badge} ${base.badgeOther}`}>
                        {c.matchedBy.map(matchLabel).join(' · ')}
                      </span>
                    </td>
                    {reasons ? <td>{reasons.get(c.bizCode)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {cands.truncated && !reasons ? (
              <p className={base.note}>앞의 {cands.items.length}개만 보입니다 — 설명을 더 자세히 적으세요</p>
            ) : null}
            <DetailView detail={detail} have={have} checked={checked} onToggle={onToggle} />
          </>
        )}
      </div>

      <p className={styles.count}>참고용 — 실제 인허가는 관할 기관에 확인하세요.</p>
    </>
  );
}

function DetailView({
  detail,
  have,
  checked,
  onToggle,
}: {
  detail: Detail;
  have: ReadonlySet<string>;
  checked: ReadonlyMap<string, string>;
  onToggle: (key: string, text: string) => void;
}) {
  if (detail.state === 'none')
    return <p className={base.note}>업종을 고르면 업태 · 종목 · 인허가와 사업목적 문구가 나옵니다.</p>;
  if (detail.state === 'loading') return <p className={base.note}>불러오는 중…</p>;
  if (detail.state === 'error') {
    return (
      <p className={base.error} role="alert">
        {detail.message}
      </p>
    );
  }
  const d = detail.item;
  const text = d.purpose.text;
  const key = recommendKey(text);
  const done = have.has(text.trim());
  return (
    <table className={base.table}>
      <thead>
        <tr>
          <th colSpan={2}>고른 업종 — {d.bizCode}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className={base.code}>업태</td>
          <td>{d.bizType}</td>
        </tr>
        <tr>
          <td className={base.code}>종목</td>
          <td>{d.itemName}</td>
        </tr>
        <tr>
          <td className={base.code}>KSIC</td>
          <td>{d.ksic.length === 0 ? '—' : d.ksic.map((k) => `${k.code} ${k.name}`).join(' · ')}</td>
        </tr>
        <tr>
          <td className={base.code}>인허가</td>
          <td>
            {d.licenses.length === 0
              ? '검토된 인허가 정보가 없습니다'
              : d.licenses.map((l, i) => (
                  <div key={i}>
                    <div>
                      {l.kind}
                      {l.name ? ` — ${l.name}` : ''}
                    </div>
                    {l.basis.map((b, j) => (
                      <div key={j}>
                        {b.lawName} {b.article}
                      </div>
                    ))}
                    {l.note ? <div>예외: {l.note}</div> : null}
                  </div>
                ))}
          </td>
        </tr>
        <tr
          className={done ? styles.rowDone : `${base.row}${checked.has(key) ? ` ${base.rowOn}` : ''}`}
          onClick={() => !done && onToggle(key, text)}
        >
          <td className={base.code}>사업목적</td>
          <td>
            {done ? null : (
              <input
                type="checkbox"
                checked={checked.has(key)}
                onChange={() => onToggle(key, text)}
                onClick={(e) => e.stopPropagation()}
                aria-label={text}
              />
            )}{' '}
            {text}{' '}
            <span className={`${base.badge} ${base.badgeOther}`}>
              {d.purpose.source === 'catalog' ? '카탈로그' : '종목 이름'}
            </span>{' '}
            {done ? <span className={styles.done}>추가됨</span> : null}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
