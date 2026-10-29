// 방문 통계 (Umami, index.html에서 불러온다). 스크립트가 막혀 있거나 아직 안 왔으면 조용히 넘어간다
export function track(name, data) {
  try {
    window.umami?.track(name, data);
  } catch {
    // 통계 실패는 게임에 영향을 주지 않는다
  }
}
