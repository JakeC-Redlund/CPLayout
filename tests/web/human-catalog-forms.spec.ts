import { expect, test, type Page } from "@playwright/test";
import { readWorkspace, workspaceKey, workspaceStorageBytes } from "./workspace-fixtures";

const writerLock = "cplayout:workspace:writer:v1";
type FormTestWindow = Window & { releaseCatalogWriter?: () => void; restoreCatalogWrites?: () => void };

test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
});

async function ready(page: Page) {
  await page.goto("/");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key) !== null, workspaceKey)).toBe(true);
}

async function openForm(page: Page, kind: "client" | "project") {
  const drawer = page.getByRole("button", { name: "Open project drawer", exact: true });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId(`project-tree-action-${kind}`).click();
  await expect(page.getByTestId(kind === "client" ? "client-profile-dialog" : "catalog-dialog")).toBeVisible();
}

async function enterContact(page: Page, first = "Ana", last = "Operator") {
  await page.getByTestId("client-profile-first-name-input").fill(first);
  await page.getByTestId("client-profile-last-name-input").fill(last);
}

async function createCustomer(page: Page, company: string) {
  await openForm(page, "client");
  await enterContact(page);
  await page.getByTestId("client-profile-company-input").fill(company);
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
}

async function holdWriter(page: Page) {
  await page.evaluate(async lock => {
    await new Promise<void>(acquired => {
      void navigator.locks.request(lock, () => new Promise<void>(release => {
        (window as FormTestWindow).releaseCatalogWriter = release;
        acquired();
      }));
    });
  }, writerLock);
}

async function releaseWriter(page: Page) {
  await page.evaluate(() => (window as FormTestWindow).releaseCatalogWriter?.());
  await page.evaluate(lock => navigator.locks.request(lock, () => undefined), writerLock);
}

test("customer form prioritizes required contact, associates errors, and keeps its footer reachable in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 430 });
  await ready(page);
  await openForm(page, "client");
  const first = page.getByTestId("client-profile-first-name-input");
  const last = page.getByTestId("client-profile-last-name-input");
  const company = page.getByTestId("client-profile-company-input");
  await expect(company).toHaveValue("");
  await expect(page.getByTestId("client-profile-email-input")).toBeHidden();
  await expect(page.getByTestId("client-profile-save")).toHaveText("Create customer");
  expect(await first.evaluate(element => (element.compareDocumentPosition(document.querySelector('[data-testid="client-profile-last-name-input"]')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)).toBe(true);
  expect(await last.evaluate(element => (element.compareDocumentPosition(document.querySelector('[data-testid="client-profile-company-input"]')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)).toBe(true);
  await page.getByTestId("client-profile-details-toggle").click();
  await page.getByTestId("client-profile-notes-input").fill("Keep this optional note after validation.");
  const save = page.getByTestId("client-profile-save");
  const footerBefore = await save.boundingBox();
  await page.getByTestId("client-profile-dialog-body").evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await save.boundingBox()).toEqual(footerBefore);
  expect(footerBefore).not.toBeNull();
  expect(footerBefore!.y + footerBefore!.height).toBeLessThanOrEqual(430);
  await save.click();
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toHaveAttribute("aria-describedby", "client-profile-first-name-input-error");
  await expect(page.getByTestId("client-profile-first-name-input-error")).toBeInViewport();
  await first.fill("Ana");
  await save.click();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-describedby", "client-profile-last-name-input-error");
  // Removing the first-name error moves this label without resizing the last-name field.
  // Check the whole label against the scroll viewport, not just the focused input.
  await expect.poll(async () => {
    const [label, body] = await Promise.all([
      page.getByText("Last name (required)", { exact: true }).boundingBox(),
      page.getByTestId("client-profile-dialog-body").boundingBox(),
    ]);
    return Boolean(label && body && label.x >= body.x && label.y >= body.y
      && label.x + label.width <= body.x + body.width && label.y + label.height <= body.y + body.height);
  }).toBe(true);
  await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("Keep this optional note after validation.");
  expect((await readWorkspace(page)).catalog.clients).toEqual([]);
  await page.getByTestId("client-profile-dialog").screenshot({ path: test.info().outputPath("required-contact-short-viewport.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
});

test("failed customer save retains every entered value and retries without requiring a company", async ({ page }) => {
  await ready(page);
  await openForm(page, "client");
  await enterContact(page, "Bea", "Farmer");
  await page.getByTestId("client-profile-details-toggle").click();
  const optional = { "middle-initial": "q", suffix: "Jr.", email: "bea@example.test", phone: "555-0112", location: "North field", notes: "Call before arrival." };
  for (const [id, value] of Object.entries(optional)) await page.getByTestId(`client-profile-${id}-input`).fill(value);
  const before = await workspaceStorageBytes(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as FormTestWindow).restoreCatalogWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Synthetic catalog quota failure", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, workspaceKey);
  try {
    await page.getByTestId("client-profile-save").click();
    await expect(page.getByTestId("client-profile-dialog")).toContainText(/quota/i);
    await expect(page.getByTestId("client-profile-save")).toBeEnabled();
    await expect(page.getByTestId("client-profile-first-name-input")).toBeEditable();
    await expect(page.getByTestId("client-profile-details-toggle")).toBeEnabled();
    await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("Bea");
    await expect(page.getByTestId("client-profile-last-name-input")).toHaveValue("Farmer");
    await expect(page.getByTestId("client-profile-company-input")).toHaveValue("");
    for (const [id, value] of Object.entries(optional)) await expect(page.getByTestId(`client-profile-${id}-input`)).toHaveValue(value);
    expect(await workspaceStorageBytes(page)).toEqual(before);
  } finally {
    await page.evaluate(() => (window as FormTestWindow).restoreCatalogWrites?.());
  }
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  expect((await readWorkspace(page)).catalog.clients).toEqual([expect.objectContaining({
    companyName: "", primaryContactFirstName: "Bea", primaryContactLastName: "Farmer",
    primaryContactMiddleInitial: "Q", notes: optional.notes,
  })]);
});

test("pending customer saves prevent typing, detail changes, Escape, and Cancel", async ({ page }) => {
  await ready(page);
  await openForm(page, "client");
  await enterContact(page);
  await page.getByTestId("client-profile-details-toggle").click();
  await page.getByTestId("client-profile-notes-input").fill("Submitted note");
  await holdWriter(page);
  try {
    await page.getByTestId("client-profile-save").click();
    await expect.poll(() => page.evaluate(async lock => (await navigator.locks.query()).pending?.filter(item => item.name === lock).length ?? 0, writerLock)).toBe(1);
    await expect(page.getByTestId("client-profile-cancel")).toBeDisabled();
    await expect(page.getByTestId("client-profile-details-toggle")).toBeDisabled();
    for (const id of ["first-name", "last-name", "company", "middle-initial", "suffix", "email", "phone", "location", "notes"]) {
      await expect(page.getByTestId(`client-profile-${id}-input`)).not.toBeEditable();
    }
    // Real keyboard events against the read-only controls must not create unsaved late edits.
    await page.getByTestId("client-profile-first-name-input").press("End");
    await page.getByTestId("client-profile-first-name-input").press("x");
    await page.getByTestId("client-profile-notes-input").press("End");
    await page.getByTestId("client-profile-notes-input").press("x");
    await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("Submitted note");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
    await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("Ana");
  } finally {
    await releaseWriter(page);
  }
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  expect((await readWorkspace(page)).catalog.clients).toEqual([expect.objectContaining({ primaryContactFirstName: "Ana", primaryContactLastName: "Operator", notes: "Submitted note" })]);
});

test("project validates in field order and creates the edited first field in the same catalog revision", async ({ page }) => {
  await ready(page);
  await createCustomer(page, "Atomic Farms");
  const before = await readWorkspace(page);
  await openForm(page, "project");
  const name = page.getByTestId("catalog-dialog-name-input");
  const field = page.getByTestId("catalog-dialog-first-field-input");
  await expect(page.getByTestId("catalog-dialog-create")).toHaveText("Create project");
  await expect(field).toHaveValue("Field 1");
  await expect(page.getByTestId("catalog-dialog-context")).toContainText("Atomic Farms");
  await name.fill("");
  await field.fill("");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-describedby", "catalog-dialog-error");
  await name.fill("West Project");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-describedby", "catalog-dialog-first-field-input-error");
  await field.fill("West irrigated field");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  const after = await readWorkspace(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.catalog.projects).toEqual([expect.objectContaining({ name: "West Project" })]);
  expect(after.catalog.fieldMaps).toEqual([expect.objectContaining({ name: "West irrigated field", projectId: after.catalog.projects[0].id })]);
});

test("a sibling catalog write cannot erase open customer values when the stale save is rejected", async ({ page, context }) => {
  await ready(page);
  await openForm(page, "client");
  await enterContact(page, "Local", "Contact");
  await page.getByTestId("client-profile-company-input").fill("Local unsaved company");
  await page.getByTestId("client-profile-details-toggle").click();
  await page.getByTestId("client-profile-notes-input").fill("Retain this unsaved note.");
  const sibling = await context.newPage();
  try {
    await ready(sibling);
    await createCustomer(sibling, "Sibling saved company");
    await page.getByTestId("client-profile-save").click();
    await expect(page.getByTestId("client-profile-dialog")).toContainText(/revision|changed|conflict/i);
    await expect(page.getByTestId("client-profile-save")).toBeEnabled();
    await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("Local");
    await expect(page.getByTestId("client-profile-last-name-input")).toHaveValue("Contact");
    await expect(page.getByTestId("client-profile-company-input")).toHaveValue("Local unsaved company");
    await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("Retain this unsaved note.");
    expect((await readWorkspace(page)).catalog.clients).toEqual([expect.objectContaining({ companyName: "Sibling saved company" })]);
    await page.getByTestId("catalog-review-context").click();
    await expect(page.getByTestId("catalog-context-review-result")).toContainText("Saved context checked");
    await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("Retain this unsaved note.");
    await page.getByTestId("client-profile-save").click();
    await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
    expect((await readWorkspace(page)).catalog.clients).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyName: "Sibling saved company" }),
      expect.objectContaining({ companyName: "Local unsaved company", notes: "Retain this unsaved note." }),
    ]));
  } finally {
    await sibling.close();
  }
});


test("a pending project save prevents edits to both project and first-field names", async ({ page }) => {
  await ready(page);
  await createCustomer(page, "Pending project customer");
  await openForm(page, "project");
  const name = page.getByTestId("catalog-dialog-name-input");
  const field = page.getByTestId("catalog-dialog-first-field-input");
  await name.fill("Submitted project");
  await field.fill("Submitted field");
  await holdWriter(page);
  try {
    await page.getByTestId("catalog-dialog-create").click();
    await expect.poll(() => page.evaluate(async lock => (await navigator.locks.query()).pending?.filter(item => item.name === lock).length ?? 0, writerLock)).toBe(1);
    await expect(name).not.toBeEditable();
    await expect(field).not.toBeEditable();
    await name.press("End");
    await name.press("x");
    await field.press("End");
    await field.press("x");
    await expect(name).toHaveValue("Submitted project");
    await expect(field).toHaveValue("Submitted field");
  } finally {
    await releaseWriter(page);
  }
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  const after = await readWorkspace(page);
  expect(after.catalog.projects).toEqual([expect.objectContaining({ name: "Submitted project" })]);
  expect(after.catalog.fieldMaps).toEqual([expect.objectContaining({ name: "Submitted field" })]);
});

// Synthetic lifecycle regression: a real modal blocks pointer access to the task bar.
// Invoke only this app-owned task control directly to exercise owner-task suspension;
// this is not evidence that a person can click through an active modal.
async function suspendCatalogViaSyntheticTaskActivation(page: Page, dialogTestID: string) {
  await page.getByTestId("task-layout").evaluate(element => (element as HTMLElement).click());
  await expect(page.getByTestId("task-layout")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("primary-task-navigation").locator('[role="button"][aria-current="page"]')).toHaveCount(1);
  await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
  await expect(page.getByTestId(dialogTestID)).toBeHidden();
  await page.getByTestId("task-projects").click();
  await expect(page.getByTestId(dialogTestID)).toBeVisible();
}

test("synthetic owner-task suspension preserves raw customer details and errors; explicit Cancel starts a fresh session", async ({ page }) => {
  await ready(page);
  await page.getByTestId("task-projects").click();
  const before = await workspaceStorageBytes(page);
  await openForm(page, "client");
  await page.getByTestId("client-profile-first-name-input").fill("  Ana  ");
  await page.getByTestId("client-profile-company-input").fill("  Uncommitted company  ");
  await page.getByTestId("client-profile-details-toggle").click();
  await page.getByTestId("client-profile-middle-initial-input").fill("q.");
  await page.getByTestId("client-profile-location-input").fill("  North field  ");
  await page.getByTestId("client-profile-notes-input").fill("First line\nKeep this note exactly.  ");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-last-name-input-error")).toBeVisible();

  await suspendCatalogViaSyntheticTaskActivation(page, "client-profile-dialog");

  await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("  Ana  ");
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("  Uncommitted company  ");
  await expect(page.getByTestId("client-profile-details-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("client-profile-middle-initial-input")).toHaveValue("q.");
  await expect(page.getByTestId("client-profile-location-input")).toHaveValue("  North field  ");
  await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("First line\nKeep this note exactly.  ");
  await expect(page.getByTestId("client-profile-last-name-input")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("client-profile-last-name-input-error")).toHaveText("Enter the contact's last name.");
  expect(await workspaceStorageBytes(page)).toEqual(before);

  await page.getByTestId("client-profile-cancel").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await openForm(page, "client");
  await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("");
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("");
  await expect(page.getByTestId("client-profile-details-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("");
  await expect(page.getByTestId("client-profile-last-name-input-error")).toHaveCount(0);
  await page.getByTestId("client-profile-cancel").click();
});

test("synthetic owner-task suspension retains project and first-field validation without persisting or resetting their raw values", async ({ page }) => {
  await ready(page);
  await page.getByTestId("task-projects").click();
  await createCustomer(page, "Suspension customer");
  const before = await workspaceStorageBytes(page);
  await openForm(page, "project");
  await page.getByTestId("catalog-dialog-name-input").fill("  Uncommitted project  ");
  await page.getByTestId("catalog-dialog-first-field-input").fill("  ");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog-first-field-input-error")).toBeVisible();

  await suspendCatalogViaSyntheticTaskActivation(page, "catalog-dialog");

  await expect(page.getByTestId("catalog-dialog-name-input")).toHaveValue("  Uncommitted project  ");
  await expect(page.getByTestId("catalog-dialog-first-field-input")).toHaveValue("  ");
  await expect(page.getByTestId("catalog-dialog-first-field-input")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("catalog-dialog-first-field-input-error")).toHaveText("Enter a name for the first field.");
  expect(await workspaceStorageBytes(page)).toEqual(before);
  await page.getByTestId("catalog-dialog-cancel").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await openForm(page, "project");
  await expect(page.getByTestId("catalog-dialog-name-input")).not.toHaveValue("  Uncommitted project  ");
  await expect(page.getByTestId("catalog-dialog-first-field-input")).toHaveValue("Field 1");
  await expect(page.getByTestId("catalog-dialog-first-field-input-error")).toHaveCount(0);
  await page.getByTestId("catalog-dialog-cancel").click();
});
