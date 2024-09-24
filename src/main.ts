import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as httpm from "@actions/http-client";

const konvuToken = process.env.KONVU_TOKEN || core.getInput("konvu-token");
const konvuAppName =
  process.env.KONVU_APP_NAME || core.getInput("konvu-app-name");
let konvuVersion = process.env.KONVU_VERSION || core.getInput("konvu-version");
let konvuAlphaDownloadSecret =
  process.env.KONVU_ALPHA_DL_SECRET || core.getInput("konvu-alpha-dl-secret");

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

    const platArch = beautifulPlatformAndArch();
    if (!platArch) {
      core.setFailed("Unsupported platform or architecture");
      return;
    }

    if (
      konvuAlphaDownloadSecret === undefined ||
      konvuAlphaDownloadSecret === ""
    ) {
      core.setFailed(
        "konvu-alpha-dl-secret is required, you may set it as KONVU_ALPHA_DL_SECRET env variable or konvu-alpha-dl-secret action input",
      );
      return;
    }

    if (!konvuAlphaDownloadSecret.endsWith("=")) {
      konvuAlphaDownloadSecret = konvuAlphaDownloadSecret + "=";
    }

    const extension = process.platform === "win32" ? "zip" : "tar.gz";

    if (konvuVersion === "latest") {
      const versionUrl =
        "https://download.staging.konvu.com/konvu-sca/versions";
      const http = new httpm.HttpClient(undefined, [], {
        allowRetries: false,
        headers: {
          Authorization: `Basic ${konvuAlphaDownloadSecret}`,
        },
      });
      const resp = await http.get(versionUrl);
      konvuVersion = (await resp.readBody()).trim();
      core.info(`Latest konvu-sca version is ${konvuVersion}`);
    }

    const url = `https://download.staging.konvu.com/konvu-sca/${konvuVersion}/konvu-static-analysis_${platArch}.${extension}`;

    const archiveFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "konvu-sca-archive-"),
    );
    const dstFolder = await fs.mkdtemp(path.join(os.tmpdir(), "konvu-sca-"));

    try {
      let dstArchive = path.join(archiveFolder, `konvu-sca.${extension}`);
      core.info(`Downloading konvu-sca from ${url}`);

      if (process.platform === "win32") {
        const konvuZip = await tc.downloadTool(
          url,
          dstArchive,
          `Basic ${konvuAlphaDownloadSecret}`,
          {
            accept: "application/octet-stream",
          },
        );
        await tc.extractZip(konvuZip, dstFolder);
      } else {
        const konvuTgz = await tc.downloadTool(
          url,
          dstArchive,
          `Basic ${konvuAlphaDownloadSecret}`,
          {
            accept: "application/octet-stream",
          },
        );
        await tc.extractTar(konvuTgz, dstFolder);
      }
    } catch (error: any) {
      core.setFailed(
        `Failed to download and extract konvu-sca ${error.message}\n${url}`,
      );
      return;
    }

    core.addPath(dstFolder);
    core.endGroup();
    core.info("Running konvu-sca on the project");
    await exec.exec("konvu-sca", [workspaceDirectory()], {
      env: { KONVU_APP_NAME: konvuAppName, KONVU_TOKEN: konvuToken },
      ignoreReturnCode: true,
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
