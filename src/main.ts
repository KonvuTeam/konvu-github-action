import * as core from "@actions/core";
import axios from "axios";
import * as tc from "@actions/tool-cache";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as path from "path";

const ghToken = process.env.GITHUB_TOKEN;
const konvuToken = process.env.KONVU_TOKEN || core.getInput("konvu-token");
const konvuAppName =
  process.env.KONVU_APP_NAME || core.getInput("konvu-app-name");

const ghClient = axios.create({
  headers: { Authorization: `Bearer ${ghToken}` },
});

function workspaceDirectory() {
  // GitHub workspace
  let githubWorkspacePath = process.env["GITHUB_WORKSPACE"];
  if (!githubWorkspacePath) {
    throw new Error("GITHUB_WORKSPACE not defined");
  }
  githubWorkspacePath = path.resolve(githubWorkspacePath);

  let repositoryPath = core.getInput("path") || ".";
  repositoryPath = path.resolve(githubWorkspacePath, repositoryPath);

  return repositoryPath;
}

export async function run(): Promise<void> {
  try {
    core.startGroup("Setting up konvu-sca");
    if (konvuToken === undefined || konvuToken === "") {
      core.setFailed(
        "Konvu token is required, you may set it as KONVU_TOKEN env variable or konvu-token action input",
      );
      return;
    }

    const latest = await getLatestAssetForCurrentArch();
    if (!latest) {
      return;
    }
    try {
      if (process.platform === "win32") {
        const konvuZip = await tc.downloadTool(
          latest.url,
          "/tmp/konvu-sca.zip",
          `Bearer ${ghToken}`,
        );
        await tc.extractZip(konvuZip, "/tmp/konvu-sca");
      } else {
        const konvuTgz = await tc.downloadTool(
          latest.url,
          "/tmp/konvu-sca.",
          `Bearer ${ghToken}`,
        );
        await tc.extractTar(konvuTgz, "/tmp/konvu-sca");
      }
    } catch (error: any) {
      core.setFailed(
        `Failed to download and extract konvu-sca ${error.message} ${ghToken}`,
      );
      return;
    }
    core.addPath("/tmp/konvu-sca");
    core.endGroup();
    core.info("Running konvu-sca on the project");
    exec.exec("konvu-sca", [workspaceDirectory()], {
      env: { KONVU_APP_NAME: konvuAppName, KONVU_TOKEN: konvuToken },
    });
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

function beautifulPlatformAndArch(): string | undefined {
  let platform: string = process.platform;
  let arch: string = process.arch;
  switch (platform) {
    case "win32":
      platform = "Windows";
      break;
    case "darwin":
      platform = "Darwin";
      break;
    case "linux":
      platform = "Linux";
      break;
    default:
      return;
  }
  switch (arch) {
    case "x64":
      arch = "x86_64";
      break;
    case "arm64":
      arch = "arm64";
      break;
    default:
      return;
  }
  return `${platform}_${arch}`;
}

// TODO fetch this from the backend
export async function getLatestAssetForCurrentArch(): Promise<any | undefined> {
  const platArch = beautifulPlatformAndArch();
  if (!platArch) {
    core.setFailed("Unsupported platform or architecture");
    return;
  }

  try {
    const releases = await github
      .getOctokit(ghToken!)
      .rest.repos.listReleases({
        owner: "KonvuTeam",
        repo: "konvu-static-analysis",
      });

    const latestRelease = releases.data[0];

    return latestRelease.assets.find((asset: any) =>
      asset.name.includes(platArch),
    );
  } catch (error: any) {
    core.setFailed(`Failed to list releases ${error.message} ${ghToken}`);
    return;
  }
}
