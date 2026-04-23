import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Base URL for the MTGJSON v5 API / CDN. */
export const CDN_BASE = "https://mtgjson.com/api/v5";

/** Mapping of logical view names to CDN parquet file paths. */
export const PARQUET_FILES: Record<string, string> = {
	cards: "parquet/cards.parquet",
	tokens: "parquet/tokens.parquet",
	sets: "parquet/sets.parquet",
	card_identifiers: "parquet/cardIdentifiers.parquet",
	card_legalities: "parquet/cardLegalities.parquet",
	card_foreign_data: "parquet/cardForeignData.parquet",
	card_rulings: "parquet/cardRulings.parquet",
	card_purchase_urls: "parquet/cardPurchaseUrls.parquet",
	set_translations: "parquet/setTranslations.parquet",
	token_identifiers: "parquet/tokenIdentifiers.parquet",
	set_booster_content_weights: "parquet/setBoosterContentWeights.parquet",
	set_booster_contents: "parquet/setBoosterContents.parquet",
	set_booster_sheet_cards: "parquet/setBoosterSheetCards.parquet",
	set_booster_sheets: "parquet/setBoosterSheets.parquet",
	all_printings: "parquet/AllPrintings.parquet",      // Full nested
	all_prices_today: "parquet/AllPricesToday.parquet",
	all_prices: "parquet/AllPrices.parquet",
	tcgplayer_skus: "parquet/TcgplayerSkus.parquet",
};

/** Mapping of logical data names to CDN JSON file paths. */
export const JSON_FILES: Record<string, string> = {
	keywords:         "Keywords.json",
	card_types:       "CardTypes.json",
	deck_list:        "DeckList.json",
	enum_values:      "EnumValues.json",
	set_list:         "SetList.json",
	meta:             "Meta.json",
	all_prices:       "AllPrices.json",
	all_prices_today: "AllPricesToday.json",
};

/** URL for the MTGJSON version metadata endpoint. */
export const META_URL = `${CDN_BASE}/Meta.json`;

/** Platform-appropriate cache directory. */
export function defaultCacheDir(): string {
	const sys = platform();
	let base: string;
	if (sys === "win32") { base = join(homedir(), "AppData", "Local"); }
  else if (sys === "darwin") { base = join(homedir(), "Library", "Caches"); }
  else { base = join(homedir(), ".cache"); } return join(base, "mtgjson-sdk");
}
