#!/usr/bin/env node
// Builds a static project album: picks one screenshot per repo, resizes it,
// verifies the GitHub Pages demo, and writes data.json + index.html.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = import.meta.dirname;
const IMG = path.join(OUT, 'img');
const OWNER = 'somphol';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TOKEN = process.env.GITHUB_TOKEN || '';

// Not published: github.com/somphol/<repo> returns 404, so the card would link nowhere.
// The album does not show itself.
const SKIP = new Set(['learncpp', 'project-album']);

// Finished builds that live outside ~/Projects but still belong in the album.
const EXTRA_REPOS = [path.join(ROOT, '..', 'bangkok-miniature')];

fs.mkdirSync(IMG, { recursive: true });

const sh = (c, o = {}) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });
const run = (bin, args) => { try { return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return e.stdout || ''; } };

// ---------- 1. repos ----------
// name -> directory; siblings of this repo first, then EXTRA_REPOS
const repoDirs = new Map();
// The GitHub slug can differ from the local folder name (e.g. aurelis-watch ->
// aurelis-calibre-07), and every link must use the slug or it 404s.
const slugOf = (url) => url.trim().replace(/\.git$/, '').split(/[/:]/).pop();
const addRepo = (dir) => {
  if (!fs.existsSync(path.join(dir, '.git'))) return;
  try {
    const url = sh(`git -C "${dir}" remote get-url origin`);
    if (url.includes('github.com')) repoDirs.set(slugOf(url), dir);
  } catch {}
};
for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (d.isDirectory()) addRepo(path.join(ROOT, d.name));
}
for (const dir of EXTRA_REPOS) addRepo(dir);
const repos = [...repoDirs.keys()].filter(n => !SKIP.has(n)).sort();

// ---------- 2. image candidates ----------
const dims = (file) => {
  const out = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  const w = +(out.match(/pixelWidth:\s*(\d+)/)?.[1] || 0);
  const h = +(out.match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
  return { w, h };
};

const rank = (base, w, h) => {
  let s = base;
  if (w >= 900) s -= 4;
  if (w < 500) s += 6;
  const ar = h ? w / h : 1;
  if (ar > 1.2 && ar < 2.4) s -= 3;         // landscape reads better on a slide
  if (ar < 0.9) s += 3;                      // portrait phone shots
  return s;
};

const baseScore = (name) => {
  const n = name.toLowerCase();
  if (/^screenshot\.(png|jpe?g|webp)$/.test(n)) return 0;
  if (/^(hero|cover|main)\./.test(n)) return 1;
  if (/^(preview|poster)\./.test(n)) return 2;
  if (/^(studio|stage|jade|scene|screen)\./.test(n)) return 3;
  if (/^screenshot-/.test(n)) return 4;
  if (/(og-card|social-card|og\.)/.test(n)) return 20;
  if (/(icon|logo|favicon|apple-touch)/.test(n)) return 60;
  return 8;
};

const IMG_OVERRIDE = {
  // the live page renders its WebGL canvas after the headless shot is taken
  'city-miniature': 'skills/city-miniature/docs/preview.png',
  // multiple same-ranked screenshots; pick the card that shows the studio
  'platewise-3d': 'assets/studio.png',
  // the catalog's live URL is raw JSON; this card is a curated contact sheet
  'opencode-skills': '@assets/opencode-skills.png',
};

const resolveOverride = (dir, value) =>
  value.startsWith('@') ? path.join(OUT, value.slice(1)) : path.join(dir, value);

function pickImage(dir, repo) {
  const forced = IMG_OVERRIDE[repo] && resolveOverride(dir, IMG_OVERRIDE[repo]);
  if (forced && fs.existsSync(forced)) {
    const { w, h } = dims(forced);
    return { file: forced, score: 0, w, h };
  }
  const files = run('find', [dir, '-maxdepth', '2', '-type', 'f', '(', '-iname', '*.png', '-o', '-iname', '*.jpg', '-o', '-iname', '*.jpeg', '-o', '-iname', '*.webp', ')']).trim().split('\n').filter(Boolean)
    .filter(f => !f.includes('/node_modules/') && !f.includes('/img/') && !f.includes('/.git/') && !f.includes('/skills/'));
  let best = null;
  for (const f of files) {
    const { w, h } = dims(f);
    if (w < 420 || h < 260) continue;
    const score = rank(baseScore(path.basename(f)), w, h);
    if (!best || score < best.score) best = { file: f, score, w, h };
  }
  return best;
}

// ---------- 3. metadata (cached GitHub API, README + git fallbacks) ----------
const CACHE_FILE = path.join(OUT, '.meta-cache.json');
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};

async function meta(repo) {
  if (cache[repo]) return cache[repo];
  let out = {};
  try {
    const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    });
    if (r.ok) {
      const j = await r.json();
      out = { description: j.description || '', homepage: j.homepage || '', lang: j.language || '', pushed: (j.pushed_at || '').slice(0, 10) };
    }
  } catch {}
  if (out.homepage === undefined) out.homepage = '';
  cache[repo] = out;
  return out;
}

function readmeDesc(dir) {
  for (const f of ['README.md', 'readme.md', 'README.MD', 'docs/README.md']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, 'utf8').split('\n');
    const lines = txt
      .filter(l => !l.startsWith('#') && !l.startsWith('|') && !l.trim().startsWith('<') && !l.trim().startsWith('!['))
      .map(l => l.replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>]/g, '').replace(/<[^>]+>/g, '')
        .replace(/^[-*+]\s+/, '').replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 45);
    if (lines.length) return lines[0].slice(0, 210);
  }
  return '';
}

const gitDate = (dir) => { try { return sh(`git -C "${dir}" log -1 --format=%cs`).trim(); } catch { return ''; } };

const LANG_EXT = { js: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', html: 'HTML', css: 'CSS', py: 'Python', cpp: 'C++', c: 'C', java: 'Java', rs: 'Rust', go: 'Go', sh: 'Shell' };
function gitLang(dir) {
  try {
    const files = sh(`git -C "${dir}" ls-files`).split('\n');
    const counts = {};
    for (const f of files) {
      const e = f.split('.').pop().toLowerCase();
      if (LANG_EXT[e]) counts[e] = (counts[e] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? LANG_EXT[top[0]] : '';
  } catch { return ''; }
}


async function demoOk(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (r.ok) return true;
      if (r.status === 404) return false;
    } catch {}
  }
  return false;
}

// ---------- 4. naming ----------
const OVERRIDES = {
  'bts-sukhumvit-line-3d': 'BTS Sukhumvit Line 3D',
  'us-map-jigsaw-3d': 'US Map Jigsaw 3D',
  'voa-newsroom-esl-studio': 'VOA Newsroom ESL Studio',
  'khan-trig-unit1-right-triangle-studio': 'Khan Trig · Unit 1 — Right Triangles',
  'khan-trig-unit2-trigonometric-functions-studio': 'Khan Trig · Unit 2 — Trigonometric Functions',
  'khan-trig-unit3-non-right-triangles-studio': 'Khan Trig · Unit 3 — Non-Right Triangles',
  'khan-trig-unit4-equations-identities-studio': 'Khan Trig · Unit 4 — Equations & Identities',
  '3d-trigonometry-master-booklet': '3D Trigonometry Master Booklet',
  'millionaire-race-2.5d': 'Millionaire Race 2.5D',
  'neon-horizon-2088': 'Neon Horizon 2088',
  'tramtracker-2088': 'TramTracker 2088',
  'nexus-2035-house-tour': 'Nexus 2035 House Tour',
  'opencode-skills': 'OpenCode Skills',
  'full-3d-15-puzzle-studio': 'Full 3D 15-Puzzle Studio',
  'full-3d-lucky-draw-studio': 'Full 3D Lucky Draw Studio',
  'full-3d-chess-academy': 'Full 3D Chess Academy',
  'leab-tui-3d': 'Leab-Tui 3D',
  'algorithm-explorer': 'Algorithm Explorer 3D',
  'calculus-explorer-3d': 'Calculus Explorer 3D',
  'calculus-explorer-3d-skill': 'Calculus Explorer 3D — Skill',
  'cute3d-animal-studio': 'Cute3D Animal Studio',
  'serenity-3d-studio': 'Serenity 3D Studio',
  'serenity-3d-studio-skill': 'Serenity 3D Studio — Skill',
  'suatsync-3d': 'SuatSync 3D',
  'vintage-wurlitzer-lullaby-jukebox': 'Vintage Wurlitzer Lullaby Jukebox',
  'vu_project_ideas': 'VU Project Ideas',
  'wanderlust-3d': 'Wanderlust 3D',
  'bangkok-miniature': 'Bangkok Miniature',
  'aperture-80': 'Aperture 80',
  'aurelis-calibre-07': 'Aurelis Calibre 07',
  'boss-battle-mplai': 'Boss Battle · ม.ปลาย',
  'boss-battle-tpat3': 'Boss Battle · TPAT3',
  'i-have-adhd-demo': 'i-have-adhd Demo',
  'platewise-3d': 'PlateWise 3D',
  'platewise-3d-skill': 'PlateWise 3D — Skill',
};
const LOWER = new Set(['and', 'of', 'the', 'de', 'to']);
const title = (id) => OVERRIDES[id] || id.split('-').map((w, i) => {
  if (/^\d/.test(w)) return w.toUpperCase();
  if (LOWER.has(w) && i) return w;
  return w[0].toUpperCase() + w.slice(1);
}).join(' ');

const TAGS = [
  [/khan-trig|trigonometry|booklet|learncpp|word-practice|gutenberg|voa|calculator|algorithm|calculus|boss-battle|adhd/, 'Learning'],
  [/chess|makruk|poker|holdem|leab|solitaire|klondike|rubik|puzzle|jigsaw|pong|flappy|race|millionaire|cyberdoom|snooker|playhouse|brickstep|boss-battle/, 'Game'],
  [/city|miniature|tour|house|wat-arun|bts|tram|ocean|sky|horizon|hearth|nexus|worldclock|wanderlust/, '3D World'],
  [/aperture|aurelis/, 'Anatomy'],
  [/platewise/, 'Health'],
  [/opencode|skills|tool|studio|suatsync|wurlitzer|jukebox|ideas/, 'Studio'],
];
const tagsFor = (repo, desc) => {
  const t = TAGS.filter(([re]) => re.test(repo)).map(([, n]) => n);
  return [...new Set(t)].slice(0, 2);
};

// ---------- 5. run ----------
const projects = [];
const log = [];

for (const repo of repos) {
  const dir = repoDirs.get(repo);
  const m = await meta(repo);
  const pages = `https://${OWNER}.github.io/${repo}/`;
  const imgOut = path.join(IMG, `${repo}.jpg`);

  // resolve the live demo first: github.io pages, else the repo's declared homepage
  let demo = pages;
  let ok = await demoOk(pages);
  if (!ok && m.homepage && /^https?:/.test(m.homepage)) {
    const alt = m.homepage.replace(/\/?$/, '/');
    if (alt !== pages && await demoOk(alt)) { demo = alt; ok = true; }
  }

  let picked = pickImage(dir, repo);
  let source = 'repo';

  // no local screenshot? capture the live page instead (and only if it is really live)
  if (!picked && ok) {
    const tmp = path.join(OUT, '.shot.png');
    run(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--enable-unsafe-swiftshader',
      '--window-size=1600,1000', '--virtual-time-budget=12000', `--screenshot=${tmp}`, demo]);
    if (fs.existsSync(tmp)) {
      run('sips', ['-Z', '1600', '--setProperty', 'format', 'jpeg', '--setProperty', 'formatOptions', '80', tmp, '--out', imgOut]);
      fs.unlinkSync(tmp);
      picked = { file: tmp }; source = 'live';
    }
  }

  if (picked && picked.file !== imgOut && source === 'repo') {
    run('sips', ['-Z', '1500', '--setProperty', 'format', 'jpeg', '--setProperty', 'formatOptions', '80', picked.file, '--out', imgOut]);
  }

  const hasImg = fs.existsSync(imgOut);
  const desc = (m.description || readmeDesc(dir) || 'A standalone interactive build.').replace(/\s+/g, ' ').slice(0, 220);

  projects.push({
    id: repo,
    name: title(repo),
    desc,
    tags: tagsFor(repo, desc),
    github: `https://github.com/${OWNER}/${repo}`,
    demo,
    demoLive: ok,
    homepage: m.homepage || '',
    lang: m.lang || gitLang(dir),
    pushed: m.pushed || gitDate(dir),
    image: hasImg ? `img/${repo}.jpg` : '',
    py: picked ? picked.w : 0,
  });
  log.push(`${repo.padEnd(46)} ${hasImg ? 'img' : 'NO-IMG'}  demo:${ok ? 'ok ' : '404'}`);
}

projects.sort((a, b) => (b.pushed || '').localeCompare(a.pushed || ''));
fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0));
fs.writeFileSync(path.join(OUT, 'data.json'), JSON.stringify(projects, null, 1));

const tpl = fs.readFileSync(path.join(OUT, 'template.html'), 'utf8');
fs.writeFileSync(path.join(OUT, 'index.html'), tpl.replace('/*__DATA__*/[]', JSON.stringify(projects)));

// tiny self-check: the generated page must contain every project
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const missing = projects.filter(p => !html.includes(p.github)).length;
const noImg = projects.filter(p => !p.image).length;
const dead = projects.filter(p => !p.demoLive).length;

console.log(log.join('\n'));
console.log(`\n${projects.length} projects | ${noImg} without image | ${dead} demo(s) not 200 | ${missing} missing from html`);
console.log('size:', (fs.statSync(path.join(OUT, 'index.html')).size / 1024).toFixed(1) + 'KB html,',
  (execSync(`du -sh "${IMG}"`, { encoding: 'utf8' }).split('\t')[0]) + ' images');
