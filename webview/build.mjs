import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webviewDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(webviewDir);
const outputDir = join(webviewDir, 'dist');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(join(webviewDir, 'index.html'), join(outputDir, 'index.html'));
await cp(join(webviewDir, 'js'), join(outputDir, 'js'), { recursive: true });
await cp(join(webviewDir, 'assets'), join(outputDir, 'assets'), { recursive: true });
await cp(join(projectDir, 'LICENSE'), join(outputDir, 'LICENSE'));
await cp(join(projectDir, 'NOTICE'), join(outputDir, 'NOTICE'));

console.log(`Built webview to ${outputDir}`);
