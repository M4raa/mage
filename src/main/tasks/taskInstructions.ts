// Instrucciones técnicas de una tarea (F8.2). Van en inglés por el canal que ya existe para ello
// (`projectInstructions`: Claude `--append-system-prompt`, Codex `developerInstructions`).
import { TASK_DELIVERABLES_FENCE, TASK_PLAN_FENCE, type TaskLanguage, type TaskRecord } from '@shared/tasks';

type InstructionsInput = Pick<TaskRecord, 'provider' | 'language' | 'folders' | 'documents' | 'capabilities'>;

const FENCE = '`'.repeat(3);
const LANGUAGE_NAMES: Readonly<Record<TaskLanguage, string>> = { es: 'Spanish', en: 'English' };
const EXTRA_TITLES: Readonly<Record<InstructionsInput['provider'], string>> = {
  claude: 'Other folders you may read and write:',
  codex: 'Other folders you may read (your sandbox only lets you write in the working folder):',
};

function bullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function foldersSection(task: InstructionsInput, workingFolder: string): string[] {
  const extras = task.folders.slice(1);
  return [
    '## Authorized folders',
    `Working folder: ${workingFolder}`,
    ...(extras.length === 0 ? [] : [EXTRA_TITLES[task.provider], ...bullets(extras)]),
    'Never create, modify, move or delete anything outside these folders. Do not delete files unless the goal explicitly asks for it.',
  ];
}

// Una sección cuya lista está vacía no se escribe.
function listSection(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [title, ...bullets(items)];
}

const PLAN_SECTION: readonly string[] = [
  '## Plan',
  `If the task needs more than two steps, start with a plan and update it whenever a step is done, as a fenced block with the info string ${TASK_PLAN_FENCE}:`,
  `${FENCE}${TASK_PLAN_FENCE}`,
  '- [ ] first step',
  '- [x] finished step',
  FENCE,
];

const DELIVERABLES_SECTION: readonly string[] = [
  '## Deliverables',
  `When you finish, end your final message with the files you produced or changed for the user, as a JSON array of paths (relative to the working folder, or absolute) in a fenced block with the info string ${TASK_DELIVERABLES_FENCE}:`,
  `${FENCE}${TASK_DELIVERABLES_FENCE}`,
  '["report.md"]',
  FENCE,
  'List only files that exist. Mage checks each one; the task is not complete until they pass.',
];

export function buildTaskInstructions(task: InstructionsInput): string {
  const workingFolder = task.folders[0];
  if (workingFolder === undefined) throw new Error(`buildTaskInstructions: la tarea necesita al menos una carpeta, recibido ${JSON.stringify(task.folders)}`);
  const sections: readonly (readonly string[])[] = [
    [
      '# Mage task mode',
      'You are carrying out a task for the user inside Mage. The goal is in the user\'s first message.',
      `Write every message to the user in ${LANGUAGE_NAMES[task.language]}, the language the user chose.`,
    ],
    foldersSection(task, workingFolder),
    listSection('## Authorized documents (read-only inputs)', task.documents),
    listSection('## Capabilities the user selected', task.capabilities),
    PLAN_SECTION,
    DELIVERABLES_SECTION,
  ];
  return sections.filter((section) => section.length > 0).map((section) => section.join('\n')).join('\n\n');
}
