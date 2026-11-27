/**
 * 삐용 **화면** 주소 — 웹(브라우저)이 사람을 삐용 화면으로 보낼 때 쓴다.
 *
 * ★ `NEXT_PUBLIC_BBIYONG_WEB_URL` 을 **여기서 직접 읽는다** — 워크스페이스 패키지(shared) 안에서
 *   NEXT_PUBLIC 치환이 되는지 Next 문서에 없다(`@swonbiz/shared` constants.ts 주석).
 * ★ **기본값을 두지 않는다**(결정 2026-10-05). 비면 링크 · 보내기를 하지 않는다 — 짐작한 주소로 보내지 않는다.
 * ★★ 빌드 때 박힌다 — 계통을 바꾸면 web 을 다시 빌드한다.
 */
import { BBIYONG } from '@swonbiz/shared';

/** 삐용 화면 주소(끝 `/` 뗌). 비어 있을 수 있다 */
export const BBIYONG_WEB_URL = (process.env.NEXT_PUBLIC_BBIYONG_WEB_URL ?? '').replace(/\/+$/, '');

/**
 * 삐용 로그인 화면 — ERP 랜딩 「로그인」과 `/login` 이 사람을 보내는 곳(2026-11-27 · 가지 erp-login-redirect).
 * 주소가 비면 '' — 부르는 쪽이 지금처럼 ERP 로그인 화면을 쓴다.
 */
export const BBIYONG_SIGN_IN_URL = BBIYONG_WEB_URL ? `${BBIYONG_WEB_URL}${BBIYONG.SIGN_IN_SCREEN_PATH}` : '';
