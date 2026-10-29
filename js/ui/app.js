// 앱 셸: 상단 바 + 화면 전환(panel reveal) + 자동 저장 + 세이브 슬롯 + 진행 중 잠금
import { formatMoney } from '../market/value.js';
import { SAVE_VERSION, dataFingerprint, isSeasonOver, leagueOf } from '../state/game.js';
import { deleteSave, saveGame } from '../state/save.js';
import { worldDataset } from '../state/world.js';
import { teamBadge } from './badge.js';
import { openConfirm, segmented } from './components.js';
import { h } from './dom.js';
import { showToast, swapPanel } from './motion.js';
import * as careerScreen from './screens/career.js';
import * as cupsScreen from './screens/cups.js';
import * as financeScreen from './screens/finance.js';
import * as historyScreen from './screens/history.js';
import * as matchScreen from './screens/match.js';
import * as scheduleScreen from './screens/schedule.js';
import * as squadScreen from './screens/squad.js';
import * as tableScreen from './screens/table.js';
import * as teamSelectScreen from './screens/teamSelect.js';
import * as trainingScreen from './screens/training.js';
import * as transfersScreen from './screens/transfers.js';

// career: 감독 커리어 엔딩 (상단 탭 없이 시즌 종료·기록 화면에서 연다)
const SCREENS = { career: careerScreen, select: teamSelectScreen, squad: squadScreen, match: matchScreen, schedule: scheduleScreen, training: trainingScreen, table: tableScreen, cups: cupsScreen, transfers: transfersScreen, finance: financeScreen, history: historyScreen };
const NAV = [
  { id: 'squad', label: '스쿼드' },
  { id: 'match', label: '경기' },
  { id: 'schedule', label: '일정' },
  { id: 'training', label: '훈련' },
  { id: 'table', label: '순위표' },
  { id: 'cups', label: '대륙 대회' },
  { id: 'transfers', label: '이적' },
  { id: 'finance', label: '재정' },
  { id: 'history', label: '기록' },
];
const SAVE_DELAY = 400;

// 저장된 게임이 지금 데이터·버전과 맞는지
function slotInfo({ slot, game }, dataset) {
  if (!game) return { slot, game: null, invalid: false };
  const valid = game.version === SAVE_VERSION && game.dataVersion === dataFingerprint(dataset);
  return { slot, game: valid ? game : null, invalid: !valid };
}

export function createApp(root, dataset, savedSlots = []) {
  let saveTimer = null;
  const ctx = {
    baseDataset: dataset,
    // 시즌이 지나며 바뀐 선수·리그를 반영한 데이터 (state/world.js)
    get dataset() {
      return worldDataset(dataset, ctx.game);
    },
    game: null,
    slots: savedSlots.map((s) => slotInfo(s, dataset)),
    navigate,
    refreshTopbar,
    persist,
    leaveToSelect,
    rebuildTopbar: () => buildTopbar(), // 구단을 옮기면 상단 팀 표시를 다시
    startGame(game) {
      ctx.game = game;
      ctx.slots = ctx.slots.map((s) => (s.slot === game.slot ? { slot: s.slot, game, invalid: false } : s));
      buildTopbar();
      navigate('squad');
      persist();
    },
    // Worker가 돌려준 새 game으로 바꿔 끼운다
    setGame(game) {
      ctx.game = game;
      ctx.slots = ctx.slots.map((s) => (s.slot === game.slot ? { ...s, game } : s));
      refreshTopbar();
      persist();
    },
    async discardSave(slot) {
      await deleteSave(slot).catch(() => {});
      ctx.slots = ctx.slots.map((s) => (s.slot === slot ? { slot, game: null, invalid: false } : s));
    },
    // 진행 중에는 화면을 잠근다 (그 사이 바꾼 내용이 Worker 결과에 덮이지 않도록)
    async runBusy(label, fn) {
      const overlay = h('div', { class: 'busy-overlay', role: 'status' }, h('div', { class: 'busy-box' }, h('span', { class: 't-shimmer', 'data-text': label }, label)));
      document.body.append(overlay);
      void overlay.offsetWidth;
      overlay.classList.add('is-open');
      try {
        return await fn();
      } catch (err) {
        // 진행 실패: 화면이 조용히 멈추지 않게 알리고, 호출한 쪽은 결과를 반영하지 않는다 (같은 버튼으로 다시 시도)
        console.error(label, err);
        showToast(`${label} 중 오류가 났습니다. 다시 시도해 주세요.`, { tone: 'bad', duration: 5000 });
        throw err;
      } finally {
        overlay.classList.remove('is-open');
        setTimeout(() => overlay.remove(), 250);
      }
    },
  };

  // 바뀔 때마다 부르지만 실제 저장은 잠깐 모아서 한 번
  function persist() {
    if (!ctx.game) return;
    clearTimeout(saveTimer);
    const game = ctx.game;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveGame(game).catch((err) => {
        console.warn('저장 실패', err);
        showToast('저장하지 못했습니다 (브라우저 저장소를 확인하세요)', { tone: 'warn' });
      });
    }, SAVE_DELAY);
  }

  function flushSave() {
    if (saveTimer && ctx.game) {
      clearTimeout(saveTimer);
      saveTimer = null;
      return saveGame(ctx.game).catch(() => {});
    }
    return Promise.resolve();
  }

  const topbar = h('header', { class: 'topbar' });
  const panelEl = h('div', { class: 't-panel-slide screen', 'data-open': 'false' });
  root.replaceChildren(topbar, h('main', { class: 'main' }, panelEl));

  let current = null;
  let nav = null;
  let roundLabel = null;
  let budgetLabel = null;

  function buildTopbar() {
    const brand = h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', {}, 'HALFTIME', h('b', {}, ' TALK')));
    if (!ctx.game) {
      nav = null;
      topbar.replaceChildren(brand, h('span', { class: 'topbar-meta muted' }, `${dataset.leagues.length}개 리그 · ${dataset.allTeams.length}팀`));
      return;
    }
    const team = dataset.teamById.get(ctx.game.teamId);
    roundLabel = h('span', { class: 'muted' });
    budgetLabel = h('span', { class: 'budget num' });
    nav = segmented(NAV, current && current !== 'select' ? current : 'squad', (id) => navigate(id));
    const toSelect = h('button', { class: 'btn ghost small', type: 'button' }, '팀 선택');
    toSelect.addEventListener('click', () =>
      openConfirm({
        title: '팀 선택 화면으로 갈까요?',
        body: `지금 게임은 슬롯 ${ctx.game.slot}에 저장됩니다. 팀 선택 화면에서 이어하거나 새 게임을 시작할 수 있습니다.`,
        confirmLabel: '이동',
        onConfirm: leaveToSelect,
      }),
    );
    topbar.replaceChildren(
      brand,
      h('div', { class: 'topbar-team' }, teamBadge(team, 22), h('b', {}, team.shortName), roundLabel, budgetLabel),
      h('nav', { class: 'topbar-nav' }, nav.el),
      h('div', { class: 'topbar-actions' }, toSelect),
    );
    refreshTopbar();
  }

  // 지금 게임을 저장하고 팀 선택 화면으로
  async function leaveToSelect() {
    SCREENS[current]?.leave?.(ctx);
    matchScreen.reset();
    await flushSave();
    ctx.game = null;
    buildTopbar();
    navigate('select');
  }

  function refreshTopbar() {
    if (!roundLabel || !ctx.game) return;
    const g = ctx.game;
    const league = leagueOf(ctx.dataset, g);
    const season = g.years > 1 ? ` · 시즌 ${g.seasonIndex}/${g.years}` : '';
    roundLabel.textContent = `${league.name} ${g.season}${season} · ${isSeasonOver(g) ? '시즌 종료' : `라운드 ${g.round}/${g.totalRounds}`}`;
    budgetLabel.textContent = formatMoney(g.budgets[g.teamId]);
  }

  function navigate(name) {
    if (!ctx.game) name = 'select';
    if (name === current && panelEl.getAttribute('data-open') === 'true') return;
    SCREENS[current]?.leave?.(ctx);
    current = name;
    nav?.select(name);
    swapPanel(panelEl, () => {
      panelEl.replaceChildren(SCREENS[name].render(ctx));
      window.scrollTo({ top: 0 });
    });
  }

  // 탭을 닫기 직전에 남은 저장을 바로 실행
  window.addEventListener('pagehide', flushSave);

  buildTopbar();
  navigate('select');
  return ctx;
}
