/**
 * 기동 배너 — 8080(가동계)과 8082(개발계)는 숫자 하나 차이다.
 * 잘못 붙은 것을 **기동 로그에서 즉시** 알아채는 것이 이 함수의 전부다.
 */
import { describe, it, expect } from 'vitest';
import { bbiyongBanner } from './bbiyongBanner.ts';

const text = (lines: string[]) => lines.join('\n');

describe('bbiyongBanner', () => {
  it('개발계(8082)는 한 줄이다', () => {
    const out = bbiyongBanner({ mock: false, baseUrl: 'http://192.168.0.14:8082' });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('http://192.168.0.14:8082');
    expect(out[0]).toContain('개발계');
  });

  it('★ 가동계(8080)는 눈에 띄게 경고한다', () => {
    const out = bbiyongBanner({ mock: false, baseUrl: 'http://192.168.0.14:8080' });
    expect(out.length).toBeGreaterThan(3); // 한 줄로 흘려보내지 않는다
    expect(text(out)).toContain('가동계');
    expect(text(out)).toContain('★★');
    expect(text(out)).toContain('8082'); // 개발계 포트를 같이 알려준다
  });

  it('개발계 배너에는 "가동계" 라는 말이 없다 — 눈으로 가르는 기준이다', () => {
    expect(text(bbiyongBanner({ mock: false, baseUrl: 'http://192.168.0.14:8082' }))).not.toContain('가동계');
  });

  it('모르는 포트는 계통 미상으로 알린다 (조용히 개발계로 취급하지 않는다)', () => {
    const out = bbiyongBanner({ mock: false, baseUrl: 'http://10.0.0.9:9999' });
    expect(text(out)).toContain('계통 미상');
    // 포트 안내로 "8082=개발계" 는 적지만, 이 주소가 개발계라고 **단정하지는** 않는다.
    expect(text(out)).not.toContain('(개발계)');
  });

  it('mock 이면 주소 대신 mock 이라고 찍는다', () => {
    const out = bbiyongBanner({ mock: true, baseUrl: null });
    expect(text(out)).toContain('MOCK');
    expect(text(out)).not.toContain('http');
  });

  it('깨진 URL 이어도 배너 때문에 기동이 죽지 않는다', () => {
    expect(() => bbiyongBanner({ mock: false, baseUrl: 'not a url' })).not.toThrow();
    expect(text(bbiyongBanner({ mock: false, baseUrl: 'not a url' }))).toContain('계통 미상');
  });
});
