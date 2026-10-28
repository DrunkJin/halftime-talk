// 포메이션. 엔진은 슬롯 포지션 배열(slots)만 보고, 피치 위 위치는 격자 칸(cells)으로 표현한다.
// 선발 명단 배열의 i번째 선수가 slots[i] / cells[i]에 선다.

// 격자: 열 0~4 (왼쪽 끝 → 오른쪽 끝), 행 0~5 (0 = GK, 1 = 수비 … 5 = 공격)
export const GRID_COLUMNS = 5;
export const GRID_ROWS = 6;
export const GK_ROW = 0;
export const ROW_NAMES = ['골키퍼', '수비', '수비형 미드필드', '미드필드', '공격형 미드필드', '공격'];

// 칸 → 포지션. 측면 끝 칸은 풀백/윙어 계열, 안쪽 3칸은 중앙 포지션
const ROW_POSITIONS = [
  ['GK', 'GK', 'GK', 'GK', 'GK'],
  ['LB', 'CB', 'CB', 'CB', 'RB'],
  ['LB', 'DM', 'DM', 'DM', 'RB'], // 측면은 윙백
  ['LW', 'CM', 'CM', 'CM', 'RW'], // 측면 미드필더는 LW/RW로 취급 (데이터에 LM/RM 없음)
  ['LW', 'AM', 'AM', 'AM', 'RW'],
  ['LW', 'ST', 'ST', 'ST', 'RW'],
];

export const positionOfCell = ([col, row]) => ROW_POSITIONS[row][col];
export const slotsFromCells = (cells) => cells.map(positionOfCell);

// 프리셋. GK가 항상 0번
export const FORMATION_CELLS = {
  '4-3-3': [[2, 0], [0, 1], [1, 1], [3, 1], [4, 1], [2, 2], [1, 3], [3, 3], [0, 5], [4, 5], [2, 5]],
  '4-4-2': [[2, 0], [0, 1], [1, 1], [3, 1], [4, 1], [0, 3], [1, 3], [3, 3], [4, 3], [1, 5], [3, 5]],
  '4-2-3-1': [[2, 0], [0, 1], [1, 1], [3, 1], [4, 1], [1, 2], [3, 2], [0, 4], [2, 4], [4, 4], [2, 5]],
  '4-1-4-1': [[2, 0], [0, 1], [1, 1], [3, 1], [4, 1], [2, 2], [0, 3], [1, 3], [3, 3], [4, 3], [2, 5]],
  '3-5-2': [[2, 0], [1, 1], [2, 1], [3, 1], [0, 2], [4, 2], [2, 2], [1, 3], [3, 3], [1, 5], [3, 5]], // 윙백은 수비형 미드 줄 양끝
  '3-4-3': [[2, 0], [1, 1], [2, 1], [3, 1], [0, 3], [1, 3], [3, 3], [4, 3], [0, 5], [2, 5], [4, 5]],
  '5-3-2': [[2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 3], [2, 3], [3, 3], [1, 5], [3, 5]],
};

// AI 팀이 고르는 후보 (계산 비용 때문에 대표적인 것만)
export const AI_FORMATION_CANDIDATES = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '5-3-2'];

export const FORMATIONS = Object.fromEntries(
  Object.entries(FORMATION_CELLS).map(([id, cells]) => [id, slotsFromCells(cells)]),
);
export const FORMATION_IDS = Object.keys(FORMATIONS);

// 행별 인원으로 이름을 만든다 (GK 제외, 빈 행 생략). 예: 4-1-2-3
export function formationName(cells) {
  const counts = new Array(GRID_ROWS).fill(0);
  for (const [, row] of cells) counts[row]++;
  return counts.slice(1).filter((n) => n > 0).join('-');
}

// 표시용 이름: 프리셋과 같은 배치면 프리셋 이름(4-3-3), 아니면 행별 인원(4-1-2-1-2)
export function formationLabel(cells) {
  const same = (a, b) => a.length === b.length && a.every((c, i) => c[0] === b[i][0] && c[1] === b[i][1]);
  return FORMATION_IDS.find((id) => same(FORMATION_CELLS[id], cells)) ?? formationName(cells);
}

// 포메이션 ID 또는 슬롯 배열 → 슬롯 배열
export function resolveSlots(formationOrSlots) {
  if (Array.isArray(formationOrSlots)) return formationOrSlots;
  const slots = FORMATIONS[formationOrSlots];
  if (!slots) throw new Error(`알 수 없는 포메이션: ${formationOrSlots}`);
  return slots;
}
