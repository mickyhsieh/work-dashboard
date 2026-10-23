#!/usr/bin/env node
// 產生 MCP Client token 與 SHA-256 hash。
//
// 用法：
//   node mcp-task/token.mjs "老闆的 OpenCode"
//   node mcp-task/token.mjs --hash "<既有 token>"
//
// 這個指令不會寫入任何檔案；token 只顯示在終端機一次。

import { randomBytes, createHash } from 'node:crypto';

function usage() {
  console.error('用法：node mcp-task/token.mjs "Client 名稱"');
  console.error('      node mcp-task/token.mjs --hash "<既有 token>"');
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const args = process.argv.slice(2);

if (args[0] === '--hash') {
  const token = args.slice(1).join(' ').trim();
  if (!token) {
    usage();
    process.exit(1);
  }
  console.log(hashToken(token));
  process.exit(0);
}

const name = args.join(' ').trim();
if (!name) {
  usage();
  process.exit(1);
}

const token = `mcp_${randomBytes(32).toString('base64url')}`;
const tokenHash = hashToken(token);
const sqlName = name.replace(/'/g, "''");

console.log(`MCP Client 名稱：${name}`);
console.log('');
console.log('Token（只顯示這一次，請用安全通道交給對方）：');
console.log(token);
console.log('');
console.log('SHA-256（貼到 mcp_clients.token_hash）：');
console.log(tokenHash);
console.log('');
console.log('SQL（可貼到 SQL Editor，或到 Table Editor 手動新增）：');
console.log(
  `insert into public.mcp_clients (name, token_hash, active, note) values ('${sqlName}', '${tokenHash}', true, '');`,
);
