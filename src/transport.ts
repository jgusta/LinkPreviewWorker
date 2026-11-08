import { lookup } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch { return false; }
}

// Validation is performed inside the actual socket lookup, preventing DNS
// rebinding between a preflight check and the connection. Applies to redirects too.
export const publicDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
          return callback(new Error("Target resolves to a non-public address."), "", 4);
        }
        const compatible = addresses.filter((entry) => !options.family || entry.family === options.family);
        const first = compatible[0];
        if (!first) return callback(new Error("No compatible public address."), "", 4);
        if (options.all) callback(null, compatible);
        else callback(null, first.address, first.family);
      });
    },
  },
});
