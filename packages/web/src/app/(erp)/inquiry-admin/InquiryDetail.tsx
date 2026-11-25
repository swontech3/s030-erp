'use client';

/**
 * s030200080 상세 — 원글 + 스레드 + 답변 등록·수정 + 글 삭제.
 *
 * 명세: design/handoff/inquiry-board/03-thread.md (§1 스레드 · §3 수정 · §5 운영자)
 *
 * =============================================================================
 * ★★ 스레드는 **고객이 보는 것과 같은 모양**이다
 * =============================================================================
 * 하나의 시간순 목록이고, 고객 글과 운영자 글은 **배경색으로만** 구분한다(좌우 정렬을
 * 쓰지 않는다 — 긴 답변이 좁아진다). 운영자가 여기서 보는 순서·문구가 고객이 글 보기
 * 화면에서 보는 것과 같아야, 「무엇이 전달됐는가」를 이 화면에서 알 수 있다.
 *
 * ★ 다른 점 하나 — 고객 화면의 **대기 카드**(「답변을 준비하고 있습니다」)는 여기 없다.
 *   그 자리에 답변 입력이 있다. 운영자에게 「답변을 준비하고 있습니다」는 할 일이지
 *   안내가 아니다.
 *
 * ★★★ 개별 글 **삭제 버튼이 없다**(03-thread §5). 수정만 되고, 수정은 글답변(`text`)의
 *    본문뿐이다 — 전화 기록은 본문이 없고, 고객의 추가 질문은 운영자가 고치는 것이
 *    아니다. 삭제는 글 전체 하나뿐이고 그것은 헤더의 [삭제] 다(확인 창을 거친다).
 */
import { useState } from 'react';
import {
  BODY_MAX,
  MAX_OPERATOR_ANSWERS,
  OPERATOR_DISPLAY_NAME,
  operatorReplyBlock,
  type MessageKind,
} from '@swonbiz/shared/domain/inquiry';
import { inquiryRounds, retentionDeleteHint } from '@swonbiz/shared/domain/inquiry-admin-layout';
import { Button, Icon } from '@/components/ds';
import {
  codeName,
  dotDate,
  dotDateTime,
  type InquiryCodes,
  type ThreadMessage,
} from '@/features/inquiry/inquiry-model';
import styles from './inquiry-admin.module.css';
import type { AdminInquiry } from './inquiry-admin-model';

interface Props {
  inquiry: AdminInquiry;
  messages: ThreadMessage[];
  codes: InquiryCodes;
  busy: boolean;
  onReply: (kind: 'text' | 'phone', body: string) => Promise<boolean>;
  onEdit: (messageId: string, body: string) => Promise<boolean>;
  onAskDelete: () => void;
  /** [글 삭제] 를 그리는가 — 앱 안에서는 감춘다(PC 만 · 앱 1단계 5-나). 기본은 그린다 */
  showDelete?: boolean;
  /**
   * 문의-답변 묶음 모양(앱 안 · 3-마 덧붙임 3 · 대표 지시 2026-11-16) — shared `inquiryAdminLayout.detailRounds`.
   * 처리 기능(답변 · 전화로 답변함 · 답변 수정)은 같고 **배치만** 다르다. 기본은 지금 스레드(PC).
   */
  rounds?: boolean;
  /**
   * [전화로 답변함] · [답변 등록] 을 상세 맨 아래에 고정(묶음만 스크롤 · 3-마 덧붙임 4) — shared `fixedReplyActions`.
   * 묶음 모양(`rounds`)에서만 쓴다.
   */
  fixedActions?: boolean;
}

export function InquiryDetail({
  inquiry,
  messages,
  codes,
  busy,
  onReply,
  onEdit,
  onAskDelete,
  showDelete = true,
  rounds = false,
  fixedActions = false,
}: Props) {
  const [draft, setDraft] = useState('');
  const [draftErr, setDraftErr] = useState(false);
  /** 고치고 있는 답변. `null` 이면 아무것도 고치지 않는 중이다. */
  const [editing, setEditing] = useState<{ messageId: string; body: string } | null>(null);
  const [editErr, setEditErr] = useState(false);

  const statusName = codeName(codes.statuses, inquiry.status);
  const typeName = codeName(codes.types, inquiry.type);

  /**
   * 답변을 쓸 수 있는가 — **판정은 shared 하나다**(서버도 같은 함수로 409 를 낸다).
   *
   * ★ 쓸 수 없으면 입력칸을 **아예 그리지 않는다.** 잠긴 칸을 눌러 보게 하지 않는다.
   * ★ 안내도 두지 않는다(2026-09-28 결정) — 이 상태에서 할 수 있는 일은 [수정] 뿐이고
   *   그 버튼은 스레드의 답변 옆에 이미 있다.
   */
  const block = operatorReplyBlock(messages.map((m) => m.kind as MessageKind));
  const answerCount = messages.filter((m) => m.kind !== 'customer').length;

  const submitReply = async () => {
    if (!draft.trim()) {
      setDraftErr(true);
      return;
    }
    if (await onReply('text', draft)) {
      setDraft('');
      setDraftErr(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    if (!editing.body.trim()) {
      setEditErr(true);
      return;
    }
    if (await onEdit(editing.messageId, editing.body)) {
      setEditing(null);
      setEditErr(false);
    }
  };

  const head = (
    <div className={styles.detailHead}>
      <div className={styles.who}>
        {/* 제목 칸이 없다 — 문의 유형이 제목이다 */}
        <h2>{typeName}</h2>
        <span className={styles.whoDivider} />
        <span className={styles.whoSub}>{inquiry.name}</span>
        <span className={`${styles.badge} ${inquiry.status === 'R' ? styles.badgeWait : styles.badgeDone}`}>
          {statusName}
        </span>
        {/* ★ 운영자 화면에만 있는 표시다 — 고객 목록·글 보기에는 없다(04-data-model §5) */}
        {inquiry.retentionPassed ? <span className={`${styles.badge} ${styles.badgeOld}`}>보관 기간 지남</span> : null}
      </div>
      {/*
        ★ 삭제는 **글 전체**다(원글 + 스레드). 개인정보가 함께 지워지고 되돌릴 수 없어서
          확인 창을 거친다. 보관 기간이 지나지 않은 글도 지울 수 있다(스팸 제거 —
          2026-09-28 결정, 03-thread §5 가 운영 판단으로 남긴 자리다).
      */}
      {/* ★ 공통 Button 지우기(danger · 회색 테두리 빨간 글자 · 2026-11-25 입주관리 일관성). 자리는 그대로 */}
      {showDelete ? (
        <Button variant="danger" size="sm" data-delete="1" iconLeft={<Icon name="trash-2" size={16} />} onClick={onAskDelete}>
          글 삭제
        </Button>
      ) : null}
    </div>
  );

  const retention = inquiry.retentionPassed ? (
    <div className={styles.retention} data-retention="1">
      <Icon name="info" size={16} />
      <span>
        등록일부터 {inquiry.retentionMonths}개월이 지났습니다(보유 기간 「등록일로부터{' '}
        {inquiry.retentionMonths}개월 보관 후 파기」). <b>자동으로 삭제되지 않습니다</b> — 상담이 끝난 글이면{' '}
        {/* 앱 안은 [글 삭제] 를 감춘다 → 「PC 화면에서」 (앱 1단계 9-나) */}
        {retentionDeleteHint(showDelete)} 고객 화면에는 이 안내가 보이지 않습니다.
      </span>
    </div>
  ) : null;

  /** 답변 고치기 칸 — 스레드(PC) · 묶음(앱) 둘 다 쓴다. `note` = 「수정됨」 안내(PC 만) */
  const editBox = (messageId: string, body: string, note: boolean) => (
    <>
      <textarea
        className={`${styles.textarea}${editErr ? ` ${styles.isErr}` : ''}`}
        data-f="edit"
        rows={5}
        maxLength={BODY_MAX}
        value={body}
        onChange={(e) => {
          setEditing({ messageId, body: e.target.value });
          setEditErr(false);
        }}
      />
      <span className={styles.countRow}>
        <span className={styles.countErr}>{editErr ? '답변 내용을 입력해 주세요' : ''}</span>
        <span className={styles.count2}>
          {body.length} / {BODY_MAX}
        </span>
      </span>
      <div className={styles.msgFoot}>
        {note ? (
          <span className={styles.composeNote} style={{ marginRight: 'auto' }}>
            수정하면 고객 화면에 「수정됨」이 붙습니다. 등록 시각과 순서는 그대로입니다.
          </span>
        ) : null}
        {/* ★ PC(note) = 공통 Button [취소](보통) [수정 저장](주) · 앱 안(묶음)은 종전 단추 그대로(폰 배치 유지) */}
        {note ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setEditErr(false);
              }}
            >
              취소
            </Button>
            <Button variant="primary" size="sm" data-edit-save="1" disabled={busy} onClick={() => void submitEdit()}>
              수정 저장
            </Button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setEditErr(false);
              }}
            >
              취소
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
              data-edit-save="1"
              disabled={busy}
              onClick={() => void submitEdit()}
            >
              수정 저장
            </button>
          </>
        )}
      </div>
    </>
  );

  /*
   * ══ 앱 안 — 문의-답변 묶음(3-마 덧붙임 3 · 대표 지시 2026-11-16) ══
   *  1회 묶음 = 1행 이름 · 회사명 / 2행 연락처 · 등록일시 / 3행 이메일 / 4행 문의 내용 / 5행 답변(입력칸)
   *  2회부터 = 고객 추가 질문 + 그 답변. 묶음 나누기는 shared `inquiryRounds` 하나다.
   *  ★ 「답변」 소제목 · 답변 칸 안내 문구는 없다. [전화로 답변함] · [답변 등록] 은 묶음 밖 맨 아래.
   *  ★ [전화로 답변함] 에 전화 그림을 넣지 않는다 — 누르면 전화가 걸리는 줄로 읽힌다. 전화 그림은 연락처 앞에만.
   *  ★ 입력칸 · 단추를 그리는 판정은 PC 와 같다(`operatorReplyBlock` — 서버 409 와 같은 함수).
   *  ★ 머리(유형 · 이름 · 상태)와 「보관 기간 지남」 안내는 PC 와 같은 것을 그린다.
   */
  if (rounds) {
    const list = inquiryRounds(messages.map((m) => m.kind));
    /* 단추 줄 — 고정이면 스크롤 칸(detailBody) 밖 맨 아래, 아니면 묶음 뒤 */
    const replyActions = block ? null : (
      <div className={styles.roundActions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          data-phone-reply="1"
          disabled={busy}
          onClick={() => void onReply('phone', '')}
        >
          전화로 답변함
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          data-reply-add="1"
          disabled={busy}
          onClick={() => void submitReply()}
        >
          답변 등록
        </button>
      </div>
    );
    return (
      <>
        {head}
        <div className={styles.detailBody}>
          {retention}
          {list.map((r, ri) => {
            const q = r.question === null ? null : (messages[r.question] ?? null);
            const last = ri === list.length - 1;
            return (
              <section key={r.no} className={styles.round} data-round={r.no}>
                <div className={styles.roundTitle}>{r.no}회 문의</div>
                {q === null ? (
                  /* ★ 명세에 있는 항목만(02-screens §3) · 회사명은 선택 항목이라 비면 「-」 — 줄 모양을 지킨다 */
                  <div className={styles.roundInfo} data-origin="1">
                    <div>
                      <div className={styles.roundKey}>이름</div>
                      <div className={styles.roundVal}>{inquiry.name}</div>
                    </div>
                    <div>
                      <div className={styles.roundKey}>회사명</div>
                      <div className={styles.roundVal}>{inquiry.companyName || '-'}</div>
                    </div>
                    <div>
                      <div className={styles.roundKey}>연락처</div>
                      <div className={`${styles.roundVal} ${styles.tabular}`}>
                        <a className={styles.roundTel} href={`tel:${inquiry.phone.replace(/\D/g, '')}`}>
                          <Icon name="phone" size={14} />
                          {inquiry.phone}
                        </a>
                      </div>
                    </div>
                    <div>
                      <div className={styles.roundKey}>등록일시</div>
                      <div className={`${styles.roundVal} ${styles.tabular}`}>{dotDateTime(inquiry.createdAt)}</div>
                    </div>
                    <div className={styles.roundWide}>
                      <div className={styles.roundKey}>이메일</div>
                      <div className={styles.roundVal}>
                        <a href={`mailto:${inquiry.email}`}>{inquiry.email}</a>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className={styles.roundPart} data-question={q ? 'customer' : 'origin'}>
                  <div className={styles.roundKey}>{q ? `추가 문의 · ${dotDateTime(q.createdAt)}` : '문의 내용'}</div>
                  <p className={styles.roundText}>{q ? q.body : inquiry.body}</p>
                </div>

                {r.answers.map((ai) => {
                  const m = messages[ai];
                  if (!m) return null;
                  return (
                    <div key={m.messageId} className={styles.roundPart} data-msg={m.kind}>
                      <div className={styles.roundAnswerHead}>
                        <div className={styles.roundKey}>
                          답변 · {dotDateTime(m.createdAt)}
                          {m.editedAt ? ` · ${dotDate(m.editedAt)} 수정됨` : ''}
                        </div>
                        {/* ★ 수정은 **글답변만** — 전화 기록 · 고객 글은 고치지 않는다 */}
                        {m.kind === 'text' && editing?.messageId !== m.messageId ? (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
                            data-edit={m.messageId}
                            onClick={() => {
                              setEditing({ messageId: m.messageId, body: m.body ?? '' });
                              setEditErr(false);
                            }}
                          >
                            수정
                          </button>
                        ) : null}
                      </div>
                      {m.kind === 'phone' ? (
                        <p className={styles.roundText}>전화로 답변드렸습니다</p>
                      ) : editing?.messageId === m.messageId ? (
                        editBox(m.messageId, editing.body, false)
                      ) : (
                        <p className={styles.roundText}>{m.body}</p>
                      )}
                    </div>
                  );
                })}

                {last && !block ? (
                  <div className={styles.roundPart} data-compose="1">
                    <div className={styles.roundKey}>답변</div>
                    <textarea
                      id="reply-body"
                      aria-label="답변"
                      className={`${styles.textarea}${draftErr ? ` ${styles.isErr}` : ''}`}
                      data-f="reply"
                      rows={5}
                      maxLength={BODY_MAX}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setDraftErr(false);
                      }}
                    />
                    <span className={styles.countRow}>
                      <span className={styles.countErr}>{draftErr ? '답변 내용을 입력해 주세요' : ''}</span>
                      <span className={styles.count2}>
                        {draft.length} / {BODY_MAX}
                      </span>
                    </span>
                  </div>
                ) : null}
              </section>
            );
          })}

          {fixedActions ? null : replyActions}
        </div>
        {/* ★ 고정 단추 — 스크롤 칸 밖이라 늘 보이고, 마지막 묶음을 덮지 않는다(같은 세로 줄의 다음 칸) */}
        {fixedActions && replyActions ? <div className={styles.roundActionsFixed}>{replyActions}</div> : null}
      </>
    );
  }

  return (
    <>
      {head}

      <div className={styles.detailBody}>
        {retention}

        {/* ── 원글 ── ★ 명세에 있는 항목만 보인다(02-screens §3 의 폼 항목 그대로) ── */}
        <div className={styles.card2} data-origin="1">
          <div className={styles.info}>
            <div>
              <div className={styles.infoKey}>이름</div>
              <div className={styles.infoVal}>{inquiry.name}</div>
            </div>
            <div>
              <div className={styles.infoKey}>연락처</div>
              <div className={`${styles.infoVal} ${styles.tabular}`}>
                <a href={`tel:${inquiry.phone.replace(/\D/g, '')}`}>{inquiry.phone}</a>
              </div>
            </div>
            <div>
              <div className={styles.infoKey}>이메일</div>
              <div className={styles.infoVal}>
                <a href={`mailto:${inquiry.email}`}>{inquiry.email}</a>
              </div>
            </div>
            {/* ★ 회사명은 선택 항목이다 — 비었으면 칸을 **빼고** 그린다(고객 화면과 같다) */}
            {inquiry.companyName ? (
              <div>
                <div className={styles.infoKey}>회사명</div>
                <div className={styles.infoVal}>{inquiry.companyName}</div>
              </div>
            ) : null}
            <div>
              <div className={styles.infoKey}>등록</div>
              <div className={`${styles.infoVal} ${styles.tabular}`}>{dotDateTime(inquiry.createdAt)}</div>
            </div>
          </div>
          <div className={styles.hr} />
          <p className={styles.bodyText}>{inquiry.body}</p>
        </div>

        <h3 className={styles.secTitle}>답변 {messages.length > 0 ? `${messages.length}건` : ''}</h3>

        <div data-thread="1">
          {messages.map((m) =>
            m.kind === 'phone' ? (
              /* 전화 답변 기록 — 본문이 없다. 고객 화면에는 「전화로 답변드렸습니다」로 보인다 */
              <div key={m.messageId} className={`${styles.msg} ${styles.msgPhone}`} data-msg="phone">
                <span className={styles.avBig}>
                  <Icon name="phone" size={18} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.msgLead}>전화로 답변드렸습니다</div>
                  {/* ★ 이름은 고정 문구다 — 「담당 {사람 이름}」을 쓰지 않는다(문구 자체가 담당자다) */}
                  <div className={styles.msgSub}>
                    {dotDateTime(m.createdAt)} · {OPERATOR_DISPLAY_NAME}
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={m.messageId}
                className={`${styles.msg}${m.kind === 'customer' ? ` ${styles.msgCustomer}` : ''}`}
                data-msg={m.kind}
              >
                <div className={styles.msgHeadRow}>
                  <div className={styles.msgHead}>
                    <span className={`${styles.av} ${m.kind === 'customer' ? styles.avCu : styles.avOp}`}>
                      <Icon name={m.kind === 'customer' ? 'user' : 'message-square-text'} size={16} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      {/* ★ 답변자 이름은 **고정 문구**다 — 로그인한 사람 이름을 쓰지 않는다 */}
                      <div className={styles.who2}>
                        {m.kind === 'customer' ? '고객 추가 질문' : OPERATOR_DISPLAY_NAME}
                      </div>
                      <div className={styles.when}>
                        <span>{dotDateTime(m.createdAt)}</span>
                        {/* 같은 날 고쳐도 붙는다 — 고객이 이미 읽은 내용이 바뀌었을 수 있다 */}
                        {m.editedAt ? <span>· {dotDate(m.editedAt)} 수정됨</span> : null}
                      </div>
                    </div>
                  </div>
                  {/* ★ 수정은 **글답변만**. 고객 글에는 버튼이 없다 — 남의 말을 고치지 않는다 */}
                  {m.kind === 'text' && editing?.messageId !== m.messageId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-edit={m.messageId}
                      iconLeft={<Icon name="pencil-line" size={14} />}
                      onClick={() => {
                        setEditing({ messageId: m.messageId, body: m.body ?? '' });
                        setEditErr(false);
                      }}
                    >
                      수정
                    </Button>
                  ) : null}
                </div>

                {editing?.messageId === m.messageId ? (
                  editBox(m.messageId, editing.body, true)
                ) : (
                  <p className={styles.bodyText}>{m.body}</p>
                )}
              </div>
            ),
          )}
        </div>

        {/* ══ 답변 등록 ══ ★ 답변은 이 화면에서만 한다(한 업무는 한 화면에서 · CLAUDE.md)
            ★★ 쓸 수 없는 상태면 **아무것도 두지 않는다**(2026-09-28 결정). 잠긴 칸도,
               왜 잠겼는지도 두지 않는다 — 할 수 있는 일이 [수정] 하나뿐이라 그 버튼이
               스레드에 이미 있고, 안내 석 줄이 그 아래를 채우면 화면이 시끄러워진다.
            ★ **서버의 409 는 그대로다**(`REPLY_BLOCK_MESSAGE`). 화면에 없다고 규칙이
               없어진 것이 아니다 — API 를 직접 찌르면 문구와 함께 막힌다. */}
        {block ? null : (
        <div className={styles.compose} data-compose="1">
          <label className={styles.lab} htmlFor="reply-body">
            답변 등록 · {answerCount + 1}번째 / 최대 {MAX_OPERATOR_ANSWERS}회
          </label>
          <textarea
            id="reply-body"
            className={`${styles.textarea}${draftErr ? ` ${styles.isErr}` : ''}`}
            data-f="reply"
            rows={5}
            maxLength={BODY_MAX}
            placeholder="고객에게 보일 답변을 적어 주세요. 이 글이 고객 화면의 「답변」에 그대로 보입니다."
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftErr(false);
            }}
          />
          <span className={styles.countRow}>
            <span className={styles.countErr}>{draftErr ? '답변 내용을 입력해 주세요' : ''}</span>
            <span className={styles.count2}>
              {draft.length} / {BODY_MAX}
            </span>
          </span>
          <div className={styles.composeFoot}>
            <span className={styles.composeNote}>
              {/* ★ 알림 메일을 보내지 않는다 — 고객은 이 글에서 확인한다(01-flow.md) */}
              등록하면 상태가 「답변완료」로 바뀝니다. 별도 알림 메일은 보내지 않습니다.
            </span>
            <div className={styles.composeActions}>
              {/*
                ★ 전화로 답변한 경우의 기록. 본문이 없고 **지울 수 없다**(개별 글 삭제가
                  없다) — 그래서 무엇이 남는지 버튼 옆에 적는다.
              */}
              <Button
                variant="ghost"
                size="sm"
                data-phone-reply="1"
                disabled={busy}
                iconLeft={<Icon name="phone" size={16} />}
                onClick={() => void onReply('phone', '')}
              >
                전화로 답변함
              </Button>
              <Button variant="primary" size="sm" data-reply-add="1" disabled={busy} onClick={() => void submitReply()}>
                답변 등록
              </Button>
            </div>
          </div>
          <p className={styles.composeNote} style={{ marginTop: 10 }}>
            [전화로 답변함]은 고객 화면에 「전화로 답변드렸습니다 · {OPERATOR_DISPLAY_NAME}」으로 보입니다 — 본문은
            없고, 기록은 지울 수 없습니다. ★ 전화 답변도 답변 1회로 셉니다.
          </p>
        </div>
        )}
      </div>
    </>
  );
}
