import path from 'node:path';

type PathApi = Pick<typeof path, 'relative' | 'resolve' | 'isAbsolute' | 'sep'>;

/**
 * Whether `target` lies strictly inside `root`.
 *
 * Containment is decided on the resolved relative path, never on a string
 * prefix: `/data/lib-evil` starts with `/data/lib` and is not inside it. A path
 * on another drive resolves to an absolute "relative" path on Windows, which is
 * refused. The root itself is not inside itself, since every caller wants a
 * file and a folder there would be a different request.
 *
 * `api` exists so the checks can exercise the Windows rules on any machine.
 */
export function isInside(root: string, target: string, api: PathApi = path): boolean {
  const relative = api.relative(api.resolve(root), api.resolve(target));
  if (relative === '' || api.isAbsolute(relative)) return false;
  // "..hidden" is a legal file name; only ".." and "../x" leave the root.
  return relative !== '..' && !relative.startsWith(`..${api.sep}`);
}
