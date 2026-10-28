// 경기 엔진 테스트: 같은 두 팀으로 여러 경기를 돌려 결과 분포를 출력한다.
//
// 사용법
//   node tools/simulate-matches.mjs [홈팀ID] [원정팀ID] [옵션]
//   node tools/simulate-matches.mjs arsenal coventry-city --n 1000 --hf 4-4-2 --sample
//   node tools/simulate-matches.mjs --league            리그 전체 380경기 × n회 평균 (엔진 보정용)
//
// 옵션
//   --n <수>          경기 수 (기본 1000, --league에서는 시즌 반복 수 기본 5)
//   --seed <수>       시작 시드 (기본 1). i번째 경기는 seed + i
//   --hf / --af <포메이션>  홈/원정 포메이션. auto = 게임 AI처럼 팀별 최적 (기본: --league는 auto, 그 외 4-3-3)
//   --neutral         홈 어드밴티지 없음
//   --sample          첫 경기 중계 전체 출력
//   --comp <리그 id>   --league에서 돌릴 리그 (기본 epl, 예: k-league-1)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../js/data/loader.js';
import { AI_FORMATION_CANDIDATES, FORMATION_IDS, FORMATIONS } from '../js/engine/formations.js';
import { autoSelectBench, autoSelectLineup, bestFormation } from '../js/engine/lineup.js';
import { simulateMatch } from '../js/engine/match.js';
import { computeTeamRatings, overall } from '../js/engine/ratings.js';

// ── 인자 ──────────────────────────────────────────────

const VALUE_OPTIONS = new Set(['n', 'seed', 'hf', 'af', 'comp']);
const opts = {};
const positional = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) positional.push(arg);
  else if (VALUE_OPTIONS.has(arg.slice(2))) opts[arg.slice(2)] = argv[++i];
  else opts[arg.slice(2)] = true;
}

const LEAGUE = Boolean(opts.league);
const N = Number(opts.n ?? (LEAGUE ? 5 : 1000));
const SEED = Number(opts.seed ?? 1);
const HOME_FORMATION = opts.hf ?? (LEAGUE ? 'auto' : '4-3-3');
const AWAY_FORMATION = opts.af ?? (LEAGUE ? 'auto' : '4-3-3');
const NEUTRAL = Boolean(opts.neutral);
const SAMPLE = Boolean(opts.sample);

for (const f of [HOME_FORMATION, AWAY_FORMATION]) {
  if (f !== 'auto' && !FORMATIONS[f]) throw new Error(`알 수 없는 포메이션 ${f} (가능: ${FORMATION_IDS.join(', ')})`);
}

// ── 데이터 ────────────────────────────────────────────

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../data');
const ds = buildIndex(Object.fromEntries(['leagues', 'teams', 'nations', 'players'].map((n) => [n, JSON.parse(readFileSync(join(DATA_DIR, `${n}.json`), 'utf8'))])));
const comp = ds.leagueById.get(opts.comp ?? 'epl');
if (!comp) throw new Error(`리그 없음: ${opts.comp} (가능: ${ds.leagues.map((l) => l.id).join(', ')})`);
const teams = comp.teamIds.map((id) => ds.teamById.get(id));

function buildTeam(teamId, formation) {
  const team = ds.teamById.get(teamId);
  if (!team) throw new Error(`팀 없음: ${teamId}`);
  const squad = ds.squads.get(teamId);
  if (formation === 'auto') formation = bestFormation(squad, AI_FORMATION_CANDIDATES).formation;
  const lineup = autoSelectLineup(squad, formation);
  return { id: team.id, name: team.shortName, formation, lineup, bench: autoSelectBench(squad, lineup, 9) };
}

const homeAdvantage = NEUTRAL ? 0 : undefined;

// ── 출력 유틸 ─────────────────────────────────────────

const pct = (n, total) => `${((100 * n) / total).toFixed(1)}%`.padStart(6);
const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
const bar = (ratio, width = 30) => '█'.repeat(Math.round(ratio * width));
const fmt = (v, d = 2) => v.toFixed(d);

function summarize(results, label) {
  const n = results.length;
  const h = results.map((r) => r.score.home);
  const a = results.map((r) => r.score.away);
  const wins = results.filter((r) => r.score.home > r.score.away).length;
  const draws = results.filter((r) => r.score.home === r.score.away).length;
  const s = (side, key) => avg(results.map((r) => r.stats[side][key]));

  console.log(`\n결과 (${label})`);
  console.log(`  홈 승 ${pct(wins, n)}   무 ${pct(draws, n)}   원정 승 ${pct(n - wins - draws, n)}`);
  console.log(`  평균 득점   ${fmt(avg(h))} - ${fmt(avg(a))}   (경기당 ${fmt(avg(h) + avg(a))}골)`);
  console.log(`  슈팅        ${fmt(s('home', 'shots'), 1)} - ${fmt(s('away', 'shots'), 1)}`);
  console.log(`  유효슈팅    ${fmt(s('home', 'shotsOnTarget'), 1)} - ${fmt(s('away', 'shotsOnTarget'), 1)}`);
  console.log(`  점유율      ${fmt(s('home', 'possession'), 1)}% - ${fmt(s('away', 'possession'), 1)}%`);
  console.log(`  xG          ${fmt(s('home', 'xg'))} - ${fmt(s('away', 'xg'))}`);
  console.log(`  무득점 경기 ${pct(results.filter((r) => r.score.home + r.score.away === 0).length, n)}`);
  const perTeam = (fn) => avg(results.map((r) => fn(r))) / 2;
  console.log(
    `  팀당 경고 ${fmt(perTeam((r) => r.stats.home.yellow + r.stats.away.yellow))}장 · ` +
      `경기당 퇴장 ${fmt(avg(results.map((r) => r.stats.home.red + r.stats.away.red)))}장 · ` +
      `팀당 부상 ${fmt(perTeam((r) => r.injuries.length), 3)}건 (시즌 환산 ${fmt(perTeam((r) => r.injuries.length) * 38, 1)}건) · ` +
      `팀당 교체 ${fmt(perTeam((r) => r.subs.length), 1)}명`,
  );

  const scoreCounts = new Map();
  for (const r of results) {
    const key = `${r.score.home}-${r.score.away}`;
    scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
  }
  const topScores = [...scoreCounts].sort((x, y) => y[1] - x[1]).slice(0, 10);
  console.log('\n스코어 분포 (상위 10)');
  for (const [score, count] of topScores) console.log(`  ${score.padEnd(5)} ${pct(count, n)} ${bar(count / topScores[0][1])}`);

  const totals = new Array(8).fill(0);
  for (const r of results) totals[Math.min(7, r.score.home + r.score.away)]++;
  console.log('\n경기당 총 골 수');
  totals.forEach((count, goals) => console.log(`  ${goals === 7 ? '7+' : String(goals).padEnd(2)}   ${pct(count, n)} ${bar(count / Math.max(...totals))}`));
}

// divisor로 나눈 평균 골 (단일 매치업: 경기 수, 리그: 시즌 수)
function printScorers(results, { limit, divisor, unit }) {
  const scorers = new Map();
  for (const r of results) {
    for (const g of r.goals) {
      const key = `${g.scorerName} (${r.teams[g.team].name})`;
      scorers.set(key, (scorers.get(key) ?? 0) + 1);
    }
  }
  console.log(`\n득점자 상위 ${limit} (${unit} 평균 골)`);
  for (const [name, goals] of [...scorers].sort((x, y) => y[1] - x[1]).slice(0, limit)) {
    console.log(`  ${fmt(goals / divisor, unit === '시즌' ? 1 : 3).padStart(5)}  ${name}`);
  }
}

// 레이팅은 홈 어드밴티지 적용 전 값
function printTeam(team) {
  const slots = FORMATIONS[team.formation];
  const r = computeTeamRatings(team.formation, team.lineup);
  console.log(`\n${team.name} (${team.formation})  공격 ${fmt(r.attack, 1)}  중원 ${fmt(r.midfield, 1)}  수비 ${fmt(r.defense, 1)}  GK ${fmt(r.goalkeeping, 1)}`);
  console.log('  ' + team.lineup.map((p, i) => `${slots[i]} ${p.name}(${overall(p)}${p.position === slots[i] ? '' : `/${p.position}`})`).join(', '));
}

function printSample(result) {
  console.log(`\n── 샘플 경기 중계 (시드 ${result.seed}) ──`);
  for (const c of result.commentary) console.log(`  ${String(c.minute).padStart(2)}'  ${c.text}`);
  const { home, away } = result.stats;
  console.log(`  슈팅 ${home.shots}(${home.shotsOnTarget}) - ${away.shots}(${away.shotsOnTarget}), 점유율 ${home.possession}% - ${away.possession}%, xG ${home.xg} - ${away.xg}`);
}

// ── 실행 ──────────────────────────────────────────────

const started = performance.now();

if (LEAGUE) {
  // 리그 전체: 각 팀 4-3-3 자동 선발로 모든 홈/원정 조합을 N회
  const built = new Map(teams.map((t) => [t.id, buildTeam(t.id, HOME_FORMATION)]));
  const results = [];
  const points = new Map(teams.map((t) => [t.id, 0]));
  let seed = SEED;
  for (let round = 0; round < N; round++) {
    for (const h of teams) {
      for (const a of teams) {
        if (h.id === a.id) continue;
        const r = simulateMatch({ home: built.get(h.id), away: built.get(a.id), homeAdvantage, seed: seed++ });
        results.push(r);
        const [ph, pa] = r.score.home > r.score.away ? [3, 0] : r.score.home < r.score.away ? [0, 3] : [1, 1];
        points.set(h.id, points.get(h.id) + ph);
        points.set(a.id, points.get(a.id) + pa);
      }
    }
  }
  console.log(`${comp.name} 전체 ${results.length.toLocaleString()}경기 (${N}시즌, 시드 ${SEED}부터)`);
  summarize(results, '리그 전체');
  console.log('\n시즌 평균 승점');
  const ranked = [...points].sort((x, y) => y[1] - x[1]);
  for (const [id, pts] of ranked) {
    const t = built.get(id);
    const r = computeTeamRatings(t.formation, t.lineup);
    console.log(`  ${t.name.padEnd(14)} ${fmt(pts / N, 1).padStart(5)}점   공격 ${fmt(r.attack, 1)}  중원 ${fmt(r.midfield, 1)}  수비 ${fmt(r.defense, 1)}  GK ${fmt(r.goalkeeping, 1)}`);
  }
  printScorers(results, { limit: 10, divisor: N, unit: '시즌' });
} else {
  const [homeId = 'arsenal', awayId = 'manchester-city'] = positional;
  const home = buildTeam(homeId, HOME_FORMATION);
  const away = buildTeam(awayId, AWAY_FORMATION);
  const results = [];
  for (let i = 0; i < N; i++) results.push(simulateMatch({ home, away, homeAdvantage, seed: SEED + i }));

  console.log(`${home.name} vs ${away.name} — ${N.toLocaleString()}경기, 시드 ${SEED}~${SEED + N - 1}${NEUTRAL ? ', 중립 경기' : ''}`);
  printTeam(home);
  printTeam(away);
  summarize(results, `${home.name} 홈`);
  printScorers(results, { limit: 8, divisor: N, unit: '경기당' });
  if (SAMPLE) printSample(results[0]);
}

console.log(`\n(${((performance.now() - started) / 1000).toFixed(2)}초)`);
