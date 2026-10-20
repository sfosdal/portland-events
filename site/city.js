// The city — every fact that makes this calendar Portland's rather than
// another town's, in one place (2026-10-11: the fourth city on lqa-events,
// after Everett and Chicago). The browser (filter.js, app.js) and the build
// (scripts/*.mjs) both read it; nothing else names a venue or a team. The
// shared files (app.js, filter.js, styles.css bar its --v-* hues,
// scripts/*.mjs bar fetch-events.mjs and sources.mjs) are lqa-events' own,
// byte for byte — see README "Sister sites".
//
// Loaded before filter.js (a plain script, so the tests can share it): it
// sets globalThis.LQACity (the name is the shared code's, not the city's).
(function (global) {
  'use strict';

  // The home teams, matched on the event title whatever the venue. Order =
  // the Teams strip, left to right. Per team:
  //   re        the title match
  //   venue     the home building; schedule = the club's own schedule page
  //   sport     keys the strip icon (app.js SPORT_ICONS), the game clock,
  //             the leader categories
  //   colors    [primary, accent] — the season calendar's home cells and
  //             card frames
  //   espn      ESPN's sport/league/team id — the Blazers, Timbers and
  //             Thorns are on ESPN (season, form, news, transactions, all
  //             from schedules.mjs); the Winterhawks' WHL season comes from
  //             HockeyTech and the Hops' Northwest League season from MLB's
  //             stats API (sportId 13, High-A), the Everett adapters
  //   inject    a club whose home games no ticket feed here carries: its
  //             league schedule puts them in the listing (the Hops)
  //   club      the club's name on Ticketmaster; news the outlets' feeds;
  //             wiki the article; opens when the season usually starts
  var TEAMS = [
    { slug: 'blazers', label: 'Trail Blazers', re: /trail ?blazers/i, sport: 'basketball', venue: 'Moda Center', colors: ['#e03a3e', '#000000'],
      espn: { sport: 'basketball', league: 'nba', id: '22' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/nba/500/por.png', schedule: 'https://www.nba.com/blazers/schedule',
      club: 'Portland Trail Blazers', opens: 'late October', wiki: { title: 'Portland Trail Blazers' } },
    { slug: 'timbers', label: 'Timbers', re: /\btimbers\b/i, sport: 'soccer', venue: 'Providence Park', colors: ['#00482b', '#d69a00'],
      espn: { sport: 'soccer', league: 'usa.1', id: '9723' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9723.png', schedule: 'https://www.timbers.com/schedule/',
      club: 'Portland Timbers', opens: 'late February', wiki: { title: 'Portland Timbers' } },
    { slug: 'thorns', label: 'Thorns', re: /\bthorns\b/i, sport: 'soccer', venue: 'Providence Park', colors: ['#8b1a2f', '#000000'],
      espn: { sport: 'soccer', league: 'usa.nwsl', id: '15362' }, season: { kind: 'espn' }, form: { kind: 'espn' },
      logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/15362.png', schedule: 'https://www.thorns.com/schedule/',
      club: 'Portland Thorns FC', opens: 'March', wiki: { title: 'Portland Thorns FC' } },
    // WHL via HockeyTech (the Everett Silvertips' adapter); the Hawks split
    // their home dates between the Coliseum and the Moda Center next door
    { slug: 'winterhawks', label: 'Winterhawks', name: 'Portland Winterhawks', abbr: 'POR', re: /winterhawks/i, sport: 'hockey', venue: 'Veterans Memorial Coliseum', colors: ['#000000', '#c8102e'],
      season: { kind: 'hockeytech', league: 'whl', key: '41b145a848f4bd67', id: 208, leagueName: 'WHL' }, form: { kind: 'hockeytech', league: 'whl', key: '41b145a848f4bd67', id: 208 },
      logo: 'https://assets.leaguestat.com/whl/logos/208.png', schedule: 'https://winterhawks.com/schedule',
      club: 'Portland Winterhawks', opens: 'late September', wiki: { title: 'Portland Winterhawks', club: true } },
    // High-A Northwest League via MLB's stats API (the Everett AquaSox's
    // adapter); no ticket feed lists the Hops, so the schedule is injected
    { slug: 'hops', label: 'Hops', name: 'Hillsboro Hops', abbr: 'HIL', re: /hillsboro hops|\bhops\b/i, sport: 'baseball', venue: 'Hops Ballpark', colors: ['#1b365d', '#6cc24a'],
      season: { kind: 'mlb', id: 419, sportId: 13 }, form: { kind: 'milb', id: 419, league: 126, leagueName: 'Northwest League' },
      inject: { url: 'https://www.milb.com/hillsboro/tickets' },
      logo: 'https://www.mlbstatic.com/team-logos/419.svg', schedule: 'https://www.milb.com/hillsboro/schedule',
      club: 'Hillsboro Hops', opens: 'early April', wiki: { title: 'Hillsboro Hops', club: true },
      news: [['https://www.milb.com/hillsboro/feeds/news/rss.xml', 'MiLB.com']] },
  ];

  // The venues, one record each — the Rose Quarter, Providence Park and the
  // Portland'5 halls first by size, then the music rooms and the towns
  // around. Per venue:
  //   capacity how many people the place holds
  //   area     'town' for the music rooms across the city and the houses
  //            out of town (the panel's second group); absent = the Rose
  //            Quarter, Providence Park and the Portland'5 halls
  //   type     the event type when the title decides nothing
  //   cssVar   the hue styles.css sets for it (dark block --v-*); color
  //            the same hue as a value, for the series graph
  //   url      the venue's own events listing — not a ticket vendor
  //   icon     a mark for listings without a team crest
  //   tm       its Ticketmaster Discovery listing (fetch-events.mjs reads
  //            the venue by id — every page). There is NO city sweep here
  //            (the Chicago rule: by room only)
  //   alias    the other spellings the feeds use for it, folded to this name
  // No festivals yet, so the panel's Festivals group folds away (app.js).
  var VENUES = {
    // --- The Rose Quarter, Providence Park and the Portland'5 halls ---
    'Moda Center': {
      capacity: 19393,
      type: 'sports',
      cssVar: '--v-moda',
      color: '#ea8686',
      url: 'https://www.rosequarter.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.rosequarter.com&sz=128',
      tm: { id: 'KovZpa6MXe', match: 'moda center', fallbackUrl: 'https://www.rosequarter.com/events', exclude: /parking|tour/i },
      alias: /moda center|theater of the clouds|rose garden arena/i,
    },
    'Veterans Memorial Coliseum': {
      capacity: 12000,
      type: 'concert',
      cssVar: '--v-vmc',
      color: '#86eaa3',
      url: 'https://www.rosequarter.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.rosequarter.com&sz=128',
      tm: { id: 'KovZpZAJ67kA', match: 'veterans memorial coliseum', fallbackUrl: 'https://www.rosequarter.com/events', exclude: /parking/i },
      alias: /veterans memorial coliseum|memorial coliseum/i,
    },
    'Providence Park': {
      capacity: 25218,
      type: 'sports',
      cssVar: '--v-providence',
      color: '#c086ea',
      url: 'https://www.providenceparkpdx.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.providenceparkpdx.com&sz=128',
      tm: { id: 'KovZpZAIFAAA', match: 'providence park', fallbackUrl: 'https://www.providenceparkpdx.com/events', exclude: /parking|stadium tour/i },
      alias: /providence park/i,
    },
    'Keller Auditorium': {
      capacity: 2992,
      type: 'arts',
      cssVar: '--v-keller',
      color: '#eadd86',
      url: 'https://www.portland5.com/keller-auditorium/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.portland5.com&sz=128',
      tm: { id: 'KovZpZAEkdFA', match: 'keller auditorium', fallbackUrl: 'https://www.portland5.com/keller-auditorium/events' },
      alias: /keller auditorium/i,
    },
    'Arlene Schnitzer Concert Hall': {
      capacity: 2776,
      type: 'arts',
      cssVar: '--v-schnitz',
      color: '#86d9ea',
      url: 'https://www.portland5.com/arlene-schnitzer-concert-hall/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.portland5.com&sz=128',
      tm: { id: 'KovZpZAEkkJA', match: 'schnitzer', fallbackUrl: 'https://www.portland5.com/arlene-schnitzer-concert-hall/events' },
      alias: /schnitzer/i,
    },
    'Newmark Theatre': {
      capacity: 880,
      type: 'arts',
      cssVar: '--v-newmark',
      color: '#ea86bc',
      url: 'https://www.portland5.com/newmark-theatre/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.portland5.com&sz=128',
      tm: { id: 'KovZpZA7klvA', match: 'newmark', fallbackUrl: 'https://www.portland5.com/newmark-theatre/events' },
      alias: /newmark theat/i,
    },
    // --- Music rooms and around (`area: 'town'`): the ballrooms and clubs across the city, then Troutdale, Ridgefield and Hillsboro ---
    'Crystal Ballroom': {
      area: 'town',
      capacity: 1500,
      type: 'concert',
      cssVar: '--v-crystal',
      color: '#9fea86',
      url: 'https://www.crystalballroompdx.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.crystalballroompdx.com&sz=128',
      tm: { id: 'KovZpZAFFJnA', match: 'crystal ballroom', fallbackUrl: 'https://www.crystalballroompdx.com/events' },
      alias: /crystal ballroom|lola'?s room/i,
    },
    'Roseland Theater': {
      area: 'town',
      capacity: 1410,
      type: 'concert',
      cssVar: '--v-roseland',
      color: '#8a86ea',
      url: 'https://roselandpdx.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=roselandpdx.com&sz=128',
      tm: { id: 'KovZpap9re', match: 'roseland', fallbackUrl: 'https://roselandpdx.com/events/' },
      alias: /roseland/i,
    },
    'Revolution Hall': {
      area: 'town',
      capacity: 850,
      type: 'concert',
      cssVar: '--v-revhall',
      color: '#eaa786',
      url: 'https://revolutionhall.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=revolutionhall.com&sz=128',
      tm: { id: 'KovZpZAEkdIA', match: 'revolution hall', fallbackUrl: 'https://revolutionhall.com/events/' },
      alias: /revolution hall/i,
    },
    'Wonder Ballroom': {
      area: 'town',
      capacity: 778,
      type: 'concert',
      cssVar: '--v-wonder',
      color: '#86eac4',
      url: 'https://wonderballroom.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=wonderballroom.com&sz=128',
      tm: { id: 'KovZpa9hBe', match: 'wonder ballroom', fallbackUrl: 'https://wonderballroom.com/events/' },
      alias: /wonder ballroom/i,
    },
    'Aladdin Theater': {
      area: 'town',
      capacity: 620,
      type: 'concert',
      cssVar: '--v-aladdin',
      color: '#e186ea',
      url: 'https://aladdin-theater.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=aladdin-theater.com&sz=128',
      tm: { id: 'KovZpa3qfe', match: 'aladdin', fallbackUrl: 'https://aladdin-theater.com/events/' },
      alias: /aladdin theat/i,
    },
    'Star Theater': {
      area: 'town',
      capacity: 350,
      type: 'concert',
      cssVar: '--v-star',
      color: '#d5ea86',
      url: 'https://startheaterportland.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=startheaterportland.com&sz=128',
      tm: { id: 'KovZpZAIvlnA', match: 'star theater', fallbackUrl: 'https://startheaterportland.com/events/' },
      alias: /^star theat/i,
    },
    'Hawthorne Theatre': {
      area: 'town',
      capacity: 500,
      type: 'concert',
      cssVar: '--v-hawthorne',
      color: '#86b7ea',
      url: 'https://hawthornetheatre.com/events/',
      icon: 'https://www.google.com/s2/favicons?domain=hawthornetheatre.com&sz=128',
      tm: { id: 'KovZpZAkn7IA', match: 'hawthorne theatre', fallbackUrl: 'https://hawthornetheatre.com/events/' },
      alias: /hawthorne theat/i,
    },
    'Mississippi Studios': {
      area: 'town',
      capacity: 300,
      type: 'concert',
      cssVar: '--v-mississippi',
      color: '#ea869a',
      url: 'https://www.mississippistudios.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.mississippistudios.com&sz=128',
      tm: { id: 'KovZ917Ai0C', match: 'mississippi studios', fallbackUrl: 'https://www.mississippistudios.com/events' },
      alias: /mississippi studios/i,
    },
    'Polaris Hall': {
      area: 'town',
      capacity: 300,
      type: 'concert',
      cssVar: '--v-polaris',
      color: '#86ea8e',
      url: 'https://www.polarishall.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.polarishall.com&sz=128',
      tm: { id: 'Z7r9jZadc-', match: 'polaris hall', fallbackUrl: 'https://www.polarishall.com/events' },
      alias: /polaris hall/i,
    },
    'Alberta Rose Theatre': {
      area: 'town',
      capacity: 300,
      type: 'concert',
      cssVar: '--v-albertarose',
      color: '#ab86ea',
      url: 'https://www.albertarosetheatre.com/events',
      icon: 'https://www.google.com/s2/favicons?domain=www.albertarosetheatre.com&sz=128',
      tm: { id: 'KovZpa4spe', match: 'alberta rose', fallbackUrl: 'https://www.albertarosetheatre.com/events' },
      alias: /alberta rose/i,
    },
    'Siren Theater': { // Old Town's improv and comedy house — its shows are sold on Merc Tickets (2026-10-19)
      area: 'town',
      type: 'arts',
      cssVar: '--v-siren',
      color: '#ea86c8',
      url: 'https://www.sirentheater.com/',
      icon: 'https://www.google.com/s2/favicons?domain=www.sirentheater.com&sz=128',
      alias: /siren theat(?:er|re)/i,
    },
    'The Hangar at Oaks Park': { // the hall at Oaks Amusement Park — the derby bouts are sold on the same Bold Type list as Merc Tickets (2026-10-19)
      area: 'town',
      type: 'sports', // roller derby: the Rose City Rollers' bouts
      cssVar: '--v-hangar',
      color: '#86d4ea',
      url: 'https://www.oakspark.com/',
      icon: 'https://www.google.com/s2/favicons?domain=www.oakspark.com&sz=128',
      alias: /hangar at oaks|oaks amusement park/i,
    },
    'McMenamins Edgefield': {
      area: 'town',
      capacity: 5000,
      type: 'concert',
      cssVar: '--v-edgefield',
      color: '#eac886',
      url: 'https://www.mcmenamins.com/edgefield/concerts',
      icon: 'https://www.google.com/s2/favicons?domain=www.mcmenamins.com&sz=128',
      tm: { id: 'KovZpZA1vFlA', match: 'edgefield', fallbackUrl: 'https://www.mcmenamins.com/edgefield/concerts', exclude: /parking/i },
      alias: /edgefield/i,
    },
    'ilani': {
      area: 'town',
      capacity: 2500,
      type: 'concert',
      cssVar: '--v-ilani',
      color: '#86eae6',
      url: 'https://www.ilaniresort.com/entertainment',
      icon: 'https://www.google.com/s2/favicons?domain=www.ilaniresort.com&sz=128',
      tm: { id: 'KovZ917Ah8z', match: 'ilani', fallbackUrl: 'https://www.ilaniresort.com/entertainment' },
      alias: /ilani/i,
    },
    'Hillsboro Stadium': {
      area: 'town',
      capacity: 7600,
      type: 'sports',
      cssVar: '--v-hillsborostadium',
      color: '#ea86d0',
      url: 'https://www.hillsboro-oregon.gov/our-city/departments/parks-recreation/facilities/hillsboro-stadium',
      icon: 'https://www.google.com/s2/favicons?domain=www.hillsboro-oregon.gov&sz=128',
      tm: { id: 'KovZpZAaIAIA', match: 'hillsboro stadium', fallbackUrl: 'https://www.hillsboro-oregon.gov/our-city/departments/parks-recreation/facilities/hillsboro-stadium', exclude: /parking/i },
      alias: /hillsboro stadium/i,
    },
    'Hops Ballpark': {
      area: 'town',
      capacity: 4500,
      type: 'sports',
      cssVar: '--v-hops',
      color: '#b3ea86',
      url: 'https://www.milb.com/hillsboro/schedule',
      icon: 'https://www.google.com/s2/favicons?domain=www.milb.com&sz=128',
      alias: /hops ballpark|ron tonkin field|hillsboro ballpark/i,
    },
  };

  // The usual view: every room on — nothing here lists nightly bar programs
  var DEFAULT_ON = ['Moda Center', 'Veterans Memorial Coliseum', 'Providence Park', 'Keller Auditorium', 'Arlene Schnitzer Concert Hall', 'Newmark Theatre', 'Crystal Ballroom', 'Roseland Theater', 'Revolution Hall', 'Wonder Ballroom', 'Aladdin Theater', 'Star Theater', 'Hawthorne Theatre', 'Mississippi Studios', 'Polaris Hall', 'Alberta Rose Theatre', 'Siren Theater', 'The Hangar at Oaks Park', 'McMenamins Edgefield', 'ilani', 'Hillsboro Stadium', 'Hops Ballpark'];
  var DEFAULT_OFF = [];
  var PREFS_KNOWN_FROM = null; // no default-off venue yet, so nothing for saved prefs to be told about

  // Event types: every event lands in exactly one, from its flags, title,
  // then venue. The rows the panel shows, in order.
  var TYPES = [
    { key: 'concert', label: 'Concerts', title: 'Live music — arena tours to club nights' },
    { key: 'sports', label: 'Sports', title: 'Trail Blazers, Timbers, Thorns, Winterhawks and Hops home games' },
    { key: 'arts', label: 'Arts & Theater', title: 'Broadway in Portland, the Oregon Symphony, the ballet and the opera, comedy, dance' },
    { key: 'community', label: 'Community', title: 'Festivals, fairs, family days' },
  ];
  var MOVIE_VENUE = null; // no cinema here

  // Share codes (?f=CODE): REGISTRY is every filterable key in a fixed
  // order and a code is a bitmask over it, so the list is APPEND-ONLY —
  // adding an entry adds a bit and every existing code keeps meaning what
  // it meant; removing or reordering one changes every link out there.
  // 33 slots from the first build: 7 base-36 digits.
  var CODE_LENGTH = 7;
  var REGISTRY = [
    ['venue', 'Moda Center'], ['venue', 'Veterans Memorial Coliseum'], ['venue', 'Providence Park'], ['venue', 'Keller Auditorium'], ['venue', 'Arlene Schnitzer Concert Hall'], ['venue', 'Newmark Theatre'], ['venue', 'Crystal Ballroom'], ['venue', 'Roseland Theater'], ['venue', 'Revolution Hall'], ['venue', 'Wonder Ballroom'], ['venue', 'Aladdin Theater'], ['venue', 'Star Theater'], ['venue', 'Hawthorne Theatre'], ['venue', 'Mississippi Studios'], ['venue', 'Polaris Hall'], ['venue', 'Alberta Rose Theatre'], ['venue', 'McMenamins Edgefield'], ['venue', 'ilani'], ['venue', 'Hillsboro Stadium'], ['venue', 'Hops Ballpark'],
    ['badge', 'concert'], ['badge', 'sports'], ['badge', 'arts'], ['badge', 'community'],
    ['team', 'blazers'], ['team', 'timbers'], ['team', 'thorns'], ['team', 'winterhawks'], ['team', 'hops'],
    ['cap', 'stadium'], ['cap', 'arena'], ['cap', 'hall'], ['cap', 'room'],
    ['venue', 'Siren Theater'], ['venue', 'The Hangar at Oaks Park'], // appended 2026-10-19 (35 slots, still 7 digits)
  ];

  // The words the page uses for the place
  var WORDS = {
    teamCity: 'Portland', // the board drops it from the clubs' names ("Portland Timbers" → Timbers)
    presetDefault: 'Every room — the Rose Quarter, Providence Park, the Portland\'5 halls, the music rooms and the towns around — every team and type',
    presetNeighborhood: 'The Rose Quarter, Providence Park and the Portland\'5 halls only',
    presetBig: 'Only the places that hold 2,000 or more — the arenas, the stadium and the big halls',
    phrases: { all: 'Showing everything.', none: 'Showing nothing yet — open Filter and pick some venues.', neighborhood: 'Showing the Rose Quarter, Providence Park and the Portland\'5 halls only.', big: 'Showing the big rooms only — the arenas, the stadium and the big halls.' },
  };

  global.LQACity = {
    key: 'portland',
    name: 'Portland',
    site: 'https://portland.here.events/',
    userAgent: 'Mozilla/5.0 (compatible; portland-events/1.0; +https://portland.here.events/)',
    tz: 'America/Los_Angeles', tzName: 'Pacific', // the city's time zone: the ICS feed's TZID, the game clocks, the poster's footer
    state: "Oregon", stateOutline: 'M13.3 19.3L12.6 19.3L12.0 19.3L11.3 19.3L10.6 19.3L10.0 19.3L9.3 19.3L8.7 19.3L8.0 19.3L7.4 19.3L6.7 19.3L6.1 19.3L5.4 19.3L4.8 19.3L4.1 19.3L3.4 19.3L2.8 19.3L2.5 18.9L2.3 18.3L2.3 18.0L2.3 17.3L2.2 17.0L2.0 16.5L2.1 16.1L2.2 15.8L2.5 14.7L2.5 14.6L2.7 14.6L2.9 14.4L2.8 14.3L2.6 14.4L2.7 14.0L2.9 13.6L3.0 13.5L3.0 12.2L3.1 11.2L3.2 10.9L3.2 10.6L3.2 10.1L3.2 9.7L3.5 7.5L3.4 7.3L3.5 6.9L3.4 6.0L3.5 5.0L3.4 4.8L3.4 4.7L3.4 4.7L3.6 4.8L4.1 4.8L4.5 4.7L4.7 4.7L4.8 4.9L5.0 5.0L5.3 4.9L5.5 4.8L5.7 4.9L6.0 5.1L6.2 5.5L6.4 6.3L6.5 6.6L6.7 6.8L6.9 6.8L7.8 6.9L7.9 6.9L7.9 6.9L8.1 6.8L8.6 6.5L9.1 6.4L9.8 6.5L10.2 6.5L10.3 6.7L10.7 6.7L11.5 6.5L12.4 6.4L12.9 6.3L13.4 6.0L14.7 5.7L15.3 5.7L15.6 5.5L15.7 5.5L15.7 5.5L16.4 5.5L17.1 5.5L17.7 5.5L18.4 5.5L19.0 5.5L19.7 5.5L20.3 5.5L21.0 5.5L21.0 5.6L21.3 5.9L21.7 6.2L21.9 6.4L22.0 6.7L21.8 7.3L21.4 8.3L21.1 9.0L21.1 9.3L20.8 9.7L20.4 10.4L20.2 10.9L20.2 11.2L20.4 11.4L20.6 11.4L20.8 11.5L20.9 11.7L20.9 11.8L20.8 12.0L20.8 12.1L20.8 12.3L20.8 12.5L20.7 13.0L20.7 13.1L20.7 13.9L20.7 14.7L20.7 15.5L20.7 16.2L20.7 17.0L20.7 17.8L20.7 18.5L20.7 19.3L19.7 19.3L18.8 19.3L17.9 19.3L17.0 19.3L16.0 19.3L15.1 19.3L14.2 19.3L13.3 19.3Z', // the masthead's small state, linking to here.events (scripts/state-outline.mjs, Natural Earth 1:50m)
    // the calendar feed's header; the UID domain never changes (changing it
    // re-creates every event in subscribers' calendars)
    ics: { name: 'Portland Events', short: 'Portland Events', teams: 'Portland home teams — every season', prodid: '-//here.events//portland-events//EN', uidDomain: 'fosdal.net', // the UID domain the whole family issues (the shared ics test pins it)
      desc: 'Upcoming events around Portland\\, OR — the Moda Center\\, the Coliseum\\, Providence Park\\, the Portland\'5 halls and the music rooms' },
    teams: TEAMS,
    venues: VENUES,
    defaultOn: DEFAULT_ON,
    defaultOff: DEFAULT_OFF,
    prefsKnownFrom: PREFS_KNOWN_FROM,
    types: TYPES,
    movieVenue: MOVIE_VENUE,
    // city-wide listings (scripts/feeds.mjs): Merc Tickets read by the room and town in its Venue cell — its
    // city buttons are loose (Steve, 2026-10-19: "use the location here"); only rooms with a row are kept
    feeds: [
      { kind: 'boldtype', label: 'Merc Tickets', url: 'https://www.merctickets.com', city: '', rooms: /(?:siren theat|hangar at oaks|alberta rose).*\bPortland, OR\b/i, drop: /season (?:tickets?|pass(?:es)?)|gift card/i },
    ],
    groundsVenue: null, // every listing is read by room, so nothing arrives under a name city.js lacks
    codeLength: CODE_LENGTH,
    registry: REGISTRY,
    words: WORDS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
