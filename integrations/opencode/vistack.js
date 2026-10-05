// OpenCode bridge for the local advisory decision engine.
// Copy this file to .opencode/plugins/vistack.js or publish it as an npm plugin.

import { spawn } from "node:child_process"
import { basename, join } from "node:path"
import { tool } from "@opencode-ai/plugin"

const DECISION_TYPES = [
  "intake-analysis",
  "grooming",
  "playbook-selection",
  "decomposition",
  "tier-selection",
  "dispatch-readiness",
  "runtime-progress",
  "verification",
  "skill-improvement",
  "tool-selection",
  "file-selection",
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

const TOGGLE_ACTIONS = ["on", "off", "status"]
// `on` preloads the Ollama model: about 7 s cold for clef-flash, within a 60 s load budget.
const TOGGLE_TIMEOUT_MS = { on: 65000 }

const QA_VIDEO_COMMANDS = ["doctor", "record", "finish", "check"]

// qa-video exits 1 when the evidence itself failed; its stdout JSON says why, so that is a result, not an error.
function runQaVideo(directory, script, command, cliArguments) {
  const timeoutMs = command === "record" ? 15 * 60 * 1000 : 5 * 60 * 1000
  const executable = /^node(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : "node"
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [script, command, ...cliArguments], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`qa-video ${command} exceeded ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => { clearTimeout(timer); reject(error) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
        return
      }
      if (code === 1 && command !== "doctor") {
        resolve(stderr ? `${stdout}\n${stderr}` : stdout)
        return
      }
      reject(new Error(stderr || stdout || `qa-video ${command} exited with ${code}`))
    })
  })
}

export const ViStackPlugin = async ({ directory }) => {
  // A copied local plugin lives in the consuming project, while an installed
  // bridge can point at the viStack checkout through VISTACK_ROOT.
  const root = process.env.VISTACK_ROOT || directory
  const helper = join(root, "scripts", "vistack-decision.py")
  const config = join(directory, ".codex", "vistack", "laya.json")
  const qaVideo = join(root, "skills", "qa-video", "scripts", "qa-video.mjs")
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
      vistack_decisions_toggle: tool({
        description: "Turn the default-on fork-layer decision models on or off, or inspect their status.",
        args: {
          action: tool.schema.string().describe(`One of: ${TOGGLE_ACTIONS.join(", ")}`),
          ollama_model: tool.schema
            .string()
            .optional()
            .describe("Ollama decision model: clef-flash, or none; used only when action is on"),
        },
        async execute(args) {
          if (!TOGGLE_ACTIONS.includes(args.action)) {
            throw new Error(`action must be one of: ${TOGGLE_ACTIONS.join(", ")}`)
          }
          const command = [helper, "decisions", args.action, "--config", config]
          if (args.action === "on" && args.ollama_model) {
            command.push("--ollama-model", args.ollama_model)
          }
          return await runPython(directory, command, "", TOGGLE_TIMEOUT_MS[args.action])
        },
      }),
      vistack_qa_video: tool({
        description: "Record, finish, or check QA screen evidence (webm, step PNGs, captions, manifest). Credentials come from the environment, never from arguments.",
        args: {
          command: tool.schema.string().describe(`One of: ${QA_VIDEO_COMMANDS.join(", ")}`),
          args_json: tool.schema
            .string()
            .describe('JSON array of CLI argument strings, for example ["--manifest", "qa/flow.manifest.json", "--mp4"]. Never credentials.'),
        },
        async execute(args) {
          if (!QA_VIDEO_COMMANDS.includes(args.command)) {
            throw new Error(`command must be one of: ${QA_VIDEO_COMMANDS.join(", ")}`)
          }
          let cliArguments
          try {
            cliArguments = JSON.parse(args.args_json || "[]")
          } catch {
            throw new Error("args_json must be a JSON array of strings")
          }
          if (!Array.isArray(cliArguments) || !cliArguments.every((item) => typeof item === "string")) {
            throw new Error("args_json must be a JSON array of strings")
          }
          return await runQaVideo(directory, qaVideo, args.command, cliArguments)
        },
      }),
    },
  }
}
