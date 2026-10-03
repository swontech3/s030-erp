'use client';

/**
 * 건물·층 첨부 칸 — **화면코드가 없다.** 팝업 p1·p2 **안의 칸**이다(2026-10-03).
 *
 * =============================================================================
 * ★★★ 계약 폼의 첨부 카드와 **같은 모양·같은 기계**다
 * =============================================================================
 * 모양: `contract-form.module.css` 의 `docCard`·`docName`·`docDesc`·`docActions` 를
 *       그대로 쓴다(`SectionDocs` 가 쓰는 그 클래스들). 같은 카드를 두 번 정의하면
 *       한쪽만 고쳐지는 날이 온다 — `ModalShell` 과 같은 이유다.
 * 기계: `tb_cm_file` · 서명 URL · 종류당 한 장. 서버 쪽은 계약 서류와 한 코드다.
 *
 * =============================================================================
 * ★★ 아직 저장되지 않은 건물·층에는 **붙일 곳이 없다** — 붙들고 있는다
 * =============================================================================
 * 첨부는 `target_id` 가 있어야 붙는다. 신규 등록 창에는 그 값이 없다. 그래서 고른
 * 파일을 **폼이 붙들고**(`pending`) 저장 직후에 올린다 — `SectionDocs` 가 회사가 없을 때
 * 하는 것과 같은 방식이다. 버튼을 죽여 두지 않는다: 왜 안 되는지 모르게 된다.
 *
 * =============================================================================
 * ★★ 미리보기 주소는 **만료된다. 담아 두지 않는다**
 * =============================================================================
 * 눌렀을 때 **그 순간 목록을 다시 받아** 새 주소로 연다. 레거시는 이 주소를 DB 에
 * 저장해서 전부 죽은 링크가 됐다(결함 ②).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALLOWED_MIME_TYPES, MAX_FILE_MB } from '@swonbiz/shared/domain/contract-files';
import {
  FACILITY_DOC,
  FACILITY_PURPOSE,
  FILE_TARGET_BUILDING,
  FILE_TARGET_FLOOR,
  rejectFacilityUpload,
  type FacilityTarget,
} from '@swonbiz/shared/domain/facility-files';
import { Icon } from '@/components/ds';
import {
  FacilityError,
  loadFacilityFiles,
  removeFacilityFile,
  uploadFacilityFile,
  type AttachKind,
  type FacilityFile,
} from './facility-model';
import { cf } from './ModalShell';
import styles from './facility.module.css';

/** 주소 조각 ↔ `target_type`. 둘 다 필요하다 — 하나는 경로, 하나는 판정이다. */
const TARGET_OF: Readonly<Record<AttachKind, FacilityTarget>> = {
  buildings: FILE_TARGET_BUILDING,
  floors: FILE_TARGET_FLOOR,
};

interface Props {
  kind: AttachKind;
  /** `null` 이면 아직 저장되지 않았다 — 붙일 대상이 없다. */
  targetId: string | null;
  /** 아직 대상이 없어 붙들고 있는 파일. 저장 직후 폼이 올린다. */
  pending: File | null;
  onPending: (file: File | null) => void;
}

export function AttachField({ kind, targetId, pending, onPending }: Props) {
  const target = TARGET_OF[kind];
  const doc = FACILITY_DOC[target];
  const purpose = FACILITY_PURPOSE[target];

  const [file, setFile] = useState<FacilityFile | null>(null);
  const [busy, setBusy] = useState(false);
  /** 이 칸에서만 쓰는 한 줄 안내. 모달 머리의 오류 줄과 섞지 않는다. */
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!targetId) return;
    try {
      const { files } = await loadFacilityFiles(kind, targetId);
      setFile(files.find((f) => f.purpose === purpose) ?? null);
    } catch (err) {
      setNote(err instanceof FacilityError ? err.message : '첨부를 불러오지 못했습니다');
    }
  }, [kind, purpose, targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 고른 파일. ★ 화면에서 먼저 거른다 — 서버가 **같은 함수**로 다시 거른다. */
  async function pick(picked: File) {
    const reason = rejectFacilityUpload({
      target,
      purpose,
      mimeType: picked.type,
      size: picked.size,
    });
    if (reason) {
      setNote(reason);
      return;
    }

    if (!targetId) {
      onPending(picked);
      setNote('저장할 때 함께 첨부됩니다');
      return;
    }

    setBusy(true);
    setNote(null);
    try {
      const res = await uploadFacilityFile(kind, targetId, picked);
      setNote(res.replaced ? '기존 파일을 교체했습니다' : '첨부했습니다');
      await load();
    } catch (err) {
      setNote(err instanceof FacilityError ? err.message : '파일을 올리지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!targetId || !file) return;
    setBusy(true);
    setNote(null);
    try {
      await removeFacilityFile(kind, targetId, file.fileId);
      setFile(null);
      setNote('첨부를 삭제했습니다');
    } catch (err) {
      setNote(err instanceof FacilityError ? err.message : '파일을 지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** ★ 열기 전에 **목록을 다시 받는다.** 창을 열어 둔 채 5분이 지나면 주소가 죽어 있다. */
  async function open() {
    if (!targetId) return;
    setBusy(true);
    setNote(null);
    try {
      const { files } = await loadFacilityFiles(kind, targetId);
      const fresh = files.find((f) => f.purpose === purpose) ?? null;
      setFile(fresh);
      if (!fresh?.url) throw new FacilityError('파일 주소를 받지 못했습니다. 잠시 후 다시 시도해 주세요', 0, false);
      window.open(fresh.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setNote(err instanceof FacilityError ? err.message : '파일을 열지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.section}>
      <p className={styles.sectionTitle}>{doc.name}</p>

      <div className={cf.docCard}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className={cf.docName}>{doc.name}</span>
            {/* ★ 둘 다 선택이다 — 없어도 저장된다. 「필수」 뱃지를 쓰지 않는다. */}
            <span className={`${cf.badge} ${cf.badgeNeutral}`}>선택</span>
            {file ? (
              <span className={`${cf.badge} ${cf.badgeOk ?? cf.badgeNeutral}`}>
                <Icon name="circle-check" size={12} />
                등록됨
              </span>
            ) : null}
            {!file && pending ? (
              /* ★ 「등록됨」과 다른 말이다. 아직 저장된 것이 아니다. */
              <span className={`${cf.badge} ${cf.badgeNeutral}`}>저장 시 첨부됨</span>
            ) : null}
          </div>
          <div className={cf.docDesc}>
            {file
              ? `${file.originalName} · ${sizeLabel(file.fileSize)}`
              : pending
                ? `${pending.name} · ${sizeLabel(pending.size)}`
                : doc.desc}
          </div>
        </div>

        <div className={cf.docActions}>
          {file ? (
            <>
              <button
                type="button"
                className={`${cf.btn} ${cf.btnGhost}`}
                disabled={busy}
                onClick={() => void open()}
              >
                <Icon name="eye" size={16} />
                보기
              </button>
              <button
                type="button"
                className={`${cf.btn} ${cf.btnGhost}`}
                disabled={busy}
                onClick={() => void remove()}
              >
                <Icon name="trash-2" size={16} />
                삭제
              </button>
            </>
          ) : null}

          {/* 저장 전이라 「삭제」가 아니라 「취소」다 — 지울 것이 아직 없다. */}
          {!file && pending ? (
            <button
              type="button"
              className={`${cf.btn} ${cf.btnGhost}`}
              disabled={busy}
              onClick={() => {
                onPending(null);
                setNote(null);
              }}
            >
              <Icon name="x" size={16} />
              취소
            </button>
          ) : null}

          <input
            ref={input}
            type="file"
            hidden
            accept={ALLOWED_MIME_TYPES.join(',')}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              // ★ 값을 즉시 비운다. 안 비우면 **같은 파일을 두 번 고를 수 없다**(change 가 안 뜬다).
              e.target.value = '';
              if (picked) void pick(picked);
            }}
          />
          <button
            type="button"
            className={`${cf.btn} ${cf.btnGhost}`}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Icon name="upload" size={16} />
            {busy ? '처리 중…' : file || pending ? '교체' : '파일 선택'}
          </button>
        </div>
      </div>

      <div className={cf.docFoot}>
        JPG, PNG, PDF 형식 · 최대 {MAX_FILE_MB}MB
        {note ? ` · ${note}` : ''}
      </div>
    </div>
  );
}

/** 「1.2MB」 / 「480KB」. `SectionDocs` 와 같은 표기다. */
function sizeLabel(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '크기 미상';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
