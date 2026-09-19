'use client';

/** @screen s0300200040 계약 폼 · 섹션 4 첨부 서류 · 020 입주사관리 · 1차 */

/**
 * 섹션 4 — 첨부 서류 (CONT-17).
 *
 * 원본: design/handoff/prototypes/s0300200040.html 668~686행 · 렌더는 1160~1215행
 * 명세: design/handoff/tenant-contract/03-contract-form.md 「섹션 4」
 *
 * =============================================================================
 * ★★ 표시·필수 규칙은 **여기 없다** — `@swonbiz/shared/domain/contract-files`
 * =============================================================================
 * 서버(`routes/files.ts`)가 **같은 함수**로 다시 판정한다. 화면에만 두면 화면을
 * 우회한 요청이 통과한다 — 개인사업자에게 안 보이는 법인등기부등본 칸이 그 예다.
 *
 * =============================================================================
 * ★★ 첨부는 **회사에 붙는다** — 계약이 아니다
 * =============================================================================
 * 그래서 `companyId` 가 없으면(아직 저장 안 된 신규 계약) 올릴 수 없다. 이때는
 * 「먼저 저장해 주세요」라고 말한다 — 버튼만 죽여 두면 왜 안 되는지 알 수 없다.
 *
 * =============================================================================
 * ★★ 미리보기 주소는 **만료된다. 담아 두지 않는다**
 * =============================================================================
 * 서버가 주는 `url` 은 서명 URL 이고 5분 뒤에 죽는다(레거시는 이것을 DB 에 저장해서
 * 전부 죽은 링크가 됐다 — 결함 ②). 화면도 같은 실수를 하지 않는다: 눌렀을 때
 * **그 순간 목록을 다시 받아** 새 주소로 연다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALLOWED_MIME_TYPES,
  DOC_DEFS,
  MAX_FILE_MB,
  docRuleFor,
  rejectUpload,
  visibleDocs,
  type FilePurpose,
} from '@swonbiz/shared/domain/contract-files';
import { Icon } from '@/components/ds';
import styles from './contract-form.module.css';

/** `GET /api/companies/:id/files` 의 한 줄. */
export interface CompanyFile {
  fileId: string;
  purpose: string;
  originalName: string;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: string;
  /** ★ 서명 URL. **만료된다** — state 에 오래 두지 않는다. */
  url: string | null;
}

interface Props {
  /** `null` 이면 아직 저장되지 않은 계약이다 — 붙일 회사가 없다. */
  companyId: string | null;
  memberType: string;
  /** `terminated`·`cancelled` — 읽기 전용. 올리지도 지우지도 못한다. */
  disabled: boolean;
  onNotify: (message: string) => void;
}

export function SectionDocs({ companyId, memberType, disabled: frozen, onNotify }: Props) {
  const [files, setFiles] = useState<CompanyFile[]>([]);
  const [loading, setLoading] = useState(false);
  /** 지금 무엇을 처리 중인가. 같은 카드의 버튼만 죽인다 — 전체를 잠그면 답답하다. */
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});

  const shown = visibleDocs(memberType);
  const byPurpose = new Map(files.map((f) => [f.purpose, f]));
  // ★ **보이는 칸만** 센다. 법인등기부등본이 숨겨진 회사에 그 파일이 남아 있어도
  //   「1/3」이 「1/4」로 보이지 않는다.
  const done = shown.filter((d) => byPurpose.has(d.purpose)).length;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/files`, { cache: 'no-store' });
      const body = (await res.json()) as { files?: CompanyFile[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '첨부 서류를 불러오지 못했습니다');
      setFiles(body.files ?? []);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 고른 파일을 올린다. **화면에서 먼저 거른다** — 서버도 같은 함수로 다시 거른다. */
  const upload = async (purpose: FilePurpose, file: File) => {
    if (!companyId) return;

    const reason = rejectUpload({
      purpose,
      mimeType: file.type,
      size: file.size,
      memberType,
    });
    if (reason) {
      onNotify(reason);
      return;
    }

    setBusy(purpose);
    try {
      const res = await fetch(`/api/companies/${companyId}/files?purpose=${purpose}`, {
        method: 'POST',
        headers: {
          'content-type': file.type,
          // ★ 한글 파일명이 헤더에 그대로 들어가면 규격 위반이라 프록시가 끊는다.
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const body = (await res.json()) as { replaced?: boolean; message?: string };
      if (!res.ok) throw new Error(body.message ?? '파일을 올리지 못했습니다');
      onNotify(body.replaced ? '기존 파일을 교체했습니다' : '첨부했습니다');
      await load();
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (file: CompanyFile) => {
    if (!companyId) return;
    setBusy(file.purpose);
    try {
      const res = await fetch(`/api/companies/${companyId}/files/${file.fileId}`, { method: 'DELETE' });
      // 204 에는 본문이 없다 — 파싱하려 들면 거기서 터진다.
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? '파일을 지우지 못했습니다');
      }
      onNotify('첨부를 삭제했습니다');
      await load();
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * ★ 열기 전에 **목록을 다시 받는다.** 화면을 열어 둔 채 5분이 지나면 손에 든
   *   주소는 이미 죽어 있다. 「안 열려요」의 대부분이 이것이다.
   */
  const open = async (purpose: string) => {
    if (!companyId) return;
    setBusy(purpose);
    try {
      const res = await fetch(`/api/companies/${companyId}/files`, { cache: 'no-store' });
      const body = (await res.json()) as { files?: CompanyFile[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '첨부 서류를 불러오지 못했습니다');
      setFiles(body.files ?? []);
      const fresh = (body.files ?? []).find((f) => f.purpose === purpose);
      if (!fresh?.url) throw new Error('파일 주소를 받지 못했습니다. 잠시 후 다시 시도해 주세요');
      window.open(fresh.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const bizMissing = docRuleFor('BIZ_REG', memberType).required && !byPurpose.has('BIZ_REG');

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleWithBadge}>
          <h2>첨부 서류</h2>
        </div>
        <span className={styles.sectionCount}>
          {done} / {shown.length} 등록
        </span>
      </div>
      <div className={styles.sectionRule} />

      {!companyId ? (
        // ★ 버튼만 죽이지 않는다. 왜 못 올리는지와 무엇을 하면 되는지를 말한다.
        <p className={styles.sectionNote}>
          첨부 서류는 입주사에 붙습니다. 먼저 [임시저장] 으로 입주사를 등록한 뒤 올려 주세요.
        </p>
      ) : null}

      <div className={styles.docList}>
        {shown.map((def) => {
          const rule = docRuleFor(def.purpose, memberType);
          const file = byPurpose.get(def.purpose);
          const working = busy === def.purpose;
          const locked = frozen || !companyId || working;

          return (
            <div className={styles.docCard} key={def.purpose}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className={styles.docName}>{def.name}</span>
                  <span
                    className={`${styles.badge} ${rule.required ? styles.badgeDanger : styles.badgeNeutral}`}
                  >
                    {rule.required ? '필수' : '선택'}
                  </span>
                  {file ? (
                    <span className={`${styles.badge} ${styles.badgeOk ?? styles.badgeNeutral}`}>
                      <Icon name="circle-check" size={12} />
                      등록됨
                    </span>
                  ) : null}
                </div>
                <div className={styles.docDesc}>
                  {file ? `${file.originalName} · ${sizeLabel(file.fileSize)}` : def.desc}
                </div>
              </div>

              <div className={styles.docActions}>
                {file ? (
                  <>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnGhost}`}
                      disabled={working}
                      onClick={() => void open(def.purpose)}
                    >
                      <Icon name="eye" size={16} />
                      보기
                    </button>
                    {/* ★ 종료·취소된 계약에서도 **보기는 열어 둔다.** 못 보게 할 이유가 없다. */}
                    {!frozen ? (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost}`}
                        disabled={locked}
                        onClick={() => void remove(file)}
                      >
                        <Icon name="trash-2" size={16} />
                        삭제
                      </button>
                    ) : null}
                  </>
                ) : null}

                {!frozen ? (
                  <>
                    <input
                      ref={(el) => {
                        inputs.current[def.purpose] = el;
                      }}
                      type="file"
                      hidden
                      accept={ALLOWED_MIME_TYPES.join(',')}
                      onChange={(e) => {
                        const picked = e.target.files?.[0];
                        // ★ 값을 즉시 비운다. 안 비우면 **같은 파일을 두 번 고를 수 없다** —
                        //   change 가 안 뜬다. 올리기 실패 후 다시 고르는 흐름이 막힌다.
                        e.target.value = '';
                        if (picked) void upload(def.purpose, picked);
                      }}
                    />
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnGhost}`}
                      disabled={locked}
                      onClick={() => inputs.current[def.purpose]?.click()}
                    >
                      <Icon name="upload" size={16} />
                      {working ? '처리 중…' : file ? '교체' : '파일 선택'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.docFoot}>
        JPG, PNG, PDF 형식 · 파일당 최대 {MAX_FILE_MB}MB
        {loading ? ' · 불러오는 중…' : ''}
      </div>

      {bizMissing ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`}>
          <span className={styles.noticeIcon}>
            <Icon name="circle-alert" size={16} />
          </span>
          <span>
            사업자등록증이 없으면 가등록 상태로 계약이 진행됩니다. 발급 후 반드시 제출해 주세요.
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** 「1.2MB」 / 「480KB」. 0 과 null 은 구분하지 않는다 — 둘 다 보여줄 것이 없다. */
function sizeLabel(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '크기 미상';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 서류 4종의 정의는 shared 가 갖는다 — 화면이 목록을 다시 적지 않는다. */
export { DOC_DEFS };
