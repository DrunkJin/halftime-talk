// 진입점: 데이터 로드 → 앱 시작
import { DataError, loadDataset } from './data/loader.js';
import { loadSlots } from './state/save.js';
import { createApp } from './ui/app.js';
import { h } from './ui/dom.js';

const root = document.getElementById('app');

try {
  const [dataset, slots] = await Promise.all([loadDataset(), loadSlots()]);
  createApp(root, dataset, slots);
} catch (err) {
  console.error(err);
  const details = err instanceof DataError ? err.details.slice(0, 20) : [];
  root.replaceChildren(
    h(
      'div',
      { class: 'boot-error panel' },
      h('h1', {}, '게임을 시작할 수 없습니다'),
      h('p', {}, err.message),
      details.length ? h('ul', {}, details.map((d) => h('li', {}, d))) : null,
      location.protocol === 'file:' ? h('p', { class: 'muted' }, '파일을 직접 열면 동작하지 않습니다. 프로젝트 폴더에서 python3 -m http.server 실행 후 http://localhost:8000 으로 여세요.') : null,
    ),
  );
}
