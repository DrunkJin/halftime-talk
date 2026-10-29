// 코드에 남은 한국어 문자열 찾기 (다국어 작업용): node tools/find-hangul.mjs [파일...]
// 주석과 console 메시지는 빼고, 따옴표·백틱 안의 한글만 줄 번호와 함께 보여 준다
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = process.argv.slice(2).length ? process.argv.slice(2) : execSync('git ls-files js', { encoding: 'utf8' }).trim().split('\n');
let total = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, (m) => (/['"`][^'"`]*\/\//.test(line) ? m : '')); // 줄 끝 주석 제거 (문자열 안 // 는 대충 보존)
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /console\.(warn|error|log)/.test(line)) return;
    if (/(['"`])[^'"`]*[가-힣][^'"`]*\1|`[^`]*[가-힣]/.test(code)) hits.push(`${i + 1}: ${line.trim().slice(0, 140)}`);
  });
  if (hits.length) {
    total += hits.length;
    console.log(`\n${f} (${hits.length})`);
    for (const h of hits) console.log('  ' + h);
  }
}
console.log(`\n한국어 문자열 줄 ${total}개`);
