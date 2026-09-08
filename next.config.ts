import type { NextConfig } from "next";

/*
 * `next dev` refuses to serve its own JavaScript to a host it does not
 * recognise, and only `localhost` is recognised by default. The development
 * stack publishes on 127.0.0.1, which is the same machine by any reasonable
 * reading and a different origin by this one — so the page arrived as HTML,
 * every chunk under /_next/static was blocked, and it sat on a skeleton that
 * never filled. The reason appeared only in the container's log.
 *
 * Applied in development alone. It is a `next dev` setting with no meaning in a
 * built server, and stating it unconditionally would put a list of permitted
 * development hosts into the released configuration, which should carry nothing
 * about how the app is developed.
 */
const dev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't advertise the framework/version to clients.
  poweredByHeader: false,
  ...(dev ? { allowedDevOrigins: ["127.0.0.1"] } : {}),
};

export default nextConfig;
