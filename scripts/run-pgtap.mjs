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

async function runTest(testPath) {
  const token = readAccessToken()
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is missing from .env.local")
    return 2
  }

  const projectRef = readFileSync("supabase/.temp/project-ref", "utf8").trim()
  const sql = readFileSync(testPath, "utf8")

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
    .map((row) => row.finish)
    .filter((line) => typeof line === "string" && line.trim() !== "")

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
