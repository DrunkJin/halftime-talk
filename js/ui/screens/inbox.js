// 받은 편지함: 이사회·선수·이적·리그·경기 소식 (state/inbox.js, 문구 data/news.json)
import { NEWS_GROUPS, groupOf, markRead, unreadCount } from '../../state/inbox.js';
import { loadNewsText, renderNews } from '../../media/newsText.js';
import { openPlayerModal, panel, segmented } from '../components.js';
import { h } from '../dom.js';

let filter = 'all';

// 메시지에서 이어지는 화면
function actionOf(ctx, msg) {
  const id = msg.vars?.id;
  const go = (label, fn) => {
    const b = h('button', { class: 'btn small ghost', type: 'button' }, label);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  if (msg.kind.startsWith('player.') && id && ctx.dataset.playerById.get(id)) return go('선수 보기', () => openPlayerModal(ctx.dataset, ctx.dataset.playerById.get(id), ctx));
  if (msg.kind === 'transfer.offer') return go('받은 제안 보기', () => ctx.navigate('transfers'));
  if (msg.kind === 'transfer.freeAgency') return go('이적 화면으로', () => ctx.navigate('transfers'));
  if ((msg.kind === 'transfer.faWon' || msg.kind === 'transfer.faLost') && id && ctx.dataset.playerById.get(id)) return go('선수 보기', () => openPlayerModal(ctx.dataset, ctx.dataset.playerById.get(id), ctx));
  if (msg.kind === 'transfer.rumor' && msg.vars?.mine && id && ctx.dataset.playerById.get(id)) return go('선수 보기', () => openPlayerModal(ctx.dataset, ctx.dataset.playerById.get(id), ctx));
  if (msg.kind === 'board.offer' || msg.kind === 'board.sacked') return go('경기 탭으로', () => ctx.navigate('match'));
  if (msg.kind === 'player.training') return go('훈련 탭으로', () => ctx.navigate('training'));
  return null;
}

export function render(ctx) {
  const host = h('div', { class: 'inbox-screen' }, h('p', { class: 'muted' }, '불러오는 중…'));
  loadNewsText().then((text) => {
    const draw = () => {
      const { game } = ctx;
      const all = game.inbox ?? [];
      const list = filter === 'all' ? all : all.filter((m) => groupOf(m.kind) === filter);
      const tabs = segmented([{ id: 'all', label: '전체' }, ...Object.entries(NEWS_GROUPS).map(([id, label]) => ({ id, label }))], filter, (id) => {
        filter = id;
        draw();
      }, { size: 'small' });
      const readAll = h('button', { class: 'btn small ghost', type: 'button', disabled: !unreadCount(game) || null }, '모두 읽음');
      readAll.addEventListener('click', () => {
        markRead(game);
        ctx.persist();
        ctx.refreshTopbar();
        draw();
      });
      const items = list.map((m) => {
        const t = renderNews(text, m);
        // 결산처럼 줄 목록이 있는 소식은 본문 아래에 목록으로
        const lines = Array.isArray(m.vars?.lines) ? h('ul', { class: 'digest-lines' }, m.vars.lines.map((l) => h('li', {}, l))) : null;
        const body = h('div', { class: 'news-body', hidden: true }, h('p', {}, t.body), lines, actionOf(ctx, m));
        const row = h(
          'li',
          { class: `news${m.read ? '' : ' unread'}${m.important ? ' important' : ''}` },
          h(
            'button',
            { type: 'button', class: 'news-head', 'aria-expanded': 'false' },
            h('span', { class: 'news-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'news-from muted' }, t.from),
            h('b', { class: 'news-title' }, t.title),
            h('span', { class: 'news-when muted' }, `${m.season}시즌 ${m.round}R`),
          ),
          body,
        );
        row.querySelector('.news-head').addEventListener('click', (e) => {
          const open = body.hidden;
          body.hidden = !open;
          e.currentTarget.setAttribute('aria-expanded', String(open));
          if (!m.read) {
            m.read = true;
            row.classList.remove('unread');
            ctx.persist();
            ctx.refreshTopbar();
          }
        });
        return row;
      });
      host.replaceChildren(
        panel(
          `받은 편지함${unreadCount(game) ? ` · 읽지 않음 ${unreadCount(game)}` : ''}`,
          h('div', { class: 'inbox' }, h('div', { class: 'inbox-tools' }, tabs.el, readAll), items.length ? h('ul', { class: 'news-list' }, items) : h('p', { class: 'muted empty' }, '소식이 없습니다.')),
        ),
      );
    };
    draw();
  });
  return host;
}
