// 경기 전 상대 분석: 상대 예상 전술·강점·약점, 코치 메모(노릴 점·조심할 점), 지금 고른 전술의 장단점.
// 승률·기대 승점 같은 숫자나 '정답' 순위는 보여주지 않는다 — 어떤 메모를 따를지는 감독이 판단한다
import { previewMatch } from '../engine/match.js';
import { PROFILE_KEYS, PROFILE_LABELS, matchupNotes, strengthOf } from '../engine/tactics.js';
import { h } from './dom.js';
import { tacticSummary } from './tactics.js';

// 두드러진 성향 (단위 기준 이상) 위·아래로
function traits(profile, sign) {
  return PROFILE_KEYS.map((k) => [k, strengthOf(profile, k)])
    .filter(([, v]) => (sign > 0 ? v >= 0.3 : v <= -0.3))
    .sort((a, b) => (sign > 0 ? b[1] - a[1] : a[1] - b[1]))
    .slice(0, 2)
    .map(([k]) => k);
}

// 코치 메모: 상대 전술·성향에서 읽히는 것 (무엇을 고를지는 말하지 않는다)
function coachMemos(mine, opp) {
  const memos = [];
  const o = opp.tactics;
  const weak = traits(opp.profile, -1);
  const strong = traits(opp.profile, 1);
  const myStrong = traits(mine.profile, 1);
  if (o.mentality === 'attacking' || o.mentality === 'veryAttacking' || o.pressing === 'high') {
    memos.push({ kind: 'chance', text: `상대는 ${o.pressing === 'high' ? '높은 위치에서 압박' : '공격적으로 라인을 올릴'} 것으로 보입니다. 수비 뒷공간이 생길 수 있습니다.` });
  }
  if (o.pressing === 'low') memos.push({ kind: 'chance', text: '상대는 내려앉아 공간을 지울 것으로 보입니다. 중앙으로 밀고 들어가기는 쉽지 않습니다.' });
  if (o.style === 'short') memos.push({ kind: 'chance', text: '상대는 짧은 패스로 뒤에서부터 풀어 나옵니다. 빌드업을 끊으면 기회가 생깁니다 — 다만 상대 후방이 침착하면 압박이 뚫립니다.' });
  if (o.style === 'direct') memos.push({ kind: 'warn', text: '상대는 빠르게 전방으로 공을 보냅니다. 측면 크로스와 세컨드 볼을 조심해야 합니다.' });
  if (weak.includes('backPace')) memos.push({ kind: 'chance', text: '상대 수비진은 발이 느린 편입니다.' });
  if (weak.includes('technique')) memos.push({ kind: 'chance', text: '상대 후방 빌드업 기술이 약점입니다.' });
  if (weak.includes('shape')) memos.push({ kind: 'chance', text: '상대 수비 조직이 헐거운 편입니다.' });
  if (strong.includes('speed')) memos.push({ kind: 'warn', text: '상대 공격진이 빠릅니다. 라인을 올리면 위험할 수 있습니다.' });
  if (strong.includes('aerial')) memos.push({ kind: 'warn', text: '상대는 크로스와 제공권이 강점입니다.' });
  if (strong.includes('energy')) memos.push({ kind: 'warn', text: '상대는 많이 뛰는 팀입니다. 후반 체력 싸움이 될 수 있습니다.' });
  // 상대의 눈에 띄는 역할: 무엇을 경계할지 (어떻게 막을지는 감독이 고른다)
  const role = (id) => opp.roles?.find((r) => r.role.id === id);
  const tm = role('targetMan');
  if (tm) memos.push({ kind: 'warn', text: `상대 ${tm.name}은(는) 타깃맨입니다. 크로스와 공중볼 경합이 많아질 겁니다.` });
  const dlp = role('deepLyingPlaymaker') ?? role('advancedPlaymaker');
  if (dlp) memos.push({ kind: 'chance', text: `상대 공격은 ${dlp.name}의 발끝에서 시작됩니다. 이 선수를 묶으면 흐름이 끊길 수 있습니다.` });
  const wb = opp.roles?.filter((r) => r.role.id === 'wingBack') ?? [];
  if (wb.length) memos.push({ kind: 'chance', text: `상대 ${wb.map((r) => r.name).join('·')}이(가) 윙백으로 높이 오릅니다. 그 뒤 측면 공간이 빕니다.` });
  const finisher = role('poacher') ?? role('shadowStriker') ?? role('insideForward');
  if (finisher) memos.push({ kind: 'warn', text: `상대 ${finisher.name}은(는) ${finisher.role.label}로 박스 안 마무리를 노립니다.` });
  if (myStrong.length) memos.push({ kind: 'self', text: `우리 쪽 강점: ${myStrong.map((k) => PROFILE_LABELS[k]).join(', ')}.` });
  return memos.slice(0, 6);
}

// game: 사용자 게임, makeInput(game) → 엔진 경기 입력, mySide: 'home' | 'away'
// → { el, refresh() } — 전술을 바꾸면 refresh로 '지금 전술 점검'을 다시 그린다
export function analysisPanel(game, makeInput, mySide) {
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const head = h('div', { class: 'an-opp' });
  const memos = h('ul', { class: 'an-memos' });
  const check = h('div', { class: 'an-current' });

  function refresh() {
    const pv = previewMatch(makeInput(game), mySide);
    const mine = pv[mySide];
    const opp = pv[oppSide];
    const label = (keys) => keys.map((k) => PROFILE_LABELS[k]).join(', ');
    head.replaceChildren(
      ...[
        h('p', {}, h('span', { class: 'muted' }, '상대 예상 전술 '), h('b', {}, tacticSummary(opp.tactics))),
        traits(opp.profile, 1).length || traits(opp.profile, -1).length
          ? h(
              'p',
              { class: 'an-traits' },
              traits(opp.profile, 1).length ? h('span', {}, h('span', { class: 'muted' }, '강점 '), label(traits(opp.profile, 1))) : null,
              traits(opp.profile, -1).length ? h('span', {}, h('span', { class: 'muted' }, '약점 '), label(traits(opp.profile, -1))) : null,
            )
          : null,
        opp.roles?.length ? h('p', { class: 'an-roles' }, h('span', { class: 'muted' }, '눈에 띄는 역할 '), opp.roles.map((r) => `${r.pos} ${r.name} (${r.role.label})`).join(', ')) : null,
      ].filter(Boolean),
    );
    memos.replaceChildren(...coachMemos(mine, opp).map((m) => h('li', { class: `memo-${m.kind}` }, m.text)));
    const notes = matchupNotes(mine, opp);
    check.replaceChildren(
      h('p', { class: 'muted' }, `지금 전술: ${tacticSummary(game.tactics)}`),
      notes.length
        ? h('ul', { class: 'an-notes' }, notes.map((n) => h('li', { class: n.good ? 'good' : 'bad' }, n.text)))
        : h('p', { class: 'muted small-note' }, '이 상대와 특별히 맞물리는 점은 보이지 않습니다. 선수 기량과 체력 싸움이 될 것 같습니다.'),
    );
  }
  refresh();

  const el = h(
    'div',
    { class: 'analysis' },
    head,
    h('h3', {}, '코치 메모'),
    memos,
    h('h3', {}, '지금 전술 점검'),
    check,
    h('p', { class: 'muted small-note' }, '분석은 상대의 평소 성향을 바탕으로 한 예상입니다. 경기 중 상대는 스코어에 따라 운영을 바꿉니다.'),
  );
  return { el, refresh };
}
