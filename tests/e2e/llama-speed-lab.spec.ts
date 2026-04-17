import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await request.post("/api/server/stop", { data: { runtime: "all" } }).catch(() => null);
});

test.afterAll(async ({ request }) => {
  await request.post("/api/server/stop", { data: { runtime: "all" } }).catch(() => null);
});

test("renders the runtime comparison dashboard", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /gemma 4 local runtime lab/i })).toBeVisible();
  await expect(page.getByTestId("runtime-llamacpp")).toBeVisible();
  await expect(page.getByTestId("runtime-ollama")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last Comparison" })).toBeVisible();
  await expect(page.getByLabel("llama-server.exe")).toHaveValue(/llama-server\.exe/i);
  await expect(page.getByLabel("Model Path")).toHaveValue(/gemma-4-E2B-it-Q8_0\.gguf/i);
  await expect(page.getByTestId("send-prompt-button")).toBeDisabled();
});

test("switches between llama.cpp and Ollama and streams real responses", async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  await page.goto("/");

  await runRuntime(page, "llamacpp");
  await expect(page.getByTestId("comparison-llamacpp")).not.toContainText("No run yet.");

  await page.getByTestId("runtime-ollama").click();
  await expect(page.getByLabel("ollama.exe")).toHaveValue(/ollama/i);

  await runRuntime(page, "ollama");
  await expect(page.getByTestId("comparison-ollama")).not.toContainText("No run yet.");

  await expect(page.getByTestId("comparison-llamacpp")).toContainText(/gemma-4-E2B-it-Q8_0\.gguf/i);
  await expect(page.getByTestId("comparison-ollama")).toContainText(/gemma4e2b-q8-local/i);
});

async function runRuntime(page: Page, runtime: "llamacpp" | "ollama") {
  await page.getByTestId(`runtime-${runtime}`).click();
  await ensureRuntimeReady(page);

  const promptInput = page.getByTestId("prompt-input");
  await promptInput.fill("Reply with the exact text SPEED OK and nothing else.");

  const sendButton = page.getByTestId("send-prompt-button");
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await sendButton.click();

  const chatStream = page.getByTestId("chat-stream");
  await expect(chatStream).toContainText("Reply with the exact text SPEED OK and nothing else.");
  await expect(chatStream).toContainText(/SPEED OK/i, { timeout: 180_000 });
  await expect(page.getByTestId("status-text")).toContainText("Stream complete.", {
    timeout: 180_000,
  });

  await expect(page.getByTestId("metric-first-token")).not.toHaveText("--");
  await expect(page.getByTestId("metric-prompt-tok-s")).toHaveText(/^\d+\.\d{2}$/);
  await expect(page.getByTestId("metric-gen-tok-s")).toHaveText(/^\d+\.\d{2}$/);
  await expect(page.getByTestId("metric-total")).toHaveText(/^\d+\.\d{2}s$/);
  await expect(page.getByTestId("metrics-detail")).toContainText(/prompt=\d+ · gen=\d+ · total=\d+/);
}

async function ensureRuntimeReady(page: Page) {
  const statusText = page.getByTestId("status-text");
  const reachableBadge = page.getByText("Reachable", { exact: true });

  const alreadyReachable = await reachableBadge.isVisible().catch(() => false);

  if (!alreadyReachable) {
    await page.getByTestId("start-server-button").click();
    await expect(statusText).toContainText(/ready on|already reachable/i, { timeout: 240_000 });
    await expect(reachableBadge).toBeVisible({ timeout: 60_000 });
    return;
  }

  await expect(statusText).toContainText(/ready on|reachable|checking/i, {
    timeout: 30_000,
  });
}
