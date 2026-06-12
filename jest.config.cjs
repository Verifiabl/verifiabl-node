/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // Tests run under CJS Jest; the published build (tsup) stays ESM+CJS.
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
        },
      },
    ],
  },
};
