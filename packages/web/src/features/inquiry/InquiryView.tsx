'use client';

/**
 * s0300500070p2 글 보기 — 비밀번호 확인 → 원글 + 스레드 + 추가 질문.
 *
 * 시안: prototypes/s0300500070.html (`data-screen="password"` · `"view"`)
 * 명세: design/handoff/inquiry-board/02-screens.md §4 · 03-thread.md
 *
 * =============================================================================
 * ★★★ 비밀번호를 맞히기 전에는 **아무것도 받아 오지 않는다**
 * =============================================================================
 * 이 화면은 처음에 글의 내용을 모른다. `unlock` 이 200 을 준 뒤에야 원글·스레드가
 * 생긴다 — 화면에서 가리는 것이 아니라 서버가 주지 않는다. 추가 질문도 같은 응답으로
 * 받은 **열람 토큰**을 함께 보내야 등록된다(03-thread.md §4).
 *
 * ★ 토큰은 화면 메모리에만 둔다. 새로고침하면 비밀번호를 다시 묻는다 — 공용 PC 에서
 *   창만 남기고 자리를 뜨는 경우를 생각하면 그 편이 맞다.
 * ★ 스레드는 **하나의 시간순 목록**이다. 고객 글과 운영자 글은 배경색으로만 구분한다.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BODY_MAX, validateFollowUp } from '@swonbiz/shared/domain/inquiry';
import { Icon } from '@/components/ds';
import styles from './inquiry.module.css';
import {
  TEL_HREF,
  TEL_LABEL,
  codeName,
  dotDate,
  dotDateTime,
  type InquiryCodes,
  type InquiryDetail,
  type ThreadMessage,
} from './inquiry-model';

interface Props {
  inquiryId: string;
}

interface Unlocked {
  token: string;
  inquiry: InquiryDetail;
  messages: ThreadMessage[];
}

export function InquiryView({ inquiryId }: Props) {
  const [codes, setCodes] = useState<InquiryCodes>({ types: [], statuses: [] });
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Unlocked | null>(null);
  const [status, setStatus] = useState('R');
  const [follow, setFollow] = useState('');
  const [followErr, setFollowErr] = useState(false);
  const [posting, setPosting] = useState(false);
  /** 비밀번호 화면에 보여 줄 「김** · 입주문의」 — 목록 한 줄과 같은 값이다. */
  const [head, setHead] = useState<{ maskedName: string; type: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const pwRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void fetch('/api/inquiries/codes')
      .then((r) => (r.ok ? (r.json() as Promise<InquiryCodes>) : null))
      .then((b) => setCodes(b ?? { types: [], statuses: [] }))
      .catch(() => setCodes({ types: [], statuses: [] }));
  }, []);

  useEffect(() => {
    void fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}`)
      .then(async (r) => {
        if (r.status === 404) {
          setMissing(true);
          return null;
        }
        return r.ok ? ((await r.json()) as { maskedName: string; type: string }) : null;
      })
      .then((b) => {
        if (b) setHead({ maskedName: b.maskedName, type: b.type });
      })
      .catch(() => setHead(null));
  }, [inquiryId]);

  const unlock = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 429) {
        setWrong('잠시 후 다시 시도해 주세요');
        return;
      }
      if (!res.ok) {
        setWrong('비밀번호가 맞지 않습니다');
        return;
      }
      const body = (await res.json()) as Unlocked;
      setOpen(body);
      setStatus(body.inquiry.status);
      setWrong(null);
      window.scrollTo(0, 0);
    } catch {
      setWrong('비밀번호가 맞지 않습니다');
    } finally {
      setBusy(false);
    }
  };

  const addFollow = async () => {
    if (!open) return;
    if (!validateFollowUp(follow)) {
      setFollowErr(true);
      return;
    }
    setPosting(true);
    try {
      const res = await fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-inquiry-token': open.token },
        body: JSON.stringify({ body: follow }),
      });
      if (res.status === 401) {
        /* ★ 토큰이 만료됐다 — 비밀번호 화면으로 돌아가되 **적던 내용은 버리지 않는다**
           (03-thread.md §4). 다시 확인하면 그대로 남아 있다. */
        setOpen(null);
        setPassword('');
        setWrong('비밀번호를 다시 확인해 주세요');
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { messages: ThreadMessage[]; status: string };
      setOpen({ ...open, messages: body.messages });
      setStatus(body.status);
      setFollow('');
      setFollowErr(false);
    } finally {
      setPosting(false);
    }
  };

  const badge = (code: string) => (
    <span className={`${styles.badge} ${code === 'R' ? styles.badgeWait : styles.badgeDone}`} data-badge="1">
      {codeName(codes.statuses, code)}
    </span>
  );

  /* ── 비밀번호 확인 ── */
  if (!open) {
    return (
      <>
        <Link className={styles.back} href="/inquiry">
          <Icon name="chevron-left" size={16} />
          목록
        </Link>
        <div className={`${styles.card} ${styles.gate}`} data-gate="1">
          <div className={styles.gateHead}>
            <span className={styles.icMuted}>
              <Icon name="lock" size={22} />
            </span>
            <h2 className={styles.gateTitle}>{missing ? '문의를 찾을 수 없습니다' : '비밀글입니다'}</h2>
            {/* ★ 「김** · 입주문의」 — 목록 한 줄과 같은 값이라 여기 보여 줘도 새는 것이 없다 */}
            <p className={styles.gateText} data-gate-label="1">
              {head ? `${head.maskedName} · ${codeName(codes.types, head.type)} · ` : ''}
              작성 시 입력한 비밀번호를 입력해 주세요
            </p>
          </div>
          <label className={styles.field} style={{ marginTop: 24 }}>
            <span className={styles.lab}>비밀번호</span>
            <input
              ref={pwRef}
              className={`${styles.input}${wrong ? ` ${styles.isErr}` : ''}`}
              data-f="pw"
              type="password"
              autoComplete="current-password"
              placeholder="비밀번호"
              style={{ height: 48 }}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setWrong(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void unlock();
              }}
            />
            {wrong ? (
              <span className={styles.err} data-pw-wrong="1">
                {wrong}
              </span>
            ) : null}
          </label>
          <button
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnXl} ${styles.btnBlock}`}
            type="button"
            data-pw-ok="1"
            style={{ marginTop: 16 }}
            disabled={busy}
            onClick={() => void unlock()}
          >
            확인
          </button>
        </div>
      </>
    );
  }

  /* ── 글 보기 ── */
  const { inquiry, messages } = open;
  const used = messages.some((m) => m.kind === 'customer');

  return (
    <>
      <Link className={styles.back} href="/inquiry">
        <Icon name="chevron-left" size={16} />
        목록
      </Link>

      <div className={styles.viewHead}>
        <h1 className={styles.viewTitle} data-view-title="1">
          {codeName(codes.types, inquiry.type)}
        </h1>
        {badge(status)}
        <span className={styles.viewDate}>{dotDate(inquiry.day)} 등록</span>
      </div>

      <div className={styles.card} style={{ marginTop: 20, padding: 20 }}>
        <div className={styles.info}>
          <div>
            <div className={styles.infoKey}>이름</div>
            <div className={styles.infoVal}>{inquiry.name}</div>
          </div>
          <div>
            <div className={styles.infoKey}>연락처</div>
            <div className={`${styles.infoVal} ${styles.tabular}`}>{inquiry.phone}</div>
          </div>
          <div>
            <div className={styles.infoKey}>이메일</div>
            <div className={styles.infoVal}>{inquiry.email}</div>
          </div>
          {/* ★ 회사명을 비워 냈으면 칸을 **빼고** 그린다 — 「-」로 자리를 남기지 않는다 */}
          {inquiry.companyName ? (
            <div>
              <div className={styles.infoKey}>회사명</div>
              <div className={styles.infoVal}>{inquiry.companyName}</div>
            </div>
          ) : null}
        </div>
        <div style={{ margin: '18px 0', height: 1, background: 'var(--border)' }} />
        <p className={styles.bodyText}>{inquiry.body}</p>
      </div>

      <h2 className={styles.secTitle} style={{ marginTop: 24 }}>
        답변
      </h2>

      <div data-thread="1">
        {messages.map((m) =>
          m.kind === 'phone' ? (
            <div key={m.messageId} className={`${styles.card} ${styles.msg} ${styles.msgPhone}`} data-msg="phone">
              <span className={styles.avBig}>
                <Icon name="phone" size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className={styles.msgLead}>전화로 답변드렸습니다</div>
                <div className={styles.msgSub}>
                  {dotDateTime(m.createdAt)} · 담당 {m.operatorName ?? ''}
                </div>
              </div>
            </div>
          ) : (
            <div
              key={m.messageId}
              className={`${styles.card} ${styles.msg}${m.kind === 'customer' ? ` ${styles.msgCustomer}` : ''}`}
              data-msg={m.kind}
            >
              <div className={styles.msgHead}>
                {m.kind === 'customer' ? (
                  <span className={`${styles.av} ${styles.avCu}`}>
                    <Icon name="user" size={16} />
                  </span>
                ) : (
                  <span className={`${styles.av} ${styles.avOp}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- 32px 아바타 */}
                    <img src="/brand/swonbiz-logo.png" alt="" />
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className={styles.who}>
                    {m.kind === 'customer' ? '추가 질문' : `SwonBiz ${m.operatorName ?? ''}`}
                  </div>
                  <div className={styles.when}>
                    <span>{dotDateTime(m.createdAt)}</span>
                    {/* 같은 날 고쳐도 붙인다 — 이미 읽은 내용이 바뀌었을 수 있다(03-thread §3) */}
                    {m.editedAt ? <span>· {dotDate(m.editedAt)} 수정됨</span> : null}
                  </div>
                </div>
              </div>
              <p className={styles.bodyText}>{m.body}</p>
            </div>
          ),
        )}

        {/* 마지막이 고객 글이거나 스레드가 비었으면 대기 카드 */}
        {status === 'R' ? (
          <div className={`${styles.card} ${styles.msg} ${styles.msgWait}`} data-msg="wait">
            <span className={styles.avBig}>
              <Icon name="clock" size={18} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className={styles.msgLead}>답변을 준비하고 있습니다</div>
              <div className={styles.msgWaitText}>
                영업일 1일 내 담당자가 이곳에 답변하거나 전화드립니다. 별도 알림은 보내지 않으니 이
                글에서 확인해 주세요.
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {used ? (
        <div className={`${styles.card} ${styles.usedNote}`} data-compose-used="1">
          <Icon name="info" size={16} />
          <span>
            추가 질문은 한 번만 남길 수 있습니다. 더 궁금한 점은{' '}
            <a className={styles.inlineTel} href={TEL_HREF}>
              {TEL_LABEL}
            </a>{' '}
            로 연락 주시거나 새 문의를 남겨 주세요.
          </span>
        </div>
      ) : (
        <div className={styles.card} data-compose="1" style={{ marginTop: 24, padding: 20 }}>
          <label className={styles.field}>
            <span className={styles.lab}>추가 질문 남기기</span>
            <textarea
              className={`${styles.textarea}${followErr ? ` ${styles.isErr}` : ''}`}
              data-f="follow"
              maxLength={BODY_MAX}
              rows={4}
              placeholder="이어서 궁금한 점을 적어 주세요"
              style={{ marginTop: 8 }}
              value={follow}
              onChange={(e) => {
                setFollow(e.target.value);
                setFollowErr(false);
              }}
            />
            <span className={styles.countRow}>
              <span className={styles.countErr}>{followErr ? '내용을 입력해 주세요' : ''}</span>
              <span />
              <span className={styles.count} data-follow-count="1">
                {follow.length} / {BODY_MAX}
              </span>
            </span>
          </label>
          <div className={styles.composeFoot}>
            <span className={styles.composeNote}>
              추가 질문은 한 번만 남길 수 있고, 등록 후 수정·삭제할 수 없습니다.
            </span>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              data-follow-add="1"
              style={{ height: 48 }}
              disabled={posting}
              onClick={() => void addFollow()}
            >
              추가 질문 등록
            </button>
          </div>
        </div>
      )}

      <Link
        className={`${styles.btn} ${styles.btnGhost} ${styles.btnXl} ${styles.btnBlock}`}
        href="/inquiry"
        style={{ marginTop: 24 }}
      >
        목록으로
      </Link>
    </>
  );
}
