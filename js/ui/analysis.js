// 경기 전 상대 분석: 상대 예상 전술·강점·약점, 지금 전술의 전망, 상대에 맞춘 추천 전술 (엔진 기대 득점 기준)
import { TACTICS } from '../engine/config.js';
import { previewMatch } from '../engine/match.js';
import { PROFILE_KEYS, PROFILE_LABELS, matchupNotes, strengthOf } from '../engine/tactics.js';
import { familiarityBoost, familiarityOf } from '../state/familiarity.js';
import { h } from './dom.js';
import { tacticLabel, tacticSummary } from './tactics.js';

const COMBOS = [];
for (const mentality of Object.keys(TACTICS.mentality)) {
  for (const pressing of Object.keys(TACTICS.pressing)) for (const style of Object.keys(TACTICS.style)) COMBOS.push({ mentality, pressing, style });
}
const pct = (v) => `${Math.round(v * 100)}%`;
const sameTactics = (a, b) => a.mentality === b.mentality && a.pressing === b.pressing && a.style === b.style;

// 두드러진 성향 (단위 기준 이상) 위·아래로
function traits(profile, sign) {
  return PROFILE_KEYS.map((k) => [k, strengthOf(profile, k)])
    .filter(([, v]) => (sign > 0 ? v >= 0.3 : v <= -0.3))
    .sort((a, b) => (sign > 0 ? b[1] - a[1] : a[1] - b[1]))
    .slice(0, 2)
    .map(([k]) => PROFILE_LABELS[k]);
}

// game: 사용자 게임, makeInput(game) → 엔진 경기 입력, mySide: 'home' | 'away', onApply(tactics)
// → { el, refresh() } — 전술을 바꾸면 refresh로 지금 전술 전망·설명을 다시 그린다
export function analysisPanel(game, makeInput, mySide, onApply) {
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const current = h('div', { class: 'an-current' });
  const recs = h('div', { class: 'an-recs' });
  const head = h('div', { class: 'an-opp' });

  // 전술 조합별 전망. 숙련도는 그 조합의 공격 방식 기준으로 바꿔 넣는다
  const outlookFor = (input, tactics) => {
    const mine = input[mySide];
    const boost = mine.boost - familiarityBoost(familiarityOf(game)) + familiarityBoost(familiarityOf(game, tactics));
    return previewMatch({ ...input, [mySide]: { ...mine, tactics, boost } }, mySide);
  };
  const wdl = (o) => h('span', { class: 'an-wdl' }, h('b', { class: 'w' }, `승 ${pct(o.win)}`), h('span', {}, `무 ${pct(o.draw)}`), h('span', { class: 'l' }, `패 ${pct(o.loss)}`));
  const noteList = (pv) => {
    const notes = matchupNotes(pv[mySide], pv[oppSide]);
    return notes.length ? h('ul', { class: 'an-notes' }, notes.map((n) => h('li', { class: n.good ? 'good' : 'bad' }, n.text))) : null;
  };

  function refresh() {
    const input = makeInput(game);
    const pv = outlookFor(input, game.tactics);
    const opp = pv[oppSide];
    head.replaceChildren(
      h('p', {}, h('span', { class: 'muted' }, '상대 예상 전술 '), h('b', {}, tacticSummary(opp.tactics))),
      h(
        'p',
        { class: 'an-traits' },
        traits(opp.profile, 1).length ? h('span', {}, h('span', { class: 'muted' }, '강점 '), traits(opp.profile, 1).join(', ')) : null,
        traits(opp.profile, -1).length ? h('span', {}, h('span', { class: 'muted' }, '약점 '), traits(opp.profile, -1).join(', ')) : null,
      ),
    );
    current.replaceChildren(...[h('div', { class: 'an-line' }, h('span', { class: 'muted' }, '지금 전술 전망'), wdl(pv.outlook)), noteList(pv)].filter(Boolean));

    // 추천: 기대 승점 상위, 압박·공격 방식이 겹치지 않게 3개
    const ranked = COMBOS.map((t) => ({ t, pv: outlookFor(input, t) })).sort((a, b) => b.pv.outlook.points - a.pv.outlook.points);
    const picked = [];
    for (const r of ranked) {
      if (picked.length >= 3) break;
      if (picked.some((p) => p.t.pressing === r.t.pressing && p.t.style === r.t.style)) continue;
      picked.push(r);
    }
    const now = pv.outlook.points;
    recs.replaceChildren(
      ...picked.map(({ t, pv: rpv }) => {
        const isNow = sameTactics(t, game.tactics);
        const apply = h('button', { class: 'btn small', type: 'button', disabled: isNow || null }, isNow ? '지금 전술' : '이 전술로');
        apply.addEventListener('click', () => onApply({ ...t }));
        const fam = familiarityOf(game, t);
        const gain = rpv.outlook.points - now;
        return h(
          'div',
          { class: 'an-rec' },
          h(
            'div',
            { class: 'an-rec-head' },
            h('b', {}, `${tacticLabel('mentality', t.mentality)} · ${tacticLabel('pressing', t.pressing)} · ${tacticLabel('style', t.style)}`),
            apply,
          ),
          h('div', { class: 'an-line' }, wdl(rpv.outlook), Math.abs(gain) >= 0.03 && !isNow ? h('span', { class: `an-gain ${gain > 0 ? 'up' : 'down'}` }, `기대 승점 ${gain > 0 ? '+' : ''}${gain.toFixed(2)}`) : null),
          fam < 0.3 ? h('p', { class: 'muted small-note' }, `이 공격 방식은 손발이 덜 맞습니다 (숙련도 ${pct(fam)})`) : null,
          noteList(rpv),
        );
      }),
    );
  }
  refresh();

  const el = h(
    'div',
    { class: 'analysis' },
    head,
    current,
    h('h3', {}, '이 상대에 맞춘 추천'),
    recs,
    h('p', { class: 'muted small-note' }, '전망은 두 팀 선발·컨디션·사기·숙련도로 계산한 기대치입니다. 경기 중 교체·부상·스코어에 따라 달라집니다.'),
  );
  return { el, refresh };
}
