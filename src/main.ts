import * as core from "@actions/core";
import axios from "axios";
import * as tc from "@actions/tool-cache";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as path from "path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

const ghToken = process.env.GITHUB_TOKEN;
export const gh = github.getOctokit(ghToken!);
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

export async function download(url: string) {
  await tc.downloadTool(url, "/tmp/konvu-sca.zip", `Bearer ${ghToken}`, {
    accept: "application/octet-stream",
  });
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
    const archiveFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "konvu-sca-archive-"),
    );
    const dstFolder = await fs.mkdtemp(path.join(os.tmpdir(), "konvu-sca-"));

    try {
      const asset = await gh.rest.repos.getReleaseAsset({
        owner: "KonvuTeam",
        repo: "konvu-static-analysis",
        asset_id: latest.id,
      });
      let dstArchive = path.join(archiveFolder, asset.data.name);
      if (process.platform === "win32") {
        const konvuZip = await tc.downloadTool(
          latest.url,
          dstArchive,
          `Bearer ${ghToken}`,
          { accept: asset.data.content_type },
        );
        await tc.extractZip(konvuZip, dstFolder);
      } else {
        const konvuTgz = await tc.downloadTool(
          latest.url,
          dstArchive,
          `Bearer ${ghToken}`,
          { accept: asset.data.content_type },
        );
        await tc.extractTar(konvuTgz, dstFolder);
      }
    } catch (error: any) {
      core.setFailed(
        `Failed to download and extract konvu-sca ${error.message} ${ghToken}\n${latest.url}`,
      );
      return;
    }

    core.addPath(dstFolder);
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
    const releases = await gh.rest.repos.listReleases({
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
