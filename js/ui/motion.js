// transitions.dev 오케스트레이션 스니펫을 여러 요소에 쓸 수 있도록 함수로 감싼 것.
// 로직은 원문(~/.claude/skills/transitions-dev/*.md)과 같고, 시간 값은 CSS 변수에서 읽는다.

export const cssMs = (name, fallback) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

// ── Tabs sliding (16) ─────────────────────────────────
// bar: .t-tabs. onSelect(tab)은 클릭 시 호출. 반환값 select(tab)로 코드에서 선택 변경
export function initTabs(bar, onSelect) {
  const pill = bar.querySelector('.t-tabs-pill');
  const tabs = [...bar.querySelectorAll('.t-tab')];

  function moveTo(tab, animate) {
    if (!animate) {
      const prev = pill.style.transition;
      pill.style.transition = 'none';
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = prev;
    } else {
      pill.style.transform = `translateX(${tab.offsetLeft}px)`;
      pill.style.width = `${tab.offsetWidth}px`;
    }
  }
  const active = () => tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];

  function select(tab, animate = true) {
    tabs.forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
    moveTo(tab, animate);
  }
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      select(tab);
      onSelect?.(tab);
    });
  });
  requestAnimationFrame(() => moveTo(active(), false));
  // 창 크기 변경 때 pill 위치 갱신: 리스너는 하나만 두고, 화면에서 떨어진 탭은 목록에서 뺀다 (화면을 그릴 때마다 쌓이지 않게)
  resizeHandlers.add(() => {
    if (!bar.isConnected) return false;
    moveTo(active(), false);
    return true;
  });
  return { select, refresh: () => moveTo(active(), false) };
}

const resizeHandlers = new Set();
window.addEventListener('resize', () => {
  for (const fn of resizeHandlers) if (!fn()) resizeHandlers.delete(fn);
});

// ── Card hover tilt (19) ──────────────────────────────
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const TILT_MAX = 10;

export function attachTilt(tilt) {
  const card = tilt.querySelector('.t-tilt-card');
  // 터치 화면에서는 기울기 효과를 쓰지 않는다 (손가락으로 카드 위를 스크롤할 수 있게)
  if (matchMedia('(pointer: coarse)').matches) {
    tilt.style.touchAction = 'pan-y';
    return;
  }

  function reset() {
    tilt.classList.remove('is-hover');
    card.classList.remove('is-tilting');
    card.style.setProperty('--tilt-rx', '0deg');
    card.style.setProperty('--tilt-ry', '0deg');
  }

  function track(e) {
    if (reduceMotion.matches) return;
    const r = tilt.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    tilt.classList.add('is-hover');
    card.classList.add('is-tilting');
    card.style.setProperty('--tilt-ry', ((px - 0.5) * TILT_MAX).toFixed(2) + 'deg');
    card.style.setProperty('--tilt-rx', ((0.5 - py) * TILT_MAX).toFixed(2) + 'deg');
    card.style.setProperty('--tilt-gx', (px * 100).toFixed(1) + '%');
    card.style.setProperty('--tilt-gy', (py * 100).toFixed(1) + '%');
  }

  tilt.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') {
      try { tilt.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });
  tilt.addEventListener('pointermove', track);
  tilt.addEventListener('pointerup', reset);
  tilt.addEventListener('pointercancel', reset);
  tilt.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') reset();
  });
}

// ── Number pop-in (02) ────────────────────────────────
// group: .t-digit-group. 바뀐 자리만 튀어 오른다. 같은 값이면 아무것도 하지 않음
export function setDigits(group, str) {
  const prev = group.textContent.replace(/\s+/g, '');
  if (prev === str) return;
  let same = 0;
  while (same < prev.length && same < str.length && prev[same] === str[same]) same++;
  group.classList.remove('is-animating');
  group.replaceChildren();
  const chars = str.split('');
  chars.forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 't-digit';
    span.textContent = ch;
    // 바뀐 자리끼리만 차례로 (한 자리만 바뀌면 바로 뜬다 — 지연 동안 칸이 비어 보이지 않게)
    if (i < same) span.dataset.same = '';
    else if (i - same > 0) span.dataset.stagger = String(Math.min(2, i - same));
    group.appendChild(span);
  });
  void group.offsetHeight; // force reflow
  group.classList.add('is-animating');
}

// ── Streaming text (30) ───────────────────────────────
// block 안의 텍스트를 단어 단위로 감싸고 순서대로 떠오르게 한다
export function streamText(block, text) {
  const words = text.trim().split(/\s+/);
  block.textContent = '';
  const spans = words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 't-stream-w';
    s.textContent = w;
    block.appendChild(s);
    if (i < words.length - 1) block.appendChild(document.createTextNode(' '));
    return s;
  });
  const gap = cssMs('--stream-gap', 60);
  void block.offsetWidth; // flush
  (function next(n) {
    if (n >= spans.length) return;
    spans[n].classList.add('is-in');
    setTimeout(() => next(n + 1), gap);
  })(0);
}

// ── Toast (22) ────────────────────────────────────────
// 알림 자리는 미리 만들어 둔다: 실시간 영역은 내용이 들어오기 전에 있어야 화면 낭독기가 확실히 읽는다
let toastHost = null;
function ensureToastHost() {
  if (toastHost || typeof document === 'undefined' || !document.body) return toastHost;
  toastHost = document.createElement('div');
  toastHost.className = 'toast-host';
  toastHost.setAttribute('role', 'status');
  toastHost.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastHost);
  return toastHost;
}
ensureToastHost();

export function showToast(content, { duration = 2600, tone = '' } = {}) {
  ensureToastHost();
  const toast = document.createElement('div');
  toast.className = `t-toast toast ${tone}`;
  toast.dataset.tone = tone;
  if (typeof content === 'string') toast.textContent = content;
  else toast.append(content);
  // 같은 종류 알림이 겹겹이 쌓이지 않게: 앞의 것은 바로 닫는다 (골 알림만 경기 중 이어서 쌓인다)
  if (tone !== 'goal') for (const old of toastHost.querySelectorAll('.toast.is-open')) if (old.dataset.tone === tone) closeToast(old);
  toastHost.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add('is-open');
  toast.addEventListener('click', () => closeToast(toast)); // 누르면 닫힌다 (가린 내용을 바로 볼 수 있게)
  setTimeout(() => closeToast(toast), duration);
}

// 장면이 바뀔 때(라커룸 등) 떠 있는 알림을 걷는다
export function clearToasts() {
  for (const toast of toastHost?.querySelectorAll('.toast.is-open') ?? []) closeToast(toast);
}

function closeToast(toast) {
  if (!toast.classList.contains('is-open')) return;
  toast.classList.remove('is-open');
  setTimeout(() => toast.remove(), cssMs('--toast-close', 250));
}

// ── Modal (06) ────────────────────────────────────────
// 배경(.modal-backdrop)과 대화상자(.t-modal)를 만들고 닫기 함수를 돌려준다
// variant: 창 모양 이름 (예: 'locker' → 화면 전체를 쓰는 하프타임 라커룸)
export function openModal(content, { onClose, variant = '' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = `modal-backdrop${variant ? ` is-${variant}` : ''}`;
  const modal = document.createElement('div');
  modal.className = `t-modal modal${variant ? ` modal-${variant}` : ''}`;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.tabIndex = -1;
  modal.append(content);
  // 창 이름: 안의 첫 제목
  const heading = modal.querySelector('h1, h2, h3');
  if (heading) {
    heading.id ||= `modal-title-${++modalSeq}`;
    modal.setAttribute('aria-labelledby', heading.id);
  }
  backdrop.append(modal);
  document.body.append(backdrop);
  openModals.push(backdrop);
  const opener = document.activeElement;

  const closeMs = cssMs('--modal-close-dur', 150);
  let closed = false;
  function closeModal() {
    if (closed) return;
    closed = true;
    modal.classList.remove('is-open');
    modal.classList.add('is-closing');
    backdrop.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    openModals.splice(openModals.indexOf(backdrop), 1);
    // 연 버튼으로 포커스를 돌려준다 (그 버튼이 다시 그려져 없어졌으면 그대로)
    if (modal.contains(document.activeElement) && opener?.isConnected) opener.focus();
    setTimeout(() => {
      modal.classList.remove('is-closing');
      backdrop.remove();
      onClose?.();
    }, closeMs);
  }
  const onKey = (e) => {
    if (backdrop !== openModals.at(-1)) return; // 겹친 창은 맨 위 창만 (body 끝에 다른 요소가 붙어도 열린 순서로 판단)
    if (e.key === 'Escape') return closeModal();
    if (e.key !== 'Tab') return;
    // Tab이 창 밖(뒤 화면)으로 빠져나가지 않게 창 안에서 돈다
    const items = focusables(modal);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items.at(-1);
    if (!modal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => e.target === backdrop && closeModal());

  void modal.offsetWidth;
  backdrop.classList.add('is-open');
  modal.classList.remove('is-closing');
  modal.classList.add('is-open');
  // 포커스를 창 안으로: 창이 정한 대상이 있으면 그것, 없으면 창 자체(제목부터 읽히고 Tab으로 첫 조작 요소)
  (modal.querySelector('[autofocus]') ?? modal).focus({ preventScroll: true });
  return closeModal;
}

let modalSeq = 0;
const openModals = []; // 열린 순서대로 (맨 뒤가 맨 위 창)
const focusables = (root) =>
  [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.getClientRects().length);

// ── Tooltip (17) ──────────────────────────────────────
// group: .t-tt-group (안에 .t-tt 하나). 안의 [data-tooltip] 요소가 트리거
export function initTooltipGroup(group) {
  const tip = group.querySelector('.t-tt');
  const text = tip.querySelector('.t-tt-text');
  const triggers = [...group.querySelectorAll('[data-tooltip]')];

  function hide() {
    tip.setAttribute('data-show', 'false');
    tip.setAttribute('aria-hidden', 'true');
  }

  function place(trigger) {
    const showing = tip.getAttribute('data-show') === 'true';
    text.textContent = trigger.getAttribute('data-tooltip') || '';
    const cs = getComputedStyle(tip);
    const width = Math.ceil(text.scrollWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
    const g = group.getBoundingClientRect();
    const r = trigger.getBoundingClientRect();
    const x = r.left - g.left + r.width / 2 - width / 2;
    if (!showing) {
      tip.style.transition = 'none';
      tip.style.width = `${width}px`;
      tip.style.setProperty('--tt-x', `${x}px`);
      void tip.offsetWidth;
      tip.style.transition = '';
    } else {
      tip.style.width = `${width}px`;
      tip.style.setProperty('--tt-x', `${x}px`);
    }
    tip.setAttribute('data-show', 'true');
    tip.setAttribute('aria-hidden', 'false');
  }

  triggers.forEach((t) => {
    t.addEventListener('pointerenter', () => place(t));
    t.addEventListener('focus', () => place(t));
    t.addEventListener('blur', hide);
  });
  group.addEventListener('pointerleave', hide);
}

// ── Panel reveal (07) ─────────────────────────────────
// 화면 전환: 닫힘 → 내용 교체 → 열림
// 닫히는 동안 다른 화면을 또 요청하면 마지막 요청만 그린다 (늦게 도착한 이전 화면이 덮어쓰지 않게)
let swapToken = 0;
export function swapPanel(panel, render) {
  const isOpen = panel.getAttribute('data-open') === 'true';
  const token = ++swapToken;
  const apply = () => {
    if (token !== swapToken) return;
    render();
    void panel.offsetWidth;
    panel.setAttribute('data-open', 'true');
  };
  if (!isOpen) return apply();
  panel.setAttribute('data-open', 'false');
  setTimeout(apply, cssMs('--panel-close-dur', 350));
}
