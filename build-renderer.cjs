const path = require("node:path");
const { copyFileSync, mkdirSync } = require("node:fs");
const esbuild = require("esbuild");

const root = __dirname;
const output = path.join(root, "dist", "renderer.js");
const license = path.join(root, "dist", "vendor", "three.LICENSE.txt");
const threeRoot = path.dirname(path.dirname(require.resolve("three")));
mkdirSync(path.dirname(license), { recursive: true });
copyFileSync(path.join(threeRoot, "LICENSE"), license);
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "renderer.mjs")],
  outfile: output,
  bundle: true,
  nodePaths: [path.dirname(threeRoot)],
  minify: true,
  target: "es2022",
  format: "iife",
  legalComments: "none",
  banner: { js: "/*! RUNOUT renderer. Three.js is distributed under MIT (see vendor/three.LICENSE.txt). */" }
});
