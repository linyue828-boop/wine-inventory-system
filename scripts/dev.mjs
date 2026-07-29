import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit" }),
  process.env.npm_execpath
    ? spawn(process.execPath, [process.env.npm_execpath, "exec", "vite"], { stdio: "inherit" })
    : spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "vite"], { stdio: "inherit" }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}
