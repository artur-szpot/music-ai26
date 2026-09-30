import fs from 'node:fs';
import path from 'node:path';

export default function resolveMusicFilePath(
  filePath: string,
  rootPath: string,
): string {
  const actualPath = fs.realpathSync(filePath);
  const relative = path.relative(rootPath, actualPath);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Track is outside its source root.');
  }
  return actualPath;
}
