// Rocketworks pixel art, as code (pxl: https://github.com/crsolver/claude-pxl, MIT).
// Original art for the game: interface icons, mission patches, crew portraits and in-world
// signage. Build with `npm run art`; the PNGs land in public/art/ and are committed, so the game
// never needs pxl at runtime. No real agency logos or insignia.

// Interface palette (matches src/styles/global.css) plus planet, skin and hair tones.
pal({
  k: '#0b0f14', // background ink
  K: '#1b2430', // panel
  d: '#2b3440', // line
  D: '#3d4856', // strong line
  s: '#6f7c8a', // steel, dark
  S: '#a9b4bf', // steel
  w: '#e8edf2', // white
  a: '#f0a830', // accent amber
  A: '#a8701c', // amber, dark
  y: '#f0c030', // warning yellow
  r: '#ff6b5b', // red
  R: '#a83a32', // red, dark
  g: '#3ddc84', // go green
  G: '#1f8a52', // green, dark
  b: '#3a7bd5', // blue
  B: '#1d4f8c', // blue, dark
  c: '#7fd4ff', // cyan
  m: '#b9bec4', // moon
  M: '#6d7379', // moon, dark
  o: '#d96a32', // mars
  O: '#8f3f1e', // mars, dark
  f: '#ffe1a6', // flame, light
  1: '#f2c9a0', // skin tones
  2: '#d9a066',
  3: '#a8693c',
  4: '#6b4226',
  5: '#1c1a1a', // hair
  6: '#5a3a22',
  7: '#c9a15a',
  8: '#8d8f93',
});
pal({ F: '#fff6e0' }); // highlight
ramps('kKdDsSw', 'AaF', 'RrF', 'GgF', 'BbcF', 'MmF', 'OoF', '4321');

// ---------------------------------------------------------------- logo and favicon

// 8x8 brand mark: a stainless ship with an amber flame (shown 2x beside the wordmark).
sprite(
  'logo',
  { mx: 'c' },
  `
  ...w
  ..wS
  ..SS
  ..Sb
  ..SS
  .sSS
  .s.a
  ...f`,
);

// 16x16 favicon: the same ship over a dark tile.
sprite('favicon', { w: 16, h: 16 }, rect(0, 0, 16, 16, 'K'), box(0, 0, 16, 16, 'd'), (c) => {
  const ship = [
    '......ww......',
    '.....wSSw.....',
    '.....SSSS.....',
    '.....SbbS.....',
    '.....SSSS.....',
    '.....SSSS.....',
    '.....SSsS.....',
    '....sSSsSs....',
    '...ss.SS.ss...',
    '......aa......',
    '.....afFa.....',
    '......aa......',
  ];
  ship.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && c.px(x + 1, y + 2, ch)));
});

// ---------------------------------------------------------------- location icons (8x8)

sprite(
  'loc_factory',
  `
  ...ss...
  ..sSSs..
  .sSSSSs.
  sSSSSSSs
  SSaSSaSS
  SSSddSSS
  SSSddSSS
  ssskkkss`,
);

sprite(
  'loc_mission_control',
  `
  dddddddd
  dKgKKcKd
  dKKgKKKd
  dKcKgKKd
  dddddddd
  ...dd...
  .SSSSSS.
  .ssssss.`,
);

sprite(
  'loc_launch_pad',
  `
  s...w...
  s..wSw..
  s..SSS..
  sssSbS..
  s..SSS..
  s..SSS..
  s.sSSSs.
  yyyaaayy`,
);

sprite(
  'loc_flight',
  `
  ..cccc..
  .c....c.
  c..bb..w
  c.bggb.w
  c.bgbb.c
  c..bb..c
  .c....c.
  ..cccc..`,
);

sprite(
  'loc_station',
  `
  bb....bb
  bB.SS.Bb
  bB.SS.Bb
  sssSSsss
  bB.SS.Bb
  bB.SS.Bb
  bb.ss.bb
  ........`,
);

// Planets are lit from the upper left: the lower-right side steps one shade darker.
const terminator = (x, y) => x + y > 8;
sprite(
  'loc_moon',
  `
  ..mmmm..
  .mmMmmm.
  mmmmmMmm
  mMmmmmmm
  mmmmMmmm
  mmMmmmmm
  .mmmmMm.
  ..mmmm..`,
  shade(terminator),
);

sprite(
  'loc_mars',
  `
  ..owwo..
  .oooooo.
  ooOoooOo
  oooooooo
  oOoooOoo
  oooOoooo
  .ooooOo.
  ..oooo..`,
  shade(terminator),
);

// ---------------------------------------------------------------- mission patches (23x23)

// Every patch: a dark disc, the artwork clipped inside it, an amber rim.
function patch(name, ...items) {
  sprite(
    name,
    { w: 23, h: 23 },
    circ(11, 11, 11, 'K'),
    clip([11, 11, 10], ...items),
    ring(11, 11, 11, 'a'),
  );
}
// A small ship (5 tall), nose up, at x, y (top).
const ship = (x, y, flame = true) => [
  px(x, y, 'w'),
  vline(x, y + 1, 3, 'S'),
  px(x - 1, y + 3, 's'),
  px(x + 1, y + 3, 's'),
  ...(flame ? [px(x, y + 4, 'a')] : []),
];
// The dark side of a disc (centre cx, cy, radius r) away from a light in the upper left.
const nightSide = (cx, cy, r, edge) => (x, y) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r && x - cx + (y - cy) > edge;
// Stars, placed by hand so they never land on the art.
const stars = (...pts) => pts.map(([x, y]) => px(x, y, 'D'));

patch(
  'patch_test-flight',
  ...stars([5, 5], [17, 6], [14, 3]),
  circ(11, 40, 24, 'B'),
  circ(11, 41, 24, 'G'),
  (c) => {
    for (let x = 4; x <= 18; x += 2)
      c.px(x, Math.round(16 - 12 * (1 - ((x - 11) / 7.5) ** 2)), 'y');
  },
  ...ship(7, 7),
);

patch(
  'patch_orbital-flight',
  ...stars([4, 7], [18, 5], [16, 18]),
  ellipse(11, 11, 9, 4, 'c', true),
  circ(11, 11, 5, 'b'),
  px(9, 9, 'g'),
  px(10, 9, 'g'),
  px(12, 12, 'g'),
  px(13, 13, 'g'),
  shade(nightSide(11, 11, 5, 2)),
  px(20, 11, 'w'),
  px(19, 11, 'a'),
);

patch(
  'patch_station-docking',
  ...stars([6, 18], [17, 18], [11, 2]),
  hline(3, 9, 17, 's'),
  rect(3, 5, 3, 9, 'b'),
  rect(17, 5, 3, 9, 'b'),
  vline(4, 5, 9, 'B'),
  vline(18, 5, 9, 'B'),
  rect(9, 7, 5, 5, 'S'),
  px(11, 12, 's'),
  ...ship(11, 14),
);

patch(
  'patch_lunar-transfer',
  ...stars([10, 3], [12, 19], [3, 9]),
  ellipse(11, 11, 8, 5, 'c', true),
  circ(5, 12, 3, 'b'),
  px(4, 11, 'g'),
  shade(nightSide(5, 12, 3, 1)),
  circ(17, 10, 2, 'm'),
  px(18, 11, 'M'),
  px(11, 6, 'w'),
);

patch(
  'patch_lunar-landing',
  circ(5, 5, 2, 'b'),
  px(4, 4, 'g'),
  ...stars([15, 3], [19, 8]),
  circ(11, 34, 20, 'm'),
  px(5, 17, 'M'),
  px(6, 17, 'M'),
  px(16, 18, 'M'),
  px(14, 20, 'M'),
  rect(10, 7, 3, 7, 'S'),
  px(11, 6, 'w'),
  vline(10, 7, 7, 's'),
  px(9, 14, 's'),
  px(13, 14, 's'),
  px(8, 15, 's'),
  px(14, 15, 's'),
);

patch(
  'patch_mars-cargo',
  ...stars([4, 6], [18, 4]),
  circ(11, 15, 8, 'o'),
  px(8, 13, 'O'),
  px(13, 17, 'O'),
  px(10, 19, 'O'),
  px(7, 9, 'w'),
  px(8, 9, 'w'),
  shade(nightSide(11, 15, 8, 3)),
  ellipse(15, 4, 3, 1, 'w'),
  px(13, 5, 'S'),
  px(17, 5, 'S'),
  rect(14, 6, 3, 3, 'a'),
  px(15, 7, 'A'),
);

patch(
  'patch_mars-crewed',
  circ(17, 5, 1, 'b'),
  ...stars([4, 4], [9, 2], [13, 8]),
  circ(11, 34, 20, 'o'),
  px(4, 16, 'O'),
  px(17, 18, 'O'),
  px(12, 20, 'O'),
  rect(9, 6, 3, 9, 'S'),
  px(10, 5, 'w'),
  vline(9, 6, 9, 's'),
  px(8, 15, 's'),
  px(12, 15, 's'),
  vline(14, 14, 2, 'w'),
  vline(16, 14, 2, 'w'),
  px(14, 13, 'a'),
  px(16, 13, 'a'),
);

// Contract kinds.
patch(
  'patch_satellite',
  ...stars([5, 5], [17, 4], [11, 3]),
  circ(11, 38, 20, 'b'),
  circ(11, 39, 20, 'B'),
  rect(10, 8, 3, 4, 'a'),
  px(11, 7, 'S'),
  rect(4, 9, 5, 2, 'b'),
  rect(14, 9, 5, 2, 'b'),
  hline(9, 10, 1, 's'),
  hline(13, 10, 1, 's'),
);

patch(
  'patch_resupply',
  ...stars([4, 14], [18, 15]),
  hline(4, 6, 15, 's'),
  rect(4, 3, 2, 7, 'b'),
  rect(17, 3, 2, 7, 'b'),
  rect(9, 4, 5, 4, 'S'),
  rect(8, 12, 7, 5, 'a'),
  box(8, 12, 7, 5, 'A'),
  line(8, 12, 14, 16, 'A'),
  vline(11, 9, 3, 'D'),
);

patch(
  'patch_crew-rotation',
  ...stars([5, 4], [17, 5]),
  circ(7, 11, 4, 'w'),
  rect(5, 10, 5, 3, 'a'),
  px(6, 10, 'f'),
  circ(15, 11, 4, 'w'),
  rect(13, 10, 5, 3, 'a'),
  px(14, 10, 'f'),
  rect(3, 16, 9, 4, 'S'),
  rect(11, 16, 9, 4, 'S'),
  px(7, 17, 'b'),
  px(15, 17, 'g'),
);

patch(
  'patch_lunar-depot',
  ...stars([4, 6], [17, 3]),
  circ(11, 34, 20, 'm'),
  px(6, 17, 'M'),
  px(15, 18, 'M'),
  rect(8, 5, 7, 9, 'S'),
  rect(8, 8, 7, 2, 'a'),
  vline(8, 5, 9, 's'),
  px(7, 14, 's'),
  px(15, 14, 's'),
  px(11, 4, 'S'),
);

patch(
  'patch_mars-tanker',
  ...stars([4, 4], [18, 6]),
  circ(11, 34, 20, 'o'),
  px(6, 17, 'O'),
  px(16, 19, 'O'),
  rect(7, 6, 9, 7, 'S'),
  rect(7, 8, 9, 2, 'r'),
  vline(7, 6, 7, 's'),
  px(11, 5, 'S'),
  px(6, 13, 's'),
  px(16, 13, 's'),
);

// ---------------------------------------------------------------- crew portraits (16x16)

// A helmeted astronaut, shoulders and the role stripe. Keys swapped per crew member:
// 1 skin, 5 hair, a role stripe.
sprite(
  '_crew_short',
  { w: 16, h: 16 },
  rect(0, 0, 16, 16, 'K'),
  circ(7, 8, 6, 'w'),
  circ(8, 8, 6, 'w'),
  ring(7, 8, 6, 'S'),
  ring(8, 8, 6, 'S'),
  rect(5, 5, 6, 7, '1'),
  rect(4, 6, 8, 5, '1'),
  rect(5, 4, 6, 2, '5'),
  px(4, 5, '5'),
  px(11, 5, '5'),
  px(6, 8, 'k'),
  px(9, 8, 'k'),
  px(7, 10, '3'),
  px(8, 10, '3'),
  rect(1, 13, 14, 3, 'w'),
  rect(5, 13, 6, 1, 'S'),
  rect(2, 14, 3, 1, 'a'),
  rect(11, 14, 3, 1, 'a'),
  shade((x, y) => x > 11 && (x - 8) ** 2 + (y - 8) ** 2 <= 42 && y < 13),
);
sprite(
  '_crew_long',
  { base: '_crew_short' },
  vline(4, 6, 6, '5'),
  vline(11, 6, 6, '5'),
  px(4, 5, '5'),
  px(11, 5, '5'),
);

const crew = {
  okafor: ['_crew_short', { 1: '4', 3: '5', a: 'a' }],
  lindqvist: ['_crew_short', { 1: '1', 5: '7', a: 'b' }],
  raman: ['_crew_long', { 1: '3', 3: '4', a: 'g' }],
  sato: ['_crew_short', { 1: '2', a: 'c' }],
  voss: ['_crew_long', { 1: '1', 5: '6', a: 'b' }],
  adeyemi: ['_crew_short', { 1: '4', 3: '5', 5: '8', a: 'a' }],
  alvarez: ['_crew_short', { 1: '2', 5: '6', a: 'g' }],
};
for (const [id, [base, swap]] of Object.entries(crew)) sprite('crew_' + id, { base, swap });

// ---------------------------------------------------------------- factory signage

// Hazard stripes on a band, at x, y, w, h.
const hazard = (x, y, w, h) => (c) => {
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++) c.px(x + i, y + j, ((i + j) >> 1) % 2 ? 'k' : 'y');
};

sprite(
  'sign_bay',
  { w: 64, h: 16 },
  rect(0, 0, 64, 16, 'K'),
  box(0, 0, 64, 16, 'D'),
  hazard(1, 1, 62, 2),
  hazard(1, 13, 62, 2),
  text(32, 5, 'ASSEMBLY BAY 1', 'a', { align: 'c', shadow: 'k' }),
);

sprite(
  'poster_safety',
  { w: 40, h: 56 },
  rect(0, 0, 40, 56, 'y'),
  hazard(0, 0, 40, 3),
  hazard(0, 53, 40, 3),
  rect(3, 5, 34, 46, 'K'),
  // Hard hat.
  clip([6, 9, 28, 11], circ(20, 21, 11, 'a')),
  rect(7, 20, 26, 2, 'A'),
  vline(20, 10, 10, 'f'),
  light([15, 13, 4]),
  text(20, 27, 'SAFETY\nFIRST', 'w', { align: 'c', lead: 2 }),
  text(20, 43, 'HARD HAT', 'y', { align: 'c' }),
);

sprite(
  'poster_moon',
  { w: 40, h: 56 },
  rect(0, 0, 40, 56, 'k'),
  grad(0, 9, 40, 38, 'kKB', 'v'),
  ...[
    [5, 14],
    [34, 11],
    [27, 35],
    [7, 39],
    [13, 10],
    [31, 24],
  ].map(([x, y]) => px(x, y, 'S')),
  circ(26, 19, 8, 'm'),
  px(23, 15, 'M'),
  px(28, 21, 'M'),
  px(25, 24, 'M'),
  px(30, 17, 'M'),
  shade(nightSide(26, 19, 8, 3)),
  rect(11, 24, 3, 13, 'S'),
  px(12, 23, 'w'),
  vline(11, 24, 13, 's'),
  px(10, 35, 's'),
  px(14, 35, 's'),
  line(12, 37, 12, 42, 'a', 2),
  px(12, 43, 'f'),
  rect(0, 0, 40, 9, 'K'),
  text(20, 2, 'NEXT STOP', 'a', { align: 'c' }),
  rect(0, 47, 40, 9, 'K'),
  text(20, 49, 'THE MOON', 'w', { align: 'c' }),
);

sprite(
  'poster_mars',
  { w: 40, h: 56 },
  rect(0, 0, 40, 56, 'k'),
  grad(0, 13, 40, 30, 'kKO', 'v'),
  ...[
    [6, 15],
    [33, 12],
    [30, 34],
    [5, 36],
    [18, 15],
  ].map(([x, y]) => px(x, y, 'S')),
  circ(20, 27, 11, 'o'),
  px(15, 23, 'O'),
  px(23, 30, 'O'),
  px(16, 33, 'O'),
  px(25, 22, 'O'),
  rect(17, 17, 6, 2, 'w'),
  shade(nightSide(20, 27, 11, 4)),
  rect(0, 0, 40, 13, 'K'),
  text(20, 2, 'MARS', 'a', { align: 'c', scale: 2 }),
  rect(0, 41, 40, 15, 'K'),
  text(20, 43, 'THE LONG\nHAUL', 'w', { align: 'c', lead: 2 }),
);

sprite(
  'banner_rocketworks',
  { w: 16, h: 100 },
  rect(0, 0, 16, 100, 'K'),
  box(0, 0, 16, 100, 'D'),
  rect(1, 1, 14, 2, 'a'),
  rect(1, 97, 14, 2, 'a'),
  stamp('logo', 5, 6),
  (c) =>
    [...'ROCKETWORKS'].forEach((ch, i) =>
      c.text(8, 18 + i * 7, ch, i < 6 ? 'w' : 'a', { align: 'c' }),
    ),
);
