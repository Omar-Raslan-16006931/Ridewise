import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ridewise | Shared Uber ledger",
    short_name: "Ridewise",
    description: "A shared Uber ledger for two friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f2ea",
    theme_color: "#f5f2ea",
    orientation: "portrait",
    icons: [],
  };
}