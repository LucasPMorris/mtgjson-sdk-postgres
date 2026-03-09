# mtgjson-sdk

// TODO: Change this to `A Postgres-backed TypeScript query client...`
A DuckDB-backed TypeScript query client for [MTGJSON](https://mtgjson.com) card data. Auto-downloads Parquet data from the MTGJSON CDN and exposes the full Magic: The Gathering dataset through a fully-typed async API.

## Install (After Compiling)

```js
// In MTGJSON-SDK-POSTGRESS
npm run build && npm pack

// In the App:
npm install ../mtgjson-sdk-postgres/mtgjson-sdk-0.1.0.tgz
```

## Quick Start

```typescript
import { MtgjsonSDK } from "mtgjson-sdk";

const sdk = await MtgjsonSDK.create();

// Search for cards
const bolts = await sdk.cards.getByName("Lightning Bolt");
console.log(`Found ${bolts.length} printings of Lightning Bolt`);

// Get a specific set
const mh3 = await sdk.sets.get("MH3");
if (mh3) { console.log(`${mh3.name} -- ${mh3.totalSetSize} cards`); }

// Check format legality
const isLegal = await sdk.legalities.isLegal(bolts[0].uuid, "modern");
console.log(`Modern legal: ${isLegal}`);

// Find the cheapest printing
const cheapest = await sdk.prices.cheapestPrinting("Lightning Bolt");
if (cheapest) { console.log(`Cheapest: $${cheapest.price} (${cheapest.setCode})`); }

// Raw SQL for anything else
const rows = await sdk.sql("SELECT name, manaValue FROM cards WHERE manaValue = $1 LIMIT 5", [0]);

await sdk.close();
```

## Use Cases

### Price Tracking

```typescript
const sdk = await MtgjsonSDK.create();

// Find the cheapest printing of any card
const cheapest = await sdk.prices.cheapestPrinting("Ragavan, Nimble Pilferer");

// Price trend over time
if (cheapest) {
  const trend = await sdk.prices.priceTrend(cheapest.uuid, {
    provider: "tcgplayer",
    finish: "normal",
  });
  console.log(`Range: $${trend.min_price} - $${trend.max_price}`);
  console.log(`Average: $${trend.avg_price} over ${trend.data_points} data points`);

  // Full price history with date range
  const history = await sdk.prices.history(cheapest.uuid, {
    provider: "tcgplayer",
    dateFrom: "2024-01-01",
    dateTo: "2024-12-31",
  });

  // Most expensive printings across the entire dataset
  const priciest = await sdk.prices.mostExpensivePrintings({ limit: 10 });
}

await sdk.close();
```

### Deck Building Helper

```typescript
const sdk = await MtgjsonSDK.create();

// Find modern-legal red creatures with CMC <= 2
const aggroCreatures = await sdk.cards.search({
  colors: ["R"],
  types: "Creature",
  manaValueLte: 2.0,
  legalIn: "modern",
  limit: 50,
});

// Check what's banned
const banned = await sdk.legalities.bannedIn("modern");
console.log(`${banned.length} cards banned in Modern`);


const flyers = await sdk.cards.search({ keyword: "Flying", colors: ["W", "U"], legalIn: "standard" }); // Search by keyword ability
const results = await sdk.cards.search({  fuzzyName: "Ligtning Bolt" }); // Fuzzy search -- handles typos, still finds it!
const blitz = await sdk.cards.search({ localizedName: "Blitzschlag" }); // German for Lightning Bolt

await sdk.close();
```

### Collection Management

```typescript
const sdk = await MtgjsonSDK.create();

// Cross-reference by Scryfall ID
const cards = await sdk.identifiers.findByScryfallId("f7a21fe4-...");

// Look up by TCGPlayer product ID
const tcgCards = await sdk.identifiers.findByTcgplayerId("12345");

// Get all identifiers for a card (Scryfall, TCGPlayer, MTGO, Arena, etc.)
const allIds = await sdk.identifiers.getIdentifiers("card-uuid-here");

// Export to a standalone DuckDB file for offline analysis
await sdk.exportDb("my_collection.duckdb");
// Now query with: duckdb my_collection.duckdb "SELECT * FROM cards LIMIT 5"

await sdk.close();
```

### Booster Pack Simulation

```typescript
const sdk = await MtgjsonSDK.create();

// See what booster types are available
const types = await sdk.booster.availableTypes("MH3"); // ["draft", "collector", ...]

// Open a single draft pack
const pack = await sdk.booster.openPack("MH3", "draft");
for (const card of pack) {
  console.log(`  ${card.name} (${card.rarity})`);
}

// Open an entire box
const box = await sdk.booster.openBox("MH3", "draft", 36);
const totalCards = box.reduce((sum, p) => sum + p.length, 0);
console.log(`Opened ${box.length} packs, ${totalCards} total cards`);

await sdk.close();
```

## API Reference

### Cards

```typescript
await sdk.cards.getByUuid("uuid")                     // -> CardSet | null
await sdk.cards.getByUuids(["uuid1", "uuid2"])        // -> CardSet[]
await sdk.cards.getByName("Lightning Bolt")           // -> CardSet[]
await sdk.cards.getByName("Lightning Bolt", { setCode: "A25" })
await sdk.cards.search({
  name: "Lightning%",              // name pattern (% = wildcard)
  fuzzyName: "Ligtning Bolt",     // typo-tolerant (Jaro-Winkler)
  localizedName: "Blitzschlag",   // foreign-language name search
  colors: ["R"],                   // cards containing these colors
  colorIdentity: ["R", "U"],      // filter by color identity
  legalIn: "modern",              // format legality
  rarity: "rare",                 // rarity filter
  manaValue: 1.0,                 // exact mana value
  manaValueLte: 3.0,             // mana value range
  manaValueGte: 1.0,
  text: "damage",                 // rules text search
  textRegex: "deals? \\d+ damage",// regex rules text search
  types: "Creature",              // type line search
  artist: "Christopher Moeller",  // artist name search
  keyword: "Flying",              // keyword ability
  isPromo: false,                 // promo status
  availability: "paper",          // paper, mtgo
  language: "English",            // language filter
  layout: "normal",               // card layout
  setCode: "MH3",                // filter by set
  setType: "expansion",           // set type (joins sets table)
  power: "3",                     // P/T filter
  toughness: "3",
  limit: 100,                     // pagination
  offset: 0,
})                                                     // -> CardSet[]
await sdk.cards.getPrintings("Lightning Bolt")         // all printings across sets
await sdk.cards.getAtomic("Lightning Bolt")            // oracle data (no printing info)
await sdk.cards.getAtomic("Fire")                      // works with face names (split/MDFC)
await sdk.cards.findByScryfallId("...")                // cross-reference
await sdk.cards.random(5)                              // random cards
await sdk.cards.count()                                // total count
await sdk.cards.count({ setCode: "MH3", rarity: "rare" })  // filtered count
```

### Tokens

```typescript
await sdk.tokens.getByUuid("uuid")                    // -> CardToken | null
await sdk.tokens.getByName("Soldier")                 // -> CardToken[]
await sdk.tokens.search({
  name: "%Token", setCode: "MH3", colors: ["W"],
})
await sdk.tokens.forSet("MH3")                        // all tokens for a set
await sdk.tokens.count()
```

### Sets

```typescript
await sdk.sets.get("MH3")                             // -> SetList | null
await sdk.sets.list({ setType: "expansion" })          // -> SetList[]
await sdk.sets.search({
  name: "Horizons", releaseYear: 2024,
})
await sdk.sets.getFinancialSummary("MH3", {            // -> financial stats
  provider: "tcgplayer",
  currency: "USD",
  finish: "normal",
  category: "retail",
})
await sdk.sets.count()
```

### Identifiers

```typescript
await sdk.identifiers.findByScryfallId("...")
await sdk.identifiers.findByTcgplayerId("...")
await sdk.identifiers.findByMtgoId("...")
await sdk.identifiers.findByMtgoFoilId("...")
await sdk.identifiers.findByMtgArenaId("...")
await sdk.identifiers.findByMultiverseId("...")
await sdk.identifiers.findByMcmId("...")
await sdk.identifiers.findByMcmMetaId("...")
await sdk.identifiers.findByCardKingdomId("...")
await sdk.identifiers.findByCardKingdomFoilId("...")
await sdk.identifiers.findByCardKingdomEtchedId("...")
await sdk.identifiers.findByCardsphereId("...")
await sdk.identifiers.findByCardsphereFoilId("...")
await sdk.identifiers.findByScryfallOracleId("...")
await sdk.identifiers.findByScryfallIllustrationId("...")
await sdk.identifiers.findByTcgplayerEtchedId("...")
await sdk.identifiers.findBy("scryfallId", "...")      // generic lookup
await sdk.identifiers.getIdentifiers("uuid")           // all IDs for a card
```

### Legalities

```typescript
await sdk.legalities.formatsForCard("uuid")            // -> { modern: "Legal", ... }
await sdk.legalities.legalIn("modern")                 // all modern-legal cards
await sdk.legalities.isLegal("uuid", "modern")         // -> boolean
await sdk.legalities.bannedIn("modern")                // banned cards
await sdk.legalities.restrictedIn("vintage")           // restricted cards
await sdk.legalities.suspendedIn("historic")           // suspended cards
await sdk.legalities.notLegalIn("standard")            // not-legal cards
```

### Prices

```typescript
await sdk.prices.get("uuid")                           // full nested price data
await sdk.prices.today("uuid", {                       // latest prices
  provider: "tcgplayer", finish: "foil",
})
await sdk.prices.history("uuid", {                     // historical prices
  provider: "tcgplayer",
  dateFrom: "2024-01-01",
  dateTo: "2024-12-31",
})
await sdk.prices.priceTrend("uuid")                    // min/max/avg statistics
await sdk.prices.cheapestPrinting("Lightning Bolt")    // cheapest printing by name
await sdk.prices.cheapestPrintings({ limit: 10 })      // N cheapest cards overall
await sdk.prices.mostExpensivePrintings({ limit: 10 }) // most expensive cards
```

### Decks

```typescript
await sdk.decks.list({ setCode: "MH3" })
await sdk.decks.search({ name: "Eldrazi" })
await sdk.decks.count()
```

### Sealed Products

```typescript
await sdk.sealed.list({ setCode: "MH3" })
await sdk.sealed.get("uuid")
```

### SKUs

```typescript
await sdk.skus.get("uuid")                             // TCGPlayer SKUs for a card
await sdk.skus.findBySkuId(123456)
await sdk.skus.findByProductId(789)
```

### Booster Simulation

```typescript
await sdk.booster.availableTypes("MH3")                // -> string[]
await sdk.booster.openPack("MH3", "draft")             // -> CardSet[]
await sdk.booster.openBox("MH3", "draft", 36)          // -> CardSet[][]
await sdk.booster.sheetContents("MH3", "draft", "common")  // card weights
```

### Enums

```typescript
await sdk.enums.keywords()                             // -> Keywords
await sdk.enums.cardTypes()                            // -> CardTypes
await sdk.enums.enumValues()                           // all enum values
```

### Metadata & Utilities

```typescript
await sdk.meta                                         // -> Record<string, unknown>
sdk.views                                              // -> string[]
await sdk.refresh()                                    // check for new data -> boolean
await sdk.sql("SELECT ...", [param1, param2])          // raw parameterized SQL ($1, $2, ...)
await sdk.exportDb("output.duckdb")                    // export to persistent DuckDB file
await sdk.close()                                      // release resources
```

## Advanced Usage

### Async Factory Pattern

The SDK uses an async factory since DuckDB initialization is asynchronous:

```typescript
import { MtgjsonSDK } from "mtgjson-sdk";

// Create with custom options
const sdk = await MtgjsonSDK.create({
  cacheDir: "/data/mtgjson-cache",
  offline: false,
  timeout: 300_000,
  onProgress: (filename, downloaded, total) => {
    const pct = total ? ((downloaded / total) * 100).toFixed(1) : "?";
    process.stdout.write(`\r${filename}: ${pct}%`);
  },
});
```

### Automatic Resource Cleanup

The SDK supports `Symbol.asyncDispose` for automatic cleanup with `await using`:

```typescript
{
  await using sdk = await MtgjsonSDK.create();

  const cards = await sdk.cards.search({ name: "Lightning%" });
  console.log(cards.length);

  // sdk.close() is called automatically when the block exits
}
```

### Database Export

Export all loaded data to a standalone DuckDB file that can be queried without the SDK:

```typescript
const sdk = await MtgjsonSDK.create();

// Touch the query modules you want exported
await sdk.cards.count();
await sdk.sets.count();

// Export to file
await sdk.exportDb("mtgjson.duckdb");

// Now use it standalone:
// $ duckdb mtgjson.duckdb "SELECT name, setCode FROM cards LIMIT 10"

await sdk.close();
```

### Web API Example

```typescript
import { MtgjsonSDK } from "mtgjson-sdk";
import express from "express";

const app = express();
const sdk = await MtgjsonSDK.create();

app.get("/card/:name", async (req, res) => {
  const cards = await sdk.cards.getByName(req.params.name);
  res.json(cards);
});

app.get("/health", async (_req, res) => {
  const refreshed = await sdk.refresh();
  res.json({ refreshed, views: sdk.views });
});

process.on("SIGTERM", async () => {
  await sdk.close();
  process.exit(0);
});

app.listen(3000, () => console.log("Listening on :3000"));
```

### Raw SQL

All user input goes through DuckDB parameter binding (`$1`, `$2`, ...) to prevent SQL injection:

```typescript
const sdk = await MtgjsonSDK.create();

// Ensure views are registered before querying
await sdk.cards.count();

// Parameterized queries
const rows = await sdk.sql( "SELECT name, setCode, rarity FROM cards WHERE manaValue <= $1 AND rarity = $2", [2, "mythic"] );

// Complex analytics
const stats = await sdk.sql(`
  SELECT setCode, COUNT(*) as card_count, AVG(manaValue) as avg_cmc
  FROM cards
  GROUP BY setCode
  ORDER BY card_count DESC
  LIMIT 10
`);
```

### Auto-Refresh for Long-Running Services

The `refresh()` method checks the CDN for new MTGJSON releases. If a newer version is available, it clears internal state so the next query re-downloads fresh data:

```typescript
// In a scheduled task or health check:
const refreshed = await sdk.refresh();
if (refreshed) {
  console.log("New MTGJSON data detected -- cache refreshed");
}
```

## Examples

### Next.js Card Search (`examples/next-search`)

A full-stack web application built with Next.js 15 and Tailwind CSS that demonstrates the SDK in a server-side rendered context. Features a card search interface with fuzzy matching, filters (color, rarity, type, set, format legality), card detail pages, and responsive image grids powered by Scryfall.

**SDK features demonstrated:**

| Feature | SDK Method |
|---------|-----------|
| Fuzzy card search with filters | `sdk.cards.search({ fuzzyName, colors, rarity, types, setCode, legalIn })` |
| Total result count with pagination | `sdk.cards.count()` |
| Random cards on the home page | `sdk.cards.random()` |
| Card detail lookup | `sdk.cards.getByUuid()` |
| All printings across sets | `sdk.cards.getPrintings()` |
| Cross-system identifier lookup | `sdk.identifiers.getIdentifiers()` |
| Format legality table | `sdk.legalities.formatsForCard()` |
| Retail price data by provider | `sdk.prices.today()` |
| Set list for autocomplete filter | `sdk.sets.list()` |
| Data version attribution | `sdk.meta` |

```bash
cd examples/next-search
bun install
bun run dev
# Open http://localhost:3000
```

> **Note:** The SDK must be built first (`bun run build` in the repo root). First page load downloads parquet data from the MTGJSON CDN (~30s cold start), subsequent loads use the local cache.

## Architecture

```
MTGJSON CDN (Parquet + JSON files)
        |
        | auto-download on first access
        v
Local Cache (platform-specific directory)
        |
        | lazy view registration
        v
DuckDB In-Memory Database
        |
        | parameterized SQL queries
        v
Typed TypeScript API (interfaces / Record<string, unknown>)
```

**How it works:**

1. **Auto-download**: On first use, the SDK downloads ~15 Parquet files and ~7 JSON files from the MTGJSON CDN to a platform-specific cache directory (`~/.cache/mtgjson-sdk` on Linux, `~/Library/Caches/mtgjson-sdk` on macOS, `AppData/Local/mtgjson-sdk` on Windows).

2. **Lazy loading**: DuckDB views are registered on-demand -- accessing `sdk.cards` triggers the cards view, `sdk.prices` triggers price data loading, etc. Only the data you use gets loaded into memory.

3. **Schema adaptation**: The SDK auto-detects array columns in parquet files using a hybrid heuristic (static baseline + dynamic plural detection + blocklist), so it adapts to upstream MTGJSON schema changes without code updates.

4. **Legality UNPIVOT**: Format legality columns are dynamically detected from the parquet schema and UNPIVOTed to `(uuid, format, status)` rows -- automatically scales to new formats.

5. **Price flattening**: Deeply nested JSON price data is streamed to NDJSON and bulk-loaded into DuckDB, minimizing memory overhead.

## Development

### Prerequisites

- Node.js 18+ or [Bun](https://bun.sh)
- TypeScript 5+

### Setup

Hmm---the actual url is https://github.com/mtgjson/mtgjson-sdk-typescript It being under "the-muppet2" kind of tells you who it is for.

```bash
git clone https://github.com/the-muppet2/mtgjson-sdk-typescript.git
cd mtgjson-sdk-typescript
bun install
```

### Building

```bash
bun run build
bun run typecheck
```

### Running Tests

```bash
# Unit tests (no network required)
bun test

# Watch mode
bun test --watch
```

### Linting

```bash
bun run lint
bun run format
```

### Additional Functions

```typescript
sdk.enums.keywords() 
sdk.checkForUpdates()	    // 1 — fetches SetList.json (~50 KB)
sdk.update()	            // 1 per new set only ({CODE}.json)
```

## License

MIT
