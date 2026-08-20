import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The landing page template shipped links to /signup, /login, /docs and
   * /enterprise, none of which were ever built. /docs is a real page now, so it
   * is not in this list; the rest still need somewhere to land, because a tab
   * opened before the links were fixed still holds a bundle that names them,
   * as does any bookmark or shared URL.
   *
   * Permanent: false, because these are corrections to a page that no longer
   * claims those routes, not a durable URL contract worth caching in browsers.
   */
  async redirects() {
    return [
      { source: "/signup", destination: "/#console", permanent: false },
      { source: "/login", destination: "/#console", permanent: false },
      { source: "/enterprise", destination: "/docs", permanent: false },
    ];
  },
};

export default nextConfig;
