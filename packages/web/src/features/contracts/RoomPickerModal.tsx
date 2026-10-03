'use client';

/** @screen s030200040p3 계약호실 확인 · 020 입주사관리 · 1차 */

/**
 * 계약호실 확인 팝업 — 계약 폼 섹션 2 의 [조회] 버튼이 연다.
 *
 * =============================================================================
 * ★★★ 이 번호는 **세무서에 내는 번호**다
 * =============================================================================
 * 계약호실은 국세청 신고용 대표 호실이다. 두 계약이 같은 번호로 제출되면 **밖에서
 * 사고가 난다.** 그래서 겹치면 [확인] 을 **막는다** — 경고가 아니다.
 *
 * ★ 그래도 이 화면이 마지막 방어선은 아니다. 저장할 때 서버가 **같은 함수**로 다시
 *   본다(`routes/contracts.ts`). 규칙은 `@swonbiz/shared/domain/contract-room` 한 곳에 있다.
 *
 * =============================================================================
 * ★★ 호실번호가 이 팝업의 **본체**다
 * =============================================================================
 * 목록은 6열(회사/호실 세 쌍)이고, 회사명이 길면 말줄임한다. 잘리는 것은 **회사명
 * 쪽뿐이고 호실번호는 언제나 온전히 보인다** — 운영자가 여기서 찾는 것은 번호다.
 *
 * ★ 자기 계약도 목록에 **넣는다.** 지금 무엇이 어디 있는지가 판단 재료이기 때문이다.
 *   다만 중복으로는 보지 않는다(`findRoomConflict` 의 `selfContractIds`). 재계약이면
 *   **이전 계약도** 그 목록에 있다 — 이어받은 번호가 자기 자신과 부딪히면 안 된다.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ROOM_TAKEN_MESSAGE,
  findRoomConflict,
  normalizeRoom,
  type RoomHolder,
} from '@swonbiz/shared/domain/contract-room';
import { Icon } from '@/components/ds';
import styles from './contract-form.module.css';

interface Props {
  /** 지금 폼에 들어 있는 계약호실. 열 때 입력칸의 시작값이다. */
  current: string;
  /**
   * 이 편집이 «자기»로 보는 계약들 — 중복에서 뺀다(`selfContractIds`).
   *
   * ★ 새 계약이면 빈 배열이다. ★★ **재계약이면 이전 계약이 들어 있다** — 이전 계약은
   *   살아 있는 채로 같은 번호를 들고 있어서, 빼지 않으면 재계약이 자기 이전 계약과
   *   부딪혀 [확인] 이 눌리지 않는다.
   */
  selfContractIds: readonly string[];
  onClose: () => void;
  onPick: (room: string) => void;
}

/** 한 줄에 회사/호실 세 쌍 = 6열. 시안의 표 구조다. */
const PAIRS_PER_ROW = 3;

export function RoomPickerModal({ current, selfContractIds, onClose, onPick }: Props) {
  const [rooms, setRooms] = useState<RoomHolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(current);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/contracts/rooms', { cache: 'no-store' });
        const body = (await res.json()) as { rooms?: RoomHolder[]; message?: string };
        if (!res.ok) throw new Error(body.message ?? '계약호실을 불러오지 못했습니다');
        // ★ 서버가 이미 호실번호 순으로 정렬해서 준다(같은 함수로). 다시 정렬하지 않는다.
        if (alive) setRooms(body.rooms ?? []);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const typed = normalizeRoom(value);
  /**
   * ★ 목록을 못 받았으면 **중복 여부를 말하지 않는다.** 「사용할 수 있습니다」는
   *   확인한 뒤에만 할 수 있는 말이고, 확인하지 못한 것을 초록불로 보여주면
   *   운영자가 «확인했다»고 믿는다.
   */
  const conflict = useMemo(
    () => (rooms ? findRoomConflict(rooms, typed, selfContractIds) : null),
    [rooms, typed, selfContractIds],
  );

  const canConfirm = rooms !== null && typed !== '' && conflict === null;

  /** 6열로 깔기 위해 세 쌍씩 묶는다. */
  const chunks = useMemo(() => {
    const out: RoomHolder[][] = [];
    for (let i = 0; i < (rooms?.length ?? 0); i += PAIRS_PER_ROW) {
      out.push(rooms!.slice(i, i + PAIRS_PER_ROW));
    }
    return out;
  }, [rooms]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="계약호실 확인">
      <div className={`${styles.modal} ${styles.roomModal}`}>
        <h2 className={styles.modalTitle} style={{ textAlign: 'left', marginBottom: 4 }}>
          계약호실 확인
        </h2>
        <p className={styles.modalDesc} style={{ textAlign: 'left', marginBottom: 16 }}>
          국세청 신고용 대표 호실입니다. 계약중·계약대기 계약이 쓰고 있는 번호는 다시 쓸 수 없습니다.
        </p>

        {/* ── 번호 입력 + 중복 여부 ─────────────────────────────────────── */}
        <div className={styles.inlineRow}>
          <input
            className={`${styles.input} ${styles.flex1}`}
            placeholder="예: 6-1"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          <span className={styles.roomVerdict} style={{ color: verdictTone(rooms, typed, conflict) }}>
            {verdictText(rooms, typed, conflict)}
          </span>
        </div>

        {/* ── 쓰이고 있는 번호들 ────────────────────────────────────────── */}
        <div className={styles.roomList}>
          {error ? (
            <p className={styles.sectionNote}>{error}</p>
          ) : rooms === null ? (
            <p className={styles.sectionNote}>불러오는 중…</p>
          ) : rooms.length === 0 ? (
            <p className={styles.sectionNote}>사용 중인 계약호실이 없습니다.</p>
          ) : (
            <table className={styles.roomTable}>
              <tbody>
                {chunks.map((row, i) => (
                  <tr key={i}>
                    {row.map((h) => (
                      <RoomCells
                        key={h.contractId}
                        holder={h}
                        picked={normalizeRoom(h.room) === typed}
                        onPick={() => setValue(h.room)}
                      />
                    ))}
                    {/* 마지막 줄이 짧으면 빈 칸으로 채운다 — 열 너비가 흔들리지 않게. */}
                    {Array.from({ length: PAIRS_PER_ROW - row.length }).map((_, k) => (
                      <td key={`pad-${k}`} colSpan={2} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!canConfirm}
            onClick={() => onPick(typed)}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 회사명 + 호실번호 한 쌍 = 2열.
 *
 * ★ **말줄임은 회사명 쪽에만** 건다. 호실번호 칸은 내용만큼 폭을 가져가고 줄바꿈하지
 *   않는다 — 잘려도 되는 것과 안 되는 것이 다르다.
 */
function RoomCells({
  holder,
  picked,
  onPick,
}: {
  holder: RoomHolder;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <>
      <td className={styles.roomCompany} title={holder.companyName}>
        <button type="button" className={styles.roomPick} onClick={onPick}>
          {holder.companyName}
        </button>
      </td>
      <td className={`${styles.roomNo}${picked ? ` ${styles.roomNoOn}` : ''}`}>
        <button type="button" className={styles.roomPick} onClick={onPick}>
          {holder.room}
        </button>
      </td>
    </>
  );
}

function verdictText(
  rooms: RoomHolder[] | null,
  typed: string,
  conflict: RoomHolder | null,
): string {
  if (rooms === null) return '';
  if (typed === '') return '번호를 입력해 주세요';
  // ★ 어느 회사가 쓰고 있는지까지 말한다 — 「사용 중입니다」만으로는 다음에 무엇을
  //   해야 할지 알 수 없다.
  return conflict ? `${ROOM_TAKEN_MESSAGE} (${conflict.companyName})` : '사용할 수 있습니다';
}

function verdictTone(rooms: RoomHolder[] | null, typed: string, conflict: RoomHolder | null): string {
  if (rooms === null || typed === '') return 'var(--text-muted)';
  return conflict ? 'var(--color-danger, #d33)' : 'var(--color-success, green)';
}
