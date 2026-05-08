import {
  BUILT_IN_DISTILLERS,
  DEFAULT_DISTILLERS_CONFIG_PATH,
  loadCustomDistillers,
  mergeDistillerPools,
  type Distiller,
} from "../distillers.js";
import type { ListDistillersArgs, ListDistillersResult } from "../types.js";

const SYNTHETIC_VOICE_NOTICE =
  "All distillers are synthetic voices distilled from public material; none are endorsed by the named individuals.";

/**
 * Pure assembly of the list_distillers result. Filters happen here so the
 * tests can drive the function without touching disk.
 */
export function buildListDistillersResult(
  args: ListDistillersArgs,
  persistentDistillers: readonly Distiller[],
): ListDistillersResult {
  const usedPersistent = persistentDistillers.length > 0;
  const merged = usedPersistent
    ? mergeDistillerPools(BUILT_IN_DISTILLERS, persistentDistillers, [])
    : [...BUILT_IN_DISTILLERS];

  const worldview = args.worldview_filter?.trim().toLowerCase();
  const nameNeedle = args.name_filter?.trim().toLowerCase();

  const filtered = merged.filter((d) => {
    if (worldview && !d.worldview_tags.some((t) => t.toLowerCase() === worldview)) {
      return false;
    }
    if (nameNeedle) {
      const hay = `${d.name} ${d.short_label}`.toLowerCase();
      if (!hay.includes(nameNeedle)) {
        return false;
      }
    }
    return true;
  });

  const source: ListDistillersResult["source"] = !usedPersistent
    ? "built-in"
    : merged.length === persistentDistillers.length
      ? "persistent"
      : "merged";

  return {
    distillers: filtered.map((d) => {
      const out: ListDistillersResult["distillers"][number] = {
        name: d.name,
        short_label: d.short_label,
        attribution: d.attribution,
        signature_phrases: d.signature_phrases,
        worldview_tags: d.worldview_tags,
      };
      if (d.representative_url !== undefined) {
        out.representative_url = d.representative_url;
      }
      if (d.triggers !== undefined) {
        out.triggers = d.triggers;
      }
      if (d.default !== undefined) {
        out.default = d.default;
      }
      return out;
    }),
    total: filtered.length,
    source,
    notice: SYNTHETIC_VOICE_NOTICE,
  };
}

export async function listDistillers(
  args: ListDistillersArgs,
  distillersConfigPath: string = DEFAULT_DISTILLERS_CONFIG_PATH,
): Promise<ListDistillersResult> {
  const persistent = args.use_persistent_config ? loadCustomDistillers(distillersConfigPath) : [];
  return buildListDistillersResult(args, persistent);
}
