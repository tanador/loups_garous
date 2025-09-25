import { describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";

import { createHttpApp } from "../http.js";

describe("http layer", () => {
  it("exposes health and connectivity endpoints", async () => {
    const { httpServer } = createHttpApp();
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));

    const address = httpServer.address();
    if (!address || typeof address === "string") {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
      throw new Error("unable_to_listen");
    }
    const { port } = address as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const healthRes = await fetch(`${baseUrl}/healthz`);
      expect(healthRes.status).toBe(200);
      const healthBody = await healthRes.json();
      expect(healthBody).toMatchObject({ ok: true });

      const connectivityRes = await fetch(`${baseUrl}/connectivity`);
      expect(connectivityRes.status).toBe(200);
      const connectivityBody = await connectivityRes.json();
      expect(connectivityBody.ok).toBe(true);
      expect(connectivityBody.service).toBe("loup_garou_server");
      expect(typeof connectivityBody.version).toBe("string");
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
