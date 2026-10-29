// 진입점: 데이터 로드 → 앱 시작
import { DataError, loadDataset } from './data/loader.js';
import { detectLang, loadLang, t } from './i18n.js';
import { loadSlots } from './state/save.js';
import { warmUp } from './state/simulation.js';
import { createApp } from './ui/app.js';
import { h } from './ui/dom.js';

const root = document.getElementById('app');
const wanted = detectLang();
const langReady = loadLang(wanted);

// 사전을 못 불러온 경우(파일로 직접 연 경우 등)에도 부팅 오류는 읽을 수 있게 둔 최소 문구
const BOOT_FALLBACK = {
  ko: {
    'app.boot.errorTitle': '게임을 시작할 수 없습니다',
    'app.boot.fileProtocol': '파일을 직접 열면 동작하지 않습니다. 프로젝트 폴더에서 python3 -m http.server 실행 후 http://localhost:8000 으로 여세요.',
  },
  en: {
    'app.boot.errorTitle': 'The game could not start',
    'app.boot.fileProtocol': 'Opening the file directly does not work. Run python3 -m http.server in the project folder, then open http://localhost:8000.',
  },
};
const bootText = (key) => {
  const s = t(key);
  return s === key ? (BOOT_FALLBACK[wanted] ?? BOOT_FALLBACK.en)[key] : s;
};

try {
  const [dataset, slots, lang] = await Promise.all([loadDataset(), loadSlots(), langReady]);
  document.documentElement.lang = lang;
  createApp(root, dataset, slots);
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500)))(warmUp);
} catch (err) {
  console.error(err);
  // 데이터가 먼저 실패해도 사전 로드는 끝까지 기다린 뒤 그린다
  await langReady.catch(() => {});
  const details = err instanceof DataError ? err.details.slice(0, 20) : [];
  root.replaceChildren(
    h(
      'div',
      { class: 'boot-error panel' },
      h('h1', {}, bootText('app.boot.errorTitle')),
      h('p', {}, err.message),
      details.length ? h('ul', {}, details.map((d) => h('li', {}, d))) : null,
      location.protocol === 'file:' ? h('p', { class: 'muted' }, bootText('app.boot.fileProtocol')) : null,
    ),
  );
}
