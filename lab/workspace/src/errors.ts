export function fsError(code: "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY" | "EINVAL" | "EROFS", op: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${op} '${path}'`), { code });
}
