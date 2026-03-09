import type { Connection } from "../connection.js";
import type { CardSet } from "../types/index.js";

/** snake_case column names in card_identifiers / token_identifiers tables. */
const KNOWN_ID_COLUMNS = new Set([ "card_kingdom_etched_id", "card_kingdom_foil_id", "card_kingdom_id",	"cardsphere_id", "cardsphere_foil_id",	     "mcm_id",	           "mcm_meta_id",                 "mtg_arena_id",
                                   "mtgo_foil_id",	         "mtgo_id",              "multiverse_id",   "scryfall_id",	 "scryfall_illustration_id", "scryfall_oracle_id", "tcgplayer_etched_product_id", "tcgplayer_product_id", ]);

export class IdentifierQuery {
	private _conn: Connection;

	constructor(conn: Connection) {	this._conn = conn;}

	private async _findBy(idColumn: string, value: string): Promise<CardSet[]> {
		const sql = `SELECT c.* FROM cards c JOIN card_identifiers ci ON c.uuid = ci.uuid WHERE ci.${idColumn} = $1`;
		return (await this._conn.execute(sql, [value])) as CardSet[];
	}

	async findBy(idType: string, value: string): Promise<CardSet[]> {
		if (!KNOWN_ID_COLUMNS.has(idType)) { throw new Error( `Unknown identifier type '${idType}'. Known types: ${[...KNOWN_ID_COLUMNS].sort().join(", ")}` ); }
		return this._findBy(idType, value);
	}

	async findByScryfallId(scryfallId: string): Promise<CardSet[]> { return this._findBy("scryfall_id", scryfallId); }
	async findByScryfallOracleId(oracleId: string): Promise<CardSet[]> { return this._findBy("scryfall_oracle_id", oracleId); }
	async findByScryfallIllustrationId(illustrationId: string): Promise<CardSet[]> { return this._findBy("scryfall_illustration_id", illustrationId); }
	async findByTcgplayerId(tcgplayerId: string): Promise<CardSet[]> { return this._findBy("tcgplayer_product_id", tcgplayerId); }
	async findByTcgplayerEtchedId(tcgplayerEtchedId: string): Promise<CardSet[]> { return this._findBy("tcgplayer_etched_product_id", tcgplayerEtchedId); }
	async findByMtgoId(mtgoId: string): Promise<CardSet[]> { return this._findBy("mtgo_id", mtgoId); }
	async findByMtgoFoilId(mtgoFoilId: string): Promise<CardSet[]> { return this._findBy("mtgo_foil_id", mtgoFoilId); }
	async findByMtgArenaId(arenaId: string): Promise<CardSet[]> { return this._findBy("mtg_arena_id", arenaId); }
	async findByMultiverseId(multiverseId: string): Promise<CardSet[]> { return this._findBy("multiverse_id", multiverseId); }
	async findByMcmId(mcmId: string): Promise<CardSet[]> { return this._findBy("mcm_id", mcmId); }
	async findByMcmMetaId(mcmMetaId: string): Promise<CardSet[]> { return this._findBy("mcm_meta_id", mcmMetaId); }
	async findByCardKingdomId(ckId: string): Promise<CardSet[]> { return this._findBy("card_kingdom_id", ckId); }
	async findByCardKingdomFoilId(ckFoilId: string): Promise<CardSet[]> { return this._findBy("card_kingdom_foil_id", ckFoilId); }
	async findByCardKingdomEtchedId(ckEtchedId: string): Promise<CardSet[]> { return this._findBy("card_kingdom_etched_id", ckEtchedId); }
	async findByCardsphereId(csId: string): Promise<CardSet[]> { return this._findBy("cardsphere_id", csId); }
	async findByCardsphereFoilId(csFoilId: string): Promise<CardSet[]> { return this._findBy("cardsphere_foil_id", csFoilId); }

	async getIdentifiers(uuid: string): Promise<Record<string, unknown> | null> {
		const rows = await this._conn.execute("SELECT * FROM card_identifiers WHERE uuid = $1", [uuid] );
		return rows[0] ?? null;
	}
}
