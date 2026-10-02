// Optional focused regression test; temporary fixtures only, no media downloads.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-helpers-"));
const put = (relative, content) => {
  const file = path.join(temporary, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const run = (script, args, env = {}, success = true) => {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.status === 0, success, `${result.stdout}\n${result.stderr}`);
  return result;
};
try {
  for (const name of ["install-font.sh", "align-export.sh"]) {
    put(`repo/scripts/${name}`, fs.readFileSync(path.join(root, "scripts", name)));
    run("-n", [path.join(temporary, "repo/scripts", name)]);
  }
  const fontScript = path.join(temporary, "repo/scripts/install-font.sh");
  const font = put("repo/assets/fonts/smiley-sans-oblique.ttf", Buffer.from("00010000010203", "hex"));
  const license = put("repo/assets/fonts/LICENSE.txt", "Font license fixture");
  put("repo/LICENSE.txt", "Repository license must never substitute for font license");
  const makeJob = (name, family = "Smiley Sans") => {
    put(`${name}/state/design-system.json`, JSON.stringify({ typography: { displayFamily: family, fontAsset: "assets/fonts/display.woff2" } }));
    put(`${name}/hyperframes/index.template.html`, `@font-face {font-family: "Smiley Sans"; src: local("Smiley Sans"), url("old.woff2") format("woff2");}\n@font-face {font-family: "Code Mono"; src: url("mono.woff2");}`);
    return path.join(temporary, name);
  };
  const job = makeJob("job");
  run(fontScript, [job]);
  const css = fs.readFileSync(path.join(job, "hyperframes/index.template.html"), "utf8");
  assert.match(css, /smiley-sans-oblique.ttf.*truetype/);
  assert.match(css, /font-family: "Code Mono"; src: url\("mono.woff2"\)/);
  assert.doesNotMatch(css, /old.woff2|local\(/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(job, "state/design-system.json"))).typography.fontAsset, "assets/fonts/smiley-sans-oblique.ttf");
  run(fontScript, [makeJob("other-family", "Unknown Family")], {}, false);
  const disguised = put("bad/font.woff2", fs.readFileSync(font));
  put("bad/LICENSE.txt", "Font license fixture");
  assert.match(run(fontScript, [makeJob("bad-job"), "--from", disguised], {}, false).stderr, /Invalid or unsupported/);
  fs.unlinkSync(license);
  assert.match(run(fontScript, [makeJob("no-license"), "--from", font], {}, false).stderr, /Missing adjacent font LICENSE/);

  const mock = (name, source) => {
    const file = put(`bin/${name}`, `#!${process.execPath}\n${source}`);
    fs.chmodSync(file, 0o755);
  };
  mock("ffprobe", `const staged=process.argv.at(-1).includes('.align-'); process.stdout.write(staged?process.env.AFTER_PROBE:process.env.BEFORE_PROBE);`);
  mock("ffmpeg", `require('fs').writeFileSync(process.argv.at(-1),'new-media');`);
  const probe = (video, audio, frames = "60") => JSON.stringify({ format: { duration: String(Math.max(video, audio)) }, streams: [
    { codec_type: "video", duration: String(video), r_frame_rate: "30/1", nb_frames: frames },
    { codec_type: "audio", duration: String(audio) }
  ] });
  const env = { PATH: `${path.join(temporary, "bin")}:${process.env.PATH}`, BEFORE_PROBE: probe(2, 2), AFTER_PROBE: probe(2, 2) };
  const input = put("media/input.mp4", "source");
  const output = put("media/output.mp4", "previous-delivery");
  const align = path.join(temporary, "repo/scripts/align-export.sh");
  assert.equal(run(align, [input, "--output", output], env).stdout.trim(), input);
  assert.equal(fs.readFileSync(output, "utf8"), "previous-delivery");
  env.BEFORE_PROBE = probe(2, 3);
  env.AFTER_PROBE = probe(2, 3);
  run(align, [input, "--output", output], env, false);
  assert.equal(fs.readFileSync(output, "utf8"), "previous-delivery");
  env.AFTER_PROBE = probe(1, 1, "0");
  run(align, [input, "--output", output], env, false);
  assert.equal(fs.readFileSync(output, "utf8"), "previous-delivery");
  env.AFTER_PROBE = probe(2, 2);
  assert.equal(run(align, [input, "--output", output], env).stdout.trim(), output);
  assert.equal(fs.readFileSync(output, "utf8"), "new-media");
  assert.equal(fs.readFileSync(input, "utf8"), "source");
  assert.equal(fs.readdirSync(path.dirname(output)).some((name) => name.startsWith(".align-")), false);
  console.log("Production helper tests passed.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
