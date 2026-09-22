// OpenCode bridge for the local advisory decision engine.
// Copy this file to .opencode/plugins/vistack.js or publish it as an npm plugin.

import { spawn } from "node:child_process"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"

const DECISION_TYPES = [
  "intake-analysis",
  "grooming",
  "playbook-selection",
  "decomposition",
  "dispatch-readiness",
  "runtime-progress",
  "verification",
  "skill-improvement",
]

function runPython(directory, arguments_, input, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", arguments_, { cwd: directory, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`decision helper exceeded ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => { clearTimeout(timer); reject(error) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr || `decision helper exited with ${code}`))
        return
      }
      resolve(stdout)
    })
    child.stdin.end(input)
  })
}

export const ViStackPlugin = async ({ directory }) => {
  // A copied local plugin lives in the consuming project, while an installed
  // bridge can point at the viStack checkout through VISTACK_ROOT.
  const root = process.env.VISTACK_ROOT || directory
  const helper = join(root, "scripts", "vistack-decision.py")
  const config = join(directory, ".codex", "vistack", "laya.json")
  return {
    tool: {
      vistack_decision: tool({
        description: "Get a typed, advisory viStack decision. Execution rules and fences remain authoritative.",
        args: {
          decision_type: tool.schema.string().describe(`One of: ${DECISION_TYPES.join(", ")}`),
          context_json: tool.schema.string().describe("JSON DecisionContext without secrets"),
        },
        async execute(args) {
          if (!DECISION_TYPES.includes(args.decision_type)) {
            throw new Error(`unsupported decision type: ${args.decision_type}`)
          }
          return await runPython(
            directory,
            [helper, "decision", args.decision_type, "--config", config],
            args.context_json,
          )
        },
      }),
      vistack_laya_toggle: tool({
        description: "Turn default-on local Laya refinement on, off, or inspect its status.",
        args: {
          action: tool.schema.string().describe("on, off, or status"),
        },
        async execute(args) {
          if (!["on", "off", "status"].includes(args.action)) {
            throw new Error("action must be on, off, or status")
          }
          return await runPython(directory, [helper, "laya", args.action, "--config", config], "")
        },
      }),
    },
  }
}
