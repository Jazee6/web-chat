import { AwsClient } from "aws4fetch";

export const createS3 = (env: CloudflareBindings) =>
  new AwsClient({
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  });
