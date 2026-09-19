'use client';

/**
 * 카카오(다음) 우편번호 검색.
 *
 * 스크립트를 처음 쓸 때 한 번만 내려받고, `open()` 이 팝업을 띄워 고른 주소를 돌려준다.
 * **키가 필요 없다** — 스크립트만 붙이면 된다.
 *
 * ★ 스크립트를 **미리 받지 않는다.** 계약 폼을 여는 사람 대부분은 주소를 다시 고치지
 *   않는다. 버튼을 누른 그때 받는다(`open()` 안에서 `ensure()`).
 *
 * ★ **`alert` 을 쓰지 않는다.** 레거시(`S-WonERP/src/hooks/useKakaoPostcode.ts`)는
 *   로딩 중이면 `alert("로딩 중입니다")` 로 끝났는데, 그러면 사용자가 다시 누르는 것
 *   말고 할 일이 없다. 여기서는 **기다렸다가 열고**, 정말 실패했을 때만 호출자에게
 *   알린다 — 이 화면에는 토스트가 있다(`onStub` 과 같은 자리).
 */
import { useCallback, useRef } from 'react';

const SCRIPT_SRC = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
const SCRIPT_ID = 'daum-postcode';

/** 팝업이 돌려주는 값 중 우리가 쓰는 것. */
export interface PostcodeResult {
  /** 5자리 우편번호. */
  zipCode: string;
  /** 도로명 주소. 없으면 지번 주소다. */
  address: string;
}

interface DaumPostcodeData {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
}

interface DaumNamespace {
  Postcode: new (options: { oncomplete: (data: DaumPostcodeData) => void }) => { open: () => void };
}

declare global {
  interface Window {
    daum?: DaumNamespace;
  }
}

/**
 * 스크립트를 한 번만 받는다.
 *
 * ★ 모듈 수준에 약속을 담아 둔다. 훅 인스턴스마다 받으면 버튼이 여러 개인 화면에서
 *   같은 스크립트를 중복으로 내려받는다. 이미 붙어 있는 태그(`SCRIPT_ID`)도 다시 쓴다 —
 *   Next.js 가 클라이언트 전환으로 같은 화면을 다시 그릴 때가 있다.
 */
let loading: Promise<DaumNamespace> | null = null;

function ensure(): Promise<DaumNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저가 아니다'));
  if (window.daum) return Promise.resolve(window.daum);
  if (loading) return loading;

  loading = new Promise<DaumNamespace>((resolve, reject) => {
    const fail = () => {
      // ★ 실패하면 약속을 비운다. 안 그러면 한 번 실패한 뒤로 버튼이 영영 죽는다 —
      //   잠깐 끊긴 네트워크로 화면 하나가 못 쓰게 되는 것은 과한 대가다.
      loading = null;
      reject(new Error('우편번호 스크립트를 내려받지 못했다'));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => (window.daum ? resolve(window.daum) : fail()), { once: true });
    script.addEventListener('error', fail, { once: true });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loading;
}

export interface KakaoPostcode {
  /**
   * 우편번호 팝업을 연다. 스크립트가 아직 없으면 받고 나서 연다.
   *
   * ★ 취소하면 **아무 일도 일어나지 않는다.** `oncomplete` 는 고른 경우에만 불린다 —
   *   취소를 실패로 다루면 값이 지워진다.
   */
  open: (onPick: (result: PostcodeResult) => void) => void;
}

/**
 * @param onError 스크립트를 못 받았을 때. 화면의 토스트에 연결한다.
 */
export function useKakaoPostcode(onError: (message: string) => void): KakaoPostcode {
  // ★ 두 번 눌렀을 때 팝업이 두 개 뜨지 않게 막는다. 스크립트를 받는 동안 누르기 쉽다.
  const opening = useRef(false);

  const open = useCallback(
    (onPick: (result: PostcodeResult) => void) => {
      if (opening.current) return;
      opening.current = true;

      ensure()
        .then((daum) => {
          new daum.Postcode({
            oncomplete: (data) =>
              onPick({
                zipCode: data.zonecode,
                // 도로명이 없는 주소가 있다. 그때는 지번을 쓴다 — 빈 칸으로 두지 않는다.
                address: data.roadAddress || data.jibunAddress,
              }),
          }).open();
        })
        .catch(() => onError('주소 검색을 열지 못했습니다. 잠시 후 다시 시도해 주세요.'))
        .finally(() => {
          opening.current = false;
        });
    },
    [onError],
  );

  return { open };
}
