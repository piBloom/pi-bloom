import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

type CommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};

type CliOptions = {
  root: string;
  today: string;
};

const defaultRoot = "/srv/life";
const taskLists = new Set(["inbox", "next", "someday", "done"]);

export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  const result = await run(argv, env);
  if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
  return result.code;
}

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  const parsed = parseArgs(argv, env);
  if ("error" in parsed) return fail(parsed.error);

  const { args, options } = parsed;
  const [command, subcommand, ...rest] = args;

  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return ok(helpText());
      case "check":
        await ensureLayout(options.root);
        return ok(`life root ok: ${options.root}`);
      case "status":
        await ensureLayout(options.root);
        return ok(await status(options.root, options.today));
      case "journal":
        if (subcommand !== "add") return fail("usage: life journal add <text>");
        await ensureLayout(options.root);
        return ok(await addJournal(options.root, options.today, rest.join(" ")));
      case "task":
        await ensureLayout(options.root);
        return await taskCommand(options.root, options.today, subcommand, rest);
      case "habit":
        if (subcommand !== "log") return fail("usage: life habit log <habit-id> [note]");
        await ensureLayout(options.root);
        return ok(await logHabit(options.root, options.today, rest[0], rest.slice(1).join(" ")));
      case "review":
        if (subcommand !== "daily") return fail("usage: life review daily");
        await ensureLayout(options.root);
        return ok(await dailyReview(options.root, options.today));
      default:
        return fail(`unknown command: ${command}\n\n${helpText()}`);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): { args: string[]; options: CliOptions } | { error: string } {
  const args = [...argv];
  let root = env.LIFE_ROOT || defaultRoot;
  const today = env.LIFE_TODAY || new Date().toISOString().slice(0, 10);

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--root") {
      const value = args[i + 1];
      if (!value) return { error: "missing value for --root" };
      root = value;
      args.splice(i, 2);
      i -= 1;
    } else if (args[i].startsWith("--root=")) {
      root = args[i].slice("--root=".length);
      args.splice(i, 1);
      i -= 1;
    }
  }

  return { args, options: { root: path.resolve(root), today } };
}

async function ensureLayout(root: string): Promise<void> {
  const dirs = [
    "config",
    "calendar",
    "tasks",
    "projects/active",
    "projects/archived",
    "journal",
    "habits",
    "notes",
    "exports",
    "scripts",
    "var/cache",
    "var/indexes",
    "var/state",
  ];

  await mkdir(root, { recursive: true });
  await Promise.all(dirs.map((dir) => mkdir(path.join(root, dir), { recursive: true })));

  await writeIfMissing(path.join(root, "README.md"), lifeReadme());
  await writeIfMissing(path.join(root, "config/life.yaml"), lifeConfig());
  await writeIfMissing(path.join(root, "calendar/personal.ics"), emptyCalendar("Life OS Personal"));
  await writeIfMissing(path.join(root, "calendar/reminders.ics"), emptyCalendar("Life OS Reminders"));
  await writeIfMissing(path.join(root, "tasks/inbox.todo"), "");
  await writeIfMissing(path.join(root, "tasks/next.todo"), "");
  await writeIfMissing(path.join(root, "tasks/someday.todo"), "");
  await writeIfMissing(path.join(root, "tasks/done.todo"), "");
  await writeIfMissing(path.join(root, "habits/habits.yaml"), habitsConfig());
  await writeIfMissing(path.join(root, "habits/log.jsonl"), "");
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  if (!existsSync(file)) await writeFile(file, content, "utf8");
}

async function status(root: string, today: string): Promise<string> {
  const inbox = await countLines(path.join(root, "tasks/inbox.todo"));
  const next = await countLines(path.join(root, "tasks/next.todo"));
  const done = await countDoneToday(path.join(root, "tasks/done.todo"), today);
  const journal = existsSync(journalPath(root, today)) ? "yes" : "no";
  const habits = await countHabitLogs(path.join(root, "habits/log.jsonl"), today);

  return [
    `root: ${root}`,
    `inbox tasks: ${inbox}`,
    `next tasks: ${next}`,
    `done today: ${done}`,
    `journal today: ${journal}`,
    `habits logged today: ${habits}`,
  ].join("\n");
}

async function taskCommand(
  root: string,
  today: string,
  subcommand: string | undefined,
  args: string[],
): Promise<CommandResult> {
  switch (subcommand) {
    case "add":
      return ok(await addTask(root, args));
    case "list":
      return ok(await listTasks(root, args[0] || "inbox"));
    case "done":
      return ok(await doneTask(root, today, args));
    default:
      return fail("usage: life task add <text> | task list [inbox|next|someday|done] | task done <number> [list]");
  }
}

async function addTask(root: string, args: string[]): Promise<string> {
  const { list, text } = parseTaskInput(args);
  if (!text) throw new Error("usage: life task add <text> [--list inbox|next|someday]");
  if (list === "done") throw new Error("new tasks cannot be added directly to done");

  const file = path.join(root, `tasks/${list}.todo`);
  await appendLine(file, text);
  return `added to ${list}: ${text}`;
}

async function listTasks(root: string, list: string): Promise<string> {
  assertTaskList(list);
  const lines = await readLines(path.join(root, `tasks/${list}.todo`));
  if (lines.length === 0) return `${list}: no tasks`;
  return lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

async function doneTask(root: string, today: string, args: string[]): Promise<string> {
  const number = Number(args[0]);
  const list = args[1] || "inbox";
  if (!Number.isInteger(number) || number < 1) throw new Error("usage: life task done <number> [list]");
  if (list === "done") throw new Error("cannot complete a task from done");
  assertTaskList(list);

  const file = path.join(root, `tasks/${list}.todo`);
  const lines = await readLines(file);
  const [task] = lines.splice(number - 1, 1);
  if (!task) throw new Error(`task ${number} not found in ${list}`);

  await writeFile(file, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
  const completed = `x ${today} ${task}`;
  await appendLine(path.join(root, "tasks/done.todo"), completed);
  return `done: ${task}`;
}

async function addJournal(root: string, today: string, text: string): Promise<string> {
  if (!text.trim()) throw new Error("usage: life journal add <text>");
  const file = journalPath(root, today);
  await mkdir(path.dirname(file), { recursive: true });
  if (!existsSync(file)) {
    await writeFile(
      file,
      `---\ndate: ${today}\ntags: [journal]\nmood:\nenergy:\n---\n\n# ${today}\n\n`,
      "utf8",
    );
  }
  await appendLine(file, text.trim());
  return `journal updated: ${relative(root, file)}`;
}

async function logHabit(root: string, today: string, habit: string | undefined, note: string): Promise<string> {
  if (!habit) throw new Error("usage: life habit log <habit-id> [note]");
  const event = {
    date: today,
    habit,
    value: true,
    ...(note ? { note } : {}),
  };
  await appendLine(path.join(root, "habits/log.jsonl"), JSON.stringify(event));
  return `habit logged: ${habit}`;
}

async function dailyReview(root: string, today: string): Promise<string> {
  const journalFile = journalPath(root, today);
  const next = await readLines(path.join(root, "tasks/next.todo"));
  const inbox = await readLines(path.join(root, "tasks/inbox.todo"));
  const done = await doneToday(path.join(root, "tasks/done.todo"), today);
  const habits = await habitLogsToday(path.join(root, "habits/log.jsonl"), today);

  return [
    `Daily review ${today}`,
    "",
    `Journal: ${existsSync(journalFile) ? relative(root, journalFile) : "missing"}`,
    "",
    "Next:",
    ...(next.length ? next.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Inbox:",
    ...(inbox.length ? inbox.map((line) => `- ${line}`) : ["- empty"]),
    "",
    "Done today:",
    ...(done.length ? done.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Habits today:",
    ...(habits.length ? habits.map((line) => `- ${line}`) : ["- none"]),
  ].join("\n");
}

function parseTaskInput(args: string[]): { list: string; text: string } {
  const remaining = [...args];
  let list = "inbox";
  for (let i = 0; i < remaining.length; i += 1) {
    if (remaining[i] === "--list") {
      list = remaining[i + 1] || "";
      remaining.splice(i, 2);
      i -= 1;
    } else if (remaining[i].startsWith("--list=")) {
      list = remaining[i].slice("--list=".length);
      remaining.splice(i, 1);
      i -= 1;
    }
  }
  assertTaskList(list);
  return { list, text: remaining.join(" ").trim() };
}

function assertTaskList(list: string): void {
  if (!taskLists.has(list)) throw new Error(`unknown task list: ${list}`);
}

async function appendLine(file: string, line: string): Promise<void> {
  const current = existsSync(file) ? await readFile(file, "utf8") : "";
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await writeFile(file, `${current}${prefix}${line}\n`, "utf8");
}

async function readLines(file: string): Promise<string[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function countLines(file: string): Promise<number> {
  return (await readLines(file)).length;
}

async function doneToday(file: string, today: string): Promise<string[]> {
  return (await readLines(file)).filter((line) => line.startsWith(`x ${today} `));
}

async function countDoneToday(file: string, today: string): Promise<number> {
  return (await doneToday(file, today)).length;
}

async function habitLogsToday(file: string, today: string): Promise<string[]> {
  const lines = await readLines(file);
  return lines.flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event.date === today ? [`${event.habit}${event.note ? `: ${event.note}` : ""}`] : [];
    } catch {
      return [];
    }
  });
}

async function countHabitLogs(file: string, today: string): Promise<number> {
  return (await habitLogsToday(file, today)).length;
}

function journalPath(root: string, today: string): string {
  return path.join(root, "journal", today.slice(0, 4), `${today}.md`);
}

function relative(root: string, file: string): string {
  return path.relative(root, file);
}

function ok(stdout: string): CommandResult {
  return { code: 0, stdout };
}

function fail(stderr: string): CommandResult {
  return { code: 1, stderr };
}

function helpText(): string {
  return [
    "usage: life [--root PATH] <command>",
    "",
    "commands:",
    "  check",
    "  status",
    "  journal add <text>",
    "  task add <text> [--list inbox|next|someday]",
    "  task list [inbox|next|someday|done]",
    "  task done <number> [list]",
    "  habit log <habit-id> [note]",
    "  review daily",
    "",
    "environment:",
    "  LIFE_ROOT   data root, defaults to /srv/life",
    "  LIFE_TODAY  YYYY-MM-DD override for tests/reviews",
  ].join("\n");
}

function lifeReadme(): string {
  return `# Life OS Data

This directory is the canonical Life OS store. Keep it plain, editable, and
backup-friendly. Generated caches belong under var/cache or var/indexes.

Primary files:

- tasks/*.todo: todo.txt-style task lists.
- journal/YYYY/YYYY-MM-DD.md: daily Markdown journal entries.
- habits/habits.yaml: habit definitions.
- habits/log.jsonl: append-only habit events.
- calendar/*.ics: local iCalendar files for future standards-based interop.
`;
}

function lifeConfig(): string {
  return `root: /srv/life
timezone: Europe/Bucharest
owner:
  user: alex
  group: users
`;
}

function habitsConfig(): string {
  return `habits:
  - id: sleep
    name: Sleep before midnight
    cadence: daily
  - id: exercise
    name: Exercise
    cadence: daily
`;
}

function emptyCalendar(name: string): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Life OS//Nazar//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:${name}
END:VCALENDAR
`;
}

if (import.meta.main) {
  process.exit(await main());
}
