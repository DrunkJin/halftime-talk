// 경기: 경기 전(선발·전력 비교) → 실시간 텍스트 중계 → 경기 후(다른 경기 결과)
import { FORMATION_CELLS, formationLabel, positionOfCell } from '../../engine/formations.js';
import { HALF_TIME_MINUTE, MATCH_MINUTES } from '../../engine/config.js';
import { changeFormation, createMatch, getMatchResult, makeSubstitution, playMinute, setAutoSubs, setTactics, teamSnapshot } from '../../engine/match.js';
import { computeTeamRatings, conditionFactor, overall, positionFit, positionRating } from '../../engine/ratings.js';
import { computeTable } from '../../league/table.js';
import { availabilityOf, conditionOf, fixLineup, fixturesOf, isSeasonOver, leagueOf, lineupProblems, matchInput, rotateTired, roundFixtures, settingsOf, tacticsOf, userFixture } from '../../state/game.js';
import { RULES } from '../../state/rules.js';
import { advanceCup, advanceRound, advanceSeason, simulateRest } from '../../state/simulation.js';
import { expiringContracts, suggestedRenewals } from '../../state/newSeason.js';
import { contractOf, renewalTerms } from '../../market/finance.js';
import { formatWage } from '../../market/market.js';
import { teamAccent, teamBadge } from '../badge.js';
import { conditionMeter, openConfirm, panel, segmented, statusChip } from '../components.js';
import { h } from '../dom.js';
import { attrClass, fmt1, shortName } from '../format.js';
import { formatMoney } from '../../market/value.js';
import { formationPicker, presetFormationOptions, tacticLabel, tacticSummary, tacticsPicker } from '../tactics.js';
import { analysisPanel } from '../analysis.js';
import { familiarityBoost, familiarityOf } from '../../state/familiarity.js';
import { answerPost, answerPre, answerTalk, cupTeamTalk, loadMedia, postCupInterview, postInterview, preCupInterview, preInterview, teamTalk } from '../../media/interviews.js';
import { compOf, cupMatchInput, cupsOf, eventFixtures, firstLegOf, leaguePhaseTable, stageName, userCupFixture } from '../../competitions/cups.js';
import { STANCES } from '../../media/situations.js';
import { moraleLabel, moraleOf } from '../../state/morale.js';
import { openModal, setDigits, showToast, streamText } from '../motion.js';

const SPEEDS = [
  { id: '1', label: '×1', ms: 1000 },
  { id: '2', label: '×2', ms: 500 },
  { id: '4', label: '×4', ms: 250 },
  { id: '8', label: '×8', ms: 110 },
];
let speedId = '4';

// 중계 줄 종류별 스타일·아이콘
const FEED_KIND = {
  goal: 'c-goal', kickoff: 'c-period', halftime: 'c-period', fulltime: 'c-period', saved: 'c-chance', woodwork: 'c-chance',
  yellow: 'c-card', red: 'c-red', secondYellow: 'c-red', injury: 'c-injury', sub: 'c-sub', subInjury: 'c-sub', outfieldGk: 'c-injury', shortHanded: 'c-injury',
  tactic: 'c-tactic', formation: 'c-tactic',
};
const FEED_ICON = { yellow: 'card-icon yellow', red: 'card-icon red', secondYellow: 'card-icon red', injury: 'injury-icon', sub: 'sub-icon', subInjury: 'sub-icon' };
const speedMs = () => SPEEDS.find((s) => s.id === speedId).ms;

// 진행 중이거나 막 끝난 경기. 화면을 떠나도 유지되고, 떠나면 일시정지
let live = null; // { fixture, state, timer, paused, done, others, gap }
// 경기 전 기자회견 질문: 화면을 다시 그려도 바뀌지 않게 경기별로 보관
let pendingPre = null; // { key, interview }

// 경기 전 전력 차 (우리 - 상대, 전술·홈 어드밴티지 제외 필드 레이팅 평균)
function strengthGap(state, mySide) {
  const avg = (r) => (r.attack + r.midfield + r.defense) / 3;
  return avg(state.teams[mySide].baseRatings) - avg(state.teams[mySide === 'home' ? 'away' : 'home'].baseRatings);
}
const signed = (v) => (Math.round(v) === 0 ? '±0' : `${v > 0 ? '+' : ''}${Math.round(v)}`);

function stopTimer() {
  if (live?.timer) clearTimeout(live.timer);
  if (live) live.timer = null;
}

export function reset() {
  stopTimer();
  live = null;
  pendingPre = null;
}

// 진행 중(끝나지 않은) 경기가 있는지 — 이 동안에는 선수 판매·해지를 막는다
export const isMatchInProgress = () => Boolean(live && !live.done);

export function leave() {
  if (live && !live.done) {
    stopTimer();
    live.paused = true;
  }
}

export function render(ctx) {
  const host = h('div', { class: 'match-screen' });
  const show = () => {
    if (live) host.replaceChildren(renderLive(ctx, show));
    else if (isSeasonOver(ctx.game)) host.replaceChildren(renderSeasonOver(ctx, show));
    else host.replaceChildren(renderPre(ctx, show));
  };
  show();
  return host;
}

// ── 공통 조각 ─────────────────────────────────────────

const teamOf = (ctx, id) => ctx.dataset.teamById.get(id);

function speedTabs(onChange) {
  return segmented(SPEEDS, speedId, (id) => {
    speedId = id;
    onChange?.();
  }, { size: 'small' });
}

function compareRow(label, a, b) {
  // 30~90 범위로 표시 (K리그 50대부터 유럽 상위권 80대까지 막대가 보이도록)
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - 30) / 60) * 100))}%`;
  return h(
    'div',
    { class: 'cmp-row' },
    h('span', { class: 'num' }, fmt1(a)),
    h('span', { class: 'cmp-bar left' }, h('span', { style: { width: pct(a) }, class: a >= b ? 'lead' : '' })),
    h('span', { class: 'cmp-label muted' }, label),
    h('span', { class: 'cmp-bar' }, h('span', { style: { width: pct(b) }, class: b >= a ? 'lead' : '' })),
    h('span', { class: 'num' }, fmt1(b)),
  );
}

const inputRatings = (input) => computeTeamRatings(input.slots, input.lineup, (p) => conditionFactor(input.condition[p.id]));

function lineupTable(ctx, team, input) {
  const { game } = ctx;
  const row = (p, slot) =>
    h(
      'tr',
      { class: availabilityOf(game, p.id).available ? '' : 'is-unavailable' },
      h('td', {}, slot ? h('span', { class: 'slot-tag' }, slot) : h('span', { class: 'pos-tag' }, p.position)),
      h('td', {}, p.name, ' ', statusChip(game, p.id)),
      h('td', {}, conditionMeter(input.condition[p.id] ?? 100)),
      h('td', { class: `num ${attrClass(overall(p))}` }, overall(p)),
    );
  return h(
    'table',
    { class: 'data compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '슬롯'), h('th', {}, `${team.shortName} (${formationLabel(cellsOf(ctx, input))})`), h('th', {}, '컨디션'), h('th', { class: 'num' }, 'OVR'))),
    h(
      'tbody',
      {},
      input.lineup.map((p, i) => row(p, input.slots[i])),
      h('tr', { class: 'divider' }, h('td', { colspan: 4 }, `교체 명단 ${input.bench.length}명`)),
      input.bench.map((p) => row(p, null)),
    ),
  );
}

// 포메이션 이름 표기용 칸: 사용자 팀은 직접 배치한 칸, AI는 프리셋
const cellsOf = (ctx, input) => (input.id === ctx.game.teamId ? ctx.game.formation.cells : FORMATION_CELLS[input.formation]);

// ── 경기 전 ───────────────────────────────────────────

// 대륙 대회 경기 제목: 'UEFA 챔피언스리그 · 16강 2차전'
export function cupFixtureLabel(game, fixture) {
  const comp = compOf(game, fixture);
  const what = fixture.stage === 'league' ? `리그 페이즈 ${fixture.md}차전` : fixture.stage === 'final' ? '결승' : `${stageName(fixture.stage)} ${fixture.leg}차전`;
  return `${comp.name} · ${what}`;
}

function renderPre(ctx, show) {
  const { dataset, game } = ctx;
  // 주중 대륙 대회 경기가 있으면 그것부터
  const cupFx = userCupFixture(game);
  const fixture = cupFx ?? userFixture(game);
  const scope = cupFx ? 'cup' : 'league';
  const makeInput = (g) => (cupFx ? cupMatchInput(dataset, g, cupFx) : matchInput(dataset, g, fixture));
  if (!fixture) {
    const skip = h('button', { class: 'btn primary', type: 'button' }, '라운드 진행');
    skip.addEventListener('click', async () => {
      const r = await ctx.runBusy('다른 경기 진행 중', () => advanceRound(dataset, ctx.game, null));
      ctx.setGame(r.game);
      show();
      notifyMarket(ctx, r);
    });
    return panel(`라운드 ${game.round}`, h('div', { class: 'empty' }, h('p', {}, '이번 라운드는 경기가 없습니다.'), skip));
  }

  const input = makeInput(game);
  const mySide = fixture.homeId === game.teamId ? 'home' : 'away';
  const home = teamOf(ctx, fixture.homeId);
  const away = teamOf(ctx, fixture.awayId);
  const rh = inputRatings(input.home);
  const ra = inputRatings(input.away);

  // 부상·출장정지·이적으로 선발에 못 서는 선수가 있으면 경기 시작 불가
  const problems = lineupProblems(dataset, game, scope);
  const blocked = problems.length > 0;
  const fixBtn = h('button', { class: 'btn small primary', type: 'button' }, '자동으로 대체');
  fixBtn.addEventListener('click', () => {
    fixLineup(dataset, game, scope);
    ctx.persist();
    show();
  });
  const warning = blocked
    ? h(
        'div',
        { class: 'warn-banner' },
        h('span', {}, h('b', {}, `선발에 출전할 수 없는 선수 ${problems.length}명`), ' — ', problems.map(({ id }) => `${dataset.playerById.get(id).name} (${availabilityOf(game, id, scope).label || '이적'})`).join(', ')),
        fixBtn,
      )
    : null;

  // 지친 선수 자동 휴식 (설정이 켜져 있으면 킥오프 때 적용)
  const rotateNow = () => {
    if (!settingsOf(ctx.game).autoRotate) return;
    const changes = rotateTired(dataset, ctx.game, scope);
    if (changes.length) {
      ctx.persist();
      showToast(`지친 선수 휴식: ${changes.map((c) => `${c.slot} ${c.out} → ${c.in}`).join(', ')}`, { duration: 4500 });
    }
  };
  const tired = game.lineup.filter((id) => conditionOf(game, id) < RULES.rotateBelow).map((id) => dataset.playerById.get(id)?.name).filter(Boolean);
  const tiredNote = tired.length
    ? h('p', { class: 'muted small-note tired-note' }, `컨디션이 떨어진 선발 ${tired.length}명: ${tired.join(', ')}${settingsOf(game).autoRotate ? ' — 킥오프 때 더 나은 후보가 있으면 쉬게 합니다' : ' — 선발 바꾸기에서 쉬게 할 수 있습니다'}`)
    : null;

  // 상대 분석 · 전술 숙련도
  const analysis = analysisPanel(ctx.game, makeInput, mySide, (t) => {
    ctx.game.tactics = t;
    ctx.persist();
    showToast(`전술 변경: ${tacticSummary(t)}`);
    show();
  });
  const famLine = h('p', { class: 'fam-line' }, ...familiarityLine(game));

  const kickoff = h('button', { class: 'btn primary big', type: 'button', disabled: blocked || null }, '킥오프');
  kickoff.addEventListener('click', () => {
    rotateNow();
    // 화면을 그린 뒤 바꾼 전술이 반영되도록 킥오프 때 입력을 다시 만든다
    const state = createMatch(makeInput(ctx.game));
    live = { fixture, state, timer: null, paused: false, done: false, others: null, gap: strengthGap(state, mySide), cup: Boolean(cupFx), formationLabel: formationLabel(ctx.game.formation.cells) };
    show();
  });
  const instant = h('button', { class: 'btn', type: 'button', disabled: blocked || null }, '결과만 보기');
  instant.addEventListener('click', () => {
    rotateNow();
    const state = createMatch(makeInput(ctx.game));
    while (!state.finished) playMinute(state);
    live = { fixture, state, timer: null, paused: true, done: false, others: null, gap: strengthGap(state, mySide), cup: Boolean(cupFx), formationLabel: formationLabel(ctx.game.formation.cells) };
    show(); // 경기 화면이 결과 반영(실패 시 다시 시도 포함)을 맡는다
  });
  const rest = h('button', { class: 'btn ghost', type: 'button', disabled: blocked || null }, '시즌 끝까지');
  rest.addEventListener('click', () =>
    openConfirm({
      title: '남은 시즌을 자동으로 진행할까요?',
      body: `남은 ${game.totalRounds - game.round + 1}라운드를 자동으로 치릅니다. 결장자·지친 선수는 후보로 바꾸고, 전술은 상대에 맞춰 수석코치가 정합니다. 이적시장 기간도 그대로 지나갑니다.`,
      confirmLabel: '진행',
      onConfirm: async () => {
        const r = await ctx.runBusy('남은 시즌 진행 중', () => simulateRest(dataset, ctx.game));
        ctx.setGame(r.game);
        show();
      },
    }),
  );
  const editLineup = h('button', { class: 'btn ghost', type: 'button' }, '선발 바꾸기');
  editLineup.addEventListener('click', () => ctx.navigate('squad'));

  // 시즌 막판: 계약 만료 예정 안내 (재계약은 시즌 결산에서 고른다)
  const expiringCount = !cupFx && game.round > game.totalRounds - 5 && game.seasonIndex < game.years ? expiringContracts(dataset, game).length : 0;
  const expiryNote = expiringCount ? h('p', { class: 'muted small-note expiry-note' }, `계약 만료 예정 ${expiringCount}명 — 시즌이 끝나면 재계약할 선수를 고릅니다 (재정 화면에서 미리 재계약할 수도 있습니다).`) : null;

  // 같은 라운드 경기: 대륙 대회면 같은 대회의 이번 주중 경기
  const others = cupFx ? eventFixtures(game, { stage: cupFx.stage, md: cupFx.md, leg: cupFx.leg }).filter((f) => f.comp === cupFx.comp && f !== cupFx) : roundFixtures(game).filter((f) => f !== fixture);

  // 경기 전 기자회견
  const pressHost = h('div', { class: 'press-host' }, h('p', { class: 'muted' }, '기자회견 준비 중…'));
  const renderPress = (media) => {
    if (!media) return pressHost.replaceChildren(h('p', { class: 'muted' }, '인터뷰 데이터를 불러오지 못했습니다.'));
    const done = game.press?.round === game.round && game.press.fixtureId === fixture.id ? game.press : null;
    if (done) {
      return pressHost.replaceChildren(
        done.skipped ? h('p', { class: 'muted' }, '기자회견을 생략했습니다.') : answeredView(done.question, STANCES.pre[done.stance], done.text, '경기 결과에 따라 선수단 사기가 한 번 더 달라집니다.'),
      );
    }
    const key = `${game.seed}:${game.slot}:${game.teamId}:${game.seasonIndex}:${fixture.id}`;
    if (pendingPre?.key !== key) pendingPre = { key, interview: cupFx ? preCupInterview(media, dataset, game, fixture, input) : preInterview(media, dataset, game, fixture, input) };
    const iv = pendingPre.interview;
    pressHost.replaceChildren(
      interviewView(
        iv,
        (stance) => {
          const { delta } = answerPre(ctx.game, iv, stance);
          ctx.persist();
          showToast(delta ? `선수단 사기 ${signed(delta)}` : '기자회견을 마쳤습니다');
          show();
        },
        () => {
          ctx.game.press = { round: game.round, fixtureId: fixture.id, skipped: true };
          ctx.persist();
          renderPress(media);
        },
        '기자회견 생략',
      ),
    );
  };
  loadMedia().then(renderPress);

  return h(
    'div',
    { class: 'match-pre' },
    panel(
      cupFx ? `${cupFixtureLabel(game, cupFx)} · 주중 경기${cupFx.neutral ? ' · 중립 경기장' : ` · ${home.stadium ?? ''}`}` : `라운드 ${game.round} · ${home.stadium ?? ''}`,
      h(
        'div',
        { class: 'pre-body' },
        h(
          'div',
          { class: 'matchup' },
          h('div', { class: 'mu-team' }, teamBadge(home, 64), h('b', {}, home.name), h('span', { class: 'muted' }, cupFx?.neutral ? '' : '홈')),
          h('div', { class: 'mu-vs' }, 'VS', cupFx ? cupPreNote(game, cupFx, mySide) : null),
          h('div', { class: 'mu-team' }, teamBadge(away, 64), h('b', {}, away.name), h('span', { class: 'muted' }, cupFx?.neutral ? '' : '원정')),
        ),
        moraleMeter(ctx),
        expiryNote,
        tiredNote,
        h(
          'div',
          { class: 'cmp' },
          compareRow('공격', rh.attack, ra.attack),
          compareRow('중원', rh.midfield, ra.midfield),
          compareRow('수비', rh.defense, ra.defense),
          compareRow('GK', rh.goalkeeping, ra.goalkeeping),
        ),
        warning,
        h(
          'div',
          { class: 'pre-tactics' },
          h('h3', {}, '전술 지시'),
          tacticsPicker(tacticsOf(game), (t) => {
            ctx.game.tactics = t;
            ctx.persist();
            famLine.replaceChildren(...familiarityLine(ctx.game));
            analysis.refresh();
          }),
          famLine,
        ),
        h(
          'div',
          { class: 'pre-actions' },
          h('div', { class: 'pre-options' }, h('div', { class: 'speed' }, h('span', { class: 'muted' }, '중계 속도'), speedTabs().el), settingToggle(ctx, 'autoSubs', '자동 교체'), settingToggle(ctx, 'pauseAtHalfTime', '하프타임에 멈추기'), settingToggle(ctx, 'autoRotate', '지친 선수 자동 휴식')),
          h('div', { class: 'btn-row' }, editLineup, rest, instant, kickoff),
        ),
      ),
    ),
    panel('상대 분석', analysis.el, { className: 'analysis-panel' }),
    panel('경기 전 기자회견', pressHost, { className: 'press-panel' }),
    h('div', { class: 'pre-grid' }, panel('홈 선발', lineupTable(ctx, home, input.home)), panel('원정 선발', lineupTable(ctx, away, input.away)), panel('같은 라운드', fixtureList(ctx, others))),
  );
}

// 전술 숙련도 한 줄: 지금 포메이션·공격 방식이 얼마나 손에 익었는지와 경기력 보정
function familiarityLine(game) {
  const value = familiarityOf(game);
  const boost = familiarityBoost(value) * 100;
  return [
    h('span', { class: 'muted' }, `전술 숙련도 (${formationLabel(game.formation.cells)} · ${tacticLabel('style', tacticsOf(game).style)}) `),
    h('span', { class: 'fam-bar', style: { '--v': `${Math.round(value * 100)}%` } }),
    h('b', {}, ` ${Math.round(value * 100)}%`),
    h('span', { class: `muted${boost >= 0.05 ? ' up' : boost <= -0.05 ? ' down' : ''}` }, ` · 경기력 ${boost >= 0 ? '+' : ''}${boost.toFixed(1)}%`),
  ];
}

// 대륙 대회 경기 전 메모: 2차전이면 1차전 스코어, 리그 페이즈면 현재 순위
function cupPreNote(game, fixture, mySide) {
  const first = firstLegOf(game, fixture);
  if (first?.result) {
    const oppSide = mySide === 'home' ? 'away' : 'home';
    return h('small', { class: 'cup-note' }, `1차전 ${first.result.score[oppSide]}-${first.result.score[mySide]}`);
  }
  if (fixture.stage === 'league' && fixture.md > 1) {
    const row = leaguePhaseTable(compOf(game, fixture)).find((r) => r.teamId === game.teamId);
    return h('small', { class: 'cup-note' }, `리그 페이즈 ${row.position}위`);
  }
  return null;
}

// 팀 사기 막대
function moraleMeter(ctx) {
  const v = moraleOf(ctx.dataset, ctx.game, ctx.game.teamId);
  const tone = v >= 62 ? 'good' : v < 40 ? 'bad' : 'mid';
  return h(
    'div',
    { class: 'morale-meter', title: '최근 경기 흐름과 인터뷰·팀 토크로 바뀝니다. 경기 레이팅에 조금 반영됩니다.' },
    h('span', { class: 'muted' }, '팀 사기'),
    h('span', { class: 'morale-bar' }, h('span', { class: tone, style: { width: `${v}%` } })),
    h('b', {}, `${moraleLabel(v)} · ${v}`),
  );
}

// 인터뷰·팀 토크 선택지. onAnswer(stance), onSkip()
function interviewView(iv, onAnswer, onSkip, skipLabel) {
  const buttons = iv.answers.map((a) => {
    const b = h('button', { type: 'button', class: 'answer-btn' }, h('span', { class: 'stance-chip' }, a.label), h('span', { class: 'answer-text' }, a.text));
    b.addEventListener('click', () => onAnswer(a.stance));
    return b;
  });
  const skip = h('button', { type: 'button', class: 'btn small ghost' }, skipLabel);
  skip.addEventListener('click', onSkip);
  return h('div', { class: `interview ${iv.kind}` }, h('p', { class: 'iv-question' }, iv.question), h('div', { class: 'iv-answers' }, buttons), h('div', { class: 'btn-row end' }, skip));
}

function answeredView(question, label, text, note) {
  return h(
    'div',
    { class: 'interview answered' },
    h('p', { class: 'iv-question' }, question),
    h('p', { class: 'iv-answer' }, h('span', { class: 'stance-chip' }, label), h('span', { class: 'answer-text' }, text)),
    note ? h('p', { class: 'muted small-note' }, note) : null,
  );
}

// 경기 설정 체크박스 (세이브에 저장)
function settingToggle(ctx, key, label, onChange) {
  const box = h('input', { type: 'checkbox', checked: settingsOf(ctx.game)[key] || null });
  box.addEventListener('change', () => {
    ctx.game.settings = { ...settingsOf(ctx.game), [key]: box.checked };
    ctx.persist();
    onChange?.(box.checked);
  });
  return h('label', { class: 'check' }, box, label);
}

function fixtureList(ctx, fixtures, highlight = null) {
  return h(
    'table',
    { class: 'data compact fixtures' },
    h(
      'tbody',
      {},
      fixtures.map((f) => {
        const home = teamOf(ctx, f.homeId);
        const away = teamOf(ctx, f.awayId);
        const pens = f.result?.penalties ? ` (PK ${f.result.penalties.home}-${f.result.penalties.away})` : f.result?.extraTime ? ' (연장)' : '';
        const score = f.result ? `${f.result.score.home} - ${f.result.score.away}${pens}` : 'vs';
        return h(
          'tr',
          { class: f === highlight ? 'is-mine' : '' },
          h('td', { class: 'fx-home' }, home.shortName, ' ', teamBadge(home, 18)),
          h('td', { class: 'fx-score num' }, score),
          h('td', { class: 'fx-away' }, teamBadge(away, 18), ' ', away.shortName),
        );
      }),
    ),
  );
}

// ── 경기 중 · 경기 후 ─────────────────────────────────

// 경기 결과를 넘겨 이번 라운드(모든 리그)를 진행한다. Worker가 새 game을 돌려주므로 바꿔 끼운다
// 같은 경기를 두 번 반영하지 않도록 진행 중인 반영을 공유한다
function finishMatch(ctx) {
  stopTimer();
  const m = live;
  m.finishing ??= (async () => {
    m.result = getMatchResult(m.state);
    const r = await ctx.runBusy('다른 경기 진행 중', () => (m.cup ? advanceCup : advanceRound)(ctx.dataset, ctx.game, m.result));
    ctx.setGame(r.game);
    m.otherIds = r.otherFixtureIds ?? [];
    m.done = true;
    notifyMarket(ctx, r);
  })().catch((err) => {
    m.finishing = null; // 실패하면 다시 시도할 수 있게
    throw err;
  });
  return m.finishing;
}

// 진행 중 생긴 이적 소식: 우리 선수에게 온 제안, 우리 리그 AI 이적
function notifyMarket(ctx, r) {
  const { dataset, game } = ctx;
  // 우리 팀이 안 나간 주중 대륙 대회 경기가 함께 진행됐으면 알린다
  const cupWeeks = (r.cups ?? []).filter((c) => c && !c.fixtureIds.some((id) => cupFixtureById(game, id) && [cupFixtureById(game, id).homeId, cupFixtureById(game, id).awayId].includes(game.teamId)));
  if (cupWeeks.length) showToast(`주중 대륙 대회 경기 진행${cupWeeks.some((c) => c.newStage) ? ' · 다음 단계 대진 확정' : ''} — 대륙 대회 탭`, { duration: 3500 });
  for (const o of r.newOffers ?? []) {
    showToast(`영입 제안: ${dataset.teamById.get(o.teamId).shortName} → ${dataset.playerById.get(o.playerId).name}, ${formatMoney(o.amount)} (이적 › 받은 제안)`, { tone: 'warn', duration: 4500 });
  }
  // 이번 주 훈련 결과: 오른 능력치, 훈련 중 부상
  const tr = r.training;
  if (tr?.gains?.length) {
    const names = [...new Set(tr.gains.map((g) => g.name))];
    showToast(`훈련 성과: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` 외 ${names.length - 3}명` : ''} 능력치 상승 (${tr.gains.length}) — 훈련 탭`, { duration: 3500 });
  }
  for (const i of tr?.injuries ?? []) showToast(`훈련 중 부상: ${i.name} (${i.weeks}경기 결장)`, { tone: 'warn', duration: 4500 });
  const myLeague = new Set(dataset.leagueById.get(game.leagueId).teamIds);
  const local = (r.aiTransfers ?? []).filter((t) => myLeague.has(t.to) || myLeague.has(t.from));
  if (local.length) showToast(`이적 소식 ${local.length}건 (우리 리그) — 이적 › 이적 기록`, { duration: 3500 });
}

// 진행 후 game이 바뀌었으므로 경기는 id로 다시 찾는다
const fixtureById = (game, id) => fixturesOf(game).find((f) => f.id === id);
const cupFixtureById = (game, id) => Object.values(cupsOf(game)?.comps ?? {}).flatMap((c) => c.fixtures).find((f) => f.id === id) ?? null;

function renderLive(ctx, show) {
  const { dataset, game } = ctx;
  const { fixture, state } = live;
  const home = teamOf(ctx, fixture.homeId);
  const away = teamOf(ctx, fixture.awayId);
  const sideTeam = { home, away };
  const mySide = fixture.homeId === game.teamId ? 'home' : 'away';

  // 경기 후: 우리 팀에 새로 생긴 부상·출장정지
  function absenceReport() {
    const r = live.result;
    if (!r) return null;
    const lines = [
      ...r.injuries.filter((i) => i.team === mySide).map((i) => h('li', {}, h('span', { class: 'status-chip injury' }, `부상 ${i.matchesOut}`), ` ${i.playerName} · ${i.type}`)),
      ...[...new Set(r.cards.filter((c) => c.team === mySide).map((c) => c.playerId))]
        .map((id) => ({ id, a: availabilityOf(ctx.game, id) }))
        .filter(({ a }) => a.reason === 'suspension')
        .map(({ id, a }) => h('li', {}, h('span', { class: 'status-chip suspension' }, `정지 ${a.rounds}`), ` ${dataset.playerById.get(id).name}`)),
    ];
    return lines.length ? h('ul', { class: 'absences' }, lines) : null;
  }

  // 스코어보드
  const scoreDigits = { home: h('span', { class: 't-digit-group' }), away: h('span', { class: 't-digit-group' }) };
  const goalLists = { home: h('ul', { class: 'goal-list' }), away: h('ul', { class: 'goal-list right' }) };
  const minuteEl = h('span', { class: 'sb-minute num' });
  const statusEl = h('span', { class: 'sb-status' });
  const aggEl = h('div', { class: 'sb-agg muted' }); // 2차전 합계 · 승부차기
  const scoreboard = h(
    'section',
    { class: 'scoreboard panel', style: { '--home': teamAccent(home), '--away': teamAccent(away) } },
    h('div', { class: 'sb-team' }, teamBadge(home, 52), h('div', {}, h('b', {}, home.name), goalLists.home)),
    h('div', { class: 'sb-center' }, h('div', { class: 'sb-score num' }, scoreDigits.home, h('span', { class: 'sb-dash' }, '-'), scoreDigits.away), h('div', { class: 'sb-meta' }, minuteEl, statusEl), aggEl),
    h('div', { class: 'sb-team right' }, h('div', {}, h('b', {}, away.name), goalLists.away), teamBadge(away, 52)),
  );

  // 컨트롤
  const pauseBtn = h('button', { class: 'btn small', type: 'button' });
  const skipBtn = h('button', { class: 'btn small ghost', type: 'button' }, '끝까지');
  const speed = speedTabs(() => {
    if (live?.timer) {
      stopTimer();
      schedule();
    }
  });
  const subBtn = h('button', { class: 'btn small primary', type: 'button' });
  const tacticLine = h('span', { class: 'tactic-line muted' });
  const updateSubBtn = () => {
    const snap = teamSnapshot(state, mySide);
    subBtn.textContent = `감독 지시 · 교체 ${snap.subsLeft}장`;
    tacticLine.textContent = `${snap.formation ?? live.formationLabel ?? formationLabel(ctx.game.formation.cells)} · ${tacticSummary(snap.tactics)}`;
  };
  subBtn.addEventListener('click', () => openCommandModal());
  const autoToggle = settingToggle(ctx, 'autoSubs', '자동 교체', (on) => setAutoSubs(state, mySide, on));
  const controls = h('div', { class: 'live-controls' }, pauseBtn, subBtn, tacticLine, h('div', { class: 'speed' }, h('span', { class: 'muted' }, '속도'), speed.el), autoToggle, skipBtn);

  // 중계 · 기록
  const feed = h('ol', { class: 'feed' });
  const statsBody = h('tbody');
  const after = h('div', { class: 'after' });

  // 스코어보드 아래 득점·퇴장 목록
  function eventItems(side) {
    const items = [
      ...state.goals.filter((g) => g.team === side).map((g) => ({ minute: g.minute, el: h('li', {}, `${shortName(g.scorerName)} ${g.minute}'`) })),
      ...state.cards
        .filter((c) => c.team === side && c.type === 'red')
        .map((c) => ({ minute: c.minute, el: h('li', { class: 'ev-red' }, h('span', { class: 'card-icon red' }), `${shortName(c.playerName)} ${c.minute}'`) })),
    ];
    return items.sort((a, b) => a.minute - b.minute).map((x) => x.el);
  }

  // 아직 안 그린 중계 줄을 위에 붙인다 (마지막 줄만 스트리밍)
  let rendered = 0;
  function syncFeed(animate) {
    const fresh = state.commentary.slice(rendered);
    rendered = state.commentary.length;
    fresh.forEach((c, i) => feed.prepend(feedLine(c, animate && i === fresh.length - 1)));
  }

  function pause() {
    live.paused = true;
    stopTimer();
    updateStatus();
  }

  // 감독 지시 창: 경기를 멈추고 교체 · 포메이션 · 전술을 바꾼다
  function openCommandModal(tab = 'subs', { onClose } = {}) {
    if (!live.paused) pause();
    const body = h('div', { class: 'cmd-body' });
    const title = h('h2', {});
    const tabs = segmented(
      [
        { id: 'subs', label: '교체' },
        { id: 'formation', label: '포메이션' },
        { id: 'tactics', label: '전술' },
      ],
      tab,
      (id) => {
        tab = id;
        renderBody();
      },
      { size: 'small' },
    );
    const closeBtn = h('button', { class: 'btn ghost', type: 'button' }, '닫기');
    const resumeBtn = h('button', { class: 'btn primary', type: 'button' }, '닫고 재개');

    // 변경 후 화면 갱신 (중계 줄, 버튼, 기록)
    const applied = (res) => {
      showToast(res.message, { tone: res.ok ? '' : 'warn' });
      if (!res.ok) return;
      syncFeed(false);
      updateSubBtn();
      updateStats();
      renderBody();
    };

    function subsBody() {
      const snap = teamSnapshot(state, mySide);
      if (snap.subsLeft <= 0) return h('p', { class: 'empty' }, '교체 카드를 모두 썼습니다.');
      let outSlot = null;
      let inId = null;
      const confirm = h('button', { class: 'btn primary', type: 'button', disabled: true }, '교체');
      const refreshConfirm = () => (confirm.disabled = outSlot === null || inId === null);
      // 줄 어디를 눌러도 고르고, 이름 칸은 버튼이라 키보드(Tab·Enter)로도 고른다
      const pickRows = (rows, onPick) => {
        rows.forEach(({ tr, value }) =>
          tr.addEventListener('click', () => {
            rows.forEach((r) => {
              r.tr.classList.toggle('is-selected', r.tr === tr);
              r.tr.querySelector('.pick-btn').setAttribute('aria-pressed', String(r.tr === tr));
            });
            onPick(value);
            refreshConfirm();
          }),
        );
        return rows.map((r) => r.tr);
      };
      const row = (p, pos) =>
        h(
          'tr',
          {},
          h('td', {}, h('span', { class: pos ? 'slot-tag' : 'pos-tag' }, pos ?? p.position)),
          h('td', {}, h('button', { type: 'button', class: 'link pick-btn', 'aria-pressed': 'false' }, p.name)),
          h('td', {}, conditionMeter(snap.condition(p.id))),
          h('td', { class: `num ${attrClass(overall(p))}` }, pos ? Math.round(positionRating(p, pos) * positionFit(p, pos)) : overall(p)),
        );
      const onPitch = snap.lineup.map((p, i) => (p ? { tr: row(p, snap.slots[i]), value: i } : null)).filter(Boolean);
      const benchRows = snap.bench.map((p) => ({ tr: row(p, null), value: p.id }));
      const table = (heading, rows) => h('div', { class: 'sub-col' }, h('h3', {}, heading), h('table', { class: 'data compact pick' }, h('tbody', {}, rows)));
      confirm.addEventListener('click', () => applied(makeSubstitution(state, mySide, outSlot, inId)));
      return h(
        'div',
        {},
        h('div', { class: 'sub-grid' }, table('나갈 선수', pickRows(onPitch, (v) => (outSlot = v))), table('들어올 선수', pickRows(benchRows, (v) => (inId = v)))),
        h('div', { class: 'btn-row end' }, h('span', { class: 'muted small-note' }, '숫자: 경기장 선수는 그 자리 기준 능력, 교체 선수는 OVR'), confirm),
      );
    }

    function formationBody() {
      const snap = teamSnapshot(state, mySide);
      // 프리셋 + 사용자가 직접 짠 포메이션 (프리셋과 다르면)
      const mine = formationLabel(ctx.game.formation.cells);
      const options = presetFormationOptions();
      if (!FORMATION_CELLS[mine]) options.unshift({ id: 'mine', label: `내 포메이션 ${mine}`, cells: ctx.game.formation.cells });
      let picked = snap.formation ?? (FORMATION_CELLS[mine] ? mine : 'mine');
      const apply = h('button', { class: 'btn primary', type: 'button' }, '이 포메이션으로');
      apply.addEventListener('click', () => applied(changeFormation(state, mySide, picked === 'mine' ? ctx.game.formation.cells.map(positionOfCell) : picked)));
      const current = h(
        'table',
        { class: 'data compact' },
        h('tbody', {}, snap.slots.map((pos, i) => h('tr', {}, h('td', {}, h('span', { class: 'slot-tag' }, pos)), h('td', {}, snap.lineup[i]?.name ?? h('span', { class: 'muted' }, '(빈 자리)'))))),
      );
      return h(
        'div',
        { class: 'cmd-formation' },
        formationPicker(options, picked, (id) => (picked = id)),
        h('div', { class: 'btn-row end' }, h('span', { class: 'muted small-note' }, '지금 뛰는 선수를 새 자리에 가장 잘 맞게 다시 세웁니다.'), apply),
        h('h3', {}, '현재 배치'),
        current,
      );
    }

    function tacticsBody() {
      let draft = teamSnapshot(state, mySide).tactics;
      const apply = h('button', { class: 'btn primary', type: 'button' }, '지시 내리기');
      apply.addEventListener('click', () => applied(setTactics(state, mySide, draft)));
      return h('div', {}, tacticsPicker(draft, (t) => (draft = t)), h('div', { class: 'btn-row end' }, apply));
    }

    function renderBody() {
      const snap = teamSnapshot(state, mySide);
      title.textContent = `감독 지시 · ${state.minute}분 · ${home.shortName} ${state.score.home}-${state.score.away} ${away.shortName}`;
      tabs.el.querySelector('[data-id="subs"]').textContent = `교체 (${snap.subsLeft}장)`;
      body.replaceChildren(tab === 'subs' ? subsBody() : tab === 'formation' ? formationBody() : tacticsBody());
    }

    renderBody();
    const close = openModal(h('div', { class: 'confirm-modal sub-modal cmd-modal' }, title, tabs.el, body, h('div', { class: 'confirm-actions' }, closeBtn, resumeBtn)), { onClose });
    closeBtn.addEventListener('click', close);
    resumeBtn.addEventListener('click', () => {
      close();
      resume();
    });
  }

  function resume() {
    if (live?.state === state && live.paused && !state.finished) {
      live.paused = false;
      updateStatus();
      schedule();
    }
  }

  // 하프타임 팀 토크: 고른 말에 따라 후반 레이팅·사기가 바뀐다
  async function openTeamTalk(moment = 'half') {
    const media = await loadMedia();
    if (live?.state !== state) return;
    if (!media) return showToast('교체하거나 재개를 누르세요', { duration: 3500 });
    const talk = live.cup ? cupTeamTalk(media, dataset, ctx.game, state, mySide, live.gap ?? 0, fixture, moment) : teamTalk(media, dataset, ctx.game, state, mySide, live.gap ?? 0);
    const body = h('div', {});
    const heading = moment === 'extraTime' ? '연장전 직전 팀 토크' : '하프타임 팀 토크';
    const close = openModal(h('div', { class: 'confirm-modal talk-modal' }, h('h2', {}, `${heading} · ${home.shortName} ${state.score.home}-${state.score.away} ${away.shortName}`), body));
    const after = (reaction) => {
      const cmd = h('button', { class: 'btn ghost', type: 'button' }, '감독 지시 (교체·전술)');
      const go = h('button', { class: 'btn primary', type: 'button' }, moment === 'extraTime' ? '연장 시작' : '후반 시작');
      cmd.addEventListener('click', () => {
        close();
        openCommandModal('subs');
      });
      go.addEventListener('click', () => {
        close();
        resume();
      });
      body.append(reaction ?? '', h('div', { class: 'confirm-actions' }, cmd, go));
    };
    body.replaceChildren(
      interviewView(
        talk,
        (stance) => {
          const r = answerTalk(ctx.game, state, mySide, talk, stance);
          ctx.persist();
          const a = talk.answers.find((x) => x.stance === stance);
          body.replaceChildren(answeredView(talk.question, a.label, a.text));
          after(h('p', { class: `talk-reaction ${r.tone}` }, r.reaction, h('span', { class: 'muted' }, ` 사기 ${signed(r.morale)}`)));
          updateStats();
        },
        () => {
          body.replaceChildren(h('p', { class: 'muted' }, '말없이 선수들을 내보냅니다.'));
          after(null);
        },
        '말없이 보내기',
      ),
    );
  }

  function feedLine(c, animate) {
    const kind = FEED_KIND[c.type] ?? '';
    const text = h('span', { class: 'feed-text' });
    const icon = FEED_ICON[c.type];
    const li = h(
      'li',
      { class: `feed-line ${kind}`, style: c.team ? { '--side': teamAccent(sideTeam[c.team]) } : {} },
      h('span', { class: 'feed-min num' }, `${c.minute}'`),
      icon ? h('span', { class: `feed-icon ${icon}` }) : h('span', { class: `feed-dot${c.team ? '' : ' none'}` }),
      text,
    );
    if (animate) streamText(text, c.text);
    else text.textContent = c.text;
    return li;
  }

  function updateStats() {
    const r = getMatchResult(state);
    const s = r.stats;
    const rows = [
      ['슈팅', s.home.shots, s.away.shots],
      ['유효슈팅', s.home.shotsOnTarget, s.away.shotsOnTarget],
      ['점유율', s.home.possession, s.away.possession, '%'],
      ['xG', s.home.xg, s.away.xg],
      ['경고', s.home.yellow, s.away.yellow],
      ['퇴장', s.home.red, s.away.red],
    ];
    statsBody.replaceChildren(
      ...rows.map(([label, a, b, unit = '']) => {
        const total = a + b || 1;
        return h(
          'tr',
          {},
          h('td', { class: `num ${a > b ? 'lead' : ''}` }, `${typeof a === 'number' && !Number.isInteger(a) ? a.toFixed(2) : a}${unit}`),
          h('td', { class: 'stat-mid' }, h('span', { class: 'muted' }, label), h('span', { class: 'split' }, h('span', { style: { width: `${(a / total) * 100}%`, background: teamAccent(home) } }), h('span', { style: { width: `${(b / total) * 100}%`, background: teamAccent(away) } }))),
          h('td', { class: `num ${b > a ? 'lead' : ''}` }, `${typeof b === 'number' && !Number.isInteger(b) ? b.toFixed(2) : b}${unit}`),
        );
      }),
    );
  }

  function updateStatus() {
    minuteEl.textContent = live.done || state.finished ? 'FT' : state.minute === 0 ? "0'" : `${state.minute}'`;
    if (live.done) {
      statusEl.replaceChildren(h('span', { class: 'status-ft' }, '경기 종료'));
      pauseBtn.hidden = true;
      skipBtn.hidden = true;
      subBtn.hidden = true;
      tacticLine.hidden = true;
      autoToggle.hidden = true;
      speed.el.parentElement.hidden = true;
    } else if (live.paused) {
      statusEl.replaceChildren(h('span', { class: 'muted' }, state.minute === 0 ? '킥오프 대기' : '일시정지'));
      pauseBtn.textContent = state.minute === 0 ? '시작' : '재개';
    } else {
      const label = state.minute < 45 ? 'LIVE · 전반' : state.minute < MATCH_MINUTES || !state.extraTime ? 'LIVE · 후반' : state.minute < 105 ? 'LIVE · 연장 전반' : 'LIVE · 연장 후반';
      statusEl.replaceChildren(h('span', { class: 't-shimmer live', 'data-text': label }, label));
      pauseBtn.textContent = '일시정지';
    }
  }

  function updateScore(animate) {
    for (const side of ['home', 'away']) {
      if (animate) setDigits(scoreDigits[side], String(state.score[side]));
      else scoreDigits[side].textContent = String(state.score[side]);
      goalLists[side].replaceChildren(...eventItems(side));
    }
    // 2차전 합계, 승부차기 결과
    const prior = state.knockout?.prior;
    const parts = [];
    if (prior && (prior.home || prior.away || fixture.leg === 2)) parts.push(`합계 ${state.score.home + prior.home}-${state.score.away + prior.away}`);
    if (state.penalties) parts.push(`승부차기 ${state.penalties.home}-${state.penalties.away}`);
    aggEl.textContent = parts.join(' · ');
  }

  function renderAfter() {
    const game = ctx.game;
    const mineFixture = live.cup ? cupFixtureById(game, fixture.id) : fixtureById(game, fixture.id);
    const mineResult = mineFixture.result;
    const next = h('button', { class: 'btn primary', type: 'button' }, isSeasonOver(game) ? '시즌 결산' : '다음 경기');
    next.addEventListener('click', () => {
      live = null;
      show();
    });
    const toTable = h('button', { class: 'btn ghost', type: 'button' }, live.cup ? '대륙 대회' : '순위표');
    toTable.addEventListener('click', () => ctx.navigate(live.cup ? 'cups' : 'table'));
    // 결과 줄 오른쪽: 리그는 순위·승점, 대륙 대회는 진출 여부·리그 페이즈 순위
    const standing = (() => {
      if (!live.cup) {
        const league = leagueOf(dataset, game);
        const myRow = computeTable(league.teamIds, fixturesOf(game), league.rules).find((r) => r.teamId === game.teamId);
        return `현재 ${myRow.position}위 · 승점 ${myRow.points}`;
      }
      const r = live.result;
      const oppSide = mySide === 'home' ? 'away' : 'home';
      const agg = r.aggregate ? `합계 ${r.aggregate[mySide]}-${r.aggregate[oppSide]}` : '';
      const pens = r.penalties ? ` · 승부차기 ${r.penalties[mySide]}-${r.penalties[oppSide]}` : '';
      if (fixture.stage === 'final') return r.winner === mySide ? `${compOf(game, fixture).name} 우승!${pens}` : `준우승${pens}`;
      if (fixture.leg === 2) {
        const nextStage = { playoff: '16강', r16: '8강', qf: '4강', sf: '결승' }[fixture.stage];
        return r.winner === mySide ? `${nextStage} 진출 · ${agg}${pens}` : `${stageName(fixture.stage)} 탈락 · ${agg}${pens}`;
      }
      if (fixture.stage === 'league') {
        const row = leaguePhaseTable(compOf(game, fixture)).find((x) => x.teamId === game.teamId);
        return `리그 페이즈 ${row.position}위 · 승점 ${row.points}`;
      }
      return '1차전 종료';
    })();
    const otherFixtures = live.cup
      ? eventFixtures(game, { stage: fixture.stage, md: fixture.md, leg: fixture.leg }).filter((f) => f.comp === fixture.comp && f.id !== fixture.id)
      : live.otherIds.map((id) => fixtureById(game, id));
    const postKey = live.cup ? `cup:${fixture.id}` : fixture.round;
    const outcome = (() => {
      const mine = fixture.homeId === game.teamId ? 'home' : 'away';
      const [m, o] = mine === 'home' ? [mineResult.score.home, mineResult.score.away] : [mineResult.score.away, mineResult.score.home];
      return m > o ? ['승리', 'win'] : m < o ? ['패배', 'loss'] : ['무승부', 'draw'];
    })();
    const postHost = h('div', { class: 'press-host' });
    const renderPost = (media) => {
      const done = game.lastPostInterview?.season === game.seasonIndex && game.lastPostInterview.round === postKey;
      if (live.postAnswered) return postHost.replaceChildren(live.postAnswered);
      if (done) return postHost.replaceChildren(h('p', { class: 'muted' }, game.lastPostInterview.skipped ? '인터뷰를 생략했습니다.' : '인터뷰를 마쳤습니다.'));
      if (!media || !live.result) return postHost.replaceChildren(h('p', { class: 'muted' }, '인터뷰 데이터를 불러오지 못했습니다.'));
      live.postIv ??= live.cup ? postCupInterview(media, dataset, game, fixture, live.result, live.gap ?? 0) : postInterview(media, dataset, game, fixture, live.result, live.gap ?? 0);
      const iv = live.postIv;
      postHost.replaceChildren(
        interviewView(
          iv,
          (stance) => {
            const r = answerPost(ctx.game, iv, stance);
            ctx.persist();
            const a = iv.answers.find((x) => x.stance === stance);
            live.postAnswered = answeredView(iv.question, a.label, a.text, r.backfired ? `선수단 일부가 공개 비판에 반발합니다. 사기 ${signed(r.delta)}` : `선수단 사기 ${signed(r.delta)}`);
            renderPost(media);
          },
          () => {
            ctx.game.lastPostInterview = { season: game.seasonIndex, round: postKey, skipped: true };
            ctx.persist();
            renderPost(media);
          },
          '인터뷰 생략',
        ),
      );
    };
    loadMedia().then(renderPost);
    after.replaceChildren(
      panel(
        live.cup ? `${cupFixtureLabel(game, fixture)} 결과` : `라운드 ${fixture.round} 결과`,
        h(
          'div',
          {},
          h('div', { class: `result-banner ${outcome[1]}` }, h('b', {}, outcome[0]), h('span', {}, standing)),
          absenceReport(),
          fixtureList(ctx, [mineFixture, ...otherFixtures], mineFixture),
          h('div', { class: 'btn-row end' }, toTable, next),
        ),
      ),
      panel('경기 후 인터뷰', postHost, { className: 'press-panel' }),
    );
  }

  // 1분 진행
  function tick() {
    const goalsBefore = state.goals.length;
    const cardsBefore = state.cards.length;
    const injuriesBefore = state.injuries.length;
    playMinute(state);
    if (state.cards.length > cardsBefore) updateScore(false);
    for (const c of state.cards.slice(cardsBefore)) {
      if (c.type === 'red' && c.team === mySide) showToast(`퇴장! ${c.minute}' ${c.playerName}`, { tone: 'bad' });
    }
    for (const inj of state.injuries.slice(injuriesBefore)) {
      if (inj.team === mySide) showToast(`부상 ${inj.minute}' ${inj.playerName} — ${inj.type}`, { tone: 'warn' });
    }
    syncFeed(true);
    updateSubBtn();
    if (state.goals.length > goalsBefore) {
      updateScore(true);
      for (const g of state.goals.slice(goalsBefore)) {
        const team = sideTeam[g.team];
        showToast(
          h('span', { class: 'toast-goal' }, teamBadge(team, 18), h('b', {}, ' 골! '), `${g.minute}' ${g.scorerName} `, h('span', { class: 'muted' }, `${home.shortName} ${state.score.home}-${state.score.away} ${away.shortName}`)),
          { tone: 'goal' },
        );
      }
    }
    updateStats();
    if (state.finished) {
      showToast(`경기 종료 · ${home.shortName} ${state.score.home}-${state.score.away} ${away.shortName}`);
      finalize();
      return;
    }
    // 하프타임: 설정이 켜져 있으면 멈추고 교체할 기회를 준다
    if (state.minute === HALF_TIME_MINUTE && settingsOf(ctx.game).pauseAtHalfTime) {
      pause();
      openTeamTalk('half');
      return;
    }
    // 연장 직전: 같은 설정으로 멈추고 짧은 팀 토크
    if (state.extraTime && state.minute === MATCH_MINUTES && settingsOf(ctx.game).pauseAtHalfTime) {
      pause();
      showToast('합계 동점 — 연장전에 들어갑니다', { duration: 3000 });
      openTeamTalk('extraTime');
      return;
    }
    updateStatus();
    schedule();
  }

  // 타이머는 항상 하나만 (화면을 다시 그렸을 때 이전 타이머가 남아 경기가 두 배로 흐르지 않게)
  function schedule() {
    stopTimer();
    if (live?.state !== state) return;
    live.timer = setTimeout(tick, speedMs());
  }

  // 경기 결과 반영 → 결과 패널. 실패하면 다시 시도 버튼
  function finalize() {
    finishMatch(ctx)
      .then(() => {
        updateStatus();
        renderAfter();
      })
      .catch(() => {
        const retry = h('button', { class: 'btn primary', type: 'button' }, '결과 반영 다시 시도');
        retry.addEventListener('click', finalize);
        after.replaceChildren(panel('결과 반영 실패', h('div', { class: 'empty' }, h('p', {}, '라운드를 진행하는 중 오류가 났습니다.'), retry)));
      });
  }

  pauseBtn.addEventListener('click', () => {
    if (live.paused) {
      live.paused = false;
      updateStatus();
      schedule();
    } else {
      live.paused = true;
      stopTimer();
      updateStatus();
    }
  });
  skipBtn.addEventListener('click', () => {
    stopTimer();
    while (!state.finished) playMinute(state);
    syncFeed(false);
    updateScore(true);
    updateStats();
    finalize();
  });

  // 지금까지 진행된 내용 그리기 (돌아왔거나 결과만 보기)
  syncFeed(false);
  updateSubBtn();
  updateScore(false);
  updateStats();
  updateStatus();
  if (live.done) renderAfter();
  else if (state.finished) finalize(); // 결과만 보기, 또는 반영 실패 뒤 돌아온 경우
  else if (!live.paused) schedule();

  return h(
    'div',
    { class: 'match-live' },
    scoreboard,
    live.done ? null : controls,
    h(
      'div',
      { class: 'live-grid' },
      panel('중계', h('div', { class: 'feed-wrap' }, feed), { className: 'feed-panel' }),
      h('div', { class: 'live-side' }, panel('경기 기록', h('table', { class: 'data stats-table' }, statsBody)), after),
    ),
  );
}

// ── 시즌 종료 ─────────────────────────────────────────

function renderSeasonOver(ctx, show) {
  const { dataset, game } = ctx;
  const league = leagueOf(dataset, game);
  const table = computeTable(league.teamIds, fixturesOf(game), league.rules);
  const champion = teamOf(ctx, table[0].teamId);
  const mine = table.find((r) => r.teamId === game.teamId);
  const toTable = h('button', { class: 'btn ghost', type: 'button' }, '최종 순위표');
  toTable.addEventListener('click', () => ctx.navigate('table'));
  const lastSeason = game.seasonIndex >= game.years;
  const toHistory = h('button', { class: 'btn primary', type: 'button' }, lastSeason ? '커리어 엔딩 보기' : '시즌 결산 보기');
  toHistory.addEventListener('click', () => ctx.navigate(lastSeason ? 'career' : 'history'));
  // 정한 기간을 다 채웠어도 한 시즌씩 더 이어갈 수 있다
  const extend = h('button', { class: 'btn ghost', type: 'button' }, '한 시즌 더 하기');
  extend.addEventListener('click', () => {
    ctx.game.years += 1;
    ctx.persist();
    ctx.refreshTopbar?.();
    show();
  });
  const trophies = game.history?.find((r) => r.seasonIndex === game.seasonIndex)?.trophies ?? [];
  const over = panel(
    `${game.season} 시즌 종료`,
    h(
      'div',
      { class: 'season-over' },
      teamBadge(champion, 72),
      h('h2', {}, `우승 ${champion.name}`),
      h('p', {}, `${teamOf(ctx, game.teamId).name} 최종 ${mine.position}위 · 승점 ${mine.points} (${mine.won}승 ${mine.drawn}무 ${mine.lost}패)`),
      trophies.length ? h('p', { class: 'trophy-row' }, trophies.map((t) => h('span', { class: 'trophy' }, '🏆 ', t.name))) : null,
      h('p', { class: 'muted' }, game.seasonIndex < game.years ? `게임 기간 ${game.years}시즌 중 ${game.seasonIndex}시즌을 마쳤습니다.` : `${game.years}시즌 게임을 모두 마쳤습니다.`),
      h('div', { class: 'btn-row' }, toTable, toHistory, game.seasonIndex >= game.years ? extend : null),
    ),
  );
  return game.seasonIndex < game.years ? h('div', { class: 'season-over-wrap' }, over, nextSeasonPanel(ctx, show)) : over;
}

// 다음 시즌 준비: 계약 만료 선수 재계약 고르기 → 다음 시즌 시작
function nextSeasonPanel(ctx, show) {
  const { dataset, game } = ctx;
  const expiring = expiringContracts(dataset, game).sort((a, b) => overall(b) - overall(a));
  const chosen = new Set(suggestedRenewals(dataset, game));
  const rows = expiring.map((p) => {
    const box = h('input', { type: 'checkbox', checked: chosen.has(p.id) || null, 'aria-label': `${p.name} 재계약` });
    box.addEventListener('change', () => (box.checked ? chosen.add(p.id) : chosen.delete(p.id)));
    const terms = renewalTerms(dataset, game, p.id);
    return h(
      'tr',
      {},
      h('td', {}, box),
      h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
      h('td', {}, p.name),
      h('td', { class: 'num' }, p.age),
      h('td', { class: `num ${attrClass(overall(p))}` }, overall(p)),
      h('td', { class: 'num muted' }, formatWage(contractOf(dataset, game, p.id).wage)),
      h('td', { class: 'num' }, `${formatWage(terms.wage)} · ${terms.years}년`),
    );
  });
  const start = h('button', { class: 'btn primary big', type: 'button' }, `${game.seasonIndex + 1}시즌 시작`);
  start.addEventListener('click', async () => {
    const r = await ctx.runBusy('다음 시즌 준비 중 (성장·노화·이적·일정)', () => advanceSeason(ctx.baseDataset, ctx.game, { renew: [...chosen] }));
    ctx.setGame(r.game);
    show();
    showSeasonSummary(ctx, r.summary);
  });
  return panel(
    '다음 시즌 준비',
    h(
      'div',
      { class: 'next-season' },
      h('p', { class: 'muted' }, '시즌이 넘어가면 선수들이 한 살 먹고 성장·노화합니다. 은퇴, 승강, 유스 입단이 일어나고 대륙 대회 진출 팀은 이번 시즌 순위로 정해집니다.'),
      expiring.length
        ? h(
            'div',
            {},
            h('h3', {}, `계약 만료 선수 ${expiring.length}명 — 체크한 선수만 재계약합니다`),
            h('div', { class: 'table-scroll' }, h('table', { class: 'data compact' }, h('thead', {}, h('tr', {}, h('th', {}, '재계약'), h('th', {}, '포지션'), h('th', {}, '이름'), h('th', { class: 'num' }, '나이'), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, '지금 주급'), h('th', { class: 'num' }, '재계약 조건'))), h('tbody', {}, rows))),
          )
        : h('p', {}, '계약이 끝나는 선수가 없습니다.'),
      h('div', { class: 'btn-row end' }, start),
    ),
  );
}

// 새 시즌 안내 창
function showSeasonSummary(ctx, summary) {
  if (!summary) return;
  const { game } = ctx;
  const line = (label, items) => (items?.length ? h('li', {}, h('b', {}, label), ' ', items.join(', ')) : null);
  const ok = h('button', { class: 'btn primary', type: 'button' }, '확인');
  const close = openModal(
    h(
      'div',
      { class: 'confirm-modal season-summary' },
      h('h2', {}, `${game.season} 시즌 시작`),
      h(
        'ul',
        { class: 'summary-list' },
        summary.newLeague ? h('li', {}, h('b', {}, summary.promoted.length ? '승격!' : '강등'), ` 이번 시즌은 ${summary.newLeague}에서 뜁니다.`) : null,
        h('li', {}, h('b', {}, '대륙 대회'), ' ', summary.cup ? `${summary.cup} 진출` : '진출 못 함'),
        line('은퇴', summary.retired),
        line('계약 만료로 떠남', summary.left),
        line('강등으로 팔려 간 선수', summary.sold),
        summary.parachute ? h('li', {}, h('b', {}, '낙하산 지원금'), ` ${formatMoney(summary.parachute)}이 잔고에 들어왔습니다.`) : null,
        line('유스 입단', summary.youth),
        line('인원 보강(자동)', summary.signed),
      ),
      h('p', { class: 'muted small-note' }, '여름 이적시장이 열렸습니다. 선수들의 능력치 변화는 스쿼드 화면에서 확인하세요.'),
      h('div', { class: 'confirm-actions' }, ok),
    ),
  );
  ok.addEventListener('click', close);
}
