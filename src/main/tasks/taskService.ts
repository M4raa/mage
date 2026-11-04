// Servicio de tareas (F8): crea, reclama, enlaza con la sesión y verifica. Todo llega inyectado.
//
// Cómo sabe main que una sesión es una tarea: el renderer manda `taskId` al crear la PRIMERA sesión de la tarea
// (`startTask`). Al reanudar, el `resumeSessionId` es el `conversationId` guardado.
import { isAbsolute, resolve } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import { TASK_LIMITS, taskVerdictOf, type TaskDraft, type TaskProvider, type TaskRecord } from '@shared/tasks';
import { checkDeliverables, comparablePath, type DeliverableFs } from './deliverableChecker';

const TASK_ID_MAX_CHARS = 256;

export interface TaskServiceDeps {
  readonly load: () => TaskRecord[];
  readonly save: (tasks: readonly TaskRecord[]) => void;
  readonly now: () => number;
  readonly newId: () => string;
  readonly listAccounts: () => readonly { readonly provider: TaskProvider; readonly configDir: string }[];
  readonly isDirectory: (path: string) => boolean;
  readonly isFile: (path: string) => boolean;
  readonly deliverableFs: DeliverableFs;
  readonly caseInsensitive: boolean;
  readonly nativeIdOf: (sessionId: string) => string | null; // id nativo vivo de una sesión de Mage (null si no vive o aún no lo tiene)
}

export interface TaskLaunch {
  readonly provider: string;
  readonly accountDir: string;
  readonly cwd: string;
  readonly resumeSessionId?: string;
  readonly taskId?: string;
}

const PROVIDERS: readonly string[] = ['claude', 'codex'];

export class TaskService {
  private tasks: TaskRecord[] | null = null;

  constructor(private readonly deps: TaskServiceDeps) {}

  list(): readonly TaskRecord[] {
    const current = this.all();
    const filled = current.map((task) => this.withNativeId(task));
    if (filled.some((task, index) => task !== current[index])) this.replaceAll(filled);
    return [...filled].sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  create(draft: TaskDraft): TaskRecord {
    const clean = this.validate(draft);
    const record: TaskRecord = {
      ...clean, id: this.deps.newId(), createdAtMs: this.deps.now(), sessionId: null, conversationId: null,
      deliverables: [], verifiedAtMs: null, verdict: 'pending',
    };
    this.replaceAll([...this.all(), record]);
    return record;
  }

  claimForLaunch(launch: TaskLaunch): TaskRecord | null {
    if (launch.resumeSessionId !== undefined) {
      return this.all().find((task) => task.conversationId === launch.resumeSessionId) ?? null;
    }
    if (launch.taskId === undefined) return null;
    return this.claimById(launch, launch.taskId);
  }

  bindSession(taskId: string, sessionId: string, provider: TaskProvider): TaskRecord {
    return this.update(taskId, (task) => ({
      ...task,
      sessionId,
      conversationId: provider === 'claude' && task.conversationId === null ? sessionId : task.conversationId,
    }));
  }

  verify(taskId: string, declared: readonly string[]): TaskRecord {
    const scope = { caseInsensitive: this.deps.caseInsensitive };
    return this.update(taskId, (task) => {
      const deliverables = checkDeliverables(declared, { ...scope, folders: task.folders }, this.deps.deliverableFs);
      return { ...task, deliverables, verifiedAtMs: this.deps.now(), verdict: taskVerdictOf(deliverables) };
    });
  }

  remove(taskId: string): void {
    this.replaceAll(this.all().filter((task) => task.id !== taskId));
  }

  // Carpetas de la tarea que NO son la de trabajo: son las que hay que añadir como extras al lanzar.
  launchExtrasFor(task: TaskRecord, cwd: string): readonly string[] {
    const cwdKey = comparablePath(cwd, this.deps.caseInsensitive);
    return task.folders.filter((folder) => comparablePath(folder, this.deps.caseInsensitive) !== cwdKey);
  }

  private all(): TaskRecord[] {
    this.tasks ??= this.deps.load();
    return this.tasks;
  }

  private replaceAll(next: TaskRecord[]): void {
    this.tasks = next;
    this.deps.save(next);
  }

  private update(taskId: string, change: (task: TaskRecord) => TaskRecord): TaskRecord {
    const current = this.all();
    const found = current.find((task) => task.id === taskId);
    if (found === undefined) throw new UserFacingError(localized('errors.tasks.unknownTask', { taskId }));
    const updated = change(found);
    this.replaceAll(current.map((task) => (task === found ? updated : task)));
    return updated;
  }

  private withNativeId(task: TaskRecord): TaskRecord {
    if (task.sessionId === null || task.conversationId !== null) return task;
    const nativeId = this.deps.nativeIdOf(task.sessionId);
    return nativeId === null ? task : { ...task, conversationId: nativeId };
  }

  private claimById(launch: TaskLaunch, taskId: string): TaskRecord {
    if (taskId.length === 0 || taskId.length > TASK_ID_MAX_CHARS) throw new Error(`taskId inválido al lanzar: ${JSON.stringify(taskId)}`);
    const task = this.all().find((candidate) => candidate.id === taskId);
    if (task === undefined) throw new UserFacingError(localized('errors.tasks.unknownTask', { taskId }));
    const sameAccount = comparablePath(task.accountDir, this.deps.caseInsensitive) === comparablePath(launch.accountDir, this.deps.caseInsensitive);
    if (task.provider !== launch.provider || !sameAccount) {
      throw new Error(`La sesión no casa con la tarea ${taskId}: ${JSON.stringify({ provider: launch.provider, accountDir: launch.accountDir })}`);
    }
    return task;
  }

  // Valida el borrador y devuelve sus campos limpios (objetivo recortado, sin duplicados).
  private validate(draft: TaskDraft): TaskDraft {
    const goal = draft.goal.trim();
    if (goal.length === 0) throw new UserFacingError(localized('errors.tasks.goalEmpty'));
    if (goal.length > TASK_LIMITS.goalMaxChars) throw new UserFacingError(localized('errors.tasks.goalTooLong', { max: TASK_LIMITS.goalMaxChars }));
    this.assertAccount(draft);
    const folders = this.unique(draft.folders);
    const documents = this.unique(draft.documents);
    if (folders.length === 0) throw new UserFacingError(localized('errors.tasks.noFolders'));
    this.assertCount(folders, TASK_LIMITS.maxFolders);
    this.assertCount(documents, TASK_LIMITS.maxDocuments);
    this.assertCount(draft.capabilities, TASK_LIMITS.maxCapabilities);
    this.assertPaths(folders, this.deps.isDirectory, 'errors.tasks.folderMissing');
    this.assertPaths(documents, this.deps.isFile, 'errors.tasks.documentMissing');
    return { ...draft, goal, folders, documents };
  }

  private assertAccount(draft: TaskDraft): void {
    if (!PROVIDERS.includes(draft.provider)) throw new UserFacingError(localized('errors.tasks.unknownProvider', { provider: String(draft.provider) }));
    const key = comparablePath(draft.accountDir, this.deps.caseInsensitive);
    const known = this.deps.listAccounts().some((a) => a.provider === draft.provider && comparablePath(a.configDir, this.deps.caseInsensitive) === key);
    if (!known) throw new UserFacingError(localized('errors.tasks.unknownAccount', { accountDir: draft.accountDir }));
  }

  private assertCount(items: readonly string[], max: number): void {
    if (items.length > max) throw new UserFacingError(localized('errors.tasks.tooMany', { max }));
  }

  private assertPaths(paths: readonly string[], exists: (path: string) => boolean, missingKey: 'errors.tasks.folderMissing' | 'errors.tasks.documentMissing'): void {
    for (const path of paths) {
      if (!isAbsolute(path)) throw new UserFacingError(localized('errors.tasks.notAbsolute', { path }));
      if (!exists(resolve(path))) throw new UserFacingError(localized(missingKey, { path }));
    }
  }

  // Quita duplicados (con la regla de mayúsculas del sistema) conservando el primero.
  private unique(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    return paths.filter((path) => {
      const key = isAbsolute(path) ? comparablePath(path, this.deps.caseInsensitive) : path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
