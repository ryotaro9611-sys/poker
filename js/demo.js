// デモ用の架空データ（実データとは別のメモリ上にのみ存在する）

const DEMO_SOURCE = 'デモ用の架空固定値';

const TRIPS = [
  { id: 'demo-trip-a', name: '米国テスト', startDate: '2026-04-01', endDate: '2026-04-07', expenses: 6000 },
  { id: 'demo-trip-b', name: 'アジアテスト', startDate: '2026-05-01', endDate: '2026-05-08', expenses: 30000 },
];

// [遠征, プレイ日, 店舗, 通貨, SB, BB, バイイン, 回収, 別払いタイムレーキ, 時間, 1通貨あたりの円]
const ROWS = [
  ['a', '2026-04-01', 'Club A', 'USD', 2, 5, 500, 750, 10, 5, 150],
  ['a', '2026-04-02', 'Club A', 'USD', 2, 5, 500, 400, 0, 2, 150],
  ['a', '2026-04-04', 'Club B', 'USD', 5, 10, 1000, 1300, 20, 4, 149],
  ['a', '2026-04-07', 'Club B', 'USD', 2, 5, 500, 500, 0, 3, 151],
  ['b', '2026-05-01', 'Room C', 'PHP', 100, 200, 20000, 22000, 0, 4, 2.5],
  ['b', '2026-05-03', 'Room C', 'PHP', 200, 400, 40000, 37000, 0, 3, 2.6],
  ['b', '2026-05-06', 'Room D', 'KRW', 1000, 2000, 200000, 320000, 0, 5, 0.11],
  ['b', '2026-05-08', 'Room E', 'JPY', 100, 200, 20000, 18000, 0, 2, 1],
];

export function buildDemoDb(emptyDb) {
  const db = emptyDb();
  const t0 = Date.UTC(2026, 3, 1);
  db.trips = TRIPS.map((t, i) => ({ ...t, note: '', createdAt: t0 + i, updatedAt: t0 + i }));
  db.sessions = ROWS.map((r, i) => ({
    id: `demo-s${i + 1}`,
    tripId: `demo-trip-${r[0]}`,
    date: r[1],
    location: r[2],
    currency: r[3],
    sb: r[4],
    bb: r[5],
    buyin: r[6],
    cashout: r[7],
    timeRake: r[8],
    minutes: r[9] * 60,
    rate: r[3] === 'JPY' ? null : { value: r[10], date: r[1], source: DEMO_SOURCE, manual: false, demo: true },
    note: '',
    createdAt: t0 + 100 + i,
    updatedAt: t0 + 100 + i,
  }));
  return db;
}
