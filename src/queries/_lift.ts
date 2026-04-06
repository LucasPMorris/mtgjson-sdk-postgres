/**
 * Lifts flat identifiers_ and purchaseUrls_ prefixed keys into nested objects.
 * Shared by CardQuery and DeckQuery for hydrating rows from v_cards / v_cards_combined.
 */
export function liftRow(row: Record<string, unknown>): Record<string, unknown> {
	const identifiers: Record<string, unknown> = {};
	const purchaseUrls: Record<string, unknown> = {};
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(row)) {
		if (key.length > 11 && key.startsWith("identifiers") && /[A-Z]/.test(key[11])) {
			identifiers[key[11].toLowerCase() + key.slice(12)] = val;
		} else if (key.length > 12 && key.startsWith("purchaseUrls") && /[A-Z]/.test(key[12])) {
			purchaseUrls[key[12].toLowerCase() + key.slice(13)] = val;
		} else {
			out[key] = val;
		}
	}
	out.identifiers = identifiers;
	out.purchaseUrls = purchaseUrls;
	return out;
}
