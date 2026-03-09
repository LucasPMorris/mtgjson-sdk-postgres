import type { CacheManager } from "../cache.js";
import type { CardTypes, Keywords } from "../types/index.js";

export class EnumQuery {
	private _cache: CacheManager;
	constructor(cache: CacheManager) { this._cache = cache; }

  async keywords(): Promise<Keywords> { const raw = await this._cache.loadJson("keywords"); return (raw.data ?? {}) as Keywords; }
	async cardTypes(): Promise<CardTypes> {	const raw = await this._cache.loadJson("card_types"); return (raw.data ?? {}) as CardTypes; }
  async enumValues(): Promise<Record<string, unknown>> { const raw = await this._cache.loadJson("enum_values"); return (raw.data ?? {}) as Record<string, unknown>; }

}
