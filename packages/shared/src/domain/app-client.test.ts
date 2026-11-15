/**
 * 앱 안 판정 — 앱 1단계 5-나 (대표 지시 2026-11-07)
 *
 * ★ 앱(s02-app) 웹뷰는 사용자 에이전트(UA) 끝에 꼬리표 `SwonBizApp` 을 붙인다
 *   (`applicationNameForUserAgent`). ERP 는 그 꼬리표 하나로 「앱 안」을 안다.
 * ★ 화면 모양에만 쓴다 — 권한 판정에 쓰지 않는다(UA 는 누구나 꾸며 보낼 수 있다).
 */
import { describe, expect, it } from 'vitest';
import { APP_UA_TAG, isAppUserAgent, shellHidden } from './app-client';

const ANDROID_WV =
  'Mozilla/5.0 (Linux; Android 13; SM-S918N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36';
const IOS_WV = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const PC_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('APP_UA_TAG', () => {
  it('꼬리표 이름은 SwonBizApp — 앱 ErpWebView 의 applicationNameForUserAgent 와 같다', () => {
    expect(APP_UA_TAG).toBe('SwonBizApp');
  });
});

describe('isAppUserAgent', () => {
  it.each([
    ['안드로이드 웹뷰 + 꼬리표', `${ANDROID_WV} SwonBizApp`],
    ['iOS 웹뷰 + 꼬리표', `${IOS_WV} SwonBizApp`],
    ['꼬리표에 판 번호', `${ANDROID_WV} SwonBizApp/1.2.0`],
  ])('%s → 앱 안', (_name, ua) => {
    expect(isAppUserAgent(ua)).toBe(true);
  });

  it.each([
    ['PC 크롬', PC_CHROME],
    ['꼬리표 없는 안드로이드 웹뷰', ANDROID_WV],
    ['꼬리표 없는 iOS 웹뷰', IOS_WV],
    ['앞에 다른 글자가 붙은 낱말', `${PC_CHROME} NotSwonBizApp`],
    ['뒤에 다른 글자가 붙은 낱말', `${PC_CHROME} SwonBizAppX`],
    ['대소문자가 다름', `${PC_CHROME} swonbizapp`],
    ['빈 글', ''],
  ])('%s → 앱 아님', (_name, ua) => {
    expect(isAppUserAgent(ua)).toBe(false);
  });

  it('UA 머리가 없으면(null · undefined) 앱 아님', () => {
    expect(isAppUserAgent(null)).toBe(false);
    expect(isAppUserAgent(undefined)).toBe(false);
  });
});

describe('shellHidden — 왼쪽 메뉴 · 접기 · 위 띠를 감추는가', () => {
  it('앱 안이면 감춘다(iframe 감추기와 같은 결과)', () => {
    expect(shellHidden({ inApp: true, embedded: false })).toBe(true);
  });
  it('다른 화면(iframe) 안이면 감춘다 — 지금 그대로', () => {
    expect(shellHidden({ inApp: false, embedded: true })).toBe(true);
  });
  it('둘 다면 감춘다', () => {
    expect(shellHidden({ inApp: true, embedded: true })).toBe(true);
  });
  it('PC 브라우저(앱 아님 · iframe 아님)면 그대로 보인다', () => {
    expect(shellHidden({ inApp: false, embedded: false })).toBe(false);
  });
});
