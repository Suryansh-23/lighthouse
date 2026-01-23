import * as fs from "fs";
import * as path from "path";

import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  const suiteDir = __dirname;
  const testFiles = fs
    .readdirSync(suiteDir)
    .filter(file => file.endsWith(".test.js"))
    .map(file => path.resolve(suiteDir, file));

  for (const file of testFiles) {
    mocha.addFile(file);
  }

  return new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
        return;
      }

      resolve();
    });
  });
}
