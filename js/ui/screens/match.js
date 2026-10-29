// 경기: 경기 전(선발·전력 비교) → 실시간 텍스트 중계 → 경기 후(다른 경기 결과)
import { loadTalks, pickTalk } from '../../media/talks.js';
import { loadBoardText } from '../../media/boardText.js';
import { pushNews } from '../../state/inbox.js';
import { boardLine, mustChooseClub, sackedPanel, seasonBoardPanel } from '../board.js';
import { FORMATION_CELLS, formationLabel, positionOfCell } from '../../engine/formations.js';
import { HALF_TIME_MINUTE, HOME_ADVANTAGE, INSTRUCTIONS, MATCH_MINUTES, injuryLabel as engineInjuryLabel } from '../../engine/config.js';
import { aiRoleIds, fitLabel, roleOf, rolesFor, slotMods } from '../../engine/roles.js';
import { changeFormation, createMatch, getMatchResult, makeSubstitution, playMinute, playerRatings, setAutoSubs, setInstruction, setRole, setTactics, teamSnapshot } from '../../engine/match.js';
import { ratingClass } from '../../state/form.js';
import { computeTeamRatings, conditionFactor, overall, positionFit, positionRating } from '../../engine/ratings.js';
import { computeTable } from '../../league/table.js';
import { availabilityOf, benchedRegulars, conditionOf, fixLineup, fixturesOf, isSeasonOver, leagueOf, lineupProblems, matchInput, rotateTired, roundFixtures, settingsOf, tacticsOf, userFixture } from '../../state/game.js';
import { RULES } from '../../state/rules.js';
import { advanceCup, advanceRound, advanceSeason, simulateRest } from '../../state/simulation.js';
import { track } from '../analytics.js';
import { objectiveLabel } from '../../state/board.js';
import { expiringContracts, suggestedRenewals } from '../../state/newSeason.js';
import { contractOf, renewalTerms } from '../../market/finance.js';
import { formatWage } from '../../market/market.js';
import { matchAccents, teamAccent, teamBadge } from '../badge.js';
import { conditionMeter, openConfirm, panel, segmented, statusChip } from '../components.js';
import { appendChildren, h } from '../dom.js';
import { attrClass, fmt1, shortName } from '../format.js';
import { formatMoney } from '../../market/value.js';
import { formationPicker, presetFormationOptions, tacticLabel, tacticSummary, tacticsPicker } from '../tactics.js';
import { analysisPanel } from '../analysis.js';
import { familiarityBoost, familiarityOf, familiarityWord } from '../../state/familiarity.js';
import { answerPost, answerPre, answerTalk, cupTeamTalk, loadMedia, rivalryBetween, postCupInterview, postInterview, preCupInterview, preInterview, teamTalk } from '../../media/interviews.js';
import { compOf, cupMatchInput, cupsOf, eventFixtures, firstLegOf, leaguePhaseTable, stageName, userCupFixture, compName } from '../../competitions/cups.js';
import { STANCES } from '../../media/situations.js';
import { moraleBoost, moraleLabel, moraleOf } from '../../state/morale.js';
import { trainingMatchBoost, trainingOf } from '../../state/training.js';
import { captainBoost, captainFor } from '../../state/captain.js';
import { TRAINING as TRAINING_CONFIG } from '../../state/trainingConfig.js';
import { isRequesting, moodOf, rolesOf } from '../../state/squadMood.js';
import { clearToasts, cssMs, openModal, setDigits, showToast, streamText } from '../motion.js';
import { getLang, t, tList } from '../../i18n.js';

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

// 순위 표기: 한국어는 숫자만 ('{pos}위'는 사전에), 영어는 1st·2nd·3rd
const ord = (n) => {
  if (getLang() !== 'en') return String(n);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};

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
  t(d >= 3 ? 'match.morale.bigUp' : d > 0 ? 'match.morale.up' : d <= -3 ? 'match.morale.bigDown' : d < 0 ? 'match.morale.down' : 'match.morale.flat');

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
let stuckObserver = null; // 스코어보드 상단 고정 감시 (다시 그릴 때 앞의 것을 끊는다)

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
// 전력 비교를 말로: 줄(공격·중원·수비·골문)마다 우리와 상대 중 어느 쪽이 앞서는지
function matchupLines(mine, theirs) {
  const units = [
    ['attack', t('match.cmp.attack')],
    ['midfield', t('match.cmp.midfield')],
    ['defense', t('match.cmp.defence')],
    ['goalkeeping', t('match.cmp.gk')],
  ];
  return h(
    'ul',
    { class: 'cmp-say' },
    units.map(([key, unit]) => {
      const d = mine[key] - theirs[key];
      const level = Math.abs(d) < 2 ? 'even' : d >= 6 ? 'bigUs' : d > 0 ? 'us' : d <= -6 ? 'bigThem' : 'them';
      return h('li', { class: d >= 2 ? 'up' : d <= -2 ? 'down' : '' }, t(`match.cmp.say.${level}`, { unit }));
    }),
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
    h('thead', {}, h('tr', {}, h('th', {}, t('match.lineup.slot')), h('th', {}, `${team.shortName} (${formationLabel(cellsOf(ctx, input))})`), h('th', {}, t('match.lineup.condition')), h('th', { class: 'num' }, 'OVR'))),
    h(
      'tbody',
      {},
      input.lineup.map((p, i) => row(p, input.slots[i])),
      h('tr', { class: 'divider' }, h('td', { colspan: 4 }, t('match.lineup.bench', { n: input.bench.length }))),
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
  const what = fixture.stage === 'league' ? t('match.cup.leagueMd', { md: fixture.md }) : fixture.stage === 'final' ? t('match.cup.final') : t('match.cup.stageLeg', { stage: stageName(fixture.stage), leg: fixture.leg });
  return `${compName(comp)} · ${what}`;
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
    const skip = h('button', { class: 'btn primary', type: 'button' }, t('match.pre.playRound'));
    skip.addEventListener('click', async () => {
      const r = await ctx.runBusy(t('match.busy.otherMatches'), () => advanceRound(dataset, ctx.game, null));
      ctx.setGame(r.game);
      show();
      notifyMarket(ctx, r);
    });
    return panel(t('match.pre.roundTitle', { round: game.round }), h('div', { class: 'empty' }, h('p', {}, t('match.pre.noFixture')), skip));
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
  const fixBtn = h('button', { class: 'btn small primary', type: 'button' }, t('match.pre.autoFix'));
  fixBtn.addEventListener('click', () => {
    fixLineup(dataset, game, scope);
    ctx.persist();
    show();
  });
  const warning = blocked
    ? h(
        'div',
        { class: 'warn-banner' },
        h('span', {}, h('b', {}, t('match.pre.unavailableCount', { n: problems.length })), ' — ', problems.map(({ id }) => `${dataset.playerById.get(id).name} (${availabilityOf(game, id, scope).label || t('match.pre.transferred')})`).join(', ')),
        fixBtn,
      )
    : null;

  // 지친 선수 자동 휴식 (설정이 켜져 있으면 킥오프 때 적용)
  const rotateNow = () => {
    if (!settingsOf(ctx.game).autoRotate) return;
    const changes = rotateTired(dataset, ctx.game, scope);
    if (changes.length) {
      ctx.persist();
      showToast(t('match.pre.restedToast', { list: changes.map((c) => `${c.slot} ${c.out} → ${c.in}`).join(', ') }), { duration: 4500 });
    }
  };
  const tired = game.lineup.filter((id) => conditionOf(game, id) < RULES.rotateBelow).map((id) => dataset.playerById.get(id)?.name).filter(Boolean);
  const tiredNote = tired.length
    ? h('p', { class: 'muted small-note tired-note' }, t(settingsOf(game).autoRotate ? 'match.pre.tiredAuto' : 'match.pre.tiredManual', { n: tired.length, names: tired.join(', ') }))
    : null;

  // 상대 분석 · 전술 숙련도
  const analysis = analysisPanel(ctx.game, makeInput, mySide);
  const famLine = h('p', { class: 'fam-line' }, ...familiarityLine(game));

  // 선발에 없는 주전급 (부상 복귀 등): 오래 못 뛰면 불만이 쌓인다
  const benched = benchedRegulars(dataset, game, scope);
  const benchedNote = benched.length
    ? h('p', { class: 'muted small-note tired-note' }, t('match.pre.benchedNote', { n: benched.length, names: benched.map((p) => p.name).join(', ') }))
    : null;

  const kickoff = h('button', { class: 'btn primary big', type: 'button', disabled: blocked || null }, t('match.pre.kickoff'));
  kickoff.addEventListener('click', () => (pressDone() ? startLive() : openPress(startLive)));
  function startLive() {
    rotateNow();
    // 화면을 그린 뒤 바꾼 전술이 반영되도록 킥오프 때 입력을 다시 만든다
    const state = createMatch(makeInput(ctx.game));
    live = { fixture, state, timer: null, paused: false, done: false, others: null, gap: strengthGap(state, mySide), cup: Boolean(cupFx), formationLabel: formationLabel(ctx.game.formation.cells), prep: prepEffects(ctx, mySide, Boolean(cupFx?.neutral)) };
    show();
  }
  const instant = h('button', { class: 'btn', type: 'button', disabled: blocked || null }, t('match.pre.instant'));
  instant.addEventListener('click', () => {
    rotateNow();
    const state = createMatch(makeInput(ctx.game));
    while (!state.finished) playMinute(state);
    live = { fixture, state, timer: null, paused: true, done: false, others: null, gap: strengthGap(state, mySide), cup: Boolean(cupFx), formationLabel: formationLabel(ctx.game.formation.cells), prep: prepEffects(ctx, mySide, Boolean(cupFx?.neutral)) };
    show(); // 경기 화면이 결과 반영(실패 시 다시 시도 포함)을 맡는다
  });
  const rest = h('button', { class: 'btn ghost', type: 'button', disabled: blocked || null }, t('match.pre.simRest'));
  rest.addEventListener('click', () =>
    openConfirm({
      title: t('match.pre.simRestTitle'),
      body: t('match.pre.simRestBody', { n: game.totalRounds - game.round + 1 }),
      confirmLabel: t('match.pre.simRestConfirm'),
      onConfirm: async () => {
        const r = await ctx.runBusy(t('match.busy.simRest'), () => simulateRest(dataset, ctx.game));
        track('season-auto', { season: ctx.game.seasonIndex });
        ctx.setGame(r.game);
        show();
      },
    }),
  );
  const editLineup = h('button', { class: 'btn ghost', type: 'button' }, t('match.pre.editLineup'));
  const settingsBtn = h('button', { class: 'btn ghost', type: 'button', 'aria-haspopup': 'dialog' }, t('match.pre.settings'));
  settingsBtn.addEventListener('click', () => {
    const done = h('button', { class: 'btn primary', type: 'button' }, t('match.pre.settingsDone'));
    const close = openModal(
      h(
        'div',
        { class: 'settings-modal' },
        h('h2', {}, t('match.pre.settings')),
        h('div', { class: 'speed' }, h('span', { class: 'muted' }, t('match.pre.speed')), speedTabs().el),
        settingToggle(ctx, 'autoSubs', t('match.setting.autoSubs')),
        settingToggle(ctx, 'pauseAtHalfTime', t('match.setting.pauseAtHalfTime')),
        settingToggle(ctx, 'autoRotate', t('match.setting.autoRotate')),
        h('div', { class: 'btn-row end' }, done),
      ),
    );
    done.addEventListener('click', close);
  });
  editLineup.addEventListener('click', () => ctx.navigate('squad'));

  // 시즌 막판: 계약 만료 예정 안내 (재계약은 시즌 결산에서 고른다)
  const expiringCount = !cupFx && game.round > game.totalRounds - 5 && game.seasonIndex < game.years ? expiringContracts(dataset, game).length : 0;
  const expiryNote = expiringCount ? h('p', { class: 'muted small-note expiry-note' }, t('match.pre.expiryNote', { n: expiringCount })) : null;

  // 같은 라운드 경기: 대륙 대회면 같은 대회의 이번 주중 경기
  const others = cupFx ? eventFixtures(game, { stage: cupFx.stage, md: cupFx.md, leg: cupFx.leg }).filter((f) => f.comp === cupFx.comp && f !== cupFx) : roundFixtures(game).filter((f) => f !== fixture);

  // 경기 전 기자회견: 킥오프를 누르면 경기장에 나가기 전에 열린다 (브리핑에서 미리 열 수도 있다). then: 끝난 뒤 할 일
  const pressDone = () => ctx.game.press?.round === ctx.game.round && ctx.game.press.fixtureId === fixture.id;
  const openPress = (then = null) => {
    loadMedia().then((media) => {
      if (!media) return then ? then() : showToast(t('match.press.loadFailed'));
      const key = `${game.seed}:${game.slot}:${game.teamId}:${game.seasonIndex}:${fixture.id}`;
      if (pendingPre?.key !== key) pendingPre = { key, interview: cupFx ? preCupInterview(media, dataset, game, fixture, input) : preInterview(media, dataset, game, fixture, input) };
      const iv = pendingPre.interview;
      let close = null;
      const finish = (msg) => {
        close();
        if (msg) showToast(msg);
        if (then) then();
        else show();
      };
      const view = interviewView(
        iv,
        (stance) => {
          const { delta } = answerPre(ctx.game, iv, stance);
          ctx.persist();
          finish(delta ? t('match.press.doneShift', { shift: moraleShift(delta) }) : t('match.press.done'));
        },
        () => {
          ctx.game.press = { round: game.round, fixtureId: fixture.id, skipped: true };
          ctx.persist();
          finish();
        },
        t('match.press.skip'),
      );
      close = openModal(h('div', { class: 'press-modal' }, h('h2', {}, t('match.press.preTitle')), h('p', { class: 'muted small-note' }, t('match.press.preLead')), view));
    });
  };
  loadMedia().then((media) => {
    // 라이벌전: 상대 감독 도발 소식 (경기마다 한 번)
    const rivalry = rivalryBetween(media, fixture.homeId, fixture.awayId);
    if (rivalry && ctx.game.derbyNews !== fixture.id) {
      ctx.game.derbyNews = fixture.id;
      pushNews(ctx.game, 'match.derby', { rival: teamOf(ctx, mySide === 'home' ? fixture.awayId : fixture.homeId).shortName, rivalry: rivalry.name, rivalryEn: rivalry.nameEn ?? rivalry.name });
      ctx.persist();
      ctx.refreshTopbar();
    }
  });

  const tacticsBox = h('div', { class: 'pre-tactics' });
  const briefing = briefingPanel(ctx, { fixture, scope, mySide, neutral: Boolean(cupFx?.neutral), problems, tired, benched, refs: { tactics: tacticsBox, press: () => openPress(), lineupNotes: [tiredNote, benchedNote].filter(Boolean).map((e) => e.textContent) } });

  return h(
    'div',
    { class: 'match-pre' },
    firstDayCard(ctx),
    panel(t('match.brief.title'), briefing.el, { className: 'briefing-panel' }),
    panel(
      cupFx ? (cupFx.neutral ? t('match.pre.cupTitleNeutral', { label: cupFixtureLabel(game, cupFx) }) : t('match.pre.cupTitle', { label: cupFixtureLabel(game, cupFx), stadium: home.stadium ?? '' })) : t('match.pre.leagueTitle', { round: game.round, stadium: home.stadium ?? '' }),
      h(
        'div',
        { class: 'pre-body' },
        h(
          'div',
          { class: 'matchup' },
          h('div', { class: 'mu-team' }, teamBadge(home, 64), h('b', {}, home.name), h('span', { class: 'muted' }, cupFx?.neutral ? '' : t('match.pre.home'))),
          h('div', { class: 'mu-vs' }, 'VS', cupFx ? cupPreNote(game, cupFx, mySide) : null),
          h('div', { class: 'mu-team' }, teamBadge(away, 64), h('b', {}, away.name), h('span', { class: 'muted' }, cupFx?.neutral ? '' : t('match.pre.away'))),
        ),
        moraleMeter(ctx),
        boardLine(ctx),
        expiryNote,
        mySide === 'home' ? matchupLines(rh, ra) : matchupLines(ra, rh),
        warning,
      ),
    ),
    // 상대를 읽고 바로 옆에서 전술을 고른다 (모바일은 분석 → 전술 순서)
    panel(
      t('match.pre.oppTactics'),
      h(
        'div',
        { class: 'opp-tactics' },
        h('div', { class: 'ot-analysis' }, analysis.el),
        appendChildren(tacticsBox, [
          h('h3', {}, t('match.pre.tactics')),
          tacticsPicker(tacticsOf(game), (tac) => {
            ctx.game.tactics = tac;
            ctx.persist();
            famLine.replaceChildren(...familiarityLine(ctx.game));
            analysis.refresh();
            briefing.refresh();
          }),
          famLine,
        ]),
      ),
      { className: 'opp-tactics-panel' },
    ),
    // 준비(브리핑 → 상대·전술)를 보고 킥오프 → 기자회견 → 경기장. 바는 화면 아래에 붙어 있어 언제든 누를 수 있다
    h('div', { class: 'kickoff-bar' }, h('div', { class: 'btn-row' }, rest, editLineup, settingsBtn), h('div', { class: 'btn-row' }, instant, kickoff)),
    h(
      'details',
      { class: 'pre-lineups' },
      h('summary', {}, t('match.pre.lineupsSummary')),
      h('div', { class: 'pre-grid' }, panel(t('match.pre.homeLineup'), lineupTable(ctx, home, input.home)), panel(t('match.pre.awayLineup'), lineupTable(ctx, away, input.away)), panel(t('match.pre.sameRound'), fixtureList(ctx, others))),
    ),
  );
}

// ── 부임 첫날: 새 게임의 첫 경기 전에만. 이사회 목표와 첫 경기까지의 3단계 (닫거나 첫 경기를 치르면 사라진다) ──
function firstDayCard(ctx) {
  const { dataset, game } = ctx;
  if (game.seasonIndex !== 1 || game.round !== 1 || game.onboarding?.dismissed) return null;
  const team = dataset.teamById.get(game.teamId);
  const objective = game.board?.objective;
  const ok = h('button', { class: 'btn primary', type: 'button' }, t('match.firstDay.ok'));
  const card = h(
    'section',
    { class: 'first-day', style: { '--team': teamAccent(team) } },
    h('div', { class: 'fd-head' }, teamBadge(team, 44), h('div', {}, h('h2', {}, t('match.firstDay.title', { team: team.name })), objective ? h('p', {}, t('match.firstDay.boardWants'), h('b', {}, objectiveLabel(objective)), objective.expected ? t('match.firstDay.expected', { pos: ord(objective.expected) }) : t('match.firstDay.end')) : null)),
    h(
      'ol',
      { class: 'fd-steps' },
      h('li', {}, h('b', {}, t('match.firstDay.step1')), t('match.firstDay.step1Text')),
      h('li', {}, h('b', {}, t('match.firstDay.step2')), t('match.firstDay.step2Text')),
      h('li', {}, h('b', {}, t('match.firstDay.step3')), t('match.firstDay.step3Text')),
    ),
    h('div', { class: 'fd-foot' }, h('p', { class: 'muted small-note' }, t('match.firstDay.foot')), ok),
  );
  ok.addEventListener('click', () => {
    game.onboarding = { ...game.onboarding, dismissed: true };
    // 카드가 이사회 목표 편지를 대신했으니 그 편지는 읽음으로
    for (const m of game.inbox ?? []) if (m.kind === 'board.objective' && m.season === game.seasonIndex) m.read = true;
    ctx.persist();
    ctx.refreshTopbar();
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), cssMs('--duration-medium', 350)); // .first-day 페이드와 같은 시간
  });
  return card;
}

// ── 매치데이 브리핑: 이번 경기 준비 상태를 한곳에 ──

// 이번 경기에 실제로 적용되는 경기력 보정 (%): 사기·전술 숙련도·경기 준비 훈련·홈
export function prepEffects(ctx, mySide, neutral = false) {
  const { dataset, game } = ctx;
  const parts = [
    { id: 'morale', label: t('match.effect.morale'), value: moraleBoost(moraleOf(dataset, game, game.teamId)) },
    { id: 'familiarity', label: t('match.effect.familiarity'), value: familiarityBoost(familiarityOf(game)) },
    { id: 'training', label: t('match.effect.training'), value: trainingMatchBoost(game) },
    { id: 'captain', label: t('match.effect.captain'), value: captainBoost(game.lineup.map((id) => dataset.playerById.get(id)).filter(Boolean), game.captain) },
  ];
  if (mySide === 'home' && !neutral) parts.push({ id: 'home', label: t('match.effect.home'), value: HOME_ADVANTAGE });
  return parts.map((p) => ({ ...p, value: Math.round(p.value * 1000) / 10 }));
}

// 보정 항목(id) → 말 (좋을 때 up / 나쁠 때 down). 크기 숫자는 보여 주지 않는다. 빈 문장이면 칩을 안 그린다
const effectWord = (id, up) => t(`match.effect.${id}.${up ? 'up' : 'down'}`);

function effectsLine(effects, title) {
  const shown = effects.filter((e) => Math.abs(e.value) >= 0.05 && effectWord(e.id, e.value > 0));
  // 한 줄 요약은 우리가 만든 준비(사기·전술·훈련·주장)로만. 홈 이점은 늘 있어서 빼고 본다
  const total = effects.filter((e) => e.id !== 'home').reduce((s, e) => s + e.value, 0);
  const mood = total >= 1.5 ? [t('match.effect.moodGood'), 'up'] : total <= -0.5 ? [t('match.effect.moodBad'), 'down'] : [t('match.effect.moodNormal'), ''];
  return h(
    'div',
    { class: 'prep-effects' },
    h('span', { class: 'muted' }, title),
    shown.map((e) => h('span', { class: `prep-chip ${e.value > 0 ? 'up' : 'down'}` }, effectWord(e.id, e.value > 0))),
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
        label: t('match.brief.lineup'),
        status: problems.length ? 'todo' : tired.length || benched.length ? 'warn' : 'ok',
        text: problems.length ? t('match.brief.lineupBlocked', { n: problems.length }) : [tired.length ? t('match.brief.lineupTired', { n: tired.length }) : null, benched.length ? t('match.brief.lineupBenched', { n: benched.length }) : null].filter(Boolean).join(' · ') || t('match.brief.lineupReady'),
        action: go(t('match.pre.editLineup'), () => ctx.navigate('squad')),
        sub: refs.lineupNotes, // 지친 선수·선발 밖 주전급 이름
      },
      {
        label: t('match.brief.tactics'),
        status: 'ok',
        text: t('match.brief.tacticsText', { summary: tacticSummary(tacticsOf(game)), fam: familiarityWord(fam) }),
        action: go(t('match.brief.toTactics'), scrollTo(refs.tactics)),
      },
      {
        label: t('match.brief.training'),
        status: tr.focus === 'balanced' && !Object.keys(tr.individual ?? {}).length ? 'idle' : 'ok',
        text: t('match.brief.trainingText', { focus: TRAINING_CONFIG.focus[tr.focus]?.label ?? t('match.brief.focusDefault'), intensity: TRAINING_CONFIG.intensity[tr.intensity]?.label ?? t('match.brief.intensityDefault'), n: Object.keys(tr.individual ?? {}).length, max: TRAINING_CONFIG.individual.max }),
        action: go(t('match.brief.toTraining'), () => ctx.navigate('training')),
      },
      {
        label: t('match.brief.captaincy'),
        status: game.captain && !game.lineup.includes(game.captain) ? 'warn' : game.captain || game.penaltyTaker || game.setPieceTaker ? 'ok' : 'idle',
        text: (() => {
          const lineup = game.lineup.map((id) => dataset.playerById.get(id)).filter(Boolean);
          const cap = captainFor(lineup, game.captain);
          const name = (id) => dataset.playerById.get(id)?.name;
          return t('match.brief.captaincyText', { captain: cap.player?.name ?? '-', note: cap.vice ? t('match.brief.captainVice') : game.captain ? '' : t('match.brief.captainAuto'), pk: name(game.penaltyTaker) ?? t('match.brief.auto'), sp: name(game.setPieceTaker) ?? t('match.brief.auto') });
        })(),
        action: go(t('match.brief.toSquad'), () => ctx.navigate('squad')),
      },
      {
        label: t('match.brief.press'),
        status: press ? (press.skipped ? 'idle' : 'ok') : 'todo',
        text: press ? (press.skipped ? t('match.brief.pressSkipped') : t('match.brief.pressAnswered', { stance: STANCES.pre[press.stance] ?? '' })) : t('match.brief.pressTodo'),
        action: press ? null : go(t('match.brief.toPress'), refs.press),
      },
      {
        label: t('match.brief.squad'),
        status: requests ? 'todo' : unhappy ? 'warn' : 'ok',
        text: requests || unhappy ? [requests ? t('match.brief.requests', { n: requests }) : null, unhappy ? t('match.brief.unhappy', { n: unhappy }) : null].filter(Boolean).join(' · ') : t('match.brief.noComplaints'),
        action: go(t('match.brief.toSquad'), () => ctx.navigate('squad')),
      },
      {
        label: t('match.brief.inbox'),
        status: important ? 'warn' : 'ok',
        text: important ? t('match.brief.importantUnread', { n: important }) : t('match.brief.noImportant'),
        action: go(t('match.brief.inbox'), () => ctx.navigate('inbox')),
      },
    ];
    const STATUS = { ok: t('match.brief.st.ok'), warn: t('match.brief.st.warn'), todo: t('match.brief.st.todo'), idle: t('match.brief.st.idle') };
    const row = (r) => h('li', { class: `brief-row st-${r.status}` }, h('span', { class: `brief-status st-${r.status}` }, STATUS[r.status]), h('b', { class: 'brief-label' }, r.label), h('span', { class: 'brief-text' }, r.text, r.sub?.length ? r.sub.map((n) => h('span', { class: 'brief-sub' }, n)) : null), r.action);
    // 손볼 것(아직·확인)만 펼치고, 끝났거나 기본값인 항목은 한 줄로 접는다
    const open = rows.filter((r) => r.status === 'todo' || r.status === 'warn');
    const settled = rows.filter((r) => !open.includes(r));
    const wasOpen = box.querySelector('.brief-settled')?.open ?? false;
    box.replaceChildren(
      open.length ? h('ul', { class: 'brief-list' }, open.map(row)) : h('p', { class: 'brief-allset' }, t('match.brief.allSet')),
      settled.length ? h('details', { class: 'brief-settled', open: wasOpen || null }, h('summary', {}, t('match.brief.settled', { n: settled.length })), h('ul', { class: 'brief-list' }, settled.map(row))) : null,
      effectsLine(prepEffects(ctx, mySide, neutral), t('match.brief.today')),
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
    h('span', { class: 'muted' }, t('match.fam.line', { formation: formationLabel(game.formation.cells), style: tacticLabel('style', tacticsOf(game).style) })),
    h('span', { class: 'fam-bar', style: { '--v': `${Math.round(value * 100)}%` } }),
    h('b', { class: boost > 0.0005 ? 'up' : boost < -0.0005 ? 'down' : '' }, ` ${familiarityWord(value)}`),
  ];
}

// 대륙 대회 경기 전 메모: 2차전이면 1차전 스코어, 리그 페이즈면 현재 순위
function cupPreNote(game, fixture, mySide) {
  const first = firstLegOf(game, fixture);
  if (first?.result) {
    const oppSide = mySide === 'home' ? 'away' : 'home';
    return h('small', { class: 'cup-note' }, t('match.cup.firstLeg', { a: first.result.score[oppSide], b: first.result.score[mySide] }));
  }
  if (fixture.stage === 'league' && fixture.md > 1) {
    const row = leaguePhaseTable(compOf(game, fixture)).find((r) => r.teamId === game.teamId);
    return h('small', { class: 'cup-note' }, t('match.cup.leaguePhasePos', { pos: ord(row.position) }));
  }
  return null;
}

// 팀 사기 막대
function moraleMeter(ctx) {
  const v = moraleOf(ctx.dataset, ctx.game, ctx.game.teamId);
  const tone = v >= 62 ? 'good' : v < 40 ? 'bad' : 'mid';
  return h(
    'div',
    { class: 'morale-meter', title: t('match.morale.meterTitle') },
    h('span', { class: 'muted' }, t('match.morale.meterLabel')),
    h('span', { class: 'morale-bar' }, h('span', { class: tone, style: { width: `${v}%` } })),
    h('b', {}, moraleLabel(v)),
  );
}

// 인터뷰·팀 토크 선택지. onAnswer(stance), onSkip()
// 답은 되돌릴 수 없고 사기에 영향을 주므로, 누르면 먼저 고르기만 하고 '이렇게 답하기'로 확정한다 (모바일 오터치 방지)
function interviewView(iv, onAnswer, onSkip, skipLabel) {
  const touch = matchMedia('(pointer: coarse)').matches;
  let chosen = null;
  const confirm = h('button', { type: 'button', class: 'btn small primary', disabled: true }, t('match.press.confirm'));
  const buttons = iv.answers.map((a) => {
    const b = h('button', { type: 'button', class: 'answer-btn', 'aria-pressed': 'false' }, h('span', { class: 'stance-chip' }, a.label), h('span', { class: 'answer-text' }, a.text));
    b.addEventListener('click', () => {
      if (!touch) return onAnswer(a.stance);
      chosen = a.stance;
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      confirm.disabled = false;
      confirm.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // 모바일에서 확정 버튼이 화면 밖에 있지 않게
    });
    return b;
  });
  confirm.addEventListener('click', () => chosen && onAnswer(chosen));
  const skip = h('button', { type: 'button', class: 'btn small ghost' }, skipLabel);
  skip.addEventListener('click', onSkip);
  return h('div', { class: `interview ${iv.kind}` }, h('p', { class: 'iv-question' }, iv.question), h('div', { class: 'iv-answers', role: 'group' }, buttons), h('div', { class: 'btn-row end' }, skip, touch ? confirm : null));
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
        const pens = f.result?.penalties ? ` (PK ${f.result.penalties.home}-${f.result.penalties.away})` : f.result?.extraTime ? t('match.fx.aet') : '';
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
    const r = await ctx.runBusy(t('match.busy.otherMatches'), () => (m.cup ? advanceCup : advanceRound)(ctx.dataset, ctx.game, m.result));
    ctx.setGame(r.game);
    m.otherIds = r.otherFixtureIds ?? [];
    m.done = true;
    track('match-played', { cup: Boolean(m.cup), season: r.game.seasonIndex }); // 직접 치른 경기 (자동 진행 제외)
    m.notes = notifyMarket(ctx, r, { quiet: true }); // 결과 장면 안에 보여 준다
  })().catch((err) => {
    m.finishing = null; // 실패하면 다시 시도할 수 있게
    throw err;
  });
  return m.finishing;
}

// 진행 중 생긴 이적 소식: 우리 선수에게 온 제안, 우리 리그 AI 이적
// quiet: 토스트 대신 { news, board }를 돌려준다 (경기 직후에는 결과 장면 안에 보여 준다)
function notifyMarket(ctx, r, { quiet = false } = {}) {
  const { dataset, game } = ctx;
  // 우리 팀이 안 나간 주중 대륙 대회 경기가 함께 진행됐으면 알린다
  const cupWeeks = (r.cups ?? []).filter((c) => c && !c.fixtureIds.some((id) => cupFixtureById(game, id) && [cupFixtureById(game, id).homeId, cupFixtureById(game, id).awayId].includes(game.teamId)));
  // 경기 직후 토스트가 줄줄이 쌓이면 결과의 여운이 끊긴다: 소식은 한 줄로 모으고 자세한 건 편지함에서
  const myLeague = new Set(dataset.leagueById.get(game.leagueId).teamIds);
  const news = [
    (r.newOffers ?? []).length ? t('match.news.offers', { n: r.newOffers.length }) : null,
    (r.moods ?? []).length ? t('match.news.moods', { n: r.moods.length }) : null,
    (r.training?.injuries ?? []).length ? t('match.news.trainingInjuries', { n: r.training.injuries.length }) : null,
    r.training?.gains?.length ? t('match.news.trainingGains') : null,
    cupWeeks.length ? t('match.news.cupWeek') : null,
    (r.aiTransfers ?? []).some((x) => myLeague.has(x.to) || myLeague.has(x.from)) ? t('match.news.leagueTransfers') : null,
  ].filter(Boolean);
  if (quiet) return { news, board: r.board ?? [] };
  if (news.length) showToast(t('match.news.toast', { list: news.join(' · ') }), { tone: (r.newOffers ?? []).length || (r.training?.injuries ?? []).length ? 'warn' : '', duration: 4500 });
  // 이사회: 경고·최후통첩·칭찬·경질
  if (r.board?.length) {
    loadBoardText().then((txt) => {
      for (const e of r.board) {
        const b = game.board ?? {};
        const line = pickTalk(txt?.[e.kind] ?? txt?.sacked, `${game.seed}:${game.seasonIndex}:${game.round}:${e.kind}`, { team: dataset.teamById.get(game.teamId)?.shortName ?? '', goal: b.objective ? objectiveLabel(b.objective) : '', target: b.objective?.target ?? '' });
        showToast(t('match.board.toast', { line }), { tone: e.kind === 'praise' ? '' : 'bad', duration: 6000 });
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
      ...r.injuries.filter((i) => i.team === mySide).map((i) => h('li', {}, h('span', { class: 'status-chip injury' }, t('match.after.injuryChip', { n: i.matchesOut })), ` ${i.playerName} · ${engineInjuryLabel(i.type)}`)),
      ...[...new Set(r.cards.filter((c) => c.team === mySide).map((c) => c.playerId))]
        .map((id) => ({ id, a: availabilityOf(ctx.game, id) }))
        .filter(({ a }) => a.reason === 'suspension')
        .map(({ id, a }) => h('li', {}, h('span', { class: 'status-chip suspension' }, t('match.after.banChip', { n: a.rounds })), ` ${dataset.playerById.get(id).name}`)),
    ];
    return lines.length ? h('ul', { class: 'absences' }, lines) : null;
  }

  // 스코어보드
  const scoreDigits = { home: h('span', { class: 't-digit-group' }), away: h('span', { class: 't-digit-group' }) };
  const goalLists = { home: h('ul', { class: 'goal-list' }), away: h('ul', { class: 'goal-list right' }) };
  const minuteEl = h('span', { class: 'sb-minute num' });
  const statusEl = h('span', { class: 'sb-status' });
  const aggEl = h('div', { class: 'sb-agg muted' }); // 2차전 합계 · 승부차기
  const accents = matchAccents(home, away); // 비슷한 색끼리 붙으면 원정 팀 색을 바꾼다
  const scoreboard = h(
    'section',
    { class: 'scoreboard panel', style: { '--home': accents[0], '--away': accents[1] } },
    h('div', { class: 'sb-team' }, teamBadge(home, 52), h('div', { class: 'sb-name' }, h('b', {}, h('span', { class: 'sb-full' }, home.name), h('span', { class: 'sb-short' }, home.shortName)), goalLists.home)),
    h('div', { class: 'sb-center' }, h('div', { class: 'sb-score num' }, scoreDigits.home, h('span', { class: 'sb-dash' }, '-'), scoreDigits.away), h('div', { class: 'sb-meta' }, minuteEl, statusEl), aggEl),
    h('div', { class: 'sb-team right' }, h('div', { class: 'sb-name' }, h('b', {}, h('span', { class: 'sb-full' }, away.name), h('span', { class: 'sb-short' }, away.shortName)), goalLists.away), teamBadge(away, 52)),
  );

  // 컨트롤
  const pauseBtn = h('button', { class: 'btn small', type: 'button' });
  const skipBtn = h('button', { class: 'btn small ghost', type: 'button' }, t('match.live.skip'));
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
    subBtn.textContent = t('match.live.commandBtn', { n: snap.subsLeft });
    tacticLine.textContent = `${snap.formation ?? live.formationLabel ?? formationLabel(ctx.game.formation.cells)} · ${tacticSummary(snap.tactics)}`;
  };
  subBtn.addEventListener('click', () => openCommandModal());
  const autoToggle = settingToggle(ctx, 'autoSubs', t('match.setting.autoSubs'), (on) => setAutoSubs(state, mySide, on));
  const controls = h('div', { class: 'live-controls' }, pauseBtn, subBtn, tacticLine, h('div', { class: 'speed' }, h('span', { class: 'muted' }, t('match.live.speed')), speed.el), autoToggle, skipBtn);

  // 중계 · 기록
  const feed = h('ol', { class: 'feed', role: 'log', 'aria-label': t('match.live.feed') }); // 새 중계 줄을 화면 낭독기가 읽는다
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
        { id: 'subs', label: t('match.cmd.tabSubs') },
        { id: 'formation', label: t('match.cmd.tabFormation') },
        { id: 'tactics', label: t('match.cmd.tabTactics') },
        { id: 'players', label: t('match.cmd.tabPlayers') },
      ],
      tab,
      (id) => {
        tab = id;
        renderBody();
      },
      { size: 'small' },
    );
    const closeBtn = h('button', { class: 'btn ghost', type: 'button' }, t('match.cmd.close'));
    const resumeBtn = h('button', { class: 'btn primary', type: 'button' }, t('match.cmd.resume'));

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
      if (snap.subsLeft <= 0) return h('p', { class: 'empty' }, t('match.cmd.noSubs'));
      let outSlot = null;
      let inId = null;
      const confirm = h('button', { class: 'btn', type: 'button', disabled: true }, t('match.cmd.makeSub'));
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
        h('div', { class: 'sub-grid' }, table(t('match.cmd.subOut'), pickRows(onPitch, (v) => (outSlot = v))), table(t('match.cmd.subIn'), pickRows(benchRows, (v) => (inId = v)))),
        h('div', { class: 'btn-row end' }, h('span', { class: 'muted small-note' }, t('match.cmd.subNote')), confirm),
      );
    }

    function formationBody() {
      const snap = teamSnapshot(state, mySide);
      // 프리셋 + 사용자가 직접 짠 포메이션 (프리셋과 다르면)
      const mine = formationLabel(ctx.game.formation.cells);
      const options = presetFormationOptions();
      if (!FORMATION_CELLS[mine]) options.unshift({ id: 'mine', label: t('match.cmd.myFormation', { formation: mine }), cells: ctx.game.formation.cells });
      const picked = snap.formation ?? (FORMATION_CELLS[mine] ? mine : 'mine');
      // 고르면 바로 적용 (닫고 재개를 눌러도 지시가 사라지지 않게)
      const pick = (id) => id !== picked && applied(changeFormation(state, mySide, id === 'mine' ? ctx.game.formation.cells.map(positionOfCell) : id));
      const current = h(
        'table',
        { class: 'data compact' },
        h('tbody', {}, snap.slots.map((pos, i) => h('tr', {}, h('td', {}, h('span', { class: 'slot-tag' }, pos)), h('td', {}, snap.lineup[i]?.name ?? h('span', { class: 'muted' }, t('match.cmd.emptySlot')))))),
      );
      return h(
        'div',
        { class: 'cmd-formation' },
        formationPicker(options, picked, pick),
        h('p', { class: 'muted small-note' }, t('match.cmd.formationNote')),
        h('h3', {}, t('match.cmd.currentShape')),
        current,
      );
    }

    // 고르면 바로 지시가 나간다 (예전에는 '지시 내리기'를 따로 눌러야 해서 닫고 재개하면 사라졌다)
    function tacticsBody() {
      const now = teamSnapshot(state, mySide).tactics;
      const give = (tac) => {
        const res = setTactics(state, mySide, tac);
        showToast(res.message, { tone: res.ok ? '' : 'warn' });
        if (!res.ok) return;
        syncFeed(false);
        updateStats();
      };
      return h('div', {}, tacticsPicker(now, give), h('p', { class: 'muted small-note' }, t('match.cmd.tacticsNote')));
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
      const choices = (kind) => [{ id: '', label: t('match.pi.default') }, ...Object.entries(INSTRUCTIONS[kind]).map(([id, o]) => ({ id, label: o.label }))];
      // 전담 마크 대상: 상대 경기장 선수 (역할이 있으면 함께)
      const ORDER = ['ST', 'AM', 'LW', 'RW', 'CM', 'DM', 'LB', 'RB', 'CB'];
      const targets = [
        { id: '', label: t('match.pi.none') },
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
          markName ? h('span', { class: 'pi-chip mark' }, t('match.pi.markChip', { name: markName })) : null,
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
            roles.length > 1 ? h('label', {}, h('span', { class: 'muted' }, t('match.pi.role')), select(t('match.pi.aria', { name: p.name, what: t('match.pi.role') }), roles, snap.roles[i], (v) => applied(setRole(state, mySide, i, v)))) : null,
            pos === 'GK' ? null : h('label', {}, h('span', { class: 'muted' }, t('match.pi.shooting')), select(t('match.pi.aria', { name: p.name, what: t('match.pi.shooting') }), choices('shooting'), ins.shooting ?? '', (v) => applied(setInstruction(state, mySide, p.id, 'shooting', v)))),
            pos === 'GK' ? null : h('label', {}, h('span', { class: 'muted' }, t('match.pi.runs')), select(t('match.pi.aria', { name: p.name, what: t('match.pi.runs') }), choices('runs'), ins.runs ?? '', (v) => applied(setInstruction(state, mySide, p.id, 'runs', v)))),
            pos === 'GK' ? null : h('label', {}, h('span', { class: 'muted' }, t('match.pi.mark')), select(t('match.pi.aria', { name: p.name, what: t('match.pi.mark') }), targets, ins.mark ?? '', (v) => applied(setInstruction(state, mySide, p.id, 'mark', v)))),
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
        h('p', { class: 'muted small-note' }, t('match.pi.note')),
        rows.filter(Boolean),
      );
    }

    function renderBody() {
      const snap = teamSnapshot(state, mySide);
      title.textContent = t('match.cmd.title', { min: state.minute, home: home.shortName, h: state.score.home, a: state.score.away, away: away.shortName });
      tabs.el.querySelector('[data-id="subs"]').textContent = t('match.cmd.tabSubsCount', { n: snap.subsLeft });
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
    const moodLine = extra ? t('match.locker.moodExtra') : t(`match.locker.mood.${mood}`);
    // 수석코치: 기록에서 가장 눈에 띄는 한 가지
    const coach =
      my < their && xgGap > 0.3 ? t('match.coach.unlucky')
      : my > their && xgGap < -0.3 ? t('match.coach.lucky')
      : poss <= 40 ? t('match.coach.overrun')
      : poss >= 60 && s[mySide].shotsOnTarget <= s[opp].shotsOnTarget ? t('match.coach.sterile')
      : s[mySide].shotsOnTarget === 0 ? t('match.coach.noShots')
      : my > their ? t('match.coach.onPlan')
      : my < their ? t(extra ? 'match.coach.timeLeftExtra' : 'match.coach.timeLeft')
      : t('match.coach.tight');
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
    for (const [id, n] of scored) note(onPitch.find((x) => x.p.id === id), n >= 2 ? t('match.locker.brace', { n }) : t('match.locker.scored'), 'good');
    if (byRating[0]?.r >= 6.7) note(byRating[0], t('match.locker.leading'), 'good');
    if (byRating.at(-1)?.r <= 6.0) note(byRating.at(-1), t('match.locker.struggling'), 'bad');
    const tired = onPitch.filter((x) => x.pos !== 'GK' && x.c < 76).sort((a, b) => a.c - b.c)[0];
    note(tired, t('match.locker.tired'), 'warn');
    note(onPitch.find((x) => booked.has(x.p.id)), t('match.locker.booked'), 'warn');
    const goals = state.goals.map((g) => `${g.minute}' ${g.scorerName}${g.team === mySide ? '' : ` (${sideTeam[g.team].shortName})`}`);
    // 점수판과 같은 순서(홈 왼쪽). 우리 쪽 숫자를 밝게
    const usLeft = mySide === 'home';
    const stat = (label, mine, theirs) => {
      const [a, b] = usLeft ? [mine, theirs] : [theirs, mine];
      return h('div', { class: 'lk-stat' }, h('b', { class: `num${usLeft ? ' is-us' : ''}` }, a), h('span', { class: 'muted' }, label), h('b', { class: `num${usLeft ? '' : ' is-us'}` }, b));
    };
    const [leftTeam, rightTeam] = usLeft ? [us, them] : [them, us];
    const line = (n, ...children) => h('div', { class: `t-stagger-line t-stagger-line--${n}` }, ...children);
    const el = h(
      'div',
      { class: `locker t-stagger is-${mood}`, style: { '--us': teamAccent(us), '--them': teamAccent(them) } },
      line(
        1,
        h(
          'header',
          { class: 'lk-head' },
          h('div', { class: 'lk-score' }, teamBadge(leftTeam, 56), h('h2', { class: 'num' }, h('span', { class: 'sr-only' }, t('match.locker.srHead', { phase: t(extra ? 'match.locker.phaseExtra' : 'match.locker.phaseHalf'), team: leftTeam.shortName })), `${state.score.home} – ${state.score.away}`, h('span', { class: 'sr-only' }, ` ${rightTeam.shortName}`)), teamBadge(rightTeam, 56)),
          h('p', { class: 'lk-mood' }, t('match.locker.moodHead', { phase: t(extra ? 'match.locker.phaseExtra' : 'match.locker.phaseHalf'), us: us.shortName, them: them.shortName, mood: moodLine })),
          goals.length ? h('p', { class: 'lk-goals muted' }, goals.join(' · ')) : null,
        ),
      ),
      line(2, h('blockquote', { class: 'lk-coach' }, h('span', { class: 'muted' }, t('match.locker.assistant')), h('p', {}, coach))),
      line(3, h('div', { class: 'lk-stats' }, stat(t('match.locker.possession'), `${poss}%`, `${100 - poss}%`), stat(t('match.locker.shots'), s[mySide].shots, s[opp].shots), stat(t('match.locker.onTarget'), s[mySide].shotsOnTarget, s[opp].shotsOnTarget))),
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
    if (!media) return showToast(t('match.locker.noMedia'), { duration: 3500 });
    const talk = live.cup ? cupTeamTalk(media, dataset, ctx.game, state, mySide, live.gap ?? 0, fixture, moment) : teamTalk(media, dataset, ctx.game, state, mySide, live.gap ?? 0);
    const body = h('div', { class: 'locker-talk' });
    const { el: scene, reveal } = lockerScene(moment, body);
    clearToasts(); // 지난 골 알림이 라커룸 장면 위에 남지 않게
    const close = openModal(scene, { variant: 'locker' });
    reveal();
    const after = (reaction) => {
      const cmd = h('button', { class: 'btn', type: 'button' }, t('match.locker.command'));
      const go = h('button', { class: 'btn primary big', type: 'button' }, moment === 'extraTime' ? t('match.locker.startExtra') : t('match.locker.startSecond'));
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
          body.replaceChildren(h('p', { class: 'muted' }, t('match.locker.silentText')));
          after(null);
        },
        t('match.locker.silent'),
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
    if (animate && kind === 'c-goal') li.classList.add('is-fresh');
    if (animate) streamText(text, c.text);
    else text.textContent = c.text;
    return li;
  }

  // 우리 선수 평점 (실시간). 경기가 끝나면 최우수 선수도
  const ratingsBody = h('tbody');
  const potmEl = h('div', { class: 'potm' });
  function updateRatings() {
    const ratings = playerRatings(state);
    const tm = state.teams[mySide];
    const rows = [...tm.roster.values()].filter((p) => ratings[p.id] != null).sort((a, b) => ratings[b.id] - ratings[a.id]);
    const subIn = new Set(state.subs.filter((x) => x.team === mySide).map((x) => x.inId));
    let potmId = null;
    if (state.finished) {
      const all = Object.entries(ratings).sort((a, b) => b[1] - a[1]);
      potmId = all[0]?.[0] ?? null;
      const p = potmId && (state.teams.home.roster.get(potmId) ?? state.teams.away.roster.get(potmId));
      const potmSide = state.teams.home.roster.has(potmId) ? 'home' : 'away';
      potmEl.classList.toggle('is-opp', potmSide !== mySide);
      potmEl.replaceChildren(...(p ? [h('span', {}, t('match.ratings.potm')), teamBadge(sideTeam[potmSide], 16), h('b', {}, p.name), h('span', { class: `rt ${ratingClass(ratings[potmId])}` }, ratings[potmId].toFixed(1))] : []));
    }
    ratingsBody.replaceChildren(
      ...rows.map((p) =>
        h(
          'tr',
          { class: p.id === potmId ? 'is-potm' : '' },
          h('td', {}, h('span', { class: 'pos-tag' }, tm.slotOf.get(p.id) ?? p.position)),
          h('td', {}, p.name, subIn.has(p.id) ? h('span', { class: 'muted' }, t('match.ratings.subOn')) : tm.lineup.includes(p) ? '' : h('span', { class: 'muted' }, t('match.ratings.subOff'))),
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
      [t('match.stats.shots'), s.home.shots, s.away.shots],
      [t('match.stats.onTarget'), s.home.shotsOnTarget, s.away.shotsOnTarget],
      [t('match.stats.possession'), s.home.possession, s.away.possession, '%'],
      ['xG', s.home.xg, s.away.xg],
      [t('match.stats.yellow'), s.home.yellow, s.away.yellow],
      [t('match.stats.red'), s.home.red, s.away.red],
    ];
    statsBody.replaceChildren(
      ...rows.map(([label, a, b, unit = '']) => {
        const total = a + b || 1;
        return h(
          'tr',
          {},
          h('td', { class: `num ${a > b ? 'lead' : ''}` }, `${typeof a === 'number' && !Number.isInteger(a) ? a.toFixed(2) : a}${unit}`),
          h('td', { class: 'stat-mid' }, h('span', { class: 'muted' }, label), h('span', { class: 'split' }, h('span', { style: { width: `${(a / total) * 100}%`, background: accents[0] } }), h('span', { style: { width: `${(b / total) * 100}%`, background: accents[1] } }))),
          h('td', { class: `num ${b > a ? 'lead' : ''}` }, `${typeof b === 'number' && !Number.isInteger(b) ? b.toFixed(2) : b}${unit}`),
        );
      }),
    );
  }

  function updateStatus() {
    minuteEl.textContent = live.done || state.finished ? 'FT' : state.minute === 0 ? "0'" : `${state.minute}'`;
    if (live.done) {
      statusEl.replaceChildren(h('span', { class: 'status-ft' }, t('match.live.fullTime')));
      pauseBtn.hidden = true;
      skipBtn.hidden = true;
      subBtn.hidden = true;
      tacticLine.hidden = true;
      autoToggle.hidden = true;
      speed.el.parentElement.hidden = true;
    } else if (live.paused) {
      statusEl.replaceChildren(h('span', { class: 'muted' }, state.minute === 0 ? t('match.live.waiting') : t('match.live.paused')));
      pauseBtn.textContent = state.minute === 0 ? t('match.live.start') : t('match.live.resume');
    } else {
      const label = t(state.minute < 45 ? 'match.live.first' : state.minute < MATCH_MINUTES || !state.extraTime ? 'match.live.second' : state.minute < 105 ? 'match.live.etFirst' : 'match.live.etSecond');
      statusEl.replaceChildren(h('span', { class: 't-shimmer live', 'data-text': label }, label));
      pauseBtn.textContent = t('match.live.pause');
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
    if (prior && (prior.home || prior.away || fixture.leg === 2)) parts.push(t('match.score.agg', { a: state.score.home + prior.home, b: state.score.away + prior.away }));
    if (state.penalties) parts.push(t('match.score.pens', { a: state.penalties.home, b: state.penalties.away }));
    aggEl.textContent = parts.join(' · ');
  }

  function renderAfter() {
    const game = ctx.game;
    const mineFixture = live.cup ? cupFixtureById(game, fixture.id) : fixtureById(game, fixture.id);
    const mineResult = mineFixture.result;
    // 인터뷰에 답하거나 넘기기 전에는 '다음 경기'를 주 버튼으로 강조하지 않는다 (인터뷰를 건너뛰게 만들지 않게)
    const next = h('button', { class: 'btn', type: 'button' }, isSeasonOver(game) ? t('match.after.seasonReview') : t('match.after.next'));
    next.addEventListener('click', () => {
      live = null;
      show();
    });
    const toTable = h('button', { class: 'btn ghost', type: 'button' }, live.cup ? t('match.after.toCups') : t('match.after.toTable'));
    toTable.addEventListener('click', () => ctx.navigate(live.cup ? 'cups' : 'table'));
    // 결과 줄 오른쪽: 리그는 순위·승점, 대륙 대회는 진출 여부·리그 페이즈 순위
    const standing = (() => {
      if (!live.cup) {
        const league = leagueOf(dataset, game);
        const myRow = computeTable(league.teamIds, fixturesOf(game), league.rules).find((r) => r.teamId === game.teamId);
        // 순위 변화를 말로: 이번 라운드 전 순위와 비교 (첫 라운드는 비교할 게 없다)
        const before = fixture.round > 1 ? computeTable(league.teamIds, fixturesOf(game).filter((f) => f.round < fixture.round), league.rules).find((r) => r.teamId === game.teamId) : null;
        const move = !before ? 'now' : myRow.position < before.position ? 'up' : myRow.position > before.position ? 'down' : 'same';
        return t(`match.after.move.${move}`, { pos: ord(myRow.position), pts: myRow.points });
      }
      const r = live.result;
      const oppSide = mySide === 'home' ? 'away' : 'home';
      const agg = r.aggregate ? t('match.score.agg', { a: r.aggregate[mySide], b: r.aggregate[oppSide] }) : '';
      const pens = r.penalties ? t('match.after.pensSuffix', { a: r.penalties[mySide], b: r.penalties[oppSide] }) : '';
      if (fixture.stage === 'final') return r.winner === mySide ? t('match.after.cupWon', { comp: compOf(game, fixture).name, pens }) : t('match.after.runnersUp', { pens });
      if (fixture.leg === 2) {
        const nextStage = stageName({ playoff: 'r16', r16: 'qf', qf: 'sf', sf: 'final' }[fixture.stage]);
        return r.winner === mySide ? t('match.after.advanced', { stage: nextStage, agg, pens }) : t('match.after.eliminated', { stage: stageName(fixture.stage), agg, pens });
      }
      if (fixture.stage === 'league') {
        const row = leaguePhaseTable(compOf(game, fixture)).find((x) => x.teamId === game.teamId);
        return t('match.after.phaseStanding', { pos: ord(row.position), pts: row.points });
      }
      return t('match.after.firstLegDone');
    })();
    const otherFixtures = live.cup
      ? eventFixtures(game, { stage: fixture.stage, md: fixture.md, leg: fixture.leg }).filter((f) => f.comp === fixture.comp && f.id !== fixture.id)
      : live.otherIds.map((id) => fixtureById(game, id));
    const postKey = live.cup ? `cup:${fixture.id}` : fixture.round;
    const outcome = (() => {
      const mine = fixture.homeId === game.teamId ? 'home' : 'away';
      const [m, o] = mine === 'home' ? [mineResult.score.home, mineResult.score.away] : [mineResult.score.away, mineResult.score.home];
      return m > o ? [t('match.after.win'), 'win'] : m < o ? [t('match.after.loss'), 'loss'] : [t('match.after.draw'), 'draw'];
    })();
    const postHost = h('div', { class: 'press-host' });
    const renderPost = (media) => {
      const done = game.lastPostInterview?.season === game.seasonIndex && game.lastPostInterview.round === postKey;
      next.classList.toggle('primary', Boolean(done || live.postAnswered || !media || !live.result));
      if (live.postAnswered) return postHost.replaceChildren(live.postAnswered);
      if (done) return postHost.replaceChildren(h('p', { class: 'muted' }, game.lastPostInterview.skipped ? t('match.post.skipped') : t('match.post.done')));
      if (!media || !live.result) return postHost.replaceChildren(h('p', { class: 'muted' }, t('match.press.loadFailed')));
      live.postIv ??= live.cup ? postCupInterview(media, dataset, game, fixture, live.result, live.gap ?? 0) : postInterview(media, dataset, game, fixture, live.result, live.gap ?? 0);
      const iv = live.postIv;
      postHost.replaceChildren(
        interviewView(
          iv,
          (stance) => {
            const r = answerPost(ctx.game, iv, stance);
            ctx.persist();
            const a = iv.answers.find((x) => x.stance === stance);
            live.postAnswered = answeredView(iv.question, a.label, a.text, r.backfired ? t('match.post.backfired', { shift: moraleShift(r.delta) }) : moraleShift(r.delta));
            renderPost(media);
          },
          () => {
            ctx.game.lastPostInterview = { season: game.seasonIndex, round: postKey, skipped: true };
            ctx.persist();
            renderPost(media);
          },
          t('match.post.skip'),
        ),
      );
    };
    loadMedia().then(renderPost);
    after.replaceChildren(
      resultScene({ outcome, standing, mineFixture }),
      otherFixtures.length
        ? h('details', { class: 'rs-others panel' }, h('summary', {}, t('match.after.others', { n: otherFixtures.length })), fixtureList(ctx, otherFixtures))
        : null,
      panel(t('match.post.title'), postHost, { className: 'press-panel' }),
      // 결과 → 인터뷰 → 다음 경기 순서 (다음 경기가 인터뷰보다 먼저 보이면 건너뛰게 된다)
      h('div', { class: 'btn-row end post-actions' }, toTable, next),
    );
  }

  // 경기 끝 장면: 큰 결과 단어, 순위 변화(말), 수석코치 한마디, 적용된 준비·결장, 편지함·이사회 소식
  function resultScene({ outcome, standing, mineFixture }) {
    const game = ctx.game;
    const gap = live.gap ?? 0;
    const expect = gap > 3 ? 'fav' : gap < -3 ? 'dog' : 'even';
    // 결과와 내용이 엇갈리면 내용을 먼저 말한다 (압도하고 진 경기에 '우리답지 않았다'고 하지 않게)
    const st = live.result?.stats;
    const xgDiff = st ? st[mySide].xg - st[mySide === 'home' ? 'away' : 'home'].xg : 0;
    const story = outcome[1] === 'loss' && xgDiff >= 0.6 ? 'unlucky' : outcome[1] === 'win' && xgDiff <= -0.6 ? 'lucky' : outcome[1] === 'draw' && xgDiff >= 0.8 ? 'dominant' : outcome[1] === 'draw' && xgDiff <= -0.8 ? 'survived' : expect;
    const lines = tList(`match.after.verdict.${outcome[1]}.${story}`);
    let seed = 0;
    for (const ch of `${game.seed}:${fixture.id}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const verdict = lines.length ? lines[seed % lines.length] : '';
    const notes = live.notes ?? { news: [], board: [] };
    const inboxBtn = h('button', { class: 'btn small ghost', type: 'button' }, t('match.after.openInbox'));
    inboxBtn.addEventListener('click', () => ctx.navigate('inbox'));
    const boardHost = h('div', { class: 'rs-board' });
    if (notes.board.length) {
      loadBoardText().then((txt) => {
        const b = game.board ?? {};
        boardHost.replaceChildren(
          ...notes.board.map((e) =>
            h('p', { class: `rs-note ${e.kind === 'praise' ? 'good' : 'bad'}` }, h('span', { class: 'rs-from' }, t('match.after.fromBoard')), pickTalk(txt?.[e.kind] ?? txt?.sacked, `${game.seed}:${game.seasonIndex}:${game.round}:${e.kind}`, { team: dataset.teamById.get(game.teamId)?.shortName ?? '', goal: b.objective ? objectiveLabel(b.objective) : '', target: b.objective?.target ?? '' })),
          ),
        );
      });
    }
    const reveal = (el, i) => {
      el.classList.add('reveal');
      el.style.setProperty('--i', i);
      return el;
    };
    return h(
      'section',
      { class: `result-scene ${outcome[1]}`, role: 'status' },
      reveal(h('p', { class: 'rs-label muted' }, live.cup ? t('match.after.cupResultTitle', { label: cupFixtureLabel(game, fixture) }) : t('match.after.roundResultTitle', { round: fixture.round })), 0),
      reveal(h('h2', { class: 'rs-word' }, outcome[0]), 1),
      reveal(h('p', { class: 'rs-standing' }, standing), 2),
      verdict ? reveal(h('blockquote', { class: 'rs-quote' }, h('span', { class: 'rs-from' }, t('match.after.fromAssistant')), verdict), 3) : null,
      live.prep ? effectsLine(live.prep, t('match.after.prepApplied')) : null,
      absenceReport(),
      boardHost,
      notes.news.length ? h('p', { class: 'rs-note' }, h('span', { class: 'rs-from' }, t('match.after.fromInbox')), notes.news.join(' · '), inboxBtn) : null,
      h('span', { class: 'sr-only' }, `${home.shortName} ${mineFixture.result.score.home}-${mineFixture.result.score.away} ${away.shortName}`),
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
      if (c.type === 'red' && c.team === mySide) showToast(t('match.toast.red', { min: c.minute, name: c.playerName }), { tone: 'bad' });
    }
    for (const inj of state.injuries.slice(injuriesBefore)) {
      if (inj.team === mySide) showToast(t('match.toast.injury', { min: inj.minute, name: inj.playerName, type: engineInjuryLabel(inj.type) }), { tone: 'warn' });
    }
    syncFeed(true);
    updateSubBtn();
    if (state.goals.length > goalsBefore) {
      updateScore(true);
      goalMoment(state.goals.at(-1));
      for (const g of state.goals.slice(goalsBefore)) {
        const team = sideTeam[g.team];
        showToast(
          h('span', { class: 'toast-goal' }, teamBadge(team, 18), h('b', {}, t('match.toast.goal')), `${g.minute}' ${g.scorerName} `, h('span', { class: 'muted' }, `${home.shortName} ${state.score.home}-${state.score.away} ${away.shortName}`)),
          { tone: 'goal' },
        );
      }
    }
    updateStats();
    if (state.finished) {
      finalize(); // 경기 종료는 결과 장면이 알린다 (토스트가 점수판을 가리지 않게)
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
      showToast(t('match.toast.extraTime'), { duration: 3000 });
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
    const hold = live.goalHold ?? 0; // 골 직후에는 잠깐 숨을 고른다
    live.goalHold = 0;
    live.timer = setTimeout(tick, speedMs() + hold);
  }

  // 골 순간: 점수판이 득점 팀 색으로 번쩍이고, 중계는 잠깐 멈춘 듯 숨을 고른다 (움직임 줄이기 설정이면 번쩍임 없음)
  function goalMoment(goal) {
    scoreboard.style.setProperty('--goal', teamAccent(sideTeam[goal.team]));
    scoreboard.classList.remove('is-goal');
    void scoreboard.offsetWidth;
    scoreboard.classList.add('is-goal');
    setTimeout(() => scoreboard.classList.remove('is-goal'), 1300);
    live.goalHold = 900;
  }

  // 경기 결과 반영 → 결과 패널. 실패하면 다시 시도 버튼
  function finalize() {
    finishMatch(ctx)
      .then(() => {
        updateStatus();
        renderAfter();
      })
      .catch(() => {
        const retry = h('button', { class: 'btn primary', type: 'button' }, t('match.fail.retry'));
        retry.addEventListener('click', finalize);
        after.replaceChildren(panel(t('match.fail.title'), h('div', { class: 'empty' }, h('p', {}, t('match.fail.body')), retry)));
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

  // 스크롤해서 스코어보드가 상단에 붙으면 한 줄로 줄인다 (점수·시간만)
  const sentinel = h('div', { class: 'sb-sentinel', 'aria-hidden': 'true' });
  stuckObserver?.disconnect();
  const topbarH = document.querySelector('.topbar')?.offsetHeight ?? 0;
  stuckObserver = new IntersectionObserver(([e]) => scoreboard.classList.toggle('is-stuck', !e.isIntersecting && e.boundingClientRect.top < topbarH), { rootMargin: `-${topbarH}px 0px 0px 0px` });
  stuckObserver.observe(sentinel);

  return h(
    'div',
    { class: 'match-live' },
    sentinel,
    scoreboard,
    live.done ? null : controls,
    after, // 경기가 끝나면 결과·인터뷰·다음 경기가 스코어보드 바로 아래에
    h(
      'div',
      { class: 'live-grid' },
      panel(t('match.live.feed'), h('div', { class: 'feed-wrap' }, feed), { className: 'feed-panel' }),
      h('div', { class: 'live-side' }, panel(t('match.live.stats'), h('table', { class: 'data stats-table' }, statsBody)), panel(t('match.live.ratings'), h('div', {}, potmEl, h('table', { class: 'data compact ratings-table' }, ratingsBody)))),
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
  const toTable = h('button', { class: 'btn ghost', type: 'button' }, t('match.season.finalTable'));
  toTable.addEventListener('click', () => ctx.navigate('table'));
  const lastSeason = game.seasonIndex >= game.years;
  const toHistory = h('button', { class: 'btn primary', type: 'button' }, lastSeason ? t('match.season.toCareer') : t('match.season.toHistory'));
  toHistory.addEventListener('click', () => ctx.navigate(lastSeason ? 'career' : 'history'));
  // 정한 기간을 다 채웠어도 한 시즌씩 더 이어갈 수 있다
  const extend = h('button', { class: 'btn ghost', type: 'button' }, t('match.season.extend'));
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
  const outcome = mine.position === 1 ? ['champion', t('match.season.champions')] : rec?.mine.promoted ? ['up', t('match.season.promoted')] : rec?.mine.relegated ? ['down', t('match.season.relegated')] : ['', t('match.season.pos', { pos: ord(mine.position) })];
  const vsExpect = rec?.mine.expected ? rec.mine.expected - mine.position : 0;
  const expectNote = !rec?.mine.expected ? '' : t(vsExpect >= 3 ? 'match.season.expectFarAbove' : vsExpect > 0 ? 'match.season.expectAbove' : vsExpect === 0 ? 'match.season.expectMet' : vsExpect <= -3 ? 'match.season.expectFarBelow' : 'match.season.expectBelow', { pos: ord(rec.mine.expected) });
  const over = panel(
    t('match.season.overTitle', { season: game.season }),
    h(
      'div',
      { class: `season-over is-${outcome[0] || 'plain'}` },
      teamBadge(us, 72),
      h('p', { class: 'so-team' }, us.name),
      h('h2', { class: 'so-outcome' }, outcome[1]),
      h('p', {}, t('match.season.record', { league: league.name, pos: ord(mine.position), pts: mine.points, w: mine.won, d: mine.drawn, l: mine.lost })),
      expectNote ? h('p', { class: 'muted' }, expectNote) : null,
      trophies.length ? h('p', { class: 'trophy-row' }, trophies.map((tr) => h('span', { class: 'trophy' }, tr.name))) : null,
      mine.position === 1 ? null : h('p', { class: 'so-champion muted' }, t('match.season.championLabel'), teamBadge(champion, 18), ` ${champion.name}`),
      h('p', { class: 'muted' }, game.seasonIndex < game.years ? t('match.season.progress', { years: game.years, n: game.seasonIndex }) : t('match.season.allDone', { n: game.years })),
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
    const box = h('input', { type: 'checkbox', checked: chosen.has(p.id) || null, 'aria-label': t('match.next.renewAria', { name: p.name }) });
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
      h('td', { class: 'num' }, t('match.next.terms', { wage: formatWage(terms.wage), n: terms.years })),
    );
  });
  const start = h('button', { class: 'btn primary big', type: 'button' }, t('match.next.start', { n: game.seasonIndex + 1 }));
  // 경질됐으면 새 구단을 골라야 시작할 수 있다
  if (mustChooseClub(game)) start.disabled = true;
  start.addEventListener('click', async () => {
    const r = await ctx.runBusy(t('match.busy.nextSeason'), () => advanceSeason(ctx.baseDataset, ctx.game, { renew: [...chosen] }));
    const moved = r.game.teamId !== ctx.game.teamId;
    track('season-next', { season: r.game.seasonIndex, team: r.game.teamId, moved });
    ctx.setGame(r.game);
    if (moved) ctx.rebuildTopbar?.();
    show();
    showSeasonSummary(ctx, r.summary);
  });
  return panel(
    t('match.next.title'),
    h(
      'div',
      { class: 'next-season' },
      h('p', { class: 'muted' }, t('match.next.intro')),
      expiring.length
        ? h(
            'div',
            {},
            h('h3', {}, t('match.next.expiringHead', { n: expiring.length })),
            h('div', { class: 'table-scroll' }, h('table', { class: 'data compact' }, h('thead', {}, h('tr', {}, h('th', {}, t('match.next.thRenew')), h('th', {}, t('match.next.thPos')), h('th', {}, t('match.next.thName')), h('th', { class: 'num' }, t('match.next.thAge')), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, t('match.next.thWage')), h('th', { class: 'num' }, t('match.next.thTerms')))), h('tbody', {}, rows))),
          )
        : h('p', {}, t('match.next.noneExpiring')),
      h('div', { class: 'btn-row end' }, start),
    ),
  );
}

// 새 시즌 안내 창
function showSeasonSummary(ctx, summary) {
  if (!summary) return;
  const { game } = ctx;
  const line = (label, items) => (items?.length ? h('li', {}, h('b', {}, label), ' ', items.join(', ')) : null);
  const ok = h('button', { class: 'btn primary', type: 'button' }, t('match.summary.ok'));
  const close = openModal(
    h(
      'div',
      { class: 'confirm-modal season-summary' },
      h('h2', {}, t('match.summary.title', { season: game.season })),
      h(
        'ul',
        { class: 'summary-list' },
        summary.newTeam ? h('li', {}, h('b', {}, t('match.summary.newClub')), t('match.summary.newClubText', { team: summary.newTeam, goal: game.board?.objective ? objectiveLabel(game.board.objective) : '' })) : null,
        summary.newLeague ? h('li', {}, h('b', {}, summary.promoted.length ? t('match.summary.promoted') : t('match.summary.relegated')), t('match.summary.newLeague', { league: summary.newLeague })) : null,
        !summary.newTeam && game.board?.objective ? h('li', {}, h('b', {}, t('match.summary.objective')), ` ${objectiveLabel(game.board.objective)}`) : null,
        h('li', {}, h('b', {}, t('match.summary.continental')), ' ', summary.cup ? t('match.summary.cupQualified', { cup: summary.cup }) : t('match.summary.cupNone')),
        line(t('match.summary.retired'), summary.retired),
        line(t('match.summary.loanReturned'), summary.loanReturned),
        line(t('match.summary.left'), summary.left),
        line(t('match.summary.sold'), summary.sold),
        summary.parachute ? h('li', {}, h('b', {}, t('match.summary.parachute')), t('match.summary.parachuteText', { money: formatMoney(summary.parachute) })) : null,
        summary.relegated?.length ? h('li', {}, h('b', {}, t('match.summary.hangover')), t('match.summary.hangoverText')) : null,
        line(t('match.summary.youth'), summary.youth),
        line(t('match.summary.signed'), summary.signed),
      ),
      h('p', { class: 'muted small-note' }, t('match.summary.windowOpen')),
      h('div', { class: 'confirm-actions' }, ok),
    ),
  );
  ok.addEventListener('click', close);
}
