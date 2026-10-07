import { z } from 'zod';
import type { ApiUsageSnapshot } from '@shared/usage';
import type { ResultInfo } from '@shared/events';
import { addApiTurn, apiAmountsOf } from './apiUsage';

const AmountsSchema = z.object({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(), cacheCreationTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(), costMicroUsd: z.number().int().nonnegative(),
});
const SnapshotSchema = z.object({ turns: z.number().int().nonnegative(), totals: AmountsSchema,
  lastTurn: AmountsSchema, updatedAtMs: z.number().int().nonnegative() });
const FileSchema = z.object({ version: z.literal(1), byAccount: z.record(z.string(), SnapshotSchema) });
type ApiUsageFile = z.infer<typeof FileSchema>;

export interface ApiUsageStoreDeps {
  readonly read: () => unknown;
  readonly write: (file: ApiUsageFile) => void;
  readonly now: () => number;
}

export class ApiUsageStore {
  private file: ApiUsageFile | null = null;

  constructor(private readonly deps: ApiUsageStoreDeps) {}

  get(accountDir: string): ApiUsageSnapshot | null {
    if (accountDir.trim().length === 0) throw new Error(`Cuenta vacia para uso API: ${JSON.stringify(accountDir)}`);
    return this.load().byAccount[accountDir] ?? null;
  }

  record(accountDir: string, result: ResultInfo): void {
    if (accountDir.trim().length === 0) throw new Error(`Cuenta vacia para registrar uso API: ${JSON.stringify(accountDir)}`);
    const turn = apiAmountsOf(result);
    if (turn === null) return;
    const file = this.load();
    const next: ApiUsageFile = { version: 1, byAccount: { ...file.byAccount,
      [accountDir]: addApiTurn(file.byAccount[accountDir] ?? null, turn, this.deps.now()) } };
    this.deps.write(next);
    this.file = next;
  }

  forget(accountDir: string): void {
    const file = this.load();
    if (file.byAccount[accountDir] === undefined) return;
    const { [accountDir]: _removed, ...byAccount } = file.byAccount;
    const next: ApiUsageFile = { version: 1, byAccount };
    this.deps.write(next);
    this.file = next;
  }

  private load(): ApiUsageFile {
    this.file ??= FileSchema.parse(this.deps.read() ?? { version: 1, byAccount: {} });
    return this.file;
  }
}
