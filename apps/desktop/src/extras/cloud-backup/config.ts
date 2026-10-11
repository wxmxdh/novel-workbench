export interface CloudBackupOssConfig {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpoint: string;
  region: string;
}

function configuredValue(name: keyof ImportMetaEnv): string {
  const bundledValue = import.meta.env[name];
  if (typeof bundledValue === "string" && bundledValue.trim()) {
    return bundledValue.trim();
  }
  const runtimeValue = process.env[name];
  return typeof runtimeValue === "string" ? runtimeValue.trim() : "";
}

export function loadCloudBackupOssConfig(): CloudBackupOssConfig | null {
  const accessKeyId = configuredValue("MAIN_VITE_OSS_ACCESS_KEY_ID");
  const accessKeySecret = configuredValue("MAIN_VITE_OSS_ACCESS_KEY_SECRET");
  const bucket = configuredValue("MAIN_VITE_OSS_BUCKET");
  const endpoint =
    configuredValue("MAIN_VITE_OSS_ENDPOINT") || "oss-cn-beijing.aliyuncs.com";
  const region = configuredValue("MAIN_VITE_OSS_REGION") || "oss-cn-beijing";
  if (!accessKeyId || !accessKeySecret || !bucket) {
    return null;
  }
  return { accessKeyId, accessKeySecret, bucket, endpoint, region };
}
