import crypto from "node:crypto";

const BLOCK_SIZE = 16;
const HEADER_LEN = 6;
const SHA512_LEN = 64;
const RANDOM_KEY_LEN = 32;

const PREFIX_AES = Buffer.from([116, 99, 5, 16, 0, 0]);
const PREFIX_AES_PRIVATE = Buffer.from([18, 57, 32, 32, 2, 3]);

const AES_PRIVATE_A = Buffer.from([
  191, 192, 216, 250, 122, 246, 220, 97, 31, 254, 98, 27, 8, 72, 71, 176, 135, 99, 96, 18, 127,
  101, 203, 104, 211, 102, 191, 125, 37, 72, 150, 156, 51, 229, 121, 35, 17, 153, 141, 177, 110,
  131, 150, 128, 172, 255, 254, 6, 18, 140, 55, 62, 236, 249, 135, 64, 135, 12, 117, 4, 89, 149,
  168, 209,
]);

const AES_PRIVATE_B = Buffer.from([
  246, 204, 26, 232, 232, 70, 129, 109, 223, 146, 169, 242, 23, 241, 105, 145, 50, 196, 165, 42,
  254, 120, 3, 54, 244, 207, 209, 85, 53, 6, 138, 106, 175, 148, 31, 204, 186, 186, 165, 182, 87,
  142, 49, 10, 39, 110, 26, 154, 86, 56, 173, 125, 18, 64, 198, 225, 99, 99, 83, 82, 191, 134,
  76, 170,
]);

const AES_A = Buffer.from([
  82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251, 124, 227, 57, 130,
  155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203, 84, 123, 148, 50, 166, 194, 35, 61,
  238, 76, 149, 11, 66, 250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109,
  139, 209, 37,
]);

const AES_B = Buffer.from([
  31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81, 127, 169, 25,
  181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160, 224, 59, 77, 174, 42, 245, 176, 200,
  235, 187, 60, 131, 83, 153, 97, 23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33,
  12, 125,
]);

function xorBuffers(left, right) {
  if (left.length !== right.length) throw new Error("Buffer lengths do not match");
  const output = Buffer.allocUnsafe(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = left[index] ^ right[index];
  }
  return output;
}

const SALT_AES = xorBuffers(AES_A, AES_B);
const SALT_AES_PRIVATE = xorBuffers(AES_PRIVATE_A, AES_PRIVATE_B);

function sha512(value) {
  return crypto.createHash("sha512").update(value).digest();
}

function deriveKeyIv(keyMaterial, privateVersion) {
  if (keyMaterial.length !== RANDOM_KEY_LEN) {
    throw new Error("Invalid iCube encryption key length");
  }
  const keyHash = sha512(keyMaterial);
  const salt = privateVersion ? SALT_AES_PRIVATE : SALT_AES;
  const mergedHash = sha512(Buffer.concat([keyHash, salt]));
  return {
    key: mergedHash.subarray(0, 16),
    iv: mergedHash.subarray(16, 32),
  };
}

function decodeBase64Text(value) {
  return Buffer.from(value.trim(), "base64");
}

function detectVersion(header) {
  if (header.equals(PREFIX_AES)) return { privateVersion: false };
  if (header.equals(PREFIX_AES_PRIVATE)) return { privateVersion: true };
  return null;
}

export function encryptIcubesValue(value) {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const randomKey = crypto.randomBytes(RANDOM_KEY_LEN);
  const { key, iv } = deriveKeyIv(randomKey, false);
  const payload = Buffer.concat([sha512(plaintext), plaintext]);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([PREFIX_AES, randomKey, encrypted]).toString("base64");
}

export function decryptIcubesValue(value) {
  const raw = decodeBase64Text(String(value));
  if (raw.length <= HEADER_LEN + RANDOM_KEY_LEN) {
    throw new Error("Invalid iCube encrypted value");
  }

  const version = detectVersion(raw.subarray(0, HEADER_LEN));
  if (!version) throw new Error("Unknown iCube encryption version");

  const randomKey = raw.subarray(HEADER_LEN, HEADER_LEN + RANDOM_KEY_LEN);
  const ciphertext = raw.subarray(HEADER_LEN + RANDOM_KEY_LEN);
  if (!ciphertext.length || ciphertext.length % BLOCK_SIZE !== 0) {
    throw new Error("Invalid iCube ciphertext length");
  }

  const { key, iv } = deriveKeyIv(randomKey, version.privateVersion);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (decrypted.length < SHA512_LEN) throw new Error("Invalid iCube payload");

  const expectedDigest = decrypted.subarray(0, SHA512_LEN);
  const plaintext = decrypted.subarray(SHA512_LEN);
  if (!crypto.timingSafeEqual(expectedDigest, sha512(plaintext))) {
    throw new Error("iCube payload checksum mismatch");
  }
  return plaintext.toString("utf8");
}

export function parseIcubesValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue with encrypted decoding.
    }
  }
  return JSON.parse(decryptIcubesValue(trimmed));
}

