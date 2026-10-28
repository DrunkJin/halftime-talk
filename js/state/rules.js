// 경기와 경기 사이 규칙 수치 (경기 중 수치는 js/engine/config.js)

export const RULES = {
  // 컨디션 회복: 라운드마다 +recovery, 29세 초과 1살마다 -recoveryAgePenalty (최소 minRecovery)
  conditionRecovery: 24,
  recoveryAgeFrom: 29,
  recoveryAgePenalty: 1.5,
  minRecovery: 10,

  // 징계: 경고 5장마다 1경기, 즉시 퇴장 3경기, 경고 2장 퇴장 1경기
  yellowBanEvery: 5,
  yellowBanMatches: 1,
  straightRedBan: 3,
  secondYellowBan: 1,

  // 스쿼드 인원 (이적·방출 제한)
  squadMin: 18,
  squadMax: 36,
};
