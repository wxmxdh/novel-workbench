interface ImportMetaEnv {
  readonly MAIN_VITE_DEEPWRITE_APP_MODE?: string;
  readonly MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_BASE_URL?: string;
  readonly MAIN_VITE_DEEPWRITE_PUBLIC_DATA_API_KEY?: string;
  readonly MAIN_VITE_OSS_ACCESS_KEY_ID?: string;
  readonly MAIN_VITE_OSS_ACCESS_KEY_SECRET?: string;
  readonly MAIN_VITE_OSS_BUCKET?: string;
  readonly MAIN_VITE_OSS_ENDPOINT?: string;
  readonly MAIN_VITE_OSS_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
