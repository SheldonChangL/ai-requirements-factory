import { expect, test, type Page } from "@playwright/test";

type Project = {
  id: string;
  name: string;
};

function buildStageSummary(stage: "prd" | "architecture" | "stories") {
  if (stage === "prd") {
    return {
      stage,
      status: "draft",
      has_content: false,
      blocked_by: [],
      downstream_stages: ["architecture", "stories"],
      downstream_impacted: [],
      stale: false,
      open_comments: 0,
      last_revision_reviewed: false,
    };
  }

  if (stage === "architecture") {
    return {
      stage,
      status: "draft",
      has_content: false,
      blocked_by: ["prd"],
      downstream_stages: ["stories"],
      downstream_impacted: [],
      stale: false,
      open_comments: 0,
      last_revision_reviewed: false,
    };
  }

  return {
    stage,
    status: "draft",
    has_content: false,
    blocked_by: ["architecture"],
    downstream_stages: [],
    downstream_impacted: [],
    stale: false,
    open_comments: 0,
    last_revision_reviewed: false,
  };
}

async function installApiMocks(page: Page, initialProjects: Project[] = []) {
  const projects = [...initialProjects];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/models/check" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: ["ollama", "codex-cli"],
          budgets: {},
        }),
      });
      return;
    }

    if (path === "/api/server-config" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jira: { configured: false, domain: null },
          github: { configured: false },
        }),
      });
      return;
    }

    if (path === "/api/projects" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ projects }),
      });
      return;
    }

    if (path === "/api/projects" && method === "POST") {
      const payload = JSON.parse(request.postData() ?? "{}") as {
        name?: string;
        thread_id?: string;
      };
      const project = {
        id: payload.thread_id ?? `project-${projects.length + 1}`,
        name: payload.name ?? "Untitled project",
      };
      projects.push(project);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ project }),
      });
      return;
    }

    if (path.startsWith("/api/projects/") && method === "DELETE") {
      const projectId = path.split("/").at(-1) ?? "";
      const index = projects.findIndex((project) => project.id === projectId);
      if (index >= 0) {
        projects.splice(index, 1);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, thread_id: projectId }),
      });
      return;
    }

    if (/^\/api\/chat\/[^/]+$/.test(path) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [],
          current_prd: "",
          is_ready: false,
          architecture_draft: "",
          user_stories_draft: "",
        }),
      });
      return;
    }

    if (/^\/api\/stage\/(architecture|stories)\/chat\/[^/]+$/.test(path) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      });
      return;
    }

    if (/^\/api\/stage\/statuses\/[^/]+$/.test(path) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          prd: "draft",
          architecture: "draft",
          stories: "draft",
        }),
      });
      return;
    }

    if (/^\/api\/stage\/summaries\/[^/]+$/.test(path) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          prd: buildStageSummary("prd"),
          architecture: buildStageSummary("architecture"),
          stories: buildStageSummary("stories"),
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        detail: `Unhandled request in smoke suite: ${method} ${path}`,
      }),
    });
  });
}

test.describe("Home page smoke QA", () => {
  test("renders the empty state and creates a project from the sidebar form", async ({ page }) => {
    await installApiMocks(page);

    await page.goto("/");

    await expect(page.getByTestId("empty-project-state")).toBeVisible();
    await expect(page.getByText("No projects yet.")).toBeVisible();

    await page.getByTestId("open-create-project").click();
    await page.getByTestId("submit-create-project").click();

    await expect(page.getByTestId("create-project-error")).toHaveText("Project name is required.");

    await page.getByTestId("create-project-name-input").fill("QA Smoke Project");
    await page.getByTestId("submit-create-project").click();

    await expect(page.getByRole("heading", { name: "QA Smoke Project" })).toBeVisible();
    await expect(page).toHaveURL(/project=project-1/);
  });

  test("deletes the active project and returns to the empty state", async ({ page }) => {
    await installApiMocks(page, [{ id: "alpha-project", name: "Alpha Project" }]);

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Alpha Project" })).toBeVisible();

    await page.locator('[aria-label="Delete Alpha Project"]').click({ force: true });

    await expect(page.getByTestId("empty-project-state")).toBeVisible();
    await expect(page.getByText("No projects yet.")).toBeVisible();
  });
});
