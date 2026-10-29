// 경기 전 상대 분석: 상대 예상 전술·강점·약점, 코치 메모(노릴 점·조심할 점), 지금 고른 전술의 장단점.
// 승률·기대 승점 같은 숫자나 '정답' 순위는 보여주지 않는다 — 어떤 메모를 따를지는 감독이 판단한다
import { previewMatch } from '../engine/match.js';
import { PROFILE_KEYS, PROFILE_LABELS, matchupNotes, strengthOf } from '../engine/tactics.js';
import { h } from './dom.js';
import { t } from '../i18n.js';
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
    memos.push({ kind: 'chance', text: t(o.pressing === 'high' ? 'analysis.memo.oppPressHigh' : 'analysis.memo.oppLineHigh') });
  }
  if (o.pressing === 'low') memos.push({ kind: 'chance', text: t('analysis.memo.oppLowBlock') });
  if (o.style === 'short') memos.push({ kind: 'chance', text: t('analysis.memo.oppShort') });
  if (o.style === 'direct') memos.push({ kind: 'warn', text: t('analysis.memo.oppDirect') });
  if (weak.includes('backPace')) memos.push({ kind: 'chance', text: t('analysis.memo.weakBackPace') });
  if (weak.includes('technique')) memos.push({ kind: 'chance', text: t('analysis.memo.weakTechnique') });
  if (weak.includes('shape')) memos.push({ kind: 'chance', text: t('analysis.memo.weakShape') });
  if (strong.includes('speed')) memos.push({ kind: 'warn', text: t('analysis.memo.strongSpeed') });
  if (strong.includes('aerial')) memos.push({ kind: 'warn', text: t('analysis.memo.strongAerial') });
  if (strong.includes('energy')) memos.push({ kind: 'warn', text: t('analysis.memo.strongEnergy') });
  // 상대의 눈에 띄는 역할: 무엇을 경계할지 (어떻게 막을지는 감독이 고른다)
  const role = (id) => opp.roles?.find((r) => r.role.id === id);
  const tm = role('targetMan');
  if (tm) memos.push({ kind: 'warn', text: t('analysis.memo.targetMan', { name: tm.name }) });
  const dlp = role('deepLyingPlaymaker') ?? role('advancedPlaymaker');
  if (dlp) memos.push({ kind: 'chance', text: t('analysis.memo.playmaker', { name: dlp.name }) });
  const wb = opp.roles?.filter((r) => r.role.id === 'wingBack') ?? [];
  if (wb.length) memos.push({ kind: 'chance', text: t('analysis.memo.wingBack', { names: wb.map((r) => r.name).join('·') }) });
  const finisher = role('poacher') ?? role('shadowStriker') ?? role('insideForward');
  if (finisher) memos.push({ kind: 'warn', text: t('analysis.memo.finisher', { name: finisher.name, role: finisher.role.label }) });
  if (myStrong.length) memos.push({ kind: 'self', text: t('analysis.memo.ourStrengths', { list: myStrong.map((k) => PROFILE_LABELS[k]).join(', ') }) });
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
        h('p', {}, h('span', { class: 'muted' }, t('analysis.oppExpected')), h('b', {}, tacticSummary(opp.tactics))),
        traits(opp.profile, 1).length || traits(opp.profile, -1).length
          ? h(
              'p',
              { class: 'an-traits' },
              traits(opp.profile, 1).length ? h('span', {}, h('span', { class: 'muted' }, t('analysis.strengths')), label(traits(opp.profile, 1))) : null,
              traits(opp.profile, -1).length ? h('span', {}, h('span', { class: 'muted' }, t('analysis.weaknesses')), label(traits(opp.profile, -1))) : null,
            )
          : null,
        opp.roles?.length ? h('p', { class: 'an-roles' }, h('span', { class: 'muted' }, t('analysis.notableRoles')), opp.roles.map((r) => `${r.pos} ${r.name} (${r.role.label})`).join(', ')) : null,
      ].filter(Boolean),
    );
    memos.replaceChildren(...coachMemos(mine, opp).map((m) => h('li', { class: `memo-${m.kind}` }, m.text)));
    const notes = matchupNotes(mine, opp);
    check.replaceChildren(
      h('p', { class: 'muted' }, t('analysis.currentTactics', { summary: tacticSummary(game.tactics) })),
      notes.length
        ? h('ul', { class: 'an-notes' }, notes.map((n) => h('li', { class: n.good ? 'good' : 'bad' }, n.text)))
        : h('p', { class: 'muted small-note' }, t('analysis.noMatchup')),
    );
  }
  refresh();

  const el = h(
    'div',
    { class: 'analysis' },
    head,
    h('h3', {}, t('analysis.coachMemos')),
    memos,
    h('h3', {}, t('analysis.checkTitle')),
    check,
    h('p', { class: 'muted small-note' }, t('analysis.disclaimer')),
  );
  return { el, refresh };
}
