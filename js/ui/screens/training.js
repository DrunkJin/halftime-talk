// 훈련: 팀 초점·강도(주 단위), 개인 훈련(최대 5명), 이번 주 예상 효과, 조직력, 최근 훈련 기록
import { overall } from '../../engine/ratings.js';
import { familiarityBoost, familiarityOf } from '../../state/familiarity.js';
import { conditionOf, squadOf, userFixture } from '../../state/game.js';
import { scoutedPotential } from '../../state/newSeason.js';
import { seasonGainsOf, suggestIndividual, trainingOf, weekPreview, weeklyRates } from '../../state/training.js';
import { TRAINING as T } from '../../state/trainingConfig.js';
import { teamBadge } from '../badge.js';
import { panel, segmented } from '../components.js';
import { h } from '../dom.js';
import { ATTRIBUTE_LABELS, attrClass } from '../format.js';
import { showToast } from '../motion.js';
import { isMatchInProgress } from './match.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v, unit = '') => `${v > 0 ? '+' : ''}${v}${unit}`;

// 초점마다 효과 꼬리표 (좋은 것 / 대가)
function focusTags(id) {
  const f = T.focus[id];
  const tags = [];
  const groups = Object.keys(f.growth).map((g) => T.groups[g].label);
  if (groups.length) tags.push({ good: true, text: `${groups.join('·')} 성장` });
  if (f.familiarity) tags.push({ good: true, text: '조직력' });
  if (f.matchBoost) tags.push({ good: true, text: `다음 경기 +${f.matchBoost * 100}%` });
  if (f.recovery > 0) tags.push({ good: true, text: `회복 +${f.recovery}` });
  if (f.recovery < 0) tags.push({ good: false, text: `회복 ${f.recovery}` });
  if (f.injury) tags.push({ good: false, text: '부상 위험' });
  if (!tags.length) tags.push({ good: true, text: '부담 없음' });
  return tags;
}

export function render(ctx) {
  const host = h('div', { class: 'training-screen' });
  const draw = () => {
    const { dataset, game } = ctx;
    const tr = trainingOf(game);
    const squad = squadOf(dataset, game, game.teamId);
    const byId = new Map(squad.map((p) => [p.id, p]));
    const save = (msg) => {
      ctx.persist();
      if (msg) showToast(msg);
      draw();
    };

    // ── 이번 주 ──
    const fx = userFixture(game);
    const opp = fx ? dataset.teamById.get(fx.homeId === game.teamId ? fx.awayId : fx.homeId) : null;
    const week = weekPreview(game);
    const fam = familiarityOf(game);
    const avgCond = squad.length ? Math.round(squad.reduce((s, p) => s + conditionOf(game, p.id), 0) / squad.length) : 100;
    const summary = panel(
      '이번 주 훈련',
      h(
        'div',
        { class: 'tr-week' },
        h('div', { class: 'tr-next' }, opp ? [h('span', { class: 'muted' }, `다음 경기 ${game.round}라운드`), teamBadge(opp, 24), h('b', {}, opp.shortName), h('span', { class: 'muted' }, fx.homeId === game.teamId ? '홈' : '원정')] : h('span', { class: 'muted' }, '이번 주는 리그 경기가 없습니다.')),
        h(
          'dl',
          { class: 'tr-effects' },
          h('div', {}, h('dt', {}, '컨디션 회복'), h('dd', { class: week.recovery > 0 ? 'up' : week.recovery < 0 ? 'down' : '' }, week.recovery ? signed(week.recovery) : '평소대로'), h('span', { class: 'muted small-note' }, `선수단 평균 ${avgCond}%`)),
          h('div', {}, h('dt', {}, '훈련 부상 위험'), h('dd', { class: week.injury ? 'down' : '' }, week.injury ? `선수당 ${(week.injury * 100).toFixed(1)}%` : '없음')),
          h('div', {}, h('dt', {}, '조직력'), h('dd', { class: week.familiarity ? 'up' : '' }, week.familiarity ? `+${Math.round(week.familiarity * 100)}%p` : '경기로만'), h('span', { class: 'muted small-note' }, `지금 ${pct(fam)} · 경기력 ${signed(+(familiarityBoost(fam) * 100).toFixed(1), '%')}`)),
          h('div', {}, h('dt', {}, '경기 준비'), h('dd', { class: week.matchBoost ? 'up' : '' }, week.matchBoost ? `이번 주 경기 +${week.matchBoost * 100}%` : '—')),
        ),
        h('p', { class: 'muted small-note' }, '훈련은 리그 라운드를 마칠 때마다 한 주씩 적용됩니다. 경기로 오르는 조직력은 80%까지, 그 위는 전술 훈련으로만 채울 수 있습니다.'),
      ),
    );

    // ── 팀 훈련 초점 ──
    const focusCards = Object.entries(T.focus).map(([id, f]) => {
      const btn = h(
        'button',
        { type: 'button', class: `tr-focus${tr.focus === id ? ' is-selected' : ''}`, 'aria-pressed': String(tr.focus === id) },
        h('b', {}, f.label),
        h('span', { class: 'tr-desc' }, f.desc),
        h('span', { class: 'tr-tags' }, focusTags(id).map((t) => h('span', { class: `tr-tag ${t.good ? 'good' : 'bad'}` }, t.text))),
      );
      btn.addEventListener('click', () => {
        tr.focus = id;
        save(`팀 훈련: ${f.label}`);
      });
      return btn;
    });
    const intensity = segmented(
      Object.entries(T.intensity).map(([id, o]) => ({ id, label: o.label })),
      tr.intensity,
      (id) => {
        tr.intensity = id;
        save(`훈련 강도: ${T.intensity[id].label}`);
      },
      { size: 'small' },
    );
    const focus = panel(
      '팀 훈련',
      h(
        'div',
        { class: 'tr-team' },
        h('div', { class: 'tr-focus-grid' }, focusCards),
        h('div', { class: 'tr-intensity' }, h('span', { class: 'muted' }, '강도'), intensity.el, h('span', { class: 'muted small-note' }, T.intensity[tr.intensity].desc)),
      ),
    );

    // ── 개인 훈련 ──
    const assigned = Object.entries(tr.individual).filter(([id]) => byId.has(id));
    const groupOptions = (p) => Object.entries(T.groups).filter(([, g]) => (p.position === 'GK' ? g.gkOnly || g.label === '피지컬' : !g.gkOnly));
    const rows = assigned.map(([id, group]) => {
      const p = byId.get(id);
      const ovr = overall(p);
      const pot = scoutedPotential(game, p, ovr);
      const rates = weeklyRates(game, p, tr);
      // 묶음 능력치 하나당 남은 시즌 예상 상승 (지금 속도가 이어진다면)
      const groupAttrs = T.groups[group].attrs;
      const perAttr = groupAttrs.reduce((s, a) => s + (rates[a] ?? 0), 0) / groupAttrs.length;
      const weeksLeft = Math.max(0, game.totalRounds - game.round + 1);
      const sel = h('select', { class: 'select small', 'aria-label': `${p.name} 훈련 묶음` }, groupOptions(p).map(([gid, g]) => h('option', { value: gid, selected: gid === group || null }, g.label)));
      sel.addEventListener('change', () => {
        tr.individual[id] = sel.value;
        save(`${p.name}: ${T.groups[sel.value].label} 훈련`);
      });
      const remove = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `${p.name} 개인 훈련 빼기` }, '빼기');
      remove.addEventListener('click', () => {
        delete tr.individual[id];
        save();
      });
      const veteran = p.age >= T.veteranFrom;
      return h(
        'tr',
        {},
        h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
        h('td', {}, h('b', {}, p.name), h('span', { class: 'muted' }, ` ${p.age}세`)),
        h('td', { class: `num ${attrClass(ovr)}` }, ovr),
        h('td', { class: 'num muted' }, pot ? `${pot.low}~${pot.high}` : '—'),
        h('td', {}, sel),
        h('td', { class: 'muted small-note' }, veteran ? `노화 늦추기 ${pct(tr.retention?.[id] ?? 0)}` : perAttr > 0 ? `능력치당 시즌 약 +${Math.round(perAttr * weeksLeft)}` : '잠재력에 닿음'),
        h('td', { class: 'num' }, seasonGainsOf(game, id) ? h('b', { class: 'up' }, `+${seasonGainsOf(game, id)}`) : '—'),
        h('td', {}, remove),
      );
    });
    const free = squad.filter((p) => !tr.individual[p.id]).sort((a, b) => a.age - b.age || overall(b) - overall(a));
    const add = h('select', { class: 'select small', 'aria-label': '개인 훈련할 선수 고르기', disabled: assigned.length >= T.individual.max || null }, h('option', { value: '' }, assigned.length >= T.individual.max ? `최대 ${T.individual.max}명` : '선수 추가…'), free.map((p) => h('option', { value: p.id }, `${p.position} ${p.name} (${p.age}세, ${overall(p)})`)));
    add.addEventListener('change', () => {
      const p = byId.get(add.value);
      if (!p) return;
      tr.individual[p.id] = p.position === 'GK' ? 'goalkeeping' : ['CB', 'LB', 'RB', 'DM'].includes(p.position) ? 'defending' : p.position === 'ST' ? 'finishing' : 'creativity';
      save(`${p.name} 개인 훈련 시작`);
    });
    const suggest = h('button', { class: 'btn small', type: 'button' }, '추천 선수로 채우기');
    suggest.addEventListener('click', () => {
      tr.individual = {};
      for (const s of suggestIndividual(dataset, game)) tr.individual[s.id] = s.group;
      save('잠재력 여유가 큰 젊은 선수로 개인 훈련을 채웠습니다');
    });
    const individual = panel(
      `개인 훈련 (${assigned.length}/${T.individual.max})`,
      h(
        'div',
        { class: 'tr-individual' },
        rows.length
          ? h('div', { class: 'table-scroll' }, h('table', { class: 'data compact' }, h('thead', {}, h('tr', {}, h('th', {}, '포지션'), h('th', {}, '선수'), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, '잠재력'), h('th', {}, '훈련'), h('th', {}, '예상'), h('th', { class: 'num' }, '시즌 성장'), h('th', {}, ''))), h('tbody', {}, rows)))
          : h('p', { class: 'muted' }, '아직 개인 훈련 중인 선수가 없습니다.'),
        h('div', { class: 'btn-row' }, add, suggest),
        h('p', { class: 'muted small-note' }, '젊고 잠재력이 남은 선수일수록 빨리 오릅니다. 잠재력에 닿으면 멈추고, 30세 이상은 시즌 끝 노화를 늦춥니다.'),
      ),
      { actions: h('span', { class: 'muted small-note' }, '팀 훈련과 겹치면 더 빨리 오릅니다') },
    );

    // ── 최근 기록 ──
    const log = (tr.log ?? []).slice(0, 16);
    const history = panel(
      '최근 훈련 기록',
      log.length
        ? h(
            'ul',
            { class: 'tr-log' },
            log.map((l) =>
              h('li', { class: l.kind === 'injury' ? 'bad' : '' }, h('span', { class: 'muted' }, `${l.round ?? ''}R`), l.kind === 'injury' ? ` ${l.name} 훈련 중 부상 (${l.weeks}경기)` : [` ${l.name} `, h('b', {}, ATTRIBUTE_LABELS[l.attr] ?? l.attr), ` → ${l.value}`]),
            ),
          )
        : h('p', { class: 'muted tr-empty' }, '라운드를 치르면 훈련으로 오른 능력치가 여기에 쌓입니다. 능력치 하나가 오르려면 보통 몇 주가 걸립니다.'),
    );

    const lock = isMatchInProgress() ? h('div', { class: 'warn-banner' }, h('span', {}, '경기 중에는 훈련을 바꿀 수 없습니다.')) : null;
    host.replaceChildren(...[lock, summary, focus, individual, history].filter(Boolean));
    if (lock) host.querySelectorAll('button, select').forEach((el) => (el.disabled = true));
  };
  draw();
  return host;
}
