import { cleanEnv, str } from 'envalid';

export const env = cleanEnv(process.env, {
  S3_EXPRESS_BUCKET: str(),
  S3_EXPRESS_REGION: str(),
  DB_NAME: str(),
});