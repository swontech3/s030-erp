/**
 * 앱 안 판정 — 앱 1단계 5-나 (대표 지시 2026-11-07)
 *
 * 앱(s02-app) 의 ERP 웹뷰(`pages/common/webview/ErpWebView.js`)는 사용자 에이전트(UA) 끝에
 * 꼬리표 `SwonBizApp` 을 붙인다(`applicationNameForUserAgent`). ERP 는 **서버에서** UA 를 읽어
 * 「앱 안」을 안다 — 그래서 첫 화면부터 셸을 감춘 채로 그린다(깜빡임 없음).
 *
 * ★★ **화면 모양에만 쓴다. 권한 판정에 쓰지 않는다.** UA 는 누구나 꾸며 보낼 수 있다.
 *    꾸며 보내 봐야 바뀌는 것은 모양뿐이고, 입장 · 처리는 지금처럼 세션 · 역할이 막는다.
 * ★ 꼬리표 이름을 바꾸면 앱 `ErpWebView.js` 의 `APP_UA_TAG` 도 같이 바꾼다(두 곳이 같아야 한다).
 */

/** 앱 웹뷰가 UA 끝에 붙이는 꼬리표 */
export const APP_UA_TAG = 'SwonBizApp';

/** 꼬리표가 **낱말 하나로** 있는가 — 앞뒤가 공백이거나 끝이고, 뒤에 `/판번호` 는 붙어도 된다 */
const TAG_RE = new RegExp(`(^|\\s)${APP_UA_TAG}(/[\\w.]+)?(?=\\s|$)`);

export function isAppUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === 'string' && TAG_RE.test(ua);
}

/**
 * 셸(왼쪽 메뉴 · 접기 · 위 띠)을 감추는가.
 * ★ 다른 화면(iframe) 안일 때 감추던 것(`embedded`, 2026-10-22)과 **같은 결과**를 앱 안에서도 낸다.
 */
export function shellHidden({ inApp, embedded }: { inApp: boolean; embedded: boolean }): boolean {
  return inApp || embedded;
}
