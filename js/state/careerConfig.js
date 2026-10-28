// 감독 커리어 평가 수치 (엔딩 화면). 칭호 문구는 data/career.json
export const CAREER = {
  // 감독 점수 0~100 = base + 기대 대비 순위(리그 크기로 나눈 비율 ×100)의 평균 × perfWeight
  //   + 트로피·승강 가산 + (승률 - winRateRef) × winRateWeight
  score: {
    base: 50,
    perfWeight: 0.8,
    leagueTitle: 12,
    ucl: 15,
    uel: 8,
    promotion: 8,
    relegation: -12,
    winRateRef: 0.4,
    winRateWeight: 40,
  },
  grades: [
    [85, 'S'],
    [70, 'A'],
    [55, 'B'],
    [40, 'C'],
    [0, 'D'],
  ],
  // 칭호 판정 기준
  title: {
    miracleExpectedRank: 5, // 시즌 전 예상 순위가 이보다 낮은(숫자가 큰) 시즌에 트로피 → 기적
    overachieve: 3, // 시즌 평균 기대 대비 +3위 이상
    underachieve: -3,
    steady: 2, // 기대와의 차이 평균이 ±2위 안
    rebuild: 5, // 같은 리그에서 첫 시즌보다 마지막 시즌 순위가 이만큼 이상 오르면
    firefighterQuarter: 0.75, // 예상 순위가 리그 하위 25%에서 시작
  },
};
