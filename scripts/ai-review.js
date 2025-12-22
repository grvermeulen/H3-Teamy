#!/usr/bin/env node
const { execSync } = require("node:child_process");
const https = require("https");

function getChangedDiff() {
  const base =
    process.env.GITHUB_BASE_REF || "origin/" + process.env.GITHUB_BASE_REF;
  try {
    return execSync(
      'git fetch --depth=50 origin "' +
        process.env.GITHUB_BASE_REF +
        '":"' +
        process.env.GITHUB_BASE_REF +
        '" && git diff --unified=0 HEAD^',
    ).toString();
  } catch {
    try {
      return execSync("git diff --unified=0 HEAD~1").toString();
    } catch {
      return "";
    }
  }
}

function openaiReview(diff) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a strict code reviewer. Summarize risk, point out bugs, security issues, missing tests, and style violations. Be concise and actionable.",
        },
        {
          role: "user",
          content: `Review this git diff and provide PR feedback with bullets and code snippets when helpful.\n\n${diff}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });

    const req = https.request(
      {
        method: "POST",
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const content =
              parsed.choices?.[0]?.message?.content?.trim() || "No feedback.";
            resolve(content);
          } catch (e) {
            reject(e);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function postGitHubComment(repo, prNumber, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ body });
    const req = https.request(
      {
        method: "POST",
        hostname: "api.github.com",
        path: `/repos/${repo}/issues/${prNumber}/comments`,
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "User-Agent": "ai-review-bot",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              resolve();
            } else {
              reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "AI review required for high-risk changes but OPENAI_API_KEY is not configured.",
  );
  console.error("Add repository secret OPENAI_API_KEY to enable AI PR review.");
  process.exit(1);
}

if (
  !process.env.GITHUB_TOKEN ||
  !process.env.GITHUB_REPOSITORY ||
  !process.env.PR_NUMBER
) {
  console.error(
    "Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or PR_NUMBER env vars.",
  );
  process.exit(1);
}

const diff = getChangedDiff();
if (!diff) {
  console.log("No diff found. Passing.");
  process.exit(0);
}

(async () => {
  console.log("Submitting diff to AI reviewer...");
  let feedback;
  try {
    feedback = await openaiReview(diff);
  } catch (e) {
    console.error("OpenAI review failed:", e.message);
    process.exit(1);
  }

  const header = "### AI Review\n";
  const body = `${header}${feedback}`;

  try {
    await postGitHubComment(
      process.env.GITHUB_REPOSITORY,
      process.env.PR_NUMBER,
      body,
    );
    console.log("Posted AI review comment to PR #" + process.env.PR_NUMBER);
    process.exit(0);
  } catch (e) {
    console.error("Failed to post GitHub comment:", e.message);
    process.exit(1);
  }
})();
