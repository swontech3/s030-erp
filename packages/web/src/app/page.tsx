/** @screen s030500010 랜딩 · 050 공개 화면 · 0차 */

/**
 * 랜딩 — `swonbiz.com/`.
 *
 * 시안: design/landing-hero/LandingHero.dc.html (9블록)
 *   ★ 명세(.md)는 **없다.** 랜딩은 `design/handoff/` 1차 인계 범위 밖이다
 *     (`handoff/README.md` 「제외 (2차 이후)」 · 「3차 이후 … 별도 랜딩·신청 폼」).
 *     그래서 치수·문구는 시안 마크업에서 글자 그대로 옮겼고, 시안에 없던 결정
 *     (문의 연결 · 접는 규칙 · 지운 링크)은 `doc/DESIGN_HANDOFF_DIFF.md` §P 에 적었다.
 *
 * =============================================================================
 * ★★★ 로그인이 없다 — 050 공개 화면
 * =============================================================================
 * `(erp)` 그룹 **밖**이다. 셸도 사이드바도 세션도 없다. `proxy.ts` 의 matcher 와
 * `next.config.ts` 의 `PROTECTED_PATHS` 에 `/` 가 없어 로그인으로 튕기지 않는다.
 * ★ 서버에서 데이터를 읽지 않는다 — 전부 시안 고정값이다. 그래서 공개해도 흘릴 것이 없다.
 *
 * ★★ 머리·바닥은 **문의상담의 `PublicShell` 이 아니라 랜딩 전용**이다(2026-10-01 결정).
 *    로고 이미지·워드마크·사업자 정보·대표번호는 같은 것을 쓴다 — 넘어갔을 때 다른
 *    사이트로 보이면 안 된다. 자세한 비교는 `LandingHeader.tsx` 머리말.
 */
import type { Metadata } from 'next';
import { LandingHeader } from '@/features/landing/LandingHeader';
import { LandingFooter } from '@/features/landing/LandingFooter';
import { HeroSection } from '@/features/landing/HeroSection';
import { ServicesSection } from '@/features/landing/ServicesSection';
import { ErpSection } from '@/features/landing/ErpSection';
import { SpacesSection } from '@/features/landing/SpacesSection';
import { PricingSection } from '@/features/landing/PricingSection';
import { ProcessSection } from '@/features/landing/ProcessSection';
import { FaqSection } from '@/features/landing/FaqSection';
import { LocationSection } from '@/features/landing/LocationSection';
import { FinalCta } from '@/features/landing/FinalCta';
import styles from '@/features/landing/landing.module.css';

export const metadata: Metadata = {
  title: 'SwonBiz — 법인설립부터 세무까지 AI가 함께하는 공유오피스',
  description:
    '강남 삼성동 12년째 공유오피스. 등기 서류 작성, 세금계산서 발행, 경비 관리까지 입주와 동시에 켜지는 운영 시스템을 제공합니다.',
};

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <LandingHeader />
      {/* 9블록 — 시안 순서 그대로 */}
      <HeroSection />
      <ServicesSection />
      <ErpSection />
      <SpacesSection />
      <PricingSection />
      <ProcessSection />
      <FaqSection />
      <LocationSection />
      <FinalCta />
      <LandingFooter />
    </div>
  );
}
