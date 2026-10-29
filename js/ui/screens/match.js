// 경기: 경기 전(선발·전력 비교) → 실시간 텍스트 중계 → 경기 후(다른 경기 결과)
import { loadTalks, pickTalk } from '../../media/talks.js';
import { loadBoardText } from '../../media/boardText.js';
import { pushNews } from '../../state/inbox.js';
import { boardLine, mustChooseClub, sackedPanel, seasonBoardPanel } from '../board.js';
import { FORMATION_CELLS, formationLabel, positionOfCell } from '../../engine/formations.js';
import { HALF_TIME_MINUTE, HOME_ADVANTAGE, INSTRUCTIONS, MATCH_MINUTES } from '../../engine/config.js';
import { aiRoleIds, fitLabel, roleOf, rolesFor, slotMods } from '../../engine/roles.js';
import { changeFormation, createMatch, getMatchResult, makeSubstitution, playMinute, playerRatings, setAutoSubs, setInstruction, setRole, setTactics, teamSnapshot } from '../../engine/match.js';
import { ratingClass } from '../../state/form.js';
import { computeTeamRatings, conditionFactor, overall, positionFit, positionRating } from '../../engine/ratings.js';
import { computeTable } from '../../league/table.js';
import { availabilityOf, benchedRegulars, conditionOf, fixLineup, fixturesOf, isSeasonOver, leagueOf, lineupProblems, matchInput, rotateTired, roundFixtures, settingsOf, tacticsOf, userFixture } from '../../state/game.js';
import { RULES } from '../../state/rules.js';
import { advanceCup, advanceRound, advanceSeason, simulateRest } from '../../state/simulation.js';
import { track } from '../analytics.js';
import { expiringContracts, suggestedRenewals } from '../../state/newSeason.js';
import { contractOf, renewalTerms } from '../../market/finance.js';
import { formatWage } from '../../market/market.js';
import { teamAccent, teamBadge } from '../badge.js';
import { conditionMeter, openConfirm, panel, segmented, statusChip } from '../components.js';
import { appendChildren, h } from '../dom.js';
import { attrClass, fmt1, shortName } from '../format.js';
import { formatMoney } from '../../market/value.js';
import { formationPicker, presetFormationOptions, tacticLabel, tacticSummary, tacticsPicker } from '../tactics.js';
import { analysisPanel } from '../analysis.js';
import { familiarityBoost, familiarityOf, familiarityWord } from '../../state/familiarity.js';
import { answerPost, answerPre, answerTalk, cupTeamTalk, loadMedia, rivalryBetween, postCupInterview, postInterview, preCupInterview, preInterview, teamTalk } from '../../media/interviews.js';
import { compOf, cupMatchInput, cupsOf, eventFixtures, firstLegOf, leaguePhaseTable, stageName, userCupFixture } from '../../competitions/cups.js';
import { STANCES } from '../../media/situations.js';
import { moraleBoost, moraleLabel, moraleOf } from '../../state/morale.js';
import { trainingMatchBoost, trainingOf } from '../../state/training.js';
import { captainBoost, captainFor } from '../../state/captain.js';
import { TRAINING as TRAINING_CONFIG } from '../../state/trainingConfig.js';
import { isRequesting, moodOf, rolesOf } from '../../state/squadMood.js';
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
// 사기 변화는 숫자 대신 말로 (정답 숫자를 보여 주면 고민이 사라진다)
const moraleShift = (d) =>
  d >= 3 ? '선수단 분위기가 크게 올랐습니다.' : d > 0 ? '선수단 분위기가 조금 올랐습니다.' : d <= -3 ? '선수단 분위기가 크게 가라앉았습니다.' : d < 0 ? '선수단 분위기가 조금 가라앉았습니다.' : '선수단은 담담합니다.';

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

// 전력 비교는 숫자 없이 막대로만. 읽어 주는 말은 홈 팀 기준 우세·비슷·열세
const edge = (a, b) => (Math.abs(a - b) < 1 ? '비슷함' : a > b ? '홈 우세' : '원정 우세');

function compareRow(label, a, b) {
  // 30~90 범위로 표시 (K리그 50대부터 유럽 상위권 80대까지 막대가 보이도록)
  const pct = (v) => `${Math.max(0, Math.min(100, ((v - 30) / 60) * 100))}%`;
  return h(
    'div',
    { class: 'cmp-row', 'aria-label': `${label}: ${edge(a, b)}` },
    h('span', { class: 'cmp-bar left' }, h('span', { style: { width: pct(a) }, class: a >= b ? 'lead' : '' })),
    h('span', { class: 'cmp-label muted' }, label),
    h('span', { class: 'cmp-bar' }, h('span', { style: { width: pct(b) }, class: b >= a ? 'lead' : '' })),
  );
}

const inputRatings = (input) => computeTeamRatings(input.slots, input.lineup, (p) => conditionFactor(input.condition[p.id]), slotMods(input.slots, input.lineup, input.roles ?? aiRoleIds(input.slots, input.lineup)));

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
  // 시즌 중 경질: 새 구단을 고를 때까지 경기 대신 통보
  if (game.board?.sacked?.midSeason) {
    return sackedPanel(ctx, () => {
      reset();
      ctx.navigate('squad');
    });
  }
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
  const analysis = analysisPanel(ctx.game, makeInput, mySide);
  const famLine = h('p', { class: 'fam-line' }, ...familiarityLine(game));

  // 선발에 없는 주전급 (부상 복귀 등): 오래 못 뛰면 불만이 쌓인다
  const benched = benchedRegulars(dataset, game, scope);
  const benchedNote = benched.length
    ? h('p', { class: 'muted small-note tired-note' }, `선발에 없는 주전급 ${benched.length}명: ${benched.map((p) => p.name).join(', ')} — 오래 못 뛰면 출전 불만이 쌓입니다`)
    : null;

  const kickoff = h('button', { class: 'btn primary big', type: 'button', disabled: blocked || null }, '킥오프');
  kickoff.addEventListener('click', () => {
    rotateNow();
    // 화면을 그린 뒤 바꾼 전술이 반영되도록 킥오프 때 입력을 다시 만든다
    const state = createMatch(makeInput(ctx.game));
    live = { fixture, state, timer: null, paused: false, done: false, others: null, gap: strengthGap(state, mySide), cup: Boolean(cupFx), formationLabel: formationLabel(ctx.game.formation.cells), prep: prepEffects(ctx, mySide, Boolean(cupFx?.neutral)) };
    show();
  });
  const instant = h('button', { class: 'btn', type: 'button', disabled: blocked || null }, '결과만 보기');
  instant.addEventListener('click', () => {
    rotateNow();
    const state = createMatch(makeInput(ctx.game));
    while (!state.finished) playMinute(state);
    live = { fixture, state, timer: null, paused: true, done: false, others: null, gap: strengthGap(state, mySide), cup: Boolean(cupFx), formationLabel: formationLabel(ctx.game.formation.cells), prep: prepEffects(ctx, mySide, Boolean(cupFx?.neutral)) };
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
          showToast(delta ? `기자회견을 마쳤습니다. ${moraleShift(delta)}` : '기자회견을 마쳤습니다');
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
  loadMedia().then((media) => {
    renderPress(media);
    // 라이벌전: 상대 감독 도발 소식 (경기마다 한 번)
    const rivalry = rivalryBetween(media, fixture.homeId, fixture.awayId);
    if (rivalry && ctx.game.derbyNews !== fixture.id) {
      ctx.game.derbyNews = fixture.id;
      pushNews(ctx.game, 'match.derby', { rival: teamOf(ctx, mySide === 'home' ? fixture.awayId : fixture.homeId).shortName, rivalry: rivalry.name });
      ctx.persist();
      ctx.refreshTopbar();
    }
  });

  const tacticsBox = h('div', { class: 'pre-tactics' });
  const pressPanel = panel('경기 전 기자회견', pressHost, { className: 'press-panel' });
  const briefing = briefingPanel(ctx, { fixture, scope, mySide, neutral: Boolean(cupFx?.neutral), problems, tired, benched, refs: { tactics: tacticsBox, press: pressPanel } });

  return h(
    'div',
    { class: 'match-pre' },
    firstDayCard(ctx),
    panel('매치데이 브리핑', briefing.el, { className: 'briefing-panel' }),
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
        boardLine(ctx),
        expiryNote,
        tiredNote,
        benchedNote,
        h(
          'div',
          { class: 'cmp' },
          compareRow('공격', rh.attack, ra.attack),
          compareRow('중원', rh.midfield, ra.midfield),
          compareRow('수비', rh.defense, ra.defense),
          compareRow('GK', rh.goalkeeping, ra.goalkeeping),
        ),
        warning,
        appendChildren(tacticsBox, [
          h('h3', {}, '전술 지시'),
          tacticsPicker(tacticsOf(game), (t) => {
            ctx.game.tactics = t;
            ctx.persist();
            famLine.replaceChildren(...familiarityLine(ctx.game));
            analysis.refresh();
            briefing.refresh();
          }),
          famLine,
        ]),
      ),
    ),
    panel('상대 분석', analysis.el, { className: 'analysis-panel' }),
    pressPanel,
    // 준비(브리핑 → 상대·전술 → 기자회견)를 다 보고 나서 킥오프. 바는 화면 아래에 붙어 있어 언제든 누를 수 있다
    h('div', { class: 'pre-options' }, h('div', { class: 'speed' }, h('span', { class: 'muted' }, '중계 속도'), speedTabs().el), settingToggle(ctx, 'autoSubs', '자동 교체'), settingToggle(ctx, 'pauseAtHalfTime', '하프타임에 멈추기'), settingToggle(ctx, 'autoRotate', '지친 선수 자동 휴식')),
    h('div', { class: 'kickoff-bar' }, h('div', { class: 'btn-row' }, rest, editLineup), h('div', { class: 'btn-row' }, instant, kickoff)),
    h(
      'details',
      { class: 'pre-lineups' },
      h('summary', {}, '양 팀 선발 · 같은 라운드 경기'),
      h('div', { class: 'pre-grid' }, panel('홈 선발', lineupTable(ctx, home, input.home)), panel('원정 선발', lineupTable(ctx, away, input.away)), panel('같은 라운드', fixtureList(ctx, others))),
    ),
  );
}

// ── 부임 첫날: 새 게임의 첫 경기 전에만. 이사회 목표와 첫 경기까지의 3단계 (닫거나 첫 경기를 치르면 사라진다) ──
function firstDayCard(ctx) {
  const { dataset, game } = ctx;
  if (game.seasonIndex !== 1 || game.round !== 1 || game.onboarding?.dismissed) return null;
  const team = dataset.teamById.get(game.teamId);
  const objective = game.board?.objective;
  const ok = h('button', { class: 'btn primary', type: 'button' }, '시작하겠습니다');
  const card = h(
    'section',
    { class: 'first-day', style: { '--team': teamAccent(team) } },
    h('div', { class: 'fd-head' }, teamBadge(team, 44), h('div', {}, h('h2', {}, `${team.name} 감독 부임 첫날`), objective ? h('p', {}, `이사회가 바라는 건 `, h('b', {}, objective.label), objective.expected ? `입니다. 시즌 전 예상은 ${objective.expected}위.` : '입니다.') : null)),
    h(
      'ol',
      { class: 'fd-steps' },
      h('li', {}, h('b', {}, '브리핑'), ' 아래 체크리스트에서 \'아직\'인 항목을 확인합니다. 누르면 바로 그 화면으로 갑니다.'),
      h('li', {}, h('b', {}, '상대와 전술'), ' 상대 분석의 코치 메모를 읽고 전술을 고릅니다. 승률 같은 정답은 없습니다. 감독의 판단입니다.'),
      h('li', {}, h('b', {}, '킥오프'), ' 경기 중에는 \'감독 지시\'로 교체·전술을 바꾸고, 하프타임에는 라커룸에서 선수들에게 말을 겁니다.'),
    ),
    h('div', { class: 'fd-foot' }, h('p', { class: 'muted small-note' }, '스쿼드에서 선수를 누르면 역할과 교체를, 편지함에서 이사회·선수 소식을 볼 수 있습니다.'), ok),
  );
  ok.addEventListener('click', () => {
    game.onboarding = { ...game.onboarding, dismissed: true };
    // 카드가 이사회 목표 편지를 대신했으니 그 편지는 읽음으로
    for (const m of game.inbox ?? []) if (m.kind === 'board.objective' && m.season === game.seasonIndex) m.read = true;
    ctx.persist();
    ctx.refreshTopbar();
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), 200);
  });
  return card;
}

// ── 매치데이 브리핑: 이번 경기 준비 상태를 한곳에 ──

// 이번 경기에 실제로 적용되는 경기력 보정 (%): 사기·전술 숙련도·경기 준비 훈련·홈
export function prepEffects(ctx, mySide, neutral = false) {
  const { dataset, game } = ctx;
  const parts = [
    { label: '사기', value: moraleBoost(moraleOf(dataset, game, game.teamId)) },
    { label: '전술 숙련도', value: familiarityBoost(familiarityOf(game)) },
    { label: '경기 준비 훈련', value: trainingMatchBoost(game) },
    { label: '주장', value: captainBoost(game.lineup.map((id) => dataset.playerById.get(id)).filter(Boolean), game.captain) },
  ];
  if (mySide === 'home' && !neutral) parts.push({ label: '홈', value: HOME_ADVANTAGE });
  return parts.map((p) => ({ ...p, value: Math.round(p.value * 1000) / 10 }));
}

// 보정 항목 → 말 (좋을 때 / 나쁠 때). 크기 숫자는 보여 주지 않는다
const EFFECT_WORDS = {
  사기: ['선수단 분위기가 좋습니다', '선수단 분위기가 가라앉아 있습니다'],
  '전술 숙련도': ['전술이 몸에 배었습니다', '전술이 아직 손에 덜 익었습니다'],
  '경기 준비 훈련': ['상대에 맞춘 준비를 마쳤습니다', ''],
  주장: ['주장이 선수단을 이끕니다', ''],
  홈: ['홈 관중이 등을 밀어 줍니다', ''],
};

function effectsLine(effects, title) {
  const shown = effects.filter((e) => Math.abs(e.value) >= 0.05 && EFFECT_WORDS[e.label]?.[e.value > 0 ? 0 : 1]);
  // 한 줄 요약은 우리가 만든 준비(사기·전술·훈련·주장)로만. 홈 이점은 늘 있어서 빼고 본다
  const total = effects.filter((e) => e.label !== '홈').reduce((s, e) => s + e.value, 0);
  const mood = total >= 1.5 ? ['좋은 흐름으로 나섭니다', 'up'] : total <= -0.5 ? ['불안 요소를 안고 나섭니다', 'down'] : ['평소 상태로 나섭니다', ''];
  return h(
    'div',
    { class: 'prep-effects' },
    h('span', { class: 'muted' }, title),
    shown.map((e) => h('span', { class: `prep-chip ${e.value > 0 ? 'up' : 'down'}` }, EFFECT_WORDS[e.label][e.value > 0 ? 0 : 1])),
    h('b', { class: mood[1] }, mood[0]),
  );
}

// 준비 체크리스트. refs: { tactics, press } — 같은 화면에서 스크롤할 곳
function briefingPanel(ctx, { fixture, scope, mySide, neutral, problems, tired, benched, refs }) {
  const box = h('div', { class: 'briefing' });
  const draw = () => {
    const { dataset, game } = ctx;
    const tr = trainingOf(game);
    const moods = rolesOf(dataset, game);
    let unhappy = 0;
    let requests = 0;
    for (const id of moods.keys()) {
      if (isRequesting(game, id)) requests++;
      else if (moodOf(game, id) < 40) unhappy++;
    }
    const important = (game.inbox ?? []).filter((m) => !m.read && m.important).length;
    const press = game.press?.round === game.round && game.press.fixtureId === fixture.id ? game.press : null;
    const fam = familiarityOf(game);
    const go = (label, fn) => {
      const b = h('button', { class: 'btn small ghost', type: 'button' }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const scrollTo = (el) => () => el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const rows = [
      {
        label: '선발',
        status: problems.length ? 'todo' : tired.length || benched.length ? 'warn' : 'ok',
        text: problems.length ? `출전할 수 없는 선수 ${problems.length}명` : [tired.length ? `지친 선발 ${tired.length}명` : null, benched.length ? `선발 밖 주전급 ${benched.length}명` : null].filter(Boolean).join(' · ') || '11명 모두 준비됨',
        action: go('선발 바꾸기', () => ctx.navigate('squad')),
      },
      {
        label: '전술',
        status: 'ok',
        text: `${tacticSummary(tacticsOf(game))} · 숙련도 ${familiarityWord(fam)}`,
        action: go('전술·상대 분석', scrollTo(refs.tactics)),
      },
      {
        label: '훈련',
        status: tr.focus === 'balanced' && !Object.keys(tr.individual ?? {}).length ? 'idle' : 'ok',
        text: `이번 주 ${TRAINING_CONFIG.focus[tr.focus]?.label ?? '균형'} · ${TRAINING_CONFIG.intensity[tr.intensity]?.label ?? '보통'} · 개인 훈련 ${Object.keys(tr.individual ?? {}).length}/${TRAINING_CONFIG.individual.max}명`,
        action: go('훈련 탭', () => ctx.navigate('training')),
      },
      {
        label: '주장·키커',
        status: game.captain && !game.lineup.includes(game.captain) ? 'warn' : game.captain || game.penaltyTaker || game.setPieceTaker ? 'ok' : 'idle',
        text: (() => {
          const lineup = game.lineup.map((id) => dataset.playerById.get(id)).filter(Boolean);
          const cap = captainFor(lineup, game.captain);
          const name = (id) => dataset.playerById.get(id)?.name;
          return `주장 ${cap.player?.name ?? '-'}${cap.vice ? ' (지정 주장 결장, 부주장)' : game.captain ? '' : ' (자동)'} · PK ${name(game.penaltyTaker) ?? '자동'} · 세트피스 ${name(game.setPieceTaker) ?? '자동'}`;
        })(),
        action: go('스쿼드', () => ctx.navigate('squad')),
      },
      {
        label: '기자회견',
        status: press ? (press.skipped ? 'idle' : 'ok') : 'todo',
        text: press ? (press.skipped ? '생략함' : `답변함 — ${STANCES.pre[press.stance] ?? ''}`) : '아직 (경기 결과에 따라 사기가 달라집니다)',
        action: go('기자회견으로', scrollTo(refs.press)),
      },
      {
        label: '선수단',
        status: requests ? 'todo' : unhappy ? 'warn' : 'ok',
        text: requests || unhappy ? [requests ? `이적 요청 ${requests}명` : null, unhappy ? `출전 불만 ${unhappy}명` : null].filter(Boolean).join(' · ') : '불만 없음',
        action: go('스쿼드', () => ctx.navigate('squad')),
      },
      {
        label: '편지함',
        status: important ? 'warn' : 'ok',
        text: important ? `읽지 않은 중요 소식 ${important}개` : '중요한 새 소식 없음',
        action: go('편지함', () => ctx.navigate('inbox')),
      },
    ];
    const STATUS = { ok: '완료', warn: '확인', todo: '아직', idle: '기본' };
    box.replaceChildren(
      h(
        'ul',
        { class: 'brief-list' },
        rows.map((r) => h('li', { class: `brief-row st-${r.status}` }, h('span', { class: `brief-status st-${r.status}` }, STATUS[r.status]), h('b', { class: 'brief-label' }, r.label), h('span', { class: 'brief-text' }, r.text), r.action)),
      ),
      effectsLine(prepEffects(ctx, mySide, neutral), '오늘 우리 팀'),
    );
  };
  draw();
  return { el: box, refresh: draw };
}

// 전술 숙련도 한 줄: 지금 포메이션·공격 방식이 얼마나 손에 익었는지 (막대 + 단계)
function familiarityLine(game) {
  const value = familiarityOf(game);
  const boost = familiarityBoost(value);
  return [
    h('span', { class: 'muted' }, `전술 숙련도 (${formationLabel(game.formation.cells)} · ${tacticLabel('style', tacticsOf(game).style)}) `),
    h('span', { class: 'fam-bar', style: { '--v': `${Math.round(value * 100)}%` } }),
    h('b', { class: boost > 0.0005 ? 'up' : boost < -0.0005 ? 'down' : '' }, ` ${familiarityWord(value)}`),
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
    h('b', {}, moraleLabel(v)),
  );
}

// 인터뷰·팀 토크 선택지. onAnswer(stance), onSkip()
// 답은 되돌릴 수 없고 사기에 영향을 주므로, 누르면 먼저 고르기만 하고 '이렇게 답하기'로 확정한다 (모바일 오터치 방지)
function interviewView(iv, onAnswer, onSkip, skipLabel) {
  let chosen = null;
  const confirm = h('button', { type: 'button', class: 'btn small primary', disabled: true }, '이렇게 답하기');
  const buttons = iv.answers.map((a) => {
    const b = h('button', { type: 'button', class: 'answer-btn', 'aria-pressed': 'false' }, h('span', { class: 'stance-chip' }, a.label), h('span', { class: 'answer-text' }, a.text));
    b.addEventListener('click', () => {
      chosen = a.stance;
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      confirm.disabled = false;
    });
    return b;
  });
  confirm.addEventListener('click', () => chosen && onAnswer(chosen));
  const skip = h('button', { type: 'button', class: 'btn small ghost' }, skipLabel);
  skip.addEventListener('click', onSkip);
  return h('div', { class: `interview ${iv.kind}` }, h('p', { class: 'iv-question' }, iv.question), h('div', { class: 'iv-answers', role: 'group' }, buttons), h('div', { class: 'btn-row end' }, skip, confirm));
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
  // 경기 직후 토스트가 줄줄이 쌓이면 결과의 여운이 끊긴다: 소식은 한 줄로 모으고 자세한 건 편지함에서
  const myLeague = new Set(dataset.leagueById.get(game.leagueId).teamIds);
  const news = [
    (r.newOffers ?? []).length ? `영입 제안 ${r.newOffers.length}` : null,
    (r.moods ?? []).length ? `선수 기분 ${r.moods.length}` : null,
    (r.training?.injuries ?? []).length ? `훈련 중 부상 ${r.training.injuries.length}` : null,
    r.training?.gains?.length ? '훈련 성과' : null,
    cupWeeks.length ? '주중 대륙 대회' : null,
    (r.aiTransfers ?? []).some((t) => myLeague.has(t.to) || myLeague.has(t.from)) ? '리그 이적 소식' : null,
  ].filter(Boolean);
  if (news.length) showToast(`새 소식: ${news.join(' · ')} — 편지함`, { tone: (r.newOffers ?? []).length || (r.training?.injuries ?? []).length ? 'warn' : '', duration: 4500 });
  // 이사회: 경고·최후통첩·칭찬·경질
  if (r.board?.length) {
    loadBoardText().then((t) => {
      for (const e of r.board) {
        const b = game.board ?? {};
        const line = pickTalk(t?.[e.kind] ?? t?.sacked, `${game.seed}:${game.seasonIndex}:${game.round}:${e.kind}`, { team: dataset.teamById.get(game.teamId)?.shortName ?? '', goal: b.objective?.label ?? '', target: b.objective?.target ?? '' });
        showToast(`이사회: ${line}`, { tone: e.kind === 'praise' ? '' : 'bad', duration: 6000 });
      }
    });
  }
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
    h('div', { class: 'sb-team' }, teamBadge(home, 52), h('div', { class: 'sb-name' }, h('b', {}, h('span', { class: 'sb-full' }, home.name), h('span', { class: 'sb-short' }, home.shortName)), goalLists.home)),
    h('div', { class: 'sb-center' }, h('div', { class: 'sb-score num' }, scoreDigits.home, h('span', { class: 'sb-dash' }, '-'), scoreDigits.away), h('div', { class: 'sb-meta' }, minuteEl, statusEl), aggEl),
    h('div', { class: 'sb-team right' }, h('div', { class: 'sb-name' }, h('b', {}, h('span', { class: 'sb-full' }, away.name), h('span', { class: 'sb-short' }, away.shortName)), goalLists.away), teamBadge(away, 52)),
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
        { id: 'players', label: '선수 지시' },
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
      const confirm = h('button', { class: 'btn', type: 'button', disabled: true }, '교체하기');
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
      const picked = snap.formation ?? (FORMATION_CELLS[mine] ? mine : 'mine');
      // 고르면 바로 적용 (닫고 재개를 눌러도 지시가 사라지지 않게)
      const pick = (id) => id !== picked && applied(changeFormation(state, mySide, id === 'mine' ? ctx.game.formation.cells.map(positionOfCell) : id));
      const current = h(
        'table',
        { class: 'data compact' },
        h('tbody', {}, snap.slots.map((pos, i) => h('tr', {}, h('td', {}, h('span', { class: 'slot-tag' }, pos)), h('td', {}, snap.lineup[i]?.name ?? h('span', { class: 'muted' }, '(빈 자리)'))))),
      );
      return h(
        'div',
        { class: 'cmd-formation' },
        formationPicker(options, picked, pick),
        h('p', { class: 'muted small-note' }, '고르면 바로 바뀝니다. 지금 뛰는 선수를 새 자리에 가장 잘 맞게 다시 세웁니다.'),
        h('h3', {}, '현재 배치'),
        current,
      );
    }

    // 고르면 바로 지시가 나간다 (예전에는 '지시 내리기'를 따로 눌러야 해서 닫고 재개하면 사라졌다)
    function tacticsBody() {
      const now = teamSnapshot(state, mySide).tactics;
      const give = (t) => {
        const res = setTactics(state, mySide, t);
        showToast(res.message, { tone: res.ok ? '' : 'warn' });
        if (!res.ok) return;
        syncFeed(false);
        updateStats();
      };
      return h('div', {}, tacticsPicker(now, give), h('p', { class: 'muted small-note' }, '고르면 바로 선수들에게 지시가 전달됩니다.'));
    }

    // 선수 지시: 한 줄 목록(지금 걸린 역할·지시는 칩) → 누른 선수만 펼쳐 고친다. 고르면 바로 적용
    let piOpen = null; // 펼친 선수 (지시를 바꿔 다시 그려도 그대로)
    function playersBody() {
      const snap = teamSnapshot(state, mySide);
      const opp = teamSnapshot(state, mySide === 'home' ? 'away' : 'home');
      const select = (label, options, value, onChange) => {
        const s = h('select', { class: 'select small', 'aria-label': label }, options.map((o) => h('option', { value: o.id, selected: o.id === value || null }, o.label)));
        s.addEventListener('change', () => onChange(s.value || null));
        return s;
      };
      const choices = (kind) => [{ id: '', label: '기본' }, ...Object.entries(INSTRUCTIONS[kind]).map(([id, o]) => ({ id, label: o.label }))];
      // 전담 마크 대상: 상대 경기장 선수 (역할이 있으면 함께)
      const ORDER = ['ST', 'AM', 'LW', 'RW', 'CM', 'DM', 'LB', 'RB', 'CB'];
      const targets = [
        { id: '', label: '없음' },
        ...opp.lineup
          .map((q, i) => (q && opp.slots[i] !== 'GK' ? { id: q.id, pos: opp.slots[i], label: `${opp.slots[i]} ${q.name}${roleOf(opp.slots[i], opp.roles[i])?.short ? ` (${roleOf(opp.slots[i], opp.roles[i]).label})` : ''}` } : null))
          .filter(Boolean)
          .sort((a, b) => ORDER.indexOf(a.pos) - ORDER.indexOf(b.pos)), // 공격진부터
      ];
      const rows = snap.lineup.map((p, i) => {
        if (!p) return null;
        const pos = snap.slots[i];
        const ins = snap.instructions[p.id] ?? {};
        const roles = rolesFor(pos).map((r) => {
          const fl = fitLabel(p, pos, r);
          return { id: r.id, label: fl ? `${r.label} · ${fl.label}` : r.label };
        });
        // 지금 걸린 것: 기본이 아닌 역할, 개별 지시, 전담 마크 대상
        const role = roleOf(pos, snap.roles[i]);
        const markName = ins.mark ? opp.lineup.find((q) => q?.id === ins.mark)?.name : null;
        const chips = [
          role?.skill ? h('span', { class: 'pi-chip role' }, role.label) : null,
          ins.shooting ? h('span', { class: 'pi-chip' }, INSTRUCTIONS.shooting[ins.shooting].label) : null,
          ins.runs ? h('span', { class: 'pi-chip' }, INSTRUCTIONS.runs[ins.runs].label) : null,
          markName ? h('span', { class: 'pi-chip mark' }, `마크 ${markName}`) : null,
        ].filter(Boolean);
        const row = h(
          'details',
          { class: `pi-row${ins.shooting || ins.runs || ins.mark ? ' has-orders' : ''}`, open: piOpen === p.id || null },
          h(
            'summary',
            { class: 'pi-who' },
            h('span', { class: 'slot-tag' }, pos),
            h('b', {}, p.name),
            h('span', { class: 'pi-chips' }, chips.length ? chips : h('span', { class: 'muted' }, role?.label ?? '')),
            conditionMeter(snap.condition(p.id)),
          ),
          h(
            'div',
            { class: 'pi-controls' },
            roles.length > 1 ? h('label', {}, h('span', { class: 'muted' }, '역할'), select(`${p.name} 역할`, roles, snap.roles[i], (v) => applied(setRole(state, mySide, i, v)))) : null,
            pos === 'GK' ? null : h('label', {}, h('span', { class: 'muted' }, '슈팅'), select(`${p.name} 슈팅`, choices('shooting'), ins.shooting ?? '', (v) => applied(setInstruction(state, mySide, p.id, 'shooting', v)))),
            pos === 'GK' ? null : h('label', {}, h('span', { class: 'muted' }, '움직임'), select(`${p.name} 움직임`, choices('runs'), ins.runs ?? '', (v) => applied(setInstruction(state, mySide, p.id, 'runs', v)))),
            pos === 'GK' ? null : h('label', {}, h('span', { class: 'muted' }, '전담 마크'), select(`${p.name} 전담 마크`, targets, ins.mark ?? '', (v) => applied(setInstruction(state, mySide, p.id, 'mark', v)))),
          ),
        );
        // 한 번에 한 선수만 펼친다
        row.addEventListener('toggle', () => {
          if (!row.open) return piOpen === p.id && (piOpen = null);
          piOpen = p.id;
          row.parentElement?.querySelectorAll('details.pi-row[open]').forEach((d) => d !== row && (d.open = false));
        });
        return row;
      });
      return h(
        'div',
        { class: 'cmd-players' },
        h('p', { class: 'muted small-note' }, '선수를 누르면 역할과 지시를 고칠 수 있고, 고르면 바로 적용됩니다. 역할은 자리에 남고(교체로 들어온 선수가 이어 받음), 개별 지시는 이번 경기 동안 그 선수에게만. 전담 마크는 상대 핵심 선수를 묶는 대신 카드와 체력 부담이 늘어납니다.'),
        rows.filter(Boolean),
      );
    }

    function renderBody() {
      const snap = teamSnapshot(state, mySide);
      title.textContent = `감독 지시 · ${state.minute}분 · ${home.shortName} ${state.score.home}-${state.score.away} ${away.shortName}`;
      tabs.el.querySelector('[data-id="subs"]').textContent = `교체 (${snap.subsLeft}장)`;
      body.replaceChildren(tab === 'subs' ? subsBody() : tab === 'formation' ? formationBody() : tab === 'players' ? playersBody() : tacticsBody());
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

  // ── 하프타임 라커룸 ──
  // 화면 전체를 쓰는 장면: 스코어와 분위기 → 수석코치 한마디 → 전반 기록 → 눈에 띄는 선수 → 팀 토크.
  // 숫자로 '정답'을 주지 않고 상황을 말로 읽어 준다. talkHost: 팀 토크(질문·답·반응)가 들어갈 자리
  function lockerScene(moment, talkHost) {
    const opp = mySide === 'home' ? 'away' : 'home';
    const us = sideTeam[mySide];
    const them = sideTeam[opp];
    const my = state.score[mySide];
    const their = state.score[opp];
    const extra = moment === 'extraTime';
    const s = state.stats;
    const possTotal = s.home.possessionMinutes + s.away.possessionMinutes || 1;
    const poss = Math.round((100 * s[mySide].possessionMinutes) / possTotal);
    const xgGap = s[mySide].xg - s[opp].xg;
    const mood = extra ? 'level' : my > their ? 'lead' : my < their ? 'trail' : 'level';
    const moodLine = extra ? '합계 동점. 30분이 더 남았습니다.' : { lead: '앞선 채 라커룸에 들어왔습니다.', trail: '뒤진 채 라커룸에 들어왔습니다.', level: '동점으로 라커룸에 들어왔습니다.' }[mood];
    // 수석코치: 기록에서 가장 눈에 띄는 한 가지
    const coach =
      my < their && xgGap > 0.3 ? '찬스는 우리가 더 만들었습니다. 결정력만 돌아오면 됩니다.'
      : my > their && xgGap < -0.3 ? '스코어보다 경기 내용은 밀렸습니다. 운이 따랐다고 봐야 합니다.'
      : poss <= 40 ? '중원 싸움에서 밀려 공을 거의 못 만졌습니다.'
      : poss >= 60 && s[mySide].shotsOnTarget <= s[opp].shotsOnTarget ? '공은 오래 가졌는데 위협적인 장면이 부족합니다.'
      : s[mySide].shotsOnTarget === 0 ? '골문으로 향한 슈팅이 아직 하나도 없습니다.'
      : my > their ? '계획대로 가고 있습니다. 집중력만 유지하면 됩니다.'
      : my < their ? `${extra ? '30분' : '아직 45분'}이 남았습니다. 무엇을 바꿀지가 중요합니다.`
      : '팽팽합니다. 작은 차이가 승부를 가를 겁니다.';
    // 눈에 띄는 선수 (최대 4명, 한 선수는 한 번만): 이끄는 선수, 고전하는 선수, 지친 선수, 경고를 안은 선수
    const snap = teamSnapshot(state, mySide);
    const ratings = playerRatings(state);
    const onPitch = snap.lineup.map((p, i) => (p ? { p, pos: snap.slots[i], r: ratings[p.id] ?? 6, c: snap.condition(p.id) } : null)).filter(Boolean);
    const booked = new Set(state.cards.filter((c) => c.team === mySide && c.type === 'yellow').map((c) => c.playerId));
    const picked = new Set();
    const notes = [];
    const note = (x, text, tone) => {
      if (!x || picked.has(x.p.id) || notes.length >= 4) return;
      picked.add(x.p.id);
      notes.push({ ...x, text, tone });
    };
    // 전반에는 평점 차가 작으므로 기준을 낮게 잡는다
    const scored = new Map();
    for (const g of state.goals) if (g.team === mySide) scored.set(g.scorerId, (scored.get(g.scorerId) ?? 0) + 1);
    const byRating = [...onPitch].sort((a, b) => b.r - a.r);
    for (const [id, n] of scored) note(onPitch.find((x) => x.p.id === id), n >= 2 ? `${n}골, 오늘 감이 좋습니다` : '골을 넣고 기세가 올랐습니다', 'good');
    if (byRating[0]?.r >= 6.7) note(byRating[0], '경기를 이끌고 있습니다', 'good');
    if (byRating.at(-1)?.r <= 6.0) note(byRating.at(-1), '고전하고 있습니다', 'bad');
    const tired = onPitch.filter((x) => x.pos !== 'GK' && x.c < 76).sort((a, b) => a.c - b.c)[0];
    note(tired, '지쳐 보입니다', 'warn');
    note(onPitch.find((x) => booked.has(x.p.id)), '경고를 안고 있습니다 — 거친 태클은 위험합니다', 'warn');
    const goals = state.goals.map((g) => `${g.minute}' ${g.scorerName}${g.team === mySide ? '' : ` (${sideTeam[g.team].shortName})`}`);
    const stat = (label, a, b) => h('div', { class: 'lk-stat' }, h('b', { class: 'num' }, a), h('span', { class: 'muted' }, label), h('b', { class: 'num' }, b));
    const line = (n, ...children) => h('div', { class: `t-stagger-line t-stagger-line--${n}` }, ...children);
    const el = h(
      'div',
      { class: `locker t-stagger is-${mood}`, style: { '--us': teamAccent(us), '--them': teamAccent(them) } },
      line(
        1,
        h(
          'header',
          { class: 'lk-head' },
          h('div', { class: 'lk-score' }, teamBadge(us, 56), h('h2', { class: 'num' }, h('span', { class: 'sr-only' }, `${extra ? '연장 직전' : '하프타임'} 라커룸, ${us.shortName} `), `${my} – ${their}`, h('span', { class: 'sr-only' }, ` ${them.shortName}`)), teamBadge(them, 56)),
          h('p', { class: 'lk-mood' }, `${extra ? '연장 직전' : '하프타임'} · ${us.shortName} 대 ${them.shortName}. ${moodLine}`),
          goals.length ? h('p', { class: 'lk-goals muted' }, goals.join(' · ')) : null,
        ),
      ),
      line(2, h('blockquote', { class: 'lk-coach' }, h('span', { class: 'muted' }, '수석코치'), h('p', {}, coach))),
      line(3, h('div', { class: 'lk-stats' }, stat('점유', `${poss}%`, `${100 - poss}%`), stat('슈팅', s[mySide].shots, s[opp].shots), stat('유효 슈팅', s[mySide].shotsOnTarget, s[opp].shotsOnTarget))),
      notes.length ? line(4, h('ul', { class: 'lk-players' }, notes.map((x) => h('li', { class: `tone-${x.tone}` }, h('span', { class: 'slot-tag' }, x.pos), h('b', {}, x.p.name), h('span', {}, x.text), conditionMeter(Math.round(x.c)))))) : null,
      line(5, talkHost),
    );
    const reveal = () => {
      el.classList.remove('is-shown');
      void el.offsetHeight;
      requestAnimationFrame(() => el.classList.add('is-shown'));
    };
    return { el, reveal };
  }

  // 하프타임 팀 토크: 고른 말에 따라 후반 레이팅·사기가 바뀐다 (라커룸 장면 안에서)
  async function openTeamTalk(moment = 'half') {
    const media = await loadMedia();
    if (live?.state !== state) return;
    if (!media) return showToast('교체하거나 재개를 누르세요', { duration: 3500 });
    const talk = live.cup ? cupTeamTalk(media, dataset, ctx.game, state, mySide, live.gap ?? 0, fixture, moment) : teamTalk(media, dataset, ctx.game, state, mySide, live.gap ?? 0);
    const body = h('div', { class: 'locker-talk' });
    const { el: scene, reveal } = lockerScene(moment, body);
    const close = openModal(scene, { variant: 'locker' });
    reveal();
    const after = (reaction) => {
      const cmd = h('button', { class: 'btn', type: 'button' }, '감독 지시 (교체·전술)');
      const go = h('button', { class: 'btn primary big', type: 'button' }, moment === 'extraTime' ? '연장 시작' : '후반 시작');
      cmd.addEventListener('click', () => {
        close();
        openCommandModal('subs');
      });
      go.addEventListener('click', () => {
        close();
        resume();
      });
      body.append(reaction ?? '', h('div', { class: 'locker-actions' }, cmd, go));
      go.focus();
    };
    body.replaceChildren(
      interviewView(
        talk,
        (stance) => {
          const r = answerTalk(ctx.game, state, mySide, talk, stance);
          ctx.persist();
          const a = talk.answers.find((x) => x.stance === stance);
          body.replaceChildren(answeredView(talk.question, a.label, a.text));
          after(h('p', { class: `talk-reaction ${r.tone}` }, r.reaction)); // 반응 문장이 분위기 변화를 이미 말한다
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

  // 우리 선수 평점 (실시간). 경기가 끝나면 최우수 선수도
  const ratingsBody = h('tbody');
  const potmEl = h('div', { class: 'potm' });
  function updateRatings() {
    const ratings = playerRatings(state);
    const t = state.teams[mySide];
    const rows = [...t.roster.values()].filter((p) => ratings[p.id] != null).sort((a, b) => ratings[b.id] - ratings[a.id]);
    const subIn = new Set(state.subs.filter((x) => x.team === mySide).map((x) => x.inId));
    let potmId = null;
    if (state.finished) {
      const all = Object.entries(ratings).sort((a, b) => b[1] - a[1]);
      potmId = all[0]?.[0] ?? null;
      const p = potmId && (state.teams.home.roster.get(potmId) ?? state.teams.away.roster.get(potmId));
      potmEl.replaceChildren(...(p ? [h('span', {}, '경기 최우수 선수'), h('b', {}, p.name), h('span', { class: `rt ${ratingClass(ratings[potmId])}` }, ratings[potmId].toFixed(1))] : []));
    }
    ratingsBody.replaceChildren(
      ...rows.map((p) =>
        h(
          'tr',
          { class: p.id === potmId ? 'is-potm' : '' },
          h('td', {}, h('span', { class: 'pos-tag' }, t.slotOf.get(p.id) ?? p.position)),
          h('td', {}, p.name, subIn.has(p.id) ? h('span', { class: 'muted' }, ' (교체 투입)') : t.lineup.includes(p) ? '' : h('span', { class: 'muted' }, ' (교체 아웃)')),
          h('td', { class: 'num' }, h('span', { class: `rt ${ratingClass(ratings[p.id])}` }, ratings[p.id].toFixed(1))),
        ),
      ),
    );
  }

  function updateStats() {
    updateRatings();
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
            live.postAnswered = answeredView(iv.question, a.label, a.text, r.backfired ? `선수단 일부가 공개 비판에 반발합니다. ${moraleShift(r.delta)}` : moraleShift(r.delta));
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
          live.prep ? effectsLine(live.prep, '이번 경기에 적용된 준비') : null,
          absenceReport(),
          fixtureList(ctx, [mineFixture, ...otherFixtures], mineFixture),
        ),
      ),
      panel('경기 후 인터뷰', postHost, { className: 'press-panel' }),
      // 결과 → 인터뷰 → 다음 경기 순서 (다음 경기가 인터뷰보다 먼저 보이면 건너뛰게 된다)
      h('div', { class: 'btn-row end post-actions' }, toTable, next),
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
    after, // 경기가 끝나면 결과·인터뷰·다음 경기가 스코어보드 바로 아래에
    h(
      'div',
      { class: 'live-grid' },
      panel('중계', h('div', { class: 'feed-wrap' }, feed), { className: 'feed-panel' }),
      h('div', { class: 'live-side' }, panel('경기 기록', h('table', { class: 'data stats-table' }, statsBody)), panel('선수 평점', h('div', {}, potmEl, h('table', { class: 'data compact ratings-table' }, ratingsBody)))),
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
  const rec = game.history?.find((r) => r.seasonIndex === game.seasonIndex);
  const trophies = rec?.trophies ?? [];
  // 우리 팀 결과가 이 화면의 주인공: 우승 / 승격 / 강등 / 순위 (리그 우승팀은 한 줄로)
  const us = teamOf(ctx, game.teamId);
  const outcome = mine.position === 1 ? ['champion', '리그 우승'] : rec?.mine.promoted ? ['up', '승격'] : rec?.mine.relegated ? ['down', '강등'] : ['', `${mine.position}위`];
  const vsExpect = rec?.mine.expected ? rec.mine.expected - mine.position : 0;
  const expectNote = !rec?.mine.expected ? '' : vsExpect >= 3 ? `시즌 전 예상(${rec.mine.expected}위)을 크게 웃돌았습니다.` : vsExpect > 0 ? `시즌 전 예상(${rec.mine.expected}위)보다 높은 곳에서 마쳤습니다.` : vsExpect === 0 ? '시즌 전 예상만큼 해냈습니다.' : vsExpect <= -3 ? `시즌 전 예상(${rec.mine.expected}위)에 크게 못 미쳤습니다.` : `시즌 전 예상(${rec.mine.expected}위)보다 조금 아래에서 마쳤습니다.`;
  const over = panel(
    `${game.season} 시즌 종료`,
    h(
      'div',
      { class: `season-over is-${outcome[0] || 'plain'}` },
      teamBadge(us, 72),
      h('p', { class: 'so-team' }, us.name),
      h('h2', { class: 'so-outcome' }, outcome[1]),
      h('p', {}, `${league.name} ${mine.position}위 · 승점 ${mine.points} (${mine.won}승 ${mine.drawn}무 ${mine.lost}패)`),
      expectNote ? h('p', { class: 'muted' }, expectNote) : null,
      trophies.length ? h('p', { class: 'trophy-row' }, trophies.map((t) => h('span', { class: 'trophy' }, t.name))) : null,
      mine.position === 1 ? null : h('p', { class: 'so-champion muted' }, '리그 우승 ', teamBadge(champion, 18), ` ${champion.name}`),
      h('p', { class: 'muted' }, game.seasonIndex < game.years ? `게임 기간 ${game.years}시즌 중 ${game.seasonIndex}시즌을 마쳤습니다.` : `${game.years}시즌 게임을 모두 마쳤습니다.`),
      h('div', { class: 'btn-row' }, toTable, toHistory, game.seasonIndex >= game.years ? extend : null),
    ),
  );
  return game.seasonIndex < game.years ? h('div', { class: 'season-over-wrap' }, over, seasonBoardPanel(ctx, show), nextSeasonPanel(ctx, show)) : h('div', { class: 'season-over-wrap' }, over, seasonBoardPanel(ctx, show));
}

// 다음 시즌 준비: 계약 만료 선수 재계약 고르기 → 다음 시즌 시작
function nextSeasonPanel(ctx, show) {
  const { dataset, game } = ctx;
  // 다른 구단으로 옮기면 지금 구단 재계약은 다음 감독 몫
  const leaving = Boolean(game.board?.pendingMove || game.board?.sacked);
  const expiring = leaving ? [] : expiringContracts(dataset, game).sort((a, b) => overall(b) - overall(a));
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
  // 경질됐으면 새 구단을 골라야 시작할 수 있다
  if (mustChooseClub(game)) start.disabled = true;
  start.addEventListener('click', async () => {
    const r = await ctx.runBusy('다음 시즌 준비 중 (성장·노화·이적·일정)', () => advanceSeason(ctx.baseDataset, ctx.game, { renew: [...chosen] }));
    const moved = r.game.teamId !== ctx.game.teamId;
    track('season-next', { season: r.game.seasonIndex, team: r.game.teamId, moved });
    ctx.setGame(r.game);
    if (moved) ctx.rebuildTopbar?.();
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
        summary.newTeam ? h('li', {}, h('b', {}, '새 구단'), ` ${summary.newTeam} 지휘봉을 잡았습니다. 이사회 목표: ${game.board?.objective?.label ?? ''}`) : null,
        summary.newLeague ? h('li', {}, h('b', {}, summary.promoted.length ? '승격!' : '강등'), ` 이번 시즌은 ${summary.newLeague}에서 뜁니다.`) : null,
        !summary.newTeam && game.board?.objective ? h('li', {}, h('b', {}, '이사회 목표'), ` ${game.board.objective.label}`) : null,
        h('li', {}, h('b', {}, '대륙 대회'), ' ', summary.cup ? `${summary.cup} 진출` : '진출 못 함'),
        line('은퇴', summary.retired),
        line('임대 복귀', summary.loanReturned),
        line('계약 만료로 떠남', summary.left),
        line('강등으로 팔려 간 선수', summary.sold),
        summary.parachute ? h('li', {}, h('b', {}, '낙하산 지원금'), ` ${formatMoney(summary.parachute)}이 잔고에 들어왔습니다.`) : null,
        summary.relegated?.length ? h('li', {}, h('b', {}, '강등 후유증'), ' 선수단이 크게 바뀌고 분위기가 가라앉아 시즌 초반에는 제 힘을 내기 어렵습니다. 경기를 치르며 서서히 회복합니다.') : null,
        line('유스 입단', summary.youth),
        line('인원 보강(자동)', summary.signed),
      ),
      h('p', { class: 'muted small-note' }, '여름 이적시장이 열렸습니다. 선수들의 능력치 변화는 스쿼드 화면에서 확인하세요.'),
      h('div', { class: 'confirm-actions' }, ok),
    ),
  );
  ok.addEventListener('click', close);
}
