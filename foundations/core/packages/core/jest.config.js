// These tests compare calendar days between timezones. They assume the runner's
// local day is UTC, as the GitHub runner is. Pin it so a developer machine in
// another timezone runs the same assertions.
process.env.TZ = 'UTC'

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  roots: ['./src'],
  coverageReporters: ['text-summary', 'html', 'lcov']
}
