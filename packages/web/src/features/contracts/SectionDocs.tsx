'use client';

/** @screen s030200040 계약 폼 · 섹션 4 첨부 서류 · 020 입주사관리 · 1차 */

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
  isFilePurpose,
  offRuleDocs,
  offRuleNote,
  rejectUpload,
  visibleDocs,
  type DocDef,
  type FilePurpose,
} from '@swonbiz/shared/domain/contract-files';
import type { BizRegFields } from '@swonbiz/shared/domain/biz-reg-ocr';
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
  /**
   * 회원구분의 **표시명**(「개인사업자」). 「규칙 밖」 서류의 이유 한 줄에만 쓴다.
   *
   * ★ 코드(`memberType`)로는 그 문장을 만들 수 없다 — 「P에는 필요 없는 서류입니다」가
   *   된다. 이름은 코드 응답에만 있고 그것을 아는 쪽이 폼이라 폼이 내려 준다.
   */
  memberTypeName: string;
  /** `terminated`·`cancelled` — 읽기 전용. 올리지도 지우지도 못한다. */
  disabled: boolean;
  /**
   * 이 화면에 **[임시저장] 버튼이 있는가.**
   *
   * ★★ **재계약에는 없다.** 「그때까지는 [임시저장] 으로 둡니다」를 그대로 띄우면
   *    없는 버튼을 누르라고 말하는 셈이고, 안내와 화면이 어긋나면 운영자는 안내를
   *    아예 믿지 않게 된다. 실제로 그렇게 나올 뻔했다(2026-09-21).
   */
  draftable: boolean;
  onNotify: (message: string) => void;
  /**
   * ★ 사업자등록증을 읽은 결과를 **섹션 1 에 얹는다.** 몇 칸을 덮었는지 돌려준다 —
   *   이 섹션이 「n개 항목을 불러왔습니다」를 말하기 위해서다.
   *
   *   덮는 규칙(non-null 만 · 사업자번호를 덮으면 확인 상태 되돌리기)은 여기 없다.
   *   폼이 갖고 있다(`ContractForm`) — 섹션 1 의 상태를 아는 쪽이 거기다.
   */
  onBizReg: (fields: BizRegFields) => number;
  /**
   * ★★ 아직 입주사가 없을 때 **고른 파일을 붙들어 두는 곳**. 폼이 갖고 있다.
   *
   *    여기(섹션)에 두지 않는 이유가 있다 — 첫 저장 뒤 폼은 `/contracts/{id}` 로
   *    이동하고 그때 이 컴포넌트가 **통째로 다시 마운트된다.** 섹션이 들고 있으면
   *    붙들어 둔 파일이 그 순간 사라진다. 그래서 저장 흐름을 아는 폼이 갖고,
   *    회사가 생긴 직후 폼이 직접 올린다(`flushPendingDocs`).
   */
  pending: Partial<Record<FilePurpose, File>>;
  onPending: (purpose: FilePurpose, file: File | null) => void;
  /**
   * ★★ **이미 붙어 있는 서류 종류를 폼에 알린다.** 계약확정 게이트가 이 목록을 본다.
   *
   *    이 섹션이 스스로 판정하지 않는 이유 — 확정을 막는 것은 폼의 [계약확정] 이고,
   *    붙들고 있는 파일(`pending`)까지 합쳐야 답이 나온다. 그 둘을 다 아는 곳이 폼뿐이다.
   *
   * ★ **함수 정체성이 매 렌더 바뀌면 안 된다**(`useCallback`). `load` 의 의존성이라
   *   그대로 두면 목록 불러오기가 무한히 돈다.
   */
  onAttached: (purposes: FilePurpose[]) => void;
  /**
   * 확정을 막은 이유. `null` 이면 아무것도 그리지 않는다.
   *
   * ★ 문구를 여기서 만들지 않는다 — 판정도 문구도 `missingDocsMessage` 한 곳이고,
   *   서버가 같은 함수로 같은 말을 한다.
   */
  alert: string | null;
}

/** [계약확정] 이 막혔을 때 폼이 이 섹션으로 화면을 옮긴다 — 눈이 가야 고칠 수 있다. */
export const SECTION_DOCS_ID = 'contract-section-docs';

export function SectionDocs({
  companyId,
  memberType,
  memberTypeName,
  disabled: frozen,
  draftable,
  onNotify,
  onBizReg,
  pending,
  onPending,
  onAttached,
  alert,
}: Props) {
  const [files, setFiles] = useState<CompanyFile[]>([]);
  const [loading, setLoading] = useState(false);
  /** 지금 무엇을 처리 중인가. 같은 카드의 버튼만 죽인다 — 전체를 잠그면 답답하다. */
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});

  const shown = visibleDocs(memberType);
  const byPurpose = new Map(files.map((f) => [f.purpose, f]));
  // ★ **보이는 칸만** 센다. 법인등기부등본이 숨겨진 회사에 그 파일이 남아 있어도
  //   「1/3」이 「1/4」로 보이지 않는다. 아래 「규칙 밖」 칸도 이 수에 넣지 않는다 —
  //   채워야 할 서류가 아니라 **치워야 할 서류**다.
  const done = shown.filter((d) => byPurpose.has(d.purpose)).length;

  /**
   * ★★ 지금 회원구분에서는 안 보이는데 **이미 붙어 있는** 서류.
   *
   *    법인으로 등기부등본을 올린 뒤 개인사업자로 바꾸면 생긴다. 예전에는 `shown` 만
   *    그려서 이 서류가 **보이지도 지워지지도 않았다** — 운영자에게는 없는 셈인데
   *    스토리지에는 남아 있었다. 그려 주고 **지울 수 있게** 한다(2026-10-04).
   *
   * ★ 붙들고 있는 파일(`pending`)도 함께 센다. 고른 뒤 회원구분을 바꾸면 똑같이
   *   취소할 칸이 사라지고, 저장할 때 서버가 거절해서 영문 모를 오류만 뜬다.
   */
  const offRule = offRuleDocs(memberType, [
    ...files.map((f) => f.purpose),
    ...Object.keys(pending),
  ]);
  /** 왜 규칙 밖인지 — 뱃지만 달면 이유를 알 수 없다. */
  const offRuleReason = offRuleNote(memberTypeName);

  /** 그릴 칸 전부. 규칙 안이 먼저고 규칙 밖이 뒤다 — 할 일과 치울 것을 섞지 않는다. */
  const cards: { def: DocDef; off: boolean }[] = [
    ...shown.map((def) => ({ def, off: false })),
    ...offRule.map((def) => ({ def, off: true })),
  ];

  /** 받은 목록을 화면과 폼에 함께 반영한다 — 두 곳이 갈리면 확정 게이트가 헛돈다. */
  const take = useCallback(
    (list: CompanyFile[]) => {
      setFiles(list);
      onAttached(list.map((f) => f.purpose).filter(isFilePurpose));
    },
    [onAttached],
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/files`, { cache: 'no-store' });
      const body = (await res.json()) as { files?: CompanyFile[]; message?: string };
      if (!res.ok) throw new Error(body.message ?? '첨부 서류를 불러오지 못했습니다');
      take(body.files ?? []);
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, onNotify, take]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 고른 파일을 처리한다. **화면에서 먼저 거른다** — 서버도 같은 함수로 다시 거른다.
   *
   * ★ 회사가 **없으면** 올리지 못한다(첨부는 회사에 붙는다). 그래도 여기서 멈추지
   *   않는다 — 사업자등록증이면 **판독은 지금 한다.** 판독이 가장 쓸모 있는 순간이
   *   섹션 1 이 통째로 비어 있는 그때이기 때문이다. 파일은 폼이 붙들었다가
   *   첫 저장 직후에 첨부로 올린다.
   */
  const upload = async (purpose: FilePurpose, file: File) => {
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

    if (!companyId) {
      onPending(purpose, file);
      if (purpose !== 'BIZ_REG') {
        onNotify('저장할 때 함께 첨부됩니다');
        return;
      }
      setBusy(purpose);
      try {
        const res = await fetch('/api/contracts/ocr-biz-reg', {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file,
        });
        const body = (await res.json()) as { bizReg?: BizRegFields | null; message?: string };
        if (!res.ok) throw new Error(body.message ?? '사업자등록증을 읽지 못했습니다');
        const applied = body.bizReg ? onBizReg(body.bizReg) : 0;
        onNotify(
          applied > 0
            ? `${applied}개 항목을 불러왔습니다. 확인해 주세요 · 저장할 때 함께 첨부됩니다`
            : '읽어 낸 항목이 없습니다. 저장할 때 함께 첨부됩니다',
        );
      } catch (err) {
        // ★ 판독이 실패해도 **붙들어 둔 파일은 그대로다.** 저장하면 첨부는 된다.
        onNotify(`${(err as Error).message} · 저장할 때 첨부는 됩니다`);
      } finally {
        setBusy(null);
      }
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
      const body = (await res.json()) as {
        replaced?: boolean;
        message?: string;
        /** 사업자등록증일 때만 온다. 판독이 안 됐으면 `null`. */
        bizReg?: BizRegFields | null;
      };

      /*
       * ★★ **판독 결과를 먼저 얹는다 — 첨부가 실패했더라도.**
       *    둘은 한 번의 업로드로 같이 돌지만 서로의 실패에 끌려가지 않는다.
       *    첨부가 실패했는데 판독은 끝난 경우, 그 값을 버리면 운영자가 같은 파일을
       *    다시 올려 같은 판독을 또 시켜야 한다(`routes/files.ts` 와 같은 판단).
       */
      const applied = body.bizReg ? onBizReg(body.bizReg) : 0;

      if (!res.ok) throw new Error(body.message ?? '파일을 올리지 못했습니다');

      // 한 번의 동작이니 문구도 한 줄이다 — 토스트 두 개가 겹쳐 뜨면 뒤엣것만 읽힌다.
      const attached = body.replaced ? '기존 파일을 교체했습니다' : '첨부했습니다';
      onNotify(applied > 0 ? `${attached} · ${applied}개 항목을 불러왔습니다. 확인해 주세요` : attached);
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
      take(body.files ?? []);
      const fresh = (body.files ?? []).find((f) => f.purpose === purpose);
      if (!fresh?.url) throw new Error('파일 주소를 받지 못했습니다. 잠시 후 다시 시도해 주세요');
      window.open(fresh.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * ★ 붙들고 있는 파일도 「있는 것」으로 센다. 고르자마자 「사업자등록증이 필요합니다」가
   *   그대로 떠 있으면, 방금 고른 것이 무시된 것처럼 읽힌다.
   */
  const bizMissing =
    docRuleFor('BIZ_REG', memberType).required && !byPurpose.has('BIZ_REG') && !pending.BIZ_REG;

  return (
    <section className={styles.section} id={SECTION_DOCS_ID}>
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
        /*
         * ★ 버튼을 죽이지 않는다. 첨부는 입주사에 붙으므로 **지금 올릴 수는 없지만**,
         *   파일을 고르는 것까지 막으면 사업자등록증으로 섹션 1 을 채울 수가 없다 —
         *   판독이 가장 쓸모 있는 순간이 바로 이 빈 화면이다.
         *   고른 파일은 폼이 붙들었다가 첫 저장 직후에 올린다.
         */
        <p className={styles.sectionNote}>
          아직 입주사가 없어 지금은 저장되지 않습니다. 고른 파일은 [임시저장] 할 때 함께 첨부됩니다.
          사업자등록증은 고르는 즉시 읽어 회사 기본정보를 채웁니다.
        </p>
      ) : null}

      <div className={styles.docList}>
        {cards.map(({ def, off }) => {
          const rule = docRuleFor(def.purpose, memberType);
          const file = byPurpose.get(def.purpose);
          /** 아직 회사가 없어 붙들고 있는 파일. 저장할 때 올라간다. */
          const waiting = pending[def.purpose];
          const working = busy === def.purpose;
          const locked = frozen || working;

          return (
            <div className={styles.docCard} key={def.purpose}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className={styles.docName}>{def.name}</span>
                  {/* ★ 규칙 밖에는 「선택」을 달지 않는다 — 올릴 수 있다는 말로 읽힌다. */}
                  {off ? (
                    <span className={`${styles.badge} ${styles.badgeDanger}`}>규칙 밖</span>
                  ) : (
                    <span
                      className={`${styles.badge} ${rule.required ? styles.badgeDanger : styles.badgeNeutral}`}
                    >
                      {rule.required ? '필수' : '선택'}
                    </span>
                  )}
                  {file ? (
                    <span className={`${styles.badge} ${styles.badgeOk ?? styles.badgeNeutral}`}>
                      <Icon name="circle-check" size={12} />
                      등록됨
                    </span>
                  ) : null}
                  {/* ★ 「등록됨」과 다른 말이다. 아직 저장된 것이 아니다. */}
                  {!file && waiting ? (
                    <span className={`${styles.badge} ${styles.badgeNeutral}`}>저장 시 첨부됨</span>
                  ) : null}
                </div>
                <div className={styles.docDesc}>
                  {file
                    ? `${file.originalName} · ${sizeLabel(file.fileSize)}`
                    : waiting
                      ? `${waiting.name} · ${sizeLabel(waiting.size)}`
                      : def.desc}
                </div>
                {/* ★ 왜 규칙 밖인지 한 줄. 이유 없이 「규칙 밖」만 뜨면 손을 못 댄다. */}
                {off ? <div className={styles.docDesc}>{offRuleReason}</div> : null}
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

                {/* 붙들고 있는 파일은 저장 전이라 「삭제」가 아니라 「취소」다 — 지울 것이 아직 없다. */}
                {!file && waiting && !frozen ? (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    disabled={working}
                    onClick={() => onPending(def.purpose, null)}
                  >
                    <Icon name="x" size={16} />
                    취소
                  </button>
                ) : null}

                {/*
                  ★★ 규칙 밖 칸에는 **올리기를 두지 않는다.** 서버가 어차피 거절하지만
                     (`rejectUpload`), 누를 수 있는 버튼을 두고 거절하는 것은 안내가
                     아니라 함정이다. 여기서 할 수 있는 일은 치우는 것뿐이다.
                */}
                {!frozen && !off ? (
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
                      {working ? '처리 중…' : file || waiting ? '교체' : '파일 선택'}
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

      {/*
        ★ 확정이 막힌 이유. 폼이 [계약확정] 에서 막고 이 섹션으로 화면을 옮긴다 —
          머리말의 빨간 줄만으로는 **어디를 고쳐야 하는지**가 보이지 않는다.
      */}
      {alert ? (
        <div className={`${styles.notice} ${styles.noticeDanger}`} role="alert">
          <span className={styles.noticeIcon}>
            <Icon name="circle-alert" size={16} />
          </span>
          <span>{alert}</span>
        </div>
      ) : null}

      {/*
        ★ 가등록 안내는 그대로 둔다 — **임시저장까지는 맞는 말이다.** 사업자등록
          신청 중인 회사는 계약대기로 두고 나중에 등록증을 받는다.
        ★ 다만 「확정에는 필요하다」를 덧붙였다. 이 문구만 읽으면 «없어도 계약이
          끝까지 간다»로 읽히는데, 이제 확정에서 실제로 막힌다 — 안내와 동작이
          어긋나면 안내를 믿지 않게 된다.
        ★★ **재계약에서는 뒷문장이 달라진다.** 그 화면에는 [임시저장] 이 없다.
      */}
      {bizMissing ? (
        <div className={`${styles.notice} ${styles.noticeWarning}`}>
          <span className={styles.noticeIcon}>
            <Icon name="circle-alert" size={16} />
          </span>
          <span>
            사업자등록증이 없으면 가등록 상태로 계약이 진행됩니다. 발급 후 반드시 제출해 주세요.
            {draftable ? (
              <strong> 계약 확정에는 필요합니다 — 그때까지는 [임시저장] 으로 둡니다.</strong>
            ) : (
              <strong> 재계약은 [계약확정] 뿐이라 서류가 갖춰져야 저장됩니다.</strong>
            )}
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
