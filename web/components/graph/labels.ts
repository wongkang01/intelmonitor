// What each stored relationship type reads as in the Links filters of the graph view and the
// Related card, in the API's relationship type order.
import type { Schema } from "@/lib/api/client";

export type RelType = Schema<"RelatedLink">["type"];

export const LINK_LABEL: Record<RelType, string> = {
  exposed_to: "Exposed to",
  depends_on: "Depends on",
  participates_in: "Takes part in",
  owns: "Owns",
  subsidiary_of: "Subsidiary of",
  operates_in: "Operates in",
  supervised_by: "Supervised by",
  shareholder_of: "Shareholder of",
  member_of: "Member of",
  listed_on: "Listed on",
};
