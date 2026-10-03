'use client';

/**
 * 센터 관리(s030100010) 본문 — 좌측 트리 + 우측 내용.
 *
 * ★ 구성은 레거시 `/admin/spaces` 를 따른다: 건물 ▸ 층 ▸ {호실관리, 회의실관리} 트리와,
 *   고른 노드에 따라 갈리는 우측 4종(건물 정보 · 층 정보 · 호실 목록 · 회의실 목록).
 *
 * ★★ **시안이 없다.** 모양은 기존 ERP 화면과 같은 디자인 토큰으로 맞췄다
 *    (`facility.module.css` 머리말). 레거시의 드래그 폭 조절은 ERP 어느 화면에도 없는
 *    상호작용이라 넣지 않았다 — 고정 2단이다.
 *
 * ★ 레거시는 우측에서 건물·층을 **바로 고쳤다**(인라인 폼). 우리는 화면일람 설계대로
 *   팝업이라, 우측은 **읽는 자리**이고 고치는 것은 [수정] 버튼이 연다.
 *
 * ★★★ 지우기는 **서버가 막는다.** 화면은 목록에 실려 온 사용 건수로 [삭제] 를 미리
 *    비활성하지만, 그것은 편의일 뿐이고 판정은 `routes/facility.ts` 다.
 *
 * =============================================================================
 * ★★ 2026-10-03 — **다른 ERP 화면과 모양을 맞췄다**
 * =============================================================================
 * 캡처해 나란히 놓고 보니 토큰만 같고 뼈대가 달랐다. 고친 것:
 *
 *   본문 제목(30px)과 **우상단 주 액션** — 입주사·계약·청구와 같은 자리다
 *   「추가」는 전부 primary — 건물·층만 ghost 라 같은 뜻의 버튼이 두 무게였다
 *   표 머리말 띠 · 14px · 금액 `₩`(청구와 **같은 함수**) · 빈 값은 전부 「—」
 *   표 안 버튼 30px — 청구의 `.btnXs` 와 같은 값이다(DS Button 은 40px 가 제일 작다)
 *   누를 수 있는 글씨(호실명·회의실명)를 **눌리게** 보이도록
 *
 * ★★ 긴 목록은 **패널 안에서 스크롤**한다(72실). 입주사·계약이 목록을 그렇게 다룬다
 *    (`.cards{flex:1;min-height:0;overflow-y:auto}`) — ERP 어디에도 페이지 나누기가
 *    없어서 여기만 만들지 않았다. 표 머리말은 `position:sticky` 로 붙여 둔다.
 *
 * ★★★ **불러오는 중과 「없음」을 가른다.** 예전에는 층을 옮기는 동안 이전 층의 호실이
 *    그대로 보이다가 바뀌었고, 회의실이 1개인데 「0개 · 등록된 회의실이 없습니다」가
 *    잠깐 떴다 — **거짓을 보여 준 것**이지 늦게 보여 준 것이 아니다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Icon, type IconName } from '@/components/ds';
import {
  FacilityError,
  area,
  codeName,
  codesOf,
  dash,
  floorLabel,
  loadMeetingRooms,
  loadSpaces,
  loadTree,
  meetingRoomBlockReason,
  money,
  removeBuilding,
  removeFloor,
  removeMeetingRoom,
  removeSpace,
  spaceBlockReason,
  type Building,
  type CodeItem,
  type Floor,
  type MeetingRoom,
  type Space,
} from './facility-model';
import { BuildingDialog } from './BuildingDialog';
import { FloorDialog } from './FloorDialog';
import { SpaceDialog } from './SpaceDialog';
import { MeetingRoomDialog } from './MeetingRoomDialog';
import { DeleteFacilityDialog, type DeleteKind } from './DeleteFacilityDialog';
import styles from './facility.module.css';

/** 트리에서 고른 것. 우측이 무엇을 그릴지 이 값이 정한다. */
type Node =
  | { kind: 'building'; buildingId: string }
  | { kind: 'floor'; buildingId: string; floorId: string }
  | { kind: 'spaces'; buildingId: string; floorId: string }
  | { kind: 'facilities'; buildingId: string; floorId: string };

/** 열려 있는 팝업. ★ 한 번에 하나다 — 둘이 겹치면 어느 쪽이 저장됐는지 읽히지 않는다. */
type Dialog =
  | { kind: 'building'; building: Building | null }
  | { kind: 'floor'; buildingId: string; floor: Floor | null }
  | { kind: 'space'; floorId: string; space: Space | null }
  | { kind: 'facility'; floorId: string; room: MeetingRoom | null }
  | { kind: 'delete'; what: DeleteKind; label: string; blocked: string | null; run: () => Promise<void> };

export function FacilityView() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [node, setNode] = useState<Node | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * 호실·회의실을 **받아 오는 중**인가.
   *
   * ★★ 이 깃발이 없으면 화면이 거짓말을 한다 — 받아 오기 전의 빈 배열을 그대로 그려
   *    「등록된 회의실이 없습니다」라고 적는다(2026-10-03 캡처에서 실제로 그랬다).
   */
  const [leafBusy, setLeafBusy] = useState(false);

  const refreshTree = useCallback(async () => {
    try {
      const t = await loadTree();
      setBuildings(t.buildings);
      setFloors(t.floors);
      setCodes(t.codes);
      setError(null);
    } catch (err) {
      setError(err instanceof FacilityError ? err.message : '불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  /** 고른 층의 호실·회의실. ★ 층을 옮길 때만 받는다 — 트리에 전부 싣지 않는다. */
  const refreshLeaf = useCallback(async (n: Node | null) => {
    if (n === null || (n.kind !== 'spaces' && n.kind !== 'facilities')) return;
    /*
     * ★ 먼저 **지난 층의 것을 비운다.** 안 비우면 받아 오는 동안 다른 층의 호실이
     *   이 층의 것인 양 남아 있다 — 늦은 것보다 틀린 것이 나쁘다.
     */
    setLeafBusy(true);
    if (n.kind === 'spaces') setSpaces([]);
    if (n.kind === 'facilities') setRooms([]);
    try {
      if (n.kind === 'spaces') setSpaces((await loadSpaces(n.floorId)).spaces);
      if (n.kind === 'facilities') setRooms((await loadMeetingRooms(n.floorId)).facilities);
      setError(null);
    } catch (err) {
      setError(err instanceof FacilityError ? err.message : '불러오지 못했습니다');
    } finally {
      setLeafBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshLeaf(node);
  }, [node, refreshLeaf]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 저장·삭제가 끝나면 트리와 지금 보고 있는 목록을 함께 다시 받는다. */
  const afterWrite = async () => {
    setDialog(null);
    await refreshTree();
    await refreshLeaf(node);
  };

  const buildingOf = (id: string) => buildings.find((b) => b.buildId === id) ?? null;
  const floorOf = (id: string) => floors.find((f) => f.floorId === id) ?? null;
  const floorsOf = (buildingId: string) => floors.filter((f) => f.buildingId === buildingId);

  return (
    <div className={styles.page}>
      {/*
        ★ 본문 제목과 주 액션 — 입주사·계약(`.head`/`.title` 30px + 우상단 primary)과
          같은 자리다. 셸의 숨줄은 「지금 어디인가」이고, 이 줄은 「여기서 무엇을 하는가」다.
        ★★ 「건물 추가」가 트리 머리에서 **여기로 옮겨 왔다.** 같은 버튼을 두 자리에 두지
           않는다 — 화면의 주 액션은 하나이고 그 자리는 우상단이다.
      */}
      <div className={styles.head}>
        <h1 className={styles.title}>센터 관리</h1>
        <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'building', building: null })}>
          <Icon name="plus" size={16} />
          건물 추가
        </Button>
      </div>

      <div className={styles.body}>
      {/* ── 좌측 트리 ───────────────────────────────────────────────────── */}
      <aside className={styles.tree}>
        <div className={styles.treeHead}>
          <span className={styles.treeTitle}>
            <Icon name="building-2" size={14} />
            센터 목록
          </span>
        </div>

        <div className={styles.treeBody}>
        {loading ? <p className={styles.empty}>불러오는 중…</p> : null}
        {!loading && buildings.length === 0 ? <p className={styles.empty}>등록된 건물이 없습니다.</p> : null}

        {buildings.map((b) => {
          const open = expanded.has(b.buildId);
          const mine = floorsOf(b.buildId);
          return (
            <div key={b.buildId}>
              <button
                type="button"
                className={`${styles.node} ${node?.kind === 'building' && node.buildingId === b.buildId ? styles.nodeOn : ''}`}
                onClick={() => {
                  toggle(b.buildId);
                  setNode({ kind: 'building', buildingId: b.buildId });
                }}
              >
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
                <Icon name="building-2" size={13} />
                <span className={styles.nodeLabel}>{b.name}</span>
                <span className={styles.nodeCount}>{b.floorCount}층</span>
              </button>

              {open ? (
                <div className={styles.leafWrap}>
                  {mine.length === 0 ? <p className={styles.empty}>층이 없습니다.</p> : null}
                  {mine.map((f) => {
                    const fOpen = expanded.has(f.floorId);
                    return (
                      <div key={f.floorId}>
                        <button
                          type="button"
                          className={`${styles.node} ${node?.kind === 'floor' && node.floorId === f.floorId ? styles.nodeOn : ''}`}
                          onClick={() => {
                            toggle(f.floorId);
                            setNode({ kind: 'floor', buildingId: b.buildId, floorId: f.floorId });
                          }}
                        >
                          <Icon name={fOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                          {/* ★ 층 아이콘이 따로 없다 — 아이콘 세트에 'layers' 가 없어 건물 아이콘을 작게 쓴다.
                              새 SVG 를 이 화면만을 위해 지어내지 않는다(디자인 자산은 시안에서 온다). */}
                          <Icon name="building-2" size={12} />
                          <span className={styles.nodeLabel}>{floorLabel(f)}</span>
                        </button>

                        {fOpen ? (
                          <div className={styles.leafWrap}>
                            <button
                              type="button"
                              className={`${styles.leaf} ${node?.kind === 'spaces' && node.floorId === f.floorId ? styles.nodeOn : ''}`}
                              onClick={() => setNode({ kind: 'spaces', buildingId: b.buildId, floorId: f.floorId })}
                            >
                              <Icon name="package-open" size={12} />
                              <span className={styles.nodeLabel}>호실관리</span>
                              <span className={styles.nodeCount}>{f.spaceCount}실</span>
                            </button>
                            <button
                              type="button"
                              className={`${styles.leaf} ${node?.kind === 'facilities' && node.floorId === f.floorId ? styles.nodeOn : ''}`}
                              onClick={() => setNode({ kind: 'facilities', buildingId: b.buildId, floorId: f.floorId })}
                            >
                              <Icon name="door-open" size={12} />
                              <span className={styles.nodeLabel}>회의실관리</span>
                              <span className={styles.nodeCount}>{f.facilityCount}개</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        </div>
      </aside>

      {/* ── 우측 내용 ───────────────────────────────────────────────────── */}
      <section className={styles.panel}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {node === null ? (
          <PanelEmpty icon="mouse-pointer-click" lead="왼쪽에서 건물 · 층을 골라 주세요" />
        ) : null}

        {node?.kind === 'building' ? (
          <BuildingPanel
            building={buildingOf(node.buildingId)}
            floorCount={floorsOf(node.buildingId).length}
            onEdit={(b) => setDialog({ kind: 'building', building: b })}
            onAddFloor={(id) => setDialog({ kind: 'floor', buildingId: id, floor: null })}
            onDelete={(b) =>
              setDialog({
                kind: 'delete',
                what: 'building',
                label: b.name,
                /* ★ 층이 있으면 미리 막는다. 입주사·계약은 서버만 아는 값이라 거기서 센다. */
                blocked:
                  b.floorCount > 0
                    ? `층 ${b.floorCount}개가 이 건물에 있어 지울 수 없습니다. 먼저 정리해 주세요`
                    : null,
                run: async () => {
                  await removeBuilding(b.buildId);
                  setNode(null);
                  await afterWrite();
                },
              })
            }
          />
        ) : null}

        {node?.kind === 'floor' ? (
          <FloorPanel
            floor={floorOf(node.floorId)}
            buildingName={buildingOf(node.buildingId)?.name ?? ''}
            onEdit={(f) => setDialog({ kind: 'floor', buildingId: f.buildingId, floor: f })}
            onDelete={(f) =>
              setDialog({
                kind: 'delete',
                what: 'floor',
                label: floorLabel(f),
                blocked:
                  f.spaceCount > 0 || f.facilityCount > 0
                    ? `호실 ${f.spaceCount}실 · 회의실 ${f.facilityCount}개가 이 층에 있어 지울 수 없습니다. 먼저 정리해 주세요`
                    : null,
                run: async () => {
                  await removeFloor(f.floorId);
                  setNode(null);
                  await afterWrite();
                },
              })
            }
          />
        ) : null}

        {node?.kind === 'spaces' ? (
          <SpacePanel
            /* ★ 층이 바뀌면 검색 조건을 초기화한다 — 빈 표를 고장으로 읽지 않게. */
            key={node.floorId}
            floor={floorOf(node.floorId)}
            codes={codes}
            spaces={spaces}
            busy={leafBusy}
            onAdd={(floorId) => setDialog({ kind: 'space', floorId, space: null })}
            onEdit={(s) => setDialog({ kind: 'space', floorId: s.floorId, space: s })}
            onDelete={(s) =>
              setDialog({
                kind: 'delete',
                what: 'space',
                label: s.roomName ?? '호실',
                blocked: spaceBlockReason(s),
                run: async () => {
                  await removeSpace(s.spaceId);
                  await afterWrite();
                },
              })
            }
          />
        ) : null}

        {node?.kind === 'facilities' ? (
          <MeetingRoomPanel
            floor={floorOf(node.floorId)}
            rooms={rooms}
            busy={leafBusy}
            onAdd={(floorId) => setDialog({ kind: 'facility', floorId, room: null })}
            onEdit={(r) => setDialog({ kind: 'facility', floorId: r.floorId ?? '', room: r })}
            onDelete={(r) =>
              setDialog({
                kind: 'delete',
                what: 'facility',
                label: r.name,
                blocked: meetingRoomBlockReason(r),
                run: async () => {
                  await removeMeetingRoom(r.facilityId);
                  await afterWrite();
                },
              })
            }
          />
        ) : null}
      </section>
      </div>

      {/* ── 팝업 5종 ────────────────────────────────────────────────────── */}
      {dialog?.kind === 'building' ? (
        <BuildingDialog building={dialog.building} onClose={() => setDialog(null)} onSaved={afterWrite} />
      ) : null}
      {dialog?.kind === 'floor' ? (
        <FloorDialog
          buildingId={dialog.buildingId}
          buildingName={buildingOf(dialog.buildingId)?.name ?? ''}
          floor={dialog.floor}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
        />
      ) : null}
      {dialog?.kind === 'space' ? (
        <SpaceDialog
          floorId={dialog.floorId}
          floorLabel={labelOfFloor(floorOf(dialog.floorId), buildings)}
          codes={codes}
          space={dialog.space}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
        />
      ) : null}
      {dialog?.kind === 'facility' ? (
        <MeetingRoomDialog
          floorId={dialog.floorId}
          floorLabel={labelOfFloor(floorOf(dialog.floorId), buildings)}
          room={dialog.room}
          onClose={() => setDialog(null)}
          onSaved={afterWrite}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteFacilityDialog
          kind={dialog.what}
          label={dialog.label}
          blocked={dialog.blocked}
          onClose={() => setDialog(null)}
          onDelete={dialog.run}
        />
      ) : null}
    </div>
  );
}

/** 「우리빌딩 · 3층」 — 팝업 머리에 어디를 고치는지 적는다. */
function labelOfFloor(floor: Floor | null, buildings: readonly Building[]): string {
  if (!floor) return '';
  const b = buildings.find((x) => x.buildId === floor.buildingId);
  return b ? `${b.name} · ${floorLabel(floor)}` : floorLabel(floor);
}

// =============================================================================
// 우측 4종 — **읽는 자리**다. 고치는 것은 팝업이 한다.
// =============================================================================

/**
 * 빈 자리 안내 — 아이콘 + 한 줄(+ 한 줄).
 *
 * ★ 입주사·계약의 `PanelEmpty` 와 **같은 모양**이다(아이콘 40px · 16px 머리줄). 글자만
 *   덩그러니 두면 「비어 있다」가 아니라 「덜 그려졌다」로 읽힌다.
 */
function PanelEmpty({ icon, lead, sub }: { icon: IconName; lead: string; sub?: string }) {
  return (
    <div className={styles.panelEmpty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={40} />
      </span>
      <p className={styles.emptyLead}>{lead}</p>
      {sub ? <p className={styles.emptySub}>{sub}</p> : null}
    </div>
  );
}

/**
 * 상세 한 칸.
 *
 * =============================================================================
 * ★★★ `<dt>`·`<dd>` 를 **`<div>` 하나로 묶는다** — 묶지 않으면 라벨과 값이 어긋난다
 * =============================================================================
 * 예전에는 둘을 그대로 내보냈다. 바깥이 3칸 격자(`.grid3`)라 **2칸짜리 쌍이 3칸에 안
 * 떨어져** 「건물주」 다음 칸에 값이 아니라 다음 라벨이 왔다(2026-10-03 캡처).
 * HTML5 는 `dl > div > (dt, dd)` 를 허용한다 — 격자 칸은 이제 쌍 하나다.
 */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={styles.def}>
      <dt className={styles.defLabel}>{label}</dt>
      <dd className={styles.defValue}>{dash(value)}</dd>
    </div>
  );
}

function BuildingPanel({
  building,
  floorCount,
  onEdit,
  onAddFloor,
  onDelete,
}: {
  building: Building | null;
  floorCount: number;
  onEdit: (b: Building) => void;
  onAddFloor: (buildingId: string) => void;
  onDelete: (b: Building) => void;
}) {
  if (!building) return <p className={styles.hint}>건물을 찾을 수 없습니다.</p>;
  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>{building.name}</h2>
          <p className={styles.panelSub}>
            {building.address ?? '주소 없음'} · 층 {floorCount}개
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={() => onAddFloor(building.buildId)}>
            <Icon name="plus" size={16} />
            층 추가
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEdit(building)}>
            수정
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(building)}>
            삭제
          </Button>
        </div>
      </div>

      <dl className={styles.defs}>
        <Row label="건물주" value={building.ownerName} />
        <Row label="건물주 연락처" value={building.ownerPhone} />
        <Row label="사업자등록번호" value={building.bizRegNo} />
        <Row label="센터장" value={building.centerManager} />
        <Row label="임대 계약기간" value={[building.contractFrom, building.contractTo].filter(Boolean).join(' ~ ')} />
        <Row label="비고" value={building.memo} />
        <Row label="은행명" value={building.bankName} />
        <Row label="계좌번호" value={building.bankAccount} />
        <Row label="예금주" value={building.accountHolder} />
      </dl>
    </>
  );
}

function FloorPanel({
  floor,
  buildingName,
  onEdit,
  onDelete,
}: {
  floor: Floor | null;
  buildingName: string;
  onEdit: (f: Floor) => void;
  onDelete: (f: Floor) => void;
}) {
  if (!floor) return <p className={styles.hint}>층을 찾을 수 없습니다.</p>;
  const facilities = [
    floor.hasLounge ? '라운지' : null,
    floor.hasMeetingRoom ? '회의실' : null,
    floor.hasOaZone ? 'OA존' : null,
  ].filter((v): v is string => v !== null);

  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>{floorLabel(floor)}</h2>
          <p className={styles.panelSub}>
            {buildingName} · 호실 {floor.spaceCount}실 · 회의실 {floor.facilityCount}개
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="ghost" onClick={() => onEdit(floor)}>
            수정
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(floor)}>
            삭제
          </Button>
        </div>
      </div>

      <dl className={styles.defs}>
        {/* ★ `37.00` 이 아니라 `37` 이다 — DB 가 numeric 이라 꼬리에 0 이 붙어 온다. */}
        <Row label="평수" value={area(floor.areaSqm)} />
        <Row label="월임대료" value={money(floor.monthlyRent)} />
        <Row label="보증금" value={money(floor.deposit)} />
        <Row label="층 시설" value={facilities.join(' · ')} />
      </dl>
    </>
  );
}

function SpacePanel({
  floor,
  codes,
  spaces,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: {
  floor: Floor | null;
  codes: readonly CodeItem[];
  spaces: readonly Space[];
  /** 받아 오는 중인가. ★ 「없음」과 가른다 — 아래 주석 참고. */
  busy: boolean;
  onAdd: (floorId: string) => void;
  onEdit: (s: Space) => void;
  onDelete: (s: Space) => void;
}) {
  /*
   * 검색 조건 둘. `null` 이면 「전체」다.
   *
   * ★ 층을 옮기면 초기화된다 — `FacilityView` 가 `key={floorId}` 로 다시 만든다.
   *   3층에서 「비상주」만 보다가 4층으로 갔는데 빈 표가 나오면 고장으로 읽힌다.
   * ★★ 훅은 **이른 return 앞**에 둔다. 아래 `!floor` 는 층이 아직 안 온 순간이고,
   *    그때 훅을 건너뛰면 다음 렌더에서 훅 수가 달라져 React 가 터진다.
   */
  const [roomType, setRoomType] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  /* 한쪽 조건만 적용한 것 — **다른 쪽 칩의 수**가 이 위에서 세어진다. */
  const byType = roomType === null ? spaces : spaces.filter((s) => s.roomType === roomType);
  const byStatus = status === null ? spaces : spaces.filter((s) => s.status === status);
  /* 둘 다 적용한 것 — 표가 그리는 줄이다. */
  const visible = byType.filter((s) => status === null || s.status === status);
  const filtered = roomType !== null || status !== null;
  const hint = filtered ? `${visible.length} / ${spaces.length}실` : `${spaces.length}실`;

  if (!floor) return <p className={styles.hint}>층을 찾을 수 없습니다.</p>;
  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>호실관리</h2>
          <p className={styles.panelSub}>
            {/* ★ 받아 오는 중에는 수를 적지 않는다 — 0 이라고 적으면 거짓이다. */}
            {floorLabel(floor)} · {busy ? '불러오는 중…' : hint}
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={() => onAdd(floor.floorId)}>
            <Icon name="plus" size={16} />
            호실 추가
          </Button>
        </div>
      </div>

      {/*
        ── 검색 조건 둘 ────────────────────────────────────────────────────
        ★★ 값은 **코드 마스터에서 읽는다**(`ROOM_TP`·`ROOM_ST`). 문자열을 박으면
           코드 테이블에 값이 하나 늘 때 이 화면만 그것을 모른다.
        ★ 모양은 청구 화면의 칩과 같다(`billing.module.css` `.chipRow`/`.chip`/`.chipOn`) —
          28px 알약 · 고른 것 하나 · 다시 누르면 꺼진다.
        ★★ 칩의 수는 **다른 조건을 적용한 뒤**의 수다. 둘이 독립이라 전체 기준으로 세면
           「1인실 10」을 눌렀는데 0줄이 나오는 일이 생긴다 — 적힌 수가 곧 보게 될 줄 수다.
      */}
      {!busy && spaces.length > 0 ? (
        <div className={styles.filters}>
          <div className={styles.filterRow}>
            <span className={styles.filterLabel}>계약구분</span>
            <div className={styles.chipRow}>
              <button
                type="button"
                className={`${styles.chip}${roomType === null ? ` ${styles.chipOn}` : ''}`}
                onClick={() => setRoomType(null)}
              >
                전체 {byStatus.length}
              </button>
              {codesOf(codes, 'ROOM_TP').map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className={`${styles.chip}${roomType === c.code ? ` ${styles.chipOn}` : ''}`}
                  onClick={() => setRoomType(roomType === c.code ? null : c.code)}
                >
                  {c.name} {byStatus.filter((s) => s.roomType === c.code).length}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filterRow}>
            <span className={styles.filterLabel}>호실상태</span>
            <div className={styles.chipRow}>
              <button
                type="button"
                className={`${styles.chip}${status === null ? ` ${styles.chipOn}` : ''}`}
                onClick={() => setStatus(null)}
              >
                전체 {byType.length}
              </button>
              {codesOf(codes, 'ROOM_ST').map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className={`${styles.chip}${status === c.code ? ` ${styles.chipOn}` : ''}`}
                  onClick={() => setStatus(status === c.code ? null : c.code)}
                >
                  {c.name} {byType.filter((s) => s.status === c.code).length}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {busy ? (
        <p className={styles.hint}>불러오는 중…</p>
      ) : spaces.length === 0 ? (
        <PanelEmpty icon="package-open" lead="등록된 호실이 없습니다" sub="[호실 추가] 로 만들어 주세요" />
      ) : visible.length === 0 ? (
        /* ★ 「호실이 없다」와 다른 말이다 — 거른 결과가 없을 뿐이다. */
        <PanelEmpty icon="search" lead="조건에 맞는 호실이 없습니다" sub="위의 조건을 바꾸거나 [전체] 를 눌러 주세요" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>호실명</th>
                <th>계약구분</th>
                <th>호실상태</th>
                <th className={styles.center}>주소제공</th>
                <th className={styles.num}>월임대료</th>
                <th className={styles.num}>보증금</th>
                <th className={styles.center}>사용</th>
                {/*
                  ★★★ 계약 수를 적는 칸은 **없다**(결정 2026-10-03). 호실 관리는
                       **재실여부만** 다룬다 — 지금 이 방에 누가 들어 있는가는 위의
                       「호실상태」 한 칸이 말한다(공실 · 입주중 · 예약중).

                  ★ 그 전에는 「사용 중」·「전체 이력」 두 칸이 있었다. 세는 값은 지금도
                    서버가 내려주고(`liveContracts`·`allContracts`), 「왜 못 지우는지」
                    문구에 쓴다(`deleteBlockMessage`) — 표에만 안 그린다.

                  ★ 「입주 가능 회사 수」도 여기 적지 않는다. p3 팝업의 칸이다.
                */}
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.spaceId} className={s.isActive ? undefined : styles.rowOff}>
                  <td>
                    <button type="button" className={styles.rowBtn} onClick={() => onEdit(s)}>
                      {s.roomName ?? '—'}
                    </button>
                  </td>
                  <td>{codeName(codes, 'ROOM_TP', s.roomType)}</td>
                  <td>{codeName(codes, 'ROOM_ST', s.status)}</td>
                  <td className={styles.center}>
                    {/* ★ 날값 Y/N 이 아니다 — 같은 표의 「사용」과 같은 태그로 그린다. */}
                    <span className={`${styles.tag} ${s.bizAddrAvailable ? styles.tagOn : styles.tagOff}`}>
                      {s.bizAddrAvailable ? '제공' : '안 함'}
                    </span>
                  </td>
                  <td className={styles.num}>{money(s.standardFee)}</td>
                  <td className={styles.num}>{money(s.deposit)}</td>
                  <td className={styles.center}>
                    <span className={`${styles.tag} ${s.isActive ? styles.tagOn : styles.tagOff}`}>
                      {s.isActive ? '사용' : '사용 안 함'}
                    </span>
                  </td>
                  <td className={styles.center}>
                    {/* ★ 표 안 버튼은 30px 다 — 청구 화면과 같은 값(`.btnXs`). */}
                    <button type="button" className={styles.btnXs} onClick={() => onDelete(s)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function MeetingRoomPanel({
  floor,
  rooms,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: {
  floor: Floor | null;
  rooms: readonly MeetingRoom[];
  busy: boolean;
  onAdd: (floorId: string) => void;
  onEdit: (r: MeetingRoom) => void;
  onDelete: (r: MeetingRoom) => void;
}) {
  if (!floor) return <p className={styles.hint}>층을 찾을 수 없습니다.</p>;
  return (
    <>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>회의실관리</h2>
          <p className={styles.panelSub}>
            {floorLabel(floor)} · {busy ? '불러오는 중…' : `${rooms.length}개`}
          </p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="primary" onClick={() => onAdd(floor.floorId)}>
            <Icon name="plus" size={16} />
            회의실 추가
          </Button>
        </div>
      </div>

      {busy ? (
        <p className={styles.hint}>불러오는 중…</p>
      ) : rooms.length === 0 ? (
        <PanelEmpty icon="door-open" lead="등록된 회의실이 없습니다" sub="[회의실 추가] 로 만들어 주세요" />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>회의실명</th>
                <th className={styles.num}>수용인원</th>
                <th className={styles.num}>30분당 요금</th>
                <th>운영시간</th>
                <th className={styles.center}>예약</th>
                <th className={styles.center}>걸린 예약</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.facilityId} className={r.isReservable ? undefined : styles.rowOff}>
                  <td>
                    <button type="button" className={styles.rowBtn} onClick={() => onEdit(r)}>
                      {r.name}
                    </button>
                  </td>
                  <td className={styles.num}>{r.capacity ?? '—'}</td>
                  <td className={styles.num}>{money(r.halfHourFee)}</td>
                  <td>{[r.openTime, r.closeTime].filter(Boolean).join(' ~ ') || '—'}</td>
                  <td className={styles.center}>
                    <span className={`${styles.tag} ${r.isReservable ? styles.tagOn : styles.tagOff}`}>
                      {r.isReservable ? '받음' : '받지 않음'}
                    </span>
                  </td>
                  <td className={styles.center}>
                    {r.liveReservations > 0 ? (
                      <span className={`${styles.tag} ${styles.tagWarn}`}>{r.liveReservations}건</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={styles.center}>
                    <button type="button" className={styles.btnXs} onClick={() => onDelete(r)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
