/**
 * Conductor — intent classification via direct LLM call.
 *
 * The conductor is stage 0 of the realcode pipeline. It classifies the user's
 * request as either a new-project build (full anymake pipeline) or a change to
 * an existing project (agile flow). This determines which branch of the stage
 * graph the run enters.
 *
 * The conductor does NOT spawn a container. It runs a direct LLM call inside
 * the engine process — fast (< 5 sec) and cheap. The classification uses a
 * hybrid approach:
 *   1. Deterministic: if the idea mentions a project name or [target: <project>]
 *      tag, classify as "change" with that target (no LLM call needed).
 *   2. LLM: for ambiguous requests, a lightweight classification call.
 *
 * If the LLM is unavailable (no API key, network error), it defaults to
 * "new_project" (full flow) — the safe fallback.
 */

import * as fs from "fs";
import * as path from "path";

const MISSION_CONTROL_ROOT = process.env.MISSION_CONTROL_ROOT || "/home/royce/mission-control";
const TARGET_TAG_RE = /\[target:\s*([A-Za-z0-9_.-]+)\s*\]/i;

export interface ClassificationResult {
  intent: "new" | "change";
  target_project: string | null;
  flow_type: "full" | "agile";
  clean_idea: string;
  reasoning: string;
  available_projects: string[];
  /** Token usage from the LLM call (zeros if deterministic). */
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
}

/**
 * List available projects by scanning PROJECTS/ for directories with a repo/.
 */
export function listAvailableProjects(): string[] {
  const projectsDir = path.join(MISSION_CONTROL_ROOT, "PROJECTS");
  if (!fs.existsSync(projectsDir)) return [];
  return fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(projectsDir, name, "repo")))
    .sort();
}

/**
 * Classify the user's request as new-project or change.
 *
 * Hybrid approach: deterministic project-name matching first, LLM fallback
 * for ambiguous requests. If the LLM is unavailable, defaults to "new".
 */
export async function classifyIntent(
  idea: string,
  preResolvedTarget?: string,
): Promise<ClassificationResult> {
  const availableProjects = listAvailableProjects();
  const cleanIdea = idea.replace(TARGET_TAG_RE, "").replace(/\s{2,}/g, " ").trim();

  // 0. Honor a pre-resolved target (the dashboard already parsed the [target: X]
  //    tag deterministically and forwarded it in the work-item payload). This
  //    avoids re-parsing an already-stripped idea and skips the LLM entirely —
  //    the deterministic path is instant, free, and never 400s.
  if (preResolvedTarget && availableProjects.includes(preResolvedTarget)) {
    return {
      intent: "change",
      target_project: preResolvedTarget,
      flow_type: "agile",
      clean_idea: cleanIdea,
      reasoning: `Pre-resolved target [target: ${preResolvedTarget}] from dashboard payload — classified as change to ${preResolvedTarget} (no LLM call).`,
      available_projects: availableProjects,
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
    };
  }

  // 1. Check for [target: <project>] tag (defensive — for non-dashboard callers)
  const tagMatch = idea.match(TARGET_TAG_RE);
  if (tagMatch) {
    const target = tagMatch[1].trim();
    if (availableProjects.includes(target)) {
      return {
        intent: "change",
        target_project: target,
        flow_type: "agile",
        clean_idea: cleanIdea,
        reasoning: `Target tag [target: ${target}] found in request — classified as change to ${target}.`,
        available_projects: availableProjects,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
      };
    }
  }

  // 2. Check if the idea mentions any project name
  const ideaLower = idea.toLowerCase();
  for (const project of availableProjects) {
    if (ideaLower.includes(project.toLowerCase())) {
      return {
        intent: "change",
        target_project: project,
        flow_type: "agile",
        clean_idea: cleanIdea,
        reasoning: `Request mentions project name "${project}" — classified as change to ${project}.`,
        available_projects: availableProjects,
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
      };
    }
  }

  // 3. LLM classification for ambiguous requests
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      intent: "new",
      target_project: null,
      flow_type: "full",
      clean_idea: cleanIdea,
      reasoning: "No OPENROUTER_API_KEY — defaulting to new_project (full flow).",
      available_projects: availableProjects,
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
    };
  }

  const model = process.env.ANYMAKE_MODEL_TIER3 || process.env.ANYMAKE_MODEL_TIER1 || "openrouter/z-ai/glm-5.2";
  // OpenRouter model IDs are `provider/model` (e.g. `z-ai/glm-5.2`). The
  // opencode.json config uses an `openrouter/` prefix that opencode strips
  // internally before calling the API, but this direct `fetch` does not —
  // sending `openrouter/z-ai/glm-5.2` returns HTTP 400 "not a valid model
  // ID". Strip the prefix so the direct conductor call resolves the model.
  const openrouterModel = model.replace(/^openrouter\//, "");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openrouterModel,
        messages: [
          {
            role: "system",
            content:
              `You are an intent classifier for realcode, an agentic build system. ` +
              `Classify the user's request as either:\n` +
              `- "new": building a new project from scratch (e.g. "build a CLI that...", "create an app for...")\n` +
              `- "change": modifying, fixing, or adding a feature to an EXISTING project (e.g. "add a footer", "fix the bug in...", "change the color of...")\n\n` +
              `Available existing projects: ${availableProjects.join(", ") || "(none)"}\n\n` +
              `If the request is a change but you can identify which project from context, set target_project. ` +
              `If you cannot determine the target, set target_project to null and intent to "new" (safe fallback).\n\n` +
              `Respond as JSON: {"intent": "new"|"change", "target_project": string|null, "reasoning": string}`,
          },
          { role: "user", content: idea },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    // glm-5.2 (and other reasoning models) may return `content: null` with the
    // answer in `reasoning` when the token budget is consumed by thinking. Try
    // `content` first, then fall back to `reasoning`; if neither carries JSON,
    // treat it as a classification failure (defaults to "new" — safe for
    // genuinely net-new requests, which is the only path that reaches the LLM).
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning;
    if (!content) throw new Error("No content in LLM response");

    // The model may wrap JSON in prose or backticks; extract the first {...} block.
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr) as {
      intent: string;
      target_project: string | null;
      reasoning: string;
    };

    const intent = parsed.intent === "change" ? "change" : "new";
    const targetProject =
      intent === "change" && parsed.target_project && availableProjects.includes(parsed.target_project)
        ? parsed.target_project
        : null;

    // If LLM says change but can't resolve target, default to new (safe fallback)
    const flowType = intent === "change" && targetProject ? "agile" : "full";

    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const estimatedCostUsd = estimateCost(usage.total_tokens, openrouterModel);

    return {
      intent: flowType === "agile" ? "change" : "new",
      target_project: targetProject,
      flow_type: flowType,
      clean_idea: cleanIdea,
      reasoning: parsed.reasoning || "LLM classification",
      available_projects: availableProjects,
      token_usage: {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        estimated_cost_usd: estimatedCostUsd,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      intent: "new",
      target_project: null,
      flow_type: "full",
      clean_idea: cleanIdea,
      reasoning: `LLM classification failed (${msg}) — defaulting to new_project (full flow).`,
      available_projects: availableProjects,
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
    };
  }
}

/**
 * Resolve the live workspace path for a change-flow run.
 * Returns the container-internal path to the project repo.
 */
export function resolveLiveWorkspace(targetProject: string): string {
  return path.join(MISSION_CONTROL_ROOT, "PROJECTS", targetProject, "repo");
}

/**
 * Rough cost estimate based on token count and model.
 */
function estimateCost(totalTokens: number, _model: string): number {
  // Rough: $0.50 per 1M tokens for economy models
  return (totalTokens / 1_000_000) * 0.5;
}
