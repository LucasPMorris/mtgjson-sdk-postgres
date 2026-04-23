export type BoosterConfig = { boosters: BoosterPack[]; boostersTotalWeight: number; name?: string; sheets: Record<string, BoosterSheet>; sourceSetCodes: string[] };
export type BoosterPack = { contents: Partial<Record<string, number>>; weight: number };
export type BoosterSheet = { allowDuplicates?: boolean; balanceColors?: boolean; cards: Record<string, number>; fixed?: boolean; foil: boolean; totalWeight: number };

export type CardAtomic = {
  asciiName?: string;
  colorIdentity: string[];
  colorIndicator?: string[];
  colors: string[];
  defense?: string;
  edhrecRank?: number;
  edhrecSaltiness?: number;
  faceManaValue?: number;
  faceName?: string;
  firstPrinting?: string;
  foreignData?: ForeignData[];
  hand?: string;
  hasAlternativeDeckLimit?: boolean;
  identifiers: Identifiers;
  isFunny?: boolean;
  isGameChanger?: boolean;
  isReserved?: boolean;
  keywords?: string[];
  layout: string;
  leadershipSkills?: LeadershipSkills;
  legalities: Legalities;
  life?: string;
  loyalty?: string;
  manaCost?: string;
  manaValue: number;
  name: string;
  power?: string;
  printings?: string[];
  purchaseUrls: PurchaseUrls;
  relatedCards: RelatedCards | null;
  rulings?: Rulings[];
  side?: string;
  subsets?: string[];
  subtypes: string[];
  supertypes: string[];
  text?: string;
  toughness?: string;
  type: string;
  types: string[];
};

export type CardDeck = {
  artist?: string;
  artistIds?: string[];
  asciiName?: string;
  attractionLights?: number[];
  availability: string[];
  boosterTypes?: string[];
  borderColor: string;
  cardParts?: string[];
  colorIdentity: string[];
  colorIndicator?: string[];
  colors: string[];
  count: number;
  defense?: string;
  duelDeck?: string;
  edhrecRank?: number;
  edhrecSaltiness?: number;
  faceFlavorName?: string;
  faceManaValue?: number;
  faceName?: string;
  finishes: string[];
  flavorName?: string;
  flavorText?: string;
  foreignData?: ForeignData[];
  frameEffects?: string[];
  frameVersion: string;
  hand?: string;
  hasAlternativeDeckLimit?: boolean;
  hasContentWarning?: boolean;
  identifiers: Identifiers;
  isAlternative?: boolean;
  isFoil: boolean;
  isFullArt?: boolean;
  isFunny?: boolean;
  isGameChanger?: boolean;
  isOnlineOnly?: boolean;
  isOversized?: boolean;
  isPromo?: boolean;
  isRebalanced?: boolean;
  isReprint?: boolean;
  isReserved?: boolean;
  isStorySpotlight?: boolean;
  isTextless?: boolean;
  isTimeshifted?: boolean;
  keywords?: string[];
  language: string;
  layout: string;
  leadershipSkills?: LeadershipSkills;
  legalities: Legalities;
  life?: string;
  loyalty?: string;
  manaCost?: string;
  manaValue: number;
  name: string;
  number: string;
  originalPrintings?: string[];
  originalReleaseDate?: string;
  originalText?: string;
  originalType?: string;
  otherFaceIds?: string[];
  power?: string;
  printings?: string[];
  promoTypes?: string[];
  purchaseUrls: PurchaseUrls;
  rarity: string;
  rebalancedPrintings?: string[];
  relatedCards: RelatedCards | null;
  rulings?: Rulings[];
  securityStamp?: string;
  setCode: string;
  setName: string;
  side?: string;
  signature?: string;
  sourceProducts?: string[];
  subsets?: string[];
  subtypes: string[];
  supertypes: string[];
  text?: string;
  toughness?: string;
  type: string;
  types: string[];
  uuid: string;
  variations?: string[];
  watermark?: string;
};

export type CardSet = {
  artist?: string;
  artistIds?: string[];
  asciiName?: string;
  attractionLights?: number[];
  availability: string[];
  boosterTypes?: string[];
  borderColor: string;
  cardParts?: string[];
  colorIdentity: string[];
  colorIndicator?: string[];
  colors: string[];
  defense?: string;
  duelDeck?: string;
  edhrecRank?: number;
  edhrecSaltiness?: number;
  faceFlavorName?: string;
  faceManaValue?: number;
  faceName?: string;
  finishes: string[];
  flavorName?: string;
  flavorText?: string;
  foreignData?: ForeignData[];
  frameEffects?: string[];
  frameVersion: string;
  hand?: string;
  hasAlternativeDeckLimit?: boolean;
  hasContentWarning?: boolean;
  identifiers: Identifiers;
  isAlternative?: boolean;
  isFullArt?: boolean;
  isFunny?: boolean;
  isGameChanger?: boolean;
  isOnlineOnly?: boolean;
  isOversized?: boolean;
  isPromo?: boolean;
  isRebalanced?: boolean;
  isReprint?: boolean;
  isReserved?: boolean;
  isStorySpotlight?: boolean;
  isTextless?: boolean;
  isTimeshifted?: boolean;
  keywords?: string[];
  language: string;
  layout: string;
  leadershipSkills?: LeadershipSkills;
  legalities: Legalities;
  life?: string;
  loyalty?: string;
  manaCost?: string;
  manaValue: number;
  name: string;
  number: string;
  originalPrintings?: string[];
  originalReleaseDate?: string;
  originalText?: string;
  originalType?: string;
  otherFaceIds?: string[];
  power?: string;
  printings?: string[];
  promoTypes?: string[];
  purchaseUrls: PurchaseUrls;
  rarity: string;
  rebalancedPrintings?: string[];
  relatedCards: RelatedCards | null;
  rulings?: Rulings[];
  securityStamp?: string;
  setCode: string;
  setName: string;
  side?: string;
  signature?: string;
  sourceProducts?: SourceProducts;
  subsets?: string[];
  subtypes: string[];
  supertypes: string[];
  text?: string;
  toughness?: string;
  type: string;
  types: string[];
  uuid: string;
  variations?: string[];
  watermark?: string;
};

export type CardSetDeck = { count: number; isFoil?: boolean; uuid: string };

export type CardToken = {
  artist?: string;
  artistIds?: string[];
  asciiName?: string;
  attractionLights?: number[];
  availability: string[];
  boosterTypes?: string[];
  borderColor: string;
  cardParts?: string[];
  colorIdentity: string[];
  colorIndicator?: string[];
  colors: string[];
  edhrecSaltiness?: number;
  faceFlavorName?: string;
  faceName?: string;
  finishes: string[];
  flavorName?: string;
  flavorText?: string;
  frameEffects?: string[];
  frameVersion: string;
  identifiers: Identifiers;
  isFullArt?: boolean;
  isFunny?: boolean;
  isOnlineOnly?: boolean;
  isOversized?: boolean;
  isPromo?: boolean;
  isReprint?: boolean;
  isTextless?: boolean;
  keywords?: string[];
  language: string;
  layout: string;
  loyalty?: string;
  manaCost?: string;
  name: string;
  number: string;
  orientation?: string;
  originalText?: string;
  originalType?: string;
  otherFaceIds?: string[];
  power?: string;
  promoTypes?: string[];
  relatedCards?: RelatedCards;
  securityStamp?: string;
  setCode: string;
  setName: string;
  side?: string;
  signature?: string;
  sourceProducts?: string[];
  subsets?: string[];
  subtypes: string[];
  supertypes: string[];
  text?: string;
  tokenProducts?: TokenProducts;
  toughness?: string;
  type: string;
  types: string[];
  uuid: string;
  watermark?: string;
};

export type PriceFormats = { mtgo?: Record<"cardhoarder", PriceList>; paper?: Record<"cardkingdom" | "cardmarket" | "cardsphere" | "tcgplayer", PriceList> };
export type PriceList = { buylist?: PricePoints; currency: string; retail?: PricePoints };
export type PricePoints = { etched?: Record<string, number>; foil?: Record<string, number>; normal?: Record<string, number> };

export type SealedProductCard = { foil?: boolean; name: string; number: string; set: string; uuid: string };
export type SealedProductContents = { card?: SealedProductCard[]; deck?: SealedProductDeck[]; other?: SealedProductOther[]; pack?: SealedProductPack[]; sealed?: SealedProductSealed[]; variable?: Record<"configs", SealedProductContents[]>[] };
export type SealedProductDeck = { name: string; set: string };
export type SealedProductOther = { name: string };
export type SealedProductPack = { code: string; set: string };
export type SealedProductSealed = { count: number; name: string; set: string; uuid: string };

export type CardType =  { subTypes: string[]; superTypes: string[] };
export type CardTypes = { artifact: CardType;    battle: CardType;  conspiracy: CardType;    creature: CardType;  enchantment: CardType;  instant: CardType;  land: CardType;
                          phenomenon: CardType;  plane: CardType;   planeswalker: CardType;  scheme: CardType;    sorcery: CardType;      tribal: CardType;   vanguard: CardType; };

/** @deprecated Use PreconDeck instead */
export type Deck = { code: string; commander?: CardDeck[]; mainBoard: CardDeck[]; name: string; releaseDate: string; sealedProductUuids: string[] | null; sideBoard: CardDeck[]; tokens: CardToken[] | null; type: string };
/** @deprecated Use DeckCardEntry instead */
export type DeckList = { code: string; fileName: string; name: string; releaseDate: string; type: string };
/** @deprecated Use PreconDeck instead */
export type DeckSet = { code: string; commander?: CardSetDeck[]; mainBoard: CardSetDeck[]; name: string; releaseDate: string; sealedProductUuids: string[] | null; sideBoard: CardSetDeck[]; type: string };

/** Precomputed deck statistics. */
export type DeckStats = {
	totalCards: number;
	uniqueCards: number;
	avgManaValue: number;
	landCount: number;
	colorIdentity: string[];
	creatureCount: number;
	instantCount: number;
	sorceryCount: number;
	enchantmentCount: number;
	artifactCount: number;
	planeswalkerCount: number;
	battleCount: number;
	multiTypeCount: number;
};

/** Minimal deck card entry — maps to a set_deck_cards row. */
export type DeckCardEntry = { uuid: string; count: number; isFoil?: boolean; collectionItemUuid: string | null };

/** Hydrated deck card (full card data + deck entry metadata). */
export type DeckCard = CardSet & DeckCardEntry;

/** Hydrated deck token (full token data + deck entry metadata). */
export type DeckToken = CardToken & DeckCardEntry;

/** Generic board structure. sideBoard/tokens optional to support both precon and user decks without type conflicts. */
export type DeckBoards<TCard = DeckCard, TToken = DeckToken> = {
	commander?: TCard[];
	mainBoard: TCard[];
	sideBoard?: TCard[];
	tokens?: TToken[];
};

/** Full hydrated deck — used for both precon and user decks. */
export type PreconDeck = DeckBoards & {
	uuid: string;
	setCode: string | null;
	setName: string | null;
	name: string;
	source: string;
	type: string;
	description: string | null;
	releaseDate: string;
	sealedProductUuids: string[] | null;
	stats: DeckStats | null;
	createdAt: string | null;
	updatedAt: string | null;
};

/**
 * Lightweight deck row for list-scale queries. Carries all set_decks columns plus
 * precomputed per-board totals and a cover art scryfallId so list UIs can render
 * covers and counts without hydrating every card.
 */
export type DeckSummary = {
	uuid: string;
	setCode: string | null;
	setName: string | null;
	name: string;
	source: string;
	type: string;
	description: string | null;
	releaseDate: string;
	sealedProductUuids: string[] | null;
	stats: DeckStats | null;
	createdAt: string | null;
	updatedAt: string | null;
	commanderCount: number;
	mainBoardCount: number;
	sideBoardCount: number;
	coverScryfallId: string | null;
};

export type ForeignData = { faceName?: string; flavorText?: string; identifiers: Identifiers; language: string; name: string; text?: string; type?: string; uuid: string };

export type Identifiers = {
  abuId?: string;
  cardKingdomEtchedId?: string;
  cardKingdomFoilId?: string;
  cardKingdomId?: string;
  cardsphereFoilId?: string;
  cardsphereId?: string;
  cardtraderId?: string;
  csiId?: string;
  mcmId?: string;
  mcmMetaId?: string;
  miniaturemarketId?: string;
  mtgArenaId?: string;
  mtgjsonFoilVersionId?: string;
  mtgjsonNonFoilVersionId?: string;
  mtgjsonV4Id?: string;
  mtgoFoilId?: string;
  mtgoId?: string;
  multiverseId?: string;
  scgId?: string;
  scryfallCardBackId?: string;
  scryfallId?: string;
  scryfallIllustrationId?: string;
  scryfallOracleId?: string;
  tcgplayerAlternativeFoilProductId?: string;
  tcgplayerEtchedProductId?: string;
  tcgplayerProductId?: string;
  tntId?: string;
};

export type Keywords = { abilityWords: string[]; keywordAbilities: string[]; keywordActions: string[] };
export type LeadershipSkills = { brawl: boolean; commander: boolean; oathbreaker: boolean };

export type Legalities = { alchemy?: string;    brawl?: string;     commander?: string;      duel?: string;       explorer?: string;  future?: string;           gladiator?: string;  historic?: string;  historicbrawl?: string;
                           legacy?: string;     modern?: string;    oathbreaker?: string;    oldschool?: string;  pauper?: string;    paupercommander?: string;  penny?: string;      pioneer?: string;   predh?: string;
                           premodern?: string;  standard?: string;  standardbrawl?: string;  timeless?: string;   vintage?: string; };

export type PurchaseUrls = { cardKingdom?: string; cardKingdomEtched?: string; cardKingdomFoil?: string; cardmarket?: string; tcgplayer?: string; tcgplayerAlternativeFoil?: string; tcgplayerEtched?: string };
export type RelatedCards = { reverseRelated?: string[]; spellbook?: string[] };
export type Rulings = { date: string; text: string };
export type SealedProduct = { cardCount?: number; category?: string; contents?: SealedProductContents; identifiers: Identifiers; name: string; productSize?: number; purchaseUrls: PurchaseUrls; releaseDate?: string; subtype: string | null; uuid: string };

export type Set = {
  baseSetSize: number;
  block?: string;
  booster?: Record<string, BoosterConfig>;
  cards: CardSet[];
  cardsphereSetId?: number;
  code: string;
  decks?: DeckSet[];
  isFoilOnly: boolean;
  isForeignOnly?: boolean;
  isNonFoilOnly?: boolean;
  isOnlineOnly: boolean;
  isPaperOnly?: boolean;
  isPartialPreview?: boolean;
  keyruneCode: string;
  languages?: string[];
  mcmId?: number;
  mcmIdExtras?: number;
  mcmName?: string;
  mtgoCode?: string;
  name: string;
  parentCode?: string;
  releaseDate: string;
  sealedProduct?: SealedProduct[];
  tcgplayerGroupId?: number;
  tokenSetCode?: string;
  tokens: CardToken[];
  totalSetSize: number;
  translations: Translations;
  type: string;
};

export type SetList = {
  baseSetSize: number;
  block?: string;
  cardsphereSetId?: number;
  languages?: string[];
  decks?: DeckSet[];
  isFoilOnly: boolean;
  isForeignOnly?: boolean;
  isOnlineOnly: boolean;
  type: string;
  isPaperOnly?: boolean;
  isPartialPreview?: boolean;
  keyruneCode: string;
  mcmIdExtras?: number;
  mcmName?: string;
  mtgoCode?: string;
  name: string;
  sealedProduct?: SealedProduct[];
  parentCode?: string;
  releaseDate: string;
  tokenSetCode?: string;
  isNonFoilOnly?: boolean;
  totalSetSize: number;
  mcmId?: number;
  translations: Translations;
  tcgplayerGroupId?: number;
  code: string;
};

export type SourceProducts = { etched: string[]; foil: string[]; nonfoil: string[] };
export type TcgplayerSkus = { condition: string; finish: string; language: string; printing: string; productId: string; skuId: string };
export type TokenProducts = { identifiers: Identifiers; purchaseUrls: PurchaseUrls; tokenParts: CardToken[] };
export type Translations = { "Chinese Simplified"?: string;  "Ancient Greek"?: string;   Arabic?: string;  French?: string;     German?: string;    Hebrew?: string;   Italian?: string;  Japanese?: string;
                             "Chinese Traditional"?: string;  Korean?: string;           Latin?: string;   Phyrexian?: string;  Russian?: string;   Sanskrit?: string; Spanish?: string;  "Portuguese (Brazil)"?: string; };

/** A collection_items row (item_type='card') hydrated with full card data from v_cards. */
export type CollectionItemCard = CardSet & {
  itemUuid: string;
  itemCollectionId: string;
  quantity: number;
  itemFinish: string | null;
  itemCondition: string | null;
  locationUuid: string | null;
  itemLanguage: string | null;
  addedAt: string;
  itemUpdatedAt: string;
};

export type Meta = { date: string; version: string };
export type AllPrintingsFile = { meta: Meta; data: Record<string, Set> };
export type AllPricesFile = { meta: Meta; data: Record<string, PriceFormats> };
export type AllPricesTodayFile = { meta: Meta; data: Record<string, PriceFormats> };
export type AllIdentifiersFile = { meta: Meta; data: Record<string, CardSet> };
export type AtomicCardsFile = { meta: Meta; data: Record<string, CardAtomic> };
export type CompiledListFile = { meta: Meta; data: string[] };
export type EnumValues = { meta: Meta; data: Record<string, Record<string, string[]>> };
export type LegacyFile = { meta: Meta; data: Record<string, CardSet> };
export type LegacyAtomicFile = { meta: Meta; data: Record<string, CardAtomic> };
export type ModernFile = { meta: Meta; data: Record<string, CardSet> };
export type ModernAtomicFile = { meta: Meta; data: Record<string, CardAtomic> };
export type PauperAtomicFile = { meta: Meta; data: Record<string, CardAtomic> };
export type PioneerFile = { meta: Meta; data: Record<string, CardSet> };
export type PioneerAtomicFile = { meta: Meta; data: Record<string, CardAtomic> };
export type StandardFile = { meta: Meta; data: Record<string, CardSet> };
export type StandardAtomicFile = { meta: Meta; data: Record<string, CardAtomic> };
export type VintageFile = { meta: Meta; data: Record<string, CardSet> };
export type VintageAtomicFile = { meta: Meta; data: Record<string, CardAtomic> };
