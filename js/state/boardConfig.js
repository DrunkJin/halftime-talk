// 이사회: 시즌 목표·신뢰도·경질·이직 제안 수치. 문구는 data/board.json
export const BOARD = {
  start: 60, // 처음 신뢰도 (새 구단 부임도 같다)
  // 목표 순위 = 시즌 전 전력 순위 + slack (강등권 위로는 내려가지 않게)
  slack: 1,
  defaultRelegationSpots: 3,
  // 목표 이름 (목표 순위 / 리그 크기 기준)
  labels: [
    { maxTarget: 1, kind: 'title', label: '리그 우승' },
    { maxShare: 0.2, kind: 'top', label: '{target}위 이내 (상위권)' },
    { maxShare: 0.5, kind: 'upper', label: '{target}위 이내 (중상위권)' },
    { maxShare: 0.75, kind: 'mid', label: '{target}위 이내 (중위권)' },
    { maxShare: 1, kind: 'survive', label: '잔류 ({target}위 이내)' },
  ],

  // 라운드마다: 신뢰도 += (목표 - 현재 순위) / 리그 크기 × positionWeight × 진행률 + 경기 결과
  positionFromRound: 5, // 이 라운드부터 순위를 본다
  positionWeight: 10,
  result: { W: 1.2, D: 0, L: -1.4 },
  // 신뢰도 구간 알림 (내려갈 때 한 번씩)
  warnBelow: 35,
  ultimatumBelow: 20,
  praiseAbove: 82,
  // 경질: 시즌 진행률 sackFrom 이후 신뢰도가 sackBelow 이하, 또는 시즌 끝 평가 뒤 seasonEndSackBelow 미만
  sackFrom: 0.25,
  sackBelow: 10,
  seasonEndSackBelow: 25,

  // 시즌 끝 평가: 목표 대비 순위 차 (+면 목표보다 위)
  season: {
    exceeded: { from: 3, delta: 28 },
    met: { from: 0, delta: 16 },
    missedSlightly: { from: -2, delta: -10 },
    missedBadly: { from: -99, delta: -28 },
    trophy: 18, // 트로피 하나당
    promoted: 25,
    relegated: -50,
  },
  carryOver: 0.6, // 다음 시즌 신뢰도 = 60 + (지금 - 60) × carryOver

  // 이직 제안 (전력 = 주전 11명 평균 OVR)
  offers: {
    goodFrom: 72, // 시즌 끝 신뢰도가 이 이상이고 목표를 넘었거나 트로피를 들면 더 강한 구단 제안
    better: [1, 7], // 우리보다 전력이 이만큼 높은 구단
    worse: [1, 9], // 경질 때: 우리보다 이만큼 낮은 구단
    count: [1, 3],
    sameCountryWeight: 3, // 같은 나라 구단이 먼저 연락한다
  },
};
