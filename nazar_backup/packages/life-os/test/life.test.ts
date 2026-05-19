import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { run } from "../src/life";

async function lifeRoot(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "life-os-test-"));
}

test("check creates the canonical layout", async () => {
  const root = await lifeRoot();
  const result = await run(["--root", root, "check"], { LIFE_TODAY: "2026-05-18" });

  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`life root ok: ${root}`);
  expect(await readFile(path.join(root, "config/life.yaml"), "utf8")).toContain("owner:");
  expect(await readFile(path.join(root, "calendar/personal.ics"), "utf8")).toContain("BEGIN:VCALENDAR");
});

test("tasks can be added, listed, and completed", async () => {
  const root = await lifeRoot();
  await run(["--root", root, "task", "add", "write runbook"], { LIFE_TODAY: "2026-05-18" });

  const listed = await run(["--root", root, "task", "list"], { LIFE_TODAY: "2026-05-18" });
  expect(listed.stdout).toBe("1. write runbook");

  const done = await run(["--root", root, "task", "done", "1"], { LIFE_TODAY: "2026-05-18" });
  expect(done.stdout).toBe("done: write runbook");
  expect(await readFile(path.join(root, "tasks/done.todo"), "utf8")).toContain("x 2026-05-18 write runbook");
});

test("journal and habit commands write plain files", async () => {
  const root = await lifeRoot();
  await run(["--root", root, "journal", "add", "Started Life OS."], { LIFE_TODAY: "2026-05-18" });
  await run(["--root", root, "habit", "log", "exercise", "walk"], { LIFE_TODAY: "2026-05-18" });

  expect(await readFile(path.join(root, "journal/2026/2026-05-18.md"), "utf8")).toContain("Started Life OS.");
  expect(await readFile(path.join(root, "habits/log.jsonl"), "utf8")).toContain('"habit":"exercise"');
});

test("daily review summarizes the simple stores", async () => {
  const root = await lifeRoot();
  await run(["--root", root, "task", "add", "plan tomorrow", "--list", "next"], { LIFE_TODAY: "2026-05-18" });
  await run(["--root", root, "journal", "add", "Reviewed the day."], { LIFE_TODAY: "2026-05-18" });
  await run(["--root", root, "habit", "log", "sleep"], { LIFE_TODAY: "2026-05-18" });

  const review = await run(["--root", root, "review", "daily"], { LIFE_TODAY: "2026-05-18" });
  expect(review.stdout).toContain("Daily review 2026-05-18");
  expect(review.stdout).toContain("- plan tomorrow");
  expect(review.stdout).toContain("- sleep");
});
