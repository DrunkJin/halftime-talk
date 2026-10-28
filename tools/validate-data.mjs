// data/*.json 이 스키마(js/data/schema.js)에 맞는지 검사한다. 데이터를 손으로 교체한 뒤, 또는 merge.py가 마지막에 실행.
// 사용법: node tools/validate-data.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../js/data/schema.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data');
const readJson = (name) => JSON.parse(readFileSync(join(DATA_DIR, `${name}.json`), 'utf8'));

const dataset = Object.fromEntries(['leagues', 'teams', 'nations', 'players'].map((name) => [name, readJson(name)]));
const { errors, warnings } = validateDataset(dataset);

const SHOW = 20;
for (const w of warnings.slice(0, SHOW)) console.warn(`경고 ${w}`);
if (warnings.length > SHOW) console.warn(`경고 ${warnings.length - SHOW}건 더 있음`);
for (const e of errors.slice(0, 50)) console.error(`오류 ${e}`);

const { players } = dataset.players;
console.log(
  `리그 ${dataset.leagues.leagues.length}개, ${dataset.teams.teams.length}팀, 선수 ${players.length}명 — ` +
    `오류 ${errors.length}건, 경고 ${warnings.length}건`,
);
process.exit(errors.length > 0 ? 1 : 0);
