import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await request.post("/api/server/stop").catch(() => null);
});

test.afterAll(async ({ request }) => {
  await request.post("/api/server/stop").catch(() => null);
});

test("renders the llama.cpp speed dashboard", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /gemma 4 igpu speed lab/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Server" })).toBeVisible();
  await expect(page.getByLabel("llama-server.exe")).toHaveValue(/llama-server\.exe/i);
  await expect(page.getByLabel("Model Path")).toHaveValue(/gemma-4-E2B-it-Q8_0\.gguf/i);
  await expect(page.getByTestId("send-prompt-button")).toBeDisabled();
});

test("starts llama.cpp and streams a real response with timings", async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);

  await page.goto("/");

  const statusText = page.getByTestId("status-text");
  const reachableBadge = page.getByText("Reachable", { exact: true });

  const alreadyReachable = await reachableBadge.isVisible().catch(() => false);

  if (!alreadyReachable) {
    await page.getByTestId("start-server-button").click();
    await expect(statusText).toContainText(/ready on|already reachable/i, { timeout: 240_000 });
    await expect(reachableBadge).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(statusText).toContainText(/ready on|server is not reachable yet|checking/i, {
      timeout: 30_000,
    });
  }

  const promptInput = page.getByTestId("prompt-input");
  await promptInput.fill("Reply with the exact text SPEED OK and nothing else.");

  const sendButton = page.getByTestId("send-prompt-button");
  await expect(sendButton).toBeEnabled({ timeout: 30_000 });
  await sendButton.click();

  const chatStream = page.getByTestId("chat-stream");
  await expect(chatStream).toContainText("Reply with the exact text SPEED OK and nothing else.");
  await expect(chatStream).toContainText(/SPEED OK/i, { timeout: 180_000 });
  await expect(statusText).toContainText("Stream complete.", { timeout: 180_000 });

  await expect(page.getByTestId("metric-first-token")).not.toHaveText("--");
  await expect(page.getByTestId("metric-prompt-tok-s")).toHaveText(/^\d+\.\d{2}$/);
  await expect(page.getByTestId("metric-gen-tok-s")).toHaveText(/^\d+\.\d{2}$/);
  await expect(page.getByTestId("metric-total")).toHaveText(/^\d+\.\d{2}s$/);
  await expect(page.getByTestId("metrics-detail")).toContainText(/prompt=\d+ · gen=\d+ · total=\d+/);
});
