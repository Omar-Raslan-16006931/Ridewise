import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ridewise | Shared Uber ledger",
    short_name: "Ridewise",
    description: "A calm, shared Uber ledger for two friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ec",
    theme_color: "#f6f4ec",
    orientation: "portrait",
    icons: [],
  };
}