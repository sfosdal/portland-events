#!/usr/bin/env node
/**
 * Aggregates upcoming events around Portland into site/events.json and
 * site/events.ics. Runs in CI (see .github/workflows/events.yml) and locally
 * for preview. The pipeline is lqa-events' (scripts/*.mjs are its files,
 * byte for byte); only the sources below and site/city.js are Portland's.
 *
 * Each source returns [{ venue, title, date, time, url }]. Ticketmaster needs
 * a free Discovery API key in env TICKETMASTER_API_KEY (repo secret of the
 * same name); with no key it's skipped. Every room is read by its Ticketmaster
 * venue id (city.js `tm`); there is no city sweep (the Chicago rule — the
 * API stops a query at its thousandth event). The teams' seasons come from
 * ESPN (Blazers, Timbers, Thorns), HockeyTech (Winterhawks) and MLB's stats
 * API (Hops, whose home games are injected — no ticket feed lists them)
 * (scripts/schedules.mjs).
 */
import './failures.mjs'; // first: every outside call retried, the ones still failing written to failures.json (Steve, 2026-10-29)
import { writeFileSync, readFileSync } from 'node:fs';
import { buildIcs } from './ics.mjs';
import { isChurch } from './sources.mjs';
import { mergeWithArchive, unionArchives, eventKey, dropClashes } from './merge.mjs';
import { fixLinks } from './links.mjs';
import { calmTitle, isNotice } from './titles.mjs';
import { applySchedules } from './schedules.mjs';
import { slugify, BADGE_FEEDS, TEAMS, CITY } from './badges.mjs';
import { feedSources, emptyListGate } from './feeds.mjs';
import { tmFetch, tmFailed, keepFailedVenues } from './tm-fetch.mjs';

const JSON_OUT = new URL('../site/events.json', import.meta.url);
const ICS_OUT = new URL('../site/events.ics', import.meta.url);
// A full year each way: venues announce whole seasons ahead, and past events
// are kept for a year (carried forward from the previously published feed —
// see mergeWithArchive).
const WINDOW_DAYS = 365;
// The live feed is read from the site's own domain (a build that reads
// neither copy of the archive refuses to publish — see mergeWithArchive;
// ALLOW_NO_ARCHIVE=1 lets the very first build through).
const FEED_URL = process.env.FEED_URL || 'https://portland.here.events/events.json';
// the second copy of the archive: every past event ever published, kept on
// the orphan `archive` branch by the workflow after each successful build
const ARCHIVE_URL = process.env.ARCHIVE_URL || 'https://raw.githubusercontent.com/sfosdal/portland-events/archive/events-archive.json';
const ARCHIVE_OUT = new URL('../events-archive.json', import.meta.url); // repo root, ignored; the workflow commits it to the branch
const MAX_EVENTS = 4000; // sanity cap, not a display cap

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Local runs: when the environment doesn't provide TICKETMASTER_API_KEY (CI
// passes it as a repo secret), pick it up from an untracked repo-root .env so
// the localhost preview gets the arena listings too.
if (!process.env.TICKETMASTER_API_KEY) {
  try {
    const m = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^TICKETMASTER_API_KEY=(.+)$/m);
    if (m) process.env.TICKETMASTER_API_KEY = m[1].trim();
  } catch { /* no .env — Ticketmaster sources warn and skip */ }
}

// --- Ticketmaster Discovery API ---
// Ticketmaster's resale marketplace (source "tmr": an id starting "Z7r9j", a
// ticketmaster.com/event/ link) lists shows whose box office is elsewhere, a
// second listing beside the primary, titled differently so the duplicate
// guard can't fold them. A resale listing is kept only when no primary one
// shares its date, and it links to the box office the listing names or the
// venue's own page, never to the resale offer.
const isResale = (e) => /^Z7r9j/.test(e.id || '');
function tmEvent(e, venue, fallbackUrl) {
  const boxOffice = (e.outlets || []).find((o) => o.type === 'venueBoxOffice')?.url;
  const ev = {
    venue,
    title: e.name,
    date: e.dates?.start?.localDate || '',
    time: e.dates?.start?.localTime || '',
    url: isResale(e) ? (boxOffice || fallbackUrl) : (e.url || fallbackUrl),
  };
  if (e.ageRestrictions?.legalAgeEnforced) ev.age21 = true;
  const seg = e.classifications?.[0]?.segment?.name || '';
  const type = /sports/i.test(seg) ? 'sports' : /music/i.test(seg) ? 'concert' : /arts|theat/i.test(seg) ? 'arts' : /film/i.test(seg) ? 'movie' : null;
  if (type) ev.type = type;
  if (e.dates?.start?.dateTBD || e.dates?.start?.dateTBA) ev.dateTbd = true; // a placeholder date the promoter may still move
  // a cancelled or postponed show stays in Ticketmaster's listing for a
  // while, marked in dates.status — pass that on rather than list it as if
  // it were still happening (the merge step drops it once it vanishes)
  const code = e.dates?.status?.code;
  if (code === 'cancelled' || code === 'postponed') ev.status = code;
  return ev;
}
function keepPrimary(rows) {
  const primaryDates = new Set(rows.filter((e) => !isResale(e)).map((e) => e.dates?.start?.localDate));
  return rows.filter((e) => !isResale(e) || !primaryDates.has(e.dates?.start?.localDate));
}
async function tmPages(params, label) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) { console.warn('No TICKETMASTER_API_KEY set — skipping Ticketmaster.'); return []; }
  const all = [];
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ apikey: key, sort: 'date,asc', size: '200', page: String(page), ...params });
    const res = await tmFetch(`https://app.ticketmaster.com/discovery/v2/events.json?${q}`);
    if (!res.ok) throw tmFailed(label, res); // every retry spent (tm-fetch.mjs): the venue keeps its previous rows, not an empty or half list
    const data = await res.json();
    all.push(...(data?._embedded?.events || []));
    if (page + 1 >= (data?.page?.totalPages || 1)) break;
  }
  console.log(`Ticketmaster ${label}: ${all.length} events`);
  return all;
}
// by venue id (every page), for the rooms city.js names
async function ticketmasterVenue({ venueId, venueMatch, label, fallbackUrl, exclude }) {
  const rows = (await tmPages({ venueId }, label))
    .filter((e) => (e._embedded?.venues?.[0]?.name || '').toLowerCase().includes(venueMatch))
    .filter((e) => !exclude || !exclude.test(e.name || ''));
  return keepPrimary(rows).map((e) => tmEvent(e, label, fallbackUrl));
}
// Every venue is read from Ticketmaster AND its own events site (Steve, 2026-10-26). One of the
// two leads — the box office with the richer rows — and the other is SECONDARY (city.js
// `tm.secondary` / `feed.secondary`): read after everything else and kept only where nothing
// already sits at that venue on that date with the same clock or title (merge.mjs dropClashes).
const tmVenue = ([label, v]) => () => ticketmasterVenue({ venueId: v.tm.id, venueMatch: v.tm.match, label, fallbackUrl: v.tm.fallbackUrl, exclude: v.tm.exclude });
const ticketmasterRooms = Object.entries(CITY.venues).filter(([, v]) => v.tm && !v.tm.secondary).map(tmVenue);
const ticketmasterSecond = Object.entries(CITY.venues).filter(([, v]) => v.tm && v.tm.secondary).map(tmVenue);
const splitVenues = (keep) => Object.fromEntries(Object.entries(CITY.venues).filter(([, v]) => keep(v)));
const feedsFirst = feedSources({ ...CITY, venues: splitVenues((v) => !v.feed?.secondary), feeds: [] }, BROWSER_UA); // venues whose own calendar leads (city.js `feed`)
const feedsSecond = feedSources({ ...CITY, venues: splitVenues((v) => v.feed?.secondary) }, BROWSER_UA); // venues whose own calendar fills in behind Ticketmaster + the city-wide `feeds`, which this city keeps behind its calendars
const sources = [...ticketmasterRooms, ...feedsFirst];
// Secondary sources re-list shows the primaries carry under other titles;
// anything at an already-taken venue/date/time is dropped: Merc Tickets
// (city.js `feeds`), behind Ticketmaster's rooms (Alberta Rose sells on both).
const secondary = [...ticketmasterSecond, ...feedsSecond]; // city.js `feeds` (Merc Tickets) ride behind Ticketmaster's venues (Alberta Rose sells on both)

// Venue names as city.js spells them: a venue listed under other spellings
// (`alias` — "Theater of the Clouds", "Ron Tonkin Field")
// folds to its one name; `groundsVenue`, when a city sets one, takes the
// rooms city.js doesn't list.
const CANONICAL_VENUES = new Set(Object.keys(CITY.venues));
const ALIASES = Object.entries(CITY.venues).filter(([, v]) => v.alias).map(([label, v]) => [label, v.alias]);
const aliasHit = (s) => { const hit = ALIASES.find(([, re]) => re.test(s || '')); return hit ? hit[0] : null; };
const aliasVenue = (name) => aliasHit(name) || name;
// A listing whose venue field is just the city names its room at the end of
// the title ("X live at The Vic").
const roomInTitle = (title) => { const m = /\b(?:at|@)\s+(.+)$/i.exec(title || ''); return m ? aliasHit(m[1]) : null; };
const normalizeVenue = (e) => {
  const byName = aliasVenue(e.venue);
  const venue = CANONICAL_VENUES.has(byName) ? byName : (roomInTitle(e.title) || byName);
  if (CITY.groundsVenue && !CANONICAL_VENUES.has(venue)) return { ...e, venue: CITY.groundsVenue };
  return venue === e.venue ? e : { ...e, venue };
};

// Church events never make the listing (Steve, 2026-10-11, for Everett;
// the same here), judged on the
// source's own venue name and title before anything folds into the
// Elsewhere row; the count is logged so a new church booking is visible.
let churchDropped = 0;
const noChurch = (rows) => rows.filter((e) => { if (isChurch(e)) { churchDropped++; return false; } return true; });

let all = [];
for (const src of sources) {
  try { all = all.concat(noChurch(await src()).map(normalizeVenue)); }
  catch (err) { console.error('Source failed:', err.message); }
}
for (const src of secondary) {
  try {
    const rows = noChurch(await src()).map(normalizeVenue).map((r) => ({ ...r, type: r.type || CITY.venues[r.venue]?.type || r.type })); // a typeless Ticketmaster row takes its venue's type
    const kept = dropClashes(rows, all); // nothing already at that venue on that date with the same clock or title (merge.mjs)
    if (rows.length) console.log(`  secondary ${rows[0].venue}: ${kept.length} of ${rows.length} rows new`);
    all = all.concat(kept);
  }
  catch (err) { console.error('Source failed:', err.message); }
}
if (churchDropped) console.log(`Church events dropped: ${churchDropped}`);

// window, de-dupe, sort
const today = new Date().toISOString().slice(0, 10);
const horizon = new Date(Date.now() + WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);
const seen = new Set();
const fresh = all
  .filter((e) => e.date && e.date >= cutoff && e.date <= horizon)
  .filter((e) => !isNotice(e.title)) // a closure or construction notice is information, not an event
  .map((e) => ({ ...e, title: calmTitle(e.title) })) // shouted titles come down to Title Case
  .filter((e) => { const k = eventKey(e); if (seen.has(k)) return false; seen.add(k); return true; }); // venue|title|date|clock (merge.mjs): a second showing on one day is kept
// the empty-list gate (feeds.mjs): nothing upcoming in this build's own pull means a venue was
// missed in scouting or every source is down — not a fact about the town. ALLOW_EMPTY_LIST=1 overrides.
if (!emptyListGate(fresh, today, sources.length + secondary.length)) process.exit(1);

// carry past events forward. Two copies of the archive: the live feed and
// the `archive` branch's file (every past event ever published; the workflow
// rewrites it after each build). Each is fetched with three tries; the build
// goes on with the union of whatever it got and stops only when it got
// neither. Since the union can only grow, a publish that lost history can no
// longer shrink the record.
const cleanArchive = (d) => (Array.isArray(d) ? d : (d.events || []))
  .filter((e) => !isChurch(e)) // past church events leave the record too
  .map(normalizeVenue) // past events published under other spellings fold onto the one name
  .filter((e) => !isNotice(e.title)).map((e) => ({ ...e, title: calmTitle(e.title) })); // the same title hygiene as fresh events, so the merge keys agree
async function fetchArchive(url, what) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return cleanArchive(await r.json());
    } catch (err) {
      console.error(`${what} fetch (try ${attempt} of 3) failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 20000));
    }
  }
  return null;
}
const [liveArchive, branchArchive] = await Promise.all([
  fetchArchive(FEED_URL, 'Live feed'),
  fetchArchive(ARCHIVE_URL, 'Archive branch'),
]);
if (liveArchive === null && branchArchive === null && !process.env.ALLOW_NO_ARCHIVE) {
  console.error('No archive from either copy — not publishing (ALLOW_NO_ARCHIVE=1 to override for a first build)');
  process.exit(1);
}
if (liveArchive === null) console.error('Live feed unreadable — building on the archive branch copy');
if (branchArchive === null) console.error('Archive branch unreadable — building on the live feed alone');
const archived = unionArchives(liveArchive || [], branchArchive || []);
console.log(`Archive: ${(liveArchive || []).length} events in the live feed, ${(branchArchive || []).length} on the archive branch, ${archived.length} in the union`);

const merged = mergeWithArchive(fresh.concat(keepFailedVenues(archived, fresh, today)), archived, today, cutoff).slice(-MAX_EVENTS);

// League schedules flag floating dates Ticketmaster doesn't know yet, and
// the full seasons (home and away) feed the site's Teams view
let seasons = {}, form = {};
try { ({ teams: seasons, form } = await applySchedules(merged)); } catch (err) { console.error('Schedules step failed:', err.message); }
// The clubs whose home games have no ticket feed here (city.js `inject`: the
// none here yet) enter the listing from the league's schedule —
// typed sports, the club's ticket page as the link — unless the feed already
// has that day at that ground
// (city.js teams, not badges' TEAMS, which carries only slug/label/re — the
// loop was a no-op until 2026-10-11; the game takes the club's own ground name)
for (const t of CITY.teams.filter((x) => x.inject)) {
  for (const g of (seasons[t.slug] || []).filter((x) => x.home && x.date >= cutoff)) {
    const ground = t.inject.venue || t.venue || g.venue;
    const listed = merged.find((e) => e.date === g.date && (e.venue === ground || e.venue === g.venue));
    if (listed) { if (!listed.time && g.time && !g.tbd) listed.time = g.time; continue; } // the feed's listing stands; the league's first pitch fills a time it lacks
    merged.push({ venue: ground, title: `${t.inject.name || t.name || t.label} vs ${g.opp.name}`, date: g.date, time: g.time, url: t.inject.url, type: 'sports', ...(g.tbd ? { dateTbd: true } : {}), ...(g.watch ? { watch: g.watch } : {}) });
  }
}
// Ticket availability for the Ticketmaster venues, from a local checker
// (scripts/data/soldout.json — empty until one runs for Portland): counts and
// lowest price, and soldOut when the box office has nothing left.
try {
  const so = JSON.parse(readFileSync(new URL('./data/soldout.json', import.meta.url), 'utf8'));
  let n = 0, s = 0;
  for (const e of merged) {
    const m = (e.url || '').match(/\/event\/([0-9A-F]{16})/i); // Ticketmaster's 16-hex id
    const r = m && (so.events || {})[m[1].toUpperCase()];
    if (!r || !/^(available|soldout)$/.test(r.status)) continue;
    const out = r.status === 'soldout';
    e.tickets = { box: out ? 0 : (r.primary == null ? null : r.primary), resale: r.resale || 0, checked: r.checked };
    const from = out ? r.fromResale : r.fromPrimary;
    if (from != null) e.tickets.from = from;
    if (out) { e.soldOut = true; s++; }
    n++;
  }
  if (n) console.log(`soldout: ${n} events with ticket counts (checked ${so.generated}), ${s} sold out`);
} catch (err) { console.error('soldout.json:', err.message); }
merged.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
if (Object.keys(seasons).length) {
  const postseason = JSON.parse(readFileSync(new URL('./data/postseason.json', import.meta.url), 'utf8')); // each league's playoff rounds (hand-kept), shown until the real games land
  delete postseason._;
  writeFileSync(new URL('../site/teams.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString(), teams: seasons, form, postseason }, null, 1) + '\n');
} else {
  console.error('teams.json: no season fetched this run, the last one stands');
}

await fixLinks(merged, { venues: CITY.venues, today }); // ticket links that reach a real page: no scheme-less or wrapped links, a 404 goes to the venue's page (scripts/links.mjs)
writeFileSync(JSON_OUT, JSON.stringify({ generated: new Date().toISOString(), events: merged }, null, 2) + '\n');
// the archive record: this build's past events on top of everything already
// recorded, never pruned (the feed keeps a year; the branch keeps it all)
const record = unionArchives(merged.filter((e) => e.date < today), archived.filter((e) => e.date < today));
writeFileSync(ARCHIVE_OUT, JSON.stringify({ events: record }, null, 1) + '\n'); // no timestamp: the branch commits only when the events change
console.log(`Archive record: ${record.length} past events`);
writeFileSync(ICS_OUT, buildIcs(merged));

// Filtered subscribe feeds, one per venue and one per badge, so the site's
// filter chips can offer a matching calendar subscription.
const siteDir = new URL('../site/', import.meta.url);
let nFeeds = 0;
for (const venue of new Set(merged.map((e) => e.venue))) {
  const evs = merged.filter((e) => e.venue === venue);
  writeFileSync(new URL(`events-venue-${slugify(venue)}.ics`, siteDir),
    buildIcs(evs, new Date(), { calname: `${CITY.ics.short} — ${venue}` }));
  nFeeds++;
}
for (const [slug, [label, pred]] of Object.entries(BADGE_FEEDS)) {
  writeFileSync(new URL(`events-${slug}.ics`, siteDir),
    buildIcs(merged.filter(pred), new Date(), { calname: `${CITY.ics.short} — ${label}` }));
  nFeeds++;
}
// Exclusion feeds, one per local team: everything except that team's games.
for (const t of TEAMS) {
  writeFileSync(new URL(`events-no-${t.slug}.ics`, siteDir),
    buildIcs(merged.filter((e) => !t.re.test(e.title || '')), new Date(), { calname: `${CITY.ics.short} — no ${t.label}` }));
  nFeeds++;
}
// Season feeds for the Teams view: each club's whole season, home and away
// (team-<slug>.ics), and every club's in one (teams.ics). Each game links to
// the club's page on the site.
const seasonEvents = (slug, label, games) => games.map((g) => ({
  title: `${label} ${g.home ? 'vs' : 'at'} ${g.opp.name}${g.pre ? ' (preseason)' : g.playoff ? ' (playoff)' : ''}`,
  venue: g.venue || (g.home ? '' : g.opp.name), date: g.date, time: g.tbd ? null : g.time, ...(g.tbd ? { dateTbd: true } : {}),
  url: `${CITY.site}?team=${slug}`,
}));
const allSeasons = [];
for (const t of TEAMS) {
  if (!seasons[t.slug]) continue;
  const evs = seasonEvents(t.slug, t.label, seasons[t.slug]);
  allSeasons.push(...evs);
  writeFileSync(new URL(`team-${t.slug}.ics`, siteDir), buildIcs(evs, new Date(), { calname: `${t.label} season` }));
  nFeeds++;
}
writeFileSync(new URL('teams.ics', siteDir), buildIcs(allSeasons, new Date(), { calname: CITY.ics.teams }));
nFeeds++;

const nPast = merged.filter((e) => e.date < today).length;
console.log(`Wrote ${merged.length} events (${nPast} past, ${merged.length - nPast} upcoming) + ${nFeeds} filtered feeds`);
