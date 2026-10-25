'use client';

/**
 * 저장하지 않고 떠날 때 확인 — 세무 화면용.
 *
 *   · 화면 안 이동(사이드바 · 화면 안 링크) — 시안 모양 확인 창 [돌아가기] [나가기](`TaxConfirmDialog`)
 *   · 새로고침 · 창 닫기 — 브라우저 기본 확인(`beforeunload`). 브라우저는 문구를 바꾸게 두지 않는다
 *
 * ★ 화면 안의 링크는 클라이언트 전환이라 `beforeunload` 가 울리지 않는다. 그래서 문서 맨 위에서
 *   **잡는 단계(capture)** 로 링크 누름을 먼저 본다 — 법무 화면(`DocFormSettingsView`)과 같은 길이다.
 *   다른 점은 `window.confirm` 대신 시안의 확인 창을 띄우고, [나가기]면 그 주소로 보낸다는 것뿐이다.
 * ★ 새 탭(가운데 단추 · Ctrl/⌘/Shift/Alt · target=_blank)은 이 화면을 떠나는 것이 아니라 막지 않는다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function useLeaveGuard(dirty: boolean): {
  /** 확인 창을 띄울 주소 — null 이면 창이 없다. */
  pendingHref: string | null;
  stay: () => void;
  leave: () => void;
} {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self')) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(a.href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const stay = useCallback(() => setPendingHref(null), []);
  const leave = useCallback(() => {
    if (!pendingHref) return;
    const url = new URL(pendingHref, window.location.href);
    setPendingHref(null);
    // 같은 출처면 화면 안 이동, 아니면 그 주소로(바깥 링크)
    if (url.origin === window.location.origin) router.push(url.pathname + url.search + url.hash);
    else window.location.assign(url.href);
  }, [pendingHref, router]);

  return { pendingHref, stay, leave };
}
