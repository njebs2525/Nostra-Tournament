'use strict';

/* ==========================================================================
   La Cosa Nostra – Pool Championship
   ========================================================================== */

/* ---------- Constants ---------- */

const STORAGE_KEY = 'lcn-tournament-v1';
const LEGACY_STORAGE_KEY = 'lcn-tournament-demo-v2'; // read once so existing data isn't lost
const DEFAULT_PAGE = 'dashboard';
const DEFAULT_DIVISION = 'men';
const SIDES = ['a', 'b'];

const DIVISIONS = {
  men: {
    label: "Men's",
    championTitle: 'KING OF THE FAMILY',
    samplePlayers: ['Njabulo', 'Milton', 'Molapo', 'Thabo', 'Sipho', 'Kabelo', 'Sizwe', 'Mandla'],
  },
  ladies: {
    label: "Ladies'",
    championTitle: 'QUEEN OF THE FAMILY',
    samplePlayers: ['Ayenziwe', 'Lerato', 'Nandi', 'Zanele', 'Nomsa', 'Palesa', 'Thandi', 'Lebo'],
  },
};

/* ---------- Helpers ---------- */

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const disabledIf = condition => (condition ? 'disabled' : '');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = 'none'), 2500);
}

/* ---------- State & storage ---------- */

const createDivision = key => ({
  players: DIVISIONS[key].samplePlayers.map((name, i) => ({ id: `${key}-${i}`, name })),
  rounds: [],
  created: false,
  format: 'race', // 'race' = Race to N, 'best' = Best of N
  race: 2, // the number entered for the chosen format (default for any round without its own setting)
  roundFormats: {}, // per-round overrides, keyed by rounds back from the final (0 = Final, 1 = Semi-finals, ...)
  prize1: 5000,
  prize2: 3000,
  byes: [], // ids of players who skip the first round (set when the bracket is generated)
  prelim: false, // true when round 0 is a preliminary round (player count is not a power of two)
  draft: null, // previewed draw, kept until it is generated
  byesRecorded: false, // byes are counted into byeHistory once, when play starts
  byeHistory: {}, // player name -> byes received in earlier tournaments (rotates byes fairly)
});

const createState = () => ({
  active: DEFAULT_DIVISION,
  divisions: { men: createDivision('men'), ladies: createDivision('ladies') },
});

const isValidState = saved =>
  Object.keys(DIVISIONS).every(key => Array.isArray(saved?.divisions?.[key]?.players));

function loadState() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (isValidState(saved)) {
        if (!Object.hasOwn(DIVISIONS, saved.active)) saved.active = DEFAULT_DIVISION;
        Object.values(saved.divisions).forEach(div => {
          // older saves
          div.format ??= 'race';
          div.roundFormats ??= {};
          div.byes ??= [];
          div.prelim ??= false;
          div.draft ??= null;
          div.byesRecorded ??= !!div.created; // a bracket already in progress is not counted again
          div.byeHistory ??= {};
        });
        return saved;
      }
    } catch {
      /* ignore corrupt data and try the next key */
    }
  }
  return createState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('Could not save – browser storage is unavailable');
  }
  if (canPush()) pushState();
}

let state = loadState();
let page = DEFAULT_PAGE;

/* ---------- Selectors for the active division ---------- */

const division = () => state.divisions[state.active];
const label = () => DIVISIONS[state.active].label;
const championTitle = () => DIVISIONS[state.active].championTitle;

const playerName = id => division().players.find(p => p.id === id)?.name ?? 'Awaiting player';
const champion = () => division().rounds.at(-1)?.[0]?.winner ?? null;

function stats() {
  const matches = division().rounds.flat();
  return {
    players: division().players.length,
    matches: matches.length,
    done: matches.filter(m => m.winner).length,
  };
}

/* Match format is set per round. Rounds are counted back from the final
   (0 = Final, 1 = Semi-finals, ...) so a round keeps its format even if the
   player count (and so the number of rounds) changes. A round with no setting
   uses the division default (div.format / div.race).
   "Race to N" needs N racks; "Best of N" needs more than half of N. */
const roundCount = div =>
  div.created ? div.rounds.length : Math.max(1, Math.ceil(Math.log2(Math.max(div.players.length, 2))));
const roundFormat = (div, r) =>
  div.roundFormats?.[roundCount(div) - 1 - r] ?? { format: div.format, race: div.race };
const targetFor = ({ format, race }) => (format === 'best' ? Math.ceil(race / 2) : race);
const racksToWin = (div, r) => targetFor(roundFormat(div, r));
const formatText = (div, r) => {
  const { format, race } = roundFormat(div, r);
  return `${format === 'best' ? 'Best of' : 'Race to'} ${race}`;
};
const formatSummary = div => {
  const texts = new Set(Array.from({ length: roundCount(div) }, (_, r) => formatText(div, r)));
  return texts.size === 1 ? [...texts][0] : 'Varies by round';
};

/* Rounds are named by how many players are left in them. When the player count
   is not a power of two, round 0 is a Preliminary Round that only the players
   without a bye play in. */
function roundName(index, total, prelim = false) {
  if (prelim && index === 0) return 'Preliminary Round';
  const fromEnd = total - index;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semi-finals';
  if (fromEnd === 3) return 'Quarter-finals';
  return `Round of ${2 ** fromEnd}`;
}

const isPowerOfTwo = n => n > 0 && (n & (n - 1)) === 0;
const nameKey = name => String(name).trim().toLowerCase().replace(/[.$#[\]/]/g, '_'); // safe as a database key
const rosterKey = div => div.players.map(p => p.id).sort().join('|');
const hasPrelim = div =>
  div.created ? !!div.prelim : div.players.length > 2 && !isPowerOfTwo(div.players.length);
const roundLabel = (div, r) => roundName(r, roundCount(div), hasPrelim(div));

/* Play has started once any real match has a rack or a result. (Old brackets
   auto-completed one-sided "bye matches"; those do not count.) */
const isStarted = div => div.rounds.some(round => round.some(m => m.sa || m.sb || (m.winner && m.a && m.b)));

/* Players who skipped the first round. Old brackets stored byes as one-sided matches. */
const byeIdsOf = div =>
  div.byes?.length ? div.byes : (div.rounds[0] ?? []).filter(m => m.a && !m.b).map(m => m.a);

/* The structure for a given player count: a preliminary round only as large as
   needed to cut the field to a power of two, then a normal knockout. */
function planRows(count) {
  if (count < 2) return [];
  const size = 2 ** Math.floor(Math.log2(count));
  const extra = count - size; // preliminary matches
  const total = Math.log2(size) + (extra ? 1 : 0);
  const rows = [];
  if (extra) rows.push({ name: roundName(0, total, true), matches: extra, byes: count - 2 * extra });
  for (let n = size; n >= 2; n /= 2) {
    rows.push({ name: roundName(rows.length, total, extra > 0), matches: n / 2, byes: 0 });
  }
  return rows;
}

/* ---------- Bracket logic ---------- */

const emptyMatch = (round, index) => ({
  id: `r${round}m${index}`,
  a: null,
  b: null,
  sa: 0,
  sb: 0,
  winner: null,
});

function shuffle(list) {
  const items = [...list];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/* Each match knows where its winner goes (match.next). Old saved brackets have no
   such link and use the classic "match i feeds match i/2" rule. */
function advanceWinner(rounds, roundIndex, matchIndex, winnerId) {
  const match = rounds[roundIndex]?.[matchIndex];
  const link =
    match && match.next !== undefined
      ? match.next
      : { m: Math.floor(matchIndex / 2), side: matchIndex % 2 === 0 ? 'a' : 'b' };
  const target = link && rounds[roundIndex + 1]?.[link.m];
  if (target) target[link.side] = winnerId;
}

/* 0..n-1 in bit-reversed order (n a power of two): spreads items across the bracket. */
function spreadOrder(n) {
  const bits = Math.log2(n);
  return Array.from({ length: n }, (_, i) => {
    let out = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) out |= 1 << (bits - 1 - b);
    return out;
  });
}

/* Adaptive single-elimination draw for ANY player count (2 or more).
   size = the largest power of two that fits (e.g. 16 for 24 players).
   Players beyond that play a Preliminary Round (count - size matches); everyone
   else gets a bye straight into the next round. A power-of-two field has no byes.
   Byes go to the players with the fewest byes in earlier tournaments (ties random). */
function buildBracket(players, history = {}) {
  const count = players.length;
  const size = 2 ** Math.floor(Math.log2(count));
  const prelimMatches = count - size;
  const byeCount = prelimMatches ? count - 2 * prelimMatches : 0;

  const shuffled = shuffle(players);
  const byeIds = [...shuffled]
    .sort((x, y) => (history[nameKey(x.name)] || 0) - (history[nameKey(y.name)] || 0))
    .slice(0, byeCount)
    .map(p => p.id);
  const playing = shuffled.filter(p => !byeIds.includes(p.id)).map(p => p.id);

  const rounds = [
    Array.from({ length: prelimMatches || size / 2 }, (_, i) =>
      Object.assign(emptyMatch(0, i), { a: playing[2 * i], b: playing[2 * i + 1] })
    ),
  ];
  for (let n = prelimMatches ? size / 2 : size / 4, r = 1; n >= 1; n /= 2, r++) {
    rounds.push(Array.from({ length: n }, (_, i) => emptyMatch(r, i)));
  }

  const mainStart = prelimMatches ? 1 : 0;
  rounds.forEach((round, r) =>
    round.forEach((match, i) => {
      if (r === rounds.length - 1) match.next = null;
      else if (r >= mainStart) match.next = { m: Math.floor(i / 2), side: i % 2 ? 'b' : 'a' };
    })
  );

  if (prelimMatches) {
    // Slots in the first main round, spread so winners are not bunched together:
    // first one slot per match, then the second slot where more are needed.
    const order = spreadOrder(size / 2);
    const slots = [...order.map(m => ({ m, side: 'a' })), ...order.map(m => ({ m, side: 'b' }))];
    rounds[0].forEach((match, i) => (match.next = slots[i]));
    shuffle(byeIds).forEach((id, i) => {
      const slot = slots[prelimMatches + i];
      rounds[1][slot.m][slot.side] = id;
    });
  }

  return { rounds, byes: byeIds, prelim: prelimMatches > 0 };
}

/* Counts the byes once, when play starts, so the next tournament rotates them. */
function recordByes(div) {
  if (div.byesRecorded) return;
  div.byesRecorded = true;
  div.byes.forEach(id => {
    const player = div.players.find(p => p.id === id);
    if (player) div.byeHistory[nameKey(player.name)] = (div.byeHistory[nameKey(player.name)] || 0) + 1;
  });
}

/* Drops the current/previewed draw (used when the roster changes before play starts). */
function clearDraw(div) {
  if (!div.created && !div.draft) return false;
  Object.assign(div, { rounds: [], created: false, byes: [], prelim: false, draft: null, byesRecorded: false });
  return true;
}

function previewDraw() {
  const div = division();
  if (isStarted(div)) return toast('The tournament has started - the draw is locked');
  if (div.players.length < 2) return toast('Add at least 2 players');
  div.draft = { ...buildBracket(div.players, div.byeHistory), key: rosterKey(div) };
  save();
  render();
  toast('Draw previewed - nothing is final until you generate');
}

function generateBracket() {
  const div = division();
  if (isStarted(div)) return toast('The tournament has started - the draw is locked');
  if (div.players.length < 2) return toast('Add at least 2 players');
  if (div.created && !confirm('Regenerate this bracket? The current draw will be replaced by a new random draw.')) return;

  const draw = div.draft?.key === rosterKey(div) ? div.draft : buildBracket(div.players, div.byeHistory);
  Object.assign(div, {
    rounds: draw.rounds,
    byes: draw.byes,
    prelim: draw.prelim,
    created: true,
    byesRecorded: false,
    draft: null,
  });
  save();
  render();
  toast(`${label()} bracket generated`);
}

function newTournament() {
  const div = division();
  if (!confirm(`Start a new ${label().toLowerCase()} tournament? The current bracket and scores are cleared; players are kept.`)) return;
  Object.assign(div, { rounds: [], created: false, byes: [], prelim: false, draft: null, byesRecorded: false });
  save();
  render();
  toast('Ready for a new draw');
}

function addRack(roundIndex, matchIndex, side) {
  const div = division();
  const match = div.rounds[roundIndex]?.[matchIndex];
  if (!match || match.winner || !match.a || !match.b) return;

  if (!isStarted(div)) recordByes(div);
  match['s' + side]++;
  if (match['s' + side] >= racksToWin(div, roundIndex)) {
    match.winner = match[side];
    advanceWinner(div.rounds, roundIndex, matchIndex, match.winner);
    toast(`${playerName(match.winner)} advances!`);
  }
  save();
  render();
}

function removeRack(roundIndex, matchIndex, side) {
  const match = division().rounds[roundIndex]?.[matchIndex];
  if (!match || match.winner) return;

  match['s' + side] = Math.max(0, match['s' + side] - 1);
  save();
  render();
}

/* Which side (if any) already meets the target and is clearly ahead. */
function leaderAt(match, target) {
  if (match.sa >= target && match.sa > match.sb) return 'a';
  if (match.sb >= target && match.sb > match.sa) return 'b';
  return null;
}

const openMatches = (div, r) => (div.rounds[r] ?? []).filter(m => !m.winner && m.a && m.b);

/* After a round's format changes, live matches in that round adapt: any match
   whose score already meets the new target finishes and the leader advances.
   Completed matches stay as they were. */
function settleRound(div, r) {
  const target = racksToWin(div, r);
  let finished = 0;
  div.rounds[r].forEach((match, i) => {
    if (match.winner || !match.a || !match.b) return;
    const side = leaderAt(match, target);
    if (!side) return;
    match.winner = match[side];
    advanceWinner(div.rounds, r, i, match.winner);
    finished++;
  });
  return finished;
}

/* Reads every round row in the submitted form (the full table in Match Settings,
   or the single-round control in Match Control) and applies what changed. */
function saveMatchFormat(form) {
  const div = division();
  const total = roundCount(div);
  const changes = [];

  for (let key = 0; key < total; key++) {
    const formatEl = form.elements[`format-${key}`];
    const raceEl = form.elements[`race-${key}`];
    if (!formatEl || !raceEl) continue;

    const r = total - 1 - key;
    const name = roundLabel(div, r);
    const format = formatEl.value === 'best' ? 'best' : 'race';
    const race = Number(raceEl.value);

    if (!Number.isSafeInteger(race) || race < 1 || race > 999) {
      return toast(`${name}: enter a whole number from 1 to 999`);
    }
    if (format === 'best' && race % 2 === 0) {
      return toast(`${name}: Best of needs an odd number, e.g. 3, 5 or 7`);
    }

    const current = roundFormat(div, r);
    if (current.format !== format || current.race !== race) changes.push({ key, r, name, format, race });
  }

  if (!changes.length) return toast('No format changes to save');

  const wouldFinish = changes.reduce(
    (sum, c) => sum + openMatches(div, c.r).filter(m => leaderAt(m, targetFor(c))).length,
    0
  );
  if (
    wouldFinish &&
    !confirm(
      `${wouldFinish} live match${wouldFinish === 1 ? '' : 'es'} already ${wouldFinish === 1 ? 'has' : 'have'} a score that meets the new target. ${wouldFinish === 1 ? 'It' : 'They'} will finish now and the leading player will advance. Continue?`
    )
  ) {
    return;
  }

  changes.forEach(({ key, format, race }) => (div.roundFormats[key] = { format, race }));

  let finished = 0;
  changes.sort((a, b) => a.r - b.r).forEach(c => {
    if (div.created) finished += settleRound(div, c.r);
  });

  save();
  render();

  const what =
    changes.length === 1
      ? `${changes[0].name} set to ${formatText(div, changes[0].r).toLowerCase()}`
      : `${changes.length} round formats updated`;
  toast(finished ? `${what} · ${finished} match${finished === 1 ? '' : 'es'} finished` : what);
}

function fillAllRounds() {
  const format = $('#fill-format').value;
  const race = $('#fill-race').value;
  $$('#race-form select[name^="format-"]').forEach(el => (el.value = format));
  $$('#race-form input[name^="race-"]').forEach(el => (el.value = race));
}

function resetDivision() {
  if (!confirm(`Reset only the ${label().toLowerCase()} division to sample players?`)) return;
  const { byeHistory } = division(); // keep bye rotation history
  state.divisions[state.active] = Object.assign(createDivision(state.active), { byeHistory });
  save();
  render();
  toast('Division reset');
}

/* ---------- Players ---------- */

function addPlayer() {
  const div = division();
  if (isStarted(div)) return toast('Tournament has started - the roster is locked.');

  const name = $('#player-name').value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return toast('Enter a valid name');
  if (div.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return toast('Name already exists in this division');
  }

  div.players.push({
    id: `p${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
    name,
  });
  const cleared = clearDraw(div);
  save();
  render();
  $('#player-name')?.focus();
  toast(cleared ? 'Player added - generate the bracket again to include them' : 'Player added');
}

function removePlayer(id) {
  const div = division();
  if (isStarted(div)) return;
  div.players = div.players.filter(p => p.id !== id);
  clearDraw(div);
  save();
  render();
}

/* ---------- Views ---------- */

function matchHTML(match, byes = null) {
  const line = (id, score) => `
    <div class="matchline ${id && match.winner === id ? 'winner' : ''}">
      <span class="${id ? '' : 'empty'}">${esc(playerName(id))}${id && byes?.has(id) ? ' <em class="badge">BYE</em>' : ''}</span>
      <span class="score">${score}</span>
    </div>`;
  return `<div class="match">${line(match.a, match.sa)}${line(match.b, match.sb)}</div>`;
}

function bracketHTML() {
  const div = division();
  const { created, rounds } = div;
  if (!created) {
    return '<div class="notice">No bracket yet. Add or review players, then select Generate Bracket.</div>';
  }

  const byeSet = new Set(byeIdsOf(div));
  const byeRound = div.prelim ? 1 : 0;
  const columns = rounds
    .map(
      (round, r) => `
        <div class="round">
          <div class="round-label">${esc(roundLabel(div, r))}</div>
          <div class="round-format">${esc(formatText(div, r))}</div>
          <div class="round-matches">${round.map(m => matchHTML(m, r === byeRound ? byeSet : null)).join('')}</div>
        </div>`
    )
    .join('');

  return `<div class="bracket">${columns}</div>`;
}

function structureSummary(div) {
  const first = planRows(div.players.length)[0];
  if (!first) return 'NEEDS 2+ PLAYERS';
  return `${first.matches} FIRST-ROUND MATCH${first.matches === 1 ? '' : 'ES'} · ${first.byes} BYE${first.byes === 1 ? '' : 'S'}`;
}

function dashboardView() {
  const s = stats();
  const div = division();
  const winner = champion();

  const rightPanel = winner
    ? `<h2>🏆 ${championTitle()}</h2>
       <div class="champion"><strong>${esc(playerName(winner))}</strong>${championTitle()}</div>`
    : `<h2>Quick Actions</h2>
       <p class="hint">Generate a bracket and award racks in Match Control. Winners advance automatically.</p>
       <div class="actions">
         <button class="btn" data-action="go" data-target="players">Players &amp; Settings</button>
         <button class="ghost" data-action="go" data-target="matches">Match Control</button>
       </div>`;

  return `
    <div class="hero">
      <div class="eyebrow">LA COSA NOSTRA • ${esc(label().toUpperCase())} DIVISION</div>
      <h2>Welcome to the Family.</h2>
      <p>Two independent pool championships. Manage the ${esc(label().toLowerCase())} bracket, scores and champion with just a few taps.</p>
      <div class="actions">
        <button class="btn" data-action="go" data-target="players">Manage ${esc(label())} Players →</button>
        <button class="ghost" data-action="go" data-target="display">TV Display ↗</button>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><span>PLAYERS</span><strong>${s.players}</strong></div>
      <div class="stat"><span>MATCHES</span><strong>${s.matches}</strong></div>
      <div class="stat"><span>COMPLETED</span><strong>${s.done}</strong></div>
      <div class="stat"><span>MATCH FORMAT</span><strong class="stat-text">${esc(formatSummary(div))}</strong></div>
    </div>

    <div class="grid2">
      <section class="panel">
        <h2>${esc(label())} Tournament</h2>
        <div class="list">
          <div class="listitem"><span>Bracket status</span><span class="tag">${div.created ? 'GENERATED' : 'AWAITING DRAW'}</span></div>
          <div class="listitem"><span>Match format</span><span class="tag">${esc(formatSummary(div)).toUpperCase()}</span></div>
          <div class="listitem"><span>Bracket structure</span><span class="tag">${esc(structureSummary(div))}</span></div>
          <div class="listitem"><span>Format</span><span class="tag">SINGLE ELIMINATION</span></div>
          <div class="listitem"><span>Champion title</span><span class="tag">${championTitle()}</span></div>
        </div>
        <p class="hint">Player registration happens separately in Google Forms. Add approved names manually here.</p>
      </section>

      <section class="panel">
        ${rightPanel}
        <hr class="subtle-rule">
        <button class="danger" data-action="reset-division">Reset ${esc(label())} division</button>
      </section>
    </div>`;
}

const formatInputs = (key, { format, race }, labelText) => `
  <select name="format-${key}" aria-label="${esc(labelText)} match format">
    <option value="race" ${format === 'race' ? 'selected' : ''}>Race to</option>
    <option value="best" ${format === 'best' ? 'selected' : ''}>Best of</option>
  </select>
  <input name="race-${key}" type="number" min="1" max="999" step="1" required value="${race}" aria-label="${esc(labelText)} number">`;

function byeNoticeHTML(div) {
  const ids = byeIdsOf(div);
  if (!ids.length) return '';
  return `<div class="notice"><strong>${ids.length} bye${ids.length === 1 ? '' : 's'}:</strong> ${ids.map(id => esc(playerName(id))).join(' · ')} skip the ${esc(roundLabel(div, 0))} and go straight into the ${esc(roundLabel(div, 1))}.</div>`;
}

function drawHTML(div, draw, title) {
  const byeIds = byeIdsOf(draw);
  const playing = draw.rounds[0].flatMap(m => [m.a, m.b]).filter(id => id && !byeIds.includes(id));
  const names = ids => (ids.length ? ids.map(id => esc(playerName(id))).join(' · ') : 'None');
  const first = roundName(0, draw.rounds.length, !!draw.prelim);
  return `
    <hr class="subtle-rule">
    <h3>${esc(title)}</h3>
    <div class="eyebrow">PLAYING IN THE ${esc(first.toUpperCase())} (${playing.length})</div>
    <p class="hint">${names(playing)}</p>
    <div class="eyebrow">RECEIVE A BYE (${byeIds.length})</div>
    <p class="hint">${names(byeIds)}</p>`;
}

function planPanelHTML(div) {
  const count = div.players.length;
  const rows = planRows(count);
  const started = isStarted(div);
  const rowHTML = rows
    .map(
      r => `<div class="listitem"><span>${esc(r.name)}</span><span class="tag">${r.matches} MATCH${r.matches === 1 ? '' : 'ES'}${r.byes ? ` · ${r.byes} BYE${r.byes === 1 ? '' : 'S'}` : ''}</span></div>`
    )
    .join('');
  const buttons = started
    ? '<button class="danger" data-action="new-tournament">Start New Tournament</button>'
    : `<button class="ghost" data-action="preview" ${disabledIf(count < 2)}>Preview Draw</button>
       <button class="btn" data-action="generate" ${disabledIf(count < 2)}>${div.created ? 'Regenerate Bracket' : 'Generate Bracket'} →</button>`;
  const draft = div.draft?.key === rosterKey(div) ? drawHTML(div, div.draft, 'Previewed draw (not final until generated)') : '';
  const live = div.created ? drawHTML(div, div, started ? 'Current draw (locked: play has started)' : 'Current draw') : '';

  return `
    <section class="panel">
      <div class="panel-top">
        <h2>${esc(label())} Bracket Plan</h2>
        <div class="actions">${buttons}</div>
      </div>
      <div class="stats plan-stats">
        <div class="stat"><span>REGISTERED PLAYERS</span><strong>${count}</strong></div>
        <div class="stat"><span>FIRST-ROUND MATCHES</span><strong>${rows[0]?.matches ?? 0}</strong></div>
        <div class="stat"><span>BYES</span><strong>${rows[0]?.byes ?? 0}</strong></div>
        <div class="stat"><span>ROUNDS</span><strong>${rows.length}</strong></div>
      </div>
      <div class="list">${rowHTML || '<p class="hint">Add at least 2 players to see the bracket structure.</p>'}</div>
      <p class="hint">The bracket is sized to the actual number of players. Byes are only given when the count is not a power of two, are drawn at random, and go first to players with the fewest byes in earlier tournaments. The draw cannot be edited by hand. It locks once the first rack is scored.</p>
      ${draft}${live}
    </section>`;
}

function playersView() {
  const div = division();
  const locked = isStarted(div);

  const total = roundCount(div);
  const roundRows = Array.from({ length: total }, (_, r) => {
    const name = roundLabel(div, r);
    return `<div class="roundrow"><span class="roundrow-name">${esc(name)}</span>${formatInputs(total - 1 - r, roundFormat(div, r), name)}</div>`;
  }).join('');

  const playerRows =
    div.players
      .map(
        (p, i) => `
          <div class="listitem">
            <span><span class="tag">#${String(i + 1).padStart(2, '0')}</span> &nbsp; ${esc(p.name)}</span>
            <button class="ghost" data-action="remove-player" data-id="${esc(p.id)}" ${disabledIf(locked)}>Remove</button>
          </div>`
      )
      .join('') || '<p class="hint">No players added yet.</p>';

  return `
    <div class="grid2">
      <section class="panel">
        <h2>Add ${esc(label())} Players</h2>
        <form id="player-form" class="formrow">
          <div class="field">
            <label for="player-name">First name and surname</label>
            <input id="player-name" maxlength="80" placeholder="Enter player name" required>
          </div>
          <button class="btn" type="submit" ${disabledIf(locked)}>+ Add Player</button>
        </form>
        <p class="hint">${div.players.length} players in this division. Changing the roster before the first rack is scored clears the current draw, so generate it again afterwards. Once play starts the roster is locked.</p>
      </section>

      <section class="panel">
        <h2>Match Settings</h2>
        <form id="race-form" data-form="round-format">
          <div class="roundrow fillrow">
            <span class="roundrow-name">All rounds</span>
            <select id="fill-format" aria-label="Format for all rounds">
              <option value="race" ${div.format === 'race' ? 'selected' : ''}>Race to</option>
              <option value="best" ${div.format === 'best' ? 'selected' : ''}>Best of</option>
            </select>
            <input id="fill-race" type="number" min="1" max="999" step="1" value="${div.race}" aria-label="Number for all rounds">
            <button class="ghost" type="button" data-action="fill-all">Fill all</button>
          </div>
          ${roundRows}
          <div class="actions"><button class="btn" type="submit">Save Formats</button></div>
        </form>
        <p class="hint">Each round has its own format. Race to: first to that many racks wins. Best of: use an odd number (3, 5, 7); first to win more than half wins. You can change a round at any time, even mid-tournament: completed matches stay as they are and live matches in that round adapt without a restart. Each division has its own settings.</p>
      </section>
    </div>

    ${planPanelHTML(div)}

    <section class="panel">
      <div class="panel-top">
        <h2>${esc(label())} Players (${div.players.length})</h2>
        <span class="hint">Roster locks when the first rack is scored</span>
      </div>
      <div class="list">${playerRows}</div>
    </section>`;
}

function bracketView() {
  const winner = champion();
  return `
    <section class="panel">
      <div class="panel-top">
        <h2>${esc(label())} Knockout Bracket</h2>
        <div class="actions">
          <button class="ghost" data-action="go" data-target="matches">Manage Scores</button>
          <button class="ghost" data-action="go" data-target="display">TV View ↗</button>
        </div>
      </div>
      <p class="hint">${esc(formatSummary(division()))}. Match winners automatically advance to the next round.</p>
      ${byeNoticeHTML(division())}
      ${bracketHTML()}
    </section>
    ${winner ? `<div class="champion">♛ <strong>${esc(playerName(winner))}</strong>${championTitle()}</div>` : ''}`;
}

function scoreControlHTML(match, r, i, side) {
  const locked = match.winner || !match.a || !match.b;
  const score = match['s' + side];
  const id = `${r},${i},${side}`;

  return `
    <div class="scoreline">
      <span>${esc(playerName(match[side]))}</span>
      <div class="actions">
        <button data-action="minus" data-match="${id}" ${disabledIf(locked || !score)}>−</button>
        <strong>${score}</strong>
        <button data-action="plus" data-match="${id}" ${disabledIf(locked)}>+1</button>
      </div>
    </div>`;
}

function matchCardHTML(match, r, i) {
  const div = division();
  const waiting = !match.a || !match.b;
  const status = match.winner ? 'COMPLETED' : waiting ? 'WAITING' : 'LIVE';
  const footer = match.winner
    ? `🏆 Winner: ${esc(playerName(match.winner))}`
    : waiting
      ? 'Waiting for players'
      : `${formatText(div, r)} · first to ${racksToWin(div, r)} racks wins`;

  return `
    <div class="control-card">
      <h3>MATCH ${i + 1} • ${status}</h3>
      ${SIDES.map(side => scoreControlHTML(match, r, i, side)).join('')}
      <div class="hint">${footer}</div>
    </div>`;
}

function matchesView() {
  const div = division();
  const { created, rounds } = div;

  if (!created) {
    return `
      <div class="notice">Generate a ${esc(label().toLowerCase())} bracket first.</div>
      <button class="btn" data-action="go" data-target="players">Manage Players</button>`;
  }

  const sections = rounds
    .map(
      (round, r) => `
        <section class="panel">
          <div class="panel-top round-head">
            <h2>${esc(roundLabel(div, r))}</h2>
            <form class="roundform" data-form="round-format">
              ${formatInputs(rounds.length - 1 - r, roundFormat(div, r), roundLabel(div, r))}
              <button class="ghost" type="submit">Update format</button>
            </form>
          </div>
          <div class="control-grid">${round.map((match, i) => matchCardHTML(match, r, i)).join('')}</div>
        </section>`
    )
    .join('');

  return `
    ${byeNoticeHTML(div)}
    <div class="notice">${esc(label())} division. Tap +1 for each rack won; the first player to reach the round’s target advances. Change a round’s format any time with its Update format control: live matches adapt, completed matches stay locked. Use −1 to correct scores before completion.</div>
    ${sections}`;
}

function displayView() {
  const winner = champion();
  return `
    <div class="tvbar">
      <span class="pill">● LA COSA NOSTRA • ${esc(label().toUpperCase())} DIVISION</span>
      <div class="actions">
        <button class="ghost" data-action="fullscreen">⛶ Full Screen</button>
        <button class="ghost" data-action="go" data-target="dashboard">← Admin</button>
      </div>
    </div>
    <div class="tvsub">WELCOME TO THE FAMILY • PRETORIA</div>
    <div class="tvtitle">${esc(label().toUpperCase())} FAMILY CUP</div>
    <div class="tvsub">POOL CHAMPIONSHIP • ${esc(formatSummary(division())).toUpperCase()}</div>
    ${bracketHTML()}
    ${winner ? `<div class="champion">♛ ${championTitle()} <strong>${esc(playerName(winner))}</strong></div>` : ''}
    <p class="hint" style="text-align:center">NextGen NTS</p>`;
}

const PAGES = {
  dashboard: { title: 'Tournament Dashboard', view: dashboardView },
  players: { title: 'Player Management', view: playersView },
  bracket: { title: 'Tournament Bracket', view: bracketView },
  matches: { title: 'Match Control', view: matchesView },
  display: { title: 'TV Display', view: displayView },
};

function render() {
  document.body.classList.toggle('displaymode', page === 'display');
  $$('#nav button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#page-title').textContent = PAGES[page].title;
  $('#content').innerHTML = PAGES[page].view();
  $('#division-select').value = state.active;
}

/* ---------- Routing (browser back / forward support) ----------
   Every page and division has its own address, e.g. #/men/bracket,
   so the browser's Back and Forward buttons work as expected. */

function navigate(targetPage, targetDivision = state.active) {
  const hash = `#/${targetDivision}/${targetPage}`;
  if (location.hash === hash) return render();
  location.hash = hash; // triggers "hashchange" → applyRoute()
}

function applyRoute({ initial = false } = {}) {
  const [, divisionKey, pageKey] = location.hash.split('/');

  if (Object.hasOwn(DIVISIONS, divisionKey)) state.active = divisionKey;
  page = Object.hasOwn(PAGES, pageKey) ? pageKey : DEFAULT_PAGE;

  // Normalise the address without adding a history entry.
  const canonical = `#/${state.active}/${page}`;
  if (location.hash !== canonical) history.replaceState(null, '', canonical);

  if (page !== 'display' && document.fullscreenElement) document.exitFullscreen();

  save();
  render();
  if (!initial) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => applyRoute());

/* ---------- Events ---------- */

const parseMatchId = el => {
  const [r, i, side] = el.dataset.match.split(',');
  return [Number(r), Number(i), side];
};

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

const ACTIONS = {
  go: el => navigate(el.dataset.target),
  generate: generateBracket,
  preview: previewDraw,
  'new-tournament': newTournament,
  'reset-division': resetDivision,
  'remove-player': el => removePlayer(el.dataset.id),
  plus: el => addRack(...parseMatchId(el)),
  minus: el => removeRack(...parseMatchId(el)),
  fullscreen: toggleFullscreen,
  'fill-all': fillAllRounds,
};

const FORMS = {
  'player-form': addPlayer,
  'round-format': saveMatchFormat,
};

$('#content').addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (el && !el.disabled) ACTIONS[el.dataset.action]?.(el);
});

$('#content').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target;
  (FORMS[form.dataset.form] ?? FORMS[form.id])?.(form);
});

$('#nav').addEventListener('click', event => {
  const button = event.target.closest('button[data-page]');
  if (button) navigate(button.dataset.page);
});

$('#division-select').addEventListener('change', event => navigate(page, event.target.value));

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'la-cosa-nostra-both-divisions.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- Live sync (optional) ----------
   Shares the tournament with TV screens in real time, two ways:
   1. FIREBASE_URL filled in: no install needed. The data lives in a free Firebase
      Realtime Database and every screen just opens the web page.
   2. Served by server.js on the laptop (needs Node): the data lives on the laptop.
   The admin page pushes changes; TV Display pages only listen. A shared "room
   code" (?room=CODE in the address) keeps other people out of your data. */

const FIREBASE_URL = 'https://la-cosa-nostra-baa4f-default-rtdb.firebaseio.com'; // e.g. 'https://your-project-default-rtdb.firebaseio.com'

const ROOM = (() => {
  try {
    const fromUrl = new URLSearchParams(location.search).get('room');
    if (fromUrl) localStorage.setItem('lcn-room', fromUrl);
    return (fromUrl || localStorage.getItem('lcn-room') || '').replace(/[^\w-]/g, '');
  } catch {
    return '';
  }
})();
const LIVE = /^https?:/.test(location.protocol || '') && (!FIREBASE_URL || !!ROOM);
const SYNC_URL = FIREBASE_URL ? `${FIREBASE_URL.replace(/\/$/, '')}/rooms/${ROOM}.json` : '/api/state';
const snap = s => JSON.stringify(s.divisions);
let synced = false;
let lastJson = '';
const canPush = () => LIVE && synced && page !== 'display';

/* Firebase does not store empty lists, empty objects or nulls, so put them back. */
function normalize(incoming) {
  if (!incoming?.divisions) return incoming;
  Object.values(incoming.divisions).forEach(div => {
    div.players ??= [];
    div.rounds ??= [];
    div.roundFormats ??= {};
    div.byes ??= [];
    div.byeHistory ??= {};
    div.draft ??= null;
    div.format ??= 'race';
  });
  return incoming;
}

function pushState() {
  if (snap(state) === lastJson) return;
  lastJson = snap(state);
  const options = { method: 'PUT', body: JSON.stringify(state) };
  if (!FIREBASE_URL) {
    options.headers = { 'Content-Type': 'application/json', 'X-Pin': sessionStorage.getItem('lcn-pin') || '' };
  }
  fetch(SYNC_URL, options)
    .then(res => {
      if (res.ok) return;
      lastJson = '';
      if (res.status !== 401) return toast(`TVs not updated (error ${res.status})`);
      const pin = prompt('Enter the admin PIN to share changes with the TVs');
      if (pin) {
        sessionStorage.setItem('lcn-pin', pin);
        pushState();
      } else toast('Not shared with the TVs - PIN required');
    })
    .catch(() => {
      lastJson = '';
      toast('Cannot reach the live server - TVs not updated');
    });
}

/* The admin page is the only writer, so after its first load it ignores echoes
   (they could overwrite a tap made a moment later). TV pages apply every update. */
function applyRemote(incoming, initial = false) {
  if (!initial && page !== 'display') return;
  incoming = normalize(incoming);
  if (!isValidState(incoming) || snap(incoming) === lastJson) return;
  incoming.active = state.active;
  state = incoming;
  lastJson = snap(state);
  render();
}

if (LIVE) {
  fetch(SYNC_URL)
    .then(res => res.json())
    .then(remote => {
      applyRemote(remote, true);
      synced = true;
      if (canPush()) pushState(); // nothing online yet: share this browser's data once
    })
    .catch(() => {});
  const events = new EventSource(FIREBASE_URL ? SYNC_URL : '/events');
  if (FIREBASE_URL) {
    events.addEventListener('put', e => {
      try {
        const message = JSON.parse(e.data);
        if (message.path === '/') applyRemote(message.data);
      } catch { /* ignore */ }
    });
  } else {
    events.onmessage = e => {
      try { applyRemote(JSON.parse(e.data)); } catch { /* ignore */ }
    };
  }
} else if (FIREBASE_URL && /^https?:/.test(location.protocol || '')) {
  setTimeout(() => toast('Live TVs off: add ?room=YOURCODE to the web address'), 800);
}

/* ---------- Start ---------- */

applyRoute({ initial: true });
