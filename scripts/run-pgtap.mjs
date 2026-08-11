#!/usr/bin/env node
/**
 * Run a pgTAP test file against the linked Supabase project.
 *
 * `supabase test db` needs Docker to spin up a local database, and Docker is
 * not installed on this workstation. Each test file is already wrapped in
 * `begin; ... rollback;`, so submitting it through the Management API query
 * endpoint runs it without leaving anything behind — including the
 * `create extension pgtap`, which rolls back with everything else.
 *
 * Caveat: `nextval()` is not transactional, so sequences touched by a test
 * (print_job_sequence, master_item_code_seq, ...) stay advanced afterwards.
 * That only leaves gaps in generated codes, never wrong or duplicate values.
 *
 * Usage: node scripts/run-pgtap.mjs supabase/tests/database/014_....test.sql
 */
import { readFileSync } from "node:fs"

function readAccessToken() {
  const envLocal = readFileSync(".env.local", "utf8")
  const matched = envLocal.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)
  return matched?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
}

/**
 * The Management API answers with the rows of the last statement that produced
 * any — and `finish()` produces none when every assertion passed. Left alone,
 * a failing file therefore answers with whatever assertion happened to return
 * a row last, which reads exactly like a pass. Parking finish()'s output in a
 * temporary table and selecting it back with `coalesce` makes the final
 * statement return one row either way, so silence means success and nothing
 * else can be mistaken for it.
 */
function withDiagnosticsLast(sql, testPath) {
  const finishCall = /select\s+\*\s+from\s+finish\s*\(\s*\)\s*;/i

  if (!finishCall.test(sql)) {
    console.error(`FAIL  ${testPath}`)
    console.error("No `select * from finish();` found in the test file.")
    return 1
  }

  return sql.replace(
    finishCall,
    "create temporary table pgtap_diagnostics as select * from finish();\n" +
      "select coalesce(string_agg(line.finish, chr(10)), '') as diagnostics\n" +
      "from pgtap_diagnostics line;",
  )
}

async function runTest(testPath) {
  const token = readAccessToken()
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is missing from .env.local")
    return 2
  }

  const projectRef = readFileSync("supabase/.temp/project-ref", "utf8").trim()
  const sql = withDiagnosticsLast(readFileSync(testPath, "utf8"), testPath)
  if (typeof sql !== "string") return sql

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  )

  const body = await response.text()

  if (!response.ok) {
    console.error(`FAIL  ${testPath}`)
    console.error(`HTTP ${response.status}: ${body}`)
    return 1
  }

  let rows
  try {
    rows = JSON.parse(body)
  } catch {
    console.error(`FAIL  ${testPath}`)
    console.error(`Unparseable response: ${body}`)
    return 1
  }

  if (!Array.isArray(rows)) {
    console.error(`FAIL  ${testPath}`)
    console.error(body)
    return 1
  }

  // finish() emits nothing when every assertion passed, and a
  // "# Looks like you failed N tests of M" diagnostic otherwise.
  const diagnostics = rows
    .map((row) => row.diagnostics)
    .filter((line) => typeof line === "string" && line.trim() !== "")

  if (rows.length !== 1 || !("diagnostics" in rows[0])) {
    console.error(`FAIL  ${testPath}`)
    console.error(`Expected the diagnostics row, got: ${body.slice(0, 500)}`)
    return 1
  }

  if (diagnostics.length === 0) {
    console.log(`PASS  ${testPath}`)
    return 0
  }

  console.error(`FAIL  ${testPath}`)
  for (const line of diagnostics) console.error(line)
  return 1
}

const testPath = process.argv[2]

if (!testPath) {
  console.error("usage: node scripts/run-pgtap.mjs <path-to-test.sql>")
  // Setting exitCode rather than calling process.exit() lets Node drain the
  // pooled undici socket; exiting early aborts the process on Windows with a
  // libuv assertion that masks the real exit code.
  process.exitCode = 2
} else {
  process.exitCode = await runTest(testPath)
}
