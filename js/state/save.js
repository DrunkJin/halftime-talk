// IndexedDB 세이브 슬롯 (1~3). 브라우저가 막으면 저장 없이 진행한다.
const DB_NAME = 'pitchside-manager';
const STORE = 'saves';
export const SLOT_COUNT = 3;
const keyOf = (slot) => `slot${slot}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req?.result);
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function saveGame(game) {
  // 함수·순환 참조가 없는 순수 데이터만 저장되도록 JSON 왕복
  const data = JSON.parse(JSON.stringify(game));
  data.savedAt = new Date().toISOString();
  await run('readwrite', (store) => store.put(data, keyOf(game.slot)));
}

// 슬롯 전체: [{ slot, game | null }]
export async function loadSlots() {
  const slots = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    try {
      slots.push({ slot, game: (await run('readonly', (store) => store.get(keyOf(slot)))) ?? null });
    } catch (err) {
      console.warn('세이브를 불러오지 못했습니다', err);
      slots.push({ slot, game: null });
    }
  }
  // 슬롯 도입 전 세이브(키 'current')는 형식이 달라 정리
  run('readwrite', (store) => store.delete('current')).catch(() => {});
  return slots;
}

export async function deleteSave(slot) {
  await run('readwrite', (store) => store.delete(keyOf(slot)));
}
