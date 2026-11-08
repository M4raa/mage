import { z } from 'zod';
import type { ApiUsageAmounts, ApiUsageSnapshot } from '@shared/usage';
import type { ResultInfo } from '@shared/events';
import { addApiResult, apiAmountsOf, turnCostMicroUsd } from './apiUsage';

const AmountsSchema = z.object({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(), cacheCreationTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(), costMicroUsd: z.number().int().nonnegative(),
});
const SnapshotSchema = z.object({ turns: z.number().int().nonnegative(), totals: AmountsSchema,
  lastTurn: AmountsSchema, updatedAtMs: z.number().int().nonnegative() });
const FileSchema = z.object({ version: z.literal(1), byAccount: z.record(z.string(), SnapshotSchema),
  // ponytail: una entrada por conversación de Claude con clave de API, sin poda (decenas de bytes cada una); podar por fecha si el fichero crece.
  cumulativeByConversation: z.record(z.string(), z.number().int().nonnegative()).optional() });
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
    const amounts = apiAmountsOf(result);
    if (amounts === null) return;
    const next = this.nextFile(this.load(), accountDir, result.conversationId, amounts);
    this.deps.write(next);
    this.file = next;
  }

  // El coste del `result` es el acumulado de su conversación: se guarda y el del turno sale por diferencia.
  private nextFile(file: ApiUsageFile, accountDir: string, key: string | undefined, amounts: ApiUsageAmounts): ApiUsageFile {
    const previousCumulative = key === undefined ? undefined : file.cumulativeByConversation?.[key];
    const turn = { ...amounts, costMicroUsd: turnCostMicroUsd(previousCumulative, amounts.costMicroUsd) };
    const snapshot = addApiResult(file.byAccount[accountDir] ?? null, turn, this.deps.now());
    const byAccount = snapshot === null ? file.byAccount : { ...file.byAccount, [accountDir]: snapshot };
    const cumulativeByConversation = key === undefined ? file.cumulativeByConversation : { ...file.cumulativeByConversation, [key]: amounts.costMicroUsd };
    return { version: 1, byAccount, ...(cumulativeByConversation === undefined ? {} : { cumulativeByConversation }) };
  }

  forget(accountDir: string): void {
    const file = this.load();
    if (file.byAccount[accountDir] === undefined) return;
    const { [accountDir]: _removed, ...byAccount } = file.byAccount;
    const next: ApiUsageFile = { ...file, byAccount }; // conserva el mapa por conversación (no es de la cuenta)
    this.deps.write(next);
    this.file = next;
  }

  private load(): ApiUsageFile {
    this.file ??= FileSchema.parse(this.deps.read() ?? { version: 1, byAccount: {} });
    return this.file;
  }
}
