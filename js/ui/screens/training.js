// 훈련: 팀 초점·강도(주 단위), 개인 훈련(최대 5명), 이번 주 예상 효과, 조직력, 최근 훈련 기록
import { overall } from '../../engine/ratings.js';
import { familiarityOf, familiarityWord } from '../../state/familiarity.js';
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
import { FAMILIARITY } from '../../engine/config.js';
import { t } from '../../i18n.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v, unit = '') => `${v > 0 ? '+' : ''}${v}${unit}`;

// 초점마다 효과 꼬리표 (좋은 것 / 대가)
function focusTags(id) {
  const f = T.focus[id];
  const tags = [];
  const groups = Object.keys(f.growth).map((g) => T.groups[g].label);
  if (groups.length) tags.push({ good: true, text: t('training.tag.growth', { groups: groups.join('·') }) });
  if (f.familiarity) tags.push({ good: true, text: t('training.tag.familiarity') });
  if (f.matchBoost) tags.push({ good: true, text: t('training.tag.matchBoost', { pct: f.matchBoost * 100 }) });
  if (f.recovery > 0) tags.push({ good: true, text: t('training.tag.recoveryUp', { v: f.recovery }) });
  if (f.recovery < 0) tags.push({ good: false, text: t('training.tag.recoveryDown', { v: f.recovery }) });
  if (f.injury) tags.push({ good: false, text: t('training.tag.injury') });
  if (!tags.length) tags.push({ good: true, text: t('training.tag.none') });
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
      t('training.week.title'),
      h(
        'div',
        { class: 'tr-week' },
        h('div', { class: 'tr-next' }, opp ? [h('span', { class: 'muted' }, t('training.week.next', { round: game.round })), teamBadge(opp, 24), h('b', {}, opp.shortName), h('span', { class: 'muted' }, fx.homeId === game.teamId ? t('training.week.home') : t('training.week.away'))] : h('span', { class: 'muted' }, t('training.week.noMatch'))),
        h(
          'dl',
          { class: 'tr-effects' },
          h('div', {}, h('dt', {}, t('training.week.recovery')), h('dd', { class: week.recovery > 0 ? 'up' : week.recovery < 0 ? 'down' : '' }, week.recovery ? signed(week.recovery) : t('training.week.normal')), h('span', { class: 'muted small-note' }, t('training.week.avgCond', { avg: avgCond }))),
          h('div', {}, h('dt', {}, t('training.week.injury')), h('dd', { class: week.injury ? 'down' : '' }, week.injury ? t('training.week.injuryPer', { pct: (week.injury * 100).toFixed(1) }) : t('training.week.none'))),
          h('div', {}, h('dt', {}, t('training.week.familiarity')), h('dd', { class: week.familiarity ? 'up' : '' }, week.familiarity ? t('training.week.famDrill') : t('training.week.famMatches')), h('span', { class: 'muted small-note' }, t('training.week.famNow', { word: familiarityWord(fam) }))),
          h('div', {}, h('dt', {}, t('training.week.prep')), h('dd', { class: week.matchBoost ? 'up' : '' }, week.matchBoost ? t('training.week.prepOn') : '—')),
        ),
        h('p', { class: 'muted small-note' }, t('training.week.note', { matchWord: familiarityWord(FAMILIARITY.aiLevel), topWord: familiarityWord(1) })),
      ),
    );

    // ── 팀 훈련 초점 ──
    const focusCards = Object.entries(T.focus).map(([id, f]) => {
      const btn = h(
        'button',
        { type: 'button', class: `tr-focus${tr.focus === id ? ' is-selected' : ''}`, 'aria-pressed': String(tr.focus === id) },
        h('b', {}, f.label),
        h('span', { class: 'tr-desc' }, f.desc),
        h('span', { class: 'tr-tags' }, focusTags(id).map((tag) => h('span', { class: `tr-tag ${tag.good ? 'good' : 'bad'}` }, tag.text))),
      );
      btn.addEventListener('click', () => {
        tr.focus = id;
        save(t('training.toast.focus', { label: f.label }));
      });
      return btn;
    });
    const intensity = segmented(
      Object.entries(T.intensity).map(([id, o]) => ({ id, label: o.label })),
      tr.intensity,
      (id) => {
        tr.intensity = id;
        save(t('training.toast.intensity', { label: T.intensity[id].label }));
      },
      { size: 'small' },
    );
    const focus = panel(
      t('training.team.title'),
      h(
        'div',
        { class: 'tr-team' },
        h('div', { class: 'tr-focus-grid' }, focusCards),
        h('div', { class: 'tr-intensity' }, h('span', { class: 'muted' }, t('training.team.intensity')), intensity.el, h('span', { class: 'muted small-note' }, T.intensity[tr.intensity].desc)),
      ),
    );

    // ── 개인 훈련 ──
    const assigned = Object.entries(tr.individual).filter(([id]) => byId.has(id));
    const groupOptions = (p) => Object.entries(T.groups).filter(([gid, g]) => (p.position === 'GK' ? g.gkOnly || gid === 'physical' : !g.gkOnly));
    const rows = assigned.map(([id, group]) => {
      const p = byId.get(id);
      const ovr = overall(p);
      const pot = scoutedPotential(game, p, ovr);
      const rates = weeklyRates(game, p, tr);
      // 묶음 능력치 하나당 남은 시즌 예상 상승 (지금 속도가 이어진다면)
      const groupAttrs = T.groups[group].attrs;
      const perAttr = groupAttrs.reduce((s, a) => s + (rates[a] ?? 0), 0) / groupAttrs.length;
      const weeksLeft = Math.max(0, game.totalRounds - game.round + 1);
      const sel = h('select', { class: 'select small', 'aria-label': t('training.ind.groupAria', { name: p.name }) }, groupOptions(p).map(([gid, g]) => h('option', { value: gid, selected: gid === group || null }, g.label)));
      sel.addEventListener('change', () => {
        tr.individual[id] = sel.value;
        save(t('training.toast.group', { name: p.name, label: T.groups[sel.value].label }));
      });
      const remove = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': t('training.ind.removeAria', { name: p.name }) }, t('training.ind.remove'));
      remove.addEventListener('click', () => {
        delete tr.individual[id];
        save();
      });
      const veteran = p.age >= T.veteranFrom;
      return h(
        'tr',
        {},
        h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
        h('td', {}, h('b', {}, p.name), h('span', { class: 'muted' }, t('training.ind.age', { age: p.age }))),
        h('td', { class: `num ${attrClass(ovr)}` }, ovr),
        h('td', { class: 'num muted' }, pot ? `${pot.low}~${pot.high}` : '—'),
        h('td', {}, sel),
        h('td', { class: 'muted small-note' }, veteran ? t('training.ind.retention', { pct: pct(tr.retention?.[id] ?? 0) }) : perAttr > 0 ? t('training.ind.outlook', { n: Math.round(perAttr * weeksLeft) }) : t('training.ind.capped')),
        h('td', { class: 'num' }, seasonGainsOf(game, id) ? h('b', { class: 'up' }, `+${seasonGainsOf(game, id)}`) : '—'),
        h('td', {}, remove),
      );
    });
    const free = squad.filter((p) => !tr.individual[p.id]).sort((a, b) => a.age - b.age || overall(b) - overall(a));
    const add = h('select', { class: 'select small', 'aria-label': t('training.ind.addAria'), disabled: assigned.length >= T.individual.max || null }, h('option', { value: '' }, assigned.length >= T.individual.max ? t('training.ind.max', { max: T.individual.max }) : t('training.ind.add')), free.map((p) => h('option', { value: p.id }, t('training.ind.option', { pos: p.position, name: p.name, age: p.age, ovr: overall(p) }))));
    add.addEventListener('change', () => {
      const p = byId.get(add.value);
      if (!p) return;
      tr.individual[p.id] = p.position === 'GK' ? 'goalkeeping' : ['CB', 'LB', 'RB', 'DM'].includes(p.position) ? 'defending' : p.position === 'ST' ? 'finishing' : 'creativity';
      save(t('training.toast.start', { name: p.name }));
    });
    const suggest = h('button', { class: 'btn small', type: 'button' }, t('training.ind.suggest'));
    suggest.addEventListener('click', () => {
      tr.individual = {};
      for (const s of suggestIndividual(dataset, game)) tr.individual[s.id] = s.group;
      save(t('training.toast.suggested'));
    });
    const individual = panel(
      t('training.ind.title', { n: assigned.length, max: T.individual.max }),
      h(
        'div',
        { class: 'tr-individual' },
        rows.length
          ? h('div', { class: 'table-scroll' }, h('table', { class: 'data compact' }, h('thead', {}, h('tr', {}, h('th', {}, t('training.th.pos')), h('th', {}, t('training.th.player')), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, t('training.th.potential')), h('th', {}, t('training.th.focus')), h('th', {}, t('training.th.outlook')), h('th', { class: 'num' }, t('training.th.gain')), h('th', {}, ''))), h('tbody', {}, rows)))
          : h('p', { class: 'muted' }, t('training.ind.empty')),
        h('div', { class: 'btn-row' }, add, suggest),
        h('p', { class: 'muted small-note' }, t('training.ind.note')),
      ),
      { actions: h('span', { class: 'muted small-note' }, t('training.ind.synergy')) },
    );

    // ── 최근 기록 ──
    const log = (tr.log ?? []).slice(0, 16);
    const history = panel(
      t('training.log.title'),
      log.length
        ? h(
            'ul',
            { class: 'tr-log' },
            log.map((l) =>
              h('li', { class: l.kind === 'injury' ? 'bad' : '' }, h('span', { class: 'muted' }, `${l.round ?? ''}R`), l.kind === 'injury' ? t('training.log.injury', { name: l.name, n: l.weeks }) : [` ${l.name} `, h('b', {}, ATTRIBUTE_LABELS[l.attr] ?? l.attr), ` → ${l.value}`]),
            ),
          )
        : h('p', { class: 'muted tr-empty' }, t('training.log.empty')),
    );

    const lock = isMatchInProgress() ? h('div', { class: 'warn-banner' }, h('span', {}, t('training.locked'))) : null;
    host.replaceChildren(...[lock, summary, focus, individual, history].filter(Boolean));
    if (lock) host.querySelectorAll('button, select').forEach((el) => (el.disabled = true));
  };
  draw();
  return host;
}
