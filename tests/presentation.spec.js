import { test, expect } from "@playwright/test";
import fs from "node:fs";
const images = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog-images.json", import.meta.url)),
);
const original = JSON.parse(
  fs.readFileSync(new URL("../src/data/catalog-media.json", import.meta.url)),
);
test.beforeEach(async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  test.skip(
    h.backend !== "java",
    "Production image caching and the steel theme run on Java",
  );
});
async function gloves(page) {
  await page.goto("/#market");
  const search = page.getByRole("textbox", { name: "搜索商品", exact: true });
  await search.fill("手套");
  await search.press("Enter");
  return page.locator(".sf-product-visual img").first();
}

test("hero loads eagerly and product cards use small immutable local WebP variants", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => {
    if (r.resourceType() === "image") requests.push(r.url());
  });
  await page.goto("/#market");
  const hero = page.locator(".sf-hero-image img");
  await expect(hero).toHaveAttribute("loading", "eager");
  await expect(hero).toHaveAttribute("fetchpriority", "high");
  await expect
    .poll(() => hero.evaluate((i) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  const image = await gloves(page);
  await expect
    .poll(() => image.evaluate((i) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  const current = await image.evaluate((i) => i.currentSrc);
  expect(current).toContain("/images/optimized/gloves-");
  expect(current).toMatch(/\.webp$/);
  const variant = images.gloves.variants.find((v) => current.endsWith(v.src));
  expect(variant).toBeTruthy();
  expect(variant.width).toBeLessThanOrEqual(768);
  expect(variant.bytes).toBeLessThan(
    fs.statSync("public" + original.gloves.src).size / 10,
  );
  const r = await page.request.get(current);
  expect(r.headers()["cache-control"]).toContain("max-age=31536000");
  expect(r.headers()["cache-control"]).toContain("immutable");
  expect(r.headers()["content-type"]).toContain("image/webp");
  expect((await r.body()).length).toBe(variant.bytes);
  const api = await page.request.get("/api/bootstrap");
  expect(api.headers()["cache-control"]).toContain("no-store");
  expect(requests.some((u) => /\/images\/[^/]+\.jpg/.test(u))).toBe(false);
});

test("an unavailable optimized image falls back to the original licensed photograph", async ({
  page,
}) => {
  await page.route("**/images/optimized/gloves-*.webp", (r) => r.abort());
  const image = await gloves(page);
  await expect
    .poll(() => image.evaluate((i) => i.currentSrc))
    .toContain("/images/gloves.jpg");
  await expect
    .poll(() => image.evaluate((i) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  await expect(image).not.toHaveAttribute("srcset", /.+/);
});

test("missing originals show an accessible placeholder without broken images", async ({
  page,
}) => {
  await page.route("**/images/optimized/gloves-*.webp", (r) => r.abort());
  await page.route("**/images/gloves.jpg", (r) => r.abort());
  await gloves(page);
  await expect(
    page.locator(".sf-product-visual .photo-unavailable").first(),
  ).toBeVisible();
  await expect(
    page.locator(".sf-product-visual .photo-unavailable").first(),
  ).toHaveAttribute("role", "img");
  await expect(
    page.locator(".sf-product-visual .photo-unavailable").first(),
  ).toHaveAttribute("aria-label", "品类照片暂不可用");
});

test("storefront, risk archive and steel workspace share action colors and mobile control sizes", async ({
  page,
}) => {
  await page.goto("/#market");
  const color = await page
    .locator(".sf-search>button")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(color).toBe("rgb(23, 105, 170)");
  await page.goto("/#login");
  await page
    .getByRole("button", { name: "供应商演示 · 只读", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "业务总览", exact: true }),
  ).toBeVisible();
  await page.goto("/#risk");
  const refresh = page.getByRole("button", { name: "刷新资料", exact: true });
  await expect(refresh).toBeVisible();
  expect(await refresh.evaluate((e) => getComputedStyle(e).color)).toBe(color);
  await page.goto("/#steel");
  const action = page.getByRole("button", { name: "新建订单", exact: true });
  await expect(action).toBeVisible();
  expect(
    await action.evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe(color);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await action.evaluate((e) => parseFloat(getComputedStyle(e).minHeight)),
  ).toBeGreaterThanOrEqual(38);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
