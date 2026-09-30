/**
 * 기동 배너 — 잘못된 계통에 붙은 것을 **기동 로그에서 즉시** 알아채는 것이 전부다.
 *
 * ★ 2026-09-30: 판별 근거가 **포트에서 `BBIYONG_SYSTEM` 으로** 바뀌었다. 개발계
 *   `192.168.0.22:8082` · 가동계 `192.168.0.14:8082` — 포트가 같아서 포트로는 갈 수 없다.
 *   그래서 이 시험은 **같은 주소에 계통만 다르게 넣어** 배너가 주소를 보지 않는다는
 *   것을 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { bbiyongBanner } from './bbiyongBanner.ts';

const text = (lines: string[]) => lines.join('\n');

describe('bbiyongBanner', () => {
  it('개발계는 한 줄이다', () => {
    const out = bbiyongBanner({ mock: false, baseUrl: 'http://192.168.0.22:8082', system: 'dev' });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('http://192.168.0.22:8082');
    expect(out[0]).toContain('개발계');
  });

  it('★ 가동계는 눈에 띄게 경고한다', () => {
    const out = bbiyongBanner({ mock: false, baseUrl: 'https://192.168.0.14:8082', system: 'prod' });
    expect(out.length).toBeGreaterThan(3); // 한 줄로 흘려보내지 않는다
    expect(text(out)).toContain('가동계');
    expect(text(out)).toContain('★★');
    // 되돌리는 방법을 같이 알려준다 — 계통과 주소는 한 쌍이다.
    expect(text(out)).toContain('BBIYONG_SYSTEM');
  });

  it('개발계 배너에는 "가동계" 라는 말이 없다 — 눈으로 가르는 기준이다', () => {
    expect(
      text(bbiyongBanner({ mock: false, baseUrl: 'http://192.168.0.22:8082', system: 'dev' })),
    ).not.toContain('가동계');
  });

  it('★★ 포트가 같아도 계통이 갈린다 — 주소를 보고 추측하지 않는다', () => {
    const url = 'http://10.0.0.9:8082';
    expect(text(bbiyongBanner({ mock: false, baseUrl: url, system: 'dev' }))).toContain('개발계');
    expect(text(bbiyongBanner({ mock: false, baseUrl: url, system: 'prod' }))).toContain('가동계');
  });

  it('계통이 없으면 미상으로 알린다 (조용히 개발계로 취급하지 않는다)', () => {
    const out = bbiyongBanner({ mock: false, baseUrl: 'http://10.0.0.9:9999', system: null });
    expect(text(out)).toContain('계통 미상');
    expect(text(out)).not.toContain('(개발계)');
  });

  it('mock 이고 주소도 없으면 mock 이라고만 찍는다', () => {
    const out = bbiyongBanner({ mock: true, baseUrl: null, system: null });
    expect(text(out)).toContain('MOCK');
    expect(text(out)).not.toContain('http');
  });

  it('★ mock 이어도 「실연동 시 붙을 곳」과 계통을 같이 찍는다 — 끄기 전에 보여야 한다', () => {
    const dev = text(bbiyongBanner({ mock: true, baseUrl: 'http://192.168.0.22:8082', system: 'dev' }));
    expect(dev).toContain('MOCK');
    expect(dev).toContain('http://192.168.0.22:8082');
    expect(dev).toContain('개발계');

    const prod = text(bbiyongBanner({ mock: true, baseUrl: 'https://192.168.0.14:8082', system: 'prod' }));
    expect(prod).toContain('가동계');
  });

  it('깨진 URL 이어도 배너 때문에 기동이 죽지 않는다', () => {
    expect(() => bbiyongBanner({ mock: false, baseUrl: 'not a url', system: 'dev' })).not.toThrow();
  });
});
