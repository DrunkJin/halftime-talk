// 받은 편지함: 이사회·선수·이적·리그·경기 소식 (state/inbox.js, 문구 data/news.json)
import { NEWS_GROUPS, groupOf, markRead, unreadCount } from '../../state/inbox.js';
import { loadNewsText, renderNews } from '../../media/newsText.js';
import { openPlayerModal, panel, segmented } from '../components.js';
import { h } from '../dom.js';
import { t } from '../../i18n.js';

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
  if (msg.kind.startsWith('player.') && id && ctx.dataset.playerById.get(id)) return go(t('inbox.action.player'), () => openPlayerModal(ctx.dataset, ctx.dataset.playerById.get(id), ctx));
  if (msg.kind === 'transfer.offer') return go(t('inbox.action.offers'), () => ctx.navigate('transfers'));
  if (msg.kind === 'transfer.freeAgency') return go(t('inbox.action.transfers'), () => ctx.navigate('transfers'));
  if ((msg.kind === 'transfer.faWon' || msg.kind === 'transfer.faLost') && id && ctx.dataset.playerById.get(id)) return go(t('inbox.action.player'), () => openPlayerModal(ctx.dataset, ctx.dataset.playerById.get(id), ctx));
  if (msg.kind === 'transfer.rumor' && msg.vars?.mine && id && ctx.dataset.playerById.get(id)) return go(t('inbox.action.player'), () => openPlayerModal(ctx.dataset, ctx.dataset.playerById.get(id), ctx));
  if (msg.kind === 'board.offer' || msg.kind === 'board.sacked') return go(t('inbox.action.match'), () => ctx.navigate('match'));
  if (msg.kind === 'player.training') return go(t('inbox.action.training'), () => ctx.navigate('training'));
  return null;
}

export function render(ctx) {
  const host = h('div', { class: 'inbox-screen' }, h('p', { class: 'muted' }, t('inbox.loading')));
  loadNewsText().then((text) => {
    const draw = () => {
      const { game } = ctx;
      const all = game.inbox ?? [];
      const list = filter === 'all' ? all : all.filter((m) => groupOf(m.kind) === filter);
      const tabs = segmented([{ id: 'all', label: t('inbox.filter.all') }, ...Object.entries(NEWS_GROUPS).map(([id, label]) => ({ id, label }))], filter, (id) => {
        filter = id;
        draw();
      }, { size: 'small' });
      const readAll = h('button', { class: 'btn small ghost', type: 'button', disabled: !unreadCount(game) || null }, t('inbox.markAllRead'));
      readAll.addEventListener('click', () => {
        markRead(game);
        ctx.persist();
        ctx.refreshTopbar();
        draw();
      });
      const items = list.map((m) => {
        const nt = renderNews(text, m);
        // 결산처럼 줄 목록이 있는 소식은 본문 아래에 목록으로 (줄은 문자열 또는 { key, vars })
        const lines = Array.isArray(m.vars?.lines) ? h('ul', { class: 'digest-lines' }, m.vars.lines.map((l) => h('li', {}, typeof l === 'string' ? l : t(l.key, l.vars)))) : null;
        const body = h('div', { class: 'news-body', hidden: true }, h('p', {}, nt.body), lines, actionOf(ctx, m));
        const row = h(
          'li',
          { class: `news${m.read ? '' : ' unread'}${m.important ? ' important' : ''}` },
          h(
            'button',
            { type: 'button', class: 'news-head', 'aria-expanded': 'false' },
            h('span', { class: 'news-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'news-from muted' }, nt.from),
            h('b', { class: 'news-title' }, nt.title),
            h('span', { class: 'news-when muted' }, t('inbox.when', { season: m.season, round: m.round })),
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
          unreadCount(game) ? t('inbox.titleUnread', { n: unreadCount(game) }) : t('inbox.title'),
          h('div', { class: 'inbox' }, h('div', { class: 'inbox-tools' }, tabs.el, readAll), items.length ? h('ul', { class: 'news-list' }, items) : h('p', { class: 'muted empty' }, t('inbox.empty'))),
        ),
      );
    };
    draw();
  });
  return host;
}
