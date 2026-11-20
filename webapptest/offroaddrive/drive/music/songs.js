// Original heavy metal songs for the BGM (written for this app).
//
// Each bar is one string of space-separated steps (16 per bar, or 12 for a
// shuffle). Tokens:
//   E2      power chord on E2 (root, fifth, octave)   E2m  palm-muted chug
//   E2s     single note                               -    hold the previous note
//   .       silence
//   A4/B4   (lead) start on A4 and bend up to B4
//   E6~E4   (lead) whammy dive: slide from E6 down to E4 over the whole note
// Drum patterns are named in DRUMS; each line is one character per step:
//   k kick, s snare, h closed hat, o open hat, r ride, c crash,
//   t toms ('1' high, '2' mid, '3' floor); 'x' hit, 'X' accent.

export const DRUMS = {
  // --- 16 steps
  none: {},
  groove: { k: 'x..x..x.x.....x.', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
  groove2: { k: 'x.....x.x..x..x.', s: '....X.......X...', h: 'x.x.x.x.x.x.o.x.' },
  crashGroove: { k: 'x..x..x.x.....x.', s: '....X.......X...', h: '..x.x.x.x.x.x.x.', c: 'x...............' },
  chorus: { k: 'x.....x.x.....x.', s: '....X.......X...', r: 'x.x.x.x.x.x.x.x.', c: 'x...............' },
  chorus2: { k: 'x.....x.x..x..x.', s: '....X.......X...', r: 'x.x.x.x.x.x.x.x.' },
  half: { k: 'x.......x.x.....', s: '........X.......', h: 'x...x...x...x...', c: 'x...............' },
  build: { k: 'x...x...x...x...', s: '....x...x.x.xxxx', h: 'x...x...x...x...' },
  fill: { k: 'x.......x.......', s: '....X...x.x.....', t: '............1233' },
  fill2: { k: 'x.....x.........', s: '....X.....xx....', t: '........11..2233' },
  ballad: { k: 'x.......x.x.....', s: '........X.......', h: 'x.x.x.x.x.x.x.x.' },
  epic: { k: 'x.....x.x.....x.', s: '....X.......X...', r: 'x...x...x...x...', c: 'x...............' },
  epic2: { k: 'x.....x.x.....x.', s: '....X.......X...', r: 'x...x...x...x...' },
  hats: { h: 'x...x...x...x...' },
  end: { k: 'X...............', c: 'X...............' },
  // --- 12 steps (shuffle: three per beat)
  shuffle: { k: 'x.....x....x', s: '...X.....X..', h: 'x.xx.xx.xx.x' },
  shuffle2: { k: 'x....xx.....', s: '...X.....X..', h: 'x.xx.xx.xx.x' },
  shuffleCrash: { k: 'x.....x....x', s: '...X.....X..', h: '..xx.xx.xx.x', c: 'x...........' },
  chorus12: { k: 'x.....x....x', s: '...X.....X..', r: 'x.xx.xx.xx.x', c: 'x...........' },
  chorus12b: { k: 'x....xx.....', s: '...X.....X..', r: 'x.xx.xx.xx.x' },
  half12: { k: 'x.....x.....', s: '......X.....', h: 'x..x..x..x..', c: 'x...........' },
  fill12: { k: 'x...........', s: '...X..xx....', t: '........1233' },
  end12: { k: 'X...........', c: 'X...........' },
  // --- 16 steps, thrash (songs 4-6: fast tempos, the kick is short and tight there)
  skank: { k: 'x...x...x...x...', s: '..x...x...x...x.', h: 'x.x.x.x.x.x.x.x.' },
  skankCrash: { k: 'x...x...x...x...', s: '..x...x...x...x.', h: '..x.x.x.x.x.x.x.', c: 'x...............' },
  skankRide: { k: 'x...x...x...x...', s: '..x...x...x...x.', r: 'x.x.x.x.x.x.x.x.' },
  dbl: { k: 'xxxxxxxxxxxxxxxx', s: '....X.......X...', r: 'x...x...x...x...' },
  dblCrash: { k: 'xxxxxxxxxxxxxxxx', s: '....X.......X...', c: 'x.......x.......' },
  gallopK: { k: 'x.xxx.xxx.xxx.xx', s: '....X.......X...', h: 'x...x...x...x...' },
  gallopCrash: { k: 'x.xxx.xxx.xxx.xx', s: '....X.......X...', h: '....x...x...x...', c: 'x...............' },
  thHalf: { k: 'x..x..x...x.....', s: '........X.......', h: '....x...x...x...', c: 'x...............' },
  thHalf2: { k: 'x..x..x...x..x..', s: '........X.......', h: 'x...x...x...x...' },
  stabs: { k: 'x...x...x...x...', s: '............X...', c: 'x.......x.......' },
  roll: { k: 'x.......x.......', s: 'x.x.x.x.xxxxXXXX' },
  tomRun: { k: 'x...............', s: '....X...........', t: '........11223333' },
  tomBuild: { k: 'x.......x.......', t: '1...1...2...2.33' },
};

const r = (tok, n) => Array(n).fill(tok).join(' '); // the same token n times (tremolo picking)

// ---------------------------------------------------------------------------
// 1. 鉄の地平 — Iron Horizon. E minor, mid-tempo, a heavy swaggering groove.
const ironHorizon = (() => {
  const riffA = ['E2 - - E2m E2m . G2 - - E2m E2m . A2 - G2 -', 'E2 - - E2m E2m . D3s C3s B2s . E2m E2m Bb2 - A2 -'];
  const verse = ['E2m E2m . E2m E2m . G2 - E2m E2m . E2m E2m . A2 -', 'E2m E2m . E2m E2m . G2 - E2m E2m . F#2 - G2 - .'];
  const pre = ['C3 - - - - - - - D3 - - - - - - -', 'C3 - - - - - - - D3 - - - D3m D3m D3m D3m'];
  const chorus = ['E2 - - - - - - - - - - - E2m . E2m .', 'C3 - - - - - - - - - - - C3m . C3m .',
    'G2 - - - - - - - - - - - G2m . G2m .', 'D3 - - - - - - - D3 - - - B2 - - -'];
  const melody = ['B4 - - - - - - - G4 - A4 - B4 - - -', 'C5 - - - - - - - B4 - A4 - G4 - - -',
    'D5 - - - - - - - B4 - - - G4 - A4 -', 'A4 - - - - - - - F#4 - - - - - - -'];
  const solo = ['E5 - D5 - B4 - D5 - E5/G5 - - - - - E5 -', 'D5 - B4 - A4 - G4 - A4/B4 - - - - - . .',
    'G5 - - - E5 - D5 E5 G5 - A5 - G5 - E5 -', 'D5 E5 D5 B4 A4 G4 A4 B4 D5/E5 - - - - - . .',
    'B5 - - - - - A5 - G5 - E5 - D5 - E5 -', 'G5/A5 - - - - - - - E5 - D5 - B4 - . .',
    'E5 G5 A5 G5 E5 D5 B4 D5 E5 G5 A5 B5 A5 G5 E5 D5', 'E5/F#5 - - - - - - - - - - - . . . .'];
  return {
    title: '鉄の地平', en: 'Iron Horizon', bpm: 100, steps: 16, swing: 0.12,
    parts: [
      { gtr: riffA, drums: ['none', 'none'] },
      { gtr: riffA, drums: ['crashGroove', 'fill'] },
      { gtr: riffA, drums: ['groove', 'groove2'] },
      { gtr: [...verse, ...verse], drums: ['groove', 'groove', 'groove', 'fill'] },
      { gtr: pre, drums: ['half', 'build'] },
      { gtr: chorus, drums: ['chorus', 'chorus2', 'chorus2', 'fill2'], lead: melody },
      { gtr: riffA, drums: ['crashGroove', 'groove2'] },
      { gtr: [...verse, ...verse], drums: ['groove', 'groove', 'groove', 'fill'] },
      { gtr: pre, drums: ['half', 'build'] },
      { gtr: chorus, drums: ['chorus', 'chorus2', 'chorus2', 'fill2'], lead: melody },
      { gtr: [...riffA, ...riffA, ...riffA, ...riffA], drums: ['crashGroove', 'groove', 'groove', 'groove2', 'groove', 'groove', 'groove', 'fill'], lead: solo },
      { gtr: [...chorus, ...chorus], drums: ['chorus', 'chorus2', 'chorus2', 'chorus2', 'chorus', 'chorus2', 'chorus2', 'fill2'], lead: [...melody, ...melody] },
      { gtr: riffA, drums: ['crashGroove', 'fill'] },
      { gtr: ['E2 - - - - - - - - - - - - - - -'], drums: ['end'] },
    ],
  };
})();

// ---------------------------------------------------------------------------
// 2. 砂塵の悪魔 — Dust Devil. Drop D, a dirty blues shuffle.
const dustDevil = (() => {
  const riff = ['D2 - D2m F2s - G2s D2 - D2m C3s - A2s', 'D2 - D2m F2s - G2s Ab2s - G2s F2s - D2s'];
  const verse = ['D2 - - . . D2m D2 - - . D2m D2m', 'F2 - - . . F2m G2 - - . G2m G2m'];
  const chorus = ['G2 - - - - - A2 - - - - -', 'C3 - - - - - D3 - - D3m D3m D3m',
    'G2 - - - - - A2 - - - - -', 'Bb2 - - - - - C3 - - - A2 -'];
  const hook = ['D5 - - - - - C5 - - A4 - -', 'G4 - - - - - A4 - - - - -',
    'D5 - - - - - E5 - - F5 - -', 'D5 - - - - - C5 - - - - -'];
  const bridge = ['D2 - - - - - - - - - - -', 'Eb2 - - - - - - - - D2m D2m D2m'];
  const solo = ['A4/C5 - - A4 - G4 F4 - D4 - - .', 'D5 - - C5 - A4 C5 - D5 - - .',
    'F5/G5 - - F5 - D5 C5 - A4 - - -', 'G4 - Ab4 A4 - C5 D5 - - - . .',
    'D5 F5 G5 F5 D5 C5 A4 C5 D5 - - -', 'C5/D5 - - - - - A4 - G4 F4 - D4',
    'D5 - D5 F5 - D5 G5/A5 - - F5 - D5', 'D5/E5 - - - - - - - - . . .'];
  return {
    title: '砂塵の悪魔', en: 'Dust Devil', bpm: 88, steps: 12, swing: 0,
    parts: [
      { gtr: riff, drums: ['none', 'none'] },
      { gtr: [...riff, ...riff], drums: ['shuffleCrash', 'shuffle', 'shuffle', 'fill12'] },
      { gtr: [...verse, ...verse], drums: ['shuffle', 'shuffle2', 'shuffle', 'fill12'] },
      { gtr: riff, drums: ['shuffleCrash', 'shuffle2'] },
      { gtr: chorus, drums: ['chorus12', 'chorus12b', 'chorus12b', 'fill12'], lead: hook },
      { gtr: [...verse, ...verse], drums: ['shuffleCrash', 'shuffle2', 'shuffle', 'fill12'] },
      { gtr: chorus, drums: ['chorus12', 'chorus12b', 'chorus12b', 'fill12'], lead: hook },
      { gtr: [...bridge, ...bridge], drums: ['half12', 'half12', 'half12', 'fill12'] },
      { gtr: [...riff, ...riff, ...riff, ...riff], drums: ['shuffleCrash', 'shuffle', 'shuffle', 'shuffle2', 'shuffle', 'shuffle', 'shuffle2', 'fill12'], lead: solo },
      { gtr: [...chorus, ...chorus], drums: ['chorus12', 'chorus12b', 'chorus12b', 'chorus12b', 'chorus12', 'chorus12b', 'chorus12b', 'fill12'], lead: [...hook, ...hook] },
      { gtr: riff, drums: ['shuffleCrash', 'fill12'] },
      { gtr: ['D2 - - - - - - - - - - -'], drums: ['end12'] },
    ],
  };
})();

// ---------------------------------------------------------------------------
// 3. 長い下り坂 — Long Way Down. B minor, slow and wide, clean intro into a big theme.
const longWayDown = (() => {
  const clean = ['B3 - F#4 - B4 - D5 - F#4 - B4 - D5 - B4 -', 'G3 - D4 - G4 - B4 - D4 - G4 - B4 - G4 -',
    'D4 - A4 - D5 - F#5 - A4 - D5 - F#5 - D5 -', 'A3 - E4 - A4 - C#5 - E4 - A4 - C#5 - A4 -'];
  const heavy = ['B2 - - - - - - - - - - - B2m . B2m .', 'G2 - - - - - - - - - - - G2m . G2m .',
    'D3 - - - - - - - - - - - D3m . D3m .', 'A2 - - - - - - - - - - - A2m A2m B2 -'];
  const verse = ['B2m B2m . B2m D3 - B2m . E3 - D3 - B2m B2m A2 -', 'B2m B2m . B2m D3 - B2m . F#3s - E3s - D3s - C#3s -'];
  const theme = ['F#5 - - - - - E5 - D5 - - - C#5 - D5 -', 'B4 - - - - - - - - - - - D5 - E5 -',
    'F#5 - - - A5 - - - F#5 - E5 - D5 - - -', 'E5 - - - - - - - C#5 - - - - - - -'];
  const theme2 = ['F#5 - - - - - E5 - D5 - - - C#5 - D5 -', 'B4 - - - - - - - D5 - E5 - F#5 - G5 -',
    'A5 - - - - - G5 - F#5 - - - E5 - D5 -', 'E5/F#5 - - - - - - - - - - - - - - -'];
  return {
    title: '長い下り坂', en: 'Long Way Down', bpm: 70, steps: 16, swing: 0,
    parts: [
      { clean, drums: ['none', 'none', 'none', 'none'] },
      { clean, drums: ['hats', 'hats', 'hats', 'build'] },
      { gtr: heavy, drums: ['epic', 'epic2', 'epic2', 'fill'], lead: theme },
      { gtr: heavy, drums: ['epic', 'epic2', 'epic2', 'fill2'], lead: theme2 },
      { gtr: [...verse, ...verse], drums: ['ballad', 'ballad', 'ballad', 'fill'] },
      { gtr: heavy, drums: ['epic', 'epic2', 'epic2', 'fill'], lead: theme },
      { clean: clean.slice(0, 2), drums: ['none', 'hats'] },
      { gtr: heavy.slice(2), drums: ['half', 'build'] },
      { gtr: [...heavy, ...heavy], drums: ['epic', 'epic2', 'epic2', 'epic2', 'epic', 'epic2', 'epic2', 'fill2'], lead: [...theme, ...theme2] },
      { gtr: ['B2 - - - - - - - - - - - - - - -'], clean: ['B3 - F#4 - B4 - D5 - F#5 - - - - - - -'], drums: ['end'] },
    ],
  };
})();

// ---------------------------------------------------------------------------
// 4. 地獄の轍 — Hellbound Ruts. E, 224 BPM thrash: tremolo-picked riffs that
// creep up by semitones, the skank beat, a screaming chorus, a chaotic solo.
const hellboundRuts = (() => {
  const intro = r('E2m', 16), intro2 = `${r('E2m', 12)} F2 - E2 -`;
  const riffA = [`${r('E2m', 4)} F2s F2s ${r('E2m', 4)} G2s G2s F#2s F#2s F2s F2s`,
    `${r('E2m', 4)} F2s F2s ${r('E2m', 4)} Bb2s Bb2s A2s A2s G2s F2s`];
  const stabs = 'E2 - . E2m E2m . Bb2 - . A2 - . G2 - F2 -';
  const verse = ['E2m . E2m . E2m . F2 - E2m . E2m . Bb2 - A2 -', 'E2m . E2m . E2m . G2 - E2m . E2m . F#2 - F2 -'];
  const pre = ['Bb2 - - - - - - - A2 - - - - - - -', 'Bb2 - - - - - - - C3 - - - B2 - Bb2 -'];
  const chorus = ['E2 - - - - - - - G2 - - - F#2 - - -', 'F2 - - - - - - - E2 - - - E2m E2m E2m E2m',
    'E2 - - - - - - - C3 - - - B2 - - -', 'Bb2 - - - A2 - - - G2 - - - F2 - - -'];
  const hook = ['B4 - - - - - - - D5 - - - C5 - - -', 'C5 - - - - - - - B4 - - - - - - -',
    'G5 - - - - - - - E5 - - - F5 - - -', 'F5/G5 - - - E5 - - - D5 - - - E5~E4 - - -'];
  const breakdown = ['E2m . . E2m . . E2m . F2 - - - E2m . . .', 'E2m . . E2m . . E2m . Bb2 - - - A2 - G2 -'];
  const solo = ['E5 F5 G5 F5 E5 F5 G5 Bb5 A5 G5 F5 E5 F5 E5 D5 E5', 'Bb5/C6 - - - - - - - E6~E4 - - - - - - -',
    'B4 C5 D5 E5 F5 G5 A5 Bb5 B5 - A5 - G5 - F5 -', 'E5 - F5 - E5 - D5 - C5 - D5 - Bb4/C5 - - -',
    'E6 D6 B5 Bb5 A5 G5 F5 E5 F5 E5 D5 C5 B4 C5 D5 E5', 'F5/G5 - - - - - - - F5/G5 - - - E5 - - -',
    'E5 E6 E5 E6 F5 F6 F5 F6 G5 G6 G5 G6 Bb5 Bb6 A5 A6', 'E6~E3 - - - - - - - - - - - . . . .'];
  const A4 = [...riffA, ...riffA];
  const V8 = [...verse, ...verse, ...verse, ...verse];
  const chorusDrums = ['dblCrash', 'dbl', 'dbl', 'dbl', 'dblCrash', 'dbl', 'dbl', 'tomRun'];
  return {
    title: '地獄の轍', en: 'Hellbound Ruts', bpm: 224, steps: 16, swing: 0, style: 'thrash',
    parts: [
      { gtr: [intro, intro], drums: ['none', 'none'] },
      { gtr: [intro, intro2], drums: ['tomBuild', 'roll'] },
      { gtr: [...A4, ...A4], drums: ['dblCrash', 'dbl', 'dbl', 'dbl', 'skankCrash', 'skank', 'skank', 'roll'] },
      { gtr: [stabs, stabs], drums: ['stabs', 'stabs'] },
      { gtr: V8, drums: ['skankCrash', 'skank', 'skank', 'skank', 'skank', 'skank', 'skank', 'roll'] },
      { gtr: [...pre, ...pre], drums: ['thHalf', 'thHalf2', 'thHalf', 'roll'] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: A4, drums: ['skankCrash', 'skank', 'skank', 'roll'] },
      { gtr: V8, drums: ['skankCrash', 'skank', 'skank', 'skank', 'skank', 'skank', 'skank', 'roll'] },
      { gtr: [...pre, ...pre], drums: ['thHalf', 'thHalf2', 'thHalf', 'roll'] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: [...breakdown, ...breakdown, ...breakdown, ...breakdown], drums: ['thHalf', 'thHalf2', 'thHalf2', 'thHalf2', 'thHalf', 'thHalf2', 'thHalf2', 'roll'] },
      { gtr: [...A4, ...A4], drums: ['dblCrash', 'dbl', 'skank', 'skank', 'dblCrash', 'dbl', 'skank', 'roll'], lead: solo },
      { gtr: [...A4, ...A4], drums: ['skankCrash', 'skank', 'skank', 'skank', 'dblCrash', 'dbl', 'dbl', 'roll'], lead: [...solo.slice(4), ...solo.slice(0, 4)] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: [stabs, stabs, stabs, 'E2 - . E2m E2m . Bb2 - - - - - - - - -'], drums: ['stabs', 'stabs', 'stabs', 'roll'] },
      { gtr: ['E2 - - - - - - - - - - - - - - -'], drums: ['end'] },
    ],
  };
})();

// ---------------------------------------------------------------------------
// 5. 黒い嵐 — Black Tempest. E, 200 BPM: galloping riffs, tritone hits,
// tremolo-picked single-note lines low on the neck, a heavy half-time middle.
const blackTempest = (() => {
  const gallop = ['E2m - E2m E2m E2m - E2m E2m G2 - E2m E2m Bb2 - A2 -', 'E2m - E2m E2m E2m - E2m E2m C3 - B2 - Bb2 - F2 -'];
  const tritone = ['E2 - - . E2 - - . Bb2 - - . Bb2 - A2 -', 'E2 - - . E2 - - . C3 - B2 - Bb2 - F2 -'];
  const verse = [`${r('E2s', 4)} ${r('F2s', 4)} ${r('G2s', 4)} ${r('F2s', 4)}`, `${r('E2s', 4)} ${r('F2s', 4)} ${r('Bb2s', 4)} ${r('A2s', 4)}`];
  const pre = ['C3 - - - - - - - Bb2 - - - - - - -', 'C3 - - - - - - - D3 - - - D3m D3m D3m D3m'];
  const chorus = ['E2 - - - - - - - D3 - - - - - - -', 'C3 - - - - - - - B2 - - - Bb2 - - -',
    'E2 - - - - - - - G2 - - - A2 - - -', 'Bb2 - - - - - - - B2 - - - B2m B2m B2m B2m'];
  const hook = ['E5 - - - D5 - - - E5 - - - G5 - - -', 'F5 - - - - - - - E5 - - - D5 - - -',
    'E5 - - - D5 - - - E5 - - - B5 - - -', 'Bb5/B5 - - - - - - - - - - - A5 - G5 -'];
  const middle = ['E2 - - - - - E2m E2m F2 - - - - - E2m E2m', 'E2 - - - - - E2m E2m Bb2 - - - A2 - - -'];
  const solo = ['B4 - E5 - B4 - F5 - B4 - G5 - B4 - Bb5 -', 'A5 - G5 - F5 - E5 - F5/G5 - - - - - - -',
    'E6 C6 A5 E5 F6 C6 A5 F5 E6 C6 A5 E5 F6 D6 B5 F5', 'E6/F6 - - - - - - - E6~B4 - - - - - - -',
    'E5 F5 E5 F5 E5 F5 E5 F5 G5 A5 G5 A5 Bb5 B5 Bb5 B5', 'C6 - B5 - Bb5 - A5 - G5 - F5 - E5 - F5 -',
    'G5 F5 E5 F5 G5 A5 Bb5 A5 G5 F5 E5 D5 E5 F5 G5 A5', 'B5/C6 - - - - - - - - - - - E6~E4 - - -'];
  const G4 = [...gallop, ...gallop];
  const V8 = [...verse, ...verse, ...verse, ...verse];
  const chorusDrums = ['skankCrash', 'skankRide', 'skankRide', 'skankRide', 'dblCrash', 'dbl', 'dbl', 'roll'];
  return {
    title: '黒い嵐', en: 'Black Tempest', bpm: 200, steps: 16, swing: 0, style: 'thrash',
    parts: [
      { gtr: tritone, drums: ['stabs', 'stabs'] },
      { gtr: tritone, drums: ['stabs', 'roll'] },
      { gtr: [...G4, ...G4], drums: ['gallopCrash', 'gallopK', 'gallopK', 'gallopK', 'gallopCrash', 'gallopK', 'gallopK', 'roll'] },
      { gtr: V8, drums: ['dblCrash', 'dbl', 'dbl', 'dbl', 'skankCrash', 'skank', 'skank', 'roll'] },
      { gtr: [...pre, ...pre], drums: ['thHalf', 'thHalf2', 'thHalf', 'roll'] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: G4, drums: ['gallopCrash', 'gallopK', 'gallopK', 'roll'] },
      { gtr: V8, drums: ['dblCrash', 'dbl', 'dbl', 'dbl', 'skankCrash', 'skank', 'skank', 'roll'] },
      { gtr: [...pre, ...pre], drums: ['thHalf', 'thHalf2', 'thHalf', 'roll'] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: [...middle, ...middle, ...middle, ...middle], drums: ['thHalf', 'thHalf2', 'thHalf2', 'thHalf2', 'thHalf', 'thHalf2', 'thHalf2', 'tomRun'] },
      { gtr: [...G4, ...G4], drums: ['gallopCrash', 'gallopK', 'gallopK', 'gallopK', 'dblCrash', 'dbl', 'dbl', 'roll'], lead: solo },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: [...tritone, ...tritone], drums: ['stabs', 'stabs', 'stabs', 'roll'] },
      { gtr: ['E2 - - - - - - - - - - - - - - -'], drums: ['end'] },
    ],
  };
})();

// ---------------------------------------------------------------------------
// 6. 灰の聖域 — Ashen Sanctum. E, 184 BPM: an ominous clean intro, a slow
// crushing theme, then flat out: a pedal-note riff, a big chorus, a long solo.
const ashenSanctum = (() => {
  const clean = ['E3 - B3 - E4 - F4 - E4 - B3 - G3 - Bb3 -', 'E3 - B3 - E4 - G4 - F4 - E4 - Bb3 - B3 -'];
  const doom = ['E2 - - - - - - - F2 - - - - - - -', 'G2 - - - - - - - F#2 - - - F2 - - -'];
  const omen = ['B4 - - - - - - - C5 - - - - - - -', 'D5 - - - - - - - C5 - - - B4 - Bb4 -'];
  const fast = ['E2m E2m G2s E2m E2m Bb2s E2m E2m A2s E2m E2m G2s E2m E2m F2s F#2s',
    'E2m E2m G2s E2m E2m Bb2s E2m E2m C3s E2m E2m B2s Bb2s A2s G2s F2s'];
  const verse = ['E2m . E2m E2m . E2m F2 - E2m . E2m E2m . E2m G2 F#2', 'E2m . E2m E2m . E2m Bb2 - E2m . E2m E2m . E2m A2 G2'];
  const chorus = ['G2 - - - - - - - A2 - - - - - - -', 'Bb2 - - - - - - - A2 - - - G2 - F2 -',
    'G2 - - - - - - - A2 - - - - - - -', 'C3 - - - B2 - - - Bb2 - - - B2m B2m B2m B2m'];
  const hook = ['D5 - - - - - - - E5 - - - - - - -', 'F5 - - - - - - - E5 - - - D5 - C5 -',
    'D5 - - - - - - - E5 - - - G5 - - -', 'F5/G5 - - - - - - - E5 - - - - - - -'];
  const solo = ['E5 G5 B5 E6 B5 G5 E5 G5 B5 E6 B5 G5 F5 Bb5 D6 F6', 'E6 - - - D6 - - - Bb5/C6 - - - - - - -',
    'B5 Bb5 A5 G5 F5 E5 F5 G5 A5 Bb5 B5 C6 B5 Bb5 A5 G5', 'F5/G5 - - - - - F5 - E5 - - - . . . .',
    'E6 E5 E6 E5 F6 F5 F6 F5 G6 G5 G6 G5 Bb6 Bb5 B6 B5', 'B6~B4 - - - - - - - - - - - B5 - Bb5 -',
    'E5 - F5 - G5 - A5 - Bb5 - A5 - G5 - F5 -', 'E5/F5 - - - - - - - - - - - - - - -'];
  const F4 = [...fast, ...fast];
  const V8 = [...verse, ...verse, ...verse, ...verse];
  const chorusDrums = ['dblCrash', 'dbl', 'dbl', 'dbl', 'skankCrash', 'skankRide', 'skankRide', 'roll'];
  return {
    title: '灰の聖域', en: 'Ashen Sanctum', bpm: 184, steps: 16, swing: 0, style: 'thrash',
    parts: [
      { clean: [...clean, ...clean], drums: ['none', 'none', 'none', 'none'] },
      { clean: [...clean, ...clean], drums: ['hats', 'hats', 'hats', 'tomBuild'] },
      { gtr: [...doom, ...doom], drums: ['thHalf', 'thHalf2', 'thHalf', 'thHalf2'], lead: [...omen, ...omen] },
      { gtr: [...doom, r('E2m', 16), r('E2m', 16)], drums: ['thHalf', 'thHalf2', 'roll', 'roll'], lead: omen },
      { gtr: [...F4, ...F4], drums: ['dblCrash', 'dbl', 'dbl', 'dbl', 'skankCrash', 'skank', 'skank', 'roll'] },
      { gtr: V8, drums: ['skankCrash', 'skank', 'skank', 'skank', 'skank', 'skank', 'skank', 'roll'] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: F4, drums: ['dblCrash', 'dbl', 'dbl', 'roll'] },
      { gtr: V8, drums: ['skankCrash', 'skank', 'skank', 'skank', 'skank', 'skank', 'skank', 'roll'] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: [...doom, ...doom], clean: [...clean, ...clean], drums: ['thHalf', 'thHalf2', 'thHalf', 'tomRun'] },
      { gtr: [...F4, ...F4], drums: ['dblCrash', 'dbl', 'skank', 'skank', 'dblCrash', 'dbl', 'skank', 'roll'], lead: solo },
      { gtr: [...F4, ...F4], drums: ['skankCrash', 'skank', 'skank', 'skank', 'dblCrash', 'dbl', 'dbl', 'roll'], lead: [...solo.slice(4), ...solo.slice(0, 4)] },
      { gtr: [...chorus, ...chorus], drums: chorusDrums, lead: [...hook, ...hook] },
      { gtr: F4, drums: ['dblCrash', 'dbl', 'dbl', 'roll'] },
      { gtr: ['E2 - - - - - - - - - - - - - - -'], clean: ['E4 - B3 - G3 - E3 - - - - - - - - -'], drums: ['end'] },
    ],
  };
})();

export const SONGS = [ironHorizon, dustDevil, longWayDown, hellboundRuts, blackTempest, ashenSanctum];
