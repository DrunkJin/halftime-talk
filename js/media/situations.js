// 인터뷰·팀 토크 상황 정의. 문구는 data/interviews/*.json, 효과 수치는 js/engine/config.js(MORALE)
// 이 파일이 문구 데이터의 계약이다: 상황 id, 답변 성향(stance), 상황별로 쓸 수 있는 치환 자리
//
// 데이터 형식 (kind별 파일 하나):
// { schemaVersion: 1, kind, situations: { [상황 id]: { questions: [문자열], answers: [{ stance, text }] } } }
//   questions: 기자 질문 (talk는 라커룸 분위기 묘사)
//   answers: 감독의 답 (talk는 선수단에게 하는 말)
//   문자열 안의 {자리}는 경기 상황에 맞게 바뀐다. 자리 바로 뒤에 조사(을/를, 이/가 등)를 붙이지 말 것

export const INTERVIEW_SCHEMA_VERSION = 1;

// 모든 상황에서 쓸 수 있는 자리
const COMMON = {
  pre: ['team', 'opponent', 'venue', 'player', 'oppPlayer'],
  post: ['team', 'opponent', 'venue', 'score'],
  talk: ['team', 'opponent', 'score', 'player'],
};

// 자리 설명 (작성·검증 도구용)
export const PLACEHOLDERS = {
  team: '우리 팀 이름',
  opponent: '상대 팀 이름',
  venue: "'홈' 또는 '원정'",
  player: '우리 팀 핵심 선수 이름 (지금 뛰는 선수 중 OVR 최고)',
  oppPlayer: '상대 팀 핵심 선수 이름',
  rank: '우리 순위 (숫자만, 예: 3)',
  oppRank: '상대 순위 (숫자만)',
  streak: '연속 경기 수 (숫자만)',
  absent: '결장하는 우리 핵심 선수 이름',
  absentCount: '결장 중인 주전 수 (숫자만)',
  signing: '이번 이적시장에 영입한 선수 이름',
  lastScore: "직전 맞대결/직전 경기 스코어 (예: '1-3', 우리 점수가 앞)",
  lastOpponent: '직전 경기 상대 팀 이름',
  derby: "더비 이름 (예: '북런던 더비', '엘 클라시코', '슈퍼매치')",
  competition: "대륙 대회 이름 ('챔피언스리그' 또는 '유로파리그')",
  stage: "토너먼트 단계 ('플레이오프', '16강', '8강', '4강', '결승')",
  aggregate: "2차전 합계 스코어 (예: '2-3', 우리 점수가 앞)",
  firstLeg: "1차전 스코어 (예: '0-1', 우리 점수가 앞)",
  cupRank: '리그 페이즈 우리 순위 (숫자만)',
  matchday: '리그 페이즈 몇 번째 경기인지 (숫자만)',
  score: "스코어 (예: '2-1', 우리 점수가 앞)",
  scorer: '이 경기 우리 팀 득점자 (여러 명이면 가장 많이 넣은 선수)',
  minute: '결정적 골이 나온 분 (숫자만)',
  redPlayer: '퇴장당한 선수 이름',
  injured: '부상당한 우리 선수 이름',
};

// 답변 성향. 효과는 성향 단위로 정해지고(config.js MORALE), 문구는 같은 성향 안의 변주다
export const STANCES = {
  pre: {
    confident: '자신감',
    cautious: '신중',
    respect: '상대 존중',
    demand: '선수단에 요구',
    deflect: '말 아끼기',
  },
  post: {
    praise: '선수단 칭찬',
    critical: '쓴소리',
    blame: '외부 탓',
    humble: '차분하게',
    forward: '다음 경기로',
  },
  talk: {
    praise: '칭찬',
    encourage: '격려',
    demand: '질책',
    calm: '침착하게',
    passion: '열정 호소',
  },
};

// 상황: 설명(작성 가이드), 추가로 쓸 수 있는 자리. 순서 = 우선순위 (앞일수록 구체적)
export const SITUATIONS = {
  pre: {
    // ── 대륙 대회 (대륙 대회 경기에서만) ──
    cupFinal: { desc: '대륙 대회 결승 (중립 경기장 단판)', extra: ['competition', 'stage'], cup: true },
    cupSecondLegBehind: { desc: '토너먼트 2차전, 1차전에서 져서 뒤집어야 함', extra: ['competition', 'stage', 'firstLeg'], cup: true },
    cupSecondLegAhead: { desc: '토너먼트 2차전, 1차전에서 이겨 앞선 상태', extra: ['competition', 'stage', 'firstLeg'], cup: true },
    cupSecondLegLevel: { desc: '토너먼트 2차전, 1차전 무승부', extra: ['competition', 'stage', 'firstLeg'], cup: true },
    cupFirstLeg: { desc: '토너먼트 1차전', extra: ['competition', 'stage'], cup: true },
    cupLeaguePhaseDecider: { desc: '리그 페이즈 막판(7~8차전), 순위 경계(8위·24위 근처)라 결과가 중요', extra: ['competition', 'cupRank', 'matchday'], cup: true },
    cupOpener: { desc: '리그 페이즈 첫 경기, 대륙 대회 시즌 시작', extra: ['competition'], cup: true },
    cupNight: { desc: '리그 페이즈 일반 경기 (유럽의 밤)', extra: ['competition', 'cupRank', 'matchday'], cup: true },
    // ── 리그 ──
    finalRound: { desc: '시즌 마지막 라운드', extra: ['rank', 'oppRank'] },
    seasonOpener: { desc: '시즌 개막전 (순위 언급 금지)', extra: [] },
    derby: { desc: '라이벌전·더비 (data/rivalries.json)', extra: ['derby', 'rank', 'oppRank'] },
    titleRace: { desc: '시즌 후반, 우리가 우승 경쟁 중 (1~2위권)', extra: ['rank', 'oppRank'] },
    relegationBattle: { desc: '시즌 후반, 우리가 강등권이나 그 바로 위', extra: ['rank', 'oppRank'] },
    topClash: { desc: '상위권끼리 맞대결 (둘 다 4위 이내)', extra: ['rank', 'oppRank'] },
    injuryCrisis: { desc: '주전급 여러 명이 부상·징계로 결장', extra: ['absentCount'] },
    keyPlayerOut: { desc: '우리 최고 선수가 결장', extra: ['absent'] },
    revenge: { desc: '이번 시즌 앞선 맞대결에서 졌던 상대', extra: ['lastScore'] },
    loseStreak: { desc: '연패 중 (3연패 이상)', extra: ['streak', 'rank'] },
    winless: { desc: '오래 승리가 없음 (5경기 이상 무승, 연패는 아님)', extra: ['streak', 'rank'] },
    winStreak: { desc: '연승 중 (3연승 이상)', extra: ['streak', 'rank'] },
    unbeaten: { desc: '무패 행진 중 (5경기 이상 무패, 연승은 아님)', extra: ['streak', 'rank'] },
    afterBigLoss: { desc: '직전 경기에서 3골 차 이상 대패', extra: ['lastScore', 'lastOpponent'] },
    afterBigWin: { desc: '직전 경기에서 3골 차 이상 대승', extra: ['lastScore', 'lastOpponent'] },
    newSigning: { desc: '이번 이적시장에 영입한 선수가 처음 선발로 나서는 경기', extra: ['signing'] },
    underdog: { desc: '상대가 전력상 확실히 강함', extra: ['oppRank'] },
    heavyFavorite: { desc: '우리가 전력상 확실히 강함', extra: ['oppRank'] },
    evenMatch: { desc: '비슷한 전력끼리', extra: [] },
    generic: { desc: '특별한 상황 없음 (어느 경기에나 어울리는 일반 질문)', extra: [] },
  },
  post: {
    // ── 대륙 대회 ──
    cupWonTrophy: { desc: '대륙 대회 우승 (결승 승리)', extra: ['competition', 'scorer'], cup: true },
    cupLostFinal: { desc: '대륙 대회 결승 패배', extra: ['competition'], cup: true },
    cupPenaltyWin: { desc: '토너먼트 승부차기 끝에 진출', extra: ['competition', 'stage'], cup: true },
    cupPenaltyLoss: { desc: '토너먼트 승부차기 끝에 탈락', extra: ['competition', 'stage'], cup: true },
    cupAdvanced: { desc: '토너먼트 2차전 후 다음 단계 진출 확정', extra: ['competition', 'stage', 'aggregate'], cup: true },
    cupEliminated: { desc: '토너먼트 2차전 후 탈락', extra: ['competition', 'stage', 'aggregate'], cup: true },
    cupLeaguePhaseQualified: { desc: '리그 페이즈를 마치며 토너먼트 진출 (8위 이내 직행 또는 플레이오프)', extra: ['competition', 'cupRank'], cup: true },
    cupLeaguePhaseOut: { desc: '리그 페이즈를 마치며 탈락 (25위 이하)', extra: ['competition', 'cupRank'], cup: true },
    cupFirstLegResult: { desc: '토너먼트 1차전을 마침 (결과는 다양, 2차전이 남음)', extra: ['competition', 'stage'], cup: true },
    cupNightResult: { desc: '리그 페이즈 경기를 마침 (결과는 다양)', extra: ['competition', 'cupRank', 'matchday'], cup: true },
    // ── 리그 ──
    seasonEndHigh: { desc: '시즌 마지막 경기 후, 상위권(우승·대륙 대회권)으로 마침', extra: ['rank'] },
    seasonEndLow: { desc: '시즌 마지막 경기 후, 하위권으로 마침', extra: ['rank'] },
    hatTrick: { desc: '우리 선수가 해트트릭 (결과와 무관, 대개 승리)', extra: ['scorer'] },
    derbyWin: { desc: '라이벌전·더비 승리', extra: ['derby', 'scorer'] },
    derbyLoss: { desc: '라이벌전·더비 패배', extra: ['derby'] },
    comebackWin: { desc: '먼저 실점했다가 역전승', extra: ['scorer'] },
    collapse: { desc: '앞서다가 역전패', extra: [] },
    lateWinner: { desc: '85분 이후 결승골로 승리', extra: ['scorer', 'minute'] },
    lateEqualiserFor: { desc: '85분 이후 동점골로 무승부', extra: ['scorer', 'minute'] },
    lateEqualiserAgainst: { desc: '85분 이후 동점골을 내줘 무승부', extra: ['minute'] },
    upsetWin: { desc: '전력상 약한 우리가 강팀을 이김', extra: ['scorer'] },
    upsetLoss: { desc: '전력상 강한 우리가 약팀에 짐', extra: [] },
    redCardUs: { desc: '우리 선수가 퇴장당한 경기 (결과는 다양)', extra: ['redPlayer'] },
    heavyLoss: { desc: '3골 차 이상 패배', extra: [] },
    bigWin: { desc: '3골 차 이상 승리', extra: ['scorer'] },
    dominatedButLost: { desc: '경기 내용(슈팅·기대 득점)은 앞섰는데 짐', extra: [] },
    luckyWin: { desc: '경기 내용은 밀렸는데 이김', extra: ['scorer'] },
    redCardThem: { desc: '상대 선수가 퇴장당한 경기 (결과는 다양)', extra: [] },
    injuryBlow: { desc: '경기 중 우리 핵심 선수가 부상', extra: ['injured'] },
    winStreak: { desc: '이 승리로 연승 이어감 (3연승 이상)', extra: ['streak', 'scorer'] },
    loseStreak: { desc: '이 패배로 연패 (3연패 이상)', extra: ['streak'] },
    cleanSheetWin: { desc: '무실점 승리', extra: ['scorer'] },
    narrowWin: { desc: '1골 차 승리', extra: ['scorer'] },
    win: { desc: '일반적인 승리', extra: ['scorer'] },
    goallessDraw: { desc: '0-0 무승부', extra: [] },
    draw: { desc: '골이 나온 무승부', extra: ['scorer'] },
    narrowLoss: { desc: '1골 차 패배', extra: [] },
    loss: { desc: '일반적인 패배', extra: [] },
  },
  talk: {
    // ── 대륙 대회 ──
    cupExtraTime: { desc: '90분 종료 후 연장전 직전 (합계 동점, 지친 선수들)', extra: ['competition', 'stage', 'aggregate'], cup: true },
    cupFinalHalftime: { desc: '대륙 대회 결승 하프타임 (스코어 다양)', extra: ['competition'], cup: true },
    cupSecondLegChasing: { desc: '토너먼트 2차전 하프타임, 합계에서 뒤짐', extra: ['competition', 'stage', 'aggregate'], cup: true },
    cupSecondLegProtecting: { desc: '토너먼트 2차전 하프타임, 합계에서 앞섬', extra: ['competition', 'stage', 'aggregate'], cup: true },
    // ── 리그 ──
    redCardUs: { desc: '전반에 우리 선수가 퇴장당해 10명', extra: ['redPlayer'] },
    redCardThem: { desc: '전반에 상대가 퇴장당해 수적 우위', extra: [] },
    derbyTrailing: { desc: '라이벌전·더비에서 지고 있음', extra: ['derby'] },
    derbyLeading: { desc: '라이벌전·더비에서 이기고 있음', extra: ['derby'] },
    favoriteTrailing: { desc: '강팀인 우리가 지고 있음', extra: [] },
    underdogLeading: { desc: '약팀인 우리가 이기고 있음', extra: [] },
    trailingHeavy: { desc: '2골 차 이상 지고 있음', extra: [] },
    trailingNarrow: { desc: '1골 차로 지고 있음', extra: [] },
    leadingComfortably: { desc: '2골 차 이상 이기고 있음', extra: [] },
    leadingNarrow: { desc: '1골 차로 이기고 있음', extra: [] },
    drawingGood: { desc: '비기고 있지만 경기 내용은 우리가 앞섬', extra: [] },
    drawingPoor: { desc: '비기고 있지만 경기 내용은 밀림', extra: [] },
    goallessEven: { desc: '0-0, 팽팽한 경기', extra: [] },
    drawingEven: { desc: '골이 나온 무승부, 팽팽함', extra: [] },
  },
};

// 대륙 대회 전용 상황인지 (리그 경기 판정에서는 쓰지 않는다)
export const isCupSituation = (kind, id) => Boolean(SITUATIONS[kind][id].cup);

export const allowedPlaceholders = (kind, situationId) => new Set([...COMMON[kind], ...SITUATIONS[kind][situationId].extra]);

// 카테고리별 최소 수량
export const MIN_COUNTS = {
  answersPerKind: 500,
  answersPerStance: { pre: 6, post: 4, talk: 9 }, // 상황마다 성향마다
  cupAnswersPerStance: { pre: 6, post: 4, talk: 10 }, // 대륙 대회 상황
  questionsPerSituation: 3,
};
