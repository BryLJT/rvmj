import type { NextConfig } from "next";
import { MAX_UPLOAD_BYTES } from "./src/lib/image";

/**
 * A notable-hand photo travels to the server INSIDE a server action, so the framework's own
 * body limit is one of the four numbers that have to agree about what "too big" means. The
 * other three are all MAX_UPLOAD_BYTES: the client refuses to send a larger blob, logNotable
 * refuses to store one, and the storage bucket's file_size_limit refuses to hold one.
 *
 * Next's default is 1 MB, which is BELOW our 2 MiB, so a legitimate photo between the two was
 * refused with an HTTP 413 before a line of our validation ran — no usable message, and no
 * chance to offer "Log it without the photo". The allowance on top covers the multipart
 * envelope (boundary, part headers, the three UUID arguments), which the limit counts along
 * with the photo: without it, a photo of exactly the permitted size would still be refused.
 * The photo limit itself stays MAX_UPLOAD_BYTES, in one place, for all four.
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: MAX_UPLOAD_BYTES + 64 * 1024 },
  },
};

export default nextConfig;
