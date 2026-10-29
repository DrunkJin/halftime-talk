// 이사회 메시지 문구 (data/board.json). 실패하면 null → 숫자만 보여준다
import { contentBase } from '../i18n.js';

let boardPromise = null;

export function loadBoardText(baseUrl = 'data/') {
  boardPromise ??= fetch(`${contentBase(baseUrl)}board.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return boardPromise;
}

