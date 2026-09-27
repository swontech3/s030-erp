'use client';

/**
 * s0300500070p1 문의하기 — 공개. 등록 완료까지 **한 화면 안에서** 바뀐다.
 *
 * 시안: prototypes/s0300500070.html (`data-screen="write"` · `"done"`)
 * 명세: design/handoff/inquiry-board/02-screens.md §3
 *
 * =============================================================================
 * ★★ 오류는 **누른 뒤에** 보여 준다
 * =============================================================================
 * 처음에는 아무 표시가 없다. [문의 등록]을 누르면 빈 칸이 전부 빨개지고 위에 배너가
 * 뜬다(「입력하지 않은 필수 항목이 3곳 있습니다」). 그 뒤로는 고치는 즉시 회색으로
 * 돌아오고 배너의 개수도 같이 준다 — 타이핑하는 동안 빨개지는 화면을 만들지 않는다.
 *
 * =============================================================================
 * ★★ 서버가 막으면 **입력값을 지우지 않는다**
 * =============================================================================
 * 하루 3건·1분 간격은 서버가 판정한다(429). 같은 자리에 배너를 띄우고 맨 위로
 * 올려 보낼 뿐, 적어 둔 내용은 그대로 둔다 — 다시 쓰라고 하면 그만 쓴다.
 *
 * ★ 판정은 `@swonbiz/shared/domain/inquiry` 하나다. 화면 검사는 친절이고 서버가 정본이다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BODY_MAX, validateInquiry, type InquiryField } from '@swonbiz/shared/domain/inquiry';
import { Icon } from '@/components/ds';
import styles from './inquiry.module.css';
import { TEL_HREF, TEL_LABEL, codeName, maskPhone, type InquiryCodes } from './inquiry-model';

type Limit = 'daily' | 'cooldown' | null;

export function InquiryForm() {
  const [codes, setCodes] = useState<InquiryCodes>({ types: [], statuses: [] });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [type, setType] = useState('');
  const [body, setBody] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  /** 한 번이라도 눌렀는가 — 누르기 전에는 오류를 그리지 않는다. */
  const [tried, setTried] = useState(false);
  const [limit, setLimit] = useState<Limit>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ maskedName: string; type: string } | null>(null);
  const top = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch('/api/inquiries/codes')
      .then((r) => (r.ok ? (r.json() as Promise<InquiryCodes>) : null))
      .then((b) => setCodes(b ?? { types: [], statuses: [] }))
      .catch(() => setCodes({ types: [], statuses: [] }));
  }, []);

  const typeCodes = useMemo(() => codes.types.map((t) => t.code), [codes]);
  const bad = useMemo(
    () =>
      validateInquiry({ name, phone, email, companyName, type, body, password, agreed }, typeCodes),
    [name, phone, email, companyName, type, body, password, agreed, typeCodes],
  );
  /** 누르기 전에는 빈 집합 — 화면이 조용하다. */
  const shown: InquiryField[] = tried ? bad : [];
  const has = (f: InquiryField) => shown.includes(f);
  const errCls = (f: InquiryField) => (has(f) ? ` ${styles.isErr}` : '');

  const submit = async () => {
    setTried(true);
    setLimit(null);
    if (bad.length) {
      window.scrollTo(0, 0);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, email, companyName, type, body, password, agreed }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        reason?: Limit;
        maskedName?: string;
        type?: string;
      };
      if (res.status === 429) {
        // ★ 입력값은 그대로 둔다 — 배너만 띄우고 맨 위로.
        setLimit(payload.reason === 'cooldown' ? 'cooldown' : 'daily');
        window.scrollTo(0, 0);
        return;
      }
      if (!res.ok) {
        setLimit(null);
        window.scrollTo(0, 0);
        return;
      }
      setDone({ maskedName: payload.maskedName ?? '', type: payload.type ?? type });
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  };

  /* ── 등록 완료 ── */
  if (done) {
    return (
      <div className={`${styles.card} ${styles.done}`} data-done="1">
        <span className={styles.icCircle} style={{ margin: '0 auto' }}>
          <Icon name="circle-check" size={28} />
        </span>
        <h2 className={styles.doneTitle}>문의를 등록했습니다</h2>
        <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.6 }}>
          영업일 1일 내 이메일 또는 전화로 답변드립니다.
        </p>
        {/* 목록에 어떻게 보이는지 미리 — 「내 이름이 다 보이나?」에 답한다 */}
        <div className={styles.donePreview}>
          <span className="k">목록 표시</span>
          <span className="v" data-done-label="1">
            {done.maskedName} · {codeName(codes.types, done.type)}
          </span>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          답변은 목록에서 글을 누르고 비밀번호를 입력하면 확인할 수 있습니다.
        </p>
        <Link
          className={`${styles.btn} ${styles.btnGhost} ${styles.btnXl} ${styles.btnBlock}`}
          href="/inquiry"
          style={{ marginTop: 24 }}
        >
          목록으로
        </Link>
      </div>
    );
  }

  /* ── 글쓰기 ── */
  return (
    <div ref={top}>
      <Link className={styles.back} href="/inquiry">
        <Icon name="chevron-left" size={16} />
        목록
      </Link>
      <h1 className={styles.h1} style={{ marginTop: 4 }}>
        문의하기
      </h1>
      <p className={styles.lede}>비밀글로 등록됩니다. 답변은 이메일 또는 전화로 드립니다.</p>

      {shown.length ? (
        <div className={styles.errBanner} data-err-banner="1">
          <Icon name="circle-alert" size={16} />
          <span>입력하지 않은 필수 항목이 {shown.length}곳 있습니다</span>
        </div>
      ) : null}

      {limit === 'daily' ? (
        <div className={`${styles.errBanner} ${styles.errBannerLimit}`} data-limit="daily">
          <Icon name="circle-alert" size={16} />
          <span>
            <b>오늘은 더 등록할 수 없습니다</b>
            <span>
              같은 연락처로 하루 3건까지 남기실 수 있습니다. 이미 남기신 글에 추가 질문으로 이어 쓰시거나{' '}
              <a className={styles.inlineTel} href={TEL_HREF}>
                {TEL_LABEL}
              </a>{' '}
              로 연락 주세요.
            </span>
          </span>
        </div>
      ) : null}

      {limit === 'cooldown' ? (
        <div className={`${styles.errBanner} ${styles.errBannerLimit}`} data-limit="cooldown">
          <Icon name="clock" size={16} />
          <span>
            <b>잠시 후 다시 등록해 주세요</b>
            <span>
              방금 문의를 등록하셨습니다. 1분 뒤에 다시 등록할 수 있습니다. 입력하신 내용은 그대로 남아
              있습니다.
            </span>
          </span>
        </div>
      ) : null}

      {/* ── 연락처 ── */}
      <div className={`${styles.card} ${styles.sec}`}>
        <h2 className={styles.secTitle}>연락처</h2>
        <div className={styles.secRule} />
        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.lab}>
              <span className={styles.reqDot} />
              이름
            </span>
            <input
              className={`${styles.input}${errCls('name')}`}
              data-f="name"
              autoComplete="name"
              placeholder="김도현"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {has('name') ? <span className={styles.err}>이름을 입력해 주세요</span> : null}
          </label>

          <label className={styles.field}>
            <span className={styles.lab}>
              <span className={styles.reqDot} />
              연락처
            </span>
            <input
              className={`${styles.input}${errCls('phone')}`}
              data-f="phone"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="010-0000-0000"
              style={{ fontVariantNumeric: 'tabular-nums' }}
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
            />
            {has('phone') ? <span className={styles.err}>연락처를 확인해 주세요</span> : null}
          </label>

          <label className={styles.field}>
            <span className={styles.lab}>
              <span className={styles.reqDot} />
              이메일
            </span>
            <input
              className={`${styles.input}${errCls('email')}`}
              data-f="email"
              type="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {has('email') ? <span className={styles.err}>이메일 형식을 확인해 주세요</span> : null}
          </label>

          <label className={styles.field}>
            <span className={styles.lab}>
              회사명 <span className={styles.labOpt}>(선택)</span>
            </span>
            <input
              className={styles.input}
              data-f="company"
              autoComplete="organization"
              placeholder="브릿지랩 주식회사"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* ── 문의 내용 ── */}
      <div className={`${styles.card} ${styles.sec}`}>
        <h2 className={styles.secTitle}>문의 내용</h2>
        <div className={styles.secRule} />
        <div className={styles.field}>
          <span className={styles.lab}>
            <span className={styles.reqDot} />
            문의 유형
          </span>
          {/* ★ 버튼 이름은 코드 마스터에서 온다 — 화면에 박지 않는다 */}
          <div className={`${styles.types}${has('type') ? ` ${styles.isErr}` : ''}`} data-types="1">
            {codes.types.map((t) => (
              <button
                key={t.code}
                type="button"
                aria-pressed={type === t.code}
                className={type === t.code ? styles.typeOn : undefined}
                data-type={t.code}
                onClick={() => setType(t.code)}
              >
                {t.name}
              </button>
            ))}
          </div>
          {has('type') ? <span className={styles.err}>문의 유형을 골라 주세요</span> : null}
        </div>

        <div className={styles.fields} style={{ marginTop: 18 }}>
          <label className={styles.field} style={{ gridColumn: '1/-1' }}>
            <span className={styles.lab}>
              <span className={styles.reqDot} />
              문의 내용
            </span>
            <textarea
              className={`${styles.textarea}${errCls('body')}`}
              data-f="body"
              maxLength={BODY_MAX}
              rows={6}
              placeholder="궁금한 점을 자유롭게 적어 주세요"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <span className={styles.countRow}>
              <span className={styles.countErr}>{has('body') ? '문의 내용을 입력해 주세요' : ''}</span>
              <span />
              <span className={styles.count} data-body-count="1">
                {body.length} / {BODY_MAX}
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* ── 비밀번호 ── */}
      <div className={`${styles.card} ${styles.sec}`}>
        <h2 className={styles.secTitle}>비밀번호</h2>
        <div className={styles.secRule} />
        <label className={styles.field} style={{ maxWidth: 360 }}>
          <span className={styles.lab}>
            <span className={styles.reqDot} />
            비밀번호
          </span>
          <input
            className={`${styles.input}${errCls('password')}`}
            data-f="pw"
            type="password"
            autoComplete="new-password"
            placeholder="4자 이상"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {/* 오류가 보일 때는 안내를 숨긴다 — 한 줄만 남긴다 */}
          {has('password') ? (
            <span className={styles.err}>4자 이상 입력해 주세요</span>
          ) : (
            <span className={styles.hint}>내 글과 답변을 확인하고 추가 질문을 남길 때 필요합니다</span>
          )}
        </label>
      </div>

      {/* ── 동의 ── */}
      <div className={`${styles.card} ${styles.sec}${has('agreed') ? ` ${styles.isErr}` : ''}`}>
        <div className={styles.privacy}>
          <span>
            <b>수집 항목</b> 이름, 연락처, 이메일, 회사명, 문의 내용
          </span>
          <span>
            <b>이용 목적</b> 문의 답변 및 입주 상담
          </span>
          <span>
            <b>보유 기간</b> 등록일로부터 6개월 보관 후 파기
          </span>
          <span className={styles.privacyShow}>
            <Icon name="eye" size={14} />
            이름 일부와 문의 유형이 목록에 표시됩니다 <span>(예: 김** · 입주문의)</span>
          </span>
        </div>
        <label className={styles.agree}>
          <input
            type="checkbox"
            data-f="agree"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            개인정보 수집·이용에 동의합니다 <b className={styles.agreeReq}>(필수)</b>
          </span>
        </label>
        {has('agreed') ? (
          <span className={styles.err} style={{ display: 'block' }}>
            동의해 주셔야 문의를 등록할 수 있습니다
          </span>
        ) : null}
      </div>

      <div className={styles.formFoot}>
        <Link className={`${styles.btn} ${styles.btnGhost} ${styles.btnXl}`} href="/inquiry">
          취소
        </Link>
        <button
          className={`${styles.btn} ${styles.btnPrimary} ${styles.btnXl} ${styles.grow}`}
          type="button"
          data-submit="1"
          disabled={busy}
          onClick={() => void submit()}
        >
          문의 등록
        </button>
      </div>
    </div>
  );
}
