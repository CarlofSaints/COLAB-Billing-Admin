/**
 * COLAB sub-company brand identities (colour + tagline), taken from
 * colab2.co.za. Keyed by lower-cased company name so DB names map cleanly.
 */
export type SubBrand = { color: string; tagline: string };

export const SUB_BRANDS: Record<string, SubBrand> = {
  "atomic marketing": { color: "#ED1C24", tagline: "Sales & Activations Agency" },
  iram: { color: "#8DC63F", tagline: "Innovative Retail Account Management" },
  outerjoin: { color: "#F15A29", tagline: "Visualise Efficiency" },
  "atomic digital": { color: "#29ABE2", tagline: "Communication & Sales Agency" },
  "catalyst sell-out": { color: "#7B2D8E", tagline: "Energy. Change. Acceleration." },
};

const FALLBACK: SubBrand = { color: "#64748b", tagline: "Sub-company" };

export function brandFor(name: string): SubBrand {
  return SUB_BRANDS[name.trim().toLowerCase()] ?? FALLBACK;
}
