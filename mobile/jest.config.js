/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Silence native modules that can't run in Node
    '^expo-location$': '<rootDir>/src/__tests__/__mocks__/expo-location.ts',
    '^expo-sqlite$': '<rootDir>/src/__tests__/__mocks__/expo-sqlite.ts',
    '^@react-native-community/netinfo$': '<rootDir>/src/__tests__/__mocks__/netinfo.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: true } }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  globals: {
    __DEV__: true,
  },
};
