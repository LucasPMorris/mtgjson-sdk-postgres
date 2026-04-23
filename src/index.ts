export { MtgjsonSDK } from "./client.js";
export type { MtgjsonSDKOptions } from "./client.js";

export { seedDatabase, seedSingleSet, seedCatalogs } from "./seeder.js";
export type { SeedResult, SeedOptions, SeedProgress } from "./seeder.js";
export { checkForSetUpdates, applySetUpdates, refreshMaterializedViews } from "./updater.js";
export type { SetListEntry, UpdateCheckResult, UpdateResult, UpdateProgress } from "./updater.js";
export { ensurePricingSchema, updatePricingFull, updatePricingToday } from "./pricing.js";
export type { UpdatePricingOptions, UpdatePricingResult } from "./pricing.js";

export { CardQuery, CardPaginator, SetQuery, TokenQuery,	PriceQuery,	unpackDims, LegalityQuery, IdentifierQuery, DeckQuery, DeckPaginator, SealedQuery, SkuQuery,	EnumQuery, CollectionQuery, CollectionPaginator, setNameCollation, getNameCollation } from "./queries/index.js";
export type { UnpackedDims, CurrentPriceRow, HistoryPoint, HistoryRow, PriceSummaryRow, DeckSearchOptions, DeckSummarySearchOptions, DeckSummarySortField } from "./queries/index.js";
export { BoosterSimulator } from "./booster/simulator.js";
export { SQLBuilder } from "./sql-builder.js";
export { Connection } from "./connection.js";
export { CacheManager } from "./cache.js";
export type { ProgressCallback } from "./cache.js";

export type {
	// Sub-models
	ForeignData,
	Identifiers,
	LeadershipSkills,
	Legalities,
	PurchaseUrls,
	RelatedCards,
	Rulings,
	SourceProducts,
	Meta,
	Translations,
	TcgplayerSkus,
	BoosterSheet,
	BoosterPack,
	BoosterConfig,
	PricePoints,
	PriceList,
	PriceFormats,
	SealedProductCard,
	SealedProductDeck,
	SealedProductOther,
	SealedProductPack,
	SealedProductSealed,
	SealedProductContents,
	Keywords,
	CardType,
	CardTypes,
	// Card models
	CardSetDeck,
	CardToken,
	CardAtomic,
	CardSet,
	CardDeck,
	CollectionItemCard,
	// Deck models
	DeckStats,
	DeckCardEntry,
	DeckCard,
	DeckToken,
	DeckBoards,
	DeckSummary,
	PreconDeck,
	// Set models (deprecated deck types kept for backward compat)
	DeckSet,
	SetList,
	SealedProduct,
	DeckList,
	Deck,
	// File models
	AllPricesFile,
	AllPrintingsFile,
} from "./types/index.js";
