/* 세무 서비스(S05) 시안 데이터 — 값만 바꿔 확인하실 수 있습니다.
   시안 기준 오늘 = 2026-10-06. 작업할 달 기본값 = 지난달(2026-09). */
window.TAX_DATA = {
  TODAY: "2026-10-06",
  DEFAULT_MONTH: "2026-09",
  /* 삐용이 정본 — 세무 설정에서는 보여 주기만 */
  company: { name: "(주)브릿지랩", bizNo: "214-88-12345", corpNo: "110111-7654321", owner: "김대표" },

  KINDS: [
    { id: "invoice", name: "매입·매출 계산서", icon: "file-text", desc: "홈택스 전자세금계산서·계산서 목록 엑셀 그대로 올립니다" },
    { id: "card", name: "카드 사용 내역", icon: "credit-card", org: "card", desc: "카드사 사이트에서 받은 엑셀. 카드사를 고르면 표준양식으로 바뀝니다" },
    { id: "cash", name: "현금 경비", icon: "wallet", desc: "표준양식. 항목 칸을 비워 두면 거래 분류에서 붙입니다" },
    { id: "bank", name: "은행 입출금", icon: "landmark", org: "bank", desc: "통장 거래내역 엑셀. 은행과 계좌를 고릅니다" },
    { id: "ntax", name: "국세 납부", icon: "receipt", desc: "홈택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다" },
    { id: "ltax", name: "지방세 납부", icon: "receipt", desc: "위택스 납부내역 엑셀. 세목 칸으로 비용인지 나눕니다" },
    { id: "social", name: "4대보험", icon: "shield", desc: "4대사회보험 정보연계센터에서 내려받은 고지 내역 파일을 올립니다" },
    { id: "loan", name: "대출 내역", icon: "banknote", desc: "표준양식. 원금·이자 칸을 따로 적습니다 — 이자만 비용입니다" },
  ],
  BANKS: ["국민은행", "우리은행", "하나은행"],
  CARDCOS: ["국민카드", "우리카드"],

  /* 세무 설정 — 세무 전용 값만 */
  settings: {
    taxEmails: [
      { name: "한빛세무회계 김세무 실장", email: "tax@example.com" },
      { name: "대표 참조", email: "ceo@example.com" },
    ],
    accounts: [
      { id: "a1", bank: "국민은행", no: "123-45-6789-012", alias: "운영 통장" },
      { id: "a2", bank: "하나은행", no: "351-910234-56707", alias: "급여 통장" },
    ],
    cards: [
      { id: "c1", co: "국민카드", last4: "4821", alias: "법인카드 1" },
      { id: "c2", co: "우리카드", last4: "7703", alias: "법인카드 2" },
    ],
    halfYear: false,
    unused: [],          // 우리 회사가 쓰지 않는 자료 — 고른 자료는 매달 자동으로 「없음」
  },
  /* 공통 코드 표의 설정값 */
  FEE_LIMIT: 10000,      // 짝 차이가 이 금액 이하면 「수수료」로 자동 기록

  files: [
    { id: "f1", kind: "invoice", org: "매출", name: "홈택스_매출전자세금계산서_202609.xlsx", rows: 4, at: "10.02 13:58", pairs: 2 },
    { id: "f2", kind: "invoice", org: "매입", name: "홈택스_매입전자세금계산서_202609.xlsx", rows: 9, at: "10.02 14:01", pairs: 3 },
    { id: "f3", kind: "card", org: "국민카드 · 법인카드 1", name: "KB카드_이용내역_0901_0930.xlsx", rows: 38, at: "10.02 14:05", pairs: 1 },
    { id: "f4", kind: "bank", org: "국민은행 · 운영 통장", name: "KB_거래내역_123456789012.xlsx", rows: 16, at: "10.02 14:08", pairs: 9 },
    { id: "f5", kind: "bank", org: "하나은행 · 급여 통장", name: "하나_거래내역_0901_0930.xls", rows: 3, at: "10.02 14:09", pairs: 2 },
    { id: "f7", kind: "ntax", org: "", name: "홈택스_납부내역_202609.xlsx", rows: 1, at: "10.02 14:15", pairs: 1 },
    { id: "f9", kind: "social", org: "", name: "4대보험_고지내역_202609.xlsx", rows: 4, at: "10.02 14:17", pairs: 1 },
    { id: "f8", kind: "cash", org: "", name: "현금경비_9월.xlsx", rows: 3, at: "10.03 09:20", pairs: 0 },
  ],

  /* 짝 종류 — 은행 줄의 상대 */
  PAIR_KINDS: {
    inv_p: "매입 계산서", inv_s: "매출 계산서", cardbill: "카드대금", payroll: "급여", ntax: "국세", ltax: "지방세",
    social: "4대보험", loan: "대출", ppiyong: "삐용 경비 정산", transfer: "내 계좌끼리", owner: "대표가 넣은 돈",
  },

  /* 은행 줄 — state: auto(자동 확정) · done(사람이 확정) · cand(후보 있음) · none(짝 없음 → 분류) */
  bank: [
    { id: "b1", acc: "a1", date: "09.01", desc: "(주)강남빌딩 임대료", out: 1650000, state: "auto", pair: { kind: "inv_p", label: "(주)강남빌딩 · 9월 임대료 계산서", amt: 1650000 } },
    { id: "b2", acc: "a1", date: "09.03", desc: "오르카스튜디오", in: 5500000, state: "auto", pair: { kind: "inv_s", label: "오르카스튜디오 · 08.29 매출 계산서", amt: 5500000, mon: 8 } },
    { id: "b3", acc: "a1", date: "09.05", desc: "KT 통신요금", out: 330000, state: "auto", pair: { kind: "inv_p", label: "(주)케이티 · 8월 통신요금 계산서", amt: 330000, mon: 8 } },
    { id: "b4", acc: "a1", date: "09.10", desc: "국세 원천세", out: 1284500, state: "auto", pair: { kind: "ntax", label: "홈택스 납부 · 원천세(8월 지급분)", amt: 1284500, mon: 8 } },
    { id: "b5", acc: "a1", date: "09.10", desc: "지방소득세 납부", out: 128450, state: "none", hint: "지방세 납부 자료를 올리면 짝이 생길 수 있습니다" },
    { id: "b6", acc: "a1", date: "09.10", desc: "국민건강보험공단", out: 612340, state: "auto", pair: { kind: "social", label: "4대보험 · 9월 고지분 (공단 출금)", amt: 612340 } },
    { id: "b7", acc: "a1", date: "09.12", desc: "하나 351-910 이체", out: 2000000, state: "auto", pair: { kind: "transfer", label: "하나은행 · 급여 통장 09.12 입금", amt: 2000000 } },
    { id: "b8", acc: "a1", date: "09.15", desc: "국민카드 결제대금", out: 3812000, state: "done", pair: { kind: "cardbill", label: "국민카드 4821 · 적용월 9월 청구 합계 (41건 · 결제일 09.15)", amt: 3812000, mon: 8 } },
    { id: "b9", acc: "a1", date: "09.18", desc: "브라이트랩", in: 8800000, state: "cand",
      restCands: [{ kind: "inv_s", label: "브라이트랩 · 09.05 매출 계산서", amt: 4400000 }],
      cands: [
        { kind: "inv_s", label: "브라이트랩 · 매출 계산서 2건 합계 (09.05 · 09.12)", amt: 8800000, multi: 2 },
        { kind: "inv_s", label: "브라이트랩 · 09.12 매출 계산서 1건만", amt: 4400000 },
      ] },
    { id: "b10", acc: "a1", date: "09.20", desc: "한결세무법인", in: 6599500, state: "cand",
      cands: [{ kind: "inv_s", label: "한결세무법인 · 09.16 매출 계산서", amt: 6600000, note: "상대가 이체 수수료를 떼고 보낸 것으로 보입니다" }] },
    { id: "b11", acc: "a1", date: "09.22", desc: "김도현 경비정산", out: 85000, state: "cand",
      cands: [{ kind: "ppiyong", label: "삐용 경비 · 김도현 · 09.19 교재 구입 (개인 돈)", amt: 85000 }] },
    { id: "b12", acc: "a1", date: "09.24", desc: "쿠팡(주)", out: 420000, state: "none" },
    { id: "b13", acc: "a1", date: "09.25", desc: "스타벅스 강남R점", out: 54000, state: "none" },
    { id: "b14", acc: "a1", date: "09.26", desc: "김대표", in: 10000000, state: "cand",
      cands: [{ kind: "owner", label: "대표가 넣은 돈 · 입금자 이름이 대표와 같습니다", amt: 10000000, nodoc: true }] },
    { id: "b15", acc: "a1", date: "09.28", desc: "국민은행 대출 상환", out: 1212000, state: "none", hint: "대출 내역을 올리면 짝이 생길 수 있습니다" },
    { id: "b16", acc: "a1", date: "09.30", desc: "ATM 출금", out: 150000, state: "none" },
    { id: "b19", acc: "a1", date: "09.27", desc: "세움컴퍼니", out: 2000000, state: "cand",
      cands: [{ kind: "inv_p", label: "세움컴퍼니 · 09.14 외주 용역 계산서", amt: 5000000, note: "나눠서 낸 것일 수 있습니다" }] },
    { id: "b17", acc: "a1", date: "09.29", desc: "현금 매출 입금", in: 330000, state: "none" },
    { id: "b18", acc: "a1", date: "09.30", desc: "예금이자", in: 1280, state: "none" },
    { id: "h1", acc: "a2", date: "09.12", desc: "국민 123-45 입금", in: 2000000, state: "auto", pair: { kind: "transfer", label: "국민은행 · 운영 통장 09.12 출금", amt: 2000000 } },
    { id: "h2", acc: "a2", date: "09.25", desc: "9월 급여 (5명)", out: 12096120, state: "auto", pair: { kind: "payroll", label: "9월 직원 급여 이체", amt: 12096120 } },
    { id: "h3", acc: "a2", date: "09.25", desc: "타행 이체수수료", out: 2500, state: "none" },
  ],

  /* 현금 경비 — 항목 칸이 빈 줄만 분류 대상 */
  cash: [
    { id: "k1", date: "09.08", desc: "다과 구입 (회의)", amt: 35000, item: "식대·회의비" },
    { id: "k2", date: "09.17", desc: "퀵서비스", amt: 18000, item: "" },
    { id: "k3", date: "09.29", desc: "사무용품 (문구점)", amt: 22000, item: "소모품비" },
  ],

  /* 분류 항목 — 공통 코드 표에서 불러옴 (화면에 박지 않음).
     s(대상): all | corp | indiv · d(구분): out 출금 항목 | in 입금 항목. 입금 줄에는 입금 항목만, 출금 줄에는 출금 항목만 */
  ITEMS: [
    { v: "계산서 없는 매출", s: "all", d: "in", g: "현금 매출 등 — 부가세 매출에도 잡힙니다", vat: true },
    { v: "이자 수입", s: "all", d: "in" }, { v: "세금 환급", s: "all", d: "in" }, { v: "보조금", s: "all", d: "in" },
    { v: "지원금", s: "all", d: "in" }, { v: "대표가 넣은 돈", s: "all", d: "in" }, { v: "기타 수입", s: "all", d: "in" },
    { v: "잘 모름 — 세무사에게 묻기", s: "all", d: "in" },
    { v: "사무실 월세", s: "all", ded: true }, { v: "통신비", s: "all", ded: true }, { v: "소모품비", s: "all", g: "사무용품·작은 비품", ded: true },
    { v: "식대·회의비", s: "all", g: "직원 식사·회의 다과", ded: true }, { v: "교통·출장비", s: "all", ded: true }, { v: "택배·운송비", s: "all", ded: true },
    { v: "광고비", s: "all", ded: true }, { v: "수수료", s: "all", g: "은행·플랫폼 수수료" }, { v: "외주 용역비", s: "all", ded: true },
    { v: "보험료", s: "all" }, { v: "수선비", s: "all", ded: true }, { v: "교육·도서비", s: "all" },
    { v: "접대비", s: "corp", g: "거래처 식사·선물" }, { v: "거래처 경조사비", s: "indiv" },
    { v: "사업과 무관 — 대표 인출", s: "indiv", g: "대표가 개인 용도로 쓴 돈" },
    { v: "사업과 무관 — 세무사 판단", s: "corp", g: "세무사가 처리 방법을 정합니다" },
    { v: "잘 모름 — 세무사에게 묻기", s: "all" },
  ].map((i) => ({ d: "out", ...i })),
  /* 지난번 분류 기억 — 제안만 */
  MEMORY: { "스타벅스 강남R점": "식대·회의비", "쿠팡(주)": "소모품비", "타행 이체수수료": "수수료", "퀵서비스": "택배·운송비", "예금이자": "이자 수입" },

  ppiyong: [
    { id: "e1", date: "09.04", who: "김도현", desc: "택시 (고객사 방문)", amt: 23400, pay: "card", link: "linked", st: "ok" },
    { id: "e2", date: "09.11", who: "이수진", desc: "거래처 미팅 식대", amt: 86000, pay: "card", link: "linked", st: "ok" },
    { id: "e3", date: "09.19", who: "김도현", desc: "교재 구입", amt: 85000, pay: "own", link: "pair", st: "ok" },
    { id: "e4", date: "09.21", who: "박지훈", desc: "주차비", amt: 12000, pay: "own", link: "none", st: "cancelled" },
    { id: "e5", date: "09.27", who: "이수진", desc: "KTX (부산 출장)", amt: 59800, pay: "card", link: "missing", st: "ok" },
  ],
  ppiyongLast: "10.02 14:20",

  vendors: [
    { id: "v1", name: "(주)강남빌딩", biz: "120-81-33459", main: true, cnt: 1, from: "매입 계산서" },
    { id: "v2", name: "오르카스튜디오", biz: "211-87-90122", main: true, cnt: 2, from: "매출 계산서" },
    { id: "v3", name: "브라이트랩", biz: "105-86-44520", main: true, cnt: 3, from: "매출 계산서" },
    { id: "v4", name: "브라이트랩 주식회사", biz: "105-86-44520", main: false, cnt: 1, from: "은행 입출금", dup: "v3" },
    { id: "v5", name: "세움컴퍼니", biz: "314-81-22014", main: false, cnt: 1, from: "매입 계산서" },
    { id: "v6", name: "(주)케이티", biz: "102-81-42945", main: false, cnt: 1, from: "매입 계산서" },
    { id: "v7", name: "한결세무법인", biz: "220-86-11876", main: true, cnt: 1, from: "매출 계산서" },
    { id: "v8", name: "쿠팡(주)", biz: "120-88-00767", main: false, cnt: 4, from: "카드 사용 내역" },
    { id: "v9", name: "스타벅스 강남R점", biz: "", main: false, cnt: 6, from: "카드 사용 내역" },
  ],

  /* 거래 분류 「전체」 보기용 — 매입 · 매출 계산서(f1 · f2)와 카드 사용(f3) 줄 (시안 일부) */
  txInv: [
    { file: "f1", kind: "매출", date: "09.05", desc: "브라이트랩 · 매출 계산서", amt: 4400000, item: "매출" },
    { file: "f1", kind: "매출", date: "09.12", desc: "브라이트랩 · 매출 계산서", amt: 4400000, item: "매출" },
    { file: "f1", kind: "매출", date: "09.16", desc: "한결세무법인 · 매출 계산서", amt: 6600000, item: "매출" },
    { file: "f1", kind: "매출", date: "09.22", desc: "오르카스튜디오 · 매출 계산서", amt: 5500000, item: "매출" },
    { file: "f2", kind: "매입", date: "09.01", desc: "(주)강남빌딩 · 9월 임대료", amt: 1650000, item: "사무실 월세" },
    { file: "f2", kind: "매입", date: "09.05", desc: "(주)케이티 · 통신요금", amt: 330000, item: "통신비" },
    { file: "f2", kind: "매입", date: "09.14", desc: "세움컴퍼니 · 외주 용역", amt: 5000000, item: "외주 용역비" },
  ],
  txCard: [
    { date: "08.28", desc: "쿠팡(주)", amt: 420000, item: "소모품비" },
    { date: "08.29", desc: "스타벅스 강남R점", amt: 54000, item: "식대·회의비" },
    { date: "09.04", desc: "카카오T", amt: 23400, item: "교통·출장비" },
    { date: "09.11", desc: "강남 한식당 (거래처 미팅)", amt: 86000, item: "식대·회의비" },
    { date: "09.27", desc: "코레일 KTX", amt: 59800, item: "교통·출장비" },
  ],
  /* 직원 급여 (S05-12) — 9월 값. 새 달은 지난달 값을 그대로 불러옴 */
  emps: [
    { id: "p1", name: "김도현", no: "E001", kind: "정규직", base: 3000000, bonus: 0, allow: 200000 },
    { id: "p2", name: "이수진", no: "E002", kind: "정규직", base: 2600000, bonus: 0, allow: 200000 },
    { id: "p3", name: "박지훈", no: "E003", kind: "정규직", base: 2400000, bonus: 0, allow: 200000 },
    { id: "p4", name: "정하늘", no: "E004", kind: "정규직", base: 2200000, bonus: 0, allow: 200000 },
    { id: "p5", name: "한서윤", no: "E005", kind: "정규직", base: 2500000, bonus: 0, allow: 100000 },
    { id: "p6", name: "최민서", no: "F001", kind: "프리랜서", base: 1500000, bonus: 0, allow: 0 },
  ],
  /* 4대보험 자료(고지 내역)의 직원 부담 — 사번으로 붙임. E005 는 9월 입사라 아직 없음 */
  socialPeople: {
    E001: { pension: 144000, health: 113440, ltc: 14690, emp: 28800 },
    E002: { pension: 126000, health: 99260, ltc: 12850, emp: 25200 },
    E003: { pension: 117000, health: 92170, ltc: 11930, emp: 23400 },
    E004: { pension: 108000, health: 85080, ltc: 11010, emp: 21600 },
  },
  /* 반기납부 시안: 7·8월 급여대장도 9월과 같은 금액으로 올렸다고 봅니다 */
  payrollMonths: ["2026-07", "2026-08", "2026-09"],
  /* 급여대장 9월 — 지급일 09.25, 귀속 9월. 주민번호 칸 없음 */
  payroll: [
    { name: "김도현", kind: "근로", pay: 3200000, tax: 98250, local: 9820 },
    { name: "이수진", kind: "근로", pay: 2800000, tax: 62040, local: 6200 },
    { name: "박지훈", kind: "근로", pay: 2600000, tax: 47030, local: 4700 },
    { name: "정하늘", kind: "근로", pay: 2400000, tax: 35600, local: 3560 },
    { name: "최민서", kind: "사업", pay: 1500000, tax: 45000, local: 4500, note: "디자인 외주 3.3%" },
  ],

  /* 월별 손익 (원). 9월은 아래 내역의 합 */
  pl: {
    "2026-01": [16500000, 15800000], "2026-02": [17200000, 16100000], "2026-03": [18800000, 17000000],
    "2026-04": [17900000, 16900000], "2026-05": [20100000, 17600000], "2026-06": [19400000, 17200000],
    "2026-07": [20800000, 18100000], "2026-08": [21500000, 17900000], "2026-09": [22000000, 18052340],
  },
  plSep: {
    income: [
      { v: "매출 (세금계산서)", amt: 22000000, g: "오르카스튜디오 · 브라이트랩 · 한결세무법인 외 — 부가세 뺀 금액" },
    ],
    expense: [
      { v: "급여 (근로소득)", amt: 11000000 }, { v: "외주 개인 지급 (사업소득)", amt: 1500000 },
      { v: "4대보험 회사 부담", amt: 612340 }, { v: "사무실 월세", amt: 1500000 }, { v: "외주 용역비", amt: 1000000 },
      { v: "소모품비", amt: 1190000 }, { v: "식대·회의비", amt: 640000 }, { v: "교통·출장비", amt: 310000 }, { v: "통신비", amt: 300000 },
    ],
  },
};
