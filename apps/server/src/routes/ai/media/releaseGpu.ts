import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({
  providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/),
}), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { providerId } = req.body;
  res.set("Cache-Control", "no-store").json(success(await u.mediaGeneration.releaseProviderGpu(providerId)));
});
