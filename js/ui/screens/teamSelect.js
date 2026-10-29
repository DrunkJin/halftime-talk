// 팀 선택: 세이브 슬롯 · 리그 탭 · 3D 기울기 팀 카드 · 시작 설정(게임 기간, 저장 슬롯)
import { autoSelectLineup } from '../../engine/lineup.js';
import { computeTeamRatings, overall } from '../../engine/ratings.js';
import { GAME_LENGTHS } from '../../state/game.js';
import { createGame } from '../../state/season.js';
import { track } from '../analytics.js';
import { langSwitch } from '../langSwitch.js';
import { teamBadge } from '../badge.js';
import { openConfirm, panel, ratingBar, segmented, basisText } from '../components.js';
import { h } from '../dom.js';
import { fmt1 } from '../format.js';
import { attachTilt, openModal } from '../motion.js';
import { localeTag, t } from '../../i18n.js';

const PREVIEW_FORMATION = '4-3-3';
// 라벨은 렌더 때 사전에서 (getter)
const SORTS = ['strength', 'name'].map((id) => ({
  id,
  get label() {
    return t(`select.sort.${id}`);
  },
}));
// 리그 탭 묶음 (나라 코드 기준). 여기에 없는 나라는 '기타'
const region = (id, countries) => ({
  id,
  countries,
  get label() {
    return t(`select.region.${id}`);
  },
});
const REGIONS = [
  region('england', ['ENG']),
  region('europe', ['ESP', 'ITA', 'GER', 'FRA', 'NED', 'POR', 'BEL', 'TUR']),
  region('asia', ['KOR', 'JPN', 'KSA']),
  region('americas', ['BRA', 'ARG', 'MEX', 'USA']),
];
let sortBy = 'strength';
let leagueId = null;

// 팀별 미리보기 수치 (자동 선발 기준). 리그별로 한 번만 계산
const summaryCache = new Map();
function teamSummaries(dataset, id) {
  const key = `${id}`;
  if (summaryCache.get(key)?.dataset === dataset) return summaryCache.get(key).list;
  const league = dataset.leagueById.get(id);
  const list = league.teamIds.map((teamId) => {
    const team = dataset.teamById.get(teamId);
    const squad = dataset.squads.get(teamId);
    const xi = autoSelectLineup(squad, PREVIEW_FORMATION);
    const star = [...squad].sort((a, b) => overall(b) - overall(a))[0];
    return {
      team,
      squadSize: squad.length,
      avgOvr: xi.reduce((s, p) => s + overall(p), 0) / xi.length,
      avgAge: squad.reduce((s, p) => s + p.age, 0) / squad.length,
      ratings: computeTeamRatings(PREVIEW_FORMATION, xi),
      star,
    };
  });
  summaryCache.set(key, { dataset, list });
  return list;
}

function orderedLeagues(dataset) {
  const order = (l) => {
    const r = REGIONS.findIndex((x) => x.countries.includes(l.country));
    return [r < 0 ? REGIONS.length : r, l.level];
  };
  return [...dataset.leagues].sort((a, b) => {
    const [ra, la] = order(a);
    const [rb, lb] = order(b);
    return ra - rb || la - lb;
  });
}

// ── 시작 설정 모달 ────────────────────────────────────

function startModal(ctx, team) {
  const league = ctx.dataset.leagueById.get(team.leagueId);
  const firstFree = ctx.slots.find((s) => !s.game)?.slot ?? 1;
  let years = 3;
  let slot = firstFree;
  const slotNote = h('p', { class: 'slot-note' });
  const updateNote = () => {
    const s = ctx.slots.find((x) => x.slot === slot);
    if (s.game) {
      const other = ctx.dataset.teamById.get(s.game.teamId);
      slotNote.textContent = t('select.start.overwrite', { slot, team: other?.name ?? '' });
      slotNote.className = 'slot-note warn';
    } else {
      slotNote.textContent = t('select.start.emptySlot', { slot });
      slotNote.className = 'slot-note muted';
    }
  };
  const lengthTabs = segmented(GAME_LENGTHS.map((n) => ({ id: String(n), label: t('select.start.years', { n }) })), String(years), (id) => (years = Number(id)), { size: 'small' });
  const slotTabs = segmented(
    ctx.slots.map((s) => ({ id: String(s.slot), label: t(s.game ? 'select.start.slotUsed' : 'select.slot', { slot: s.slot }) })),
    String(slot),
    (id) => {
      slot = Number(id);
      updateNote();
    },
    { size: 'small' },
  );
  updateNote();
  const start = h('button', { class: 'btn primary', type: 'button' }, t('select.start.confirm'));
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, t('select.start.cancel'));
  const close = openModal(
    h(
      'div',
      { class: 'confirm-modal' },
      h('div', { class: 'start-head' }, teamBadge(team, 44), h('div', {}, h('h2', {}, t('select.start.title', { team: team.name })), h('p', { class: 'muted' }, `${league.name} ${league.season} · ${team.stadium ?? ''}`))),
      h('div', { class: 'start-row' }, h('span', { class: 'muted' }, t('select.start.length')), lengthTabs.el),
      h('div', { class: 'start-row' }, h('span', { class: 'muted' }, t('select.start.slot')), slotTabs.el),
      slotNote,
      h('p', { class: 'muted small-note' }, t('select.start.note')),
      h('div', { class: 'confirm-actions' }, cancel, start),
    ),
  );
  cancel.addEventListener('click', close);
  start.addEventListener('click', () => {
    close();
    track('game-start', { team: team.shortName, league: ctx.dataset.leagueById.get(team.leagueId)?.name ?? team.leagueId, years });
    ctx.startGame(createGame(ctx.dataset, team.id, { years, slot }));
  });
}

// ── 세이브 슬롯 ───────────────────────────────────────

function slotsPanel(ctx, refresh) {
  const cards = ctx.slots.map((s) => {
    if (!s.game && !s.invalid) return h('div', { class: 'slot-card empty' }, h('b', {}, t('select.slot', { slot: s.slot })), h('span', { class: 'muted' }, t('select.slots.empty')));
    const discard = h('button', { class: 'btn ghost small', type: 'button' }, t('select.slots.delete'));
    discard.addEventListener('click', () =>
      openConfirm({
        title: t('select.slots.deleteTitle', { slot: s.slot }),
        body: t('select.slots.deleteBody'),
        confirmLabel: t('select.slots.delete'),
        onConfirm: async () => {
          await ctx.discardSave(s.slot);
          refresh();
        },
      }),
    );
    if (s.invalid) {
      return h('div', { class: 'slot-card invalid' }, h('b', {}, t('select.slot', { slot: s.slot })), h('span', { class: 'muted' }, t('select.slots.invalid')), discard);
    }
    const g = s.game;
    const team = ctx.dataset.teamById.get(g.teamId);
    const league = ctx.dataset.leagueById.get(g.leagueId);
    const resume = h('button', { class: 'btn primary small', type: 'button' }, t('select.slots.resume'));
    resume.addEventListener('click', () => {
      track('game-continue', { team: team.shortName, season: g.seasonIndex });
      ctx.startGame(g);
    });
    const when = g.savedAt ? new Date(g.savedAt).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' }) : '';
    return h(
      'div',
      { class: 'slot-card', style: { '--team': team.colors.primary } },
      h('div', { class: 'slot-card-head' }, teamBadge(team, 32), h('div', {}, h('b', {}, team.name), h('span', { class: 'muted' }, t('select.slots.when', { slot: s.slot, when })))),
      h('span', { class: 'muted' }, t('select.slots.progress', { league: league.name, year: g.season, i: g.seasonIndex, n: g.years, progress: g.round > g.totalRounds ? t('select.slots.seasonOver') : t('select.slots.round', { r: g.round, total: g.totalRounds }) })),
      h('div', { class: 'btn-row' }, discard, resume),
    );
  });
  return h('div', { class: 'slots' }, cards);
}

// ── 팀 카드 ───────────────────────────────────────────

function teamCard(ctx, s) {
  const { team, ratings } = s;
  const row = (label, v) => h('div', { class: 'tc-rating' }, h('span', { class: 'muted' }, label), ratingBar(v, { min: 45, max: 90 }), h('span', { class: 'num' }, fmt1(v)));
  const card = h(
    'div',
    { class: 't-tilt team-card-wrap' },
    h(
      'button',
      { class: 't-tilt-card team-card', type: 'button', style: { '--team': team.colors.primary }, 'aria-label': t('select.card.aria', { team: team.name }) },
      h(
        'div',
        { class: 'tc-head' },
        teamBadge(team, 40),
        h('div', { class: 'tc-title' }, h('b', {}, team.name), h('span', { class: 'muted' }, team.stadium ?? '')),
        h('div', { class: 'tc-ovr' }, h('span', {}, Math.round(s.avgOvr)), h('small', {}, t('select.card.avg'))),
      ),
      h('div', { class: 'tc-ratings' }, row(t('select.card.attack'), ratings.attack), row(t('select.card.midfield'), ratings.midfield), row(t('select.card.defense'), ratings.defense), row(t('select.card.gk'), ratings.goalkeeping)),
      h(
        'div',
        { class: 'tc-foot' },
        h('span', {}, h('span', { class: 'muted' }, t('select.card.star')), `${s.star.name} `, h('span', { class: 'pos-tag' }, s.star.position), ` ${overall(s.star)}`),
        h('span', { class: 'muted' }, t('select.card.squad', { n: s.squadSize, age: fmt1(s.avgAge) })),
      ),
      h('div', { class: 't-tilt-glare' }),
    ),
  );
  card.querySelector('.team-card').addEventListener('click', () => startModal(ctx, team));
  attachTilt(card);
  return card;
}

export function render(ctx) {
  const { dataset } = ctx;
  const leagues = orderedLeagues(dataset);
  leagueId ??= leagues[0].id;

  const slotsHost = h('div');
  const refreshSlots = () => slotsHost.replaceChildren(slotsPanel(ctx, refreshSlots));
  refreshSlots();

  const grid = h('div', { class: 'team-grid' });
  const leagueMeta = h('p', { class: 'muted' });
  const fill = () => {
    const league = dataset.leagueById.get(leagueId);
    leagueMeta.textContent = t('select.leagueMeta', { league: league.name, year: league.season, n: league.teamIds.length });
    const sorted = [...teamSummaries(dataset, leagueId)].sort((a, b) => (sortBy === 'name' ? a.team.name.localeCompare(b.team.name) : b.avgOvr - a.avgOvr));
    grid.replaceChildren(...sorted.map((s) => teamCard(ctx, s)));
  };
  fill();

  const leagueTabs = segmented(
    leagues.map((l) => ({ id: l.id, label: l.name })),
    leagueId,
    (id) => {
      leagueId = id;
      fill();
    },
    { size: 'small' },
  );
  const sort = segmented(SORTS, sortBy, (id) => {
    sortBy = id;
    fill();
  });

  // 처음 온 사람: 빈 슬롯 대신 이 게임이 무엇이고 무엇부터 하는지. 저장된 게임이 있으면 이어하기가 먼저
  const firstVisit = ctx.slots.every((s) => !s.game && !s.invalid);
  const intro = h(
    'div',
    { class: 'welcome' },
    h('h1', {}, t('select.intro.title')),
    h('p', { class: 'welcome-lede' }, t('select.intro.lede', { leagues: dataset.leagues.length, teams: dataset.allTeams.length })),
    h('p', { class: 'muted' }, t('select.intro.hint')),
  );
  return h(
    'div',
    { class: 'team-select' },
    langSwitch(),
    firstVisit ? intro : panel(t('select.slots.title'), slotsHost, { className: 'slots-panel' }),
    h('div', { class: 'page-head' }, h('div', {}, h(firstVisit ? 'h2' : 'h1', { class: firstVisit ? 'page-title' : '' }, t('select.title')), leagueMeta), sort.el),
    h('div', { class: 'league-tabs' }, leagueTabs.el),
    grid,
    h('p', { class: 'muted small-note basis-note' }, basisText(ctx.dataset.basis), t('select.basisNote')),
  );
}
