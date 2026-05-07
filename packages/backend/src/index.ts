import app from "./app.js";
import { env } from "./config/env.js";
import { startMarketListener } from "./services/market-listener.service.js";
import { logger } from "./utils/logger.js";
import { hasAwsCredentials, bedrockConfig } from "./lib/bedrock-client.js";

async function main() {
  const port = Number(env.PORT);

  app.listen(port, () => {
    logger.info(`API Market Gateway listening on port ${port}`);
  });

  // Surface missing AWS credentials at boot so AI Analyst endpoints don't
  // mysteriously 500 on first request. Don't crash — non-AI routes still work.
  if (!hasAwsCredentials()) {
    logger.warn(
      { region: bedrockConfig.region, modelId: bedrockConfig.modelId },
      "AWS credentials not detected — /api/listings/:id/(trust|market)-analysis will fail until configured",
    );
  } else {
    logger.info(
      { region: bedrockConfig.region, modelId: bedrockConfig.modelId },
      "Bedrock client configured",
    );
  }

  // v3 ChainLensMarket listener — mirrors ListingRegistered events into
  // the ApiListing table so the admin approval gate has rows to gate on.
  // Health probe at /api/health will report "unstarted" if this fails.
  try {
    startMarketListener();
  } catch (error) {
    logger.warn(
      { error },
      "market listener failed to start (ChainLensMarket may not be deployed for this chain)",
    );
  }
}

main().catch((err) => {
  logger.error(err, "Fatal error");
  process.exit(1);
});
