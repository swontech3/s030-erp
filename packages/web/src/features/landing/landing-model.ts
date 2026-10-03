/**
 * 랜딩(s030500010)이 쓰는 값·문구·연결 — 시안에서 그대로 옮겼다.
 *
 * 원본: design/landing-hero/LandingHero.dc.html
 *   ★ 저장소 사본은 `_ds_bundle.js` 가 없어 브라우저에서 빈 화면이다. 실제로 열어 본
 *     것은 `design/SwonBiz Design System_html시안_2/templates/landing-hero/` 쪽이고,
 *     두 파일은 에셋 경로만 다르다(2026-10-01 대조).
 *   ★ 명세(.md)는 없다 — 랜딩은 handoff/ 1차 인계 범위 밖이다(`handoff/README.md`
 *     「제외 (2차 이후)」 · 「3차 이후 … 별도 랜딩·신청 폼」). 그래서 이 파일의 문구는
 *     전부 시안 마크업에서 글자 그대로 가져왔다.
 *
 * ★★ 문구를 고치지 않는다. 시안과 갈라지면 대조(`shots/`)가 의미를 잃는다.
 *    시안 쪽 오류를 바로잡은 자리는 `doc/DESIGN_HANDOFF_DIFF.md` §P 에 적어 뒀다.
 */
import type { IconName } from '@/components/ds';

/* ══ 연락처 ═══════════════════════════════════════════════════════════════════
   ★ 전화·사업자·주소는 **문의상담(s030500070)과 같은 값**이어야 한다. 공개 화면
     둘이 서로 다른 연락처를 적고 있으면 어느 쪽이 맞는지 아무도 모른다.
     그래서 대표번호는 `features/inquiry/inquiry-model` 의 것을 **다시 쓴다** —
     여기에 숫자를 또 적지 않는다.
   ★ 팩스는 랜딩 푸터에만 있다(시안 CONTACT 칸). 문의상담 푸터에는 없다. */
export { TEL_HREF, TEL_LABEL } from '@/features/inquiry/inquiry-model';

export const FAX_LABEL = '팩스 070-4015-3344';

/**
 * 대표 메일.
 *
 * ★★ **시안이 어긋나 있던 자리다.** 보이는 글자는 `swonbiz@s-onetech.com`,
 *    `href` 는 `mailto:contact@swonbiz.com` 이었다(2026-10-01 발견).
 *    실제 주소는 `swonbiz@s-onetech.com` 이라 확인받았고, 보이는 글자와 거는 주소를
 *    **둘 다 이것으로** 맞췄다. `doc/DESIGN_HANDOFF_DIFF.md` §P-3.
 */
export const MAIL_LABEL = 'swonbiz@s-onetech.com';
export const MAIL_HREF = `mailto:${MAIL_LABEL}`;

export const HOURS = '평일 09:00 - 18:00';
export const HOURS_NOTE = '야간·주말 상담도 가능합니다';
export const BRANCH = '강남 삼성점';

export const NAVER_MAP_HREF =
  'https://map.naver.com/p/search/%EB%B4%89%EC%9D%80%EC%82%AC%EB%A1%9C55%EA%B8%B819';

/* ══ 문의로 가는 길 ══════════════════════════════════════════════════════════ */

/**
 * ★★★ 시안의 상담 문의 모달(`s030500010p1`)을 **만들지 않았다.**
 *
 * 시안은 모든 CTA 가 한 모달을 열고 거기서 [신청하기] 를 누르게 되어 있다. 그런데
 * 그 모달에는 **저장 경로가 없다** — 시안 스크립트의 `INQUIRY_ENDPOINT` 가 빈
 * 문자열이고, 비어 있으면 화면에서 접수됐다고만 말한다.
 *
 * 받는 자리를 새로 만들지 않고 **문의상담(`s030500070p1`)으로 보낸다**(2026-10-01 결정).
 *   · 한 업무는 한 화면에서 — 문의를 받는 자리가 둘이면 운영자가 두 군데를 봐야 한다
 *   · 저장·스팸 차단·보관 기간·운영자 답변(`s030200080`)이 그쪽에 이미 다 있다
 *
 * 그래서 이 함수가 시안의 `data-inquiry` 를 문의 유형 코드(`QU_TP`)로 바꾼다.
 * 자세한 이유: `doc/DESIGN_HANDOFF_DIFF.md` §P-1.
 */
export type InquiryKind =
  | '상담'
  | '연구소'
  | '투어'
  | '비상주'
  | '개인 오피스'
  | '팀 오피스'
  | '요금'
  | '비대면 신청';

/**
 * `data-inquiry` → `QU_TP` 코드.
 *
 * ★ 「연구소」만 `R`(연구소설립문의)이고 나머지 일곱은 `O`(입주문의)다 — 입주하려고
 *   들어온 사람에게 유형을 다시 고르게 하지 않는다(2026-10-01 결정).
 * ★ 「방문 상담 / 비대면 신청」 구분은 유형으로 나누지 않는다. 손님이 본문에 적는다 —
 *   코드 마스터(`QU_TP`)에 그 구분이 없고, 코드를 늘리면 운영자 화면의 필터까지
 *   따라 바뀐다.
 */
const TYPE_OF: Record<InquiryKind, string> = {
  상담: 'O',
  연구소: 'R',
  투어: 'O',
  비상주: 'O',
  '개인 오피스': 'O',
  '팀 오피스': 'O',
  요금: 'O',
  '비대면 신청': 'O',
};

/**
 * 문의하기로 가는 주소 — 유형이 미리 골라진 채로 열린다.
 *
 * ★ 온라인 신청 폼(`s030500020`)은 아직 없다. **생기면 그때 그쪽으로 돌린다** —
 *   「온라인 신청」 계열(`비대면 신청`)만 주소를 바꾸면 되도록 여기 한 곳에 모아 뒀다.
 */
export function inquiryHref(kind: InquiryKind): string {
  return `/inquiry/new?type=${TYPE_OF[kind]}`;
}

/** 문의상담 목록 — 푸터 「바로가기」에서 간다(시안에 없던 링크, 2026-10-01 추가). */
export const INQUIRY_LIST_HREF = '/inquiry';

/* ══ 서비스 3종 ══════════════════════════════════════════════════════════════ */

export interface ServiceCard {
  icon: IconName;
  title: string;
  lead: string;
  body: string;
  /** 체크 목록. `badge` 가 있으면 그 줄 끝에 알약을 붙인다. */
  points: { text: string; strong?: true; badge?: string }[];
  /** 카드 위 4px 띠가 그라디언트인가 — 시안은 「세무」만 그렇다. */
  gradientRule?: true;
}

export const SERVICES: ServiceCard[] = [
  {
    icon: 'building-2',
    title: '공간',
    lead: '1인실부터 팀 오피스까지',
    body: '회의실·라운지·프린터·우편 수취까지 포함된 정액 요금. 별도 관리비나 숨은 비용이 없습니다.',
    points: [
      { text: '24시간 자유 출입' },
      { text: '회의실 월 20시간 무료' },
      { text: '법인 주소지 등록 가능' },
    ],
  },
  {
    icon: 'scale',
    title: '법무',
    lead: '법인설립·등기를 AI가 준비',
    body: '관련 법령과 표준산업분류를 근거로 사업목적·업태·업종을 정하고, 정관과 의사록, 주주명부까지 자동 생성합니다.',
    points: [
      { text: '설립·변경 등기 서류 자동 작성' },
      { text: '사업목적 자동 매핑' },
      { text: '제휴 법무사 연결' },
    ],
  },
  {
    icon: 'calculator',
    title: '세무',
    lead: '세금 혜택까지 챙기는 세무 자동화',
    body: '세금계산서 발행, 경비 증빙 분류, 부가세 신고 준비까지 AI가 처리하고, 기업부설연구소 설립으로 받을 수 있는 세액공제까지 안내합니다.',
    points: [
      { text: '세금계산서 자동 발행' },
      { text: '경비 증빙 AI 자동 분류' },
      { text: '기업부설연구소 설립 지원', strong: true, badge: '세액공제' },
      { text: '제휴 세무사 연결' },
    ],
    gradientRule: true,
  },
];

/** 기업부설연구소 띠의 혜택 3줄. */
export const LAB_BENEFITS = ['R&D 세액공제', '전문연구요원 병역특례', '정부 R&D 과제 가점'];

/* ══ 운영 시스템 ═════════════════════════════════════════════════════════════ */

export interface ErpFeature {
  icon: IconName;
  title: string;
  body: string;
}

export const ERP_FEATURES: ErpFeature[] = [
  {
    icon: 'file-pen-line',
    title: '계약·청구 자동화',
    body: '계약 기간·요금이 등록되면 매달 청구서가 자동 생성되고 결제까지 이어집니다.',
  },
  {
    icon: 'receipt',
    title: '세금계산서 원클릭 발행',
    body: '결제 완료 시 자동 발행. 입주사는 포털에서 언제든 내려받을 수 있습니다.',
  },
  {
    icon: 'credit-card',
    title: '법인카드 경비 통합 관리',
    body: '카드 내역을 올리면 AI가 계정과목을 분류하고 증빙을 매칭합니다.',
  },
  {
    icon: 'message-square-text',
    title: 'AI 법무·세무 상담 무제한',
    body: '등기·부가세·계약 관련 질문에 24시간 답변. 필요하면 전문가로 연결됩니다.',
  },
];

export interface ErpStat {
  icon: IconName;
  title: string;
  note: string;
  /** 시안은 마지막 지표만 시안색(--color-accent)이다. */
  accent?: true;
}

export const ERP_STATS: ErpStat[] = [
  { icon: 'shield-check', title: '12년째 운영 중', note: '강남 삼성동에서 검증된 운영' },
  { icon: 'infinity', title: '전 기능 무제한', note: '청구·세무·경비 제한 없이 이용' },
  { icon: 'headphones', title: '야간·주말 상담', note: '매니저 상주, 예약 없이 문의' },
  { icon: 'wallet', title: '추가 비용 0원', note: '모든 플랜에 운영 시스템 포함', accent: true },
];

/** 운영 시스템 목업의 증빙 표 4줄. */
export const ERP_MOCK_ROWS: {
  file: string;
  account: string;
  amount: string;
  state: '자동' | 'AI 분류중' | '확인 필요';
}[] = [
  { file: '세금계산서_클라우드.pdf', account: '지급수수료', amount: '₩264,000', state: '자동' },
  { file: '영수증_0812_카페.jpg', account: '복리후생비', amount: '₩18,000', state: '자동' },
  { file: '카드내역_0814_주차.csv', account: '차량유지비', amount: '₩9,000', state: 'AI 분류중' },
  { file: '영수증_0815_택시.jpg', account: '여비교통비', amount: '₩12,400', state: '확인 필요' },
];

export const ERP_MOCK_NAV = ['대시보드', '계약', '세무', '멤버', '회의실', '설정'];
/** 목업 사이드바에서 켜진 항목. */
export const ERP_MOCK_NAV_ON = '세무';

/** 「경비 증빙 39/42 자동 분류」 — 0 에서 39 까지 센다. */
export const ERP_CLASSIFIED_TO = 39;
export const ERP_CLASSIFIED_OF = 42;

/* ══ 히어로 문서 시퀀스 ══════════════════════════════════════════════════════ */

export interface HeroDoc {
  icon: IconName;
  title: string;
  note: string;
  /** 완료 전 알약 문구 — 첫 줄만 「검색중」이다. */
  busy: string;
  /** 제목 옆 알약 — 첫 줄만 있다. */
  badge?: string;
}

export const HERO_DOCS: HeroDoc[] = [
  {
    icon: 'search',
    title: '사업목적 · 업종 · 업태',
    note: '관련 법령과 표준산업분류를 검색해 항목 제안',
    busy: '검색중',
    badge: 'AI 시스템',
  },
  { icon: 'file-text', title: '정관', note: '확정된 사업목적을 그대로 반영', busy: '작성중' },
  {
    icon: 'file-text',
    title: '발기인총회 의사록',
    note: '발기인 2명 · 의결사항 5건',
    busy: '작성중',
  },
  {
    icon: 'file-text',
    title: '주주명부',
    note: '주주 2명 · 발행주식 10,000주',
    busy: '작성중',
  },
  { icon: 'file-text', title: '법인 인감신고서', note: '대표이사 인감 등록용', busy: '작성중' },
];

export const HERO_DOCS_DONE =
  '법인설립 등기 신청서류 준비가 끝났습니다. 셀프 등기 신청하거나 법무사에게 넘길 수 있습니다.';

export const HERO_PROOF: { icon: IconName; text: string; strong?: true }[] = [
  { icon: 'shield-check', text: '12년째 운영 중', strong: true },
  { icon: 'circle-check', text: '사업자등록 전 입주 가능' },
  { icon: 'circle-check', text: '관리비 별도 없음' },
];

/* ══ 공간 7곳 ════════════════════════════════════════════════════════════════ */

export interface SpaceCard {
  /** `public/spaces/<file>.png`. 시안 에셋을 그대로 옮겼다. */
  file: string;
  alt: string;
  badge: string;
  title: string;
  note: string;
  /** 12칸 그리드에서 차지하는 자리 — 시안 그대로. */
  area: string;
  /** 라운지만 제목이 h3 크기(22px)다. */
  lead?: true;
}

export const SPACES: SpaceCard[] = [
  {
    file: 'lounge',
    alt: '라운지',
    badge: '전 입주사 이용',
    title: '라운지 · 리셉션',
    note: '리셉션부터 회의실까지, 하루가 시작되는 중심 공간',
    area: '1 / 1 / 3 / 8',
    lead: true,
  },
  {
    file: 'single-room',
    alt: '1인실',
    badge: '1인',
    title: '1인실',
    note: '창가 채광 · 개인 수납장 포함',
    area: '1 / 8 / 2 / 13',
  },
  {
    file: 'two-person-room',
    alt: '2인실',
    badge: '2인',
    title: '2인실',
    note: '독립 공간에서 두 사람이 함께',
    area: '2 / 8 / 3 / 13',
  },
  {
    file: 'dedicated-desk',
    alt: '고정석',
    badge: '1인',
    title: '고정석',
    note: '파티션으로 구분된 전용 좌석',
    area: '3 / 1 / 4 / 5',
  },
  {
    file: 'team-office',
    alt: '팀 오피스',
    badge: '3~6인',
    title: '팀 오피스',
    note: 'TV·냉장고 완비, 팀 단위 독립 사무실',
    area: '3 / 5 / 4 / 13',
  },
  {
    file: 'meeting-room',
    alt: '회의실',
    badge: '4~5인',
    title: '회의실',
    note: '대형 TV·화이트보드 완비',
    area: '4 / 1 / 5 / 8',
  },
  {
    file: 'pantry',
    alt: '탕비실',
    badge: '24시간',
    title: '탕비실',
    note: '커피머신·정수기·냉장고 상시 이용',
    area: '4 / 8 / 5 / 13',
  },
];

export const SPACE_NOTES = [
  '회의실 월 20시간 무료',
  '라운지·탕비실 24시간 이용',
  '관리비·공과금 별도 없음',
];

/* ══ 요금제 3종 ══════════════════════════════════════════════════════════════ */

export interface Plan {
  title: string;
  lead: string;
  points: string[];
  cta: string;
  kind: InquiryKind;
  /** 「가장 인기」 — 시안은 개인 오피스 하나다(2px 테두리 · 8px 올림 · 알약). */
  featured?: true;
}

export const PLANS: Plan[] = [
  {
    title: '비상주',
    lead: '주소지와 우편만 필요한 분',
    points: [
      '법인 주소지 등록',
      '우편물 수취 및 보관',
      '회의실 월 5시간',
      '라운지 이용',
      'SwonBiz 운영 시스템 기본 제공',
    ],
    cta: '비상주 문의',
    kind: '비상주',
  },
  {
    title: '개인 오피스',
    lead: '독립된 공간이 필요한 1~2인',
    points: [
      '1인실 · 2인실 · 고정석 선택',
      '24시간 자유 출입',
      '회의실 월 20시간 무료',
      '개인 수납장 · 전용 데스크',
      '라운지 · 탕비실 24시간',
      'SwonBiz 운영 시스템 전체 기능',
    ],
    cta: '개인 오피스 상담 신청',
    kind: '개인 오피스',
    featured: true,
  },
  {
    title: '팀 오피스',
    lead: '3~6인 팀 단위 운영',
    points: [
      '독립 사무실 (3~6인)',
      'TV · 냉장고 완비',
      '회의실 월 20시간 무료',
      '팀원 전원 운영 시스템 계정',
      '법인카드 경비 통합 관리',
      '팀 단위 법무·세무 상담',
    ],
    cta: '팀 오피스 문의',
    kind: '팀 오피스',
  },
];

/** 모든 플랜이 「상담 후 안내」다 — 시안에 금액이 없다. */
export const PLAN_PRICE = '상담 후 안내';

export const PLAN_NOTES = [
  '모든 플랜 관리비·공과금 별도 없음',
  '플랜 변경 시 위약금 없음',
  '최소 계약 1개월부터',
  '매니저 상주 · 야간·주말 상담 가능',
];

/* ══ 입주 절차 ═══════════════════════════════════════════════════════════════ */

export interface ProcessStep {
  no: string;
  title: string;
  body: string;
  when: string;
}

export interface ProcessTab {
  key: '1' | '2';
  label: string;
  note: string;
  steps: ProcessStep[];
}

export const PROCESS_TABS: ProcessTab[] = [
  {
    key: '1',
    label: '방문 상담',
    note: '공간을 직접 보고 결정하고 싶은 분께 권합니다',
    steps: [
      {
        no: '01',
        title: '신청',
        body: '온라인 신청 또는 전화 상담으로 접수합니다. 원하는 공간과 입주 희망일을 알려주세요.',
        when: '즉시',
      },
      {
        no: '02',
        title: '공간 투어',
        body: '실제 공간을 둘러보고 시설을 확인합니다. 평일 방문 예약제로 운영합니다.',
        when: '20분 내외',
      },
      {
        no: '03',
        title: '입주 상담',
        body: '업종과 인원에 맞는 공간을 제안하고, 법무·세무 지원 범위를 안내합니다.',
        when: '30분 내외',
      },
      {
        no: '04',
        title: '계약',
        body: '계약서를 작성하고 보증금을 납부합니다. 사업자등록 전이어도 가등록으로 진행 가능합니다.',
        when: '당일',
      },
      {
        no: '05',
        title: '입주 + 운영 시스템 계정 발급',
        body: '출입 등록이 완료되고, 당일 운영 시스템 계정이 발급됩니다. 청구·세무·경비 관리가 바로 시작됩니다.',
        when: '당일',
      },
    ],
  },
  {
    key: '2',
    label: '비대면 신청',
    note: '비상주 또는 방문 없이 바로 시작하고 싶은 분께 권합니다',
    steps: [
      {
        no: '01',
        title: '온라인 신청',
        body: '신청서를 작성합니다. 비상주는 물론 개인 오피스도 방문 없이 바로 신청할 수 있습니다. 대표자 신분증만 있으면 접수 가능합니다.',
        when: '10분',
      },
      {
        no: '02',
        title: '서류 확인',
        body: '제출 서류를 확인합니다. 사업자등록증이 있으면 1~2일, 등록 신청 중이면 가등록으로 먼저 진행합니다.',
        when: '1~2일',
      },
      {
        no: '03',
        title: '등록 완료 + 운영 시스템 계정 발급',
        body: '계약이 완료되고 운영 시스템 계정이 발급됩니다. 비상주는 우편물 수취가, 개인 오피스는 출입이 바로 시작됩니다.',
        when: '당일',
      },
    ],
  },
];

export const PROCESS_PREREG = {
  title: '사업자등록 전이어도 괜찮습니다',
  body: '사업자등록을 신청 중이거나 아직 시작 전이어도 가등록으로 입주할 수 있습니다. 등록증이 나오면 그때 제출하시면 됩니다. 법인설립 등기가 필요하다면 서류 작성부터 함께 진행합니다.',
  docs: ['대표자 신분증 (필수)', '사업자등록증 (발급 후 제출)'],
};

/* ══ FAQ 9문항 ═══════════════════════════════════════════════════════════════ */

export interface Faq {
  q: string;
  /** 두 번째 단락이 있는 항목이 하나 있다(운영 시스템 요금 — ※ 실비 안내). */
  a: string[];
}

export const FAQS: Faq[] = [
  {
    q: 'SwonBiz는 언제부터 운영했나요?',
    a: [
      '강남 삼성동에서 12년째 공유오피스를 운영하고 있습니다. 그동안 입주사들이 겪은 법무·세무 문제를 직접 보아왔고, 그 경험을 SwonBiz 운영 시스템으로 만들었습니다. 입주 중에 사무실이 사라질 걱정 없이 이용하실 수 있습니다.',
    ],
  },
  {
    q: '사업자등록 전인데 입주할 수 있나요?',
    a: [
      '가능합니다. 대표자 신분증만 있으면 가등록으로 먼저 진행하고, 사업자등록증이 발급되면 그때 제출하시면 됩니다. 사업자등록 신청 절차도 함께 안내해 드립니다.',
    ],
  },
  {
    q: '법인설립 등기까지 도와주시나요?',
    a: [
      'AI 시스템을 활용해 사업목적 선정부터 정관, 발기인총회 의사록, 주주명부까지 법인 설립등기 서류를 작성해 드립니다. 설립 이후 본점 이전, 임원 변경, 증자 같은 변경등기 서류도 함께 준비합니다. 작성된 서류로 직접 등기를 신청하실 때는 접수 절차와 제출 서류를 단계별로 도와 드리고, 대리 진행을 원하시면 제휴 법무사를 연결해 드립니다.',
    ],
  },
  {
    q: '운영 시스템은 별도 요금인가요?',
    a: [
      '시스템 사용료는 없습니다. 모든 플랜에 포함되어 있고, 입주 당일 계정이 발급되어 청구·세금계산서·경비 관리를 바로 사용하실 수 있습니다.',
      '※ 세금계산서 발행, 법인카드 내역 조회처럼 외부 기관 연동이 필요한 항목은 건당 실비가 발생합니다. 사용한 만큼만 청구되고, 이용 전에 단가를 안내해 드립니다.',
    ],
  },
  {
    q: '비상주도 법인 주소지로 쓸 수 있나요?',
    a: [
      '가능합니다. 사업자등록과 법인등기 주소지로 사용하실 수 있고, 우편물은 도착 즉시 알림을 보내드립니다. 방문 수령 또는 착불 발송 중 선택하실 수 있습니다.',
    ],
  },
  {
    q: '최소 계약 기간이 어떻게 되나요?',
    a: [
      '1개월부터 가능합니다. 계약 기간 중 플랜을 바꾸셔도 위약금이나 재계약 절차가 없습니다. 비상주로 시작해 개인 오피스로 옮기는 경우가 많습니다.',
    ],
  },
  {
    q: '회의실은 어떻게 예약하나요?',
    a: [
      '웹과 모바일, 태블릿 어디에서든 운영 시스템에 접속해 실시간으로 예약하거나 전화로 요청하실 수 있습니다. 개인 오피스·팀 오피스는 월 20시간, 비상주는 월 5시간이 무료이며, 초과 이용은 매니저에게 문의해 주세요.',
    ],
  },
  {
    q: '야간이나 주말에도 문의할 수 있나요?',
    a: [
      '입주사는 사전 예약 없이 야간·주말에도 전화 상담이 가능합니다. 매니저가 상주하고 있어 현장 문의도 언제든 받습니다. 개인 오피스·팀 오피스는 24시간 자유롭게 출입하실 수 있습니다.',
    ],
  },
  {
    q: '관리비나 추가 비용이 있나요?',
    a: [
      '없습니다. 전기·수도·인터넷·냉난방비가 모두 포함되어 있고, 라운지와 탕비실의 커피·정수기도 무료로 이용하실 수 있습니다. 별도로 청구되는 항목은 없습니다.',
    ],
  },
];

/* ══ 찾아오시는 길 ═══════════════════════════════════════════════════════════ */

export const ADDRESS_LINES = ['서울특별시 강남구 봉은사로55길 19, 3층', '(삼성동, 우리빌딩)'];

export const VISIT_ROWS: { icon: IconName; label: string; lines: string[] }[] = [
  { icon: 'map-pin', label: '주소', lines: ADDRESS_LINES },
  {
    icon: 'train-front',
    label: '지하철',
    lines: [
      '9호선·수인분당선 선정릉역 2번 출구 도보 3분',
      '7호선·수인분당선 강남구청역 도보 10분',
    ],
  },
  {
    icon: 'car',
    label: '주차',
    lines: ['방문 주차 가능 · 방문 전 연락 주시면 안내해 드립니다'],
  },
];

export const MAP_WALK = '선정릉역 2번 출구 · 도보 3분';
export const MAP_PLACEHOLDER = '지도 자리 · 클릭하면 네이버지도가 열립니다';

/* ══ 마지막 CTA ══════════════════════════════════════════════════════════════ */

export const FINAL_CTA_NOTES = ['최소 계약 1개월', '위약금 없음', '관리비 별도 없음'];

/* ══ 푸터 ════════════════════════════════════════════════════════════════════ */

export const FOOTER_BLURB =
  '강남 삼성동에서 12년째 운영 중인 공유오피스입니다. 법인설립부터 세무 자동화까지, 입주와 동시에 시작됩니다.';
export const FOOTER_BRAND_NOTE = 'SwonBiz는 주식회사 에스원테크가 운영하는 공유오피스 브랜드입니다.';

export const BIZ_LINES = [
  '상호: 주식회사 에스원테크 · 대표: 최현수 · 사업자등록번호: 105-87-68698',
  '주소: 서울특별시 강남구 봉은사로55길 19, 3층 (삼성동, 우리빌딩)',
];
export const COPYRIGHT = '© 2026 SwonBiz. All rights reserved.';

/** 헤더 네비 — 섹션 앵커 5개. 시안 순서 그대로. */
export const NAV: { href: string; label: string }[] = [
  { href: '#services', label: '서비스' },
  { href: '#erp', label: '운영시스템' },
  { href: '#spaces', label: '공간안내' },
  { href: '#pricing', label: '요금제' },
  { href: '#process', label: '이용안내' },
];

/**
 * 푸터 「바로가기」 두 칸.
 *
 * ★ 시안은 이 10줄이 **전부 `href="#"`** 였다. 섹션 앵커로 이을 수 있는 것은 이었고,
 *   나머지는 이렇게 처리했다(2026-10-01 결정 · `doc/DESIGN_HANDOFF_DIFF.md` §P-2):
 *     · 온라인 신청 · 공간 투어 예약 → 문의하기(유형 미리 선택)
 *     · 문의상담 → **시안에 없던 줄을 더했다**(목록으로 가는 길)
 *     · 이용약관 · 개인정보처리방침 → **지웠다.** 문서가 없고, 누르면 아무 일도
 *       일어나지 않는 링크를 공개 화면에 두지 않는다. ★ 운영 전 필수 항목이다 —
 *       개인정보를 받는 사이트라 처리방침은 법적 의무다
 */
export const FOOTER_SERVICE: { href: string; label: string }[] = [
  { href: '#spaces', label: '공간 안내' },
  { href: '#pricing', label: '요금제' },
  { href: '#services', label: '비즈니스지원' },
  { href: '#erp', label: '운영 시스템' },
  { href: '#process', label: '입주 절차' },
];

export const FOOTER_SUPPORT: { href: string; label: string }[] = [
  { href: '#faq', label: '자주 묻는 질문' },
  { href: inquiryHref('비대면 신청'), label: '온라인 신청' },
  { href: inquiryHref('투어'), label: '공간 투어 예약' },
  { href: INQUIRY_LIST_HREF, label: '문의상담' },
];
