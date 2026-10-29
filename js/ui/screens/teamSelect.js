// 팀 선택: 세이브 슬롯 · 리그 탭 · 3D 기울기 팀 카드 · 시작 설정(게임 기간, 저장 슬롯)
import { autoSelectLineup } from '../../engine/lineup.js';
import { computeTeamRatings, overall } from '../../engine/ratings.js';
import { GAME_LENGTHS } from '../../state/game.js';
import { createGame } from '../../state/season.js';
import { track } from '../analytics.js';
import { teamBadge } from '../badge.js';
import { openConfirm, panel, ratingBar, segmented, basisText } from '../components.js';
import { h } from '../dom.js';
import { fmt1 } from '../format.js';
import { attachTilt, openModal } from '../motion.js';

const PREVIEW_FORMATION = '4-3-3';
const SORTS = [
  { id: 'strength', label: '전력순' },
  { id: 'name', label: '이름순' },
];
// 리그 탭 묶음 (나라 코드 기준). 여기에 없는 나라는 '기타'
const REGIONS = [
  { label: '잉글랜드', countries: ['ENG'] },
  { label: '유럽', countries: ['ESP', 'ITA', 'GER', 'FRA', 'NED', 'POR', 'BEL', 'TUR'] },
  { label: '아시아', countries: ['KOR', 'JPN', 'KSA'] },
  { label: '아메리카', countries: ['BRA', 'ARG', 'MEX', 'USA'] },
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
      const t = ctx.dataset.teamById.get(s.game.teamId);
      slotNote.textContent = `슬롯 ${slot}의 ${t?.name ?? ''} 게임을 덮어씁니다.`;
      slotNote.className = 'slot-note warn';
    } else {
      slotNote.textContent = `빈 슬롯 ${slot}에 저장합니다.`;
      slotNote.className = 'slot-note muted';
    }
  };
  const lengthTabs = segmented(GAME_LENGTHS.map((n) => ({ id: String(n), label: `${n}시즌` })), String(years), (id) => (years = Number(id)), { size: 'small' });
  const slotTabs = segmented(
    ctx.slots.map((s) => ({ id: String(s.slot), label: `슬롯 ${s.slot}${s.game ? ' ●' : ''}` })),
    String(slot),
    (id) => {
      slot = Number(id);
      updateNote();
    },
    { size: 'small' },
  );
  updateNote();
  const start = h('button', { class: 'btn primary', type: 'button' }, '이 팀으로 시작');
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, '취소');
  const close = openModal(
    h(
      'div',
      { class: 'confirm-modal' },
      h('div', { class: 'start-head' }, teamBadge(team, 44), h('div', {}, h('h2', {}, `${team.name} 감독으로 시작`), h('p', { class: 'muted' }, `${league.name} ${league.season} · ${team.stadium ?? ''}`))),
      h('div', { class: 'start-row' }, h('span', { class: 'muted' }, '게임 기간'), lengthTabs.el),
      h('div', { class: 'start-row' }, h('span', { class: 'muted' }, '저장 위치'), slotTabs.el),
      slotNote,
      h('p', { class: 'muted small-note' }, '모든 리그가 함께 진행됩니다. 시즌이 끝나면 승강·성장·노화·은퇴·유스가 반영되고, 대륙 대회 진출 팀은 지난 시즌 순위로 정해집니다.'),
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
    if (!s.game && !s.invalid) return h('div', { class: 'slot-card empty' }, h('b', {}, `슬롯 ${s.slot}`), h('span', { class: 'muted' }, '비어 있음'));
    const discard = h('button', { class: 'btn ghost small', type: 'button' }, '삭제');
    discard.addEventListener('click', () =>
      openConfirm({
        title: `슬롯 ${s.slot}을 삭제할까요?`,
        body: '삭제하면 되돌릴 수 없습니다.',
        confirmLabel: '삭제',
        onConfirm: async () => {
          await ctx.discardSave(s.slot);
          refresh();
        },
      }),
    );
    if (s.invalid) {
      return h('div', { class: 'slot-card invalid' }, h('b', {}, `슬롯 ${s.slot}`), h('span', { class: 'muted' }, '데이터·버전이 달라 불러올 수 없음'), discard);
    }
    const g = s.game;
    const team = ctx.dataset.teamById.get(g.teamId);
    const league = ctx.dataset.leagueById.get(g.leagueId);
    const resume = h('button', { class: 'btn primary small', type: 'button' }, '이어하기');
    resume.addEventListener('click', () => ctx.startGame(g));
    const when = g.savedAt ? new Date(g.savedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    return h(
      'div',
      { class: 'slot-card', style: { '--team': team.colors.primary } },
      h('div', { class: 'slot-card-head' }, teamBadge(team, 32), h('div', {}, h('b', {}, team.name), h('span', { class: 'muted' }, `슬롯 ${s.slot} · ${when}`))),
      h('span', { class: 'muted' }, `${league.name} ${g.season} · 시즌 ${g.seasonIndex}/${g.years} · ${g.round > g.totalRounds ? '시즌 종료' : `라운드 ${g.round}/${g.totalRounds}`}`),
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
      { class: 't-tilt-card team-card', type: 'button', style: { '--team': team.colors.primary }, 'aria-label': `${team.name} 선택` },
      h(
        'div',
        { class: 'tc-head' },
        teamBadge(team, 40),
        h('div', { class: 'tc-title' }, h('b', {}, team.name), h('span', { class: 'muted' }, team.stadium ?? '')),
        h('div', { class: 'tc-ovr' }, h('span', {}, Math.round(s.avgOvr)), h('small', {}, '평균')),
      ),
      h('div', { class: 'tc-ratings' }, row('공격', ratings.attack), row('중원', ratings.midfield), row('수비', ratings.defense), row('GK', ratings.goalkeeping)),
      h(
        'div',
        { class: 'tc-foot' },
        h('span', {}, h('span', { class: 'muted' }, '에이스 '), `${s.star.name} `, h('span', { class: 'pos-tag' }, s.star.position), ` ${overall(s.star)}`),
        h('span', { class: 'muted' }, `${s.squadSize}명 · 평균 ${fmt1(s.avgAge)}세`),
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
    leagueMeta.textContent = `${league.name} ${league.season} · ${league.teamIds.length}팀 · 감독을 맡을 팀을 고르세요`;
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
    h('h1', {}, '어느 팀의 감독이 되시겠습니까?'),
    h('p', { class: 'welcome-lede' }, `${dataset.leagues.length}개 리그 ${dataset.allTeams.length}팀 중 한 곳을 맡습니다. 선발과 전술을 정하고, 하프타임 라커룸에서 선수들에게 말을 걸고, 이사회의 기대에 답하세요.`),
    h('p', { class: 'muted' }, '리그를 고르고 팀 카드를 누르면 시작합니다. 강팀으로 우승을 노려도, 약팀으로 생존을 걸어도 됩니다.'),
  );
  return h(
    'div',
    { class: 'team-select' },
    firstVisit ? intro : panel('저장된 게임', slotsHost, { className: 'slots-panel' }),
    h('div', { class: 'page-head' }, h('div', {}, h(firstVisit ? 'h2' : 'h1', { class: firstVisit ? 'page-title' : '' }, '팀 선택'), leagueMeta), sort.el),
    h('div', { class: 'league-tabs' }, leagueTabs.el),
    grid,
    h('p', { class: 'muted small-note basis-note' }, basisText(ctx.dataset.basis), ' · 실제 선수 이름만 쓰며, 능력치는 기록과 시장가치로 자체 계산한 값입니다.'),
  );
}
