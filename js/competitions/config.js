// 대륙 대회(UCL·UEL) 형식·일정·상금. 경기 수치(연장·승부차기)는 engine/config.js
export const CUP = {
  leaguePhase: {
    matches: 8, // 팀당 경기 수: 포트마다 2팀 (홈 1, 원정 1)
    pots: 4,
    maxSameCountry: 2, // 같은 나라 상대는 최대 2팀 (같은 나라끼리는 붙지 않음)
    maxPerPot: 3, // 한 포트에 같은 나라 최대 3팀 (넘치면 다음 포트 팀과 맞바꿈)
    direct: 8, // 1~8위 16강 직행
    playoff: 24, // 9~24위 녹아웃 플레이오프, 25위 이하 탈락
    drawAttempts: 400,
  },
  // 단계 순서와 이름
  stages: ['league', 'playoff', 'r16', 'qf', 'sf', 'final'],
  stageNames: { league: '리그 페이즈', playoff: '플레이오프', r16: '16강', qf: '8강', sf: '4강', final: '결승' },
  // 주중 경기 일정: 사용자 리그 진행률. 이 진행률에 해당하는 라운드를 마친 뒤 경기가 열린다
  calendar: [
    { stage: 'league', md: 1, at: 0.1 },
    { stage: 'league', md: 2, at: 0.16 },
    { stage: 'league', md: 3, at: 0.22 },
    { stage: 'league', md: 4, at: 0.29 },
    { stage: 'league', md: 5, at: 0.35 },
    { stage: 'league', md: 6, at: 0.42 },
    { stage: 'league', md: 7, at: 0.5 },
    { stage: 'league', md: 8, at: 0.55 },
    { stage: 'playoff', leg: 1, at: 0.6 },
    { stage: 'playoff', leg: 2, at: 0.63 },
    { stage: 'r16', leg: 1, at: 0.68 },
    { stage: 'r16', leg: 2, at: 0.71 },
    { stage: 'qf', leg: 1, at: 0.78 },
    { stage: 'qf', leg: 2, at: 0.81 },
    { stage: 'sf', leg: 1, at: 0.86 },
    { stage: 'sf', leg: 2, at: 0.89 },
    { stage: 'final', leg: 1, at: 0.95 },
  ],
  // 주중 경기 뒤 컨디션 회복 (주말 리그 경기 뒤 회복량 대비 비율)
  midweekRecovery: 0.5,
  // 대륙 대회 징계 (리그와 별도): 경고 누적 3장마다 1경기, 퇴장 1경기
  cards: { yellowBanEvery: 3, yellowBanMatches: 1, redBan: 1, secondYellowBan: 1 },
  // 상금 (백만 파운드): 참가, 리그 페이즈 승·무, 단계 진출, 우승
  prizes: {
    ucl: { participation: 18.5, win: 2.1, draw: 0.7, playoff: 1.0, r16: 11.0, qf: 12.6, sf: 15.0, final: 18.5, winner: 6.0 },
    uel: { participation: 4.3, win: 0.45, draw: 0.15, playoff: 0.3, r16: 1.75, qf: 2.6, sf: 4.6, final: 7.0, winner: 5.0 },
  },
};
