// 경기 끝 장면의 수석코치 한마디 고르기: 인터뷰와 같은 골 흐름(goalStory)을 먼저 보고, 내용(xG)과 전력 예상은 그다음
// → 사전 키 match.after.verdict.{win|draw|loss}.{이야기}
import { goalStory } from './interviews.js';

// gap: 경기 전 전력 차(우리 - 상대), xgDiff: 우리 xG - 상대 xG
export function verdictKey({ goals, mySide, mine, theirs, xgDiff, gap }) {
  const outcome = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
  const story = goalStory(goals, mySide, outcome);
  const expect = gap > 3 ? 'fav' : gap < -3 ? 'dog' : 'even';
  const margin = Math.abs(mine - theirs);
  let key;
  // 이야기와 내용이 엇갈리면 둘을 합친 문장: 결정력으로 이긴 대승, 앞섰지만 내용은 밀린 무승부, 따라붙었지만 내용은 앞선 무승부
  if (outcome === 'win') {
    key = story.trailed ? 'comeback' : margin >= 3 ? (xgDiff <= 0 ? 'bigClinical' : 'big') : xgDiff <= -0.6 ? 'lucky' : margin === 1 ? 'narrow' : expect;
  } else if (outcome === 'draw') {
    key =
      story.drawType === 'caughtUp' ? (xgDiff <= -0.6 ? 'caughtUpOutplayed' : 'caughtUp')
      : story.drawType === 'cameBack' ? (xgDiff >= 0.6 ? 'cameBackDominant' : 'cameBack')
      : xgDiff >= 0.8 ? 'dominant' : xgDiff <= -0.8 ? 'survived' : expect;
  } else {
    key = story.led ? 'collapse' : xgDiff >= 0.6 ? 'unlucky' : xgDiff <= -0.6 || margin >= 3 ? 'outplayed' : expect;
  }
  return `${outcome}.${key}`;
}
