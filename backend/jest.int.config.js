'use strict';

module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/tests-int/globalSetup.js',
  setupFilesAfterEnv: ['<rootDir>/tests-int/setup.js'],
  testMatch: ['<rootDir>/tests-int/**/*.test.js'],
  transform: {},
  forceExit: true,
  maxWorkers: 1,
  testTimeout: 60000,
};
