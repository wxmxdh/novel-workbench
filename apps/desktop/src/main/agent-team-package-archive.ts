import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  AGENT_TEAM_PACKAGE_FORMAT,
  AGENT_TEAM_PACKAGE_VERSION,
  AgentTeamPackageManifestSchema,
  type AgentTeamPackageManifest,
  type AgentTeamProfile
} from "@deepwrite/contracts";

const PACKAGE_ENTRY_NAME = "deepwrite-agent-team.json";
export const AGENT_TEAM_PACKAGE_MAX_BYTES = 5 * 1024 * 1024;
const AGENT_TEAM_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2)
  };
}

function createSingleFileZip(name: string, data: Buffer, now: Date): Buffer {
  const fileName = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(data);
  const checksum = crc32(data);
  const timestamp = zipDateTime(now);
  const local = Buffer.alloc(30 + fileName.length + compressed.length);
  local.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(timestamp.time, 10);
  local.writeUInt16LE(timestamp.date, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  fileName.copy(local, 30);
  compressed.copy(local, 30 + fileName.length);

  const central = Buffer.alloc(46 + fileName.length);
  central.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(timestamp.time, 12);
  central.writeUInt16LE(timestamp.date, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  fileName.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function readPackageEntry(archive: Buffer): Buffer {
  if (archive.length === 0 || archive.length > AGENT_TEAM_PACKAGE_MAX_BYTES) {
    throw new Error("智能体团队压缩包为空或超过 5 MB 上限。");
  }
  if (archive.length < 30 || archive.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("所选文件不是有效的智能体团队压缩包。");
  }
  const flags = archive.readUInt16LE(6);
  const method = archive.readUInt16LE(8);
  const checksum = archive.readUInt32LE(14);
  const compressedSize = archive.readUInt32LE(18);
  const uncompressedSize = archive.readUInt32LE(22);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0) {
    throw new Error("智能体团队压缩包使用了不支持的加密或流式格式。");
  }
  if (method !== 0 && method !== 8) {
    throw new Error("智能体团队压缩包使用了不支持的压缩格式。");
  }
  if (uncompressedSize > AGENT_TEAM_MANIFEST_MAX_BYTES) {
    throw new Error("智能体团队配置超过 4 MB 上限。");
  }
  const nameStart = 30;
  const dataStart = nameStart + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > archive.length) {
    throw new Error("智能体团队压缩包内容不完整。");
  }
  const name = archive
    .subarray(nameStart, nameStart + nameLength)
    .toString("utf8");
  if (name !== PACKAGE_ENTRY_NAME) {
    throw new Error(`智能体团队压缩包缺少 ${PACKAGE_ENTRY_NAME}。`);
  }
  const compressed = archive.subarray(dataStart, dataEnd);
  let data: Buffer;
  try {
    data =
      method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, {
            maxOutputLength: AGENT_TEAM_MANIFEST_MAX_BYTES
          });
  } catch {
    throw new Error("智能体团队压缩包中的配置无法解压。");
  }
  if (data.length !== uncompressedSize || crc32(data) !== checksum) {
    throw new Error("智能体团队压缩包校验失败，文件可能已损坏。");
  }
  const nextSignature =
    dataEnd + 4 <= archive.length ? archive.readUInt32LE(dataEnd) : 0;
  if (
    nextSignature !== CENTRAL_DIRECTORY_SIGNATURE &&
    nextSignature !== END_OF_CENTRAL_DIRECTORY_SIGNATURE
  ) {
    throw new Error("智能体团队压缩包包含未识别的额外内容。");
  }
  return data;
}

export function createAgentTeamPackage(
  team: AgentTeamProfile,
  now = new Date()
): Buffer {
  const manifest = AgentTeamPackageManifestSchema.parse({
    format: AGENT_TEAM_PACKAGE_FORMAT,
    version: AGENT_TEAM_PACKAGE_VERSION,
    exportedAt: now.toISOString(),
    team
  } satisfies AgentTeamPackageManifest);
  return createSingleFileZip(
    PACKAGE_ENTRY_NAME,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    now
  );
}

export function readAgentTeamPackage(archive: Buffer): AgentTeamProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(readPackageEntry(archive).toString("utf8"));
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new Error("智能体团队压缩包中的配置不是有效 JSON。");
    }
    throw error;
  }
  const parsed = AgentTeamPackageManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("智能体团队压缩包版本或配置内容无效。");
  }
  return parsed.data.team;
}
