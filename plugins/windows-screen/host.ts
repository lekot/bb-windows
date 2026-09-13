import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.js";
import { captureScreen } from "./capture.js";

let busy = false;
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: { async capture(input) {
    if (busy) throw new Error("Screen capture already in progress. Try again shortly.");
    busy = true;
    try { return await captureScreen(input.monitor); } finally { busy = false; }
  } },
});
