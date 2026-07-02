'use strict';

module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  transform: {},
  forceExit: true,
  moduleNameMapper: {
    '^multer$': '<rootDir>/tests/__mocks__/multer.js',
  },
};
