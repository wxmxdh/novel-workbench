import rawBundle from "./love-approved-voice-bundle.json";

export interface LoveApprovedVoiceSource {
  title: string;
  sourcePath: string;
  sha256: string;
  content: string;
}

export interface LoveApprovedVoiceBundle {
  bookId: string;
  packageId: string;
  files: LoveApprovedVoiceSource[];
}

// The public repository intentionally ships metadata only. The explicit type
// keeps an empty JSON files array usable by runtime code and test fixtures.
const bundle: LoveApprovedVoiceBundle = rawBundle;

export default bundle;
