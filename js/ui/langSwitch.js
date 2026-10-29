// 언어 전환: 고르면 저장하고 다시 불러온다 (사전·문구 데이터를 처음부터 그 언어로 읽도록)
import { LANGS, getLang, rememberLang, t } from '../i18n.js';
import { segmented } from './components.js';
import { h } from './dom.js';

export function langSwitch() {
  const tabs = segmented(
    Object.entries(LANGS).map(([id, label]) => ({ id, label })),
    getLang(),
    (id) => {
      if (id === getLang()) return;
      rememberLang(id);
      const url = new URL(location.href);
      url.searchParams.delete('lang'); // 주소의 ?lang=이 저장한 선택을 덮지 않게
      location.replace(url.href);
    },
    { size: 'small' },
  );
  return h('div', { class: 'lang-switch', title: t('lang.reload') }, h('span', { class: 'muted' }, t('lang.label')), tabs.el);
}
