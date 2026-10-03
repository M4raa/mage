import { describe, expect, it } from 'vitest';
import { packageOf } from './bundledPackagesPlugin';

describe('packageOf', () => {
  it('packageOf_pnpmNestedScoped_returnsInnermostName', () => {
    expect(packageOf('C:\\m\\node_modules\\.pnpm\\@modelcontextprotocol+sdk@1.31.0\\node_modules\\@modelcontextprotocol\\sdk\\dist\\esm\\client\\index.js')).toBe('@modelcontextprotocol/sdk');
  });

  it('packageOf_plainPackageWithVirtualPrefix_returnsName', () => {
    expect(packageOf('\0/proj/node_modules/zod/lib/index.mjs')).toBe('zod');
  });

  it('packageOf_ownSource_null', () => {
    expect(packageOf('/proj/src/main/index.ts')).toBeNull();
  });
});
