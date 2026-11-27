/** @screen s030000010 로그인 · 000 공통 · 1차 */

/**
 * 로그인 — 서버 쪽 껍데기. 화면 본체는 `LoginView.tsx` 다.
 *
 * ★ 2026-11-27 (가지 erp-login-redirect) — 혼자 열린 브라우저는 삐용 로그인 화면으로 보낸다.
 *   앱 웹뷰는 **지금처럼** 이 화면의 ERP 로그인을 쓴다 — 앱인지는 UA 라 서버에서만 첫 렌더 전에 안다
 *   (`isInApp`, 모양 판정과 같은 규칙). 그래서 여기서 읽어 넘긴다.
 */
import { isInApp } from '@/lib/appClient';
import { LoginView } from './LoginView';

export default async function LoginPage() {
  return <LoginView inApp={await isInApp()} />;
}
