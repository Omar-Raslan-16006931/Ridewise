import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ridewise | Shared Uber ledger",
    short_name: "Ridewise",
    description: "A shared Uber ledger for two friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#12161a",
    theme_color: "#12161a",
    orientation: "portrait",
    icons: [],
  };
}