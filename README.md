# Portland Events

Event feed and calendar for Portland: the Moda Center, the Veterans Memorial
Coliseum, Providence Park, the Portland'5 halls (the Schnitz, the Keller, the
Newmark), the ballrooms and clubs across the city, and Edgefield, ilani and
Hillsboro — with the home teams' seasons (Trail Blazers, Timbers, Thorns,
Winterhawks, Hops) in a Teams view.

Live at **https://portland.here.events/** once the domain is wired (GitHub
Pages, built by the Actions workflow once a day at noon Pacific).

The fourth city on the lqa-events codebase, after Everett and Chicago:
everything that makes this Portland's is `site/city.js` (every team, venue,
type, default, share-code registry and string), `site/index.html`,
`scripts/fetch-events.mjs` (the sources), `site/embed.js`, `outlook.json`,
`scripts/data/postseason.json`, the manifest and icons (the city flag,
rendered from `favicon.svg`). Everything else is lqa-events' own, byte for
byte — copy from there, never edit here.

## Embed

```html
<div id="portland-events"></div>
<script src="https://portland.here.events/embed.js" data-max="8" defer></script>
```

## Sources

- **Ticketmaster Discovery API** — every room by its venue id (every page):
  19 rooms, from the Moda Center to the 300-seat clubs. There is no city
  sweep (the Chicago rule: the API stops a query at its thousandth event).
  Church events are left out (`isChurch`).
- **Seasons** — ESPN for the Blazers, Timbers and Thorns; HockeyTech for the
  Winterhawks (WHL); MLB's stats API, `sportId=13`, for the Hops (Northwest
  League), whose home games are injected into the listing since no ticket
  feed carries them (`scripts/schedules.mjs`, shared with lqa).

Next to add: the rooms whose shows Ticketmaster never lists (the Doug Fir,
Holocene, the Get Down, Dante's), the Oregon Symphony's and Portland Opera's
own calendars, Pioneer Courthouse Square and the city's festivals (Rose
Festival, Waterfront Blues, Pickathon).

## Local run

```sh
cp .env.example .env   # TICKETMASTER_API_KEY=…
ALLOW_NO_ARCHIVE=1 node scripts/fetch-events.mjs   # ALLOW_NO_ARCHIVE only until the site has published once
node --test scripts/*.test.mjs
```
