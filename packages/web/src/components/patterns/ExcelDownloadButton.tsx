'use client';

/**
 * ERP 공통 [엑셀 내려받기] 버튼(세무 1-3, 2026-10-27) — 결과서 세무 0-7.
 *
 * ★ 파일은 서버가 만든다(api `lib/xlsxExport.ts`). 이 버튼은 Next 중계(`forwardGetFile`)로 받아 그대로 저장시킨다.
 *   이름은 서버가 준 내려받기 이름(Content-Disposition filename*)을 쓴다.
 * ★ 링크로 열지 않고 받아서 저장한다 — 링크로 열면 실패(4xx)가 JSON 화면으로 보인다. 실패 문구는 `onError` 로 넘긴다.
 * ★ 모양은 부르는 화면이 `className` 으로 준다(세무 화면은 세무 버튼 모양). 공용 아이콘 집합에 download 가 없어
 *   save 로 대신했다(공용 아이콘 파일은 고치지 않는다 — 결정 2026-10-27).
 */
import { useState } from 'react';
import { Icon } from '@/components/ds';

/** `attachment; filename="…"; filename*=UTF-8''…` → 파일 이름. filename* 를 먼저 본다. */
function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim());
    } catch {
      // 아래 filename 으로
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain ? plain[1]! : null;
}

interface Props {
  /** 내려받을 주소 — 화면에 걸린 거르기를 그대로 담는다. */
  href: string;
  className?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
}

export function ExcelDownloadButton({ href, className, disabled = false, onError }: Props) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(href, { cache: 'no-store' });
      if (!res.ok) {
        let message = '엑셀을 내려받지 못했습니다';
        try {
          const body = (await res.json()) as { message?: unknown };
          if (typeof body.message === 'string') message = body.message;
        } catch {
          // 본문이 없을 수 있다
        }
        onError?.(message);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameOf(res.headers.get('content-disposition')) ?? 'download.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      onError?.('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={className} disabled={disabled || busy} onClick={download}>
      <Icon name="save" size={14} />
      엑셀 내려받기
    </button>
  );
}
