'use client';

/**
 * 법인변경 상세 「기본정보」 카드 안 「정관 파일」(결정 2026-11-07) — 회사(단체)마다 한 개, 최종본만.
 *
 * ★ 올리기 · 바꾸기는 서버가 준 `canUpload`(운영사 · 회사 정보를 고칠 수 있는 사람 — 입주사는 운영사만)일 때만
 *   보인다. 서버가 다시 판정한다(403). 보기는 운영사 · 그 회사 사람.
 * ★ 바꾸기 전에 「바꾸면 이전 정관 파일은 지워집니다」 확인 한 번 — 이전 파일은 행 · 저장소 실물까지 지워진다.
 * ★ 보기는 그때그때 만료되는 주소를 받아 새 창으로 연다 — 주소를 들고 있지 않는다.
 * ★ 형식 · 크기는 기존 첨부 규칙(`rejectBytes` — JPG · PNG · PDF · 10MB)으로 먼저 걸러 알린다.
 * ★ 완료된 법인설립 건이 있으면 「설립 건 정관 보기」 — 그 설립 건 상세로 가서 [서류 출력]이 열리고 정관이 골라진다
 *   (`?print=articles`, 결정 2026-11-07). 정관을 따로 저장하거나 만들지 않는다. 칸이 비었으면 안내 한 줄(`INCORP_ARTICLES_NOTE`).
 * ★ 이 칸은 건의 [저장] 과 상관없다 — 고르는 즉시 올라간다(단체에 붙는 파일이라 건과 따로 산다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ALLOWED_MIME_TYPES, rejectBytes } from '@swonbiz/shared/domain/contract-files';
import {
  ARTICLES_REPLACE_CONFIRM,
  INCORP_ARTICLES_NOTE,
  incorpArticlesHref,
  type ArticlesFileView,
} from '@swonbiz/shared/domain/legal-articles-file';
import styles from './corp-change-detail.module.css';

const base = (orgId: number) => `/api/legal/orgs/${encodeURIComponent(String(orgId))}/articles-file`;

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

const sizeText = (bytes: number | null) =>
  bytes === null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

export function ArticlesFileField({ orgId, onError }: { orgId: number; onError: (message: string) => void }) {
  const [view, setView] = useState<ArticlesFileView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(base(orgId));
      if (!res.ok) {
        setLoadError(await messageOf(res, '정관 파일을 읽지 못했습니다'));
        return;
      }
      setView((await res.json()) as ArticlesFileView);
    } catch {
      setLoadError('서버에 연결할 수 없습니다');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    const rejected = rejectBytes(file.type, file.size);
    if (rejected) {
      onError(rejected);
      return;
    }
    if (view?.file && !window.confirm(ARTICLES_REPLACE_CONFIRM)) return;
    setBusy(true);
    try {
      const res = await fetch(base(orgId), {
        method: 'POST',
        headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name) },
        body: file,
      });
      if (!res.ok) {
        onError(await messageOf(res, '정관 파일을 올리지 못했습니다'));
        return;
      }
      setView((await res.json()) as ArticlesFileView);
    } catch {
      onError('서버에 연결할 수 없습니다');
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    // 팝업 차단을 피하려고 누른 순간 창을 먼저 연다 — 주소는 받은 뒤에 넣는다
    const win = window.open('', '_blank');
    try {
      const res = await fetch(`${base(orgId)}/url`);
      if (!res.ok) {
        win?.close();
        onError(await messageOf(res, '정관 파일을 열지 못했습니다'));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      win?.close();
      onError('서버에 연결할 수 없습니다');
    }
  };

  const file = view?.file ?? null;
  return (
    <div className={`${styles.field} ${styles.span2}`}>
      <span className={styles.label}>정관 파일</span>
      <div className={styles.fileRow}>
        <span className={`${styles.readValue} ${styles.fileName}${file ? '' : ` ${styles.readEmpty}`}`}>
          {loadError ?? (view === null ? '읽는 중…' : file ? `${file.originalName}${file.fileSize !== null ? ` (${sizeText(file.fileSize)})` : ''}` : view.completedIncorporationId ? INCORP_ARTICLES_NOTE : '올린 파일 없음')}
        </span>
        {file ? (
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`} onClick={() => void open()}>
            보기
          </button>
        ) : null}
        {view?.canUpload ? (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? '올리는 중…' : file ? '바꾸기' : '올리기'}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept={ALLOWED_MIME_TYPES.join(',')}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = '';
                if (picked) void upload(picked);
              }}
            />
          </>
        ) : null}
        {view?.completedIncorporationId ? (
          <Link
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnXs}`}
            href={incorpArticlesHref(view.completedIncorporationId)}
          >
            설립 건 정관 보기
          </Link>
        ) : null}
      </div>
    </div>
  );
}
