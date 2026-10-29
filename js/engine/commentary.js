// 경기 중계 문구. 선수·팀 이름이 영어라 이/가·을/를 같은 조사가 붙지 않는 문장으로 쓴다.
// 문구 선택은 경기 결과와 별개의 난수(textRng)를 써서, 문구를 바꿔도 경기 결과는 그대로다.

const TEMPLATES = {
  kickoff: ['{home} 대 {away}, 경기 시작합니다.'],
  quiet: [
    '{team}, 후방에서 천천히 공을 돌립니다.',
    '{team}, 점유를 이어가며 빈틈을 찾습니다.',
    '{team}, 측면으로 전개해 봅니다.',
    '중원 싸움이 치열합니다.',
    '{team}, 짧은 패스로 상대 압박을 풀어냅니다.',
  ],
  attackStopped: [
    '{team}의 공격 전개, {defender}의 태클에 끊깁니다.',
    '{defender}, 침투 패스를 차단합니다.',
    '{team}의 크로스, {defender}의 머리에 걸립니다.',
    '{team} 역습 시도, {defender}의 커버로 무산됩니다.',
  ],
  miss: ['{shot}, 골대를 벗어납니다.', '{shot}, 크로스바 위로 넘어갑니다.', '{shot}, 아쉽게 옆그물을 때립니다.'],
  blocked: ['{shot}, 수비 몸에 맞고 굴절됩니다.', '{shot}, 육탄 방어에 막힙니다.'],
  woodwork: ['{shot}, 골대를 맞고 튕겨 나옵니다!', '{shot}, 크로스바를 강타합니다!'],
  saved: ['{shot}, {gk} 선방!', '{shot}, {gk} 정면으로 향합니다.', '{shot}, {gk}의 손끝에 걸립니다!'],
  goal: ['골! {shot}, 골망을 흔듭니다!', '골! {shot}, 골문 구석에 꽂힙니다!', '골! {shot}, 그대로 골로 연결됩니다!'],
  yellow: ['{player}에게 옐로카드.', '{player}, 거친 태클로 경고를 받습니다.', '{player}, 전술적 파울로 경고.'],
  secondYellow: ['{player}, 두 번째 경고! 퇴장입니다.'],
  red: ['{player}, 위험한 태클에 레드카드! 곧바로 퇴장입니다.'],
  injury: ['{player}, 그라운드에 쓰러집니다. {injury}로 보입니다.', '{player}, 고통을 호소합니다. {injury} 의심.'],
  subInjury: ['{team} 부상 교체: {in} 투입, {out} 아웃.', '{team}, 부상당한 {out} 대신 {in} 투입.'],
  sub: ['교체: {in} 투입, {out} 아웃.', '{team}의 교체. {out} 대신 {in}.'],
  outfieldGk: ['{team}, 교체 카드가 없습니다. 골키퍼 장갑은 {player}의 몫입니다.'],
  shortHanded: ['{team}, 교체 카드가 없어 {count}명으로 경기를 이어갑니다.'],
  halftime: ['전반 종료. {score}'],
  extraTimeStart: ['90분 종료, 합계 동점! 연장전에 들어갑니다. {score}', '승부는 연장으로! {score}'],
  etHalftime: ['연장 전반 종료. {score}'],
  extraTimeEnd: ['연장 종료. 승부차기로 갑니다! {score}'],
  penaltiesStart: ['승부차기가 시작됩니다. 경기장에 정적이 흐릅니다.'],
  penScored: ['{player}, 성공! ({tally})', '{player}, 골키퍼를 속이고 차분하게 성공. ({tally})', '{player}, 구석으로 강하게! 성공. ({tally})'],
  penSaved: ['{player}의 킥, {gk} 막아냅니다! ({tally})', '{gk}, 방향을 읽었습니다! {player} 실축. ({tally})'],
  penMissed: ['{player}, 크로스바 위로! 실축. ({tally})', '{player}의 킥이 골대를 벗어납니다! ({tally})'],
  penaltyAwarded: ['페널티킥! {team}에게 기회가 옵니다. 키커는 {player}.', '박스 안 파울! 주심이 페널티 지점을 가리킵니다. {player}, 공을 내려놓습니다.', '{team}, 페널티킥을 얻어냅니다. 키커로 {player} 나섭니다.'],
  penaltyGoal: ['골! {player}, 침착하게 페널티킥 성공!', '골! {player}의 킥, 골키퍼 반대쪽으로 정확히!', '골! {player}, 구석으로 강하게 차 넣습니다!'],
  penaltySaved: ['{gk}, 페널티킥을 막아냅니다! {player} 실축!', '{gk}의 선방! {player}의 킥이 막힙니다!'],
  penaltyMissed: ['{player}, 페널티킥 실축! 공이 골대를 벗어납니다!', '{player}의 킥, 크로스바 위로!'],
  tactic: ['{team}, 전술을 바꿉니다: {change}.', '{team} 벤치에서 지시가 나옵니다. {change}.'],
  formation: ['{team}, 대형을 바꿉니다: {formation}.', '{team}, 포메이션 변경: {formation}.'],
  fulltime: ['경기 종료! 최종 스코어 {score}'],
};

const SHOT_PHRASES = {
  open: '{shooter}의 슈팅',
  long: '{shooter}의 중거리 슈팅',
  header: '{shooter}의 헤더',
  big: '골키퍼와 일대일, {shooter}의 슈팅',
};

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export function shotPhrase(shotType, shooterName) {
  return fill(SHOT_PHRASES[shotType], { shooter: shooterName });
}

export function commentText(type, vars, textRng) {
  return fill(textRng.pick(TEMPLATES[type]), vars);
}
