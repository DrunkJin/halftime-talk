// 이적시장 수치. 선수 가치·예산은 데이터가 아니라 게임 공식으로 계산한다 (금액 단위: 백만 파운드)

export const MARKET = {
  // 이적시장이 열리는 구간: 시즌 진행률(0~1) 기준이라 라운드 수가 다른 리그에도 맞는다
  // (38라운드 리그면 여름 1~3라운드, 겨울 19~22라운드)
  windows: [
    { name: '여름 이적시장', from: 0, to: 0.08 },
    { name: '겨울 이적시장', from: 0.48, to: 0.58 },
  ],

  // 가치 = exp((OVR - ovrBase) / ovrScale) × 나이 배율 × (GK면 gkFactor)
  value: {
    ovrBase: 55,
    ovrScale: 7,
    ageFactors: [[21, 1.3], [24, 1.15], [28, 1], [30, 0.8], [32, 0.55], [99, 0.3]], // [이 나이 이하, 배율]
    gkFactor: 0.6,
    min: 0.3,
  },

  // 시작 예산 = base + (선발 평균 OVR - refOvr) × perOvr
  budget: { base: 40, refOvr: 72, perOvr: 9, min: 10 },

  // 판매 구단 요구액 = 가치 × 팀 내 역할 배율 (OVR 순위로 판단)
  asking: { keyUntilRank: 11, key: 1.5, rotationUntilRank: 18, rotation: 1.2, fringe: 1.0 },
  // 제안액 / 요구액 비율: rejectBelow 이하면 거절, certainAbove 이상이면 수락, 사이는 확률
  acceptance: { rejectBelow: 0.85, certainAbove: 1.15 },

  // 판매 시 AI 구단 제안: 선발 평균 OVR - interestGap 이상인 선수에 관심
  sellOffers: { max: 3, minRatio: 0.75, maxRatio: 1.1, interestGap: 6 },
};

// 재정·계약. 금액 단위: 잔고·수입은 백만 파운드(£M), 주급은 천 파운드/주(£k)
export const FINANCE = {
  // 기본 주급 = 가치(£M) × wagePerValue × 리그 주급 배율 (최소 minWage)
  wagePerValue: 2.6,
  minWage: 1,
  // 약한 리그일수록 선수 가치(OVR 기반)가 낮으므로 가치 대비 주급 배율은 오히려 높다.
  // 리그 주전급 평균 주급이 대략 맞도록: EPL ~£80k, 라리가 ~£45k, 챔피언십 ~£15k, 사우디 ~£40k, MLS ~£10k, K리그1 ~£4k
  leagueWageFactor: {
    epl: 1.0, laliga: 0.85, 'serie-a': 0.85, bundesliga: 0.85, 'ligue-1': 0.85, championship: 1.6,
    eredivisie: 0.8, 'primeira-liga': 0.8, 'belgian-pro-league': 0.8, 'super-lig': 1.5,
    'saudi-pro-league': 3.0, mls: 2.0, 'liga-mx': 2.0, brasileirao: 1.5, 'liga-profesional': 1.0,
    'j1-league': 1.5, 'k-league-1': 1.5, 'k-league-2': 1.0,
  },
  defaultWageFactor: 1.0,
  // 데이터에 계약 정보가 없으므로 남은 계약 기간을 선수 ID로 고정 생성 [최소, 최대] 시즌
  contractYears: { young: [2, 5], prime: [1, 4], veteran: [1, 2] }, // 23세 이하 / 30세 이하 / 그 이상

  // 시즌 수입 = 시즌 시작 주급 총액(연간, £M) × 명성 배율. 리그 안 전력 순위 1위 max ~ 꼴찌 min
  // 주급만 내면 흑자가 남지만 상금·이적에 쓰도록 여유는 작게
  revenueRatio: { min: 1.08, max: 1.25 },
  revenueSplit: { tv: 0.45, gate: 0.25, commercial: 0.3 },
  startingBalance: 0.3, // 시작 잔고 = 시즌 수입 × 이 값
  prizeShare: 0.1, // 시즌 종료 상금: 1위 = 시즌 수입 × 이 값, 꼴찌 0 (순위 따라 선형)
  // 주급 한도 = 시즌 시작 주급 총액 × (min ~ max, 명성 높을수록 여유). 시작부터 한도를 넘는 구단이 없도록 1 이상
  wageHeadroom: { min: 1.05, max: 1.2 },
  weeksPerSeason: 52,

  // 이적 시 선수 요구 주급 = max(지금 주급, 새 리그 기준 주급) × signingRaise
  signingRaise: 1.1,
  renewalRaise: 1.1,
  releaseCompensation: 0.5, // 계약 해지 위약금 = 남은 계약 기간 총주급 × 이 값
  shortContractDiscount: 0.7, // 계약이 1시즌 이하 남은 선수는 요구 이적료 × 이 값
};

// AI 구단 이적 (이적시장 기간에 라운드마다)
export const AI_MARKET = {
  activeChance: 0.18, // 라운드마다 각 AI 구단이 영입을 시도할 확률
  upgradeMin: 3, // 지금 주전보다 이만큼 이상 좋아야 영입
  maxFeeShare: 0.5, // 잔고 대비 최대 이적료 비율
  maxAge: 31,
  candidatesPerSearch: 400, // OVR 상위 후보에서만 찾는다 (속도)
  // 우리 선수에게 들어오는 제안
  incomingChance: 0.08, // 라운드마다 주전급 선수 한 명당
  incomingRatio: [0.9, 1.25], // 가치 대비 제안 금액
  offerLifetime: 2, // 제안 유효 라운드
};
