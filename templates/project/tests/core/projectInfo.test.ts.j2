import { describe, it, expect } from "vitest";
import {
  createProjectInfo,
  demoUrlFor,
  statusLabel,
  isDemoReady,
  DEFAULT_STATUS,
} from "../../src/core/projectInfo";

describe("projectInfo core module", () => {
  it("builds a GitHub Pages demo URL from owner + repo", () => {
    expect(demoUrlFor("octocat", "notes-app")).toBe(
      "https://octocat.github.io/notes-app/",
    );
  });

  it("labels every lifecycle status", () => {
    expect(statusLabel("scaffolded")).toBe("Scaffolded");
    expect(statusLabel("in-progress")).toBe("In progress");
    expect(statusLabel("shipped")).toBe("Shipped");
  });

  it("defaults the status to scaffolded", () => {
    expect(DEFAULT_STATUS).toBe("scaffolded");
    const info = createProjectInfo({
      name: " Notes App ",
      owner: "octocat",
      repo: "notes-app",
    });
    expect(info.status).toBe("scaffolded");
  });

  it("creates a full ProjectInfo with defaults applied", () => {
    const info = createProjectInfo({
      name: "Notes App",
      owner: "octocat",
      repo: "notes-app",
    });
    expect(info.name).toBe("Notes App");
    expect(info.description).toBe("");
    expect(info.owner).toBe("octocat");
    expect(info.repo).toBe("notes-app");
    expect(info.status).toBe("scaffolded");
    expect(info.demoUrl).toBe("https://octocat.github.io/notes-app/");
  });

  it("honours an explicit status and description", () => {
    const info = createProjectInfo({
      name: "Notes App",
      description: "  A markdown notes app  ",
      owner: "octocat",
      repo: "notes-app",
      status: "in-progress",
    });
    expect(info.description).toBe("A markdown notes app");
    expect(info.status).toBe("in-progress");
    expect(info.demoUrl).toBe("https://octocat.github.io/notes-app/");
  });

  it("trims whitespace from identity fields", () => {
    const info = createProjectInfo({
      name: "  Notes  ",
      owner: "  octocat  ",
      repo: "  notes-app  ",
    });
    expect(info.name).toBe("Notes");
    expect(info.owner).toBe("octocat");
    expect(info.repo).toBe("notes-app");
    expect(info.demoUrl).toBe("https://octocat.github.io/notes-app/");
  });

  it("considers a project demo-ready only when shipped", () => {
    expect(isDemoReady({ status: "scaffolded" })).toBe(false);
    expect(isDemoReady({ status: "in-progress" })).toBe(false);
    expect(isDemoReady({ status: "shipped" })).toBe(true);
  });
});
