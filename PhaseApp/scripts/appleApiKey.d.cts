// Build tooling. The secret and the file it becomes are two names on purpose:
// `APPLE_API_KEY_P8_BASE64` is base64 of the .p8, `APPLE_API_KEY` is a path.

/** The repository secret: base64 of AuthKey_XXXXXXXX.p8. */
export declare const API_KEY_BASE64_ENV: 'APPLE_API_KEY_P8_BASE64';
/** What electron-builder and `notarytool --key` read: a filesystem path. */
export declare const API_KEY_PATH_ENV: 'APPLE_API_KEY';
/** The first line of any key Apple issues. */
export declare const PKCS8_HEADER: '-----BEGIN PRIVATE KEY-----';

/**
 * Strictly decode the secret: alphabet, length, round trip, then the PKCS#8
 * header of the result. Throws naming the variable and never the material.
 */
export declare function decodeApiKey(base64: string): Buffer;

/**
 * Validate and write the key at `destPath` with mode 0600, returning that path.
 * A malformed secret throws and leaves no file behind.
 */
export declare function writeApiKey(base64: string, destPath: string): string;
