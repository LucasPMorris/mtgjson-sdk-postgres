export { MtgjsonSDK } from "./client.js";
export type { MtgjsonSDKOptions } from "./client.js";

export {
	CardQuery,
	SetQuery,
	TokenQuery,
	PriceQuery,
	LegalityQuery,
	IdentifierQuery,
	DeckQuery,
	SealedQuery,
	SkuQuery,
	EnumQuery,
} from "./queries/index.js";

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
	// Set models
	DeckSet,
	SetList,
	SealedProduct,
	DeckList,
	Deck,
	// File models
	AllPricesFile,
	AllPrintingsFile,
} from "./types/index.js";
