// 선수 출전 기대치·기분·면담 수치 (사용자 팀만). 대사는 data/talks.json
import { t } from '../i18n.js';

export const MOOD = {
  // 역할: 스쿼드 OVR 순위로. 21세 이하이면서 주전(상위 11) 밖이면 유망주
  roles: [
    { id: 'key', get label() { return t('state.mood.role.key'); }, untilRank: 4, expect: 0.8 },
    { id: 'starter', get label() { return t('state.mood.role.starter'); }, untilRank: 11, expect: 0.6 },
    { id: 'rotation', get label() { return t('state.mood.role.rotation'); }, untilRank: 17, expect: 0.3 },
    { id: 'backup', get label() { return t('state.mood.role.backup'); }, untilRank: 99, expect: 0.1 },
  ],
  prospect: { get label() { return t('state.mood.role.prospect'); }, maxAge: 21, expect: 0.15 },

  window: 6, // 최근 몇 경기로 출전 비율을 보나
  startMinutes: 45, // 이만큼 뛰면 선발급 출전(1), 그보다 적으면 0.5
  start: 70, // 처음 기분
  perGap: 14, // 경기마다 기분 += (실제 출전 비율 - 기대) × perGap (모자랄 때는 shortWeight배)
  shortWeight: 1.3,
  tolerance: 0.12, // 기대보다 이만큼 덜 뛰는 건 받아들인다 (백업은 거의 못 뛰어도 괜찮다)
  drift: 0.06, // 기대만큼 뛰면 start 쪽으로 이만큼씩 돌아온다
  levels: [
    { min: 60, id: 'happy', get label() { return t('state.mood.level.happy'); } },
    { min: 40, id: 'ok', get label() { return t('state.mood.level.ok'); } },
    { min: 25, id: 'unhappy', get label() { return t('state.mood.level.unhappy'); } },
    { min: 0, id: 'request', get label() { return t('state.mood.level.request'); } },
  ],
  // 팀 사기: 불만인 주전급(상위 11) 한 명당 (40 - 기분) / 10, 합계 최대 maxTeamPenalty
  teamPenaltyFrom: 40,
  maxTeamPenalty: 10,
  captainUnhappy: 3, // 지정 주장이 불만이면 추가 감점
  requestOfferBoost: 3, // 이적 요청한 선수에게 들어오는 영입 제안 확률 배율

  // 면담 (같은 선수는 cooldown 라운드에 한 번)
  cooldown: 3,
  talks: {
    promise: { get label() { return t('state.mood.talk.promise'); }, mood: 15, starts: 3, within: 5, kept: 10, broken: -30, brokenTeam: -5 },
    compete: { get label() { return t('state.mood.talk.compete'); }, moodLowRole: 6, moodHighRole: -6 }, // 기대 출전이 낮은 선수는 받아들이고, 주전급은 서운해한다
    reassure: { get label() { return t('state.mood.talk.reassure'); }, mood: 4 },
    allowTransfer: { get label() { return t('state.mood.talk.allowTransfer'); }, mood: 12, teamPenaltyKey: -3 },
  },
};
